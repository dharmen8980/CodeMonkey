const fs = require('fs');
const path = require('path');

const { loadPipeline } = require('../pipeline-store');
const { readTriageRunCost } = require('./cost');

// One row per triage container that ever ran, newest first — the operational log for
// "did triage finish, and if not, why" (timeout kill, parse failure, clone failure,
// or a real feasible/needs_clarification/infeasible result). A ticket can have more
// than one run (clarification round-trips, retries after a block), so this flattens
// runs.triage_run_dirs across every ticket rather than showing one row per ticket.
function readRunOutcome(runDir) {
  const resultPath = path.join(runDir, 'result.json');
  const errorPath = path.join(runDir, 'error.json');

  if (fs.existsSync(resultPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      return { status: result.feasibility || 'feasible', result };
    } catch {
      return { status: 'error', error: 'result.json was written but failed to parse' };
    }
  }
  if (fs.existsSync(errorPath)) {
    try {
      const err = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
      return { status: 'error', error: err.error || 'unknown error' };
    } catch {
      return { status: 'error', error: 'error.json was written but failed to parse' };
    }
  }
  return { status: 'running' };
}

function statMtime(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return null; }
}

function buildTriageLog() {
  const tickets = loadPipeline();
  const rows = [];

  for (const ticket of tickets) {
    const runDirs = ticket.runs?.triage_run_dirs
      || (ticket.runs?.triage_run_dir ? [ticket.runs.triage_run_dir] : []);

    for (const runDir of runDirs) {
      const runId = path.basename(runDir);
      const startedAtMs = statMtime(path.join(runDir, 'task.json'));
      const resultMs = statMtime(path.join(runDir, 'result.json'));
      const errorMs = statMtime(path.join(runDir, 'error.json'));
      const finishedAtMs = resultMs || errorMs || null;
      const outcome = readRunOutcome(runDir);

      rows.push({
        run_id: runId,
        ticket_id: ticket.id,
        ticket_title: ticket.title,
        jira_key: ticket.jira_key,
        status: outcome.status,
        error: outcome.error || null,
        clarification_question: outcome.result?.clarification_question || null,
        cost_usd: Number(readTriageRunCost(runDir).toFixed(4)),
        started_at: startedAtMs ? new Date(startedAtMs).toISOString() : null,
        finished_at: finishedAtMs ? new Date(finishedAtMs).toISOString() : null,
        duration_sec: startedAtMs && finishedAtMs ? Math.round((finishedAtMs - startedAtMs) / 1000) : null,
        is_retry: runDirs.length > 1 && runDirs.indexOf(runDir) > 0,
      });
    }
  }

  rows.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  return rows;
}

module.exports = { buildTriageLog };
