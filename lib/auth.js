const crypto = require('crypto');

// --- Auth validation ---

// Constant-time compare so a wrong token leaks no timing information.
function secretMatches(candidate, secret) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const SESSION_COOKIE = 'orch_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // 12h
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

// Sessions live server-side and the cookie carries only a random id. A stolen cookie
// therefore exposes one revocable session, never the long-lived login token.
const sessions = new Map();       // sessionId -> { createdAt, lastSeen, user }
const loginAttempts = new Map();  // client key -> { count, firstAt, lockedUntil }

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// ngrok appends the true client IP to X-Forwarded-For and preserves any value the
// client sent ahead of it. Only the LAST entry is trustworthy.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

// A bare `::1` in the log tells you nothing. Label where a request actually came from
// and what client sent it, so an unauthorized line is diagnosable at a glance.
function describeClient(req) {
  const ip = clientIp(req);
  const viaTunnel = !!req.headers['x-forwarded-for'];
  const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';

  const ua = req.headers['user-agent'] || '';
  let client = 'unknown client';
  if (/GitLab/i.test(ua)) client = 'GitLab webhook';
  else if (/azure-logic-apps|PowerAutomate|Microsoft/i.test(ua)) client = 'Power Automate';
  else if (/curl|wget|node|python|Go-http/i.test(ua)) client = ua.split(/[\s/]/)[0].toLowerCase();
  else if (/iPhone|iPad/i.test(ua)) client = 'iOS browser';
  else if (/Android/i.test(ua)) client = 'Android browser';
  else if (/Mobile/i.test(ua)) client = 'mobile browser';
  else if (/Chrome|Safari|Firefox|Edg/i.test(ua)) client = 'desktop browser';

  const origin = isLocal && !viaTunnel ? 'localhost' : (viaTunnel ? `${ip} via tunnel` : ip);
  return `${origin} — ${client}`;
}

// A signed-out browser tab polls /tasks every few seconds, which would flood the console
// with identical 401s. Log the first, then collapse repeats into a periodic summary.
const unauthorizedSeen = new Map();   // key -> { count, firstAt, lastLoggedAt }
const UNAUTH_SUMMARY_MS = 60 * 1000;

function logUnauthorized(req) {
  const key = `${clientIp(req)}|${req.method}|${req.url}`;
  const now = Date.now();
  const rec = unauthorizedSeen.get(key);

  if (!rec) {
    unauthorizedSeen.set(key, { count: 1, firstAt: now, lastLoggedAt: now });
    console.log(`\n🚫 Unauthorized ${req.method} ${req.url}`);
    console.log(`   from: ${describeClient(req)}`);
    console.log(`   why:  ${authFailureReason(req)}`);
    return;
  }

  rec.count += 1;
  if (now - rec.lastLoggedAt >= UNAUTH_SUMMARY_MS) {
    const mins = Math.max(1, Math.round((now - rec.firstAt) / 60000));
    console.log(`\n🚫 Unauthorized ${req.method} ${req.url} ×${rec.count} over ${mins}m — ${describeClient(req)}`);
    rec.lastLoggedAt = now;
  }
}

// Clear counters periodically so a client that fixes itself starts fresh.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of unauthorizedSeen) {
    if (v.lastLoggedAt < cutoff) unauthorizedSeen.delete(k);
  }
}, 5 * 60 * 1000).unref();

// Why a request failed auth, so "unauthorized" is actionable rather than mysterious.
function authFailureReason(req) {
  const cookies = parseCookies(req.headers['cookie']);
  const hasHeaderSecret = !!(req.headers['x-webhook-secret'] || req.headers['x-gitlab-token'] ||
    req.headers['authorization']);
  if (cookies[SESSION_COOKIE]) return 'session cookie expired or revoked — sign in again';
  if (hasHeaderSecret) return 'wrong secret in header';
  return 'no session cookie (not signed in on this browser)';
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function createSession(user) {
  pruneSessions();
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { createdAt: Date.now(), lastSeen: Date.now(), user });
  return id;
}

function sessionFromRequest(headers) {
  const id = parseCookies(headers['cookie'])[SESSION_COOKIE];
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  s.lastSeen = Date.now();
  return { id, ...s };
}

function deleteSession(id) {
  sessions.delete(id);
}

// Brute-force throttle. The public ngrok hostname is enumerable and gets scanned, so
// failed logins are counted per client and locked out rather than silently absorbed.
function loginLocked(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

function recordLoginFailure(key) {
  const rec = loginAttempts.get(key) || { count: 0, firstAt: Date.now() };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(key, rec);
  return rec;
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

// Origin/Referer is a CSRF control, not authentication — a browser cannot forge it,
// but curl can. It stops another site riding the session cookie; nothing more.
function originAllowed(req) {
  const origin = req.headers['origin'] || req.headers['referer'];
  if (!origin) return true;   // non-browser clients send neither
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && allowed.includes(host)) return true;
  return host === req.headers['host'];
}

// Machine clients (Teams, GitLab) present a shared secret as a header. Humans log in
// with username + token and ride a server-side session afterwards.
function validateRequest(req, headers) {
  const secret = process.env.WEBHOOK_SECRET;

  if (secret) {
    const bearer = headers['authorization']?.startsWith('Bearer ')
      ? headers['authorization'].slice(7)
      : null;
    if (secretMatches(headers['x-webhook-secret'], secret)) return true;
    if (secretMatches(bearer, secret)) return true;
    if (secretMatches(headers['x-gitlab-token'], secret)) return true;
  }

  if (sessionFromRequest(headers)) return true;

  // No secret configured and no session store in play → open (local dev only).
  return !secret && !process.env.CHAT_TOKEN;
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_MS, LOGIN_MAX_ATTEMPTS,
  secretMatches, parseCookies, clientIp, describeClient, logUnauthorized,
  authFailureReason, createSession, sessionFromRequest, deleteSession,
  loginLocked, recordLoginFailure, clearLoginFailures, originAllowed, validateRequest,
};
