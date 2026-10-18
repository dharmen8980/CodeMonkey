const crypto = require('crypto');

function generateRunId() {
  return crypto.randomBytes(8).toString('hex');
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractTaskMessage(payload) {
  if (typeof payload === 'string') return payload;
  if (payload.body?.content) return stripHtml(payload.body.content);
  if (payload.message) {
    try {
      const inner = JSON.parse(payload.message);
      if (inner.body?.content) return stripHtml(inner.body.content);
    } catch (e) {}
    return stripHtml(payload.message);
  }
  return JSON.stringify(payload);
}

function parseTaskCommand(message) {
  return message.replace(/^\/task\s*/i, '').trim();
}

module.exports = { generateRunId, stripHtml, extractTaskMessage, parseTaskCommand };
