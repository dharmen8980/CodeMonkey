const fs = require('fs');
const path = require('path');

const {
  SESSION_COOKIE, SESSION_TTL_MS, LOGIN_MAX_ATTEMPTS,
  secretMatches, clientIp, describeClient, createSession, sessionFromRequest,
  deleteSession, loginLocked, recordLoginFailure, clearLoginFailures, originAllowed,
} = require('../lib/auth');

// --- POST /login (unauthenticated by definition) ---
function handleLoginPost(req, res, body) {
  const ip = clientIp(req);
  if (!originAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad origin' }));
    return;
  }
  if (loginLocked(ip)) {
    console.log(`\n🚫 Login locked out — ${describeClient(req)}`);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'too many attempts, try later' }));
    return;
  }

  let creds = {};
  try { creds = JSON.parse(body); } catch { creds = {}; }

  const expectedUser = process.env.CHAT_USER || 'admin';
  const expectedToken = process.env.CHAT_TOKEN;
  if (!expectedToken) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'CHAT_TOKEN not configured' }));
    return;
  }

  const okUser = secretMatches(String(creds.username || ''), expectedUser);
  const okToken = secretMatches(String(creds.token || ''), expectedToken);
  if (!okUser || !okToken) {
    const rec = recordLoginFailure(ip);
    const left = Math.max(0, LOGIN_MAX_ATTEMPTS - rec.count);
    console.log(`\n🚫 Failed login (${rec.count}/${LOGIN_MAX_ATTEMPTS}) — ${describeClient(req)}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid credentials', attempts_left: left }));
    return;
  }

  clearLoginFailures(ip);
  const sid = createSession(expectedUser);
  console.log(`\n🔓 Login OK — ${describeClient(req)}`);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: true }));
}

// --- POST /logout ---
function handleLogout(req, res) {
  const s = sessionFromRequest(req.headers);
  if (s) deleteSession(s.id);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  });
  res.end(JSON.stringify({ ok: true }));
}

// --- GET /login + /login.js (must be reachable unauthenticated) ---
function handleLoginGet(req, res) {
  const isJs = req.url === '/login.js';
  const file = isJs ? 'login.js' : 'login.html';
  const body = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  res.writeHead(200, {
    'Content-Type': isJs ? 'application/javascript' : 'text/html',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; " +
      "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

module.exports = { handleLoginPost, handleLogout, handleLoginGet };
