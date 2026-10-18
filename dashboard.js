let tasks = [];
let polling = null;
const expandedTasks = new Set();

function toggleTask(id, event) {
    if (event && event.target.closest('.artifact-link')) return;
    if (expandedTasks.has(id)) {
        expandedTasks.delete(id);
    } else {
        expandedTasks.add(id);
    }
    render();
}

async function fetchTasks() {
    try {
        const res = await fetch('/tasks', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error('Unable to load tasks');
        const next = await res.json();
        if (!Array.isArray(next)) throw new Error('Invalid task response');
        tasks = next;
        render();
        document.getElementById('ws-status').className = 'dot green';
        document.getElementById('ws-text').textContent = 'Connected';
        document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        document.getElementById('ws-status').className = 'dot red';
        document.getElementById('ws-text').textContent = 'Disconnected';
    }
}

// 2s polling drains a phone battery and keeps the radio awake; back off when
// the tab isn't visible and use a slower cadence on touch devices.
function isTouch() {
    return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
}

function pollInterval() {
    return isTouch() ? 6000 : 2000;
}

function startPolling() {
    fetchTasks();
    if (polling) clearInterval(polling);
    polling = setInterval(fetchTasks, pollInterval());
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (polling) { clearInterval(polling); polling = null; }
    } else if (!polling) {
        startPolling();
    }
});


function render() {
    const focusedId = document.activeElement?.dataset.taskToggle;
    const search = document.getElementById('task-search').value.trim().toLowerCase();
    const status = document.getElementById('task-status').value;
    const visibleTasks = tasks.filter(t => (status === 'all' || t.status === status) && (!search || [t.description, t.raw_message, t.run_id, t.source].some(v => String(v || '').toLowerCase().includes(search))));
    document.getElementById('task-count').textContent = `${visibleTasks.length} of ${tasks.length} tasks`;
    const total = tasks.length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const running = tasks.filter(t => t.status === 'running').length;
    const completed = tasks.filter(t => t.status === 'completed').length;

    const failed = tasks.filter(t => t.status === 'failed').length;
    const totalCost = tasks.reduce((sum, t) => sum + (t.usage?.cost_usd || 0), 0);

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-running').textContent = running;
    document.getElementById('stat-completed').textContent = completed;
    document.getElementById('stat-failed').textContent = failed;
    document.getElementById('stat-cost').textContent = `$${totalCost.toFixed(2)}`;

    const list = document.getElementById('task-list');
    if (visibleTasks.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No tasks match this view. Try a different search or status, or start a task from Chat.</p></div>';
        return;
    }

    // Newest first, by actual date — not insertion order, since reconciled/
    // backfilled runs are appended to tasks.json out of chronological order.
    const taskTime = t => {
        const ms = Date.parse(t.received_at || t.started_at || t.finished_at || '');
        return isNaN(ms) ? 0 : ms;
    };
    list.innerHTML = [...visibleTasks].sort((a, b) => taskTime(b) - taskTime(a)).map(task => {
        const hasDetail = task.output || task.error || task.run_id;
        const isExpanded = expandedTasks.has(task.id);
        const runId = task.run_id || '';
        let detailHtml = '';
        if (isExpanded && hasDetail) {
            if (task.error) {
                detailHtml = `
                    <div class="task-detail">
                        <div class="task-detail-label">Error</div>
                        <div class="task-detail-output error">${escapeHtml(task.error)}</div>
                    </div>`;
            }
            if (task.output) {
                detailHtml += `
                    <div class="task-detail">
                        <div class="task-detail-label">Output</div>
                        <div class="task-detail-output">${escapeHtml(task.output)}</div>
                    </div>`;
            }
            if (runId) {
                detailHtml += `
                    <div class="task-artifacts">
                        <a class="artifact-link" href="/artifacts/${runId}/stdout.log" target="_blank">stdout.log</a>
                        <a class="artifact-link" href="/artifacts/${runId}/transcript.jsonl" target="_blank">transcript.jsonl</a>
                        <a class="artifact-link" href="/artifacts/${runId}/events.jsonl" target="_blank">events.jsonl</a>
                        <a class="artifact-link" href="/artifacts/${runId}/changes.diff" target="_blank">changes.diff</a>
                        <a class="artifact-link" href="/artifacts/${runId}/manifest.json" target="_blank">manifest.json</a>
                        <a class="artifact-link" href="/artifacts/${runId}/usage.json" target="_blank">usage.json</a>
                        <a class="artifact-link" href="/artifacts/${runId}/instructions.md" target="_blank">instructions</a>
                        <a class="artifact-link" href="/artifacts/${runId}/run-context.json" target="_blank">run context</a>
                    </div>`;
            }
        }

        const durationStr = task.duration_ms
            ? `${Math.floor(task.duration_ms / 60000)}m ${Math.floor((task.duration_ms % 60000) / 1000)}s`
            : '';

        return `
        <div class="task-card" data-task="${escapeHtml(task.id)}">
            <div class="task-top">
                <div class="task-desc">${hasDetail ? `<button type="button" class="task-toggle" data-task-toggle="${escapeHtml(task.id)}" aria-expanded="${isExpanded}">${escapeHtml(task.description || task.raw_message || '—')}</button>` : escapeHtml(task.description || task.raw_message || '—')}</div>
                <span class="badge ${task.status}">${task.status}</span>
            </div>
            <div class="task-meta">
                <span class="task-type">${task.task_type || 'new-task'}</span>
                ${runId ? `<span class="run-id">${runId}</span>` : ''}
                <span>Source: ${task.source || '—'}</span>
                <span>Received: ${new Date(task.received_at).toLocaleString()}</span>
                ${task.finished_at ? `<span>Finished: ${new Date(task.finished_at).toLocaleString()}</span>` : ''}
                ${durationStr ? `<span class="duration">⏱ ${durationStr}</span>` : ''}
                ${task.usage?.model ? `<span class="cost-text">${escapeHtml(task.usage.model)}</span>` : ''}
                ${task.usage ? `<span>Tokens: ${(task.usage.input_tokens || 0).toLocaleString()} in / ${(task.usage.output_tokens || 0).toLocaleString()} out</span>` : ''}
                ${task.usage ? `<span class="cost-text">$${(task.usage.cost_usd || 0).toFixed(4)}</span>` : ''}
                ${task.usage?.timing ? `<span>Clone: ${task.usage.timing.clone_sec}s | Claude: ${task.usage.timing.claude_sec}s | Total: ${task.usage.timing.total_sec}s</span>` : ''}
                ${task.container ? `<span class="container-name">${task.container}</span>` : ''}
            </div>
            ${hasDetail ? `<div class="task-expand-hint">${isExpanded ? '▲ collapse' : '▼ click to expand'}</div>` : ''}
            ${detailHtml}
        </div>`;
    }).join('');
    if (focusedId) [...list.querySelectorAll('[data-task-toggle]')].find(el => el.dataset.taskToggle === focusedId)?.focus({ preventScroll: true });
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

document.getElementById('task-search').addEventListener('input', render);
document.getElementById('task-status').addEventListener('change', render);
document.getElementById('task-list').addEventListener('click', event => {
    if (event.target.closest('a') || window.getSelection()?.toString()) return;
    const card = event.target.closest('[data-task]');
    if (card) toggleTask(card.dataset.task, event);
});

startPolling();
