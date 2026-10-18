// Run with: node scripts/verify-theme.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../theme.js'), 'utf8');

function boot(saved, dark = false, blocked = false, legacyMediaQuery = false) {
    const events = {};
    const controls = [];
    const root = { dataset: {} };
    const meta = { 'color-scheme': {}, 'theme-color': {} };
    const media = legacyMediaQuery
        ? { matches: dark, addListener(fn) { events.os = fn; } }
        : { matches: dark, addEventListener(name, fn) { events.os = fn; } };
    const storage = {
        getItem() { if (blocked) throw new Error('Storage disabled'); return saved; },
        setItem(key, value) { if (blocked) throw new Error('Storage disabled'); saved = value; },
    };
    vm.runInNewContext(source, {
        localStorage: storage,
        window: { matchMedia() { return media; }, addEventListener(name, fn) { events[name] = fn; } },
        document: {
            documentElement: root,
            querySelector(selector) { return meta[selector.includes('color-scheme') ? 'color-scheme' : 'theme-color']; },
            querySelectorAll() { return controls; },
            addEventListener(name, fn) { events[name] = fn; },
        },
    });
    // The resolved theme is already set before any body or control exists.
    function expect(theme) {
        assert.equal(root.dataset.theme, theme);
        assert.equal(meta['color-scheme'].content, theme);
        assert.equal(meta['theme-color'].content, theme === 'dark' ? '#082e43' : '#0081bc');
    }
    controls.push({ value: '' });
    events.DOMContentLoaded();
    return {
        expect, control: controls[0], saved: () => saved,
        choose(value) { events.change({ target: { value, matches: () => true } }); },
        os(value) { media.matches = value; events.os(); },
        sync(value, key = 'codemonkey-theme') { events.storage({ key, newValue: value, storageArea: storage }); },
        unrelatedChange() { events.change({ target: { value: 'dark', matches: () => false } }); },
    };
}
for (const osDark of [false, true]) {
    for (const saved of [null, 'invalid', 'system', 'light', 'dark']) {
        const app = boot(saved, osDark);
        const preference = ['light', 'dark'].includes(saved) ? saved : 'system';
        app.expect(preference === 'system' ? (osDark ? 'dark' : 'light') : preference);
        assert.equal(app.control.value, preference);
    }
}
const app = boot(null);
app.choose('dark'); app.expect('dark'); assert.equal(app.saved(), 'dark');
app.os(false); app.expect('dark');
app.choose('light'); app.os(true); app.expect('light');
app.choose('system'); app.expect('dark'); app.os(false); app.expect('light');
app.unrelatedChange(); app.expect('light');
app.sync('dark', 'unrelated-key'); app.expect('light');
app.sync('dark'); app.expect('dark'); assert.equal(app.control.value, 'dark');
app.sync(null); app.expect('light'); assert.equal(app.control.value, 'system');
app.sync('dark'); app.sync(null, null); app.expect('light'); // localStorage.clear()
const unavailable = boot('light', true, true);
unavailable.expect('dark'); unavailable.choose('light'); unavailable.expect('light');
unavailable.choose('system'); unavailable.os(false); unavailable.expect('light');
const legacy = boot('system', false, false, true);
legacy.expect('light'); legacy.os(true); legacy.expect('dark');
console.log('Theme: early initialization, preferences, OS changes, cross-tab updates, and unavailable storage passed.');

// Guard contrast of shared dark surfaces, text, functional states, and chart marks.
const css = fs.readFileSync(path.join(__dirname, '../brand.css'), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map(match => [match[1], match[2]]));
assert.notEqual(tokens['color-text'], '#ffffff', 'Dark body text should use the softer gray foreground');
assert.notEqual(tokens['color-heading'], '#ffffff', 'Dark headings should use the softer gray foreground');
function luminance(hex) {
    const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels.reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
}
function contrast(foreground, background, minimum) {
    const values = [foreground, background].map(key => luminance(tokens[key])).sort((a, b) => a - b);
    assert.ok((values[1] + .05) / (values[0] + .05) >= minimum, `${foreground} on ${background}: contrast below ${minimum}`);
}
for (const bg of ['color-background', 'color-surface', 'color-blue-tint', 'color-orange-tint']) {
    for (const fg of ['color-text', 'color-heading', 'color-muted', 'color-secondary', 'color-blue-dark']) contrast(fg, bg, 4.5);
    contrast('color-control-border', bg, 3);
}
for (const state of ['success', 'error', 'warning']) contrast(`color-${state}`, `color-${state}-bg`, 4.5);
for (const phase of ['brand-blue', 'edit', 'build', 'git', 'other']) contrast(phase === 'brand-blue' ? 'color-brand-blue' : `phase-${phase}`, 'color-surface', 3);
contrast('color-nav-active-text', 'color-nav-active-bg', 4.5);
contrast('color-black', 'color-brand-orange', 4.5);
console.log('Dark palette: text ≥4.5:1; form borders and chart marks ≥3:1.');
