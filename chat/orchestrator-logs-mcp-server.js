// Pull-based MCP server over the orchestrator's own run/ticket history.
//
// Replaces the old push model (chat/turn.sh used to paste the last 30 tasks + all-time
// totals into every single turn's prompt, whether or not the question needed it). Now
// turn.sh injects one short summary line, and this server lets the chat model pull full
// detail — a specific run, a specific artifact file, a pipeline ticket — only when it
// actually needs it. Read-only: it never writes to tasks.json/pipeline.json/artifacts/.
//
// Runs inside the chat container against bind-mounted copies of the orchestrator's own
// data (see lib/chat/container.js) at fixed /workspace/orch-data/* paths.

const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const DATA_DIR = '/workspace/orch-data';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const PIPELINE_FILE = path.join(DATA_DIR, 'pipeline.json');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

const ARTIFACT_FILE_ALLOWLIST = new Set([
  'transcript.jsonl', 'changes.diff', 'stdout.log', 'events.jsonl',
  'test-plan.json', 'validation.json', 'production-build.log', 'build.log', 'test.log',
]);

// --- Redaction -------------------------------------------------------------------
// Every string this server returns goes through this before leaving the process.
// Masks secrets that could otherwise leak verbatim through a log/diff/env value.
const REDACTIONS = [
  // JWT-shaped tokens (header.payload.signature, base64url segments).
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  // Bearer / Authorization header values.
  [/\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi, 'Bearer [REDACTED]'],
  [/(Authorization\s*:\s*)\S+/gi, '$1[REDACTED]'],
  // key=value / key: value pairs where the key name contains a secret-ish word (e.g.
  // MSSQL_PASSWORD, JIRA_API_TOKEN) — no anchor on the key's start, so a prefix doesn't
  // dodge the match. Keeps the key name and quoting, masks only the value.
  [/([\w.-]*(?:password|token|secret|api[_-]?key)[\w.-]*)(\s*[=:]\s*)("?)([^\s"',}]+)\3/gi, '$1$2$3[REDACTED]$3'],
  // AWS access key ids.
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  // GitLab / Anthropic prefixed tokens.
  [/glpat-[A-Za-z0-9_-]{10,}/g, '[REDACTED_GLPAT]'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, '[REDACTED_SK_ANT]'],
];

function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

// --- Small file helpers -----------------------------------------------------------

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function tailLines(text, n) {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function textResult(text) {
  return { content: [{ type: 'text', text: redact(text) }] };
}

function taskSummary(t) {
  return {
    id: t.id, type: t.task_type, status: t.status, mr: t.mr_iid || null,
    desc: String(t.description || '').slice(0, 120),
    cost: t.usage && t.usage.cost_usd != null ? t.usage.cost_usd : null,
    dur_min: t.duration_ms ? Math.round(t.duration_ms / 60000) : null,
    run: t.run_id || null, at: t.received_at || null,
  };
}

function ticketSummary(t) {
  return {
    id: t.id, stage: t.stage, status: t.status,
    title: t.title || String(t.initial_brief || '').slice(0, 120),
    jira_key: t.jira_key || null, mr_iid: t.mr_iid || null,
    blocked: !!t.blocked, blocked_reason: t.blocked_reason || null,
    created_at: t.created_at || null, updated_at: t.updated_at || null,
  };
}

// --- Server -------------------------------------------------------------------

const server = new McpServer({ name: 'orchestrator-logs', version: '1.0.0' });

server.tool(
  'list_runs',
  'List recent orchestrator task runs (summary rows), newest first. Use get_run for full detail on one.',
  { status: z.string().optional(), since: z.string().optional(), limit: z.number().int().optional() },
  async ({ status, since, limit }) => {
    const tasks = readJson(TASKS_FILE) || [];
    let rows = tasks.slice();
    if (status) rows = rows.filter(t => t.status === status);
    if (since) rows = rows.filter(t => (t.received_at || '') >= since);
    rows.sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')));
    const cap = Math.max(1, Math.min(limit || 20, 100));
    return textResult(JSON.stringify(rows.slice(0, cap).map(taskSummary), null, 2));
  },
);

server.tool(
  'get_run',
  'Get the full task record for one run_id/task id, plus its manifest.json if present.',
  { run_id: z.string() },
  async ({ run_id }) => {
    const tasks = readJson(TASKS_FILE) || [];
    const task = tasks.find(t => t.id === run_id || t.run_id === run_id);
    if (!task) return textResult(`No task found with id/run_id "${run_id}".`);
    const manifestPath = path.join(ARTIFACTS_DIR, task.run_id || run_id, 'manifest.json');
    const manifest = readJson(manifestPath);
    return textResult(JSON.stringify({ task, manifest }, null, 2));
  },
);

server.tool(
  'get_run_artifact',
  `Read the tail of one named artifact file for a run. Allowed files: ${[...ARTIFACT_FILE_ALLOWLIST].join(', ')}. Never returns the whole file — only the last tail_lines lines.`,
  { run_id: z.string(), file: z.string(), tail_lines: z.number().int().optional() },
  async ({ run_id, file, tail_lines: nLines }) => {
    if (file.includes('/') || file.includes('..') || !ARTIFACT_FILE_ALLOWLIST.has(file)) {
      return textResult(`"${file}" is not a readable artifact. Allowed: ${[...ARTIFACT_FILE_ALLOWLIST].join(', ')}.`);
    }
    const filePath = path.join(ARTIFACTS_DIR, run_id, file);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(ARTIFACTS_DIR) + path.sep)) {
      return textResult('Invalid run_id.');
    }
    if (!fs.existsSync(resolved)) return textResult(`No ${file} for run ${run_id}.`);
    const cap = Math.max(1, Math.min(nLines || 200, 2000));
    const content = fs.readFileSync(resolved, 'utf8');
    return textResult(tailLines(content, cap));
  },
);

server.tool(
  'list_pipeline_tickets',
  'List TDD pipeline tickets (summary rows), newest first. Use get_pipeline_ticket for full detail on one.',
  { status: z.string().optional(), limit: z.number().int().optional() },
  async ({ status, limit }) => {
    const tickets = readJson(PIPELINE_FILE) || [];
    let rows = tickets.slice();
    if (status) rows = rows.filter(t => t.status === status);
    rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const cap = Math.max(1, Math.min(limit || 20, 100));
    return textResult(JSON.stringify(rows.slice(0, cap).map(ticketSummary), null, 2));
  },
);

server.tool(
  'get_pipeline_ticket',
  'Get the full pipeline ticket record (all stage history, runs, gate results) for one ticket id.',
  { ticket_id: z.string() },
  async ({ ticket_id }) => {
    const tickets = readJson(PIPELINE_FILE) || [];
    const ticket = tickets.find(t => t.id === ticket_id);
    if (!ticket) return textResult(`No pipeline ticket found with id "${ticket_id}".`);
    return textResult(JSON.stringify(ticket, null, 2));
  },
);

server.tool(
  'tail_server_log',
  'Tail the orchestrator MCP/service logs (logs/ directory). NOTE: server.js console output itself is only captured here if the operator redirected it to a file under logs/ — this is whatever log files actually exist on disk, not a guarantee every orchestrator event is present.',
  { lines: z.number().int().optional(), file: z.string().optional() },
  async ({ lines: nLines, file }) => {
    if (!fs.existsSync(LOGS_DIR)) return textResult('No logs/ directory mounted.');
    const available = fs.readdirSync(LOGS_DIR).filter(f => fs.statSync(path.join(LOGS_DIR, f)).isFile());
    if (!available.length) return textResult('logs/ directory is empty.');
    const target = file && available.includes(file) ? file : available[0];
    if (file && !available.includes(file)) {
      return textResult(`"${file}" not found. Available log files: ${available.join(', ')}`);
    }
    const cap = Math.max(1, Math.min(nLines || 100, 1000));
    const content = fs.readFileSync(path.join(LOGS_DIR, target), 'utf8');
    return textResult(`=== ${target} (last ${cap} lines) ===\n${tailLines(content, cap)}`);
  },
);

const transport = new StdioServerTransport();
server.connect(transport);
