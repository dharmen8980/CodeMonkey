const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { loadPipeline, updateTicket } = require('./pipeline-store');
const { loadTasks, updateTask } = require('./task-store');
const { spawnTriage } = require('./pipeline/spawn-triage');
const { readChangesDiff, changedFiles, assertTestsOnly, assertNoTestFiles, assertNoSkips } = require('./pipeline/diff-guards');
const { readJson, readValidation, validateTestPlan, checkExecution, checkMissingContracts } = require('./pipeline/test-evidence');
const { postGitlabMrNote, createGitlabBranch, createGitlabMr, getGitlabMr, updateGitlabMrDescription } = require('./gitlab-client');
const { escapeMdHtml } = require('./markdown-escape');
const { notifyTeams } = require('./notify-teams');
const { computeTicketCost } = require('./pipeline/cost');
const { renderDescription, snapshotMr, matchesMr, criteria } = require('./pipeline/spec');
const { workerContext } = require('./pipeline/worker-context');

const PIPELINE_MARKER = '<!-- codemonkey-pipeline-run -->';
const POLL_INTERVAL_MS = 15000;
const DEFAULT_TARGET_BRANCH = process.env.TARGET_BRANCH || 'main';
const TASK_TYPE_BY_STAGE = { unit_test: 'unit-test', implement: 'review-feedback' };
const inFlight = new Set();
let intervalHandle = null;

function startPipelineDriver() {
  if (intervalHandle) return;
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  tick();
}
function triggerPipelineTick() { setImmediate(tick); }
function tick() {
  for (const ticket of loadPipeline()) {
    if (['blocked', 'done'].includes(ticket.stage) || ticket.status === 'paused') continue;
    try { processTicket(ticket); }
    catch (err) { console.error(`Pipeline error at ${ticket.id}/${ticket.stage}:`, err); }
  }
}
function processTicket(ticket) {
  if (ticket.status === 'queued') return startStage(ticket);
  if (ticket.status !== 'running') return;
  if (ticket.stage === 'triage') {
    const dir = ticket.runs?.triage_run_dir;
    if (!dir) return;
    const result = readJson(dir, 'result.json');
    const error = readJson(dir, 'error.json');
    if (result) advanceTriage(ticket, result);
    else if (error) blockTicket(ticket, `triage failed: ${error.error}`);
    return;
  }
  const expectedType = TASK_TYPE_BY_STAGE[ticket.stage];
  if (!expectedType) return;
  const task = loadTasks().filter(t => t.source === 'gitlab-webhook'
    && String(t.mr_iid) === String(ticket.mr_iid) && t.task_type === expectedType
    && (ticket.worker_trigger ? t.pipeline_trigger_id === ticket.worker_trigger
      : t.received_at >= ticket.updated_at))
    .sort((a, b) => a.received_at.localeCompare(b.received_at))[0];
  if (!task || ['pending', 'running'].includes(task.status)) return;
  if (!task.pipeline_ticket_id) updateTask(task.id, { pipeline_ticket_id: ticket.id });
  // An old image may finish during rollout. Reuse its work, but have the new
  // UnitTest worker produce a contract and evidence before advancing.
  if (ticket.legacy_worker) {
    updateTicket(ticket.id, { legacy_worker: false, stage: 'unit_test', status: 'queued' });
    return triggerPipelineTick();
  }
  if (ticket.spec_snapshot) {
    return runAsyncStage(ticket, async () => {
      const mr = await getGitlabMr(ticket.mr_iid);
      if (!matchesMr(ticket.spec_snapshot, mr)) return requeueSpecification(ticket);
      if (task.pipeline_context?.spec?.content_hash !== ticket.spec_snapshot.content_hash) {
        return blockTicket(ticket, 'worker used a different specification; retry test authoring');
      }
      advanceStage(ticket, task);
    });
  }
  advanceStage(ticket, task);
}

function runAsyncStage(ticket, work) {
  if (inFlight.has(ticket.id)) return;
  inFlight.add(ticket.id);
  return Promise.resolve().then(work)
    .catch(err => blockTicket(ticket, `${ticket.stage} failed: ${err.message || err}`))
    .finally(() => inFlight.delete(ticket.id));
}
function requeueSpecification(ticket) {
  updateTicket(ticket.id, { stage: 'unit_test', status: 'queued', test_handoff: null,
    implement_attempts: 0,
    validated_commit: null, sonar_gate_result: null, e2e_gate_result: null,
    resume_stage_after_unit_test: null, last_gate_result: null,
    last_failure_reason: 'MR specification changed; author tests for the current requirements' });
  triggerPipelineTick();
}
async function triggerWorker(ticket, mention, body) {
  let context = null;
  if (mention !== 'Sonar') {
    let mr = await getGitlabMr(ticket.mr_iid);
    // Existing tickets predate the structured description. Publish their verified
    // criteria once, retaining the original description. A damaged/new-format
    // block is never repaired silently from stale triage.
    if (!ticket.spec_snapshot && !String(mr.description || '').includes('<!-- codemonkey-spec:')) {
      const description = `${mr.description || ''}\n\n${renderDescription(ticket)}`.trim();
      mr = await updateGitlabMrDescription(ticket.mr_iid, description);
    }
    const snapshot = snapshotMr({ ...mr, iid: ticket.mr_iid }, ticket.spec_snapshot);
    const changed = ticket.spec_snapshot && snapshot.content_hash !== ticket.spec_snapshot.content_hash;
    updateTicket(ticket.id, { spec_snapshot: snapshot });
    if (changed) return requeueSpecification(ticket);
    ticket = { ...ticket, spec_snapshot: snapshot };
    context = workerContext(ticket, mr.sha);
  }
  const trigger = randomUUID();
  updateTicket(ticket.id, { status: 'running', worker_trigger: trigger, worker_context: context });
  const token = process.env.PIPELINE_GLAB_TOKEN || process.env.GLAB_TOKEN;
  return postGitlabMrNote(ticket.mr_iid,
    `@${mention}\n\n${PIPELINE_MARKER}\n<!-- pipeline-trigger:${trigger} -->\n${body}`, token);
}
function startStage(ticket) {
  switch (ticket.stage) {
    case 'triage': {
      const { runDir } = spawnTriage(ticket);
      updateTicket(ticket.id, { status: 'running', runs: { ...ticket.runs,
        triage_run_dir: runDir, triage_run_dirs: [...(ticket.runs?.triage_run_dirs || []), runDir] } });
      return;
    }
    case 'raise_pr':
      return runAsyncStage(ticket, async () => {
        updateTicket(ticket.id, { status: 'running' });
        await runRaisePr(ticket);
      });
    case 'unit_test':
      return runAsyncStage(ticket, () => triggerWorker(ticket, 'UnitTest', buildUnitTestReviewComments(ticket)));
    case 'implement':
      if (validateTestPlan(ticket.test_handoff?.plan, criteria(ticket))) {
        updateTicket(ticket.id, { stage: 'unit_test', status: 'queued' });
        return triggerPipelineTick();
      }
      return runAsyncStage(ticket, () => triggerWorker(ticket, 'CodeMonkey', buildImplementReviewComments(ticket)));
    case 'sonar_gate':
      return runAsyncStage(ticket, async () => {
        if (ticket.validated_commit) {
          const mr = await getGitlabMr(ticket.mr_iid);
          if (ticket.spec_snapshot && !matchesMr(ticket.spec_snapshot, mr)) return requeueSpecification(ticket);
          if (mr.sha !== ticket.validated_commit) {
            updateTicket(ticket.id, { stage: 'implement', status: 'queued', sonar_gate_result: null,
              last_failure_reason: 'MR changed after build/test validation; validate the current revision' });
            return triggerPipelineTick();
          }
        }
        await triggerWorker(ticket, 'Sonar', 'Run the quality gate for this validated MR revision.');
      });
    case 'e2e_verify':
      return runAsyncStage(ticket, async () => {
        if (!ticket.sonar_gate_result?.passed) {
          updateTicket(ticket.id, { stage: 'sonar_gate', status: 'queued' });
          return triggerPipelineTick();
        }
        if (ticket.spec_snapshot && !matchesMr(ticket.spec_snapshot, await getGitlabMr(ticket.mr_iid))) return requeueSpecification(ticket);
        const cost = computeTicketCost(ticket);
        await postGitlabMrNote(ticket.mr_iid, buildManualVerificationComment(ticket, cost));
        updateTicket(ticket.id, { status: 'paused', cost });
      });
    default:
      blockTicket(ticket, `unknown pipeline stage: ${ticket.stage}`);
  }
}

function testCounts(validation) {
  if (!validation.tests) return null;
  // Keep individual TRX rows in the run artifact, not in every board response.
  const { results, ...counts } = validation.tests;
  return counts;
}
function queueSonar(ticket, validation) {
  updateTicket(ticket.id, { stage: 'sonar_gate', status: 'queued',
    validated_commit: validation.commit_sha, test_counts: testCounts(validation),
    sonar_gate_result: null, e2e_gate_result: null, human_guidance: null,
    resume_stage_after_unit_test: null, last_failure_reason: null });
  triggerPipelineTick();
}
function advanceStage(ticket, task) {
  const retry = reason => retryAtStageOrBlock(ticket, ticket.stage, ticket.resume_stage_after_unit_test || null, reason);
  if (['failed', 'timeout', 'cost_limit'].includes(task.status)) return retry(`${ticket.stage} worker ${task.status}: ${task.error || ''}`);
  const escape = readNeedsDecision(task.run_dir);
  if (escape) return parkForDecision(ticket, escape);
  const diff = readChangesDiff(task.run_dir);
  if (diff === null) return retry('missing changes.diff evidence');
  const scope = ticket.stage === 'unit_test' ? assertTestsOnly(diff) : assertNoTestFiles(diff);
  if (!scope.ok) return retry(scope.reason);
  const integrity = assertNoSkips(diff);
  if (!integrity.ok) return retry(integrity.reason);
  const validation = readValidation(task.run_dir);
  if (!validation) return retry('missing final validation for a clean, committed, pushed revision; rebuild the worker image if needed');
  if (ticket.mr_branch && validation.branch !== ticket.mr_branch) return retry('validation belongs to a different branch');
  if (validation.build?.error || validation.test_error
    || validation.build?.diagnostics?.some(d => /^(?:NU|MSB|NETSDK)/.test(d.code))) {
    return blockTicket(ticket, 'validation infrastructure failed; inspect build.log/test.log before retrying');
  }

  if (ticket.stage === 'unit_test') {
    if (!validation.production_build?.passed) {
      return blockTicket(ticket, 'production build failed before acceptance tests; inspect production-build.log');
    }
    // A retry may only edit one of several test files from an earlier red run.
    // Retain their ownership so remaining deliberate missing contracts stay valid.
    const testFiles = [...new Set([...(ticket.test_files || []), ...changedFiles(diff)])];
    updateTicket(ticket.id, { test_files: testFiles });
    const plan = readJson(task.run_dir, 'test-plan.json');
    const planError = validateTestPlan(plan, criteria(ticket));
    if (planError) return retry(planError);
    let state;
    if (!validation.build?.passed) {
      const error = checkMissingContracts(plan, validation, testFiles);
      if (error) return retry(error);
      state = 'missing_contract';
    } else {
      const error = checkExecution(plan, validation, false);
      if (error) return retry(error);
      state = validation.tests.failed > 0 ? 'red' : 'green';
    }
    const handoff = { state, plan, commit_sha: validation.commit_sha,
      diagnostics: validation.build.diagnostics, run_dir: task.run_dir };
    updateTicket(ticket.id, { test_handoff: handoff, test_counts: testCounts(validation),
      failing_tests: validation.tests?.failing_names || [],
      sonar_gate_result: null, e2e_gate_result: null, human_guidance: null });
    // Coverage-only repair can return directly to Sonar when already green.
    if (ticket.resume_stage_after_unit_test === 'sonar_gate' && state === 'green') {
      return queueSonar(ticket, validation);
    }
    // Expected red is the successful output of test authoring, never a retry.
    updateTicket(ticket.id, { stage: 'implement', status: 'queued' });
    return triggerPipelineTick();
  }

  const plan = ticket.test_handoff?.plan;
  if (validateTestPlan(plan, criteria(ticket))) {
    updateTicket(ticket.id, { stage: 'unit_test', status: 'queued' });
    return triggerPipelineTick();
  }
  if (!validation.build?.passed) return retry('build failed after implement');
  const error = checkExecution(plan, validation, true);
  if (error) return retry(error);
  updateTicket(ticket.id, { failing_tests: null });
  return queueSonar(ticket, validation);
}

function notifySonarGateResult(mrIid, result, triggerId) {
  const ticket = loadPipeline().find(t => String(t.mr_iid) === String(mrIid)
    && t.stage === 'sonar_gate' && t.status === 'running');
  if (!ticket || (ticket.worker_trigger && ticket.worker_trigger !== triggerId)) return;
  updateTicket(ticket.id, { sonar_gate_result: result });
  if (result.passed) {
    updateTicket(ticket.id, { stage: 'e2e_verify', status: 'queued', human_guidance: null,
      resume_stage_after_unit_test: null, e2e_gate_result: null });
    return triggerPipelineTick();
  }
  if (result.error || !result.failed_conditions?.length) {
    return blockTicket(ticket, `sonar scan unavailable: ${result.error || 'no failing quality-gate conditions returned'}`);
  }
  const coverageOnly = result.failed_conditions.every(c => /^(?:new_)?(?:coverage|line_coverage|branch_coverage|uncovered_lines|uncovered_conditions)$/.test(c.metricKey));
  retryAtStageOrBlock(ticket, coverageOnly ? 'unit_test' : 'implement', 'sonar_gate',
    `sonar gate failed: ${JSON.stringify(result.failed_conditions)}`, result, null, 'sonar');
}

// Both manual verdicts are ordinary gate results. A pass completes the pipeline;
// failure invalidates quality signals and sends production code through all gates again.
function recordManualVerification(ticket, passed, note) {
  if (ticket.stage !== 'e2e_verify' || ticket.status !== 'paused' || !ticket.sonar_gate_result?.passed) {
    throw new Error('ticket must be awaiting manual E2E after a passing Sonar gate');
  }
  const result = { passed, method: 'manual', note, checked_at: new Date().toISOString(),
    commit_sha: ticket.validated_commit || null };
  const history = [...(ticket.verification_history || []), result];
  updateTicket(ticket.id, { e2e_gate_result: result, verification_history: history });
  if (passed) {
    return updateTicket(ticket.id, { stage: 'done', status: 'completed', cost: computeTicketCost(ticket) });
  }
  return retryAtStageOrBlock(ticket, 'implement', null, `manual E2E failed: ${note}`, result);
}

function retryAtStageOrBlock(ticket, targetStage, resumeStage, reason, gateResult, extraFields, budget) {
  const isSonar = budget === 'sonar';
  const counterField = isSonar ? 'sonar_fix_attempts' : 'implement_attempts';
  const attempts = (ticket[counterField] || 0) + 1;
  const cap = ticket[isSonar ? 'sonar_fix_attempt_cap' : 'implement_attempt_cap'] || (isSonar ? 2 : 3);
  updateTicket(ticket.id, { [counterField]: attempts, last_failure_reason: reason,
    last_gate_result: gateResult || null, ...(extraFields || {}) });
  if (attempts >= cap) return blockTicket(ticket, `${targetStage} attempt cap (${cap}) reached — ${reason}`);
  updateTicket(ticket.id, { stage: targetStage, status: 'queued',
    resume_stage_after_unit_test: resumeStage, sonar_gate_result: null, e2e_gate_result: null });
  triggerPipelineTick();
}

function readNeedsDecision(runDir) {
  if (!runDir) return null;
  try {
    const raw = fs.readFileSync(path.join(runDir, 'needs_decision.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.reason !== 'string' || !parsed.reason.trim()) return null;
    if (parsed.test_names !== undefined && (!Array.isArray(parsed.test_names)
      || parsed.test_names.some(n => typeof n !== 'string'))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parkForDecision(ticket, escape) {
  console.log(`\n🙋 Ticket ${ticket.id} parked for a human: ${escape.reason}`);
  updateTicket(ticket.id, {
    stage: 'needs_decision',
    status: 'paused',
    // Clarification resumes the stage that raised the question.
    needs_decision_from_stage: ticket.stage,
    clarification_question: [
      ticket.stage === 'implement'
        ? 'The implementation agent believes a test contradicts its acceptance criterion.'
        : 'The test author needs clarification before completing the acceptance tests.',
      escape.test_names?.length ? `Tests: ${escape.test_names.join(', ')}` : '',
      ``,
      escape.reason,
      ``,
      `Answer with what should change — the test, the criterion, or the code — and it resumes at ${ticket.stage}.`,
    ].filter(Boolean).join('\n'),
    human_clarification: null,
  });
}

function blockTicket(ticket, reason) {
  console.log(`\n🚫 Ticket ${ticket.id} blocked: ${reason}`);
  // Cost so far, even on a blocked ticket — this is exactly the number that shows
  // whether a stalled/looping ticket burned real money before anyone noticed.
  const cost = computeTicketCost(ticket);
  updateTicket(ticket.id, {
    stage: 'blocked', status: 'stage_failed', blocked: true, blocked_reason: reason, cost,
    // The retry route resumes the stage that failed.
    blocked_from_stage: ticket.stage,
  });
  notifyTeams(
    { id: ticket.id, description: ticket.title, task_type: 'pipeline' },
    'failed',
    `Pipeline ticket blocked at stage "${ticket.stage}": ${reason} (spent $${cost.total_usd.toFixed(2)} so far)`,
    null
  );
}

// A "needs_clarification" outcome isn't a failure — triage genuinely can't resolve
// something no codebase/DB/MCP lookup can answer (should be rare). Parks the ticket
// on the pipeline page's "Need Decision" column with the specific question and
// whatever triage DID establish, rather than blocking it or silently guessing.
function advanceTriage(ticket, triageResult) {
  // Missing requirement evidence can require clarification before implementation
  // facts are verified. Only a feasible ticket may advance to MR creation.
  if (triageResult.feasibility === 'needs_clarification') {
    updateTicket(ticket.id, {
      triage: triageResult,
      title: ticket.title || triageResult.title || (triageResult.brief || '').slice(0, 80),
      stage: 'needs_decision',
      status: 'paused',
      clarification_question: triageResult.clarification_question
        || triageResult.verification_reason
        || 'Triage could not determine feasibility from the codebase — please clarify.',
      human_clarification: null,
    });
    return;
  }
  if (!triageResult.verified || triageResult.feasibility === 'infeasible') {
    return blockTicket(ticket, `triage: ${triageResult.feasibility} — ${triageResult.brief || 'no brief'}`);
  }
  if (!Array.isArray(triageResult.acceptance_criteria) || !triageResult.acceptance_criteria.length
    || triageResult.acceptance_criteria.some(c => typeof c !== 'string' || !c.trim())) {
    return blockTicket(ticket, 'triage returned no usable acceptance criteria for test-first authoring');
  }
  updateTicket(ticket.id, {
    triage: triageResult,
    title: ticket.title || triageResult.title || (triageResult.brief || '').slice(0, 80),
    fr_number: ticket.fr_number || triageResult.fr_number || null,
    stage: 'raise_pr',
    status: 'queued',
    // Consumed by this run, whichever way it came out — clear so a future
    // clarification round starts clean rather than replaying a stale answer.
    clarification_question: null,
    human_clarification: null,
    human_guidance: null,
    resume_stage_after_unit_test: null,
  });
  triggerPipelineTick();
}

// Scripted, no AI agent: everything the MR needs (branch name, title, description)
// is already fully determined by triage's output, so this is two GitLab API calls
// (lib/gitlab-client.js) instead of spawning a container just to run git+glab.
function runRaisePr(ticket) {
  const branch = buildRaisePrBranchName(ticket);
  const title = buildRaisePrTitle(ticket);
  const description = buildRaisePrDescription(ticket);
  const targetBranch = ticket.base_branch || DEFAULT_TARGET_BRANCH;
  return createGitlabBranch(branch, targetBranch)
    .then(() => createGitlabMr(branch, targetBranch, title, description))
    .then(mr => {
      updateTicket(ticket.id, {
        mr_url: mr.web_url, mr_iid: String(mr.iid), mr_branch: branch,
        spec_snapshot: snapshotMr({ ...mr, description: mr.description ?? description }),
        // Tests specify the required behavior before production changes land.
        stage: 'unit_test', status: 'queued', human_guidance: null, resume_stage_after_unit_test: null,
      });
      triggerPipelineTick();
    });
}

// Accept either a bare number or an FR-style citation from the ticket source.
function extractFrNumbers(frNumber) {
  if (!frNumber || frNumber === 'null') return [];
  const frMatches = String(frNumber).match(/FR-(\d+)/gi);
  if (frMatches) return frMatches.map(m => m.match(/(\d+)/)[1]);
  return String(frNumber).match(/\d+/g) || [];
}

// Same convention as CLAUDE.md's branch-naming rules for human/agent work:
// {type}/CodeMonkey/FR-{number}-{1-3 words} (or without the FR segment if there
// isn't one). No FR-vs-bug classifier here, so "fix" is a light keyword guess —
// good enough for a branch name, not load-bearing for anything else.
function buildRaisePrBranchName(ticket) {
  const t = ticket.triage || {};
  const text = `${ticket.title || ''} ${ticket.initial_brief || ''}`.toLowerCase();
  const type = /\b(fix|bug|error|crash|broken|incorrect)\b/.test(text) ? 'fix' : 'feature';
  const words = (ticket.title || t.brief || ticket.initial_brief || 'ticket')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-') || 'ticket';
  const frNums = extractFrNumbers(ticket.fr_number);
  const fr = frNums.length ? `FR-${frNums.join('-')}-` : '';
  return `${type}/CodeMonkey/${fr}${words}`.replace(/-+$/, '');
}

function buildRaisePrTitle(ticket) {
  const frNums = extractFrNumbers(ticket.fr_number);
  const base = frNums.length
    ? `FR-${frNums.join('-')}: ${ticket.title || ticket.jira_key || 'Ticket'}`
    : `${ticket.jira_key ? ticket.jira_key + ': ' : ''}${ticket.title || 'Ticket'}`;
  return base.length > 70 ? `${base.slice(0, 67)}...` : base;
}

function buildRaisePrDescription(ticket) { return renderDescription(ticket); }
function buildUnitTestReviewComments(ticket) {
  return `Stage: unit_test. Specification revision: ${ticket.spec_snapshot?.revision || 1}. Context is attached to the worker run.`;
}
function buildImplementReviewComments(ticket) {
  return `Stage: implement. Specification revision: ${ticket.spec_snapshot?.revision || 1}. Context is attached to the worker run.`;
}
function buildManualVerificationComment(ticket, cost) {
  const tests = ticket.test_counts;
  return [
    '**Pipeline: awaiting manual E2E acceptance**',
    `Ticket: ${escapeMdHtml(ticket.jira_key || ticket.title || '(ad-hoc)')}`,
    `Revision: ${ticket.validated_commit || '(legacy ticket)'}`,
    `Sonar quality gate: ${ticket.sonar_gate_result?.quality_gate_status || 'OK'}`,
    tests ? `Tests: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped (${tests.total} total)` : 'Tests: legacy results unavailable',
    `Acceptance criteria: see the MR description (specification revision ${ticket.spec_snapshot?.revision || 'legacy'}).`,
    `Suggested verification: ${ticket.spec_snapshot?.specification.verification_method || ticket.triage?.verification_method || 'ui'} — ${ticket.spec_snapshot?.specification.verification_reason || ticket.triage?.verification_reason || ''}`,
    'Verify the acceptance criteria, then use Pass verification or Fail with feedback on the pipeline board. A pass completes the pipeline; merging remains a human action.',
    `Cost so far: $${cost.total_usd.toFixed(2)}`,
  ].join('\n\n');
}

module.exports = { startPipelineDriver, triggerPipelineTick, notifySonarGateResult, retryAtStageOrBlock, recordManualVerification, requeueSpecification };
