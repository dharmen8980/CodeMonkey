const fs = require('fs');
const path = require('path');

const { ARTIFACTS_DIR } = require('../lib/config');

const ALLOWED_FILES = [
  'stdout.log',
  'transcript.jsonl',
  'events.jsonl',
  'changes.diff',
  'usage.json',
  'manifest.json',
  'result.json',
  'error.json',
  'last-raw.json',
  'claude-stderr.log',
  'clone-stderr.log',
  'task.json',
  'test-plan.json',
  'spec.json',
  'handoff.json',
  'feedback.json',
  'request.json',
  'run-context.json',
  'changed-files.txt',
  'instructions.md',
  'instruction-manifest.json',
  'instruction-references.json',
  'validation.json',
  'needs_decision.json',
  'production-build.log',
  'build.log',
  'test.log',
];

// --- GET /artifacts/:runId/:file ---
function handleArtifactGet(req, res) {
  const parts = req.url.replace('/artifacts/', '').split('/');
  const runId = parts[0];
  const fileName = parts.slice(1).join('/');

  // runId must match the generated format exactly — it is interpolated into a
  // filesystem path, so anything else (../, absolute paths) is rejected outright.
  if (!/^[a-f0-9]{16}$/.test(runId || '') || !ALLOWED_FILES.includes(fileName)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const filePath = path.join(ARTIFACTS_DIR, runId, fileName);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('File not found');
    return;
  }
  const ext = path.extname(fileName);
  const contentType = ext === '.json' || ext === '.jsonl' ? 'application/json' : 'text/plain';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = { handleArtifactGet };
