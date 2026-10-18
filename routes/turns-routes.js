const fs = require('fs');
const path = require('path');
const { analyzeRecentTasks, analyzeLiveTasks, getToolCallDetail, getInitialPrompt } = require('../lib/turn-analysis');

const ROOT = path.join(__dirname, '..');

function serveFile(res, file, contentType) {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

// --- GET /turns ---
function handleTurnsPage(req, res) {
  serveFile(res, 'turns.html', 'text/html');
}

// --- GET /turns.js, /turns.css ---
function handleTurnsAsset(req, res) {
  const map = {
    '/turns.js': ['turns.js', 'application/javascript'],
    '/turns.css': ['turns.css', 'text/css'],
  };
  const [file, contentType] = map[req.url];
  serveFile(res, file, contentType);
}

// --- GET /api/turns[?limit=N] ---
// Classifies every tool call in every run's transcript into a phase (discovery /
// edit / build_test / git / other) so we can see where turns go without reading
// each transcript by hand. Every run here came from our own orchestrator script,
// not some open-ended external volume, so "all of it" is the right default —
// ?limit=N is there only if we ever want to look at a smaller recent window.
function handleTurnsApiGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : Infinity;
  const data = analyzeRecentTasks(limit);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// --- GET /api/turns/live — currently-running tasks only, cheap enough to poll ---
function handleTurnsLiveApiGet(req, res) {
  const data = analyzeLiveTasks();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// --- GET /api/turns/tool?run_id=&tool_use_id= — full input/result for one tool call ---
function handleToolDetailApiGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const runId = url.searchParams.get('run_id') || '';
  const toolUseId = url.searchParams.get('tool_use_id') || '';
  const detail = getToolCallDetail(runId, toolUseId);
  if (!detail) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'tool call not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(detail));
}

// --- GET /api/turns/prompt?run_id= — the exact prompt claude -p was called with ---
function handlePromptApiGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const runId = url.searchParams.get('run_id') || '';
  const detail = getInitialPrompt(runId);
  if (!detail) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'prompt not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(detail));
}

module.exports = { handleTurnsPage, handleTurnsAsset, handleTurnsApiGet, handleTurnsLiveApiGet, handleToolDetailApiGet, handlePromptApiGet };
