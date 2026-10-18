// Normalize old persisted state on read. No live store rewrite is needed at deploy;
// the next ordinary update persists this shape. Completed history stays untouched.
function migrateTicket(ticket) {
  if (ticket.pipeline_version === 2 || ticket.stage === 'done') return ticket;
  const t = { ...ticket, pipeline_version: 2, resume_stage_after_unit_test: null };
  if (t.stage === 'ready_for_review' || t.stage === 'e2e_verify') {
    t.stage = t.sonar_gate_result?.passed ? 'e2e_verify' : 'sonar_gate';
    t.status = 'queued';
  }
  if (['implement', 'unit_test'].includes(t.stage)) {
    if (t.status === 'running') t.legacy_worker = true;
    else { t.stage = 'unit_test'; t.status = 'queued'; }
  }
  if (t.stage === 'blocked') {
    if (t.blocked_from_stage === 'ready_for_review') t.blocked_from_stage = 'e2e_verify';
    if (t.blocked_from_stage === 'implement') t.blocked_from_stage = 'unit_test';
  }
  return t;
}
module.exports = { migrateTicket };
