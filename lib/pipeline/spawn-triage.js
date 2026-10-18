const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { ARTIFACTS_DIR } = require('../config');
const { generateRunId } = require('../utils');
const { chatEnvFile, CHAT_IMAGE } = require('../chat/config');

const TRIAGE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes — one-shot, read-only; wide-scope tickets (multi-table/multi-FR) can need more than 10
const STALL_CHECK_INTERVAL_MS = 45 * 1000;
const STALL_GRACE_MS = 3 * 60 * 1000; // don't judge stalls until real investigation has had time to happen
const STALL_STREAK_THRESHOLD = 6; // consecutive degenerate turns before we call it a stall

// last-raw.json is mounted straight through to the host (-v runDir:/workspace/_artifacts),
// so we can read the model's own stream without needing anything inside the container to
// cooperate. Used both to salvage a finished-but-not-yet-flushed answer right before a kill,
// and by the stall watchdog to look at the tail of the stream.
function readRawLines(runDir) {
  try {
    const raw = fs.readFileSync(path.join(runDir, 'last-raw.json'), 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n');
  } catch { return []; }
}

// Mirrors the parsing triage-entrypoint.sh does after claude -p exits normally. Pulled out
// here so a kill (stall or hard timeout) can attempt the same recovery before the container
// disappears — otherwise a model that finished right as the clock ran out loses its answer
// to the kill signal itself, not to anything wrong with its output.
function salvageResult(runDir) {
  const resultPath = path.join(runDir, 'result.json');
  if (fs.existsSync(resultPath)) return true;

  const lines = readRawLines(runDir);
  let text = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'result') { text = obj.result || obj.text || ''; break; }
    } catch { /* not a JSON line (or a mid-write partial one), keep scanning backwards */ }
  }
  if (!text) return false;

  let cleaned = String(text).trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch { /* still not JSON */ }
    }
  }

  if (!parsed || typeof parsed.brief !== 'string') return false;
  fs.writeFileSync(resultPath, JSON.stringify(parsed, null, 2));
  return true;
}

// Detects the specific failure this was built for: the model finishes its real
// investigation, then instead of emitting the closing JSON, spins on trivial tool calls
// (empty thinking, no text, a couple output tokens) forever. A turn counts as
// "degenerate" when it has no thinking/text content and produced next to no output —
// legitimate investigation turns (reading files, running greps) always carry either
// reasoning text or a meaningfully-sized tool call.
function countTrailingDegenerateTurns(runDir) {
  const lines = readRawLines(runDir);
  let streak = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type !== 'assistant') continue;

    const content = obj.message?.content || [];
    const hasThinkingOrText = content.some(b =>
      (b.type === 'thinking' && (b.thinking || '').trim()) ||
      (b.type === 'text' && (b.text || '').trim()));
    const outputTokens = obj.message?.usage?.output_tokens || 0;

    if (!hasThinkingOrText && outputTokens <= 10) streak += 1;
    else break;
  }
  return streak;
}

// One-shot triage container: reuses the ai-chat image (same repo+MCP read-only
// toolset triage needs) via an entrypoint override, so the long-lived chat feature's
// own entrypoint.sh is never touched. Completion is detected by disk state
// (result.json/error.json in the run dir), not tracked in tasks.json — triage isn't a
// "task" in that store's sense, and this survives an orchestrator restart the same way
// task-reconcile.js's manifest-first philosophy does: the next tick just re-checks disk.
function spawnTriage(ticket) {
  const runId = generateRunId();
  const containerName = `ai-triage-${runId}`;
  const runDir = path.resolve(ARTIFACTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Triage gets its own model pin, same id the implement/worker containers use
  // (entrypoint-lib/implement-prompts.sh's IMPLEMENT_MODEL) — chatEnvFile()'s
  // CHAT_MODEL default is shared with the long-lived chat feature, so override just
  // this env file rather than changing that shared default.
  const envFilePath = path.join(runDir, 'env');
  const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
  const envContent = chatEnvFile().replace(/^CHAT_MODEL=.*$/m, `CHAT_MODEL=${TRIAGE_MODEL}`);
  fs.writeFileSync(envFilePath, envContent);

  // human_clarification present means this ticket already went through triage once,
  // got parked in needs_decision, and a human answered the question on the pipeline
  // page — triage-entrypoint.sh uses a lighter confirm-only prompt in that case
  // instead of redoing the full investigation from scratch.
  const taskPayload = {
    jira_key: ticket.jira_key || '',
    initial_brief: ticket.initial_brief || ticket.title || '',
    fr_number: ticket.fr_number || '',
    prior_triage: ticket.human_clarification ? (ticket.triage || null) : null,
    clarification_question: ticket.human_clarification ? (ticket.clarification_question || '') : '',
    human_clarification: ticket.human_clarification || '',
    // Set when a human retries a blocked triage via the pipeline page's guidance
    // box (routes/pipeline-routes.js's /retry) — steers a FRESH investigation
    // rather than replacing it, since a block means triage rejected the ticket
    // outright (no prior findings worth protecting the way needs_decision has).
    human_guidance: ticket.human_clarification ? '' : (ticket.human_guidance || ''),
  };
  const taskJsonPath = path.join(runDir, 'task.json');
  fs.writeFileSync(taskJsonPath, JSON.stringify(taskPayload));

  const cmd = [
    'docker run --rm',
    `--name ${containerName}`,
    '--memory=2g --cpus=2 --pids-limit=512',
    `--env-file ${envFilePath}`,
    `-v ${taskJsonPath}:/workspace/task.json:ro`,
    `-v ${runDir}:/workspace/_artifacts:rw`,
    '--entrypoint /triage-entrypoint.sh',
    CHAT_IMAGE,
  ].join(' ');

  console.log(`\n🔎 Spawning triage: ${containerName} (ticket ${ticket.id})`);

  // Sampled peak: a spike between polls can be missed, but avoids coupling the
  // runner to container-internal cgroup paths.
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

  let killedForStall = false;

  const child = exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
    clearTimeout(timer);
    clearInterval(stallCheck);
    clearInterval(memoryPoll);
    const topProcesses = [...processPeakRss.entries()]
      .map(([name, peakRssBytes]) => ({
        name,
        peak_rss_bytes: peakRssBytes,
        peak_cpu_percent: processPeakCpu.get(name) || 0,
      }))
      .sort((a, b) => b.peak_rss_bytes - a.peak_rss_bytes)
      .slice(0, 15);
    fs.writeFileSync(path.join(runDir, 'resource-usage.json'), JSON.stringify({
      peak_mem_bytes: peakMemBytes,
      top_processes: topProcesses,
      run_id: runId,
    }));
    // If the script itself crashed before writing either marker, leave a record so
    // the driver doesn't poll forever waiting for a file that will never appear.
    // salvageResult() gets one last shot first — if the model actually finished but
    // the container hadn't flushed result.json yet (e.g. we just killed it), don't
    // throw that answer away.
    salvageResult(runDir);
    const resultPath = path.join(runDir, 'result.json');
    const errorPath = path.join(runDir, 'error.json');
    if (!fs.existsSync(resultPath) && !fs.existsSync(errorPath)) {
      fs.writeFileSync(errorPath, JSON.stringify({
        error: killedForStall
          ? `triage stalled: ${STALL_STREAK_THRESHOLD}+ consecutive no-op/empty-output turns detected, killed early instead of burning the full timeout`
          : (error ? (error.message || String(error)) : 'triage container exited with no result'),
        stderr: (stderr || '').slice(-2000),
      }));
    }
  });

  // Ceiling for legitimately wide-scope tickets that are still making real progress.
  const timer = setTimeout(() => {
    console.log(`\n⏱️  Triage timeout for ${containerName}, killing...`);
    salvageResult(runDir);
    exec(`docker kill ${containerName}`, () => {});
  }, TRIAGE_TIMEOUT_MS);

  // Catches the specific degenerate-loop failure (model finishes investigating, then
  // spins on trivial tool calls instead of outputting its answer) well before the
  // 20-minute ceiling — no reason to pay for 19 more minutes of a container doing
  // nothing.
  const stallCheck = setInterval(() => {
    if (Date.now() - stallCheck._startTime < STALL_GRACE_MS) return;
    const streak = countTrailingDegenerateTurns(runDir);
    if (streak < STALL_STREAK_THRESHOLD) return;
    console.log(`\n🛑 Triage stall detected for ${containerName} (${streak} degenerate turns), killing early...`);
    killedForStall = true;
    clearInterval(stallCheck);
    salvageResult(runDir);
    exec(`docker kill ${containerName}`, () => {});
  }, STALL_CHECK_INTERVAL_MS);
  stallCheck._startTime = Date.now();

  return { runId, runDir, containerName };
}

module.exports = { spawnTriage };
