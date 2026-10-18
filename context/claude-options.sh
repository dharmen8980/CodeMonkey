if [ ! -s /root/.claude/instructions.md ]; then
  echo 'Role instructions are missing; refusing to launch Claude.' >&2
  exit 1
fi
CLAUDE_CONTEXT_OPTIONS=(--disable-slash-commands --setting-sources ""
  --append-system-prompt "$(cat /root/.claude/instructions.md)"
  --strict-mcp-config)
# Chat has no artifact mount to grant Claude. Its /workspace/io mount contains
# per-session credentials, so only worker and triage roles add their artifact dir.
if [ "$INSTRUCTION_ROLE" != "chat" ]; then
  CLAUDE_CONTEXT_OPTIONS+=(--add-dir "$ARTIFACTS_DIR")
fi
# Workers have no MCPs; chat/triage receive only the explicitly generated config.
if [ "$INSTRUCTION_ROLE" = "chat" ] || [ "$INSTRUCTION_ROLE" = "triage" ]; then
  CLAUDE_CONTEXT_OPTIONS+=(--mcp-config /workspace/repo/.mcp.json)
else
  CLAUDE_CONTEXT_OPTIONS+=(--mcp-config '{"mcpServers":{}}')
fi
