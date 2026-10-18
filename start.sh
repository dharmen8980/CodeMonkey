#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build Docker images
echo "🔨 Building AI agent (worker) Docker image..."
docker build -t ai-agent "$SCRIPT_DIR"

echo "🔨 Building AI chat Docker image..."
docker build -t ai-chat -f "$SCRIPT_DIR/chat/Dockerfile" "$SCRIPT_DIR"

# Ensure tasks.json exists, but NEVER wipe it — it's the operational log the dashboard
# reads, and server.js reconciles it against artifacts/ on startup anyway.
[ -f "$SCRIPT_DIR/tasks.json" ] || echo "[]" > "$SCRIPT_DIR/tasks.json"
[ -f "$SCRIPT_DIR/pipeline.json" ] || echo "[]" > "$SCRIPT_DIR/pipeline.json"
mkdir -p "$SCRIPT_DIR/artifacts" "$SCRIPT_DIR/chats" "$SCRIPT_DIR/logs"

# Start orchestrator
echo "🚀 Starting orchestrator..."
node "$SCRIPT_DIR/server.js"
