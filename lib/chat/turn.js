const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

const { CHAT_DIR, CHAT_TURN_TIMEOUT_MS } = require('./config');
const { loadChatHistory, appendChatHistory, recordChatUsage, persistClaudeSession } = require('./history');
const { ensureChatContainer } = require('./container');
const { loadTasks } = require('../task-store');

// Runs one conversational turn: ensure the warm container is up, then `docker exec`
// the per-turn script into it. A native session resumes when available; fresh
// sessions get visible history. modelId selects the model for this turn.
function runChatTurn(session, message, modelId, onDone, onActivity = () => {}) {
  session.busy = true;
  session.lastSeen = Date.now();
  ensureChatContainer(session, (err) => {
    if (err) {
      session.busy = false;
      console.log(`   ❌ Chat container failed to start: ${err.message}`);
      return onDone({ error: 'chat container failed to start', detail: String(err.message || err) });
    }
    execChatTurn(session, message, modelId, (result) => {
      session.busy = false;
      session.lastSeen = Date.now();
      onDone(result);
    }, onActivity);
  });
}

function execChatTurn(session, message, modelId, onDone, onActivity = () => {}) {
  const name = session.containerName;
  const sessionDir = path.join(CHAT_DIR, session.id);
  fs.mkdirSync(sessionDir, { recursive: true });

  const history = loadChatHistory(session.id);
  const allTasks = loadTasks();

  // Recent tasks go in verbatim for detail questions, but totals are computed here over
  // ALL tasks — otherwise the agent reports the truncated window's sum as the total.
  const totals = allTasks.reduce((acc, t) => {
    acc.tasks += 1;
    if (t.usage) { acc.runs_with_usage += 1; acc.cost_usd += t.usage.cost_usd || 0; }
    if (t.status === 'failed') acc.failed += 1;
    if (t.status === 'timeout') acc.timed_out += 1;
    if (t.status === 'running') acc.running += 1;
    return acc;
  }, { tasks: 0, runs_with_usage: 0, cost_usd: 0, failed: 0, timed_out: 0, running: 0 });
  totals.cost_usd = Number(totals.cost_usd.toFixed(4));

  const payload = {
    message,
    history: history.slice(-40),
    tasks: allTasks.slice(-30),
    totals,
  };
  fs.writeFileSync(path.join(sessionDir, 'input.json'), JSON.stringify(payload));
  // Clear any prior turn's reply + raw envelope so a stale file can't be mistaken for
  // this turn's (reply → wrong answer; last-raw → double-counted cost).
  try { fs.rmSync(path.join(sessionDir, 'reply.json'), { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(path.join(sessionDir, 'last-raw.json'), { force: true }); } catch { /* ignore */ }

  // spawn() with an argv array — never a shell string — because `message` reaches
  // the container via input.json (a file), and the exec argv is fixed. The container
  // is already warm; this just runs the per-turn script inside it.
  // Per-turn model override + resume id via `docker exec -e`. turn.sh reads $CHAT_MODEL
  // and $RESUME_SESSION_ID; an empty resume id means "fresh session, replay transcript".
  // Both are server-controlled values and spawn uses an argv array, so no injection.
  const resumeId = session.claudeSessionId || '';
  console.log(`\n💬 Chat turn ${session.id.slice(0, 8)} → exec ${name} (model: ${modelId}${resumeId ? ', resume ' + resumeId.slice(0, 8) : ', fresh'})`);
  const child = spawn('docker', [
    'exec',
    '-e', `CHAT_MODEL=${modelId}`,
    '-e', `RESUME_SESSION_ID=${resumeId}`,
    name, 'bash', '/turn.sh',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let stdoutLine = '';
  child.stdout.on('data', d => {
    stdoutLine += d.toString();
    let end;
    while ((end = stdoutLine.indexOf('\n')) !== -1) {
      const line = stdoutLine.slice(0, end);
      stdoutLine = stdoutLine.slice(end + 1);
      if (line.startsWith('CHAT_ACTIVITY:')) {
        try {
          const event = JSON.parse(line.slice('CHAT_ACTIVITY:'.length));
          if (event.phase === 'reset' ||
              ((event.phase === 'start' || event.phase === 'done') && typeof event.id === 'string')) {
            onActivity(event);
          }
        } catch { /* malformed activity is ignored; the turn can still finish */ }
      } else stdout = (stdout + line + '\n').slice(-4000);
    }
  });
  child.stderr.on('data', d => { stderr += d; });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    // Stop the runaway claude inside the container, but leave the container itself
    // alive — it is long-lived and reused by the next turn.
    console.log(`   ⏱️  Chat turn timed out, stopping claude in ${name}`);
    exec(`docker exec ${name} pkill -f claude 2>/dev/null`, () => {});
  }, CHAT_TURN_TIMEOUT_MS);

  child.on('close', (code) => {
    clearTimeout(killTimer);

    // Record this turn's cost regardless of whether it produced a valid reply — a turn
    // that ran claude but botched the output contract still cost money.
    recordChatUsage(session.id, sessionDir, modelId);

    // Capture the claude session id from this turn's envelope so the NEXT turn can resume
    // it. On a fresh-session turn (or the resume-failed fallback) this is a new id; on a
    // resumed turn it's the same id echoed back. Persist so it survives a server restart.
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(sessionDir, 'last-raw.json'), 'utf8'));
      if (raw.session_id && raw.session_id !== session.claudeSessionId) {
        session.claudeSessionId = raw.session_id;
        persistClaudeSession(session.id, raw.session_id);
      }
    } catch { /* no envelope / unreadable — leave the id as-is */ }

    let reply = null;
    let proposal = null;
    let pipelineTicket = null;
    const replyPath = path.join(sessionDir, 'reply.json');
    if (fs.existsSync(replyPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(replyPath, 'utf8'));
        reply = typeof parsed.reply === 'string' ? parsed.reply : null;
        proposal = parsed.proposed_task || null;
        pipelineTicket = parsed.pipeline_ticket || null;
      } catch { /* fall through to error path */ }
      try { fs.rmSync(replyPath, { force: true }); } catch { /* ignore */ }
    }

    if (reply === null) {
      const detail = timedOut ? 'turn timed out' : (stderr || stdout || '').slice(-400).trim();
      console.log(`   ❌ Chat turn failed (exit ${code})`);
      onDone({ error: 'chat turn failed', detail, exit_code: code });
      return;
    }

    appendChatHistory(session.id, { role: 'assistant', content: reply, at: new Date().toISOString() });

    // A proposed task/ticket is held server-side until the user approves it. The
    // chat container cannot spawn or enqueue anything on its own. `kind` tags which
    // one this is so /chat/approve knows whether to spawnAgent() directly (a single
    // one-off 'task') or push into the pipeline queue instead ('pipeline_ticket').
    if (proposal && typeof proposal.description === 'string') {
      const type = ['new-task', 'review-feedback', 'unit-test'].includes(proposal.task_type)
        ? proposal.task_type
        : 'new-task';
      session.pending = {
        kind: 'task',
        id: crypto.randomBytes(6).toString('hex'),
        task_type: type,
        description: proposal.description.slice(0, 4000),
        mr_iid: proposal.mr_iid ? String(proposal.mr_iid).replace(/\D/g, '') : '',
        proposed_at: new Date().toISOString(),
      };
      appendChatHistory(session.id, { role: 'proposal', content: session.pending, at: new Date().toISOString() });
    } else if (pipelineTicket && typeof pipelineTicket.brief === 'string') {
      session.pending = {
        kind: 'pipeline_ticket',
        id: crypto.randomBytes(6).toString('hex'),
        jira_key: pipelineTicket.jira_key ? String(pipelineTicket.jira_key).slice(0, 40) : null,
        title: (pipelineTicket.title || '').slice(0, 120),
        brief: pipelineTicket.brief.slice(0, 4000),
        fr_number: pipelineTicket.fr_number ? String(pipelineTicket.fr_number).slice(0, 40) : null,
        proposed_at: new Date().toISOString(),
      };
      appendChatHistory(session.id, { role: 'proposal', content: session.pending, at: new Date().toISOString() });
    }

    onDone({ reply, pending: session.pending || null });
  });

  child.on('error', (err) => {
    clearTimeout(killTimer);
    // exec failed (container gone/crashed): drop readiness so the next turn reboots it.
    session.containerReady = false;
    onDone({ error: 'failed to exec chat turn', detail: err.message });
  });
}

module.exports = { runChatTurn, execChatTurn };
