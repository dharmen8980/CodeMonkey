// Run with: node scripts/verify-ui-assets.js
// Exercises public asset delivery and the real server's authentication boundary
// without listening on a port, loading credentials, or starting agent workers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ui = require('../routes/ui-routes');
const authPages = require('../routes/auth-routes');
const dashboardPages = require('../routes/dashboard-routes');

function capture(handler, url) {
    const result = {};
    handler({ method: 'GET', url }, {
        writeHead(status, headers) { Object.assign(result, { status, headers }); },
        end(body) { result.body = body; },
    });
    return result;
}
const publicAssets = ['/brand.css', '/shell.js', '/theme.js', '/login.css', '/chat.css', '/activity.css',
    ...['lato-regular', 'lato-bold', 'montserrat-semibold', 'montserrat-bold'].map(name => `/assets/fonts/${name}.ttf`)];
for (const url of publicAssets) {
    assert.equal(ui.isPublicUiAsset(url), true, url);
    const response = capture(ui.handlePublicUiAsset, url);
    assert.equal(response.status, 200);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.ok(Buffer.isBuffer(response.body) && response.body.length > 0);
    if (url.endsWith('.ttf')) {
        assert.equal(response.headers['Content-Type'], 'font/ttf');
        assert.equal(response.body.readUInt32BE(0), 0x00010000, 'Font must be served as unmodified binary');
    }
}
for (const url of ['/tasks', '/api/turns', '/artifacts/123/transcript.jsonl', '/.env', '/assets/fonts/../../.env', '/assets/fonts/missing.ttf', '/brand.css/../tasks']) {
    assert.equal(ui.isPublicUiAsset(url), false, url);
    assert.equal(capture(ui.handlePublicUiAsset, url).status, 404, url);
}
for (const [handler, url] of [[authPages.handleLoginGet, '/login'], [dashboardPages.handleChatPage, '/chat']]) {
    const response = capture(handler, url);
    const csp = response.headers['Content-Security-Policy'];
    assert.ok(csp.includes("style-src 'self'") && csp.includes("font-src 'self'"));
    assert.ok(csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'));
    assert.doesNotMatch(response.body, /<style\b|<script(?![^>]*\bsrc=)/i);
}
for (const page of ['turns', 'pipeline', 'triage', 'mr', 'chat', 'login']) {
    const html = fs.readFileSync(path.join(ROOT, `${page}.html`), 'utf8');
    assert.match(html, /<script src="\/theme.js"><\/script>/, `${page}: theme must run synchronously`);
    assert.ok(html.indexOf('/theme.js') < html.indexOf('rel="stylesheet"'), `${page}: theme must precede styles`);
}
assert.match(fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8'), /location\.replace\('\/turns'\)/);

let requestHandler;
let dispatched = 0;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), {
    __dirname: ROOT,
    process: { env: {} },
    console: { log() {} },
    require(name) {
        if (name === 'http') return { createServer(handler) { requestHandler = handler; return { listen() {} }; } };
        if (name === 'fs') return { ...fs, existsSync(file) { return file.endsWith('.env') ? false : fs.existsSync(file); } };
        if (name === 'path') return path;
        if (name === './lib/auth') return {
            validateRequest(req) { return req.headers['x-test-auth'] === 'yes'; },
            logUnauthorized() {}, sessionFromRequest() { return null; }, originAllowed() { return true; }, describeClient() { return 'test'; },
        };
        if (name === './routes/auth-routes') return authPages;
        if (name === './routes/ui-routes') return ui;
        if (name === './routes') return { dispatch(req, res) { dispatched++; res.writeHead(204); res.end(); } };
        if (name === './lib/task-reconcile') return { reconcileTasksFromArtifacts() {}, reconcileRunningContainers() {} };
        if (name === './lib/pipeline-driver') return { startPipelineDriver() {} };
        throw new Error(`Unexpected server dependency: ${name}`);
    },
}, { filename: 'server.js' });
function request(method, url, headers = {}) {
    const listeners = {};
    const result = {};
    requestHandler({ method, url, headers, on(event, handler) { listeners[event] = handler; } }, {
        writeHead(status, responseHeaders) { Object.assign(result, { status, headers: responseHeaders }); },
        end(body) { result.body = body; },
    });
    listeners.end();
    return result;
}
for (const url of publicAssets) assert.equal(request('GET', url).status, 200, url);
assert.equal(request('GET', '/login').status, 200);
assert.equal(request('GET', '/api/turns').status, 401);
assert.equal(request('GET', '/artifacts/123/transcript.jsonl').status, 401);
assert.equal(request('GET', '/chat', { accept: 'text/html' }).status, 302);
assert.equal(request('POST', '/brand.css').status, 401);
assert.equal(request('DELETE', '/brand.css').status, 405);
assert.equal(dispatched, 0, 'Unauthenticated requests must never reach application routes');
assert.equal(request('GET', '/api/turns', { 'x-test-auth': 'yes' }).status, 204);
assert.equal(dispatched, 1);
console.log('UI assets: binary fonts, strict CSP, allowlisted presentation assets, and authentication boundary passed.');
