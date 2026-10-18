#!/usr/bin/env bash
# ONE-SHOT triage container for the autonomous ticket pipeline. Overrides the ai-chat
# image's default entrypoint (chat/entrypoint.sh is untouched — the long-lived chat
# feature can't be affected by this). Clones the repo, writes the same read-only MCP
# config chat uses, runs ONE claude -p call that verifies a ticket against the actual
# codebase (never trusts ticket text at face value, even for a real Jira ticket), and
# writes a structured result to /workspace/_artifacts/result.json before exiting.
set -uo pipefail

ARTIFACTS_DIR="/workspace/_artifacts"
mkdir -p "$ARTIFACTS_DIR"

git config --global user.name "Code-Monkey Triage"
git config --global user.email "code-monkey@dev.local"
export GITLAB_TOKEN="$GLAB_TOKEN"
export GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"

if ! git clone -q --depth 50 "$REPO_URL" /workspace/repo 2>"$ARTIFACTS_DIR/clone-stderr.log"; then
  echo "{\"error\":\"clone failed\"}" > "$ARTIFACTS_DIR/error.json"
  echo "❌ triage clone failed"
  exit 1
fi

source /write-mcp-config.sh
write_mcp_config /workspace/repo
cd /workspace/repo

INSTRUCTION_ROLE=triage
node /context/install-role.js triage "$ARTIFACTS_DIR" || exit 1
source /context/claude-options.sh

# Same read-only surface chat/turn.sh grants — no Write/Edit, no git commit/push, glab
# restricted to reads (triage never needs to write anywhere; nothing here should).
ALLOWED_TOOLS="Read,Grep,Glob,\
Bash(git log*),Bash(git diff*),Bash(git show*),Bash(git status*),Bash(git branch*),\
Bash(find*),Bash(grep*),Bash(ls*),Bash(cat*),Bash(head*),Bash(tail*),Bash(wc*),\
Bash(glab mr view*),Bash(glab mr diff*),Bash(glab mr list*),Bash(glab issue view*),\
Bash(bash /root/.claude/skills/*),Bash(/root/.claude/skills/*),\
mcp__mssql__sql_query,mcp__mssql__get_database_info,mcp__mssql__check_permissions,\
mcp__jira__*,\
mcp__ragflow__*"

TRIAGE_PROMPT="Role: triage. Read /workspace/task.json for the ticket, prior findings, and any human clarification or retry guidance. Follow the loaded triage skill and return its JSON result."

# stream-json (not the buffered "json" format) so that a timeout kill mid-call still
# leaves everything Claude did up to that point on disk in transcript.jsonl, instead
# of the whole response vanishing with the shell variable it would otherwise sit in
# unwritten. Mirrors entrypoint-lib/implement-phase.sh's stream+tee pattern.
TRANSCRIPT_FILE="$ARTIFACTS_DIR/transcript.jsonl"
TRIAGE_PROMPT="$TRIAGE_PROMPT" node -e 'require("fs").writeFileSync("/workspace/_artifacts/transcript.jsonl",JSON.stringify({type:"prompt",prompt:process.env.TRIAGE_PROMPT})+"\n")'
# Triage is read-only investigation, not implementation — a normal run costs well under
# $1. --max-budget-usd is a cheap independent backstop against runaway generation (e.g. a
# degenerate tool-call loop) racking up cache-read cost for 20 minutes before the
# orchestrator's own stall watchdog (lib/pipeline/spawn-triage.js) catches it.
claude -p "$TRIAGE_PROMPT" "${CLAUDE_CONTEXT_OPTIONS[@]}" --disallowedTools "Task,Agent,Write,Edit" --allowedTools "$ALLOWED_TOOLS" --output-format stream-json --verbose --model "${CHAT_MODEL:-us.anthropic.claude-sonnet-4-5-20250929-v1:0}" --max-budget-usd "${TRIAGE_MAX_BUDGET_USD:-3}" \
  2>"$ARTIFACTS_DIR/claude-stderr.log" | tee -a "$TRANSCRIPT_FILE" > "$ARTIFACTS_DIR/last-raw.json"
CLAUDE_EXIT=${PIPESTATUS[0]}

node <<'NODE'
const fs = require('fs');
try {
  const lines = fs.readFileSync('/workspace/_artifacts/last-raw.json', 'utf8').trim().split('\n');
  let text = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'result') { text = obj.result || obj.text || ''; break; }
    } catch { /* not a JSON line, keep scanning backwards */ }
  }

  let cleaned = String(text).trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch {}
    }
  }

  if (parsed && typeof parsed.brief === 'string') {
    fs.writeFileSync('/workspace/_artifacts/result.json', JSON.stringify(parsed, null, 2));
  } else {
    fs.writeFileSync('/workspace/_artifacts/error.json', JSON.stringify({ error: 'could not parse triage output', raw: cleaned.slice(0, 4000) }));
  }
} catch (e) {
  fs.writeFileSync('/workspace/_artifacts/error.json', JSON.stringify({ error: String(e.message || e) }));
}
NODE

echo "✅ triage finished (exit $CLAUDE_EXIT)"
exit $CLAUDE_EXIT
