const fs = require('fs');
const path = require('path');

// Shared, cross-cutting config used by task persistence, agent spawning, and the
// artifact/stream routes. Kept separate from server.js so nothing needs to import
// the HTTP entrypoint just to read a constant.
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts');
const DOCKER_IMAGE = 'ai-agent';
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
// $5 hard ceiling on tracked (input + cache) cost. This is not the same as real
// total spend — hidden reasoning/output tokens aren't visible until the run's
// own final summary and can add meaningfully more on top (observed 9-40% of
// total cost across historical runs) — accepted trade-off for a live-killable
// signal instead of one only known after the fact.
const COST_LIMIT_USD = 5;

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR);
}

module.exports = { ARTIFACTS_DIR, DOCKER_IMAGE, TIMEOUT_MS, COST_LIMIT_USD };
