const fs = require('fs');
const path = require('path');

const { loadPipeline } = require('../pipeline-store');

// Deliberately no phase classification, no cost estimate, no aggregation — just
// "what did it just do, in order." Triage is read-only and short-lived, so a plain
// chronological feed of tool calls (+ the model's own text/thinking in between) is
// enough to diagnose a slow or stuck run; the turns page's discovery/edit/build_test
// buckets exist for a code-writing agent and don't map onto triage's tool mix
// (Read/Grep/SQL/MCP calls, no Edit/Write, no git commit).
function summarizeInput(name, input) {
  if (!input) return '';
  if (name === 'Bash') return (input.command || '').replace(/\s+/g, ' ').slice(0, 160);
  if (input.file_path) return input.file_path;
  if (input.pattern) return input.pattern;
  if (input.sql) return input.sql.replace(/\s+/g, ' ').slice(0, 200);
  if (input.ref) return input.ref;
  if (input.query) return input.query;
  return JSON.stringify(input).slice(0, 160);
}

function resultText(content) {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

// Walks transcript.jsonl in order, emitting one step per text/thinking block and
// one per tool_use block — tool_result content is filled in once its matching
// user-role line shows up later in the file (may still be null on the very last
// step, for a tool call that's still executing when this reads the file).
function parseLiveTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return [];
  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  const steps = [];
  const byToolUseId = new Map();

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'assistant' && obj.message) {
      for (const block of (obj.message.content || [])) {
        if (block.type === 'text' && block.text?.trim()) {
          steps.push({ kind: 'text', text: block.text.trim() });
        } else if (block.type === 'thinking' && block.thinking?.trim()) {
          steps.push({ kind: 'thinking', text: block.thinking.trim() });
        } else if (block.type === 'tool_use') {
          const step = {
            kind: 'tool_call', id: block.id, name: block.name,
            detail: summarizeInput(block.name, block.input),
            result: null, is_error: false, timestamp: obj.timestamp || null,
          };
          steps.push(step);
          byToolUseId.set(block.id, step);
        }
      }
    } else if (obj.type === 'user' && obj.message) {
      const content = Array.isArray(obj.message.content) ? obj.message.content : [];
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const step = byToolUseId.get(block.tool_use_id);
        if (!step) continue;
        step.result = resultText(block.content);
        step.is_error = !!block.is_error;
      }
    }
  }
  return steps;
}

// Only the run(s) still in progress — a triage container with a task.json on disk
// but no result.json/error.json yet. Cheap enough to poll every few seconds since
// there are only ever 0-2 of these at once.
function buildLiveTriageRuns() {
  const tickets = loadPipeline();
  const live = [];

  for (const ticket of tickets) {
    const runDirs = ticket.runs?.triage_run_dirs
      || (ticket.runs?.triage_run_dir ? [ticket.runs.triage_run_dir] : []);
    if (!runDirs.length) continue;

    const runDir = runDirs[runDirs.length - 1];
    const hasFinished = fs.existsSync(path.join(runDir, 'result.json')) || fs.existsSync(path.join(runDir, 'error.json'));
    if (hasFinished || !fs.existsSync(path.join(runDir, 'task.json'))) continue;

    live.push({
      run_id: path.basename(runDir),
      ticket_id: ticket.id,
      ticket_title: ticket.title,
      steps: parseLiveTranscript(path.join(runDir, 'transcript.jsonl')),
    });
  }
  return live;
}

module.exports = { buildLiveTriageRuns };
