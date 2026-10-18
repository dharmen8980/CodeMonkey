const fs = require('fs');
const path = require('path');

const { loadTasks } = require('../task-store');
const { loadChatUsage } = require('../chat/history');

// One ticket's real cost is scattered across three places that don't know about each
// other: the chat session that triaged/clarified it (chats/usage.jsonl), the one-shot
// triage container (its own last-raw.json, never rolled into any store), and every
// worker run spawnAgent() fired for it (tasks.json, tagged with pipeline_ticket_id).
// This is the one place that adds them back up — meant to answer "where did the
// money go" once a ticket finishes, not to run on every tick.
// last-raw.json is claude -p's stream-json output (one JSON object per line, not a
// single buffered envelope — see chat/triage-entrypoint.sh) so the cost lives on the
// final line with type "result", not the file as a whole.
function readTriageRunCost(runDir) {
  try {
    const lines = fs.readFileSync(path.join(runDir, 'last-raw.json'), 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'result') return Number(obj.total_cost_usd || 0);
      } catch { /* not a JSON line, keep scanning backwards */ }
    }
    return 0;
  } catch { return 0; }
}

// A clarification round-trip re-spawns triage, so a ticket can have more than one
// triage run — sum all of them, not just the current runs.triage_run_dir (older
// tickets only ever had the singular field; fall back to that alone).
function readTriageCost(ticket) {
  const runDirs = ticket.runs?.triage_run_dirs
    || (ticket.runs?.triage_run_dir ? [ticket.runs.triage_run_dir] : []);
  return runDirs.reduce((sum, runDir) => sum + readTriageRunCost(runDir), 0);
}

function readChatCost(ticket) {
  if (!ticket.chat_id) return 0;
  return loadChatUsage()
    .filter(u => u.chat_id === ticket.chat_id)
    .reduce((sum, u) => sum + (u.cost_usd || 0), 0);
}

// Buckets every spawnAgent() run tagged with this ticket by task_type — implement
// retries all share task_type "review-feedback", so they collapse into one bucket
// (the count is what shows the retries cost, not separate line items). sonar_gate
// has no bucket: it's a bash+API check against the persistent sonar-scanner
// container (lib/gitlab-webhook.js), no claude call, always $0.
function readWorkerCosts(ticket) {
  const tasks = loadTasks().filter(t => t.pipeline_ticket_id === ticket.id);
  const buckets = { raise_pr: 0, unit_test: 0, implement: 0 };
  const counts = { raise_pr: 0, unit_test: 0, implement: 0 };
  const typeToBucket = { 'new-task': 'raise_pr', 'unit-test': 'unit_test', 'review-feedback': 'implement' };
  for (const t of tasks) {
    const bucket = typeToBucket[t.task_type];
    if (!bucket) continue;
    buckets[bucket] += (t.usage && t.usage.cost_usd) || 0;
    counts[bucket] += 1;
  }
  return { buckets, counts };
}

function computeTicketCost(ticket) {
  const chat_usd = readChatCost(ticket);
  const triage_usd = readTriageCost(ticket);
  const { buckets, counts } = readWorkerCosts(ticket);
  const e2e_authoring_usd = ticket.e2e_gate_result?.authoring_cost_usd || 0;

  const total_usd = chat_usd + triage_usd + buckets.raise_pr + buckets.unit_test
    + buckets.implement + e2e_authoring_usd;

  return {
    total_usd: Number(total_usd.toFixed(4)),
    breakdown: {
      chat_categorization_usd: Number(chat_usd.toFixed(4)),
      triage_usd: Number(triage_usd.toFixed(4)),
      raise_pr_usd: Number(buckets.raise_pr.toFixed(4)),
      unit_test_usd: Number(buckets.unit_test.toFixed(4)),
      implement_usd: Number(buckets.implement.toFixed(4)),
      implement_attempts: counts.implement,
      e2e_authoring_usd: Number(e2e_authoring_usd.toFixed(4)),
    },
    computed_at: new Date().toISOString(),
  };
}

module.exports = { computeTicketCost, readTriageRunCost };
