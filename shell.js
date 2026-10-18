// Shared navigation and sign-out. Page scripts only own their page's data and actions.
(function () {
    'use strict';
    const host = document.querySelector('[data-workspace-nav]');
    if (!host) return;
    const current = document.body.dataset.page;
    const pages = [
        ['turns', '/turns', 'Dashboard', 'turns'], ['chat', '/chat', 'Chat', 'chat'],
        ['pipeline', '/pipeline', 'Pipeline', 'pipeline'],
        ['triage', '/triage', 'Triage', 'triage'], ['mr', '/mr', 'Merge requests', 'branch'],
    ];
    const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
    host.innerHTML = `<svg class="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol>
            <symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/></symbol>
            <symbol id="i-turns" viewBox="0 0 24 24"><path d="M4 17V7m5 13V4m5 12V8m5 11V5"/></symbol>
            <symbol id="i-pipeline" viewBox="0 0 24 24"><rect x="2" y="8" width="5" height="8" rx="1.5"/><rect x="17" y="8" width="5" height="8" rx="1.5"/><path d="M7 12h10m-6-4 4 4-4 4"/></symbol>
            <symbol id="i-triage" viewBox="0 0 24 24"><path d="M4 5h16M7 12h10M10 19h4"/><circle cx="8" cy="5" r="2"/><circle cx="15" cy="12" r="2"/></symbol>
            <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2a7 7 0 0 1-7 7H6"/></symbol>
            <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol>
            <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
            <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></symbol>
            <symbol id="i-code" viewBox="0 0 24 24"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/></symbol>
            <symbol id="i-dollar" viewBox="0 0 24 24"><path d="M12 2v20m5-16H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></symbol>
            <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></symbol>
            <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></symbol>
            <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></symbol>
            <symbol id="i-exit" viewBox="0 0 24 24"><path d="M9 4H4v16h5m5-13 5 5-5 5M9 12h12"/></symbol>
            <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></symbol>
        </svg>` + `
        <a class="workspace-brand" href="/turns" aria-label="Code-Monkey home"><span class="brand-mark">${icon('code')}</span><span><span class="brand-name">Code Monkey</span></a>
        <div class="nav-caption">AGENT WORKSPACE</div>
        <nav class="workspace-nav" aria-label="Main navigation">${pages.map(([key, href, label, glyph]) => `<a href="${href}" ${key === current ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${key === current ? '<span class="nav-active-dot"></span>' : ''}</a>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="workspace-label"><span class="workspace-avatar">CM</span><span>Code-Monkey<small>Engineering workspace</small></span></div><button id="signout" type="button">${icon('exit')}Sign out</button></div>`;
    const topbar = document.querySelector('.workspace-topbar');
    if (topbar) {
        const actions = document.createElement('div');
        actions.className = 'topbar-actions';
        const status = topbar.querySelector('.status-bar, .sync-status, .chat-topbar-note');
        if (status) actions.append(status);
        actions.insertAdjacentHTML('beforeend', `<label class="theme-picker">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/></svg>
            <span class="sr-only">Color theme</span>
            <select data-theme-select><option value="light">Light</option><option value="dark">Dark</option><option value="system" selected>System</option></select>
        </label>`);
        topbar.append(actions);
    }
    document.getElementById('signout').addEventListener('click', () => {
        fetch('/logout', { method: 'POST', credentials: 'same-origin' })
            .then(() => location.replace('/login'), () => location.replace('/login'));
    });
})();
