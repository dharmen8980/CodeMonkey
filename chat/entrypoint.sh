#!/usr/bin/env bash
# BOOT script for the long-lived chat container.
#
# This runs ONCE when the container starts. It clones the repo and writes the MCP
# config, then idles forever (`sleep infinity`). Each conversational turn is a
# separate `docker exec ... bash /turn.sh` into this same warm container — so the
# repo is cloned once per container, not once per message. The container only exits
# when the orchestrator does `docker rm -f` (the UI "Kill agent" button).
set -uo pipefail

IO_DIR="/workspace/io"          # bind-mounted from the host session dir (rw)
mkdir -p "$IO_DIR"
rm -f "$IO_DIR/ready" "$IO_DIR/boot-error"

# Read-only clone identity — this container never writes to the repo.
git config --global user.name "Code-Monkey Chat"
git config --global user.email "code-monkey@dev.local"
export GITLAB_TOKEN="$GLAB_TOKEN"
export GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"

CLONE_START=$(date +%s)
if git clone -q --depth 50 "$REPO_URL" /workspace/repo 2>"$IO_DIR/clone-stderr.log"; then
  CLONE_END=$(date +%s)
  echo "📦 cloned in $((CLONE_END - CLONE_START))s"
else
  echo "clone failed — see clone-stderr.log" > "$IO_DIR/boot-error"
  echo "❌ clone failed"
  # Idle anyway so the host can read boot-error and surface it, then reap us.
  exec sleep infinity
fi

# MCP server for schema/data questions. Dev instance, mock data. DDL/DROP/DELETE are
# disabled at the server; SELECT/UPDATE/INSERT are possible, so the turn prompt
# requires approval before any write. Written once into the repo dir claude runs from.
source /write-mcp-config.sh
write_mcp_config /workspace/repo

# Assemble before idling: every later turn uses this container's chat-only context.
if ! node /context/install-role.js chat "$IO_DIR"; then
  echo "instruction assembly failed; rebuild ai-chat" > "$IO_DIR/boot-error"
  exit 1
fi

# Signal readiness to the host (which is polling for this file), then idle.
echo "ready" > "$IO_DIR/ready"
echo "✅ chat container ready — awaiting turns (docker exec bash /turn.sh)"
exec sleep infinity
