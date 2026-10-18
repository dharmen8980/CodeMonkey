# Invokes claude with $IMPLEMENT_PROMPT, captures the git diff of whatever it did,
# writes usage.json, prints the USAGE_START/END markers server.js parses, and exits
# with claude's own exit code. Requires build_implement_prompt to have already set
# $IMPLEMENT_PROMPT/$IMPLEMENT_MODEL, and $START_TIME/$CLONE_START/$CLONE_END to
# already be set by entrypoint.sh.
run_implement_phase() {
    RUN_START_COMMIT=$(git -C /workspace/repo rev-parse HEAD)
    CLAUDE_START=$(date +%s)
    echo "{\"type\":\"implement_call_started\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"run_id\":\"$RUN_ID\",\"model\":\"$IMPLEMENT_MODEL\",\"engine\":\"claude-cli\"}" >> "$ARTIFACTS_DIR/events.jsonl"

    TRANSCRIPT_FILE="$ARTIFACTS_DIR/transcript.jsonl"

    # Keep the exact dynamic prompt with the transcript. Static context and run
    # inputs are separate artifacts, linked by the run viewer and manifest.
    IMPLEMENT_PROMPT="$IMPLEMENT_PROMPT" RUN_ID="$RUN_ID" IMPLEMENT_MODEL="$IMPLEMENT_MODEL" TRANSCRIPT_FILE="$TRANSCRIPT_FILE" node -e "
    const fs = require('fs');
    const line = JSON.stringify({
      type: 'prompt',
      ts: new Date().toISOString(),
      run_id: process.env.RUN_ID,
      model: process.env.IMPLEMENT_MODEL,
      prompt: process.env.IMPLEMENT_PROMPT
    });
    fs.writeFileSync(process.env.TRANSCRIPT_FILE, line + '\n');
    "

    claude -p "$IMPLEMENT_PROMPT" "${CLAUDE_CONTEXT_OPTIONS[@]}" \
        --allowedTools "$ALLOWED_TOOLS" \
        --disallowedTools "$DISALLOWED_TOOLS" \
        --output-format stream-json \
        --verbose \
        --model "$IMPLEMENT_MODEL" \
        | tee -a "$TRANSCRIPT_FILE"
    CLAUDE_EXIT=${PIPESTATUS[0]}
    CLAUDE_END=$(date +%s)

    echo "{\"type\":\"implement_call_completed\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"run_id\":\"$RUN_ID\",\"exit_code\":$CLAUDE_EXIT,\"duration_sec\":$((CLAUDE_END - CLAUDE_START)),\"engine\":\"claude-cli\"}" >> "$ARTIFACTS_DIR/events.jsonl"

    END_TIME=$(date +%s)

    git -C /workspace/repo diff "$RUN_START_COMMIT" HEAD > "$ARTIFACTS_DIR/changes.diff"
    if [ "${PIPELINE_RUN:-0}" = "1" ]; then
        # Expected red tests must not fail the worker process. The driver classifies
        # this evidence; a validator crash itself still fails this shell under set -e.
        node /entrypoint-lib/validate-run.js "$ARTIFACTS_DIR" "$TASK_TYPE" "$RUN_START_COMMIT"
    fi

    # Extract usage straight from the transcript and write usage.json
    node -e "
    const fs = require('fs');
    const lines = fs.readFileSync('$TRANSCRIPT_FILE', 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'result') {
          const usage = {
            model: '$IMPLEMENT_MODEL',
            cost_usd: obj.total_cost_usd || 0,
            input_tokens: (obj.usage && obj.usage.input_tokens) || 0,
            output_tokens: (obj.usage && obj.usage.output_tokens) || 0,
            cache_read_tokens: (obj.usage && obj.usage.cache_read_input_tokens) || 0,
            cache_creation_tokens: (obj.usage && obj.usage.cache_creation_input_tokens) || 0,
            duration_ms: obj.duration_ms || 0,
            num_turns: obj.num_turns || 0,
            timing: {
              total_sec: ${END_TIME} - ${START_TIME},
              clone_sec: ${CLONE_END} - ${CLONE_START},
              claude_sec: ${CLAUDE_END} - ${CLAUDE_START}
            }
          };
          fs.writeFileSync('$ARTIFACTS_DIR/usage.json', JSON.stringify(usage, null, 2));
          console.log(JSON.stringify(usage));
          break;
        }
      } catch (e) {}
    }
    " || echo "{}"

    echo "---USAGE_START---"
    cat "$ARTIFACTS_DIR/usage.json" 2>/dev/null || echo '{}'
    echo "---USAGE_END---"

    echo "✅ Code-Monkey finished."
    exit $CLAUDE_EXIT
}
