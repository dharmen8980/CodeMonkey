let runs = [];

const STATUS_CLASS = {
    feasible: 'completed',
    needs_clarification: 'pending',
    infeasible: 'failed',
    error: 'failed',
    running: 'running',
};

async function fetchTriage() {
    try {
        const res = await fetch('/api/triage', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error('Unable to load triage');
        const data = await res.json();
        runs = data.runs || [];
        render();
        document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        document.getElementById('last-update').textContent = 'Failed to load';
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDuration(sec) {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
}

function detailFor(run) {
    if (run.status === 'needs_clarification' && run.clarification_question) {
        return escapeHtml(run.clarification_question);
    }
    if (run.status === 'error' && run.error) {
        return `<span class="error-text">${escapeHtml(run.error)}</span>`;
    }
    if (run.status === 'running') return 'in progress…';
    return '—';
}

function artifactLinks(run) {
    const base = `/artifacts/${run.run_id}`;
    const links = [
        ['transcript', `${base}/transcript.jsonl`],
        run.status === 'error' ? ['error', `${base}/error.json`] : ['result', `${base}/result.json`],
        ['stderr', `${base}/claude-stderr.log`],
    ];
    return links.map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`).join(' · ');
}

function render() {
    const tbody = document.getElementById('triage-tbody');
    document.getElementById('triage-count').textContent = runs.length;
    document.getElementById('triage-feasible').textContent = runs.filter(r => r.status === 'feasible').length;
    document.getElementById('triage-questions').textContent = runs.filter(r => r.status === 'needs_clarification').length;
    document.getElementById('triage-cost').textContent = '$' + runs.reduce((sum, r) => sum + (r.cost_usd || 0), 0).toFixed(2);
    const query = document.getElementById('triage-search').value.trim().toLowerCase();
    const status = document.getElementById('triage-status').value;
    const visible = runs.filter(r => (status === 'all' || status === r.status) && (!query || [r.ticket_title,r.ticket_id,r.clarification_question,r.error].some(v => String(v || '').toLowerCase().includes(query))));
    document.getElementById('triage-results').textContent = `${visible.length} of ${runs.length} runs`;
    if (!visible.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No triage runs match this view.</td></tr>';
        return;
    }
    tbody.innerHTML = visible.map(run => `
        <tr>
            <td class="run-id">${run.started_at ? new Date(run.started_at).toLocaleString() : '—'}</td>
            <td>${escapeHtml(run.ticket_title || run.ticket_id)}${run.is_retry ? ' <span class="live-badge">retry</span>' : ''}</td>
            <td><span class="badge ${STATUS_CLASS[run.status] || ''}">${escapeHtml(run.status.replaceAll('_', ' '))}</span></td>
            <td>${formatDuration(run.duration_sec)}</td>
            <td class="cost-text">$${(run.cost_usd || 0).toFixed(4)}</td>
            <td>${detailFor(run)}</td>
            <td class="run-id">${artifactLinks(run)}</td>
        </tr>`).join('');
}

function stepHtml(step) {
    if (step.kind === 'text') return `<span class="step-text">${escapeHtml(step.text)}</span>`;
    if (step.kind === 'thinking') return `<span class="step-thinking">${escapeHtml(step.text)}</span>`;
    const lines = [`<span class="step-tool"><span class="tool-name">${escapeHtml(step.name)}</span> <span class="tool-detail">${escapeHtml(step.detail)}</span></span>`];
    if (step.result != null) {
        lines.push(`<span class="step-result${step.is_error ? ' is-error' : ''}">${escapeHtml(step.result)}</span>`);
    }
    return lines.join('');
}

// Companion to fetchTriage() for polling: /api/triage re-reads every historical
// run dir on every call, fine once but too slow to poll every few seconds.
// /api/triage/live only ever touches the 0-2 runs actually in progress, so this
// alone can poll fast enough to grow a running triage's feed live.
let wasLive = false;
async function fetchLiveTriage() {
    try {
        const res = await fetch('/api/triage/live', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error('Unable to load triage');
        const data = await res.json();
        const liveRuns = data.runs || [];
        const panel = document.getElementById('live-panel');
        const container = document.getElementById('live-runs');

        if (!liveRuns.length) {
            panel.hidden = true;
            if (wasLive) { wasLive = false; fetchTriage(); } // a run just finished — refresh the log table
            return;
        }
        wasLive = true;
        panel.hidden = false;
        container.innerHTML = liveRuns.map(run => `
            <div class="tasks-header" style="margin-top: 0.5rem;">
                <div class="live-run-label">${escapeHtml(run.ticket_title || run.ticket_id)}</div>
            </div>
            <pre class="diff-body live-feed">${run.steps.length ? run.steps.map(stepHtml).join('\n') : '<span class="live-panel-empty">starting…</span>'}</pre>
        `).join('');
        container.querySelectorAll('.live-feed').forEach(el => { el.scrollTop = el.scrollHeight; });
    } catch (e) { /* transient poll failure — next tick retries */ }
}


document.getElementById('triage-search').addEventListener('input', render);
document.getElementById('triage-status').addEventListener('change', render);
fetchTriage();
setInterval(fetchTriage, 15000);
fetchLiveTriage();
setInterval(fetchLiveTriage, 3000);
