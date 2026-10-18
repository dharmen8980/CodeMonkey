const https = require('https');
function projectId() {
  if (!process.env.GITLAB_PROJECT_PATH) throw new Error('GITLAB_PROJECT_PATH is required');
  return encodeURIComponent(process.env.GITLAB_PROJECT_PATH);
}

// Fetches an MR's real source_branch from GitLab rather than scraping it out of a
// worker's stdout — needed by the pipeline driver once raise_pr finishes, since every
// later stage (unit_test/implement/e2e_verify/sonar_gate) needs the actual branch name.
function getGitlabMr(mrIid) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: process.env.GITLAB_HOST,
      port: 443,
      path: `/api/v4/projects/${projectId()}/merge_requests/${mrIid}`,
      method: 'GET',
      headers: { 'PRIVATE-TOKEN': process.env.GLAB_TOKEN },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(`GitLab MR GET -> ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Creates a branch server-side, pointing at `ref` — no local clone needed. Used by
// the pipeline driver's scripted raise_pr stage: it never needs to look at the
// branch's contents (it just needs the branch to exist so an MR can point at it),
// so there's no reason to spawn a container/agent just to run `git checkout -b`.
function createGitlabBranch(branchName, ref) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ branch: branchName, ref });
    const options = {
      hostname: process.env.GITLAB_HOST,
      port: 443,
      path: `/api/v4/projects/${projectId()}/repository/branches`,
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': process.env.GLAB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(`GitLab branch POST -> ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Opens the draft MR itself. "Draft: " title prefix is GitLab's own convention for
// marking a new MR as draft (same thing `glab mr create --draft` does under the
// hood) — there's no separate boolean field on this endpoint.
function createGitlabMr(sourceBranch, targetBranch, title, description) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title: `Draft: ${title}`,
      description,
    });
    const options = {
      hostname: process.env.GITLAB_HOST,
      port: 443,
      path: `/api/v4/projects/${projectId()}/merge_requests`,
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': process.env.GLAB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(`GitLab MR POST -> ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postGitlabMrNote(mrIid, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ body });
    const options = {
      hostname: process.env.GITLAB_HOST,
      port: 443,
      path: `/api/v4/projects/${projectId()}/merge_requests/${mrIid}/notes`,
      method: 'POST',
      headers: {
        // Optional override — the pipeline driver posts trigger comments (@UnitTest/
        // @CodeMonkey/@Sonar) as CHAT_GLAB_TOKEN's identity instead of GLAB_TOKEN's,
        // because gitlab-webhook.js explicitly SKIPS comments authored by the
        // Code-Monkey (GLAB_TOKEN) bot to avoid loops — posting as that identity
        // would mean the trigger comment gets silently ignored.
        'PRIVATE-TOKEN': token || process.env.GLAB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(`GitLab note POST -> ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(data ? JSON.parse(data) : null);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function updateGitlabMrDescription(mrIid, description) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ description });
    const req = https.request({
      hostname: process.env.GITLAB_HOST, port: 443,
      path: `/api/v4/projects/${projectId()}/merge_requests/${mrIid}`,
      method: 'PUT', headers: { 'PRIVATE-TOKEN': process.env.GLAB_TOKEN,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`GitLab description update -> ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

module.exports = { getGitlabMr, postGitlabMrNote, createGitlabBranch, createGitlabMr, updateGitlabMrDescription };
