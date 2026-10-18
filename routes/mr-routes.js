const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function serveFile(res, file, contentType) {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

// --- GET /mr ---
function handleMrPage(req, res) {
  serveFile(res, 'mr.html', 'text/html');
}

// --- GET /mr.js — styling reuses turns.css (served by turns-routes.js), no separate
// mr.css needed since the MR table's classes (turns-table, tasks-header, live-badge,
// mr-trigger-list) already live there. ---
function handleMrAsset(req, res) {
  const map = {
    '/mr.js': ['mr.js', 'application/javascript'],
  };
  const [file, contentType] = map[req.url];
  serveFile(res, file, contentType);
}

module.exports = { handleMrPage, handleMrAsset };
