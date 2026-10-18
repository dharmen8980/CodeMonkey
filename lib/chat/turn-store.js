const fs = require('fs');
const path = require('path');

const { CHAT_DIR } = require('./config');

// ============================================================================
// Per-chat turn records — the durable half of the async chat flow.
//
// One file per turn at chats/<chatId>/turns/<turnId>.json, kept forever (no pruning;
// a future DB migration reads these 1:1 as rows). A lightweight append-only
// chats/<chatId>/turns-index.jsonl records just {turnId, createdAt} in creation order,
// so "what's new since turn X" is a small sequential scan instead of a directory listing
// + per-file stat as the history grows.
// ============================================================================

function turnsDir(chatId) {
  return path.join(CHAT_DIR, chatId, 'turns');
}
function turnPath(chatId, turnId) {
  return path.join(turnsDir(chatId), `${turnId}.json`);
}
function indexPath(chatId) {
  return path.join(CHAT_DIR, chatId, 'turns-index.jsonl');
}

function writeTurnFile(chatId, turn) {
  const dir = turnsDir(chatId);
  fs.mkdirSync(dir, { recursive: true });
  const p = turnPath(chatId, turn.turnId);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(turn, null, 2));
  fs.renameSync(tmp, p);
}

function createTurn(chatId, turnId, { message, modelId }) {
  const turn = {
    turnId,
    chatId,
    status: 'pending',
    message,
    modelId,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  writeTurnFile(chatId, turn);
  fs.mkdirSync(path.join(CHAT_DIR, chatId), { recursive: true });
  fs.appendFileSync(indexPath(chatId), JSON.stringify({ turnId, createdAt: turn.createdAt }) + '\n');
  return turn;
}

function loadTurn(chatId, turnId) {
  try { return JSON.parse(fs.readFileSync(turnPath(chatId, turnId), 'utf8')); }
  catch { return null; }
}

// Read-modify-write is safe without a mutex: session.busy (chat/container.js) already
// guarantees at most one turn per chat is ever in flight, so there is no concurrent
// writer for a given chatId's turn files.
function updateTurn(chatId, turnId, updates) {
  const turn = loadTurn(chatId, turnId);
  if (!turn) return null;
  Object.assign(turn, updates);
  writeTurnFile(chatId, turn);
  return turn;
}

function listTurnIndex(chatId) {
  try {
    return fs.readFileSync(indexPath(chatId), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// The most recently created turn for a chat, or null. Session busy-gating means at
// most one turn is ever non-terminal at a time, and it is always the last one created —
// used on page reload to tell whether this chat is mid-turn and, if so, which one.
function getLatestTurn(chatId) {
  const idx = listTurnIndex(chatId);
  if (!idx.length) return null;
  return loadTurn(chatId, idx[idx.length - 1].turnId);
}

module.exports = { createTurn, loadTurn, updateTurn, getLatestTurn };
