// Same fetch/poll/visibilitychange convention as dashboard.js/turns.js — each page
// keeps its own copy rather than sharing a module (existing repo convention).

const STAGES = [
    { key: 'triage', label: 'Triage' },
    { key: 'needs_decision', label: 'Need Decision' },
    { key: 'raise_pr', label: 'Raise PR' },
    { key: 'unit_test', label: 'Unit Test' },
    { key: 'implement', label: 'Implement' },
    { key: 'sonar_gate', label: 'Sonar Gate' },
    { key: 'e2e_verify', label: 'E2E / Human Acceptance' },
    { key: 'done', label: 'Done' },
    { key: 'blocked', label: 'Blocked' },
];

function isTouch() {
    return window.matchMedia && window.matchMedia('(hover: none)').matches;
}

function pollInterval() {
    return isTouch() ? 6000 : 3000;
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function ticketCard(ticket) {
    const isBlocked = ticket.stage === 'blocked';
    const isNeedsDecision = ticket.stage === 'needs_decision';
    const attempts = ticket.implement_attempts || 0;
    const cap = ticket.implement_attempt_cap || 3;
    const title = ticket.title || ticket.jira_key || ticket.initial_brief?.slice(0, 60) || '(untitled)';

    const badges = [];
    if (ticket.jira_key) badges.push(`<span class="pipeline-badge">${escapeHtml(ticket.jira_key)}</span>`);
    if (attempts > 0) badges.push(`<span class="pipeline-badge retry">retry ${attempts}/${cap}</span>`);
    const sonarAttempts = ticket.sonar_fix_attempts || 0;
    if (sonarAttempts > 0) badges.push(`<span class="pipeline-badge retry">sonar ${sonarAttempts}/${ticket.sonar_fix_attempt_cap || 2}</span>`);
    // The real dotnet test numbers, not just "the suite exited 0". A skipped test covers
    // nothing while still exiting zero, so surface that count on the card — it went
    // unnoticed for the whole of MR !167.
    const counts = ticket.test_counts;
    if (counts) {
        const cls = counts.failed > 0 ? 'blocked' : (counts.skipped > 0 ? 'retry' : '');
        const skipped = counts.skipped > 0 ? `, ${counts.skipped} skipped` : '';
        badges.push(`<span class="pipeline-badge ${cls}" title="${counts.total} total">${counts.passed} passed, ${counts.failed} failed${skipped}</span>`);
    }
    if (ticket.test_handoff?.state === 'missing_contract' && !counts) badges.push('<span class="pipeline-badge retry">Tests await production contracts</span>');
    if (isBlocked) badges.push('<span class="pipeline-badge blocked">blocked</span>');

    const mrLink = ticket.mr_url ? `<a href="${escapeHtml(ticket.mr_url)}" target="_blank" rel="noopener">MR !${escapeHtml(ticket.mr_iid)}</a>` : '';
    const reason = isBlocked && ticket.blocked_reason ? `<div class="pipeline-card-reason">${escapeHtml(ticket.blocked_reason)}</div>` : '';
    // Only present once a ticket reaches a terminal state (done/blocked) — see
    // lib/pipeline/cost.js, computed once rather than re-summed on every poll.
    const cost = ticket.cost ? `<span class="pipeline-badge cost" title="chat $${ticket.cost.breakdown.chat_categorization_usd} / triage $${ticket.cost.breakdown.triage_usd} / raise_pr $${ticket.cost.breakdown.raise_pr_usd} / unit_test $${ticket.cost.breakdown.unit_test_usd} / implement $${ticket.cost.breakdown.implement_usd} (${ticket.cost.breakdown.implement_attempts}x) / e2e authoring $${ticket.cost.breakdown.e2e_authoring_usd} / sonar $0">$${ticket.cost.total_usd.toFixed(2)}</span>` : '';

    // needs_decision: triage genuinely couldn't resolve something from code/DB/MCP
    // tools alone — show its specific question and a text box to answer it.
    // Submitting requeues straight to triage (routes/pipeline-routes.js), which
    // reruns it in a lighter confirm-only mode rather than a fresh investigation.
    const clarifyBox = isNeedsDecision ? `
        <div class="pipeline-card-question">${escapeHtml(ticket.clarification_question || 'Triage needs a decision from a human.')}</div>
        <textarea class="pipeline-clarify-input" id="clarify-${ticket.id}" rows="3" aria-label="Answer the clarification question" placeholder="Answer here..."></textarea>
        <button type="button" class="pipeline-clarify-btn" onclick="submitClarification('${ticket.id}')">Submit</button>
    ` : '';

    const recoveryBox = isBlocked ? `
        <textarea class="pipeline-clarify-input" id="retry-${ticket.id}" rows="2" aria-label="Guidance for retry" placeholder="Optional guidance for the retry..."></textarea>
        <div class="pipeline-card-actions">
            <button type="button" class="pipeline-clarify-btn" onclick="submitRetry('${ticket.id}')">Retry${ticket.blocked_from_stage ? ` (${escapeHtml(ticket.blocked_from_stage)})` : ''}</button>
        </div>
    ` : '';

    const isAwaitingManualE2e = ticket.stage === 'e2e_verify' && ticket.status === 'paused';
    const criteria = (ticket.spec_snapshot?.specification.acceptance_criteria.map(c => `${c.id}: ${c.text}`) || ticket.triage?.acceptance_criteria || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');
    const manualE2eBox = isAwaitingManualE2e ? `
        <div class="pipeline-card-question">Sonar passed. Verify the acceptance criteria, then record your verdict.</div>
        ${criteria ? `<ul>${criteria}</ul>` : ''}
        <textarea class="pipeline-clarify-input" id="force-${ticket.id}" rows="2" aria-label="Verification notes or failure feedback" placeholder="Verification notes (pass) or required feedback (fail)..."></textarea>
        <div class="pipeline-card-actions">
            <button type="button" class="pipeline-force-pass-btn" onclick="submitForcePass('${ticket.id}')">Pass verification</button>
            <button type="button" class="pipeline-force-fail-btn" onclick="submitForceFail('${ticket.id}')">Fail with feedback</button>
        </div>
    ` : '';

    return `
        <div class="pipeline-card${isBlocked ? ' is-blocked' : ''}${isNeedsDecision ? ' is-needs-decision' : ''}${isAwaitingManualE2e ? ' is-awaiting-manual' : ''}">
            <div class="pipeline-card-title">${escapeHtml(title)} ${cost}</div>
            <div class="pipeline-card-meta">${badges.join('')}</div>
            ${mrLink}
            ${reason}
            ${clarifyBox}
            ${recoveryBox}
            ${manualE2eBox}
        </div>
    `;
}

function submitRetry(ticketId) {
    const input = document.getElementById(`retry-${ticketId}`);
    const guidance = (input?.value || '').trim();
    if (input) input.disabled = true;
    fetch(`/api/pipeline/${ticketId}/retry`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidance }),
    })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return; }
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'failed'); });
            return fetchPipeline();
        })
        .catch(err => {
            if (input) input.disabled = false;
            alert(`Failed to retry: ${err.message}`);
        });
}

function submitForcePass(ticketId) {
    const input = document.getElementById(`retry-${ticketId}`) || document.getElementById(`force-${ticketId}`);
    const note = (input?.value || '').trim();
    if (input) input.disabled = true;
    fetch(`/api/pipeline/${ticketId}/verify-pass`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
    })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return; }
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'failed'); });
            return fetchPipeline();
        })
        .catch(err => {
            if (input) input.disabled = false;
            alert(`Failed to record verification: ${err.message}`);
        });
}

function submitForceFail(ticketId) {
    const input = document.getElementById(`retry-${ticketId}`) || document.getElementById(`force-${ticketId}`);
    const feedback = (input?.value || '').trim();
    if (!feedback) {
        alert('Describe the bug before sending this back to implement.');
        return;
    }
    if (input) input.disabled = true;
    fetch(`/api/pipeline/${ticketId}/verify-fail`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
    })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return; }
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'failed'); });
            return fetchPipeline();
        })
        .catch(err => {
            if (input) input.disabled = false;
            alert(`Failed to send back: ${err.message}`);
        });
}

function submitClarification(ticketId) {
    const input = document.getElementById(`clarify-${ticketId}`);
    const answer = (input?.value || '').trim();
    if (!answer) return;
    input.disabled = true;
    fetch(`/api/pipeline/${ticketId}/clarify`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
    })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return; }
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'failed'); });
            return fetchPipeline();
        })
        .catch(err => {
            input.disabled = false;
            alert(`Failed to submit: ${err.message}`);
        });
}

function submitNewTicket() {
    const jira_key = document.getElementById('new-ticket-jira').value.trim();
    const title = document.getElementById('new-ticket-title').value.trim();
    const initial_brief = document.getElementById('new-ticket-brief').value.trim();
    const fr_number = document.getElementById('new-ticket-fr').value.trim();
    if (!jira_key && !title && !initial_brief) return;

    const btn = document.getElementById('new-ticket-submit');
    btn.disabled = true;
    fetch('/api/pipeline/tickets', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jira_key, title, initial_brief, fr_number }),
    })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return; }
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'failed'); });
            ['new-ticket-jira', 'new-ticket-title', 'new-ticket-brief', 'new-ticket-fr'].forEach(id => {
                document.getElementById(id).value = '';
            });
            return fetchPipeline();
        })
        .catch(err => alert(`Failed to create ticket: ${err.message}`))
        .finally(() => { btn.disabled = false; });
}

function render(tickets) {
    document.getElementById('pipeline-total').textContent = tickets.length;
    document.getElementById('pipeline-active').textContent = tickets.filter(t => !['done', 'blocked', 'needs_decision'].includes(t.stage)).length;
    document.getElementById('pipeline-attention').textContent = tickets.filter(t => ['blocked', 'needs_decision'].includes(t.stage)).length;
    document.getElementById('pipeline-done').textContent = tickets.filter(t => t.stage === 'done').length;
    const board = document.getElementById('board');
    const emptyState = document.getElementById('empty-state');

    if (!tickets.length) {
        board.innerHTML = '';
        emptyState.hidden = false;
        return;
    }
    emptyState.hidden = true;

    // The 3s poll calls this on every tick and fully replaces the board's DOM below,
    // which would otherwise wipe out a note/feedback textarea mid-typing. Save the
    // in-progress values (and focus/cursor) first and restore them after re-render.
    const active = document.activeElement;
    const activeId = active && active.tagName === 'TEXTAREA' ? active.id : null;
    const activeSelection = activeId ? [active.selectionStart, active.selectionEnd] : null;
    const savedValues = {};
    board.querySelectorAll('textarea').forEach(t => { savedValues[t.id] = t.value; });

    const byStage = {};
    for (const t of tickets) {
        (byStage[t.stage] = byStage[t.stage] || []).push(t);
    }

    board.innerHTML = STAGES.map(({ key, label }) => {
        const items = byStage[key] || [];
        const colClass = key === 'blocked' ? ' blocked' : key === 'done' ? ' done' : key === 'needs_decision' ? ' needs-decision' : '';
        return `
            <div class="pipeline-column${colClass}">
                <div class="pipeline-column-header">
                    <span>${label}</span>
                    <span class="pipeline-column-count">${items.length}</span>
                </div>
                ${items.map(ticketCard).join('')}
            </div>
        `;
    }).join('');

    for (const [id, value] of Object.entries(savedValues)) {
        if (!value) continue;
        const el = document.getElementById(id);
        if (el) el.value = value;
    }
    if (activeId) {
        const el = document.getElementById(activeId);
        if (el) {
            el.focus();
            if (activeSelection) el.setSelectionRange(activeSelection[0], activeSelection[1]);
        }
    }
}

function fetchPipeline() {
    return fetch('/api/pipeline', { credentials: 'same-origin' })
        .then(res => {
            if (res.status === 401) { location.replace('/login'); return null; }
            if (!res.ok) throw new Error('Unable to load pipeline');
            return res.json();
        })
        .then(data => {
            if (!data) return;
            render(data.tickets || []);
            document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
        })
        .catch(() => { document.getElementById('last-update').textContent = 'Update failed · retrying'; });
}

let pollHandle = null;
function startPolling() {
    fetchPipeline();
    pollHandle = setInterval(fetchPipeline, pollInterval());
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(pollHandle);
    } else {
        startPolling();
    }
});


startPolling();
