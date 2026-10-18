const fs = require('fs');
const path = require('path');
const { buildTriageLog } = require('../lib/pipeline/triage-log');
const { buildLiveTriageRuns } = require('../lib/pipeline/triage-live');

const ROOT = path.join(__dirname, '..');

function serveFile(res, file, contentType) {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

// --- GET /triage ---
function handleTriagePage(req, res) {
  serveFile(res, 'triage.html', 'text/html');
}

// --- GET /triage.js, /triage.css ---
function handleTriageAsset(req, res) {
  const map = {
    '/triage.js': ['triage.js', 'application/javascript'],
    '/triage.css': ['triage.css', 'text/css'],
  };
  const [file, contentType] = map[req.url];
  serveFile(res, file, contentType);
}

// --- GET /api/triage — every triage run across every ticket, newest first ---
function handleTriageApiGet(req, res) {
  const runs = buildTriageLog();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ runs }));
}

// --- GET /api/triage/live — currently-running triage runs only, cheap enough to poll ---
function handleTriageLiveApiGet(req, res) {
  const runs = buildLiveTriageRuns();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ runs }));
}

module.exports = { handleTriagePage, handleTriageAsset, handleTriageApiGet, handleTriageLiveApiGet };
