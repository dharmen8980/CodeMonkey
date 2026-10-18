const fs = require('fs');
const path = require('path');

const { TIMEOUT_MS } = require('./config');
const { updateTask } = require('./task-store');
const { parseUsage, readArtifactUsage } = require('./usage');
const { notifyTeams } = require('./notify-teams');

// Shared completion path for a run, whether it just exited from a live `docker run`
// exec() callback in this process, or is being reconciled on startup for a container
// this process lost track of (server restarted mid-run). Writes manifest.json, updates
// tasks.json, and fires the Teams notification exactly once either way.
function finalizeRun(task, runId, containerName, runDir, startedAt, startMs, opts = {}) {
  const { killedByTimeout, killedByCostLimit, error, stdout, stderr, eventsPath } = opts;

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const usage = readArtifactUsage(runDir) || parseUsage(stdout || '');
  const status = killedByCostLimit ? 'cost_limit' : killedByTimeout ? 'timeout' : error ? 'failed' : 'completed';
  const exitCode = error ? (error.code || 1) : 0;

  // Write run_completed event
  if (eventsPath) {
    fs.appendFileSync(eventsPath, JSON.stringify({
      type: 'run_completed', ts: finishedAt, run_id: runId, task_id: task.id,
      status, exit_code: exitCode, duration_ms: durationMs,
      usage: usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: usage.cost_usd } : null
    }) + '\n');
  }

  // Write manifest.json atomically
  const mrMatch = (stdout || '').match(/https:\/\/gitlab[^\s)]+merge_requests\/\d+/);

  const usageSection = usage ? {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens || 0,
    cost_usd: usage.cost_usd
  } : null;

  const manifest = {
    run_id: runId,
    task_id: task.id,
    source: task.source || 'unknown',
    event_id: task.event_id || null,
    task: task.description || task.review_comments || '',
    task_type: task.task_type || 'new-task',
    model: usage?.model || null,
    status,
    exit_code: exitCode,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    usage: usageSection,
    mr_url: mrMatch ? mrMatch[0] : (task.mr_url || null),
    files: {
      events: 'events.jsonl',
      transcript: 'transcript.jsonl',
      stdout: 'stdout.log',
      diff: 'changes.diff',
      usage: 'usage.json',
      instructions: 'instructions.md',
      instruction_manifest: 'instruction-manifest.json',
      instruction_references: 'instruction-references.json',
      run_context: 'run-context.json',
      ...(task.pipeline_context ? { spec: 'spec.json', handoff: 'handoff.json', feedback: 'feedback.json' } : { request: 'request.json' }),
    }
  };
  const manifestTmp = path.join(runDir, 'manifest.json.tmp');
  const manifestPath = path.join(runDir, 'manifest.json');
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(manifestTmp, manifestPath);

  if (status === 'cost_limit') {
    console.log(`\n💸 Code-Monkey killed for cost: ${containerName}`);
    const costAtKill = task._costAtKill != null ? task._costAtKill.toFixed(4) : '?';
    const errorMsg = `Killed after exceeding cost limit (spent ~$${costAtKill})`;
    if (usage) console.log(`   Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | Cost: $${usage.cost_usd.toFixed(4)}`);
    updateTask(task.id, {
      status: 'cost_limit',
      error: errorMsg,
      run_dir: runDir,
      usage,
      finished_at: finishedAt,
      duration_ms: durationMs
    });
    notifyTeams(task, 'cost_limit', errorMsg, usage);
  } else if (status === 'timeout') {
    console.log(`\n⏱️  Code-Monkey timed out: ${containerName}`);
    if (usage) console.log(`   Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | Cost: $${usage.cost_usd.toFixed(4)}`);
    updateTask(task.id, {
      status: 'timeout',
      error: `Killed after ${TIMEOUT_MS / 60000}min timeout`,
      run_dir: runDir,
      usage,
      finished_at: finishedAt,
      duration_ms: durationMs
    });
    notifyTeams(task, 'timeout', `Killed after ${TIMEOUT_MS / 60000}min timeout`, usage);
  } else if (status === 'failed') {
    console.log(`\n❌ Code-Monkey failed: ${containerName}`);
    console.log(`   Error: ${(stderr || error?.message || '').slice(0, 500)}`);
    if (usage) console.log(`   Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | Cost: $${usage.cost_usd.toFixed(4)}`);
    updateTask(task.id, {
      status: 'failed',
      error: stderr || error?.message,
      run_dir: runDir,
      usage,
      finished_at: finishedAt,
      duration_ms: durationMs
    });
    notifyTeams(task, 'failed', stderr || error?.message, usage);
  } else {
    console.log(`\n✅ Code-Monkey completed: ${containerName}`);
    if (usage) console.log(`   Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | Cost: $${usage.cost_usd.toFixed(4)}`);
    updateTask(task.id, {
      status: 'completed',
      run_dir: runDir,
      usage,
      finished_at: finishedAt,
      duration_ms: durationMs
    });
    notifyTeams(task, 'completed', stdout, usage);
  }
}

module.exports = { finalizeRun };
