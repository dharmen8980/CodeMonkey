FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    wget \
    libicu-dev \
    python3 \
    python3-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# .NET SDK — the chat agent reads and builds nothing, but `dotnet` lets it answer
# "does this compile" style questions without a second image.
RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && chmod +x dotnet-install.sh \
    && ./dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && rm dotnet-install.sh

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${PATH}:/usr/share/dotnet"

ARG CLAUDE_CODE_VERSION=2.1.268
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Pre-install the MSSQL MCP server into the image so the container's first DB question
# doesn't pay an `npx` download. `npx -y @vat-mcp/mssql-service` then resolves the
# already-present global copy instead of hitting the network.
RUN npm install -g @vat-mcp/mssql-service || true

RUN ARCH=$(dpkg --print-architecture) && \
    curl -sL "https://gitlab.com/gitlab-org/cli/-/releases/v1.52.0/downloads/glab_1.52.0_linux_${ARCH}.deb" -o glab.deb && \
    dpkg -i glab.deb && \
    rm glab.deb

WORKDIR /workspace

# mcp-atlassian — Jira (and Confluence) MCP server, API-token auth against Jira Cloud.
# Use a venv because Debian's system Python is externally managed. READ_ONLY_MODE
# is set at entrypoint time in .mcp.json.
RUN python3 -m venv /opt/mcp-atlassian/.venv \
    && /opt/mcp-atlassian/.venv/bin/pip install --no-cache-dir mcp-atlassian

# teams-chat — read-only search over an exported Teams standup chat, bind-mounted at
# runtime (see lib/chat/container.js). Supplementary team-discussion context only; it
# is not a requirements source, RAGFlow stays authoritative for that (see CLAUDE.md).
RUN python3 -m venv /opt/teams-chat-mcp/.venv \
    && /opt/teams-chat-mcp/.venv/bin/pip install --no-cache-dir "mcp>=1.2.0,<2"
COPY chat/teams-chat-mcp-server.py /opt/teams-chat-mcp/server.py

# orchestrator-logs — pull-based access to the orchestrator's own tasks.json/pipeline.json/
# artifacts/logs (bind-mounted read-only, see lib/chat/container.js), so turn.sh no longer
# has to paste the last-30-tasks + totals block into every single turn's prompt.
RUN mkdir -p /opt/orchestrator-logs-mcp && cd /opt/orchestrator-logs-mcp \
    && npm init -y >/dev/null \
    && npm install --no-audit --no-fund @modelcontextprotocol/sdk zod
COPY chat/orchestrator-logs-mcp-server.js /opt/orchestrator-logs-mcp/server.js

# Each entrypoint installs its own context/skill and removes other role assets.
COPY instructions/ /opt/orchestrator-context/instructions/
COPY context/ /context/
COPY chat/write-mcp-config.sh /write-mcp-config.sh
COPY chat/entrypoint.sh /entrypoint.sh
COPY chat/turn.sh /turn.sh
COPY chat/stream-events.js /stream-events.js
# One-shot triage variant for the autonomous ticket pipeline — same image, invoked via
# `docker run --entrypoint /triage-entrypoint.sh` instead of the default ENTRYPOINT
# below, so the long-lived chat feature (entrypoint.sh, never sleep infinity here) is
# untouched.
COPY chat/triage-entrypoint.sh /triage-entrypoint.sh
RUN chmod +x /entrypoint.sh /turn.sh /triage-entrypoint.sh /write-mcp-config.sh

# entrypoint.sh boots + idles; each turn is a `docker exec ... bash /turn.sh`.
ENTRYPOINT ["/entrypoint.sh"]
