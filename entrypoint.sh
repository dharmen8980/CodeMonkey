#!/bin/bash
set -e

# Capture all raw stdout/stderr to the mounted volume (kill-safe)
exec > >(tee -a /workspace/_artifacts/stdout.log) 2>&1

START_TIME=$(date +%s)

echo "🚀 Code-Monkey starting..."
echo "   Task type: $TASK_TYPE"
# REPO_URL embeds an oauth2:<token>@ credential - never print it. stdout.log is
# captured to the mounted artifacts dir below and has been committed to git before.
echo "   Repo: ${REPO_URL#*@}"
echo "   Run ID: $RUN_ID"

# Configure glab
export GITLAB_TOKEN="$GLAB_TOKEN"
export GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"

# Clone the repo
CLONE_START=$(date +%s)
git clone "$REPO_URL" /workspace/repo
cd /workspace/repo
CLONE_END=$(date +%s)

if [ -n "$MR_BRANCH" ]; then
    git checkout "$MR_BRANCH"
fi
# Harness Pro's GitCommit tool reads the mounted checkout, but does not see the
# entrypoint's global Git config. Set the worker author on the checkout itself
# before either agent engine starts, so agents never have to choose an identity.
git config --local user.name "Code-Monkey"
git config --local user.email "code-monkey@dev.local"
test "$(git config --local --get user.name)" = "Code-Monkey"
test "$(git config --local --get user.email)" = "code-monkey@dev.local"
ARTIFACTS_DIR="/workspace/_artifacts"
PIPELINE_RUN=$(node -e "const d=require('/workspace/task.json');process.stdout.write(d.pipeline_context?'1':'0')")
case "$TASK_TYPE" in
    unit-test) INSTRUCTION_ROLE=unit-test ;;
    review-feedback)
        if [ "$PIPELINE_RUN" = "1" ]; then INSTRUCTION_ROLE=implement; else INSTRUCTION_ROLE=review-feedback; fi ;;
    new-task) INSTRUCTION_ROLE=new-task ;;
    *) echo "Unsupported worker role: $TASK_TYPE" >&2; exit 1 ;;
esac
node /context/install-role.js "$INSTRUCTION_ROLE" "$ARTIFACTS_DIR"
node /entrypoint-lib/prepare-context.js
source /entrypoint-lib/implement-prompts.sh
source /context/claude-options.sh
source /entrypoint-lib/prompt-standards.sh
source /entrypoint-lib/implement-phase.sh
build_implement_prompt
run_implement_phase
