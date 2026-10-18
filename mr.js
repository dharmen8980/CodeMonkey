let data = { aggregate: {}, tasks: [] };
const mrExpanded = new Set();
const MR_SORT_OPTIONS = [
    ['last_finished_at', 'Last trigger'],
    ['first_started_at', 'First trigger'],
    ['mr_iid', 'MR number'],
    ['trigger_count', 'Triggers'],
    ['total_cost_usd', 'Total cost'],
    ['total_diff_lines', 'Changed lines'],
];
let mrSortKey = 'last_finished_at';
let mrSortDir = 'desc';

async function fetchMr() {
    try {
        const res = await fetch('/api/turns', { credentials: 'same-origin' });
        if (res.status === 401) { location.replace('/login'); return; }
        if (!res.ok) throw new Error('Unable to load merge requests');
        data = await res.json();
        renderMrTable();
        document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch {
        document.getElementById('last-update').textContent = 'Update failed · retrying';
    }
}
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : ''; } catch { return ''; }
}
function sortValue(mr) {
    if (mrSortKey === 'first_started_at' || mrSortKey === 'last_finished_at') {
        const time = Date.parse(mr[mrSortKey] || '');
        return Number.isNaN(time) ? null : time;
    }
    return mr[mrSortKey] ?? null;
}
function sortMrs(mrs) {
    return [...mrs].sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        if (av == null) return bv == null ? 0 : 1;
        if (bv == null) return -1;
        const result = typeof av === 'string' || typeof bv === 'string'
            ? String(av).localeCompare(String(bv), undefined, { numeric: true })
            : av === bv ? 0 : av > bv ? 1 : -1;
        return mrSortDir === 'asc' ? result : -result;
    });
}
function renderAgentFilter(all) {
    const select = document.getElementById('mr-agent');
    const selected = select.value;
    const agents = [...new Set(all.flatMap(m => m.tasks || []).map(t => t.agent).filter(Boolean))].sort();
    select.innerHTML = '<option value="all">All agents</option>' + agents.map(agent => `<option value="${escapeHtml(agent)}">${escapeHtml(agent)}</option>`).join('');
    select.value = agents.includes(selected) ? selected : 'all';
}
function setMrSort(key) {
    if (mrSortKey === key) mrSortDir = mrSortDir === 'asc' ? 'desc' : 'asc';
    else {
        mrSortKey = key;
        mrSortDir = 'desc';
    }
    renderMrTable();
}
function renderMrTable() {
    const focused = document.activeElement?.dataset.mrToggle;
    const all = data.aggregate?.by_mr || [];
    renderAgentFilter(all);
    document.getElementById('mr-count').textContent = all.length;
    document.getElementById('mr-triggers').textContent = all.reduce((s,m) => s + (m.trigger_count || 0), 0).toLocaleString();
    document.getElementById('mr-cost').textContent = '$' + all.reduce((s,m) => s + (m.total_cost_usd || 0), 0).toFixed(2);
    document.getElementById('mr-diff').textContent = all.reduce((s,m) => s + (m.total_diff_lines || 0), 0).toLocaleString();
    const query = document.getElementById('mr-search').value.trim().toLowerCase();
    const agent = document.getElementById('mr-agent').value;
    const status = document.getElementById('mr-status').value;
    const rows = sortMrs(all.filter(m => {
        const tasks = m.tasks || [];
        return tasks.some(t => (agent === 'all' || t.agent === agent) && (status === 'all' || t.status === status))
            && (!query || String(m.mr_iid).includes(query.replace(/^!/, '')) || tasks.some(t => [t.description, t.agent, t.status].some(value => String(value || '').toLowerCase().includes(query))));
    }));
    document.getElementById('mr-results').textContent = `${rows.length} of ${all.length} merge requests`;
    document.getElementById('mr-reset').hidden = !query && agent === 'all' && status === 'all';
    document.getElementById('mr-sort').value = mrSortKey;
    document.getElementById('mr-sort-direction').textContent = mrSortDir === 'desc' ? '↓' : '↑';
    document.getElementById('mr-sort-direction').setAttribute('aria-label', mrSortDir === 'desc' ? 'Sort ascending' : 'Sort descending');
    document.querySelectorAll('#mr-table th[data-sort]').forEach(th => {
        th.setAttribute('aria-sort', th.dataset.sort === mrSortKey ? (mrSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.querySelector('.sort-indicator').textContent = th.dataset.sort === mrSortKey ? (mrSortDir === 'asc' ? '↑' : '↓') : '';
    });
    const tbody = document.getElementById('mr-tbody');
    tbody.innerHTML = rows.length ? rows.map(m => {
        const id = String(m.mr_iid);
        const open = mrExpanded.has(id);
        const url = safeUrl(m.mr_url);
        return `<tr class="task-row" data-mr="${escapeHtml(id)}"><td><button type="button" class="mr-toggle" data-mr-toggle="${escapeHtml(id)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} MR ${escapeHtml(id)}">${open ? '⌄' : '›'} !${escapeHtml(id)}</button>${url ? ` <a href="${url}" target="_blank" rel="noopener" aria-label="Open merge request ${escapeHtml(id)}">↗</a>` : ''}</td><td>${m.trigger_count}</td><td class="cost-text">$${(m.total_cost_usd || 0).toFixed(2)}</td><td>+${m.total_diff_additions} −${m.total_diff_deletions}</td><td class="run-id">${m.first_started_at ? new Date(m.first_started_at).toLocaleString() : '—'}</td><td class="run-id">${m.last_finished_at ? new Date(m.last_finished_at).toLocaleString() : '—'}</td></tr>${open ? `<tr><td colspan="6"><div class="mr-trigger-list">${m.tasks.map(t => `<div class="mr-trigger-item"><span class="run-id">${t.finished_at ? new Date(t.finished_at).toLocaleString() : '—'}</span><span>${escapeHtml(t.description || t.id)}</span><span class="badge ${escapeHtml(t.status)}">${escapeHtml(t.status || '—')}</span><span class="cost-text">${t.cost_usd != null ? '$' + t.cost_usd.toFixed(4) : '—'}</span></div>`).join('')}</div></td></tr>` : ''}`;
    }).join('') : '<tr><td colspan="6" class="empty-state">No merge requests match this view.</td></tr>';
    if (focused) [...tbody.querySelectorAll('[data-mr-toggle]')].find(el => el.dataset.mrToggle === focused)?.focus({ preventScroll: true });
}
document.getElementById('mr-sort').innerHTML = MR_SORT_OPTIONS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
document.getElementById('mr-search').addEventListener('input', renderMrTable);
['mr-agent', 'mr-status'].forEach(id => document.getElementById(id).addEventListener('change', renderMrTable));
document.getElementById('mr-reset').addEventListener('click', () => {
    document.getElementById('mr-search').value = '';
    document.getElementById('mr-agent').value = 'all';
    document.getElementById('mr-status').value = 'all';
    renderMrTable();
});
document.getElementById('mr-sort').addEventListener('change', event => setMrSort(event.target.value));
document.getElementById('mr-sort-direction').addEventListener('click', () => {
    mrSortDir = mrSortDir === 'asc' ? 'desc' : 'asc';
    renderMrTable();
});
document.querySelectorAll('#mr-table th[data-sort] button').forEach(button => button.addEventListener('click', () => setMrSort(button.closest('th').dataset.sort)));
document.getElementById('mr-tbody').addEventListener('click', event => {
    if (event.target.closest('a') || window.getSelection()?.toString()) return;
    const row = event.target.closest('[data-mr]');
    if (!row) return;
    const id = row.dataset.mr;
    if (mrExpanded.has(id)) mrExpanded.delete(id); else mrExpanded.add(id);
    renderMrTable();
});
fetchMr();
setInterval(() => { if (!document.hidden) fetchMr(); }, 15000);
