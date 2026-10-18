// Chat client. Loaded as an external file so the page runs under a strict CSP with
// no inline script.
//
// XSS rule for this file: every piece of server- or model-derived content reaches the
// DOM through textContent or a form value. There is no innerHTML anywhere, so agent
// output, file contents and diffs are inert no matter what they contain.
(function () {
  var log = document.getElementById('log');
  var input = document.getElementById('input');
  var send = document.getElementById('send');
  var statsEl = document.getElementById('stats');
  var modelSel = document.getElementById('model');
  var historyModal = document.getElementById('historyModal');
  var historyList = document.getElementById('historyList');
  var killAgentButton = document.getElementById('killagent');
  var chatId = null;
  var busy = false;
  // The turn we're currently waiting on (if any) and the turns we've already rendered,
  // so the same completion delivered twice (SSE push + a reconnect catch-up) only
  // shows up once. Neither needs to survive a reload — a fresh load re-syncs from
  // /chat/history, which already carries the last completed turn's reply.
  var awaitingTurnId = null;
  var awaitingTyping = null;
  var seenTurnIds = Object.create(null);
  var eventSource = null;
  var eventSourceChatId = null;
  var agentStatusRequest = 0;

  var STORE_KEY = 'cm_chat_id';
  var MODEL_KEY = 'cm_chat_model';
  try { chatId = sessionStorage.getItem(STORE_KEY) || null; } catch (e) { /* private mode */ }

  // Restore the last-picked model tier and remember changes. The chosen tier applies to
  // the NEXT message — each turn is an independent claude call, so you can switch anytime.
  try {
    var savedModel = sessionStorage.getItem(MODEL_KEY);
    if (savedModel) modelSel.value = savedModel;
  } catch (e) { /* private mode */ }
  modelSel.addEventListener('change', function () {
    try { sessionStorage.setItem(MODEL_KEY, modelSel.value); } catch (e) {}
  });

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;   // never innerHTML
    return n;
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  }

  function scroll(force) {
    if (force || atBottom()) log.scrollTop = log.scrollHeight;
  }

  function addMsg(kind, text) {
    var welcome = log.querySelector('.chat-welcome');
    if (welcome) welcome.remove();
    var wrap = el('div', 'msg ' + kind);
    wrap.appendChild(el('div', 'bubble', text));
    log.appendChild(wrap);
    scroll(kind === 'user');
    return wrap;
  }

  function addTyping() {
    var wrap = el('div', 'msg bot activity-msg');
    var panel = el('details', 'activity-panel');
    panel.open = true;
    panel.appendChild(el('summary', 'activity-summary', 'Thinking…'));
    panel.appendChild(el('ol', 'activity-list'));
    wrap.appendChild(panel);
    log.appendChild(wrap);
    scroll(true);
    return wrap;
  }

  function renderActivity(items) {
    if (!awaitingTyping) return;
    var list = awaitingTyping.querySelector('.activity-list');
    var summary = awaitingTyping.querySelector('.activity-summary');
    if (!list || !summary) return;
    list.textContent = '';
    (items || []).forEach(function (item) {
      if (!item || !item.label) return;
      var row = el('li', item.status === 'done' ? 'done' : 'running');
      row.appendChild(el('span', 'activity-mark', item.status === 'done' ? '✓' : '●'));
      row.appendChild(el('span', null, item.label));
      list.appendChild(row);
    });
    summary.textContent = list.children.length
      ? (list.querySelector('.running') ? 'Working… · ' : 'Thinking… · ') + list.children.length + ' tool step' + (list.children.length === 1 ? '' : 's')
      : 'Thinking…';
    scroll(false);
  }

  function finishActivity(items) {
    if (!awaitingTyping) return;
    renderActivity(items);
    var list = awaitingTyping.querySelector('.activity-list');
    if (!list || !list.children.length) awaitingTyping.remove();
    else {
      awaitingTyping.querySelector('.activity-summary').textContent = 'Activity · ' + list.children.length + ' tool step' + (list.children.length === 1 ? '' : 's');
      awaitingTyping.querySelector('.activity-panel').open = false;
    }
    awaitingTyping = null;
  }

  function money(n) {
    return '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
  }

  // Chat container cost only — all-time total, this session, and average per turn.
  function renderStats(s) {
    statsEl.textContent = '';
    var items = [
      { k: 'chat total', v: money(s.chat_total_cost_usd) },
      { k: 'this session', v: money(s.chat_session_cost_usd) },
      { k: 'avg/turn', v: money(s.chat_avg_cost_usd) },
    ];
    items.forEach(function (it) {
      var d = el('div', 'stat');
      d.appendChild(el('div', 'v', it.v));
      d.appendChild(el('div', 'k', it.k));
      statsEl.appendChild(d);
    });
  }

  function loadStats() {
    var url = '/chat/stats' + (chatId ? ('?chat_id=' + encodeURIComponent(chatId)) : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (r.status === 401) { location.replace('/login'); return null; } return r.json(); })
      .then(function (s) { if (s) renderStats(s); })
      .catch(function () { /* stats are cosmetic; ignore */ });
  }

  // Proposal card. The description is editable before approval — the edited text is
  // what gets sent, so you can tighten scope without another round trip.
  function addProposal(p) {
    var isTicket = p.kind === 'pipeline_ticket';
    var card = el('div', 'card');
    card.appendChild(el('h3', null, isTicket ? 'Proposed pipeline ticket — review before queuing' : 'Proposed task — review before running'));

    var metaBits = isTicket ? [p.jira_key || 'ad-hoc', p.title].filter(Boolean) : [p.task_type];
    if (p.mr_iid) metaBits.push('MR !' + p.mr_iid);
    card.appendChild(el('div', 'meta', metaBits.join('  ·  ')));

    var ta = document.createElement('textarea');
    ta.value = isTicket ? p.brief : p.description;               // value, not innerHTML
    ta.setAttribute('aria-label', isTicket ? 'Ticket brief' : 'Task description');
    card.appendChild(ta);

    var row = el('div', 'row');
    var ok = el('button', 'approve', 'Approve & run');
    var no = el('button', 'reject', 'Discard');
    row.appendChild(no);
    row.appendChild(ok);
    card.appendChild(row);
    log.appendChild(card);
    scroll(true);

    function done() {
      ok.disabled = true;
      no.disabled = true;
      ta.disabled = true;
    }

    ok.addEventListener('click', function () {
      done();
      ok.textContent = 'Starting…';
      fetch('/chat/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ chat_id: chatId, proposal_id: p.id, description: ta.value }),
      })
        .then(function (r) { return r.json().then(function (b) { return { s: r.status, b: b }; }); })
        .then(function (res) {
          if (res.s !== 200) {
            addMsg('err', 'Could not start: ' + (res.b.error || res.s));
            return;
          }
          var trackHref = isTicket ? '/pipeline' : '/turns';
          var trackLabel = isTicket ? 'Ticket queued (stage: ' + (res.b.stage || 'triage') + '). Track it on the pipeline board:' : 'Task spawned. Track it on the Dashboard:';
          card.appendChild(el('div', 'meta', isTicket ? 'Queued — ticket ' + (res.b.ticket_id || '') : 'Started — task ' + (res.b.task_id || '')));
          var m = addMsg('sys', trackLabel);
          var a = document.createElement('a');
          a.href = trackHref;
          a.textContent = trackHref;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          m.querySelector('.bubble').appendChild(document.createElement('br'));
          m.querySelector('.bubble').appendChild(a);
          loadStats();
        })
        .catch(function () { addMsg('err', 'Network error starting the task.'); });
    });

    no.addEventListener('click', function () {
      done();
      no.textContent = 'Discarded';
      fetch('/chat/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ chat_id: chatId }),
      }).catch(function () { /* best effort */ });
    });
  }

  function setBusy(v) {
    busy = v;
    send.disabled = v;
    input.disabled = v;
  }

  function setAgentRunning(active) {
    killAgentButton.hidden = !active;
  }

  function refreshAgentStatus() {
    var id = chatId;
    var request = ++agentStatusRequest;
    if (!id) { setAgentRunning(false); return; }
    fetch('/chat/container?chat_id=' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (status) {
        if (status && chatId === id && request === agentStatusRequest) setAgentRunning(status.active);
      })
      .catch(function () { /* keep the last known state until the next check */ });
  }

  // Open (or reuse) the SSE connection for this chat. The turn itself runs server-side
  // regardless of whether this connection is up — this is only how the answer gets
  // delivered without holding the /chat/message request open for minutes. EventSource
  // auto-reconnects on drop (screen lock, backgrounding, flaky signal); each reconnect's
  // "open" event triggers a catch-up check for whatever turn we're still waiting on, so
  // a missed push isn't a lost answer.
  function ensureStream(id) {
    if (!id || eventSourceChatId === id) return;
    if (eventSource) eventSource.close();
    eventSourceChatId = id;
    eventSource = new EventSource('/chat/stream?chat_id=' + encodeURIComponent(id), { withCredentials: true });
    eventSource.onmessage = function (e) {
      try {
        var event = JSON.parse(e.data);
        if (event.type === 'activity') processActivity(event);
        else processTurn(event);
      } catch (err) { /* ignore malformed events */ }
    };
    eventSource.onopen = function () { reconcileAwaitingTurn(); };
  }

  function processActivity(event) {
    if (!event || event.turnId !== awaitingTurnId || seenTurnIds[event.turnId]) return;
    renderActivity(event.activity);
  }

  // Fired once per finished turn, whether it arrived via the live SSE push or a
  // reconnect catch-up fetch — either path lands here and dedupes on turnId.
  function processTurn(turn) {
    if (!turn || !turn.turnId || seenTurnIds[turn.turnId]) return;
    if (turn.status !== 'done' && turn.status !== 'failed' && turn.status !== 'timeout') return;
    if (turn.turnId !== awaitingTurnId) return;   // not the turn this tab is waiting on
    seenTurnIds[turn.turnId] = true;
    awaitingTurnId = null;

    finishActivity(turn.activity);

    if (turn.status === 'done') {
      var result = turn.result || {};
      addMsg('bot', result.reply || '(empty reply)');
      if (result.pending) addProposal(result.pending);
    } else {
      var e = turn.error || {};
      addMsg('err', e.error ? (e.error + (e.detail ? ' — ' + e.detail : '')) : 'Request failed');
    }

    setBusy(false);
    input.focus();
    loadStats();
    refreshAgentStatus();
  }

  // Catch-up path: ask directly for the turn we're waiting on, in case its completion
  // event was pushed while this tab had no live connection.
  function reconcileAwaitingTurn() {
    if (!awaitingTurnId || !chatId) return;
    fetch('/chat/turn?chat_id=' + encodeURIComponent(chatId) + '&turn_id=' + encodeURIComponent(awaitingTurnId), { credentials: 'same-origin' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (turn) {
        if (!turn) return;
        if (turn.status === 'running') processActivity({ turnId: turn.turnId, activity: turn.activity });
        else processTurn(turn);
      })
      .catch(function () { /* will retry on the next reconnect */ });
  }

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;

    addMsg('user', text);
    input.value = '';
    autosize();
    setBusy(true);
    awaitingTyping = addTyping();

    fetch('/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ chat_id: chatId, message: text, model: modelSel.value }),
    })
      .then(function (r) {
        if (r.status === 401) { location.replace('/login'); return null; }
        return r.json().then(function (b) { return { s: r.status, b: b }; });
      })
      .then(function (res) {
        if (!res) return;
        var b = res.b || {};
        if (b.chat_id) {
          chatId = b.chat_id;
          try { sessionStorage.setItem(STORE_KEY, chatId); } catch (e) {}
        }
        if (res.s !== 202) {
          if (awaitingTyping) { awaitingTyping.remove(); awaitingTyping = null; }
          setBusy(false);
          addMsg('err', b.error ? (b.error + (b.detail ? ' — ' + b.detail : '')) : ('Request failed (' + res.s + ')'));
          return;
        }
        // The turn is queued and running server-side; setBusy stays true and the typing
        // bubble stays up until the SSE stream (or a reconnect catch-up) delivers it —
        // this connection is done the moment the 202 lands, well before the turn is.
        awaitingTurnId = b.turn_id;
        ensureStream(chatId);
        reconcileAwaitingTurn();
        refreshAgentStatus();
      })
      .catch(function () {
        if (awaitingTyping) { awaitingTyping.remove(); awaitingTyping = null; }
        setBusy(false);
        addMsg('err', 'Network error submitting the message. Nothing was queued — try again.');
      });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  }

  input.addEventListener('input', autosize);

  // Enter sends on a physical keyboard; on touch keyboards Enter inserts a newline
  // so the send button is the only way to submit.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      submit();
    }
  });

  send.addEventListener('click', submit);

  // Kill this conversation's agent container. Best-effort fire-and-forget; the
  // server removes the container by chat id. Optional callback runs either way.
  function killAgent(id, done) {
    if (!id) { if (done) done(); return; }
    fetch('/chat/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ chat_id: id }),
    })
      .then(function () { if (done) done(); })
      .catch(function () { if (done) done(); });
  }

  killAgentButton.addEventListener('click', function () {
    if (!chatId) { addMsg('sys', 'No agent is running yet — send a message to start one.'); return; }
    addMsg('sys', 'Killing the agent container…');
    killAgent(chatId, function () {
      setAgentRunning(false);
      refreshAgentStatus();
      addMsg('sys', 'Agent stopped. The conversation is kept — your next message starts a fresh container.');
    });
  });

  document.getElementById('newchat').addEventListener('click', function () {
    // A new conversation orphans the current container (its id leaves this tab), so
    // kill it first rather than leaving an unreachable agent running.
    killAgent(chatId);
    chatId = null;
    setAgentRunning(false);
    awaitingTurnId = null;
    if (awaitingTyping) { awaitingTyping.remove(); awaitingTyping = null; }
    setBusy(false);
    if (eventSource) { eventSource.close(); eventSource = null; eventSourceChatId = null; }
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
    log.textContent = '';
    log.appendChild(el('p', 'hint', 'New conversation.'));
    input.focus();
  });

  function timeAgo(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    var mins = Math.round(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  function closeHistoryModal() {
    historyModal.close();
  }

  // Switch this tab to an existing conversation without touching its container — the
  // whole point is picking up a chat started on another device, so killing the agent
  // just because we're switching the view to it (or away from it) would stop it there too.
  function switchToChat(id) {
    closeHistoryModal();
    if (id === chatId) return;
    chatId = id;
    setAgentRunning(false);
    try { sessionStorage.setItem(STORE_KEY, chatId); } catch (e) {}
    awaitingTurnId = null;
    seenTurnIds = Object.create(null);
    if (awaitingTyping) { awaitingTyping.remove(); awaitingTyping = null; }
    setBusy(false);
    if (eventSource) { eventSource.close(); eventSource = null; eventSourceChatId = null; }
    log.textContent = '';
    restore();
  }

  function renderHistoryList(chats) {
    historyList.textContent = '';
    if (!chats.length) {
      historyList.appendChild(el('p', 'hint', 'No conversations yet.'));
      return;
    }
    chats.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'histitem' + (c.chat_id === chatId ? ' current' : '');
      btn.type = 'button';
      btn.appendChild(el('div', 'htitle', c.title || '(no message)'));
      var meta = el('div', 'hmeta');
      meta.appendChild(el('span', null, timeAgo(c.last_at)));
      meta.appendChild(el('span', null, c.message_count + ' msg' + (c.message_count === 1 ? '' : 's')));
      if (c.active) meta.appendChild(el('span', 'active', '● agent running'));
      btn.appendChild(meta);
      btn.addEventListener('click', function () { switchToChat(c.chat_id); });
      historyList.appendChild(btn);
    });
  }

  function openHistoryModal() {
    historyModal.showModal();
    historyList.textContent = '';
    historyList.appendChild(el('p', 'hint', 'Loading…'));
    fetch('/chat/list', { credentials: 'same-origin' })
      .then(function (r) { if (r.status === 401) { location.replace('/login'); return null; } return r.json(); })
      .then(function (d) { if (d) renderHistoryList(d.chats || []); })
      .catch(function () {
        historyList.textContent = '';
        historyList.appendChild(el('p', 'hint', 'Could not load conversations.'));
      });
  }

  document.getElementById('history').addEventListener('click', openHistoryModal);
  document.getElementById('historyClose').addEventListener('click', closeHistoryModal);
  historyModal.addEventListener('click', function (e) { if (e.target === historyModal) closeHistoryModal(); });


  // Restore an earlier conversation if this tab already had one, and — if a turn was
  // still running when the tab went away (backgrounded mid-turn, reload, etc) — pick
  // back up waiting on it instead of assuming the chat is idle.
  function restore() {
    if (!chatId) return;
    var id = chatId;
    fetch('/chat/history?chat_id=' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (d) {
        if (!d || chatId !== id) return;
        setAgentRunning(d.active);
        if (d.history && d.history.length) {
          log.textContent = '';
          d.history.forEach(function (e) {
            if (e.role === 'user') addMsg('user', String(e.content || ''));
            else if (e.role === 'assistant') addMsg('bot', String(e.content || ''));
            else if (e.role === 'approved' && e.content) addMsg('sys', 'Approved and spawned: ' + (e.content.description || '').slice(0, 160));
          });
          if (d.pending) addProposal(d.pending);
          scroll(true);
        }
        ensureStream(chatId);
        if (d.active_turn) {
          setBusy(true);
          awaitingTurnId = d.active_turn.turnId;
          awaitingTyping = addTyping();
          renderActivity(d.active_turn.activity);
          reconcileAwaitingTurn();
        }
      })
      .catch(function () {});
  }

  document.querySelectorAll('[data-prompt]').forEach(function (button) {
    button.addEventListener('click', function () { input.value = button.dataset.prompt; input.focus(); });
  });
  loadStats();
  restore();
  setInterval(loadStats, 30000);
  setInterval(refreshAgentStatus, 5000);
})();
