const { generateRunId } = require('../lib/utils');
const { loadTasks, mutateTasks } = require('../lib/task-store');
const { spawnAgent } = require('../lib/agent-spawn');
const { mutatePipeline } = require('../lib/pipeline-store');
const { triggerPipelineTick } = require('../lib/pipeline-driver');
const {
  CHAT_MAX_MESSAGE_LEN, CHAT_MAX_SESSIONS, resolveChatModel, chatContainerName,
} = require('../lib/chat/config');
const { chatSessions, getOrCreateChat, dockerRunning, listRunningChatContainers, killChatContainer } = require('../lib/chat/container');
const { runChatTurn } = require('../lib/chat/turn');
const { loadChatHistory, appendChatHistory, listChats, loadChatUsage } = require('../lib/chat/history');
const { createTurn, loadTurn, updateTurn, getLatestTurn } = require('../lib/chat/turn-store');
const { chatEvents, emitTurnDone, emitTurnActivity } = require('../lib/chat/events');

// How often an idle SSE stream gets a keep-alive comment, so intermediary proxies /
// mobile carriers don't silently drop it for looking dead.
const SSE_HEARTBEAT_MS = 20000;

// --- POST /chat/message ---
function handleChatMessage(req, res, payload) {
  const chatId = /^[a-f0-9]{16}$/.test(String(payload?.chat_id || ''))
    ? payload.chat_id
    : generateRunId();
  const message = String(payload?.message || '').trim();

  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'empty message' }));
    return;
  }
  if (message.length > CHAT_MAX_MESSAGE_LEN) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `message too long (max ${CHAT_MAX_MESSAGE_LEN})` }));
    return;
  }

  const session = getOrCreateChat(chatId);
  if (!session) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `too many active chat sessions (max ${CHAT_MAX_SESSIONS})` }));
    return;
  }
  if (session.busy) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'a turn is already running for this session' }));
    return;
  }

  appendChatHistory(chatId, { role: 'user', content: message, at: new Date().toISOString() });

  const modelId = resolveChatModel(payload?.model);
  const turnId = generateRunId();
  createTurn(chatId, turnId, { message, modelId });

  // Respond as soon as the turn is queued — the actual claude exec can run for minutes,
  // and holding this connection open for that long is exactly what breaks on a phone
  // that backgrounds or locks. The client gets the answer via the SSE stream (or a
  // /chat/turn poll if the stream was down when it arrived), not this response.
  res.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ chat_id: chatId, turn_id: turnId, status: 'pending' }));

  updateTurn(chatId, turnId, { status: 'running', startedAt: new Date().toISOString() });
  runChatTurn(session, message, modelId, (result) => {
    const finishedAt = new Date().toISOString();
    const turn = result.error
      ? updateTurn(chatId, turnId, { status: 'failed', finishedAt, error: result })
      : updateTurn(chatId, turnId, { status: 'done', finishedAt, result });
    emitTurnDone(chatId, turn);
  }, (event) => {
    const current = loadTurn(chatId, turnId);
    if (!current || current.status !== 'running') return;
    const activity = Array.isArray(current.activity) ? current.activity.slice() : [];
    if (event.phase === 'reset') {
      activity.length = 0;
    } else if (event.phase === 'start') {
      activity.push({ id: event.id, label: event.label, status: 'running' });
      if (activity.length > 30) activity.shift();
    } else if (event.phase === 'done') {
      const item = activity.find(a => a.id === event.id);
      if (!item) return;
      item.status = 'done';
    } else return;
    updateTurn(chatId, turnId, { activity });
    emitTurnActivity(chatId, turnId, activity);
  });
}

// --- GET /chat/turn?chat_id=&turn_id= — single turn's current status/result ---
function handleChatTurnGet(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const chatId = q.get('chat_id') || '';
  const turnId = q.get('turn_id') || '';
  if (!/^[a-f0-9]{16}$/.test(chatId) || !turnId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid chat_id or turn_id' }));
    return;
  }
  const turn = loadTurn(chatId, turnId);
  if (!turn) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no such turn' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(turn));
}

// --- GET /chat/stream?chat_id= — SSE push the moment a turn for this chat finishes ---
function handleChatStreamGet(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const chatId = q.get('chat_id') || '';
  if (!/^[a-f0-9]{16}$/.test(chatId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid chat_id' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');

  const onTurn = (turn) => { res.write(`data: ${JSON.stringify(turn)}\n\n`); };
  chatEvents.on(chatId, onTurn);

  const heartbeat = setInterval(() => { res.write(':hb\n\n'); }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    chatEvents.off(chatId, onTurn);
  };
  // res 'close', not req 'close' — for a bodyless GET, the request stream fires 'close'
  // as soon as it's fully received, well before the client actually disconnects. res
  // 'close' tracks the real connection lifecycle for as long as we're still writing to it.
  res.on('close', cleanup);
  res.on('error', cleanup);
}

// --- POST /chat/approve — the only path from chat to a writing container ---
function handleChatApprove(req, res, payload) {
  const chatId = String(payload?.chat_id || '');
  const session = chatSessions.get(chatId);
  if (!session || !session.pending) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no pending proposal for this session' }));
    return;
  }
  if (String(payload?.proposal_id || '') !== session.pending.id) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proposal id mismatch — it may have been superseded' }));
    return;
  }

  // Pipeline-bound proposals branch here instead of spawning a single worker
  // directly — same button, same endpoint, one tap, but the pipeline driver takes
  // over from there with no further human gate until it posts ready-for-review.
  if (session.pending.kind === 'pipeline_ticket') {
    if (!process.env.DOTNET_SOLUTION || !process.env.DOTNET_PRODUCTION_PROJECT) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Configure DOTNET_SOLUTION and DOTNET_PRODUCTION_PROJECT before using the acceptance pipeline' }));
      return;
    }
    const editedBrief = typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim().slice(0, 4000)
      : session.pending.brief;

    const ticket = {
      id: generateRunId(),
      pipeline_version: 2,
      source: 'chat',
      chat_id: chatId,
      proposal_id: session.pending.id,
      jira_key: session.pending.jira_key,
      title: session.pending.title,
      initial_brief: editedBrief,
      fr_number: session.pending.fr_number,
      stage: 'triage',
      status: 'queued',
      mr_iid: null, mr_url: null, mr_branch: null,
      triage: null,
      clarification_question: null,
      human_clarification: null,
      human_guidance: null,
      implement_attempts: 0,
      implement_attempt_cap: 3,
      sonar_fix_attempts: 0,
      sonar_fix_attempt_cap: 2,
      test_handoff: null,
      resume_stage_after_unit_test: null,
      runs: {},
      e2e_gate_result: null,
      sonar_gate_result: null,
      blocked: false,
      blocked_reason: null,
      blocked_from_stage: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mutatePipeline(tickets => tickets.push(ticket));

    console.log(`\n✅ Chat-approved pipeline ticket: "${editedBrief.slice(0, 80)}"`);
    session.pending = null;
    appendChatHistory(chatId, { role: 'approved', content: { ticket_id: ticket.id, brief: editedBrief }, at: new Date().toISOString() });

    triggerPipelineTick();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'queued', ticket_id: ticket.id, stage: 'triage' }));
    return;
  }

  // The user may edit the description before approving; that edit wins.
  const edited = typeof payload.description === 'string' && payload.description.trim()
    ? payload.description.trim().slice(0, 4000)
    : session.pending.description;

  const task = {
    id: generateRunId(),
    task_type: session.pending.task_type,
    description: edited,
    mr_iid: session.pending.mr_iid || '',
    source: 'chat',
    chat_id: chatId,
    received_at: new Date().toISOString(),
    status: 'pending',
  };

  if (task.task_type !== 'new-task' && task.mr_iid) {
    task.mr_url = `https://${process.env.GITLAB_HOST || 'gitlab.com'}/${process.env.GITLAB_PROJECT_PATH}/-/merge_requests/${task.mr_iid}`;
  }

  mutateTasks(tasks => tasks.push(task));

  console.log(`\n✅ Chat-approved task (${task.task_type}): "${edited.slice(0, 80)}"`);
  session.pending = null;
  appendChatHistory(chatId, { role: 'approved', content: { task_id: task.id, description: edited }, at: new Date().toISOString() });

  const container = spawnAgent(task);
  // spawnAgent assigns run_id on the persisted record, not this local object.
  const spawned = loadTasks().find(t => t.id === task.id);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'spawned',
    task_id: task.id,
    run_id: spawned?.run_id || null,
    container,
  }));
}

// --- POST /chat/reject ---
function handleChatReject(req, res, payload) {
  const session = chatSessions.get(String(payload?.chat_id || ''));
  if (session) session.pending = null;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- POST /chat/kill — the ONLY way a chat container dies (UI "Kill agent") ---
function handleChatKill(req, res, payload) {
  const chatId = String(payload?.chat_id || '');
  // chatId is interpolated into the docker command name; require strict hex.
  if (!/^[a-f0-9]{16}$/.test(chatId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid chat_id' }));
    return;
  }
  const session = chatSessions.get(chatId);
  console.log(`\n🛑 Kill requested for chat ${chatId.slice(0, 8)} via UI`);
  killChatContainer(session || { id: chatId, containerName: chatContainerName(chatId) }, () => {
    // Drop the in-memory session; the on-disk history stays, so the same chatId
    // can start a fresh container later with its thread intact.
    chatSessions.delete(chatId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// --- GET /chat/list — every conversation that's ever had a message, newest first.
// Lets one device pick up a chat started on another, since chat_id otherwise only
// lives in that browser tab's sessionStorage. ---
function handleChatListGet(req, res) {
  listRunningChatContainers((running) => {
    const chats = listChats().map(c => ({ ...c, active: running.has(chatContainerName(c.chat_id)) }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ chats }));
  });
}

// --- GET /chat/container?chat_id=... — live status for the Stop agent control ---
function handleChatContainerGet(req, res) {
  const chatId = new URL(req.url, 'http://localhost').searchParams.get('chat_id') || '';
  if (!/^[a-f0-9]{16}$/.test(chatId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid chat_id' }));
    return;
  }
  dockerRunning(chatContainerName(chatId), (active) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ chat_id: chatId, active }));
  });
}

// --- GET /chat/history?chat_id=... ---
function handleChatHistory(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const chatId = q.get('chat_id') || '';
  if (!/^[a-f0-9]{16}$/.test(chatId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid chat_id' }));
    return;
  }
  const s = chatSessions.get(chatId);
  // If this chat is mid-turn (page reload, app resumed from background), hand back the
  // in-flight turn so the client can show "thinking" and wait on it instead of assuming
  // idle. Only non-terminal turns are surfaced — a done/failed turn is already in history.
  const latest = getLatestTurn(chatId);
  const activeTurn = latest && (latest.status === 'pending' || latest.status === 'running') ? latest : null;
  dockerRunning(chatContainerName(chatId), (active) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      chat_id: chatId,
      history: loadChatHistory(chatId),
      pending: s?.pending || null,
      active,
      active_turn: activeTurn,
    }));
  });
}

// --- GET /chat/stats?chat_id=... — CHAT container cost (not coding tasks) ---
// Three numbers the chat UI shows: all-time chat spend, this session's spend, and
// the average per turn. Sourced from the per-turn chat usage ledger.
function handleChatStats(req, res) {
  const chatId = new URL(req.url, 'http://localhost').searchParams.get('chat_id') || '';
  const usage = loadChatUsage();
  let total = 0, turns = 0, sessionCost = 0, sessionTurns = 0;
  for (const u of usage) {
    const c = u.cost_usd || 0;
    total += c; turns += 1;
    if (chatId && u.chat_id === chatId) { sessionCost += c; sessionTurns += 1; }
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    chat_total_cost_usd: Number(total.toFixed(4)),
    chat_turns: turns,
    chat_avg_cost_usd: turns ? Number((total / turns).toFixed(4)) : 0,
    chat_session_cost_usd: Number(sessionCost.toFixed(4)),
    chat_session_turns: sessionTurns,
  }));
}

module.exports = {
  handleChatMessage, handleChatApprove, handleChatReject, handleChatKill,
  handleChatHistory, handleChatStats, handleChatListGet, handleChatContainerGet,
  handleChatTurnGet, handleChatStreamGet,
};
