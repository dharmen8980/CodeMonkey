const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function serveFile(res, file, contentType, extraHeaders = {}) {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

// --- GET /chat + /chat.js ---
// Strict CSP: no inline script, no external anything. The client renders all
// model output via textContent, and this policy is the backstop if that ever slips.
function handleChatPage(req, res) {
  const isJs = req.url === '/chat.js';
  serveFile(res, isJs ? 'chat.js' : 'chat.html', isJs ? 'application/javascript' : 'text/html', {
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; " +
      "connect-src 'self'; img-src 'self' data:; form-action 'none'; " +
      "base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
}

// Compatibility page for servers still running the old / and /dashboard route table.
function handleDashboard(req, res) {
  serveFile(res, 'dashboard.html', 'text/html', {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
}

// --- GET /dashboard.css, /dashboard.js, /dashboard-mobile.css ---
function handleDashboardAsset(req, res) {
  const map = {
    '/dashboard.css': ['dashboard.css', 'text/css'],
    '/dashboard-mobile.css': ['dashboard-mobile.css', 'text/css'],
    '/dashboard.js': ['dashboard.js', 'application/javascript'],
  };
  const [file, contentType] = map[req.url];
  serveFile(res, file, contentType);
}

// --- Default (unmatched route) ---
function handleDefault(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Orchestrator running.
  POST /task                    - receive tasks from Teams/Discord
  POST /gitlab-webhook          - receive GitLab MR events
  POST /spawn/:id               - manually spawn agent for a task
  GET  /tasks                   - list all tasks
  GET  /artifacts/:runId/:file  - view run artifacts
  GET  /                        - tasks and run analysis`);
}

module.exports = {
  handleChatPage, handleDashboard, handleDashboardAsset, handleDefault,
};
