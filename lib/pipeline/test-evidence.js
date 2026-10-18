const fs = require('fs');
const path = require('path');
const { TEST_PROJECT_PREFIX } = require('./diff-guards');

function readJson(runDir, file) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, file), 'utf8')); }
  catch { return null; }
}

function readValidation(runDir) {
  const v = readJson(runDir, 'validation.json');
  if (!v || v.version !== 1 || !/^[a-f0-9]{40}$/.test(v.commit_sha || '')
    || v.clean !== true || v.commit_unchanged !== true || v.pushed !== true) return null;
  return v;
}

function validateTestPlan(plan, criteria) {
  if (!Array.isArray(criteria) || !criteria.length || !Array.isArray(plan?.criteria) || !Array.isArray(plan?.missing_contracts)) {
    return 'test-plan.json must map every acceptance criterion and list missing_contracts';
  }
  const seen = new Set();
  for (const item of plan.criteria) {
    if (!item || !Number.isInteger(item.criterion) || item.criterion < 1 || item.criterion > criteria.length
      || seen.has(item.criterion) || !Array.isArray(item.tests) || !item.tests.length
      || item.tests.some(t => typeof t !== 'string' || !/^[\w+]+(?:\.[\w+]+)+$/.test(t))) {
      return 'invalid criterion number or fully qualified test method in test-plan.json';
    }
    seen.add(item.criterion);
  }
  if (seen.size !== criteria.length) return 'test-plan.json leaves acceptance criteria uncovered';
  for (const c of plan.missing_contracts) {
    if (!c || !Number.isInteger(c.criterion) || !seen.has(c.criterion) || typeof c.symbol !== 'string'
      || !/^[\w.]+$/.test(c.symbol) || typeof c.reason !== 'string' || !c.reason.trim()) {
      return 'each missing contract needs a symbol, criterion number, and explanation';
    }
  }
  return null;
}

function expectedTests(plan) {
  return [...new Set(plan.criteria.flatMap(c => c.tests).map(t => t.replace(/\+/g, '.')))];
}

function checkExecution(plan, validation, requireGreen) {
  const counts = validation.tests;
  if (!counts || !Array.isArray(counts.results) || !counts.total || counts.total !== counts.results.length) {
    return 'no complete TRX test results; cannot prove the tests executed';
  }
  for (const name of expectedTests(plan)) {
    const results = counts.results.filter(r => r.name === name);
    if (!results.length) return `acceptance test was not discovered: ${name}`;
    if (results.some(r => !['Passed', 'Failed'].includes(r.outcome))) return `acceptance test did not execute: ${name}`;
    if (requireGreen && results.some(r => r.outcome !== 'Passed')) return `acceptance test failed: ${name}`;
  }
  if (requireGreen && (!validation.test_passed || counts.failed > 0 || counts.passed < 1)) {
    return 'the full test suite must pass';
  }
  if (!requireGreen && !validation.test_passed && counts.failed === 0) return 'test runner failed without assertion failures';
  return null;
}

// These codes are candidates, not a blanket allowlist. Every diagnostic must be
// in a changed test file and name a contract explicitly tied to a criterion.
const MISSING_CONTRACT_CODES = new Set(['CS0246', 'CS0234', 'CS0103', 'CS1061', 'CS0117', 'CS1729', 'CS1501', 'CS1739']);
function checkMissingContracts(plan, validation, files) {
  if (!validation.production_build?.passed) return 'production build failed; this is not an expected missing test contract';
  const diagnostics = validation.build?.diagnostics;
  if (!diagnostics?.length) return 'build failed without compiler diagnostics';
  for (const d of diagnostics) {
    const file = d.file.replace(/\\/g, '/').split(TEST_PROJECT_PREFIX).slice(-1)[0];
    const relativeFile = `${TEST_PROJECT_PREFIX}${file}`;
    const symbols = [...d.message.matchAll(/'([^']+)'/g)].map(m => m[1]);
    const missingSymbol = ['CS1061', 'CS0117'].includes(d.code) ? symbols[1] : symbols[0];
    if (!d.file.includes(TEST_PROJECT_PREFIX) || !files.includes(relativeFile)
      || !MISSING_CONTRACT_CODES.has(d.code)
      || !plan.missing_contracts.some(c => missingSymbol === c.symbol)) {
      return `unexpected compiler error: ${d.code} ${d.message}`;
    }
  }
  return null;
}

module.exports = { readJson, readValidation, validateTestPlan, expectedTests, checkExecution, checkMissingContracts };
