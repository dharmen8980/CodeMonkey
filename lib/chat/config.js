const fs = require('fs');
const path = require('path');

// ============================================================================
// Chat sessions
//
// A chat container is LONG-LIVED and session-scoped: booted on the first message
// and kept warm across turns. The repo is cloned once at boot (entrypoint.sh),
// then every turn is a `docker exec ... bash /turn.sh` into the same container —
// no re-clone, no cold start per message. The container does NOT die on idle; it
// exits only when the operator hits "Kill agent" in the UI (POST /chat/kill) or
// the server explicitly reaps it. It still has NO authority to change repo files
// (no Write/Edit, no git commit/push); code changes go through propose→approve→worker.
// History lives here on disk, not in the container, so a kill never loses the thread.
// ============================================================================

const ORCHESTRATOR_ROOT = path.join(__dirname, '..', '..');
const CHAT_DIR = path.join(ORCHESTRATOR_ROOT, 'chats');
// Bind-mounted read-only into every chat container for the orchestrator-logs MCP server
// (chat/orchestrator-logs-mcp-server.js) — always mounted, unlike teams-chat's optional
// TEAMS_CHAT_EXPORT_DIR, since this data always exists locally in this repo.
const ORCH_DATA_MOUNTS = {
  tasksFile: path.join(ORCHESTRATOR_ROOT, 'tasks.json'),
  pipelineFile: path.join(ORCHESTRATOR_ROOT, 'pipeline.json'),
  artifactsDir: path.join(ORCHESTRATOR_ROOT, 'artifacts'),
  logsDir: path.join(ORCHESTRATOR_ROOT, 'logs'),
};
const CHAT_TURN_TIMEOUT_MS = 5 * 60 * 1000;    // per-turn claude exec ceiling
const CHAT_BOOT_TIMEOUT_MS = 3 * 60 * 1000;    // clone + ready can be slow on a cold image
// Safety rail only — each live container is ~2GB. Containers are manual-kill, so this
// caps how many can accumulate, not how long any one lives.
const CHAT_MAX_SESSIONS = 4;
const CHAT_MAX_MESSAGE_LEN = 8000;
const CHAT_IMAGE = 'ai-chat';
// Durable per-turn cost ledger. last-raw.json is overwritten every turn, so we append
// each turn's cost here (one JSON line per turn) the moment the turn finishes.
const CHAT_USAGE_FILE = path.join(CHAT_DIR, 'usage.jsonl');

// Selectable chat model tiers. The UI sends a KEY (haiku|sonnet|opus); the server maps
// it to the actual --model id. Defaults follow the account's observed 'us.anthropic.*'
// form (same as CHAT_MODEL); override any of them in .env for your Bedrock profiles.
const CHAT_MODELS = {
  haiku:  process.env.CHAT_MODEL_HAIKU  || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: process.env.CHAT_MODEL_SONNET || process.env.CHAT_MODEL || 'us.anthropic.claude-sonnet-5',
  opus:   process.env.CHAT_MODEL_OPUS   || 'us.anthropic.claude-opus-4-8',
};
const CHAT_MODEL_DEFAULT_KEY = 'sonnet';
// Resolve a UI key → model id, falling back to the default tier for anything unknown.
function resolveChatModel(key) {
  return CHAT_MODELS[String(key)] || CHAT_MODELS[CHAT_MODEL_DEFAULT_KEY];
}

if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true });

// chatId is always a 16-hex string (generateRunId / validated at the route). The
// container name is interpolated into shell `exec` calls, so keep it strictly hex.
function chatContainerName(chatId) {
  return `ai-chat-${chatId}`;
}

function chatPath(chatId, file) {
  return path.join(CHAT_DIR, chatId, file);
}

function chatEnvFile() {
  return [
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
    `CLAUDE_CODE_USE_BEDROCK=${process.env.CLAUDE_CODE_USE_BEDROCK || ''}`,
    `AWS_REGION=${process.env.AWS_REGION || 'us-east-1'}`,
    `AWS_BEARER_TOKEN_BEDROCK=${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
    `GLAB_TOKEN=${process.env.CHAT_GLAB_TOKEN || process.env.GLAB_TOKEN}`,
    `GITLAB_HOST=${process.env.GITLAB_HOST || 'gitlab.com'}`,
    `REPO_URL=${process.env.REPO_URL}`,
    `CHAT_MODEL=${process.env.CHAT_MODEL || 'us.anthropic.claude-sonnet-5'}`,
    `MSSQL_SERVER=${process.env.MSSQL_SERVER || ''}`,
    `MSSQL_PORT=${process.env.MSSQL_PORT || '1433'}`,
    `MSSQL_USER=${process.env.MSSQL_USER || ''}`,
    `MSSQL_PASSWORD=${process.env.MSSQL_PASSWORD || ''}`,
    `MSSQL_DATABASE=${process.env.MSSQL_DATABASE || ''}`,
    `MSSQL_SCHEMA=${process.env.MSSQL_SCHEMA || 'dbo'}`,
    `MSSQL_ENCRYPT=${process.env.MSSQL_ENCRYPT || 'true'}`,
    `MSSQL_TRUST_SERVER_CERTIFICATE=${process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'false'}`,
    `ALLOW_DDL=false`,
    `ALLOW_DROP=false`,
    `ALLOW_DELETE=false`,
    `JIRA_URL=${process.env.JIRA_URL || ''}`,
    `JIRA_USERNAME=${process.env.JIRA_USERNAME || ''}`,
    `JIRA_API_TOKEN=${process.env.JIRA_API_TOKEN || ''}`,
    // Scopes the Jira MCP server to one project/board (comma-separated project keys),
    // Scope the chat agent to the configured Jira board.
    `JIRA_PROJECTS_FILTER=${process.env.JIRA_PROJECTS_FILTER || ''}`,
    // RAGFlow's own MCP server (self-host mode bakes its API key into the server
    // process on the RAGFlow host, so no token is needed on this side) — see
    // chat/entrypoint.sh's .mcp.json for how this is consumed.
    `RAGFLOW_MCP_URL=${process.env.RAGFLOW_MCP_URL || ''}`,
    `TEAMS_CHAT_EXPORT_DIR=${process.env.TEAMS_CHAT_EXPORT_DIR ? '/workspace/exports' : ''}`,
    // Supplementary, non-authoritative team-discussion context — see chat/teams-chat-mcp-server.py.
    // Fixed container-side path; the host export dir is bind-mounted there by container.js
    // only when TEAMS_CHAT_EXPORT_DIR is set on the host.
    `TEAMS_CHAT_EXPORT_PATH=/workspace/exports/${process.env.TEAMS_CHAT_LABEL || 'Team Chat'}.json`,
    `TEAMS_CHAT_LABEL=${process.env.TEAMS_CHAT_LABEL || 'Team Chat'}`,
  ].join('\n');
}

module.exports = {
  CHAT_DIR, CHAT_TURN_TIMEOUT_MS, CHAT_BOOT_TIMEOUT_MS, CHAT_MAX_SESSIONS,
  CHAT_MAX_MESSAGE_LEN, CHAT_IMAGE, CHAT_USAGE_FILE, CHAT_MODELS, CHAT_MODEL_DEFAULT_KEY,
  ORCH_DATA_MOUNTS,
  resolveChatModel, chatContainerName, chatPath, chatEnvFile,
};
