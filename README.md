# CodeMonkey

A self-hosted GitLab task orchestrator. It receives tasks and MR webhooks, launches Claude Code workers in Docker, records runs, and offers a web dashboard, chat, and an optional acceptance pipeline.

This repository contains the reusable application only. Runtime state is created locally in `tasks.json`, `pipeline.json`, `artifacts/`, `chats/`, and `logs/`; all are ignored by Git. Edit the role templates in `instructions/` for your own repository. No worker starts until you configure credentials and request a task.

## Setup

1. Copy `.env.example` to `.env` and set the target `REPO_URL`, `GITLAB_PROJECT_PATH`, `TARGET_BRANCH`, GitLab tokens, `WEBHOOK_SECRET`, `CHAT_TOKEN`, and an Anthropic API key or Bedrock credentials. `GITLAB_PROJECT_PATH` is the GitLab namespace and project name, such as `my-group/my-app`. `REPO_URL` must be cloneable from the worker containers.
2. Review the six files in `instructions/` and replace the generic text with the target repository's delivery rules. Repository files such as `AGENTS.md` and `CLAUDE.md` are also read by workers.
3. Run `./start.sh`. It builds the worker and chat Docker images, initializes empty runtime state, and starts the server at `http://localhost:3333`.

The browser dashboard is at `/turns`. The pipeline board is at `/pipeline`. API and webhooks require `WEBHOOK_SECRET`; the browser login uses `CHAT_USER` and `CHAT_TOKEN`.

## Pipeline scope

The acceptance pipeline currently uses `dotnet build`, `dotnet test`, and TRX results. Before submitting pipeline tickets, set `DOTNET_SOLUTION`, `DOTNET_PRODUCTION_PROJECT`, and `TEST_PROJECT_PREFIX` in `.env`. The prefix is the repository-relative test directory, including the trailing slash, such as `tests/`. Ordinary tasks and chat do not require these settings. The final end-to-end verdict is a manual gate in the pipeline board.

The acceptance pipeline also expects a working SonarQube project and scanner webhook; set `SONAR_HOST_URL`, `SONAR_TOKEN`, and `SONAR_PROJECT_KEY` for that workflow. Jira, RAGFlow, MSSQL, Teams exports, and Teams notifications are optional. The chat image adds only MCP servers with configured connection details.

## Local checks

```bash
node scripts/verify-pipeline-flow.js
node scripts/verify-ui-assets.js
node scripts/verify-theme.js
```

The checks use local fixtures and do not contact GitLab or launch containers.
