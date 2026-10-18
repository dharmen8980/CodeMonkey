// Runs before styles and page content so the first paint uses the saved theme.
(function () {
    'use strict';
    const storageKey = 'codemonkey-theme';
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const normalize = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
    let preference = 'system';
    let storage = null;
    try {
        storage = localStorage;
        preference = normalize(storage.getItem(storageKey));
    } catch (_) { /* Storage can be unavailable. */ }

    function apply() {
        const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
        document.documentElement.dataset.theme = theme;
        const colorScheme = document.querySelector('meta[name="color-scheme"]');
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (colorScheme) colorScheme.content = theme;
        if (themeColor) themeColor.content = theme === 'dark' ? '#082e43' : '#0081bc';
        document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = preference; });
    }
    apply();
    document.addEventListener('DOMContentLoaded', apply);
    document.addEventListener('change', event => {
        if (!event.target.matches('[data-theme-select]')) return;
        preference = normalize(event.target.value);
        try { if (storage) storage.setItem(storageKey, preference); } catch (_) { /* Still apply for this page. */ }
        apply();
    });
    const followSystem = () => { if (preference === 'system') apply(); };
    if (system.addEventListener) system.addEventListener('change', followSystem);
    else if (system.addListener) system.addListener(followSystem);
    window.addEventListener('storage', event => {
        if (event.key !== storageKey && event.key !== null) return;
        if (!storage || event.storageArea !== storage) return;
        preference = normalize(event.newValue);
        apply();
    });
})();
