const fs = require('fs');
const path = require('path');

const { CHAT_DIR, CHAT_USAGE_FILE, chatPath } = require('./config');

function loadChatHistory(chatId) {
  const p = chatPath(chatId, 'history.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendChatHistory(chatId, entry) {
  const dir = path.join(CHAT_DIR, chatId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(chatPath(chatId, 'history.jsonl'), JSON.stringify(entry) + '\n');
}

// Every chat that has ever exchanged a message, newest-first — the source list for the
// "pick up a conversation" UI. chats/ also holds container-boot artifacts (env, ready,
// etc) for sessions that got created but never actually talked, so only directories with
// a non-empty history.jsonl are surfaced.
function listChats() {
  let dirs;
  try { dirs = fs.readdirSync(CHAT_DIR, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch { return []; }

  const chats = [];
  for (const d of dirs) {
    const chatId = d.name;
    if (!/^[a-f0-9]{16}$/.test(chatId)) continue;
    const history = loadChatHistory(chatId);
    if (!history.length) continue;
    const firstUser = history.find(e => e.role === 'user');
    const last = history[history.length - 1];
    chats.push({
      chat_id: chatId,
      title: String(firstUser?.content || '(no message)').slice(0, 80),
      last_at: last?.at || null,
      message_count: history.length,
    });
  }
  chats.sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
  return chats;
}

// Pull the just-finished turn's cost out of last-raw.json and append it to the ledger.
// Called once per turn; the file is deleted before each turn so a stale one can't be
// double-counted. Returns the recorded entry (or null if there was no cost to record).
function recordChatUsage(chatId, sessionDir, modelId) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(sessionDir, 'last-raw.json'), 'utf8'));
    const cost = Number(raw.total_cost_usd || 0);
    if (!cost) return null;
    const u = raw.usage || {};
    const entry = {
      chat_id: chatId,
      model: modelId || null,
      cost_usd: cost,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(CHAT_USAGE_FILE, JSON.stringify(entry) + '\n');
    return entry;
  } catch { return null; }   // no envelope / unreadable — nothing to record
}

function loadChatUsage() {
  try {
    return fs.readFileSync(CHAT_USAGE_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// --- Claude session continuity ---
// We store the claude session id per chat so turn 2+ can `--resume` it for full-fidelity
// memory. That native session lives INSIDE the container, so it's only valid while THIS
// container is alive — it's cleared on a fresh boot and re-learned from disk on adopt.
function claudeSessionPath(chatId) {
  return path.join(CHAT_DIR, chatId, 'claude-session');
}
function loadClaudeSession(chatId) {
  try { return fs.readFileSync(claudeSessionPath(chatId), 'utf8').trim() || null; }
  catch { return null; }
}
function persistClaudeSession(chatId, sessionId) {
  try {
    fs.mkdirSync(path.join(CHAT_DIR, chatId), { recursive: true });
    fs.writeFileSync(claudeSessionPath(chatId), String(sessionId));
  } catch { /* best effort */ }
}
function clearClaudeSession(chatId) {
  try { fs.rmSync(claudeSessionPath(chatId), { force: true }); } catch { /* ignore */ }
}

module.exports = {
  loadChatHistory, appendChatHistory, listChats, recordChatUsage, loadChatUsage,
  loadClaudeSession, persistClaudeSession, clearClaudeSession,
};
