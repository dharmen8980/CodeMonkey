const { generateRunId, extractTaskMessage, parseTaskCommand } = require('../lib/utils');
const { loadTasks, mutateTasks } = require('../lib/task-store');
const { spawnAgent } = require('../lib/agent-spawn');
const { handleGitlabWebhook } = require('../lib/gitlab-webhook');

// --- POST /task (Teams/Discord/manual) ---
function handleTaskPost(req, res, payload) {
  const rawMessage = extractTaskMessage(payload);
  const description = parseTaskCommand(rawMessage);

  if (!description) {
    console.log(`\n⚠️  Empty task received, ignoring`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'empty task description' }));
    return;
  }

  const task = {
    id: generateRunId(),
    task_type: 'new-task',
    raw_message: rawMessage,
    description: description,
    source: payload.source || 'teams',
    received_at: new Date().toISOString(),
    status: 'pending'
  };

  mutateTasks(tasks => tasks.push(task));

  console.log(`\n✅ Task received: "${description}"`);

  if (process.env.AUTO_SPAWN === 'true') {
    spawnAgent(task);
  } else {
    console.log(`   ⏸️  Use POST /spawn/${task.id} to start.`);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'received', task_id: task.id, description }));
}

// --- POST /gitlab-webhook ---
function handleGitlabWebhookPost(req, res, payload) {
  const task = handleGitlabWebhook(payload);

  if (task) {
    mutateTasks(tasks => tasks.push(task));

    if (process.env.AUTO_SPAWN === 'true') {
      spawnAgent(task);
    } else {
      console.log(`   ⏸️  Use POST /spawn/${task.id} to start.`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'queued', task_id: task.id }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ignored' }));
  }
}

// --- POST /spawn/:id ---
function handleSpawn(req, res) {
  const taskId = req.url.split('/')[2];
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    res.writeHead(404);
    res.end('Task not found');
    return;
  }
  const container = spawnAgent(task);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'spawning', container }));
}

// --- GET /tasks ---
function handleTasksGet(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(loadTasks(), null, 2));
}

module.exports = { handleTaskPost, handleGitlabWebhookPost, handleSpawn, handleTasksGet };
