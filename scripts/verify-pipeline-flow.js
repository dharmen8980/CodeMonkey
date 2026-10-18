#!/usr/bin/env node
// Offline state-machine, evidence, migration, API, and worker integration checks.
// All external services/stores are stubbed. No live tickets or containers are used.
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-flow-'));
process.env.DOTNET_SOLUTION = 'Example.sln';
process.env.DOTNET_PRODUCTION_PROJECT = 'src/App.csproj';
const SHA = 'a'.repeat(40);
const TEST = 'NS.FooTests.Action_Valid_Succeeds';
const TEST_FILE = 'tests/FooTests.cs';
const PROD_FILE = 'src/Foo.cs';
const plan = () => ({ criteria: [{ criterion: 1, tests: [TEST] }], missing_contracts: [] });
let TICKET, TASKS = [], NOTES = [], remoteSha = SHA, remoteDescription = '';
const spec = require('../lib/pipeline/spec');
const { workerContext } = require('../lib/pipeline/worker-context');
let checks = 0;
const stub = (rel, exports) => {
  const filename = require.resolve(path.join(ROOT, rel));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('lib/pipeline-store.js', {
  loadPipeline: () => TICKET ? [TICKET] : [],
  updateTicket: (id, fields) => (TICKET = { ...TICKET, ...fields }),
  mutatePipeline: fn => fn([TICKET]),
});
stub('lib/task-store.js', { loadTasks: () => TASKS, updateTask: () => {} });
stub('lib/gitlab-client.js', {
  postGitlabMrNote: async (mr, text) => { NOTES.push(text); return {}; },
  createGitlabBranch: async () => ({}),
  createGitlabMr: async (branch, target, title, description) => {
    remoteDescription = description;
    return { iid: 999, web_url: 'https://example.test/mr/999', description, sha: remoteSha };
  },
  updateGitlabMrDescription: async (iid, description) => {
    remoteDescription = description; return { iid, description, sha: remoteSha };
  },
  getGitlabMr: async () => ({ iid: 999, sha: remoteSha, description: remoteDescription }),
});
stub('lib/notify-teams.js', { notifyTeams: () => {} });
stub('lib/pipeline/spawn-triage.js', { spawnTriage: () => ({ runDir: tmp }) });
stub('lib/pipeline/cost.js', { computeTicketCost: () => ({ total_usd: 1, breakdown: {} }) });
const driverPath = path.join(ROOT, 'lib/pipeline-driver.js');
const driver = new Module(driverPath, module);
driver.filename = driverPath;
driver.paths = Module._nodeModulePaths(path.dirname(driverPath));
let src = fs.readFileSync(driverPath, 'utf8').replace('function triggerPipelineTick() { setImmediate(tick); }', 'function triggerPipelineTick() {}');
src += '\nObject.assign(module.exports, { advanceStage, advanceTriage, startStage, processTicket, buildUnitTestReviewComments, buildImplementReviewComments });';
driver._compile(src, driverPath);
require.cache[driverPath] = driver;
const d = driver.exports;
const routes = require('../routes/pipeline-routes');
const { migrateTicket } = require('../lib/pipeline/migrate-ticket');
const { parseDiagnostics, parseTrx, summarizeTests, validateRun } = require('../entrypoint-lib/validate-run');
const evidence = require('../lib/pipeline/test-evidence');
const guards = require('../lib/pipeline/diff-guards');

function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log(`  ok  ${name}`);
}
function newTicket(over = {}) {
  NOTES = []; TASKS = []; remoteSha = SHA;
  TICKET = { id: 'a'.repeat(16), pipeline_version: 2, mr_iid: '999', mr_branch: 'feature/test',
    stage: 'unit_test', status: 'running', triage: { verification_method: 'ui',
      acceptance_criteria: ['Given valid input, When submitted, Then it succeeds'], brief: 'Submit' },
    implement_attempts: 0, implement_attempt_cap: 3, sonar_fix_attempts: 0, sonar_fix_attempt_cap: 2,
    test_handoff: { state: 'red', plan: plan(), commit_sha: SHA }, ...over };
  remoteDescription = spec.renderDescription({ ...TICKET, triage: { brief: 'Submit', acceptance_criteria: ['A meaningful outcome'], ...TICKET.triage } });
}
function makeRun(over = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'run-'));
  const outcome = over.outcome || 'Passed';
  const validation = { version: 1, commit_sha: SHA, branch: TICKET.mr_branch, clean: true, commit_unchanged: true,
    pushed: true, production_build: { passed: true }, build: { passed: true, diagnostics: [] },
    test_passed: outcome === 'Passed', tests: summarizeTests([{ name: TEST, outcome }]), ...over.validation };
  fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify(validation));
  fs.writeFileSync(path.join(dir, 'test-plan.json'), JSON.stringify(over.plan || plan()));
  fs.writeFileSync(path.join(dir, 'changes.diff'), over.diff ?? (over.files || [TEST_FILE]).map(f =>
    `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+${over.added || '[Fact]'}\n`).join(''));
  return dir;
}
function advance(over = {}, status = 'completed') {
  const dir = makeRun(over);
  d.advanceStage(TICKET, { status, run_dir: dir });
  return dir;
}
function missingRun(code = 'CS0246', symbol = 'SubmissionService', extra = {}) {
  return { plan: { ...plan(), missing_contracts: [{ criterion: 1, symbol, reason: 'Service required for submission' }] },
    validation: { build: { passed: false, diagnostics: [{ file: `/workspace/repo/${TEST_FILE}`, code,
      message: `The type or namespace name '${symbol}' could not be found` }] }, tests: null, test_passed: false, ...extra } };
}
async function verdict(passed, payload) {
  const res = { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
  await routes[passed ? 'handlePipelineForcePassPost' : 'handlePipelineForceFailPost']({}, res, payload, TICKET.id);
  return res;
}
function trx(outcome = 'Passed', method = 'Action_Valid_Succeeds') {
  return `<TestRun><TestDefinitions><UnitTest id="id1"><TestMethod className="NS.FooTests" name="${method}" /></UnitTest></TestDefinitions><Results><UnitTestResult testId="id1" outcome="${outcome}" /></Results><ResultSummary><Counters total="1" /></ResultSummary></TestRun>`;
}

async function main() {
  console.log('\nTest-first flow and expected red');
  newTicket({ stage: 'triage' });
  d.advanceTriage(TICKET, { verified: true, feasibility: 'feasible', acceptance_criteria: [] });
  check('triage cannot raise MR without testable criteria', TICKET.stage, 'blocked');
  newTicket({ stage: 'triage' });
  d.advanceTriage(TICKET, { verified: true, feasibility: 'needs_clarification' });
  check('triage clarification pauses without writing code', TICKET.stage, 'needs_decision');
  newTicket({ stage: 'triage' });
  d.advanceTriage(TICKET, { verified: false, feasibility: 'needs_clarification',
    clarification_origin: 'requirement_ambiguous', clarification_question: 'Which RAGFlow document defines this requirement?' });
  check('missing requirement evidence can pause before code verification', [TICKET.stage, TICKET.status], ['needs_decision', 'paused']);
  newTicket({ stage: 'triage' });
  d.advanceTriage(TICKET, { verified: false, feasibility: 'feasible', acceptance_criteria: ['Unverified outcome'] });
  check('unverified feasibility cannot create an MR', TICKET.stage, 'blocked');
  newTicket({ stage: 'triage' });
  d.advanceTriage(TICKET, { verified: true, feasibility: 'feasible', acceptance_criteria: ['A meaningful outcome'] });
  check('verified criteria queue branch and MR creation', TICKET.stage, 'raise_pr');
  newTicket({ stage: 'raise_pr', status: 'queued' });
  await d.startStage(TICKET);
  check('raise_pr queues unit_test', TICKET.stage, 'unit_test');
  advance({ outcome: 'Failed' });
  check('red assertions hand off to implement', TICKET.stage, 'implement');
  check('expected red does not consume attempts', TICKET.implement_attempts, 0);
  advance({ files: [PROD_FILE] });
  check('green implementation queues Sonar before E2E', TICKET.stage, 'sonar_gate');
  await d.startStage(TICKET);
  check('Sonar triggered via MR mention', NOTES.at(-1).startsWith('@Sonar'), true);
  const trigger = TICKET.worker_trigger;
  d.notifySonarGateResult('999', { passed: true }, 'wrong-trigger');
  check('stale scan callback ignored', TICKET.stage, 'sonar_gate');
  d.notifySonarGateResult('999', { passed: true, quality_gate_status: 'OK' }, trigger);
  check('passing Sonar queues manual E2E', TICKET.stage, 'e2e_verify');
  await d.startStage(TICKET);
  check('E2E waits for human', TICKET.status, 'paused');
  check('summary posted on entering manual stage', NOTES.at(-1).includes('awaiting manual E2E'), true);
  let res = await verdict(true, { note: 'Verified the submission flow' });
  check('manual pass returns done', res.body.stage, 'done');
  check('human acceptance is recorded', TICKET.e2e_gate_result.method, 'manual');
  check('manual pass does not claim SQL was executed', TICKET.e2e_gate_result.db_assertion_passed, undefined);
  res = await verdict(true, {});
  check('duplicate verdict rejected', res.code, 409);

  newTicket(); advance(missingRun());
  check('missing production type hands off without a test summary', TICKET.stage, 'implement');
  check('missing-contract handoff is explicit', TICKET.test_handoff.state, 'missing_contract');
  check('compile-red does not spend retry budget', TICKET.implement_attempts, 0);
  check('implementation context includes compiler evidence', workerContext(TICKET, SHA).handoff.diagnostics[0].code, 'CS0246');
  check('trigger comment does not duplicate compiler handoff', d.buildImplementReviewComments(TICKET).includes('CS0246'), false);
  advance({ files: [PROD_FILE] });
  check('compile-red implementation can advance once tests execute', TICKET.stage, 'sonar_gate');

  newTicket(); advance();
  check('already-green initial tests still call implement', TICKET.stage, 'implement');
  advance({ diff: '' });
  check('no-op implement accepts final evidence without attributing previous test commit', TICKET.stage, 'sonar_gate');
  newTicket({ stage: 'implement', test_handoff: null });
  await d.startStage(TICKET);
  check('implementation cannot start without a test contract', [TICKET.stage, NOTES.length], ['unit_test', 0]);

  console.log('\nSpecification and worker context');
  newTicket({ status: 'queued' });
  await d.startStage(TICKET);
  check('worker receives the MR specification', TICKET.worker_context.spec.specification.brief, 'Submit');
  check('worker gets current MR commit', TICKET.worker_context.expected_commit, SHA);
  check('trigger omits requirements and procedures', NOTES.at(-1).includes('Given valid input'), false);
  const firstSpec = TICKET.spec_snapshot;
  const modified = spec.parseDescription(remoteDescription);
  modified.acceptance_criteria[0].text = 'Given valid input, When submitted, Then it is audited';
  remoteDescription = remoteDescription.replace('Given valid input, When submitted, Then it succeeds', modified.acceptance_criteria[0].text);
  TICKET = { ...TICKET, stage: 'implement', status: 'queued' };
  await d.startStage(TICKET);
  check('changed requirements restart test authoring', [TICKET.stage, TICKET.test_handoff], ['unit_test', null]);
  check('requirements edit increments specification revision', TICKET.spec_snapshot.revision, firstSpec.revision + 1);
  await d.startStage(TICKET);
  check('new authoring run reads changed criteria', TICKET.worker_context.spec.specification.acceptance_criteria[0].text, modified.acceptance_criteria[0].text);
  check('authoring restart does not consume failure budget', TICKET.implement_attempts, 0);
  const repeated = spec.snapshotMr({ description: remoteDescription, iid: 999, sha: SHA }, TICKET.spec_snapshot);
  check('same requirements retain revision', repeated.revision, TICKET.spec_snapshot.revision);
  remoteDescription = remoteDescription.replace('audited', 'persisted');
  TASKS = [{ id: 'completed', source: 'gitlab-webhook', mr_iid: '999', task_type: 'unit-test',
    pipeline_trigger_id: TICKET.worker_trigger, pipeline_context: TICKET.worker_context,
    status: 'completed', received_at: 'z', run_dir: makeRun() }];
  await d.processTicket(TICKET);
  check('requirements changed during worker run invalidate its evidence', [TICKET.stage, TICKET.status], ['unit_test', 'queued']);
  newTicket({ stage: 'e2e_verify', status: 'paused', sonar_gate_result: { passed: true }, validated_commit: SHA });
  TICKET.spec_snapshot = spec.snapshotMr({ description: remoteDescription, iid: 999, sha: SHA });
  remoteDescription = remoteDescription.replace('Then it succeeds', 'Then it is persisted');
  res = await verdict(true, {});
  check('manual pass cannot approve changed requirements', [res.code, TICKET.stage], [409, 'unit_test']);
  newTicket({ status: 'queued' });
  remoteDescription = 'An existing MR description';
  await d.startStage(TICKET);
  check('legacy description retained when publishing initial spec', remoteDescription.startsWith('An existing MR description'), true);
  check('legacy criteria get a specification', TICKET.spec_snapshot.revision, 1);
  TICKET.status = 'queued'; remoteDescription = 'Broken new-format description';
  await d.startStage(TICKET);
  check('removed specification fails closed instead of reverting to triage', TICKET.stage, 'blocked');

  console.log('\nCompiler and test evidence rejects false positives');
  newTicket(); advance(missingRun('CS1002'));
  check('syntax errors stay with test author', TICKET.stage, 'unit_test');
  check('test defects spend an attempt', TICKET.implement_attempts, 1);
  newTicket(); advance(missingRun('CS0246', 'SubmissionService', { production_build: { passed: false } }));
  check('broken production baseline blocks for recovery', TICKET.stage, 'blocked');
  newTicket();
  const wrong = missingRun(); wrong.validation.build.diagnostics[0].message = "The type 'Typo' could not be found";
  advance(wrong); check('undeclared missing symbol is rejected', TICKET.stage, 'unit_test');
  newTicket();
  const member = missingRun('CS1061', 'Submit');
  member.validation.build.diagnostics[0].message = "'Service' does not contain a definition for 'Submit'";
  advance(member); check('declared missing member is accepted', TICKET.stage, 'implement');
  newTicket(); member.plan.missing_contracts[0].symbol = 'Service'; advance(member);
  check('existing receiver type cannot excuse a mistyped member', TICKET.stage, 'unit_test');
  newTicket(); const mixed = missingRun(); mixed.validation.build.diagnostics.push({ file: TEST_FILE, code: 'CS1002', message: '; expected' }); advance(mixed);
  check('mixed expected and unexpected errors rejected', TICKET.stage, 'unit_test');
  advance({ ...missingRun(), diff: '' });
  check('retry retains previously authored test scope for missing contracts', TICKET.stage, 'implement');
  newTicket(); advance({ plan: { criteria: [], missing_contracts: [] } });
  check('unmapped criteria rejected', TICKET.stage, 'unit_test');
  newTicket(); advance({ plan: { criteria: [null], missing_contracts: [] } });
  check('malformed plan rejected without crashing the driver', TICKET.stage, 'unit_test');
  newTicket(); advance({ validation: { build: { passed: false, error: 'dotnet not installed' } } });
  check('missing SDK blocks instead of rewriting tests', TICKET.stage, 'blocked');
  for (const patch of [{ pushed: false }, { clean: false }, { commit_unchanged: false }, { tests: null },
    { tests: summarizeTests([{ name: 'NS.Other.Test', outcome: 'Passed' }]) }]) {
    newTicket({ stage: 'implement' }); advance({ files: [PROD_FILE], validation: patch });
    check(`invalid final evidence cannot advance: ${Object.keys(patch)[0]}`, TICKET.stage, 'implement');
  }
  newTicket({ stage: 'implement' }); advance({ files: [PROD_FILE], outcome: 'NotExecuted', validation: { test_passed: true } });
  check('skipped acceptance test rejected despite exit zero', TICKET.stage, 'implement');
  newTicket({ stage: 'implement' }); advance({ files: [PROD_FILE], validation: { test_passed: false } });
  check('failed test command rejected despite passing result rows', TICKET.stage, 'implement');
  newTicket(); const absent = makeRun(); fs.unlinkSync(path.join(absent, 'validation.json'));
  d.advanceStage(TICKET, { status: 'completed', run_dir: absent });
  check('old image without final evidence cannot advance', TICKET.stage, 'unit_test');

  console.log('\nRole guards and clarification');
  newTicket(); advance({ files: [PROD_FILE] }); check('unit-test cannot modify production', TICKET.stage, 'unit_test');
  newTicket({ stage: 'implement' }); advance(); check('implement cannot modify tests', TICKET.stage, 'implement');
  newTicket(); advance({ added: '[Fact(Skip = "later")]' }); check('skipped placeholders rejected', TICKET.stage, 'unit_test');
  check('rename out of tests violates implementation ownership', guards.assertNoTestFiles(`diff --git a/${TEST_FILE} b/${PROD_FILE}`).ok, false);
  newTicket(); const esc = makeRun(); fs.writeFileSync(path.join(esc, 'needs_decision.json'), JSON.stringify({ reason: 'Criterion is ambiguous' }));
  d.advanceStage(TICKET, { status: 'completed', run_dir: esc });
  check('test author can request a decision', TICKET.stage, 'needs_decision');
  const response = { writeHead() {}, end() {} };
  routes.handlePipelineClarifyPost({}, response, { answer: 'Require validation error' }, TICKET.id);
  check('clarification resumes originating test stage', TICKET.stage, 'unit_test');

  console.log('\nSonar routing, budgets, and human feedback');
  const coverage = { passed: false, failed_conditions: [{ metricKey: 'new_coverage', status: 'ERROR' }] };
  newTicket({ stage: 'sonar_gate', implement_attempts: 2 }); d.notifySonarGateResult('999', coverage);
  check('coverage failure routes to unit_test', TICKET.stage, 'unit_test');
  check('Sonar uses separate budget', [TICKET.implement_attempts, TICKET.sonar_fix_attempts], [2, 1]);
  advance(); check('green coverage repair returns directly to Sonar', TICKET.stage, 'sonar_gate');
  TICKET.status = 'running'; d.notifySonarGateResult('999', coverage);
  check('Sonar cap blocks on second failure', TICKET.stage, 'blocked');
  newTicket({ stage: 'unit_test', resume_stage_after_unit_test: 'sonar_gate' });
  advance({ plan: { criteria: [], missing_contracts: [] } });
  check('test-author retry preserves Sonar repair mode', TICKET.resume_stage_after_unit_test, 'sonar_gate');
  advance(); check('repaired test-author output returns to Sonar', TICKET.stage, 'sonar_gate');
  newTicket({ stage: 'sonar_gate', validated_commit: SHA }); remoteSha = 'b'.repeat(40);
  await d.startStage(TICKET); check('changed MR before Sonar requeues implementation validation', TICKET.stage, 'implement');
  newTicket({ stage: 'sonar_gate' }); d.notifySonarGateResult('999', { passed: false, failed_conditions: [{ metricKey: 'new_reliability_rating' }] });
  check('production quality failure routes to implement', TICKET.stage, 'implement');
  newTicket({ stage: 'sonar_gate' }); d.notifySonarGateResult('999', { passed: false, error: 'scanner unavailable' });
  check('scanner failure blocks instead of changing tests', TICKET.stage, 'blocked');
  res = await verdict(true, {}); check('Sonar cannot be force-passed', res.code, 409);
  newTicket({ stage: 'e2e_verify', status: 'paused', validated_commit: SHA, sonar_gate_result: { passed: true } });
  res = await verdict(false, {}); check('manual failure requires feedback', res.code, 400);
  res = await verdict(false, { feedback: 'Submit button fails' });
  check('manual failure routes to implementation', res.body.stage, 'implement');
  advance({ files: [PROD_FILE] }); check('E2E fix repeats Sonar', TICKET.stage, 'sonar_gate');
  newTicket({ stage: 'e2e_verify', status: 'paused', implement_attempts: 2, sonar_gate_result: { passed: true } });
  res = await verdict(false, { feedback: 'Still broken' });
  check('manual failure response reports exhausted budget honestly', [res.body.stage, res.body.status], ['blocked', 'stage_failed']);
  newTicket({ stage: 'e2e_verify', status: 'paused', validated_commit: SHA, sonar_gate_result: { passed: true } }); remoteSha = 'b'.repeat(40);
  res = await verdict(true, {}); check('changed MR cannot use old human verdict', [res.code, TICKET.stage], [409, 'implement']);
  newTicket({ stage: 'e2e_verify', status: 'queued', sonar_gate_result: { passed: true }, triage: { verification_method: 'unit_test_only' } });
  await d.startStage(TICKET); check('unit-test-only tickets still await human acceptance', TICKET.status, 'paused');

  console.log('\nMigration and task correlation');
  check('completed history unchanged', migrateTicket({ stage: 'done' }), { stage: 'done' });
  check('old review stage maps to final manual acceptance', migrateTicket({ stage: 'ready_for_review', sonar_gate_result: { passed: true } }).stage, 'e2e_verify');
  check('old E2E without Sonar requeues Sonar', migrateTicket({ stage: 'e2e_verify', status: 'paused' }).stage, 'sonar_gate');
  check('old queued implementation starts with tests', migrateTicket({ stage: 'implement', status: 'queued' }).stage, 'unit_test');
  newTicket({ legacy_worker: true });
  TASKS = [{ id: 'old', source: 'gitlab-webhook', mr_iid: '999', task_type: 'unit-test', received_at: 'z', status: 'completed' }];
  TICKET.updated_at = 'a'; d.processTicket(TICKET);
  check('completed old worker requests fresh evidence', [TICKET.stage, TICKET.status, TICKET.legacy_worker], ['unit_test', 'queued', false]);
  newTicket({ worker_trigger: 'ours' }); TASKS = [{ source: 'gitlab-webhook', mr_iid: '999', task_type: 'unit-test', received_at: 'z', status: 'completed', pipeline_trigger_id: 'someone-else' }];
  d.processTicket(TICKET); check('unrelated MR worker cannot advance pipeline', TICKET.status, 'running');

  console.log('\nCompiler and TRX parsing');
  check('compiler duplicates deduplicated', parseDiagnostics(`${TEST_FILE}(4,2): error CS0246: The type 'Foo' is missing [Tests.csproj]\n${TEST_FILE}(4,2): error CS0246: The type 'Foo' is missing [Tests.csproj]`).length, 1);
  check('nested test classes use stable dotted names', parseTrx(trx().replace('NS.FooTests', 'NS.FooTests+ActionTests'))[0].name, 'NS.FooTests.ActionTests.Action_Valid_Succeeds');
  check('TRX identities resolve to method names', parseTrx(trx()), [{ name: TEST, outcome: 'Passed' }]);
  check('truncated TRX rejected', parseTrx(trx().replace('</TestRun>', '')), null);
  check('missing TRX definition rejected', parseTrx(trx().replace('testId="id1"', 'testId="missing"')), null);
  check('TRX counts must match result rows', parseTrx(trx().replace('total="1"', 'total="2"')), null);
  const theory = { ...plan(), criteria: [{ criterion: 1, tests: [TEST] }] };
  check('all theory rows must pass', evidence.checkExecution(theory, { test_passed: true,
    tests: summarizeTests([{ name: TEST, outcome: 'Passed' }, { name: TEST, outcome: 'Failed' }]) }, true).includes('failed'), true);

  console.log('\nSonar client and webhook integration without network');
  const { EventEmitter } = require('events');
  const requests = [];
  const fakeTransport = { request(options, callback) {
    requests.push(options.path);
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter(); res.statusCode = 200; callback(res);
      const body = options.path.startsWith('/api/ce/task') ? { task: { status: 'SUCCESS', analysisId: 'analysis-123' } }
        : options.path.startsWith('/api/qualitygates/') ? { projectStatus: { status: 'ERROR', conditions: [{ metricKey: 'new_coverage', status: 'ERROR' }] } }
        : options.path.startsWith('/api/measures/component_tree') ? { components: [] }
        : options.path.startsWith('/api/measures/component') ? { component: { measures: [] } }
        : { issues: [], total: 0 };
      res.emit('data', JSON.stringify(body)); res.emit('end');
    };
    return req;
  } };
  function isolatedModule(relative, overrides) {
    const filename = path.join(ROOT, relative);
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = mod.require.bind(mod);
    mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name);
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
    return mod.exports;
  }
  const sonar = isolatedModule('lib/sonar.js', { http: fakeTransport, https: fakeTransport });
  const gate = await sonar.postSonarSummaryComment('999', 'ce-123');
  check('Sonar gate queried for the completed analysis', requests.includes('/api/qualitygates/project_status?analysisId=analysis-123'), true);
  check('Sonar returns structured failed metrics for routing', gate.failed_conditions[0].metricKey, 'new_coverage');
  check('Sonar ERROR is not a successful stage', gate.passed, false);
  let callbackArgs, scanOutput = '', summaryTask;
  const marker = '11111111-1111-1111-1111-111111111111';
  const webhook = isolatedModule('lib/gitlab-webhook.js', {
    child_process: { exec: (cmd, opts, callback) => callback(null, scanOutput, '') },
    './pipeline-driver': { notifySonarGateResult: (...args) => { callbackArgs = args; } },
    './sonar': { postSonarSummaryComment: async (mr, taskId) => { summaryTask = taskId; return { passed: true }; } },
  });
  const payload = mention => ({ object_kind: 'note', user: { username: 'pipeline' },
    object_attributes: { noteable_type: 'MergeRequest', note: `@${mention}\n<!-- pipeline-trigger:${marker} -->` },
    merge_request: { iid: 999, source_branch: 'feature/test', target_branch: 'main' } });
  newTicket({ worker_trigger: marker, worker_context: workerContext(TICKET, SHA) });
  const task = webhook.handleGitlabWebhook(payload('UnitTest'));
  check('webhook persists the worker trigger ID', task.pipeline_trigger_id, marker);
  webhook.handleGitlabWebhook(payload('Sonar'));
  check('pipeline scan without CE task ID fails closed', callbackArgs[1].error, 'scanner returned no analysis task ID');
  scanOutput = 'api/ce/task?id=baseline-task\napi/ce/task?id=pr-task';
  webhook.handleGitlabWebhook(payload('Sonar'));
  await new Promise(resolve => setImmediate(resolve));
  check('scanner waits for PR analysis, not baseline analysis', summaryTask, 'pr-task');
  check('Sonar callback carries the matching trigger ID', callbackArgs[2], marker);

  console.log('\nWorker integration with local git and fake dotnet');
  const repo = path.join(tmp, 'repo'), bare = path.join(tmp, 'remote.git'), artifacts = path.join(tmp, 'artifacts'), bin = path.join(tmp, 'bin');
  for (const dir of [repo, artifacts, bin]) fs.mkdirSync(dir);
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', bare]); git(['init']); git(['config', 'user.email', 'test@example.test']); git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'file.cs'), '// initial\n'); git(['add', '.']); git(['commit', '-m', 'initial']);
  const start = git(['rev-parse', 'HEAD']); git(['remote', 'add', 'origin', bare]); git(['push', '-u', 'origin', 'HEAD']);
  const dotnet = path.join(bin, 'dotnet');
  fs.writeFileSync(dotnet, `#!${process.execPath}\nconst fs=require('fs'),path=require('path'); const args=process.argv.slice(2); if(args[0]==='test'){const out=args[args.indexOf('--results-directory')+1];fs.writeFileSync(path.join(out,'result.trx'),${JSON.stringify(trx())});} process.exit(0);\n`, { mode: 0o755 });
  const oldPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    let result = validateRun(repo, artifacts, 'unit-test', start);
    check('wrapper captures successful pushed revision', [result.pushed, result.clean, result.test_passed, result.tests.passed], [true, true, true, 1]);
    check('no-op run diff is empty', fs.readFileSync(path.join(artifacts, 'changes.diff'), 'utf8'), '');
    fs.appendFileSync(path.join(repo, 'file.cs'), '// uncommitted\n');
    result = validateRun(repo, artifacts, 'review-feedback', start);
    check('wrapper detects uncommitted code', result.clean, false);
    git(['add', '.']); git(['commit', '-m', 'change']);
    result = validateRun(repo, artifacts, 'review-feedback', start);
    check('wrapper detects unpushed revision', result.pushed, false);
    git(['push']);
    result = validateRun(repo, artifacts, 'review-feedback', start);
    check('wrapper captures whole run diff', fs.readFileSync(path.join(artifacts, 'changes.diff'), 'utf8').includes('+// uncommitted'), true);
    fs.writeFileSync(dotnet, `#!${process.execPath}\nif(process.argv.includes('Example.sln')) { console.log("/workspace/repo/tests/FooTests.cs(4,2): error CS0246: The type 'SubmissionService' could not be found"); process.exit(1); } process.exit(0);\n`, { mode: 0o755 });
    result = validateRun(repo, artifacts, 'unit-test', start);
    check('wrapper preserves expected red as evidence, not a process crash', [result.production_build.passed, result.build.passed, result.tests], [true, false, null]);
    check('wrapper captures real compiler diagnostics from command output', result.build.diagnostics[0].code, 'CS0246');
    check('failed compilation never reuses earlier passing TRX results', result.test_passed, false);

  } finally { process.env.PATH = oldPath; }
  console.log(`\nAll ${checks} flow checks passed.\n`);
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
