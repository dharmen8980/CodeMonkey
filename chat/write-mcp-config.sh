#!/usr/bin/env bash
# Generate only the MCP servers configured for this installation.
write_mcp_config() {
  MCP_CONFIG_DIR="$1" node <<'NODE'
const fs = require('fs');
const path = require('path');
const e = process.env;
const mcpServers = {
  'orchestrator-logs': { command: 'node', args: ['/opt/orchestrator-logs-mcp/server.js'] },
};
if (e.MSSQL_SERVER) mcpServers.mssql = {
  command: 'npx', args: ['-y', '@vat-mcp/mssql-service'],
  env: Object.fromEntries(['MSSQL_SERVER', 'MSSQL_PORT', 'MSSQL_USER', 'MSSQL_PASSWORD',
    'MSSQL_DATABASE', 'MSSQL_SCHEMA', 'MSSQL_ENCRYPT', 'MSSQL_TRUST_SERVER_CERTIFICATE']
    .map(k => [k, e[k] || '']).concat([['ALLOW_DDL', 'false'], ['ALLOW_DROP', 'false'], ['ALLOW_DELETE', 'false']])),
};
if (e.JIRA_URL) mcpServers.jira = {
  command: '/opt/mcp-atlassian/.venv/bin/mcp-atlassian',
  env: Object.fromEntries(['JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN', 'JIRA_PROJECTS_FILTER']
    .map(k => [k, e[k] || '']).concat([['READ_ONLY_MODE', 'true']])),
};
if (e.RAGFLOW_MCP_URL) mcpServers.ragflow = { type: 'sse', url: e.RAGFLOW_MCP_URL };
if (e.TEAMS_CHAT_EXPORT_DIR) mcpServers['teams-chat'] = {
  command: '/opt/teams-chat-mcp/.venv/bin/python', args: ['/opt/teams-chat-mcp/server.py'],
  env: { TEAMS_CHAT_EXPORT_PATH: e.TEAMS_CHAT_EXPORT_PATH,
    TEAMS_CHAT_LABEL: e.TEAMS_CHAT_LABEL || 'Team Chat' },
};
fs.writeFileSync(path.join(e.MCP_CONFIG_DIR, '.mcp.json'), JSON.stringify({ mcpServers }, null, 2));
NODE
}
