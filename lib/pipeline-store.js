const fs = require('fs');
const path = require('path');
const { migrateTicket } = require('./pipeline/migrate-ticket');

const PIPELINE_FILE = path.join(__dirname, '..', 'pipeline.json');

if (!fs.existsSync(PIPELINE_FILE)) {
  fs.writeFileSync(PIPELINE_FILE, '[]');
}

function loadPipeline() {
  return JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf8')).map(migrateTicket);
}

function persistPipeline(tickets) {
  const tmp = PIPELINE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tickets, null, 2));
  fs.renameSync(tmp, PIPELINE_FILE);
}

// Same convention as lib/task-store.js's mutateTasks — every insert/update funnels
// through here so a load->modify->save is one indivisible critical section. Never
// loadPipeline()/push/persistPipeline() inline.
function mutatePipeline(mutator) {
  const tickets = loadPipeline();
  const result = mutator(tickets);
  persistPipeline(tickets);
  return result;
}

function updateTicket(ticketId, updates) {
  return mutatePipeline(tickets => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (ticket) Object.assign(ticket, updates, { updated_at: new Date().toISOString() });
    return ticket;
  });
}

module.exports = { PIPELINE_FILE, loadPipeline, persistPipeline, mutatePipeline, updateTicket };
