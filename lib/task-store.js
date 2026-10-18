const fs = require('fs');
const path = require('path');

const TASKS_FILE = path.join(__dirname, '..', 'tasks.json');

if (!fs.existsSync(TASKS_FILE)) {
  fs.writeFileSync(TASKS_FILE, '[]');
}

function loadTasks() {
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
}

function persistTasks(tasks) {
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
  fs.renameSync(tmp, TASKS_FILE);
}

// All task mutations funnel through here so a load→modify→save is one indivisible
// critical section. Today the ops are synchronous so this is a formality, but it
// guarantees no future async edit can persist a stale snapshot and clobber a
// concurrent write. Route every insert/update through mutateTasks — never
// loadTasks()/push/persistTasks() inline.
function mutateTasks(mutator) {
  const tasks = loadTasks();
  const result = mutator(tasks);
  persistTasks(tasks);
  return result;
}

function updateTask(taskId, updates) {
  return mutateTasks(tasks => {
    const task = tasks.find(t => t.id === taskId);
    if (task) Object.assign(task, updates);
    return task;
  });
}

module.exports = { TASKS_FILE, loadTasks, persistTasks, mutateTasks, updateTask };
