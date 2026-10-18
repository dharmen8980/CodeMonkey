const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { ARTIFACTS_DIR, DOCKER_IMAGE, TIMEOUT_MS, COST_LIMIT_USD } = require('./config');
const { generateRunId } = require('./utils');
const { updateTask, mutateTasks } = require('./task-store');
const { finalizeRun } = require('./agent-finalize');
const { startCostGuard } = require('./cost-guard');
const { taskPayload } = require('./pipeline/worker-context');

// --- Docker agent spawning ---
function spawnAgent(task) {
  // Claim the task inside one load-modify-save critical section so a
  // duplicate trigger (webhook redelivery, double-click on /spawn/:id)
  // can't race its way past the running-status check below — spawning twice
  // for the same task previously produced duplicate MRs (FR-128-130,
  // FR-131-132, FR-164-165).
  const alreadyRunning = mutateTasks(tasks => {
    const current = tasks.find(t => t.id === task.id);
    if (!current || current.status === 'running') return true;
    current.status = 'running';
    return false;
  });
  if (alreadyRunning) {
    console.log(`\n⚠️  Task ${task.id} already running, skipping spawn`);
    return null;
  }

  const runId = generateRunId();
  const containerName = `ai-agent-${runId}`;
  const runDir = path.resolve(ARTIFACTS_DIR, runId);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  fs.mkdirSync(runDir, { recursive: true });


  const envFileContent = [
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
    `CLAUDE_CODE_USE_BEDROCK=${process.env.CLAUDE_CODE_USE_BEDROCK || ''}`,
    `AWS_REGION=${process.env.AWS_REGION || 'us-east-1'}`,
    `AWS_BEARER_TOKEN_BEDROCK=${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
    `GLAB_TOKEN=${process.env.GLAB_TOKEN}`,
    `GITLAB_HOST=${process.env.GITLAB_HOST || 'gitlab.com'}`,
    `TARGET_BRANCH=${process.env.TARGET_BRANCH || 'main'}`,
    `REPO_URL=${process.env.REPO_URL}`,
    `TASK_TYPE=${task.task_type || 'new-task'}`,
    `MR_BRANCH=${task.mr_branch || ''}`,
    `MR_URL=${task.mr_url || ''}`,
    `MR_IID=${task.mr_iid || ''}`,
    `RUN_ID=${runId}`,
    `IMPLEMENT_MODEL=${process.env.IMPLEMENT_MODEL || 'us.anthropic.claude-sonnet-5'}`,
    `DOTNET_SOLUTION=${process.env.DOTNET_SOLUTION || ''}`,
    `DOTNET_PRODUCTION_PROJECT=${process.env.DOTNET_PRODUCTION_PROJECT || ''}`,
    `TEST_PROJECT_PREFIX=${process.env.TEST_PROJECT_PREFIX || 'tests/'}`,
  ].join('\n');

  const envFilePath = path.join(runDir, 'env');
  fs.writeFileSync(envFilePath, envFileContent);

  const taskJsonPath = path.join(runDir, 'task.json');
  fs.writeFileSync(taskJsonPath, JSON.stringify(taskPayload(task), null, 2));

  const cmd = [
    'docker run --rm',
    `--name ${containerName}`,
    '--memory=2g --cpus=2 --pids-limit=512',
    `--env-file ${envFilePath}`,
    `-v ${taskJsonPath}:/workspace/task.json:ro`,
    `-v ${runDir}:/workspace/_artifacts:rw`,
    DOCKER_IMAGE
  ].join(' ');

  console.log(`\n🐳 Spawning Code-Monkey: ${containerName}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   Type: ${task.task_type || 'new-task'}`);
  console.log(`   Task: ${task.description || task.mr_url || ''}`);

  // status: 'running' already set above, inside the same critical section as
  // the duplicate-spawn check.
  updateTask(task.id, { container: containerName, run_id: runId, run_dir: runDir, started_at: startedAt });

  // Write lifecycle events
  const eventsPath = path.join(runDir, 'events.jsonl');

  const classificationReason = task.source === 'gitlab-webhook'
    ? `MR comment on !${task.mr_iid} from gitlab-webhook (${task.task_type})`
    : `New task from ${task.source || 'unknown'}: "${(task.description || '').substring(0, 80)}"`;

  fs.appendFileSync(eventsPath, JSON.stringify({ type: 'run_started', ts: startedAt, run_id: runId, task_id: task.id }) + '\n');
  fs.appendFileSync(eventsPath, JSON.stringify({ type: 'task_classified', ts: new Date().toISOString(), run_id: runId, task_id: task.id, task_type: task.task_type, reason: classificationReason }) + '\n');

  // Sampled peak: a spike between polls can be missed, but avoids coupling the
  // runner to container-internal cgroup paths. Started immediately before the
  // exec() call whose callback is guaranteed to clear it, so nothing above this
  // line (which can throw) can leak a running interval.
  let peakMemBytes = 0;
  const processPeakRss = new Map();
  const processPeakCpu = new Map();
  const processCpuSamples = new Map();
  // Linux containers almost universally expose 100 userspace clock ticks per second.
  const CLK_TCK = 100;
  const processStatsCommand = `docker exec ${containerName} sh -c 'for p in /proc/[0-9]*; do pid=\${p#/proc/}; [ -r "$p/status" ] || continue; name=$(awk -F"\\t" "/^Name:/{print \\$2}" "$p/status"); rss=$(awk "/^VmRSS:/{print \\$2}" "$p/status"); cpu=$(awk "{print \\$14, \\$15}" "$p/stat" 2>/dev/null); [ -n "$name" ] && echo "$pid|$name|$rss|$cpu"; done'`;
  const memoryPoll = setInterval(() => {
    exec(`docker stats --no-stream --format '{{.MemUsage}}' ${containerName}`, (error, stdout) => {
      if (error) return;
      const memoryUsed = stdout.split('/')[0].trim();
      const match = memoryUsed.match(/^([\d.]+)\s*(B|KiB|MiB|GiB)$/);
      if (!match) return;
      const unitBytes = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
      const memoryBytes = Math.round(Number(match[1]) * unitBytes[match[2]]);
      if (Number.isFinite(memoryBytes) && memoryBytes > peakMemBytes) peakMemBytes = memoryBytes;
    });

    exec(processStatsCommand, (error, stdout) => {
      if (error) return;
      const sampledAt = Date.now();
      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const [pid, processName, rssText, cpuText] = line.split('|');
        const name = processName?.trim();
        if (!/^\d+$/.test(pid) || !name || cpuText === undefined) continue;

        const rssKb = Number(rssText);
        if (Number.isFinite(rssKb) && rssKb >= 0) {
          const rssBytes = Math.round(rssKb * 1024);
          if (rssBytes > (processPeakRss.get(name) || 0)) processPeakRss.set(name, rssBytes);
        }

        const [utimeText, stimeText] = cpuText.trim().split(/\s+/);
        const ticksNow = Number(utimeText) + Number(stimeText);
        if (!Number.isFinite(ticksNow)) continue;
        const previous = processCpuSamples.get(pid);
        if (previous) {
          const secondsSinceLastPoll = (sampledAt - previous.timeAtLastPoll) / 1000;
          const ticksSinceLastPoll = ticksNow - previous.ticksAtLastPoll;
          if (secondsSinceLastPoll > 0 && ticksSinceLastPoll >= 0) {
            const cpuPercent = (ticksSinceLastPoll / CLK_TCK) / secondsSinceLastPoll * 100;
            if (Number.isFinite(cpuPercent) && cpuPercent > (processPeakCpu.get(name) || 0)) {
              processPeakCpu.set(name, cpuPercent);
            }
          }
        }
        processCpuSamples.set(pid, { ticksAtLastPoll: ticksNow, timeAtLastPoll: sampledAt });
      }
    });
  }, 2000);

  const child = exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
    clearTimeout(timer);
    clearInterval(memoryPoll);
    costGuard.stop();
    const topProcesses = [...processPeakRss.entries()]
      .map(([name, peakRssBytes]) => ({
        name,
        peak_rss_bytes: peakRssBytes,
        peak_cpu_percent: processPeakCpu.get(name) || 0,
      }))
      .sort((a, b) => b.peak_rss_bytes - a.peak_rss_bytes)
      .slice(0, 15);
    fs.appendFileSync(eventsPath, JSON.stringify({
      type: 'resource_usage', ts: new Date().toISOString(), run_id: runId,
      peak_mem_bytes: peakMemBytes,
      top_processes: topProcesses,
    }) + '\n');
    finalizeRun(task, runId, containerName, runDir, startedAt, startMs, {
      killedByTimeout: !!task._killed, killedByCostLimit: !!task._killedForCost,
      error, stdout, stderr, eventsPath,
    });
  });

  // Wall-clock timeout — kill container after deadline
  const timer = setTimeout(() => {
    task._killed = true;
    console.log(`\n⏱️  Timeout reached for ${containerName}, killing...`);
    exec(`docker kill ${containerName}`, (err) => {
      if (err) console.log(`   Warning: docker kill failed: ${err.message}`);
    });
  }, TIMEOUT_MS);

  // $ ceiling — a run can blow through budget fast without running long, so
  // time alone isn't a sufficient guard. See lib/cost-guard.js.
  const transcriptPath = path.join(runDir, 'transcript.jsonl');
  const costGuard = startCostGuard(transcriptPath, containerName, COST_LIMIT_USD, (costUsd) => {
    task._killedForCost = true;
    task._costAtKill = costUsd;
  });

  return containerName;
}

module.exports = { spawnAgent };
