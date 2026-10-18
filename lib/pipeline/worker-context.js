// A correlated driver trigger carries data through the task store, never through
// a repeated MR comment. JSON round trips keep queued runs independent of later edits.
function workerContext(ticket, commitSha) {
  return JSON.parse(JSON.stringify({
    version: 1,
    ticket_id: ticket.id,
    stage: ticket.stage,
    expected_commit: commitSha,
    spec: ticket.spec_snapshot,
    handoff: ticket.test_handoff ? {
      state: ticket.test_handoff.state,
      plan: ticket.test_handoff.plan,
      commit_sha: ticket.test_handoff.commit_sha,
      diagnostics: ticket.test_handoff.diagnostics,
    } : null,
    feedback: {
      reason: ticket.last_failure_reason || null,
      gate: ticket.last_gate_result || null,
      human_guidance: ticket.human_guidance || null,
      purpose: ticket.resume_stage_after_unit_test === 'sonar_gate' ? 'coverage_repair' : ticket.stage,
    },
  }));
}

function taskPayload(task) {
  return {
    version: 1,
    task_type: task.task_type || 'new-task',
    trigger_note_id: task.trigger_note_id ?? null,
    pipeline_trigger_id: task.pipeline_trigger_id || null,
    mr: { iid: task.mr_iid || null, url: task.mr_url || '', branch: task.mr_branch || '' },
    description: task.pipeline_context ? '' : task.description || '',
    review_comments: task.pipeline_context ? '' : task.review_comments || '',
    pipeline_context: task.pipeline_context || null,
  };
}
module.exports = { workerContext, taskPayload };
