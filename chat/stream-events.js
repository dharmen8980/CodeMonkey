// Read Claude's stream-json output inside the chat container. Only fixed labels and
// tool ids reach stdout; prompts, tool arguments, results, and reasoning stay here.
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const ioDir = process.env.CHAT_IO_DIR || '/workspace/io';

const seen = new Set();
const labels = {
  Read: 'Reading a file',
  Grep: 'Searching code',
  Glob: 'Finding files',
  Bash: 'Running a command',
};

function labelFor(name) {
  if (labels[name]) return labels[name];
  if (name.startsWith('mcp__jira__')) return 'Checking Jira';
  if (name.startsWith('mcp__ragflow__')) return 'Searching knowledge base';
  if (name.startsWith('mcp__mssql__')) return 'Checking the database';
  if (name.startsWith('mcp__teams-chat__')) return 'Searching team chat';
  if (name.startsWith('mcp__orchestrator-logs__')) return 'Checking runs and logs';
  return 'Using a tool';
}

function emit(activity) {
  process.stdout.write('CHAT_ACTIVITY:' + JSON.stringify(activity) + '\n');
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }

  if (event.type === 'result') {
    fs.writeFileSync(path.join(ioDir, 'last-raw.json'), JSON.stringify(event));
    return;
  }

  const blocks = event.message && Array.isArray(event.message.content)
    ? event.message.content : [];
  if (event.type === 'assistant') {
    for (const block of blocks) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || seen.has(block.id)) continue;
      seen.add(block.id);
      emit({ phase: 'start', id: block.id, label: labelFor(String(block.name || '')) });
    }
  } else if (event.type === 'user') {
    for (const block of blocks) {
      if (block.type === 'tool_result' && seen.has(block.tool_use_id)) {
        emit({ phase: 'done', id: block.tool_use_id });
      }
    }
  }
});
