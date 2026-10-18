const { EventEmitter } = require('events');

// In-process pub/sub for live turn activity and completion over SSE. Single process only —
// if the orchestrator ever runs multiple instances, this needs to move to something
// shared (e.g. the DB this is meant to grow into) instead of an in-memory emitter.
//
// One event name per chatId. A chat can have several open tabs/streams (multiple
// listeners on the same event name), so keep no cap on listener count.
const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(0);

function emitTurnDone(chatId, turn) {
  chatEvents.emit(chatId, turn);
}

function emitTurnActivity(chatId, turnId, activity) {
  chatEvents.emit(chatId, { type: 'activity', turnId, activity });
}

module.exports = { chatEvents, emitTurnDone, emitTurnActivity };
