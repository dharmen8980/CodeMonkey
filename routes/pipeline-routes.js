const fs = require('fs');
const path = require('path');
const { loadPipeline, mutatePipeline, updateTicket } = require('../lib/pipeline-store');
const { triggerPipelineTick, recordManualVerification } = require('../lib/pipeline-driver');
const { getGitlabMr } = require('../lib/gitlab-client');
const { matchesMr } = require('../lib/pipeline/spec');
const { requeueSpecification } = require('../lib/pipeline-driver');
const { generateRunId } = require('../lib/utils');

const ROOT = path.join(__dirname, '..');

function serveFile(res, file, contentType) {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

// --- GET /pipeline ---
function handlePipelinePage(req, res) {
  serveFile(res, 'pipeline.html', 'text/html');
}

// --- GET /pipeline.js, /pipeline.css ---
function handlePipelineAsset(req, res) {
  const map = {
    '/pipeline.js': ['pipeline.js', 'application/javascript'],
    '/pipeline.css': ['pipeline.css', 'text/css'],
  };
  const [file, contentType] = map[req.url];
  serveFile(res, file, contentType);
}

// --- GET /api/pipeline — every ticket, newest first. Board groups by stage client-side. ---
function handlePipelineApiGet(req, res) {
  const tickets = loadPipeline().slice().reverse();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ tickets }));
}

function buildManualTicket(item) {
  const jira_key = item?.jira_key ? String(item.jira_key).trim() : null;
  const title = item?.title ? String(item.title).trim().slice(0, 200) : null;
  const initial_brief = item?.initial_brief ? String(item.initial_brief).trim().slice(0, 4000) : '';
  const fr_number = item?.fr_number ? String(item.fr_number).trim() : null;
  const stage = typeof item?.stage === 'string' && item.stage.trim() ? item.stage.trim() : 'triage';
  const base_branch = typeof item?.base_branch === 'string' && item.base_branch.trim() ? item.base_branch.trim() : null;
  if (!jira_key && !title && !initial_brief) return null;

  return {
    id: generateRunId(),
    pipeline_version: 2,
    source: 'manual',
    chat_id: null,
    proposal_id: null,
    jira_key,
    title: title || jira_key || initial_brief.slice(0, 80),
    initial_brief: initial_brief || title || jira_key || '',
    fr_number,
    stage,
    status: 'queued',
    mr_iid: null, mr_url: null, mr_branch: null, base_branch,
    triage: stage !== 'triage' ? {
      brief: title || initial_brief || jira_key || 'ticket',
      acceptance_criteria: Array.isArray(item?.acceptance_criteria) ? item.acceptance_criteria.filter(s => typeof s === 'string' && s.trim()) : [],
      affected_areas: Array.isArray(item?.affected_areas) ? item.affected_areas.filter(s => typeof s === 'string') : [],
      constraints: Array.isArray(item?.constraints) ? item.constraints.filter(s => typeof s === 'string') : [],
      verification_method: ['unit_test_only', 'api', 'ui'].includes(item?.verification_method) ? item.verification_method : 'unit_test_only',
    } : null,
    clarification_question: null,
    human_clarification: null,
    human_guidance: null,
    implement_attempts: 0,
    implement_attempt_cap: 3,
    // Separate budget from implement_attempts: a sonar coverage bounce used to eat the
    // implementation's retries and block a ticket whose implementation was never at fault.
    sonar_fix_attempts: 0,
    sonar_fix_attempt_cap: 2,
    resume_stage_after_unit_test: null,
    test_handoff: null,
    failing_tests: null,
    test_counts: null,
    needs_decision_from_stage: null,
    runs: {},
    e2e_gate_result: null,
    sonar_gate_result: null,
    blocked: false,
    blocked_reason: null,
    blocked_from_stage: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// --- POST /api/pipeline/tickets — create one or more tickets directly, bypassing
// chat entirely. Body is either a single { jira_key, title, initial_brief, fr_number }
// object, or { tickets: [...] } for a bulk paste of several at once — each one lands
// straight in 'triage' and gets its own independent container the next tick, so this
// is what actually unlocks parallel triage (the driver already handles every ticket
// independently; chat's one-conversation-at-a-time was the real serialization). ---
function handlePipelineTicketsPost(req, res, payload) {
  if (!process.env.DOTNET_SOLUTION || !process.env.DOTNET_PRODUCTION_PROJECT) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Configure DOTNET_SOLUTION and DOTNET_PRODUCTION_PROJECT before using the acceptance pipeline' }));
    return;
  }
  const items = Array.isArray(payload?.tickets) ? payload.tickets : [payload];
  const created = [];
  const createdStages = new Map();
  mutatePipeline(tickets => {
    for (const item of items) {
      const ticket = buildManualTicket(item);
      if (!ticket) continue;
      tickets.push(ticket);
      created.push(ticket.id);
      createdStages.set(ticket.stage, (createdStages.get(ticket.stage) || 0) + 1);
    }
  });

  if (!created.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no valid ticket in request body (need at least jira_key, title, or initial_brief)' }));
    return;
  }

  console.log(`\n✅ Manually queued ${created.length} pipeline ticket(s): ${Array.from(createdStages, ([stage, count]) => `${stage} (${count})`).join(', ')}`);
  triggerPipelineTick();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'queued', ticket_ids: created }));
}

// --- POST /api/pipeline/:id/clarify — human answers a needs_decision ticket's
// clarification question from the pipeline page's text box. Requeues straight to
// triage; spawnTriage sees human_clarification set and runs the lighter
// confirm-only prompt instead of a fresh full investigation. ---
function handlePipelineClarifyPost(req, res, payload, ticketId) {
  const answer = typeof payload?.answer === 'string' ? payload.answer.trim().slice(0, 4000) : '';
  if (!answer) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'answer is required' }));
    return;
  }

  const ticket = loadPipeline().find(t => t.id === ticketId);
  if (!ticket) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no such ticket' }));
    return;
  }
  if (ticket.stage !== 'needs_decision') {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `ticket is in stage "${ticket.stage}", not needs_decision` }));
    return;
  }

  // Triage is the usual origin of a needs_decision, but not the only one: implement
  // parks here too when it believes a test contradicts its acceptance criterion (see
  // parkForDecision in lib/pipeline-driver.js), and re-running triage would be the wrong
  // answer to that question. Resume where the question was actually raised.
  const resumeStage = ticket.needs_decision_from_stage || 'triage';
  updateTicket(ticketId, {
    human_clarification: answer,
    // Triage reads human_clarification; every other stage folds the answer into its next
    // feedback.json through workerContext, which reads human_guidance.
    ...(resumeStage === 'triage' ? {} : { human_guidance: answer }),
    stage: resumeStage,
    status: 'queued',
    needs_decision_from_stage: null,
  });
  console.log(`\n✅ Clarification answered for ticket ${ticketId}, requeuing to ${resumeStage}`);
  triggerPipelineTick();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'queued', ticket_id: ticketId, stage: resumeStage }));
}

// --- POST /api/pipeline/:id/retry — human retries a blocked ticket with a
// steering note from the pipeline page (routes/pipeline-driver.js's blockTicket
// records blocked_from_stage so this knows exactly what to requeue). The note
// travels in feedback.json for workers or task.json for triage. ---
function handlePipelineRetryPost(req, res, payload, ticketId) {
  const guidance = typeof payload?.guidance === 'string' ? payload.guidance.trim().slice(0, 2000) : '';

  const ticket = loadPipeline().find(t => t.id === ticketId);
  if (!ticket) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no such ticket' }));
    return;
  }
  if (ticket.stage !== 'blocked') {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `ticket is in stage "${ticket.stage}", not blocked` }));
    return;
  }

  const targetStage = ticket.blocked_from_stage || 'triage';
  updateTicket(ticketId, {
    stage: targetStage, status: 'queued',
    blocked: false, blocked_reason: null, blocked_from_stage: null,
    human_guidance: guidance || null,
  });
  console.log(`\n✅ Ticket ${ticketId} retried at stage "${targetStage}"${guidance ? ' with guidance' : ''}`);
  triggerPipelineTick();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'queued', ticket_id: ticketId, stage: targetStage }));
}

// The legacy force-pass/force-fail URLs remain aliases, but only manual E2E has
// a human verdict now. Sonar cannot be bypassed through this endpoint.
async function handleManualVerdict(req, res, payload, ticketId, passed) {
  const value = passed ? payload?.note : payload?.feedback;
  const note = typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  const respond = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!passed && !note) return respond(400, { error: 'feedback is required' });
  const ticket = loadPipeline().find(t => t.id === ticketId);
  if (!ticket) return respond(404, { error: 'no such ticket' });
  if (ticket.stage !== 'e2e_verify' || ticket.status !== 'paused' || !ticket.sonar_gate_result?.passed) {
    return respond(409, { error: 'ticket must be awaiting manual E2E after a passing Sonar gate' });
  }
  // Do not approve a new revision using evidence from the old one.
  if (passed && ticket.validated_commit) {
    try {
      const mr = await getGitlabMr(ticket.mr_iid);
      if (ticket.spec_snapshot && !matchesMr(ticket.spec_snapshot, mr)) {
        requeueSpecification(ticket);
        return respond(409, { error: 'MR requirements changed; test authoring has been requeued' });
      }
      if (mr.sha !== ticket.validated_commit) {
        updateTicket(ticketId, { stage: 'implement', status: 'queued', sonar_gate_result: null,
          e2e_gate_result: null, last_failure_reason: 'MR changed during manual verification; revalidate the current revision' });
        triggerPipelineTick();
        return respond(409, { error: 'MR changed; implementation validation and Sonar have been requeued' });
      }
    } catch (err) { return respond(502, { error: `cannot verify current MR revision: ${err.message}` }); }
  }
  // Another verdict may have arrived while awaiting GitLab.
  const current = loadPipeline().find(t => t.id === ticketId);
  if (current?.stage !== 'e2e_verify' || current.status !== 'paused'
    || current.validated_commit !== ticket.validated_commit) {
    return respond(409, { error: 'ticket changed while recording the verdict' });
  }
  recordManualVerification(current, passed, note);
  const updated = loadPipeline().find(t => t.id === ticketId);
  return respond(200, { ticket_id: ticketId, stage: updated.stage, status: updated.status });
}
function handlePipelineForcePassPost(req, res, payload, ticketId) {
  return handleManualVerdict(req, res, payload, ticketId, true);
}
function handlePipelineForceFailPost(req, res, payload, ticketId) {
  return handleManualVerdict(req, res, payload, ticketId, false);
}

module.exports = {
  handlePipelinePage, handlePipelineAsset, handlePipelineApiGet,
  handlePipelineTicketsPost, handlePipelineClarifyPost,
  handlePipelineRetryPost, handlePipelineForcePassPost, handlePipelineForceFailPost,
};
