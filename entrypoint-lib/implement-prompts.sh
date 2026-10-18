# Dynamic run pointers only. Workflow is loaded from the selected role skill.
build_implement_prompt() {
    IMPLEMENT_MODEL="${IMPLEMENT_MODEL:-us.anthropic.claude-sonnet-5}"
    IMPLEMENT_PROMPT="Role: $INSTRUCTION_ROLE.
Read /workspace/_artifacts/run-context.json and /workspace/_artifacts/changed-files.txt."
    if [ "${PIPELINE_RUN:-0}" = "1" ]; then
        IMPLEMENT_PROMPT="$IMPLEMENT_PROMPT
Read /workspace/_artifacts/spec.json, /workspace/_artifacts/handoff.json, and /workspace/_artifacts/feedback.json.
Use this specification snapshot for this run. Record outputs in /workspace/_artifacts/."
    else
        IMPLEMENT_PROMPT="$IMPLEMENT_PROMPT
Read /workspace/_artifacts/request.json for the current request. Record outputs in /workspace/_artifacts/."
    fi
}
