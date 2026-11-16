// CDP scenarios for the Console layer (batch 7, dish console-skin). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeConsoleScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
// It never schedules anything itself: every wait goes through t.sleep / t.waitFor.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario console-off-zero-cost,console-on-skin,console-toggle-leaves-skin,console-scanlines,console-reduced-motion,console-reload-persists,console-focus-visible   (needs --preload=fake)
//
//   console-off-zero-cost       a default profile (no consoleLayer saved) boots with: no #hq-console-css link, __hqLayerProbe() all zeros, no [data-hq-console]
//                               node, an EMPTY data-hq-skin on the root, Settings > 'Console layer' reading Off and no 'Console' chip
//   console-on-skin             switch on in Settings, choose the Console chip: the link is present, data-hq-skin=console, the computed tokens are the
//                               sheet's own (--bg and the four accents resolve), the probe shows exactly what is registered; switch off: probe zeros, link
//                               gone, skin empty, WITHOUT a reload (a marker on window survives)
//   console-toggle-leaves-skin  in Console, the shell Light/dark button clears the skin and flips the base theme; so does the palette's 'Toggle light / dark'
//   console-scanlines           the 'CRT scanlines' switch exists only under the skin; the overlay is fixed with pointer-events none and a click target
//                               beneath it is still the button; switching it off removes the <html> attribute
//   console-reduced-motion      with Reduce motion on, and again with the OS preference emulated, the skin adds no running animation to the same page without it (the app's own loops are the baseline) and owns no CSS animation
//   console-reload-persists     layer + skin survive a reload; layer off survives a reload with zero cost again
//   console-focus-visible       Tab to a button under the skin: the :focus-visible outline is wider than 0 and sits inside the box, next to a polygon clip-path
// Each scenario puts back the prefs it touched (consoleLayer, themePref, reduceMotion, the emulated media) and ends with hqFake.reset(true).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens, normalizeSelector } from '../styles/tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;
const PREFS_KEY = 'whq3-prefs';
const ROOT = `document.querySelector('[data-hq-theme]')`;
const DLG = `document.querySelector('[role="dialog"][aria-label="Settings"]')`;
export const ACCENTS = Object.freeze(['--gold', '--purple', '--orange', '--green']);
export const LAYER_OFF = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false, look: '' });

/** The sheet's own token values, read from styles/console.css (one source of truth for the expected computed colours). */
export function sheetTokens() {
  const css = readFileSync(resolve(HERE, '../styles/console.css'), 'utf8');
  return parseTokens(css).rules[normalizeSelector('[data-hq-skin="console"]')] || {};
}

const q = JSON.stringify;
export const PAGE = Object.freeze({
  ready: READY,
  root: ROOT,
  probe: `JSON.stringify(window.__hqLayerProbe ? window.__hqLayerProbe() : null)`,
  links: `document.querySelectorAll('link#hq-console-css').length`,
  nodes: `document.querySelectorAll('[data-hq-console]').length`,
  skinAttr: `(() => { const r = ${ROOT}; return r ? r.getAttribute('data-hq-skin') : undefined; })()`,
  scanAttr: `document.documentElement.getAttribute('data-hq-scan')`,
  sheetLoaded: `(() => { const l = document.getElementById('hq-console-css'); try { return !!(l && l.sheet && l.sheet.cssRules.length > 0); } catch (e) { return false; } })()`,
  cssVar: (name) => `getComputedStyle(${ROOT}).getPropertyValue(${q(name)}).trim().toLowerCase()`,
  layer: `JSON.stringify(WHQ.app.logic.state.consoleLayer || null)`,
  setLayer: (o) => `(() => { WHQ.app.logic.setState({ consoleLayer: ${q(o)} }); return true; })()`,
  mark: `(() => { window.__cslMark = 'alive'; return true; })()`,
  marked: `window.__cslMark === 'alive'`,
  snapshot: `JSON.stringify({ themePref: WHQ.app.logic.state.themePref, reduceMotion: !!WHQ.app.logic.state.reduceMotion })`,
  restore: (s) => `(() => { WHQ.app.logic.setState({ consoleLayer: ${q(LAYER_OFF)}, themePref: ${q(s.themePref)}, reduceMotion: ${q(!!s.reduceMotion)}, settingsOpen: false, paletteOpen: false, toasts: [] }); return true; })()`,
  prefs: `(() => { try { return JSON.parse(localStorage.getItem(${q(PREFS_KEY)}) || '{}') || {}; } catch (e) { return {}; } })()`,
  dropLayerPref: `(() => { try { const p = JSON.parse(localStorage.getItem(${q(PREFS_KEY)}) || '{}') || {}; delete p.consoleLayer; localStorage.setItem(${q(PREFS_KEY)}, JSON.stringify(p)); } catch (e) {} return true; })()`,
  openSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  closeSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: false }); return true; })()`,
  chips: `(() => { const d = ${DLG}; return d ? JSON.stringify([...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((x) => ['Dark', 'Light', 'Follow system', 'Console'].includes(x))) : null; })()`,
  clickChip: (label) => `(() => { const d = ${DLG}; const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === ${q(label)}); if (!b) return false; b.click(); return true; })()`,
  switchRow: (label) => `(() => { const d = ${DLG}; const b = d && [...d.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && x.parentElement.textContent.trim().startsWith(${q(label)})); return !!b; })()`,
  switchText: (label) => `(() => { const d = ${DLG}; const b = d && [...d.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && x.parentElement.textContent.trim().startsWith(${q(label)})); return b ? b.textContent.trim() : null; })()`,
  switchLine: (label) => `(() => { const d = ${DLG}; const b = d && [...d.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && x.parentElement.textContent.trim().startsWith(${q(label)})); return b ? b.parentElement.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  clickSwitch: (label) => `(() => { const d = ${DLG}; const b = d && [...d.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && x.parentElement.textContent.trim().startsWith(${q(label)})); if (!b) return false; b.click(); return true; })()`,
  themeButton: `document.querySelector('button[title="Light / dark"]')`,
  clickThemeButton: `(() => { const b = document.querySelector('button[title="Light / dark"]'); if (!b) return false; b.click(); return true; })()`,
  paletteToggle: `(() => { const L = WHQ.app.logic; const it = L.paletteItems().flat.find((x) => x.label === 'Toggle light / dark'); if (!it) return false; it.run(); return true; })()`,
  state: `JSON.stringify({ themePref: WHQ.app.logic.state.themePref, themeName: WHQ.app.logic.themeName(), skin: !!(WHQ.app.logic.state.consoleLayer && WHQ.app.logic.state.consoleLayer.skin) })`,
  setTheme: (p) => `(() => { WHQ.app.logic.setState({ themePref: ${q(p)}, paletteOpen: false }); return true; })()`,
  overlay: `(() => { const r = ${ROOT}; if (!r) return null; const cs = getComputedStyle(r, '::after'); return JSON.stringify({ content: cs.content, position: cs.position, pointerEvents: cs.pointerEvents }); })()`,
  hitTest: `(() => { const b = document.querySelector('button[title="Light / dark"]'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(el && el.closest('button') === b); })()`,
  // Every running animation as a signature (kind, name or property, target, iterations), after the finite ones are finished: the hidden test window does not advance the
  // animation clock, so a 120 ms colour transition the app's own buttons start when a token changes would otherwise read as running forever. What is left is what loops.
  animations: `(() => { const sig = (a) => { const e = a.effect, t = e && e.target, n = e && e.getTiming ? e.getTiming().iterations : 1; return [a.constructor && a.constructor.name, a.animationName || a.transitionProperty || '?', t ? t.tagName + '.' + String(t.className).slice(0, 24) : '', n === Infinity ? 'loop' : 'finite'].join(':'); }; document.getAnimations().forEach((a) => { try { const n = a.effect.getTiming().iterations; if (Number.isFinite(n)) a.finish(); } catch (e) {} }); return JSON.stringify([...new Set(document.getAnimations().filter((a) => a.playState === 'running').map(sig))].sort()); })()`,
  setReduce: (on) => `(() => { WHQ.app.logic.setState({ reduceMotion: ${q(!!on)} }); return true; })()`,
  blurAll: `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`,
  focused: `(() => { const a = document.activeElement; if (!a || a === document.body) return null; return JSON.stringify({ tag: a.tagName, visible: a.matches(':focus-visible'), inRoot: !!(${ROOT} && ${ROOT}.contains(a)) }); })()`,
  focusLook: `(() => { const a = document.activeElement; if (!a) return null; const cs = getComputedStyle(a); return JSON.stringify({ width: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle, offset: parseFloat(cs.outlineOffset) || 0, clip: cs.clipPath }); })()`,
  reset: `(() => { hqFake.reset(true); WHQ.app.logic.setState({ consoleLayer: ${q(LAYER_OFF)}, settingsOpen: false, paletteOpen: false, toasts: [] }); return true; })()`,
});

const TAB_DOWN = { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
const TAB_UP = { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
export const SCENARIO_NAMES = Object.freeze(['console-off-zero-cost', 'console-on-skin', 'console-toggle-leaves-skin', 'console-scanlines', 'console-reduced-motion', 'console-reload-persists', 'console-focus-visible']);

export function makeConsoleScenarios({ fresh, sleep }) {
  const pause = (t, ms) => (t && typeof t.sleep === 'function' ? t.sleep(ms) : sleep(ms));
  const json = async (t, expr) => { const v = await t.evaluate(expr); try { return v === null || v === undefined ? v : JSON.parse(v); } catch (e) { return v; } };
  const snapshotOf = async (t) => (await json(t, PAGE.snapshot)) || { themePref: 'dark', reduceMotion: false };
  const leave = async (t, snap) => {
    await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await t.evaluate(PAGE.restore(snap || { themePref: 'dark', reduceMotion: false })).catch(() => {});
    await t.evaluate(PAGE.reset).catch(() => {});
  };
  const reload = async (t) => { await t.reload(); const ok = await t.waitFor(READY + ` && !!window.hqFake && hqFake.calls('liveState').length > 0`, 15000); if (ok) await pause(t, 300); return ok; };
  const zero = async (t, out, where) => {
    const p = await json(t, PAGE.probe);
    if (!p || p.links !== 0 || p.listeners !== 0 || p.timers !== 0 || p.frames !== 0) out.push(where + ': the probe is not all zeros: ' + JSON.stringify(p));
    if ((await t.evaluate(PAGE.links)) !== 0) out.push(where + ': a #hq-console-css link is in the page');
    if ((await t.evaluate(PAGE.nodes)) !== 0) out.push(where + ': a node carries data-hq-console');
    if ((await t.evaluate(PAGE.skinAttr)) !== '') out.push(where + ': the root data-hq-skin is ' + JSON.stringify(await t.evaluate(PAGE.skinAttr)) + ', want an empty attribute');
    if ((await t.evaluate(PAGE.scanAttr)) !== null) out.push(where + ': <html data-hq-scan> is set while the layer is off');
  };
  const skinOn = async (t, out, where) => {
    if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.sheetLoaded} && ${PAGE.skinAttr} === 'console'`, 6000)) { out.push(where + ': the skin never showed (link ' + await t.evaluate(PAGE.links) + ', attr ' + JSON.stringify(await t.evaluate(PAGE.skinAttr)) + ')'); return false; }
    return true;
  };
  const tokens = sheetTokens();

  return {
    async 'console-off-zero-cost'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.restore(snap));
        await pause(t, 200);
        await t.evaluate(PAGE.dropLayerPref);
        if (!await reload(t)) return out.concat('the app never came back after the reload');
        await zero(t, out, 'default boot');
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${DLG}`, 4000)) return out.concat('Settings never opened');
        if ((await t.evaluate(PAGE.switchText('Console layer'))) !== 'Off') out.push("Settings > 'Console layer' does not read Off: " + JSON.stringify(await t.evaluate(PAGE.switchText('Console layer'))));
        if (!String(await t.evaluate(PAGE.switchLine('Console layer'))).includes('Opt-in look and a few extras. Off = nothing loads.')) out.push('the Console layer row lacks its line');
        const chips = await json(t, PAGE.chips);
        if (!chips || chips.includes('Console')) out.push('the Appearance chips show Console while the layer is off: ' + JSON.stringify(chips));
        if (await t.evaluate(PAGE.switchRow('CRT scanlines'))) out.push('the CRT scanlines switch shows while the layer is off');
        await zero(t, out, 'Settings open');
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },

    async 'console-on-skin'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.restore(snap));
        await t.evaluate(PAGE.mark);
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${DLG}`, 4000)) return out.concat('Settings never opened');
        await t.evaluate(PAGE.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.switchText('Console layer')} === 'On'`, 4000)) return out.concat('the Console layer switch never read On');
        if (!await t.waitFor(`${PAGE.links} === 1`, 4000)) out.push('switching the layer on did not add the stylesheet link');
        if ((await t.evaluate(PAGE.skinAttr)) !== '') out.push('the layer is on but the skin is not chosen, and the root data-hq-skin is ' + JSON.stringify(await t.evaluate(PAGE.skinAttr)));
        const chips = await json(t, PAGE.chips);
        if (!chips || !chips.includes('Console')) return out.concat('no Console chip while the layer is on: ' + JSON.stringify(chips));
        await t.evaluate(PAGE.clickChip('Console'));
        if (!await skinOn(t, out, 'Console chip')) return out;
        for (const k of ['--bg', ...ACCENTS]) {
          const got = await t.evaluate(PAGE.cssVar(k));
          if (got !== String(tokens[k] || '').toLowerCase()) out.push(k + ' resolves to ' + JSON.stringify(got) + ', the sheet says ' + JSON.stringify(tokens[k]));
        }
        const p = await json(t, PAGE.probe);
        if (!p || p.links !== 2 || p.listeners !== 0 || p.timers !== 0 || p.frames !== 0) out.push('the probe shows ' + JSON.stringify(p) + ', want exactly the layer\'s registrations (two links, the layer sheet and the small delights sheet, and in this build nothing else)');
        await t.evaluate(PAGE.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.skinAttr} === ''`, 4000)) out.push('switching the layer off did not remove the link and empty the skin');
        await zero(t, out, 'after switching off');
        if (!await t.evaluate(PAGE.marked)) out.push('the page was reloaded by switching off (the marker is gone)');
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },

    async 'console-toggle-leaves-skin'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.setTheme('dark'));
        await t.evaluate(PAGE.setLayer({ on: true, skin: true, scan: false, palette: '', debug: false, shelf: false }));
        if (!await skinOn(t, out, 'console on')) return out;
        const before = await json(t, PAGE.state);
        if (!before.skin || before.themeName !== 'dark') out.push('the start is not Console over a dark base: ' + JSON.stringify(before));
        if (!await t.evaluate(PAGE.clickThemeButton)) return out.concat('the shell Light / dark button is missing');
        if (!await t.waitFor(`${PAGE.skinAttr} === ''`, 4000)) out.push('the shell toggle did not leave Console');
        let after = await json(t, PAGE.state);
        if (after.skin || after.themePref !== 'light' || after.themeName !== 'light') out.push('after the shell toggle: ' + JSON.stringify(after) + ', want the skin cleared and the opposite of the dark base');
        await t.evaluate(PAGE.setTheme('dark'));
        await t.evaluate(PAGE.setLayer({ on: true, skin: true, scan: false, palette: '', debug: false, shelf: false }));
        if (!await skinOn(t, out, 'console on again')) return out;
        if (!await t.evaluate(PAGE.paletteToggle)) return out.concat("the palette has no 'Toggle light / dark' command");
        if (!await t.waitFor(`${PAGE.skinAttr} === ''`, 4000)) out.push("the palette's Toggle light / dark did not leave Console");
        after = await json(t, PAGE.state);
        if (after.skin || after.themePref !== 'light') out.push('after the palette command: ' + JSON.stringify(after));
        if (!['dark', 'light'].includes(after.themeName)) out.push('themeName() answered ' + JSON.stringify(after.themeName));
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },

    async 'console-scanlines'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.setLayer({ on: true, skin: false, scan: false, palette: '', debug: false, shelf: false }));
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${DLG}`, 4000)) return out.concat('Settings never opened');
        if (await t.evaluate(PAGE.switchRow('CRT scanlines'))) out.push('the CRT scanlines switch shows before the skin is chosen');
        await t.evaluate(PAGE.clickChip('Console'));
        if (!await t.waitFor(`!!${PAGE.switchRow('CRT scanlines')}`, 4000)) return out.concat('the CRT scanlines switch never appeared under the skin');
        if ((await t.evaluate(PAGE.switchText('CRT scanlines'))) !== 'Off') out.push('CRT scanlines does not start Off');
        await t.evaluate(PAGE.clickSwitch('CRT scanlines'));
        if (!await t.waitFor(`${PAGE.scanAttr} === 'on'`, 4000)) return out.concat('the scanline switch did not set <html data-hq-scan>');
        await t.evaluate(PAGE.closeSettings);
        await pause(t, 120);
        const o = await json(t, PAGE.overlay);
        if (!o || o.position !== 'fixed' || o.pointerEvents !== 'none' || o.content === 'none') out.push('the scanline overlay is not a fixed, click-through pseudo-element: ' + JSON.stringify(o));
        if ((await t.evaluate(PAGE.hitTest)) !== true) out.push('a click aimed at the Light / dark button does not land on the button (the overlay is in the way)');
        await t.evaluate(PAGE.openSettings);
        await t.waitFor(`!!${DLG}`, 4000);
        await t.evaluate(PAGE.clickSwitch('CRT scanlines'));
        if (!await t.waitFor(`${PAGE.scanAttr} === null`, 4000)) out.push('switching scanlines off left <html data-hq-scan> set');
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },

    // The app's own Reduce motion pref and the OS media query leave some of the app's animations running (a looping shimmer, its own colour transitions), so "no animation" is measured
    // against the SAME page with the layer off: whatever loops under the skin must already loop without it, and the skin must own no CSS animation at all (console.css has no @keyframes).
    async 'console-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      const compare = async (what) => {
        await t.evaluate(PAGE.setLayer(LAYER_OFF));
        await pause(t, 500);
        const base = (await json(t, PAGE.animations)) || [];
        await t.evaluate(PAGE.setLayer({ on: true, skin: true, scan: true, palette: '', debug: false, shelf: false }));
        if (!await skinOn(t, out, what + ': console on')) return;
        await pause(t, 500);
        const now = (await json(t, PAGE.animations)) || [];
        const extra = now.filter((x) => !base.includes(x));
        if (extra.length) out.push(what + ': the page under the skin runs animations the same page without it does not: ' + JSON.stringify(extra));
        const own = now.filter((x) => x.startsWith('CSSAnimation:'));
        if (own.length) out.push(what + ': a CSS animation runs under the skin (console.css has no @keyframes): ' + JSON.stringify(own));
      };
      try {
        await t.evaluate(PAGE.setReduce(true));
        await compare('Reduce motion on');
        await t.evaluate(PAGE.setReduce(false));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await compare('the OS asks for reduced motion');
        out.push(...t.errors());
      } finally { await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {}); await leave(t, snap); }
      return out;
    },

    async 'console-reload-persists'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.setLayer({ on: true, skin: true, scan: false, palette: '', debug: false, shelf: false }));
        if (!await skinOn(t, out, 'before the reload')) return out;
        if (!await t.waitFor(`(() => { const p = ${PAGE.prefs}; return !!(p.consoleLayer && p.consoleLayer.on === true && p.consoleLayer.skin === true); })()`, 4000)) return out.concat('the layer was not saved to the prefs');
        if (!await reload(t)) return out.concat('the app never came back after the reload');
        await skinOn(t, out, 'after the reload');
        const p = await json(t, PAGE.probe);
        if (!p || p.links !== 2) out.push('after the reload the probe shows ' + JSON.stringify(p) + ', want the layer attached');
        await t.evaluate(PAGE.setLayer(LAYER_OFF));
        if (!await t.waitFor(`(() => { const p = ${PAGE.prefs}; return !!(p.consoleLayer && p.consoleLayer.on === false); })()`, 4000)) return out.concat('the off state was not saved to the prefs');
        if (!await reload(t)) return out.concat('the app never came back after the second reload');
        await zero(t, out, 'off, after a reload');
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },

    async 'console-focus-visible'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(PAGE.setLayer({ on: true, skin: true, scan: false, palette: '', debug: false, shelf: false }));
        if (!await skinOn(t, out, 'console on')) return out;
        await t.evaluate(PAGE.blurAll);
        let found = null;
        for (let i = 0; i < 14 && !found; i++) {
          await t.send('Input.dispatchKeyEvent', TAB_DOWN);
          await t.send('Input.dispatchKeyEvent', TAB_UP);
          const f = await json(t, PAGE.focused);
          if (f && f.tag === 'BUTTON' && f.inRoot) found = f;
        }
        if (!found) return out.concat('Tab never reached a button under the skin');
        if (!found.visible) out.push('the focused button does not match :focus-visible after a keyboard Tab');
        const look = await json(t, PAGE.focusLook);
        if (!look || !(look.width > 0) || look.style === 'none') out.push('the focus outline is not drawn: ' + JSON.stringify(look));
        if (look && !(look.offset < 0)) out.push('the focus outline sits outside the box (offset ' + look.offset + '), where the chamfer can hide it');
        if (look && !/^polygon\(/.test(String(look.clip))) out.push('the focused button carries no polygon clip-path: this check proves nothing: ' + JSON.stringify(look.clip));
        out.push(...t.errors());
      } finally { await leave(t, snap); }
      return out;
    },
  };
}
