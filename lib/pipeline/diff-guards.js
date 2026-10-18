const fs = require('fs');
const path = require('path');

// Role boundaries, enforced from the one artifact that can't be talked around: the
// diff the container actually produced (entrypoint-lib/implement-phase.sh writes
// changes.diff for every run). Prompt rules alone didn't hold — MR !167's unit_test
// agent was told to write tests that fail, and instead shipped 13 `[Fact(Skip=...)]`
// shells; the implement agent that followed never removed them, because nothing said
// it couldn't just leave them there. These checks are what make "unit_test owns the
// tests, CodeMonkey owns the code" a fact rather than an instruction.

const TEST_PROJECT_PREFIX = process.env.TEST_PROJECT_PREFIX || 'tests/';

// Both sides matter: moving a test into production also changes the owned test.
function changedFiles(diff) {
  const files = [];
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (match) files.push(match[1], match[2]);
  }
  return [...new Set(files)];
}

// Added lines only (`+`, excluding the `+++` file header). Every check below is about
// what a run introduced, not what was already on the branch — a pre-existing `Skip=`
// inherited from main isn't this run's fault and shouldn't fail its gate.
function addedLines(diff) {
  return diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
}

function readChangesDiff(runDir) {
  try {
    return fs.readFileSync(path.join(runDir, 'changes.diff'), 'utf8');
  } catch {
    return null;
  }
}

// unit_test writes tests and nothing else. Without this it can "fix" a failing test by
// editing the production code under it. Test-first authoring preserves ownership.
function assertTestsOnly(diff) {
  const offenders = changedFiles(diff).filter(f => !f.startsWith(TEST_PROJECT_PREFIX));
  return {
    ok: offenders.length === 0,
    offenders,
    reason: offenders.length
      ? `unit_test touched ${offenders.length} file(s) outside ${TEST_PROJECT_PREFIX}: ${offenders.slice(0, 5).join(', ')}`
      : null,
  };
}

// The mirror rule: implement makes failing tests pass by fixing the code, never by
// editing the test. A test it believes is genuinely wrong goes through the escape
// valve (needs_decision.json) instead — see lib/pipeline-driver.js.
function assertNoTestFiles(diff) {
  const offenders = changedFiles(diff).filter(f => f.startsWith(TEST_PROJECT_PREFIX));
  return {
    ok: offenders.length === 0,
    offenders,
    reason: offenders.length
      ? `implement modified ${offenders.length} test file(s), which only unit_test may touch: ${offenders.slice(0, 5).join(', ')}`
      : null,
  };
}

// The three ways to fake a test, all observed on MR !167:
//   [Fact(Skip = "...")]           — never runs, still counts as a passing suite
//   Assert.Fail("not implemented") — a body that can never go green no matter what
//                                    the implementation does
//   an empty body                  — asserts nothing, covers nothing
// Only the first two are detectable from a diff; empty bodies are left to the prompt.
const SKIP_ATTRIBUTE = /\bSkip\s*=/;
const ASSERT_FAIL = /\bAssert\.Fail\s*\(/;

function assertNoSkips(diff) {
  const skips = [];
  const fails = [];
  for (const line of addedLines(diff)) {
    if (SKIP_ATTRIBUTE.test(line)) skips.push(line.slice(1).trim());
    else if (ASSERT_FAIL.test(line)) fails.push(line.slice(1).trim());
  }
  const parts = [];
  if (skips.length) parts.push(`${skips.length} skipped test(s) (\`Skip =\`)`);
  if (fails.length) parts.push(`${fails.length} \`Assert.Fail\` placeholder(s)`);
  return {
    ok: skips.length === 0 && fails.length === 0,
    skips,
    fails,
    reason: parts.length
      ? `added ${parts.join(' and ')} — a test that cannot run or cannot pass is not a test. First: ${(skips[0] || fails[0]).slice(0, 160)}`
      : null,
  };
}

module.exports = {
  readChangesDiff,
  changedFiles,
  assertTestsOnly,
  assertNoTestFiles,
  assertNoSkips,
  TEST_PROJECT_PREFIX,
};
