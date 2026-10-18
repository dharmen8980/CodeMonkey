'use strict';

const $ = id => document.getElementById(id);
const PHASES = ['discovery', 'edit', 'build_test', 'git', 'other'];
const PHASE_LABELS = { discovery: 'Discovery', edit: 'Edit / write', build_test: 'Build / test', git: 'Git / MR', other: 'Other' };
const PHASE_COLORS = { discovery: 'var(--phase-discovery)', edit: 'var(--phase-edit)', build_test: 'var(--phase-build)', git: 'var(--phase-git)', other: 'var(--phase-other)' };
const CATEGORIES = [
    { key: 'input', label: 'Input', phase: 'other' },
    { key: 'cache_read', label: 'Cache read', phase: 'discovery' },
    { key: 'cache_write', label: 'Cache write', phase: 'git' },
    { key: 'output', label: 'Output', phase: 'edit' },
];
const STATUS_LABELS = { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed', timeout: 'Timed out', killed: 'Stopped' };
const FINISHED_STATUSES = new Set(['completed', 'failed', 'timeout', 'killed']);
const SORT_OPTIONS = [
    ['finished_at', 'Most recent'], ['description', 'Task name'], ['status', 'Status'], ['agent', 'Agent'],
    ['task_type', 'Task type'], ['model', 'Model'], ['num_turns', 'Model turns'], ['tool_calls_total', 'Tool calls'],
    ...PHASES.flatMap(p => [[`${p}_pct`, `${PHASE_LABELS[p]} · calls`], [`${p}_cost_pct`, `${PHASE_LABELS[p]} · cost`]]),
    ['turns_before_first_edit', 'Calls before edit'], ['cost_usd', 'Cost'], ['diff_lines', 'Changed lines'],
];
const METRICS = {
    num_turns: { label: 'Model turns per run' },
    discovery_pct: { label: 'Discovery share per run', percent: true },
    turns_before_first_edit: { label: 'Tool calls before the first edit' },
    cost_usd: { label: 'Cost per run', currency: true },
};
const PAGE_SIZE = 12;
let data = { tasks: [] };
let taskRecords = [];
let tasksLoaded = false;
let tasksFetching = false;
let taskPolling = null;
let dateRange = 'all';
let phaseMode = 'turns';
let runMode = 'turns';
let compareBy = 'agent';
let sortKey = 'finished_at';
let sortDir = 'desc';
let page = 1;
let loaded = false;
let fullFetching = false;
let liveFetching = false;
let livePolling = null;
let liveTaskIds = new Set();
let detailRequest = 0;
let tableDirty = false;
const expanded = new Set();
const expandedAnalysis = new Set();
const expandedArtifacts = new Set();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const number = n => Number.isFinite(n) ? n : 0;
const fmtTok = n => Math.round(number(n)).toLocaleString();
const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number(n));
const money = (n, digits = 2) => `$${number(n).toFixed(digits)}`;
const percentage = n => `${(number(n) * 100).toFixed(0)}%`;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const average = (tasks, key) => mean(tasks.map(t => t[key]).filter(Number.isFinite));
const shortModel = model => model ? model.replace(/^us\.anthropic\./, '').replace(/-v\d+:\d+$/, '') : 'Unknown model';
const hasEdit = task => (task.phase_counts?.edit || 0) > 0 || (task.tool_calls || []).some(c => c.phase === 'edit');
const metricValue = (task, key) => key === 'turns_before_first_edit' && !hasEdit(task) ? null : task[key];
function fmtDuration(sec) {
    if (!Number.isFinite(sec)) return '—';
    return sec >= 60 ? `${(sec / 60).toFixed(1)}m` : `${sec.toFixed(1)}s`;
}
function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : ''; }
    catch { return ''; }
}
function allTasks() {
    const rows = new Map(taskRecords.map(task => [task.id, {
        ...task,
        agent: task.task_type === 'unit-test' ? 'UnitTest' : 'CodeMonkey',
        model: task.usage?.model || null,
        cost_usd: task.usage?.cost_usd ?? null,
        analysis_available: false,
    }]));
    for (const analyzed of data.tasks) {
        const raw = rows.get(analyzed.id) || {};
        rows.set(analyzed.id, {
            ...raw, ...analyzed,
            status: raw.status || analyzed.status,
            error: raw.error || analyzed.error,
            cost_usd: raw.usage?.cost_usd ?? analyzed.cost_usd,
            analysis_available: !raw.status || raw.status === analyzed.status,
        });
    }
    return [...rows.values()];
}
function scopedTasks() {
    const tasks = allTasks();
    if (dateRange === 'all') return tasks;
    const cutoff = Date.now() - Number(dateRange) * 86400000;
    return tasks.filter(t => new Date(t.finished_at || t.started_at || t.received_at).getTime() >= cutoff);
}
const finishedTasks = () => scopedTasks().filter(t => t.analysis_available && FINISHED_STATUSES.has(t.status));
function setSync(message, state = 'connected') {
    if ($('last-update').textContent !== message) $('last-update').textContent = message;
    $('sync-status').className = `sync-status ${state}`;
}
function updated() {
    setSync(`Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
}

async function fetchTaskOverview() {
    if (tasksFetching) return;
    tasksFetching = true;
    try {
        const res = await fetch('/tasks', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = await res.json();
        if (!Array.isArray(next)) throw new Error('Invalid task response');
        const changed = !tasksLoaded || JSON.stringify(next) !== JSON.stringify(taskRecords);
        if (changed) taskRecords = next;
        tasksLoaded = true;
        $('operations').setAttribute('aria-busy', 'false');
        if (changed) render();
        updated();
    } catch {
        if (!tasksLoaded && !loaded) {
            $('turns-tbody').innerHTML = '<tr><td colspan="7" class="table-empty"><strong>Tasks are unavailable</strong>Use refresh to reconnect.</td></tr>';
            $('results-summary').textContent = 'Not connected';
        }
        setSync('Task updates interrupted · retrying', 'stale');
    } finally { tasksFetching = false; }
}

async function fetchTurns() {
    if (fullFetching) return;
    fullFetching = true;
    $('refresh').disabled = true;
    $('refresh').classList.add('loading');
    setSync(loaded ? 'Refreshing…' : 'Reading transcripts…', '');
    try {
        const res = await fetch('/api/turns', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = await res.json();
        if (!Array.isArray(next.tasks)) throw new Error('Invalid turns response');
        data = next;
        loaded = true;
        liveTaskIds = new Set(data.tasks.filter(t => t.status === 'running').map(t => t.id));
        $('load-error').hidden = true;
        $('metrics').setAttribute('aria-busy', 'false');
        render();
        updated();
    } catch {
        setSync(loaded ? 'Update failed · showing saved view' : 'Unable to connect', 'stale');
        $('load-error-text').textContent = loaded ? 'The latest update failed. Your last loaded data is still shown.' : 'We couldn’t load the run history. Try again to reconnect.';
        $('load-error').hidden = false;
        $('metrics').setAttribute('aria-busy', 'false');
        if (!loaded) {
            if (!tasksLoaded) {
                $('turns-tbody').innerHTML = '<tr><td colspan="7" class="table-empty"><strong>Run history is unavailable</strong>Use “Try again” to reconnect.</td></tr>';
                $('results-summary').textContent = 'Not connected';
            }
            $('phase-breakdown').innerHTML = '<div class="panel-placeholder">Phase data unavailable.</div>';
            $('category-rows').innerHTML = '<div class="panel-placeholder" style="padding-left:22px">Cost data unavailable.</div>';
            $('comparison-tbody').innerHTML = '<tr><td colspan="6" class="table-empty">Comparison data unavailable.</td></tr>';
        }
    } finally {
        fullFetching = false;
        $('refresh').disabled = false;
        $('refresh').classList.remove('loading');
    }
}

// Only the live endpoint is polled: historical transcript parsing is expensive.
// A run leaving the live set triggers a full refresh so finished-run stats settle.
async function fetchLive() {
    if (!loaded || fullFetching || liveFetching || document.hidden) return;
    liveFetching = true;
    try {
        const res = await fetch('/api/turns/live', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = await res.json();
        if (!Array.isArray(next.tasks)) throw new Error('Invalid live response');
        if (fullFetching) return;
        const newIds = new Set(next.tasks.map(t => t.id));
        if ([...liveTaskIds].some(id => !newIds.has(id))) { await fetchTurns(); return; }
        liveTaskIds = newIds;
        const byId = new Map(data.tasks.map(t => [t.id, t]));
        let changed = false;
        for (const task of next.tasks) {
            if (JSON.stringify(byId.get(task.id)) !== JSON.stringify(task)) changed = true;
            byId.set(task.id, task);
        }
        if (changed) { data.tasks = [...byId.values()]; render(); }
        if (!$('load-error').hidden) return;
        updated();
    } catch { if (!fullFetching) setSync('Live updates interrupted · retrying', 'stale'); }
    finally { liveFetching = false; }
}
function startLivePolling() {
    clearInterval(livePolling);
    clearInterval(taskPolling);
    if (document.hidden) return;
    livePolling = setInterval(fetchLive, window.matchMedia('(hover: none)').matches ? 6000 : 3000);
    taskPolling = setInterval(fetchTaskOverview, 6000);
}
document.addEventListener('visibilitychange', () => {
    clearInterval(livePolling);
    clearInterval(taskPolling);
    if (!document.hidden) { fetchTaskOverview(); if (loaded) fetchLive(); else fetchTurns(); startLivePolling(); }
});

function renderOperations(tasks) {
    const count = status => tasks.filter(t => t.status === status).length;
    $('ops-total').textContent = fmtTok(tasks.length);
    for (const status of ['pending', 'running', 'completed', 'failed']) $('ops-' + status).textContent = fmtTok(count(status));
    const totalCost = tasks.reduce((sum, task) => sum + number(task.cost_usd), 0);
    const approximate = tasks.some(t => t.cost_approx);
    $('ops-cost').textContent = `${approximate ? '~' : ''}${money(totalCost)}`;
    $('ops-cost').title = approximate ? 'Includes estimated costs for runs without reported totals.' : 'Sum of reported task costs';
    $('operations-scope').textContent = `All tasks · ${$('date-range').selectedOptions[0].textContent}`;
}

function renderStats(tasks) {
    $('stat-count').textContent = fmtTok(tasks.length);
    const turns = average(tasks, 'num_turns');
    const discovery = average(tasks, 'discovery_pct');
    const editTasks = tasks.filter(hasEdit);
    const firstEdit = average(editTasks, 'turns_before_first_edit');
    const cost = average(tasks, 'cost_usd');
    $('stat-avg-turns').textContent = turns == null ? '—' : turns.toFixed(1);
    $('stat-avg-discovery').textContent = discovery == null ? '—' : percentage(discovery);
    $('stat-avg-first-edit').textContent = firstEdit == null ? '—' : firstEdit.toFixed(1);
    $('stat-avg-first-edit').title = `${editTasks.length} runs made an edit; runs with no edits are excluded.`;
    const approximate = tasks.some(t => t.cost_approx);
    $('stat-avg-cost').innerHTML = cost == null ? '—' : `<span class="value-unit">${approximate ? '~$' : '$'}</span>${cost.toFixed(2)}`;
    $('stat-avg-cost').title = approximate ? 'Includes estimated costs that exclude unreported output and reasoning.' : 'Average of reported run costs';
    const completed = tasks.filter(t => t.status === 'completed').length;
    $('stat-outcomes').textContent = tasks.length ? `${fmtTok(completed)} completed · ${fmtTok(tasks.length - completed)} other outcomes` : 'No finished runs in this period';
    $('overview-scope').textContent = `Finished runs · ${$('date-range').selectedOptions[0].textContent}`;
    const liveCount = scopedTasks().filter(t => t.status === 'running').length;
    $('live-filter').hidden = !liveCount;
    $('live-filter').textContent = `${liveCount} running now ↗`;
}
function phaseTotals(tasks, mode) {
    const key = mode === 'cost' ? 'phase_costs' : 'phase_counts';
    return Object.fromEntries(PHASES.map(p => [p, tasks.reduce((sum, task) => sum + number(task[key]?.[p]), 0)]));
}
function renderPhases(tasks) {
    const totals = phaseTotals(tasks, phaseMode);
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    let offset = 0;
    const stops = PHASES.map(p => {
        const start = offset;
        offset += total ? totals[p] / total * 100 : 0;
        return `${PHASE_COLORS[p]} ${start}% ${offset}%`;
    });
    $('phase-donut').style.background = total ? `conic-gradient(${stops.join(',')})` : 'var(--border)';
    $('phase-donut').setAttribute('aria-label', total ? PHASES.map(p => `${PHASE_LABELS[p]}: ${percentage(totals[p] / total)}`).join(', ') : 'No phase data in this period');
    $('phase-total').textContent = phaseMode === 'cost' ? money(total) : compact(total);
    $('phase-total').title = phaseMode === 'cost' ? money(total, 4) : fmtTok(total);
    $('phase-unit').textContent = phaseMode === 'cost' ? 'total USD' : 'tool calls';
    $('phase-breakdown').innerHTML = PHASES.map(p => `<div class="phase-line ${p}"><span class="phase-name"><i class="phase-dot"></i>${PHASE_LABELS[p]}</span><span class="phase-quantity">${phaseMode === 'cost' ? money(totals[p]) : fmtTok(totals[p])}</span><strong>${percentage(total ? totals[p] / total : 0)}</strong></div>`).join('');
    const largest = PHASES.reduce((a, b) => totals[a] >= totals[b] ? a : b);
    $('phase-insight').innerHTML = total ? `<strong>${PHASE_LABELS[largest]}</strong> accounts for <strong>${percentage(totals[largest] / total)}</strong> of ${phaseMode === 'cost' ? 'estimated phase spend' : 'all tool calls'} in this period.` : 'Phase activity will appear when a run has a transcript.';
}
function renderCategories(tasks) {
    const costs = CATEGORIES.map(c => average(tasks, `${c.key}_cost_usd`));
    const total = costs.reduce((a, b) => a + number(b), 0);
    $('category-stack').innerHTML = CATEGORIES.map((c, i) => `<span class="${c.phase}" style="width:${total ? costs[i] / total * 100 : 0}%" title="${c.label}: ${percentage(total ? costs[i] / total : 0)} of category cost"></span>`).join('');
    $('category-stack').setAttribute('aria-label', CATEGORIES.map((c, i) => `${c.label}: ${percentage(total ? costs[i] / total : 0)}`).join(', '));
    $('category-rows').innerHTML = CATEGORIES.map((c, i) => {
        const tokens = average(tasks, `${c.key}_tokens`);
        return `<div class="cost-row ${c.phase}"><span><i class="phase-dot"></i>${c.label}</span><span class="token-count" title="${tokens == null ? 'No reported token counts' : `${fmtTok(tokens)} average tokens`}">${tokens == null ? '—' : compact(tokens)}</span><span title="${costs[i] == null ? 'No reported cost' : `${money(costs[i], 4)} · ${percentage(total ? costs[i] / total : 0)} of category cost`}">${costs[i] == null ? '—' : money(costs[i], costs[i] > 0 && costs[i] < .01 ? 4 : 2)}</span></div>`;
    }).join('');
    const approx = tasks.filter(t => t.cost_approx).length;
    const missing = tasks.filter(t => t.cost_usd == null).length;
    $('cost-note').textContent = approx || missing
        ? `${approx ? `${approx} estimated run${approx === 1 ? '' : 's'} exclude unreported output cost. ` : ''}${missing ? `${missing} runs have no reported cost.` : 'Phase cost splits are estimates.'}`
        : 'Run totals are reported; phase and per-call cost splits are estimates.';
}
function phaseMix(values, mode = 'turns') {
    const label = PHASES.map(p => `${PHASE_LABELS[p]} ${percentage(values[p])}`).join(' · ');
    const largest = PHASES.reduce((a, b) => number(values[a]) >= number(values[b]) ? a : b);
    const hasData = PHASES.some(p => values[p] > 0);
    return `<div class="phase-mix" role="img" aria-label="${label}" title="${label}">${PHASES.map(p => `<span class="${p}" style="width:${Math.max(0, Math.min(100, number(values[p]) * 100))}%"></span>`).join('')}</div><div class="mix-label">${hasData ? `${percentage(values[largest])} ${PHASE_LABELS[largest].toLowerCase()}${mode === 'cost' ? ' cost' : ''}` : 'No phase data'}</div>`;
}
function renderComparison(tasks) {
    const groups = new Map();
    for (const task of tasks) {
        const key = compareBy === 'model' ? shortModel(task.model) : task.agent || 'Unknown agent';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
    }
    $('comparison-group').textContent = compareBy === 'agent' ? 'Agent' : 'Model';
    $('comparison-tbody').innerHTML = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, rows], index) => {
        const phasePcts = Object.fromEntries(PHASES.map(p => [p, average(rows, `${p}_pct`) || 0]));
        const turns = average(rows, 'num_turns');
        const edits = average(rows.filter(hasEdit), 'turns_before_first_edit');
        const cost = average(rows, 'cost_usd');
        const approx = rows.some(t => t.cost_approx);
        return `<tr><td><div class="comparison-name"><span class="agent-avatar ${index % 2 ? 'secondary' : ''}">${compareBy === 'model' ? icon('turns') : escapeHtml(name === 'UnitTest' ? 'UT' : name === 'CodeMonkey' ? 'CM' : name.slice(0, 2).toUpperCase())}</span><div><span class="agent-name">${escapeHtml(compareBy === 'model' ? shortModel(name) : name)}</span><span class="agent-description">${compareBy === 'model' ? 'Model' : name === 'UnitTest' ? 'Test authoring' : name === 'CodeMonkey' ? 'Implementation' : 'Agent'}</span></div></div></td><td class="numeric">${fmtTok(rows.length)}</td><td class="numeric">${turns == null ? '—' : turns.toFixed(1)}</td><td>${phaseMix(phasePcts)}</td><td class="numeric" title="Average over runs that made an edit">${edits == null ? '—' : edits.toFixed(1)}</td><td class="numeric cost-value" title="${approx ? 'Includes estimated costs' : 'Average reported cost'}">${cost == null ? '—' : `${approx ? '~' : ''}${money(cost)}`}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="table-empty">No finished runs to compare in this period.</td></tr>';
}

function filteredTasks() {
    const query = $('run-search').value.trim().toLowerCase();
    const agent = $('agent-filter').value;
    const status = $('status-filter').value;
    return scopedTasks().filter(t => (agent === 'all' || t.agent === agent) && (status === 'all' || t.status === status)
        && (!query || [t.description, t.raw_message, t.id, t.run_id, t.model, t.agent, t.task_type, t.source, t.mr_iid].some(v => String(v ?? '').toLowerCase().includes(query))));
}
function sortValue(task) {
    if (sortKey === 'finished_at') {
        const time = new Date(task.finished_at || task.started_at || task.received_at || 0).getTime();
        return ['pending', 'running'].includes(task.status) ? 1e15 + time : time;
    }
    if (sortKey === 'turns_before_first_edit' && !hasEdit(task)) return null;
    return task[sortKey] ?? null;
}
function sortedTasks() {
    return filteredTasks().sort((a, b) => {
        const av = sortValue(a), bv = sortValue(b);
        if (av == null) return bv == null ? 0 : 1;
        if (bv == null) return -1;
        const result = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv), undefined, { numeric: true }) : av === bv ? 0 : av > bv ? 1 : -1;
        return sortDir === 'asc' ? result : -result;
    });
}
function renderAgentFilter() {
    const select = $('agent-filter');
    const value = select.value;
    const agents = [...new Set(allTasks().map(t => t.agent).filter(Boolean))].sort();
    select.innerHTML = '<option value="all">All agents</option>' + agents.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    select.value = agents.includes(value) ? value : 'all';
}
function dateLabel(task) {
    const date = new Date(task.finished_at || task.started_at || task.received_at);
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
    return `${task.status === 'running' ? 'Since ' : task.status === 'pending' ? 'Received ' : ''}${short} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function diffButton(task) {
    if (task.diff_lines == null) return '<span class="muted">—</span>';
    return `<button type="button" class="artifact-button" data-action="diff" data-task="${escapeHtml(task.id)}" data-focus="diff-${escapeHtml(task.id)}" aria-label="View changes for ${escapeHtml(task.description || task.id)}"><span class="diff-positive">+${fmtTok(task.diff_additions)}</span> <span class="diff-negative">−${fmtTok(task.diff_deletions)}</span></button>`;
}
function renderTask(task, index) {
    const open = expanded.has(task.id);
    const live = task.status === 'running';
    const pcts = Object.fromEntries(PHASES.map(p => [p, task[`${p}${runMode === 'cost' ? '_cost' : ''}_pct`]]));
    const statusClass = Object.hasOwn(STATUS_LABELS, task.status) ? task.status : '';
    const costTitle = task.cost_approx ? 'Estimated tracked input and cache cost. Unreported output and reasoning cost is excluded.' : 'Reported total run cost';
    return `<tr class="task-row${live ? ' task-row-live' : ''}${open ? ' is-expanded' : ''}" data-task="${escapeHtml(task.id)}">
        <td><div class="task-title"><button type="button" class="expand-run" data-action="toggle" data-task="${escapeHtml(task.id)}" data-focus="run-${escapeHtml(task.id)}" aria-expanded="${open}" ${open ? `aria-controls="run-detail-${index}"` : ''}>${icon('chevron')}<span class="task-description">${escapeHtml(task.description || task.raw_message || task.id)}</span></button></div><div class="task-meta"><span class="status-tag ${statusClass}">${escapeHtml(STATUS_LABELS[task.status] || task.status || 'Unknown')}</span><span class="meta-separator">/</span><span title="${escapeHtml(task.finished_at || task.started_at || task.received_at || '')}">${escapeHtml(dateLabel(task))}</span>${task.task_type ? `<span class="meta-separator">/</span><span>${escapeHtml(task.task_type)}</span>` : ''}</div></td>
        <td><span class="agent-name">${escapeHtml(task.agent || 'Unknown agent')}</span><span class="model-name" title="${escapeHtml(task.model || '')}">${escapeHtml(shortModel(task.model))}</span></td>
        <td class="numeric" data-label="Tool calls" title="${task.num_turns == null ? 'Model turn count unavailable' : `${task.num_turns} model turns`}">${task.analysis_available ? fmtTok(task.tool_calls_total) : '—'}</td>
        <td>${task.analysis_available ? phaseMix(pcts, runMode) : '<span class="muted">—</span>'}</td>
        <td class="numeric" data-label="Before edit" title="${task.analysis_available && hasEdit(task) ? 'Tool calls before the first edit' : 'No edit data for this task'}">${task.analysis_available && hasEdit(task) ? fmtTok(task.turns_before_first_edit) : '—'}</td>
        <td class="numeric cost-value" data-label="Cost" title="${costTitle}${task.cost_usd == null ? '' : ` · ${money(task.cost_usd, 4)}`}">${task.cost_usd == null ? '—' : `${task.cost_approx ? '~' : ''}${money(task.cost_usd, task.cost_usd > 0 && task.cost_usd < .01 ? 4 : 2)}`}</td>
        <td class="numeric" data-label="Changes">${task.analysis_available ? diffButton(task) : '<span class="muted">—</span>'}</td>
    </tr>${open ? `<tr class="detail-row"><td colspan="7"><div class="run-details" id="run-detail-${index}">${renderRunDetails(task)}</div></td></tr>` : ''}`;
}
function renderTable() {
    // Keep the dialog opener in the DOM while native focus restoration needs it.
    if (document.querySelector('dialog[open]')) { tableDirty = true; return; }
    tableDirty = false;
    const focused = document.activeElement?.dataset.focus;
    const scrolls = new Map([...document.querySelectorAll('.timeline')].map(el => [el.dataset.task, [el.scrollTop, el.scrollLeft]]));
    const tasks = sortedTasks();
    const pages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const start = (page - 1) * PAGE_SIZE;
    $('run-count').textContent = fmtTok(tasks.length);
    $('results-summary').textContent = `${fmtTok(tasks.length)} of ${fmtTok(scopedTasks().length)} tasks${dateRange === 'all' ? ' · all history' : ` · last ${dateRange} days`}`;
    $('clear-filters').hidden = !$('run-search').value && $('agent-filter').value === 'all' && $('status-filter').value === 'all';
    $('export-csv').disabled = !tasks.length;
    $('export-csv').title = `Export all ${tasks.length} matching tasks`;
    $('turns-tbody').innerHTML = tasks.length ? tasks.slice(start, start + PAGE_SIZE).map(renderTask).join('')
        : `<tr><td colspan="7" class="table-empty"><strong>${scopedTasks().length ? 'No matching tasks' : 'A fresh page, for now'}</strong>${scopedTasks().length ? 'Try another search or reset your filters.' : 'Tasks will appear here when they arrive. You can also choose a different date range.'}</td></tr>`;
    $('page-summary').textContent = tasks.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, tasks.length)} of ${tasks.length}` : '0 tasks';
    $('previous-page').disabled = page <= 1;
    $('next-page').disabled = page >= pages;
    $('run-sort').value = sortKey;
    $('sort-direction').textContent = sortDir === 'desc' ? '↓' : '↑';
    $('sort-direction').setAttribute('aria-label', sortDir === 'desc' ? 'Sort ascending' : 'Sort descending');
    document.querySelectorAll('#turns-table th[data-sort]').forEach(th => {
        th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.querySelector('.sort-indicator').textContent = th.dataset.sort === sortKey ? (sortDir === 'asc' ? '↑' : '↓') : '';
    });
    if (focused) [...document.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === focused)?.focus({ preventScroll: true });
    document.querySelectorAll('.timeline').forEach(el => {
        const position = scrolls.get(el.dataset.task);
        if (position) { el.scrollTop = position[0]; el.scrollLeft = position[1]; }
    });
}

function renderArtifactLinks(task) {
    if (!task.run_id) return '';
    const root = `/artifacts/${encodeURIComponent(task.run_id)}/`;
    const files = [
        ['stdout.log', 'stdout.log'], ['transcript.jsonl', 'transcript.jsonl'],
        ['events.jsonl', 'events.jsonl'], ['changes.diff', 'changes.diff'],
        ['manifest.json', 'manifest.json'], ['usage.json', 'usage.json'],
        ['instructions.md', 'instructions'], ['run-context.json', 'run context'],
    ];
    return `<details class="detail-disclosure" data-artifacts-task="${escapeHtml(task.id)}" ${expandedArtifacts.has(task.id) ? 'open' : ''}><summary>Artifacts <span>${files.length} files</span></summary><div class="artifact-links">${files.map(([file, label]) => `<a href="${root}${file}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}</div></details>`;
}
function renderRunDetails(task) {
    const calls = task.tool_calls || [];
    const mrUrl = safeUrl(task.mr_url);
    const request = task.comment || task.review_comments || task.raw_message || task.description;
    const meta = [
        ['Source', task.source], ['Task type', task.task_type], ['Received', task.received_at ? new Date(task.received_at).toLocaleString() : null],
        ['Started', task.started_at ? new Date(task.started_at).toLocaleString() : null],
        ['Finished', task.finished_at ? new Date(task.finished_at).toLocaleString() : null],
        ['Duration', task.duration_ms ? fmtDuration(task.duration_ms / 1000) : null],
        ['Container', task.container],
        ['Tokens', task.usage ? `${fmtTok(task.usage.input_tokens)} in / ${fmtTok(task.usage.output_tokens)} out` : null],
        ['Timing', task.usage?.timing ? `Clone ${task.usage.timing.clone_sec}s · Agent ${task.usage.timing.claude_sec}s · Total ${task.usage.timing.total_sec}s` : null],
    ].filter(([, value]) => value != null && value !== '');
    const analysis = task.analysis_available ? `<details class="detail-disclosure run-analysis" data-analysis-task="${escapeHtml(task.id)}" ${expandedAnalysis.has(task.id) ? 'open' : ''}><summary>How this run worked <span>${fmtTok(calls.length)} tool calls · ${task.num_turns == null ? 'turns unavailable' : `${fmtTok(task.num_turns)} model turns`}</span></summary><div class="run-analysis-body">
        <div class="detail-phase-grid">${PHASES.map(p => `<div class="detail-phase ${p}"><div class="detail-phase-label"><i class="phase-dot"></i>${PHASE_LABELS[p]}</div><span>${fmtTok(task.phase_counts?.[p])} calls · ${percentage(task[`${p}_pct`])}</span><span>${money(task.phase_costs?.[p], 4)} · ${percentage(task[`${p}_cost_pct`])} of cost</span></div>`).join('')}</div>
        <div class="timeline-heading"><span>TOOL CALL TIMELINE · ${calls.length} calls</span><span>Blue line marks the first edit · select a tool for input and result</span></div>
        <div class="timeline" data-task="${escapeHtml(task.id)}" tabindex="0" role="region" aria-label="Tool call timeline">${calls.length ? calls.map((call, i) => renderToolRow(task, call, i)).join('') + renderTimelineTotals(calls) : '<div class="panel-placeholder">No tool calls captured yet.</div>'}</div></div></details>` : '';
    return `<div class="detail-heading"><div><h3>Task details</h3><div class="run-id">${escapeHtml(task.run_id || task.id)}</div></div><div class="detail-actions">${task.analysis_available && task.run_id ? `<button type="button" class="text-button" data-action="prompt" data-task="${escapeHtml(task.id)}" data-focus="prompt-${escapeHtml(task.id)}">Run instructions ↗</button>` : ''}${mrUrl ? `<a href="${mrUrl}" target="_blank" rel="noopener noreferrer">Merge request ↗</a>` : ''}</div></div>
        <div class="task-facts">${meta.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        ${request ? `<div class="task-comment"><div class="task-comment-label">REQUEST</div><div class="task-comment-body">${escapeHtml(request)}</div></div>` : ''}
        ${task.error ? `<div class="task-comment task-comment-error"><div class="task-comment-label">${escapeHtml(STATUS_LABELS[task.status] || task.status)} · DETAILS</div><div class="task-comment-body">${escapeHtml(task.error)}</div></div>` : ''}
        ${task.output ? `<div class="task-comment task-output"><div class="task-comment-label">RESULT</div><div class="task-comment-body">${escapeHtml(task.output)}</div></div>` : ''}
        ${renderArtifactLinks(task)}${analysis}`;
}
function tokenMeta(call) {
    return `<span class="tl-meta"><span class="tl-cost">${money(call.cost_usd, 4)}</span><span class="tl-tokens" title="Input and cache counts are exact; output per call is estimated">in ${fmtTok(call.input_tokens)} · cache-r ${fmtTok(call.cache_read_tokens)} · cache-w ${fmtTok(call.cache_creation_tokens)} · out≈${fmtTok(call.output_tokens_est)}</span></span>`;
}
function renderToolRow(task, call, index) {
    const phase = PHASES.includes(call.phase) ? call.phase : 'other';
    return `<div class="tl-row${hasEdit(task) && index === task.turns_before_first_edit ? ' edit-marker' : ''}"><span class="tl-idx">${index + 1}</span><span class="tl-duration" title="Time since the previous tool result, including model thinking">${fmtDuration(call.duration_sec)}</span><button type="button" class="tl-name tl-name-click phase-${phase}" data-action="tool" data-task="${escapeHtml(task.id)}" data-call="${index}" data-focus="tool-${escapeHtml(task.id)}-${index}" title="Open ${escapeHtml(call.name)} input and result">${escapeHtml(call.name)}</button><span class="tl-detail" title="${escapeHtml(call.detail)}">${escapeHtml(call.detail)}</span>${tokenMeta(call)}</div>`;
}
function renderTimelineTotals(calls) {
    const keys = ['duration_sec', 'input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens_est', 'cost_usd'];
    const totals = Object.fromEntries(keys.map(key => [key, calls.reduce((sum, call) => sum + number(call[key]), 0)]));
    return `<div class="tl-row tl-totals-row"><span class="tl-idx">Σ</span><span class="tl-duration">${fmtDuration(totals.duration_sec)}</span><span class="tl-name">Total</span><span class="tl-detail">${calls.length} tool calls</span>${tokenMeta(totals)}</div>`;
}

function render() {
    renderOperations(scopedTasks());
    const tasks = finishedTasks();
    if (loaded) {
        renderStats(tasks);
        renderPhases(tasks);
        renderCategories(tasks);
        renderComparison(tasks);
    }
    renderAgentFilter();
    renderTable();
}

function classifyDiffLine(line) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'diff-meta';
    if (line.startsWith('@@')) return 'diff-hunk';
    if (line.startsWith('+')) return 'diff-add';
    if (line.startsWith('-')) return 'diff-del';
    return 'diff-context';
}


function renderToolModalBody(detail) {
    const { name, input = {}, result, is_error, thinking, text } = detail;
    const lines = [];
    if (thinking) {
        lines.push(['diff-hunk', '@@ model thinking (why this call took time) @@']);
        thinking.split('\n').forEach(l => lines.push(['diff-thinking', l]));
    }
    if (text) {
        lines.push(['diff-hunk', '@@ model text @@']);
        text.split('\n').forEach(l => lines.push(['diff-context', l]));
    }
    if (name === 'Edit' && typeof input.old_string === 'string') {
        lines.push(['diff-meta', `--- ${input.file_path || ''}`]);
        lines.push(['diff-meta', `+++ ${input.file_path || ''}`]);
        input.old_string.split('\n').forEach(l => lines.push(['diff-del', `-${l}`]));
        String(input.new_string || '').split('\n').forEach(l => lines.push(['diff-add', `+${l}`]));
    } else if (name === 'Write' && typeof input.content === 'string') {
        lines.push(['diff-meta', `+++ ${input.file_path || ''} (new content)`]);
        input.content.split('\n').forEach(l => lines.push(['diff-add', `+${l}`]));
    } else {
        lines.push(['diff-hunk', '@@ input @@']);
        const inputText = (name === 'Bash' && input.command) ? input.command : JSON.stringify(input, null, 2);
        String(inputText || '').split('\n').forEach(l => lines.push(['diff-context', l]));
    }
    lines.push(['diff-hunk', is_error ? '@@ result (error) @@' : '@@ result @@']);
    const resultText = result == null ? '(no result captured for this run)' : result;
    String(resultText).split('\n').forEach(l => lines.push([is_error ? 'diff-del' : 'diff-context', l]));
    return lines.map(([cls, text]) => `<span class="${cls}">${escapeHtml(text) || ' '}</span>`).join('\n');
}

async function openDetail(kind, task, call) {
    const modal = $('detail-modal');
    const body = $('detail-modal-body');
    const request = ++detailRequest;
    $('detail-modal-title').textContent = kind === 'tool' ? call.name : task.description || task.id;
    $('detail-modal-kind').textContent = { diff: 'CODE CHANGES', prompt: 'RUN INSTRUCTIONS & INPUTS', tool: 'TOOL INPUT & RESULT' }[kind];
    body.textContent = 'Loading…';
    modal.showModal();
    const url = kind === 'diff' ? `/artifacts/${encodeURIComponent(task.run_id)}/changes.diff`
        : kind === 'prompt' ? `/api/turns/prompt?run_id=${encodeURIComponent(task.run_id)}`
            : `/api/turns/tool?run_id=${encodeURIComponent(task.run_id)}&tool_use_id=${encodeURIComponent(call.id)}`;
    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (request !== detailRequest || !modal.open) return;
        if (!res.ok) { body.textContent = res.status === 404 ? 'No artifact was captured for this run.' : 'Unable to load this detail. Close and reopen to try again.'; return; }
        if (kind === 'diff') {
            const text = await res.text();
            if (request !== detailRequest || !modal.open) return;
            body.innerHTML = text.trim() ? text.split('\n').map(line => `<span class="${classifyDiffLine(line)}">${escapeHtml(line) || ' '}</span>`).join('\n') : 'No changes captured for this run.';
        } else {
            const detail = await res.json();
            if (request !== detailRequest || !modal.open) return;
            if (kind === 'tool') body.innerHTML = renderToolModalBody(detail);
            else body.textContent = [detail.prompt || '(empty)', ...Object.entries(detail.inputs || {}).map(([name, content]) => `\n── ${name} ──\n${content}`)].join('\n');
        }
    } catch {
        if (request === detailRequest && modal.open) body.textContent = 'Unable to load this detail. Close and reopen to try again.';
    }
}

// Nearest-rank percentiles; only finished runs and known metric values contribute.
function percentile(values, p) {
    return values.length ? values[Math.max(0, Math.ceil(p / 100 * values.length) - 1)] : 0;
}
function metricFormat(value, options) {
    if (options.percent) return percentage(value);
    if (options.currency) return money(value, value > 0 && value < .01 ? 4 : 2);
    return Number.isInteger(value) ? fmtTok(value) : value.toFixed(1);
}
function openDistribution(key) {
    const options = METRICS[key];
    const tasks = finishedTasks();
    const values = tasks.map(t => metricValue(t, key)).filter(Number.isFinite).sort((a, b) => a - b);
    $('percentile-modal-title').textContent = options.label;
    $('percentile-modal').showModal();
    if (!values.length) {
        $('percentile-modal-stats').innerHTML = '';
        $('distribution-chart').innerHTML = '<div class="table-empty">No measured values in this period.</div>';
        $('distribution-note').textContent = key === 'turns_before_first_edit' ? 'Runs that never made an edit are excluded.' : 'Choose a different date range or wait for a run to finish.';
        return;
    }
    $('percentile-modal-stats').innerHTML = [50, 75, 95].map(p => `<div class="distribution-stat">${p === 50 ? 'Median · p50' : `${p}th percentile · p${p}`}<b>${metricFormat(percentile(values, p), options)}</b></div>`).join('');
    const min = values[0], max = values[values.length - 1];
    const bucketCount = Math.min(8, new Set(values).size);
    const step = (max - min) / bucketCount || 1;
    const buckets = Array(bucketCount).fill(0);
    values.forEach(value => buckets[Math.min(bucketCount - 1, Math.floor((value - min) / step))]++);
    const highest = Math.max(...buckets);
    const labels = buckets.map((_, i) => min === max ? metricFormat(min, options) : `${metricFormat(min + i * step, options)}–${metricFormat(Math.min(max, min + (i + 1) * step), options)}`);
    $('distribution-chart').innerHTML = `<div class="histogram" role="img" aria-label="${escapeHtml(labels.map((label, i) => `${label}: ${buckets[i]} runs`).join('; '))}">${buckets.map((count, i) => `<div class="histogram-column" title="${labels[i]}: ${count} runs"><span class="histogram-count">${count}</span><div class="histogram-bar" style="height:${count / highest * 85}%;background:${min + (i + .5) * step >= percentile(values, 95) && bucketCount > 1 ? 'var(--phase-edit)' : min + (i + .5) * step >= percentile(values, 75) && bucketCount > 1 ? 'var(--phase-git)' : 'var(--color-brand-blue)'}"></div></div>`).join('')}</div><div class="histogram-labels" aria-hidden="true">${labels.map(label => `<span>${label}</span>`).join('')}</div>`;
    const approx = key === 'cost_usd' ? tasks.filter(t => t.cost_approx && Number.isFinite(t.cost_usd)).length : 0;
    $('distribution-note').textContent = `${values.length} measured runs · ${$('date-range').selectedOptions[0].textContent}. ${key === 'turns_before_first_edit' ? 'Runs that never made an edit are excluded. ' : ''}${approx ? `${approx} costs are estimates that exclude unreported output and reasoning.` : 'Each bar shows the number of runs in that range.'}`;
}

function exportCsv() {
    const tasks = sortedTasks();
    if (!tasks.length) return;
    const columns = ['id', 'run_id', 'description', 'status', 'agent', 'task_type', 'model', 'started_at', 'finished_at', 'num_turns', 'tool_calls_total', ...PHASES.flatMap(p => [`${p}_pct`, `${p}_cost_pct`]), 'turns_before_first_edit', 'cost_usd', 'cost_approx', 'diff_additions', 'diff_deletions'];
    // Spreadsheet apps interpret leading formula characters even in quoted cells.
    const cell = value => {
        let text = String(value ?? '');
        if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [columns.map(cell).join(','), ...tasks.map(task => columns.map(key => cell(metricValue(task, key))).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `turns-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function resetFilters() {
    $('run-search').value = '';
    $('agent-filter').value = 'all';
    $('status-filter').value = 'all';
    page = 1;
    renderTable();
}
function setSort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = ['description', 'agent', 'model', 'task_type', 'status'].includes(key) ? 'asc' : 'desc'; }
    page = 1;
    renderTable();
}
function toggleRow(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderTable();
}
$('turns-tbody').addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action) {
        const task = allTasks().find(t => t.id === action.dataset.task);
        if (!task) return;
        if (action.dataset.action === 'toggle') toggleRow(task.id);
        else if (action.dataset.action === 'tool') {
            const call = task.tool_calls?.[Number(action.dataset.call)];
            if (call) openDetail('tool', task, call);
        } else openDetail(action.dataset.action, task);
        return;
    }
    if (event.target.closest('a, button') || window.getSelection()?.toString()) return;
    const row = event.target.closest('.task-row');
    if (row) toggleRow(row.dataset.task);
});
// Remember which run analysis panels are open across live task refreshes.
$('turns-tbody').addEventListener('toggle', event => {
    const panel = event.target;
    if (panel.dataset.analysisTask) {
        if (panel.open) expandedAnalysis.add(panel.dataset.analysisTask);
        else expandedAnalysis.delete(panel.dataset.analysisTask);
    } else if (panel.dataset.artifactsTask) {
        if (panel.open) expandedArtifacts.add(panel.dataset.artifactsTask);
        else expandedArtifacts.delete(panel.dataset.artifactsTask);
    }
}, true);
document.querySelectorAll('[data-distribution]').forEach(button => button.addEventListener('click', () => openDistribution(button.dataset.distribution)));
document.querySelectorAll('[data-phase-mode]').forEach(button => button.addEventListener('click', () => {
    phaseMode = button.dataset.phaseMode;
    document.querySelectorAll('[data-phase-mode]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
    renderPhases(finishedTasks());
}));
document.querySelectorAll('[data-run-mode]').forEach(button => button.addEventListener('click', () => {
    runMode = button.dataset.runMode;
    document.querySelectorAll('[data-run-mode]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
    renderTable();
}));
document.querySelectorAll('[data-compare]').forEach(button => button.addEventListener('click', () => {
    compareBy = button.dataset.compare;
    document.querySelectorAll('[data-compare]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
    renderComparison(finishedTasks());
}));
document.querySelectorAll('#turns-table th[data-sort] button').forEach(button => button.addEventListener('click', () => setSort(button.closest('th').dataset.sort)));
$('run-sort').innerHTML = SORT_OPTIONS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
$('run-sort').addEventListener('change', event => setSort(event.target.value));
$('sort-direction').addEventListener('click', () => { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; page = 1; renderTable(); });
$('date-range').addEventListener('change', event => { dateRange = event.target.value; page = 1; render(); });
$('run-search').addEventListener('input', () => { page = 1; renderTable(); });
['agent-filter', 'status-filter'].forEach(id => $(id).addEventListener('change', () => { page = 1; renderTable(); }));
$('clear-filters').addEventListener('click', resetFilters);
$('live-filter').addEventListener('click', () => {
    resetFilters();
    $('status-filter').value = 'running';
    renderTable();
    $('run-explorer').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    $('status-filter').focus({ preventScroll: true });
});
['previous-page', 'next-page'].forEach(id => $(id).addEventListener('click', () => {
    page += id === 'next-page' ? 1 : -1;
    renderTable();
    $('run-explorer').scrollIntoView({ block: 'start' });
}));
$('export-csv').addEventListener('click', exportCsv);
function refreshAll() { fetchTaskOverview().finally(fetchTurns); }
$('refresh').addEventListener('click', refreshAll);
$('retry').addEventListener('click', refreshAll);
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(modal => {
    // A click on the backdrop has the dialog as its target; padding clicks do not close it.
    modal.addEventListener('click', event => {
        const rect = modal.getBoundingClientRect();
        if (event.target === modal && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) modal.close();
    });
    modal.addEventListener('close', () => { if (modal.id === 'detail-modal') detailRequest++; if (tableDirty) renderTable(); });
});
document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable="true"]') && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        $('run-search').focus();
    }
});
fetchTaskOverview().finally(() => fetchTurns().then(startLivePolling));
