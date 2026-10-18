// Runs after Claude exits. Its output describes the final checkout, never the
// model's report or an earlier successful command followed by more edits.
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

function parseDiagnostics(output) {
  const diagnostics = [];
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*?)\s*:\s*error\s+([A-Z]+\d+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const file = match[1].replace(/\(\d+,\d+(?:,\d+,\d+)?\)$/, '').replace(/\\/g, '/');
    const message = match[3].replace(/\s+\[[^\]]+\]\s*$/, '');
    const key = `${file}:${match[2]}:${message}`;
    if (!seen.has(key)) diagnostics.push({ file, code: match[2], message });
    seen.add(key);
  }
  return diagnostics;
}

function attributes(text) {
  const result = {};
  for (const m of text.matchAll(/([\w:]+)="([^"]*)"/g)) {
    result[m[1]] = m[2].replace(/&(quot|apos|lt|gt|amp);/g,
      (_, name) => ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[name]);
  }
  return result;
}

function parseTrx(xml) {
  if (!/<TestRun\b/.test(xml) || !/<\/TestRun>/.test(xml)) return null;
  const definitions = new Map();
  for (const m of xml.matchAll(/<UnitTest\b([^>]*)>([\s\S]*?)<\/UnitTest>/g)) {
    const method = /<TestMethod\b([^>]*)\/?\s*>/.exec(m[2]);
    if (!method) continue;
    const a = attributes(method[1]);
    if (a.className && a.name) definitions.set(attributes(m[1]).id,
      `${a.className.split(',')[0]}.${a.name}`.replace(/\+/g, '.'));
  }
  const results = [];
  for (const m of xml.matchAll(/<UnitTestResult\b([^>]*)>/g)) {
    const a = attributes(m[1]);
    const name = definitions.get(a.testId);
    if (!name) return null;
    results.push({ name, outcome: a.outcome });
  }
  const counters = /<Counters\b([^>]*)\/?\s*>/.exec(xml);
  if (!counters) return null;
  const c = attributes(counters[1]);
  const total = Number(c.total);
  if (!Number.isInteger(total) || total !== results.length || !total) return null;
  return results;
}

function summarizeTests(results) {
  return {
    passed: results.filter(r => r.outcome === 'Passed').length,
    failed: results.filter(r => r.outcome !== 'Passed' && r.outcome !== 'NotExecuted').length,
    skipped: results.filter(r => r.outcome === 'NotExecuted').length,
    total: results.length,
    failing_names: [...new Set(results.filter(r => r.outcome === 'Failed').map(r => r.name))],
    results,
  };
}

function validateRun(repo, artifacts, taskType, startCommit) {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  // All commits made in this run, not HEAD~1 (which belongs to UnitTest when
  // implement makes no commit). Uncommitted changes are rejected below.
  fs.writeFileSync(path.join(artifacts, 'changes.diff'), git(['diff', startCommit, 'HEAD']));
  const branch = git(['branch', '--show-current']);
  const result = { version: 1, commit_sha: commit, branch, checked_at: new Date().toISOString() };
  function dotnet(args, logName) {
    const log = path.join(artifacts, logName);
    const fd = fs.openSync(log, 'w');
    let run;
    try {
      run = spawnSync('dotnet', args, { cwd: repo, stdio: ['ignore', fd, fd], timeout: 10 * 60 * 1000 });
    } finally { fs.closeSync(fd); }
    return { passed: run.status === 0 && !run.error, exit_code: run.status,
      error: run.error?.message || null, diagnostics: parseDiagnostics(fs.readFileSync(log, 'utf8')) };
  }
  // A missing production contract in TEST code is allowed; a broken production
  // project or dependency restore is not evidence of a valid red test.
  if (taskType === 'unit-test') {
    result.production_build = dotnet(['build', process.env.DOTNET_PRODUCTION_PROJECT || process.env.DOTNET_SOLUTION || ''], 'production-build.log');
  }
  result.build = dotnet(['build', process.env.DOTNET_SOLUTION || ''], 'build.log');
  result.tests = null;
  result.test_passed = false;
  if (result.build.passed) {
    const resultsDir = fs.mkdtempSync(path.join(artifacts, 'test-results-'));
    const test = dotnet(['test', process.env.DOTNET_SOLUTION || '', '--no-build', '--no-restore',
      '--logger', 'trx', '--results-directory', resultsDir], 'test.log');
    const reports = fs.readdirSync(resultsDir).filter(f => f.endsWith('.trx'));
    const parsed = reports.map(f => parseTrx(fs.readFileSync(path.join(resultsDir, f), 'utf8')));
    result.test_passed = test.passed;
    result.test_error = test.error;
    if (parsed.length && parsed.every(Boolean)) result.tests = summarizeTests(parsed.flat());
  }
  result.clean = git(['status', '--porcelain']).length === 0;
  result.commit_unchanged = git(['rev-parse', 'HEAD']) === commit;
  try {
    result.pushed = git(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0] === commit;
  } catch { result.pushed = false; }
  fs.writeFileSync(path.join(artifacts, 'validation.json'), JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  validateRun('/workspace/repo', process.argv[2], process.argv[3], process.argv[4]);
}
module.exports = { parseDiagnostics, parseTrx, summarizeTests, validateRun };
