const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      process.env[key.trim()] = val.join('=').trim();
    }
  });
}

const PORT = 3333;

const { logUnauthorized, sessionFromRequest, originAllowed, validateRequest, describeClient } = require('./lib/auth');
const { handleLoginPost, handleLogout, handleLoginGet } = require('./routes/auth-routes');
const { isPublicUiAsset, handlePublicUiAsset } = require('./routes/ui-routes');
const { dispatch } = require('./routes');
const { reconcileTasksFromArtifacts, reconcileRunningContainers } = require('./lib/task-reconcile');
const { startPipelineDriver } = require('./lib/pipeline-driver');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Only GET and POST are served; everything else (PUT/DELETE/PATCH/TRACE/...) is refused
    // before any routing or auth work happens.
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, POST' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    // --- Unauthenticated by definition: login flow must be reachable pre-auth-gate ---
    if (req.method === 'POST' && req.url === '/login') return handleLoginPost(req, res, body);
    if (req.method === 'POST' && req.url === '/logout') return handleLogout(req, res);
    if (req.method === 'GET' && (req.url === '/login' || req.url === '/login.js')) return handleLoginGet(req, res);
    if (req.method === 'GET' && isPublicUiAsset(req.url)) return handlePublicUiAsset(req, res);

    // Every endpoint requires auth — GET included. Artifacts and transcripts contain
    // full source diffs, so read access is not public.
    if (!validateRequest(req, req.headers)) {
      logUnauthorized(req);
      // Browsers navigating to a page get the login form; API clients get JSON.
      const wantsHtml = (req.headers['accept'] || '').includes('text/html');
      if (req.method === 'GET' && wantsHtml) {
        res.writeHead(302, { 'Location': '/login', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    // CSRF: a cookie-authenticated state-changing request must come from our own origin.
    // Header-authenticated machine clients are exempt (they send no Origin, and a
    // forged Origin buys an attacker nothing without the token).
    if (req.method === 'POST' && sessionFromRequest(req.headers) && !originAllowed(req)) {
      console.log(`\n🚫 CSRF: bad origin "${req.headers['origin'] || req.headers['referer']}" on ${req.url} — ${describeClient(req)}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad origin' }));
      return;
    }

    let payload;
    try { payload = JSON.parse(body); } catch (e) { payload = body; }

    dispatch(req, res, payload);
  });
});

// Heal any drift between tasks.json and the durable artifacts record before serving.
reconcileTasksFromArtifacts();
reconcileRunningContainers();
startPipelineDriver();

server.listen(PORT, () => {
  console.log(`🚀 Orchestrator listening on http://localhost:${PORT}`);
  console.log(`   AUTO_SPAWN=${process.env.AUTO_SPAWN || 'false'}`);
  console.log(`   Dashboard: http://localhost:${PORT}/turns`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /               - Dashboard`);
  console.log(`     POST /task            - Teams/Discord tasks`);
  console.log(`     POST /gitlab-webhook  - GitLab MR events`);
  console.log(`     POST /spawn/:id       - spawn agent`);
  console.log(`     GET  /tasks           - list tasks`);
});
