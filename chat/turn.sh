#!/usr/bin/env bash
# PER-TURN script. Invoked once per user message via `docker exec` into the
# already-running (warm) chat container booted by entrypoint.sh. The repo is
# already cloned at /workspace/repo and .mcp.json is already in place; this script
# only reads the turn's input, runs claude, and writes the reply. No clone here.
set -uo pipefail

IO_DIR="/workspace/io"
cd /workspace/repo || { echo '{"reply":null,"error":"repo checkout missing"}' > "$IO_DIR/reply.json"; exit 1; }

export GITLAB_TOKEN="$GLAB_TOKEN"
export GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"

# Read-only chat tools. Code changes go through the approved worker path.
ALLOWED_TOOLS="Read,Grep,Glob,\
Bash(git log*),Bash(git diff*),Bash(git show*),Bash(git status*),Bash(git branch*),\
Bash(git fetch*),Bash(git pull*),Bash(git checkout*),Bash(git switch*),Bash(git rev-parse*),Bash(git ls-remote*),Bash(git remote*),\
Bash(glab mr view*),Bash(glab mr diff*),Bash(glab mr list*),Bash(glab issue view*),Bash(glab issue list*),\
Bash(find*),Bash(grep*),Bash(ls*),Bash(cat*),Bash(head*),Bash(tail*),Bash(wc*),\
Bash(dotnet build*),Bash(dotnet test*),\
Bash(bash /root/.claude/skills/*),Bash(/root/.claude/skills/*),\
mcp__mssql__sql_query,mcp__mssql__get_database_info,mcp__mssql__check_permissions,\
mcp__jira__*,\
mcp__ragflow__*,\
mcp__teams-chat__*,\
mcp__orchestrator-logs__*"

MESSAGE=$(node -e "const d=JSON.parse(require('fs').readFileSync('$IO_DIR/input.json','utf8'));process.stdout.write(d.message||'')")
HISTORY=$(node -e "
const d=JSON.parse(require('fs').readFileSync('$IO_DIR/input.json','utf8'));
const h=(d.history||[]).map(e=>{
  if(e.role==='proposal') return 'PREVIOUSLY PROPOSED TASK: '+JSON.stringify(e.content);
  if(e.role==='approved') return 'USER APPROVED: '+JSON.stringify(e.content);
  return (e.role==='user'?'USER: ':'YOU: ')+String(e.content||'').slice(0,2000);
}).join('\n\n');
process.stdout.write(h);
")
# One-line summary only — full task/pipeline detail used to be pasted into every single
# turn's prompt (last 30 tasks + all-time totals), whether or not the question needed it.
# That cost real tokens on every turn regardless of relevance, and on a --resume'd session
# it permanently bloats the conversation history from then on. The orchestrator-logs MCP
# tool (mcp__orchestrator-logs__*) now covers the pull side: list_runs/get_run/
# get_run_artifact/list_pipeline_tickets/get_pipeline_ticket/tail_server_log.
DATA_BLOCK=$(node -e "
const d=JSON.parse(require('fs').readFileSync('$IO_DIR/input.json','utf8'));
const tasks=d.tasks||[];
const active=tasks.filter(t=>t.status==='pending'||t.status==='running').length;
const totals=d.totals||{};
const cost=totals.cost_usd!=null?('\$'+Number(totals.cost_usd).toFixed(2)):'unknown';
process.stdout.write(
  \`\${active} active task(s), \${tasks.length} recent task(s) in the local snapshot, \` +
  \`all-time cost \${cost}. Call the orchestrator-logs MCP tool (list_runs, get_run, \` +
  \`get_run_artifact, list_pipeline_tickets, get_pipeline_ticket, tail_server_log) for \` +
  \`run/ticket detail — this summary is not itself a data source.\`
);
")

# Fresh prompt: current data and history only; stable instructions are explicit CLI context. Used on the first turn of a claude
# session, or fallback after a failed resume.
FULL_PROMPT="$DATA_BLOCK

=== CONVERSATION SO FAR ===
${HISTORY:-(this is the first message)}

=== USER'S CURRENT MESSAGE ===
$MESSAGE"

# RESUME prompt — lean. The claude session already holds the full conversation (every
# message, tool call, and file read), so we DON'T re-inject history or the full rules.
# Refresh live data and the new message; the output contract is in static context.
LEAN_PROMPT="Continue the conversation. Below is the CURRENT orchestrator data (it may have
changed since earlier turns — use these values, ignore older snapshots). Keep following the
loaded chat instructions and output contract.

$DATA_BLOCK

=== USER'S CURRENT MESSAGE ===
$MESSAGE"

INSTRUCTION_ROLE=chat
source /context/claude-options.sh
RESUME_SESSION_ID="${RESUME_SESSION_ID:-}"

run_claude() {
  # $1 = prompt ; $2 = resume session id (empty for a fresh session)
  if [ -n "$2" ]; then
    claude -p "$1" "${CLAUDE_CONTEXT_OPTIONS[@]}" --disallowedTools "Task,Agent,Write,Edit" --allowedTools "$ALLOWED_TOOLS" --model "$CHAT_MODEL" \
      --resume "$2" --output-format stream-json --verbose 2>"$IO_DIR/chat-stderr.log"
  else
    claude -p "$1" "${CLAUDE_CONTEXT_OPTIONS[@]}" --disallowedTools "Task,Agent,Write,Edit" --allowedTools "$ALLOWED_TOOLS" --model "$CHAT_MODEL" \
      --output-format stream-json --verbose 2>"$IO_DIR/chat-stderr.log"
  fi
}

run_streamed_claude() {
  rm -f "$IO_DIR/last-raw.json"
  run_claude "$1" "$2" | node /stream-events.js
  return "${PIPESTATUS[0]}"
}

if [ -n "$RESUME_SESSION_ID" ]; then
  echo "🤖 chat turn (model: ${CHAT_MODEL}, resume: ${RESUME_SESSION_ID})"
  run_streamed_claude "$LEAN_PROMPT" "$RESUME_SESSION_ID"
  CLAUDE_EXIT=$?
  if [ $CLAUDE_EXIT -ne 0 ]; then
    # Session is gone (container was killed/rebooted) or resume failed — start fresh and
    # replay the transcript so continuity is preserved (lossily) rather than dropped.
    echo "⚠️  resume failed (exit $CLAUDE_EXIT); falling back to a fresh session" >&2
    echo 'CHAT_ACTIVITY:{"phase":"reset"}'
    run_streamed_claude "$FULL_PROMPT" ""
    CLAUDE_EXIT=$?
  fi
else
  echo "🤖 chat turn (model: ${CHAT_MODEL}, fresh session)"
  run_streamed_claude "$FULL_PROMPT" ""
  CLAUDE_EXIT=$?
fi

# Extract the assistant's text, then pull the JSON object out of it. The model is asked
# for bare JSON but may still fence it, so tolerate that rather than failing the turn.
node <<'NODE' > "$IO_DIR/reply.json"
const fs = require('fs');
let out = { reply: null };
try {
  const raw = fs.readFileSync('/workspace/io/last-raw.json', 'utf8');
  let text = raw;
  try {
    const env = JSON.parse(raw);
    text = env.result || env.text || raw;
  } catch { /* not the json envelope; treat as text */ }

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

  if (parsed && typeof parsed.reply === 'string') {
    out = { reply: parsed.reply, proposed_task: parsed.proposed_task || null, pipeline_ticket: parsed.pipeline_ticket || null };
  } else if (cleaned) {
    // Model ignored the contract — surface its prose rather than erroring out.
    out = { reply: cleaned.slice(0, 6000), proposed_task: null };
  }
} catch (e) {
  out = { reply: null, error: String(e.message || e) };
}
fs.writeFileSync('/dev/stdout', JSON.stringify(out));
NODE

if [ ! -s "$IO_DIR/reply.json" ]; then
  printf '{"reply":null,"error":"no reply produced","exit":%s}' "$CLAUDE_EXIT" > "$IO_DIR/reply.json"
fi

echo "✅ chat turn done (exit $CLAUDE_EXIT)"
