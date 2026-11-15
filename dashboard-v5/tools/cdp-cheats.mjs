// CDP scenarios for the cheat codes (batch 7, dish cheat-codes). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeCheatsScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario cheats-legacy-still-work,cheats-typing-guard,cheats-unlock-chain,cheats-off-zero-cost,cheats-debug-overlay,cheats-reduced-motion,cheats-found-persist   (needs --preload=fake)
//
// Keys go through the browser's own input pipeline (Input.dispatchKeyEvent), so a code is typed exactly like the owner types it: into the page,
// or into a focused field. Every scenario puts back what it touched (the layer pref, the found list, the prefs key, Bit, the emulated media,
// the open overlays) and ends with hqFake.reset(true).
//
//   cheats-legacy-still-work  layer OFF: typing bit makes Bit say "you found me" and throw hearts; dance and ArrowUp twice make Bit cheer
//                             ("♪ ♫ ♪"); no toast, the layer stays off, nothing else changes; both are in the found list by id
//   cheats-typing-guard       with the Ask field focused every code is typed: nothing fires (no toast, no layer change, no Bit line, nothing
//                             found), and a half-typed code is lost when a field is touched in between; after blur the same keys fire
//   cheats-unlock-chain       cartridge turns the layer on (toast), plastic switches to Console, ember then tide change the accent (data-hq-accent
//                             and the --accent-text colour), a second ember clears it (and the palettes link goes), timing opens the overlay;
//                             every step has its toast and is in the Memory card list by NAME
//   cheats-off-zero-cost      layer off, no code typed: __hqLayerProbe() zeros, no palettes link, no [data-hq-console] node, no render wrapper;
//                             window keydown listeners = EXPECT_KEYDOWN (a counting wrapper is installed before the app's code runs), and the
//                             same number after the layer is switched on and off
//   cheats-debug-overlay      timing shows a nonzero last-render value after an interaction; closing it removes the node, the render wrapper
//                             and the ring
//   cheats-reduced-motion     with reduceMotion AND the media query, codes still apply, Bit's cheer is the short non-animated form (no hearts)
//                             and the overlay has no transition and no animation
//   cheats-found-persist      found ids survive a reload and show as names only
//
// The keydown count is a DELTA, not a promise about zero: today two listeners sit on window (app.js _onKey and the old hq-fx one); after the move
// there are two again (app.js and the cheats host). EXPECT_KEYDOWN says so in one place.

export const EXPECT_KEYDOWN = 2;
export const PREFS_KEY = 'whq3-prefs';
export const LAYER_DEFAULT = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
export const ALL_CODES = Object.freeze(['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance']);
export const FOUND_NAMES = Object.freeze({ cartridge: 'Power on', plastic: 'Chunky skin', ember: 'Warm accent', tide: 'Cool accent', timing: 'Stopwatch', bit: 'Hide and seek', dance: 'Little jig' });

// installed with Page.addScriptToEvaluateOnNewDocument BEFORE a reload, so it wraps window.addEventListener before any app code runs
export const KD_HOOK = `(() => {
  if (window.__hqKd) return;
  const adds = []; window.__hqKd = adds;
  const add = window.addEventListener, rem = window.removeEventListener;
  const cap = (o) => !!(o && (o === true || o.capture));
  window.addEventListener = function (type, fn, opts) {
    if (type === 'keydown' && (this === window || this == null)) { const c = cap(opts); if (!adds.some((a) => a.fn === fn && a.c === c)) adds.push({ fn, c }); }
    return add.apply(this, arguments);
  };
  window.removeEventListener = function (type, fn, opts) {
    if (type === 'keydown' && (this === window || this == null)) { const c = cap(opts); const i = adds.findIndex((a) => a.fn === fn && a.c === c); if (i >= 0) adds.splice(i, 1); }
    return rem.apply(this, arguments);
  };
  window.__hqKeydownCount = () => adds.length;
})();`;

const ROOT = `document.querySelector('[data-hq-theme]')`;
const OVERLAY = `document.querySelector('aside[aria-label="Frame timing"]')`;
const FOUND = `document.querySelector('[data-hq-console="found"]')`;
const BIT_LAYER = `[...document.body.children].find((n) => /z-index:\\s*2000/.test(n.getAttribute('style') || ''))`;
const DEFAULTS = JSON.stringify(LAYER_DEFAULT);

export const PAGE = Object.freeze({
  layer: `(() => JSON.stringify(WHQ.app.logic.state.consoleLayer || null))()`,
  found: `(() => JSON.stringify(WHQ.app.logic.state.cheatsFound || []))()`,
  setLayer: (patch) => `(() => { const L = WHQ.app.logic; L.setState({ consoleLayer: Object.assign({}, ${DEFAULTS}, ${JSON.stringify(patch || {})}) }); return true; })()`,
  setState: (patch) => `(() => { WHQ.app.logic.setState(${JSON.stringify(patch)}); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L.setState({ consoleLayer: Object.assign({}, ${DEFAULTS}), cheatsFound: [], settingsOpen: false, askOpen: false, paletteOpen: false, moreOpen: false, toasts: [], notifLog: [] }); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`,
  lastToast: `(() => { const n = WHQ.app.logic.state.notifLog || []; return n.length ? String(n[0].text) : ''; })()`,
  toastCount: `((WHQ.app.logic.state.notifLog || []).length)`,
  bubble: `(() => { const d = [...document.querySelectorAll('div')].find((x) => /you found me|♪ ♫ ♪/.test(x.textContent) && x.children.length === 0); return d ? d.textContent : ''; })()`,
  clearBubble: `(() => { for (const d of document.querySelectorAll('div')) if (d.children.length === 0 && /you found me|♪ ♫ ♪/.test(d.textContent)) d.textContent = ''; return true; })()`,
  hearts: `(() => { const l = ${BIT_LAYER}; return l ? [...l.querySelectorAll('div')].filter((d) => d.textContent === '♥').length : -1; })()`,
  bitOn: `(() => { const L = WHQ.app.logic; L.setState({ petOn: true, reduceMotion: false }); return !!${BIT_LAYER}; })()`,
  root: `(() => { const r = ${ROOT}; return r ? { skin: r.getAttribute('data-hq-skin'), accent: r.getAttribute('data-hq-accent'), accentText: getComputedStyle(r).getPropertyValue('--accent-text').trim() } : null; })()`,
  paletteLink: `!!document.getElementById('hq-palettes-css')`,
  consoleNodes: `document.querySelectorAll('[data-hq-console]').length`,
  overlay: `!!${OVERLAY}`,
  overlayText: `(() => { const o = ${OVERLAY}; return o ? o.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  overlayStyle: `(() => { const o = ${OVERLAY}; if (!o) return null; const b = o.querySelector('button'); const cs = getComputedStyle(o); return { panelEvents: cs.pointerEvents, buttonEvents: b ? getComputedStyle(b).pointerEvents : null, transition: cs.transitionDuration, animations: o.getAnimations({ subtree: true }).length }; })()`,
  closeOverlay: `(() => { const b = document.querySelector('aside[aria-label="Frame timing"] button[aria-label="Close frame timing"]'); if (!b) return false; b.click(); return true; })()`,
  probe: `(() => (typeof window.__hqLayerProbe === 'function' ? JSON.stringify(window.__hqLayerProbe()) : null))()`,
  keydownCount: `(() => (typeof window.__hqKeydownCount === 'function' ? window.__hqKeydownCount() : -1))()`,
  wrapper: `(() => { const L = WHQ.app.logic; return { own: Object.prototype.hasOwnProperty.call(L, 'renderVals'), ring: !!L._chtRing, stats: L.cheatsDebugStats ? L.cheatsDebugStats() : 'no host' }; })()`,
  foundText: `(() => { const f = ${FOUND}; return f ? f.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  openSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  focusAsk: `(() => { WHQ.app.logic.setState({ askOpen: true }); return true; })()`,
  focusAskInput: `(() => { const i = document.querySelector('aside[aria-label="Ask"] input'); if (!i) return false; i.focus(); return document.activeElement === i; })()`,
  blur: `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); WHQ.app.logic.setState({ askOpen: false }); return true; })()`,
  wake: `(() => { const L = WHQ.app.logic; L.setState({ moreOpen: true }); L.setState({ moreOpen: false }); return true; })()`,
  prefs: `(() => localStorage.getItem(${JSON.stringify(PREFS_KEY)}))()`,
  restorePrefs: (raw) => `(() => { const v = ${JSON.stringify(raw == null ? null : raw)}; if (v == null) localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); else localStorage.setItem(${JSON.stringify(PREFS_KEY)}, v); return true; })()`,
  savedFound: `(() => { try { return JSON.stringify((JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || '{}') || {}).cheatsFound || null); } catch (e) { return 'unreadable'; } })()`,
  reducedState: `(() => !!WHQ.app.logic.state.reduceMotion)()`,
});

const KEY = (ch) => { const up = ch.toUpperCase(); const vk = up.charCodeAt(0); return { key: ch, code: /[a-z]/.test(ch) ? 'Key' + up : 'Digit' + ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }; };
/** Type letters into the page the way a keyboard does: keyDown (with text) then keyUp, one key at a time. */
export async function typeKeys(t, text) {
  for (const ch of String(text)) {
    const k = KEY(ch);
    await t.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, ...k });
    await t.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  }
}
export async function pressArrowUp(t) {
  const k = { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 };
  await t.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

export function makeCheatsScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const json = async (t, expr, dflt = null) => { const v = await t.evaluate(expr); if (!v) return dflt; try { return JSON.parse(v); } catch (e) { return dflt; } };
  // a scenario starts from a clean page with the prefs key remembered, and always puts both back
  const begin = async (t) => {
    const pre = await fresh(t); if (pre) return { pre };
    const prefs = await t.evaluate(PAGE.prefs);
    await t.evaluate(PAGE.reset);
    return { prefs };
  };
  const leave = async (t, prefs) => {
    await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await t.evaluate(PAGE.reset).catch(() => {});
    await t.evaluate(PAGE.setState({ reduceMotion: false })).catch(() => {});
    await t.evaluate(PAGE.restorePrefs(prefs)).catch(() => {});
  };

  return {
    async 'cheats-legacy-still-work'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.bitOn);
        await pause(150);
        const toasts0 = await t.evaluate(PAGE.toastCount);
        await typeKeys(t, 'bit');
        if (!await t.waitFor(`${PAGE.bubble}.includes('you found me')`, 3000)) out.push('typing bit with the layer off never made Bit say "you found me"');
        if (!(await t.waitFor(`${PAGE.hearts} > 0`, 1500))) out.push('typing bit threw no hearts (the ascii burst)');
        await t.evaluate(PAGE.clearBubble);
        await typeKeys(t, 'dance');
        if (!await t.waitFor(`${PAGE.bubble}.includes('♪')`, 3000)) out.push('typing dance with the layer off never made Bit cheer');
        await t.evaluate(PAGE.clearBubble);
        await pressArrowUp(t); await pressArrowUp(t);
        if (!await t.waitFor(`${PAGE.bubble}.includes('♪')`, 3000)) out.push('ArrowUp twice never made Bit cheer');
        const layer = await json(t, PAGE.layer);
        if (layer && layer.on) out.push('a legacy egg switched the Console layer on');
        if ((await t.evaluate(PAGE.toastCount)) !== toasts0) out.push('a legacy egg raised a toast; Bit speaks for them');
        const found = await json(t, PAGE.found, []);
        for (const id of ['bit', 'dance']) if (!found.includes(id)) out.push(id + ' is not in the found list');
        if (found.some((id) => !['bit', 'dance'].includes(id))) out.push('something else was found: ' + found.join(','));
        out.push(...t.errors());
      } finally { await leave(t, prefs); }
      return out;
    },

    async 'cheats-typing-guard'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.bitOn);
        await t.evaluate(PAGE.focusAsk);
        if (!await t.waitFor(PAGE.focusAskInput, 4000)) return out.concat('the Ask field never took focus');
        const toasts0 = await t.evaluate(PAGE.toastCount);
        for (const code of ['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance']) { if (!await t.evaluate(PAGE.focusAskInput)) { out.push('focus left the Ask field'); break; } await typeKeys(t, code); }
        await pause(200);
        const layer = await json(t, PAGE.layer);
        if (layer && (layer.on || layer.palette || layer.debug || layer.skin)) out.push('a code fired while the Ask field was focused: ' + JSON.stringify(layer));
        if ((await t.evaluate(PAGE.toastCount)) !== toasts0) out.push('a toast came from typing into a field');
        if (String(await t.evaluate(PAGE.bubble)).includes('you found me')) out.push('Bit answered a word typed into a field');
        if ((await json(t, PAGE.found, [])).length) out.push('something was found from inside a field');
        // a half-typed code is lost when a field is touched in between
        await t.evaluate(PAGE.blur);
        await typeKeys(t, 'cartri');
        await t.evaluate(PAGE.focusAsk);
        if (await t.waitFor(PAGE.focusAskInput, 3000)) { await typeKeys(t, 'x'); await t.evaluate(PAGE.blur); }
        await typeKeys(t, 'dge');
        await pause(150);
        if ((await json(t, PAGE.layer, {})).on) out.push('a half-typed code survived a field in the middle');
        // after blur the same keys fire
        await typeKeys(t, 'cartridge');
        if (!await t.waitFor(`(${PAGE.layer} || '').includes('"on":true')`, 3000)) out.push('after blur, typing cartridge on the page did not turn the layer on');
        out.push(...t.errors());
      } finally { await leave(t, prefs); }
      return out;
    },

    async 'cheats-unlock-chain'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      const step = async (code, toast, check, label) => {
        await typeKeys(t, code);
        if (!await t.waitFor(`${PAGE.lastToast} === ${JSON.stringify(toast)}`, 3000)) { out.push(label + ': the toast was "' + await t.evaluate(PAGE.lastToast) + '", want "' + toast + '"'); return false; }
        if (!await t.waitFor(check, 3000)) { out.push(label + ': the page did not change'); return false; }
        return true;
      };
      try {
        await t.evaluate(PAGE.openSettings);
        if (!await step('cartridge', 'Console layer on', `(${PAGE.layer} || '').includes('"on":true')`, 'cartridge')) return out;
        const before = await t.evaluate(PAGE.root);
        await step('plastic', 'Console skin on', `(${PAGE.root} || {}).skin === 'console'`, 'plastic');
        await step('ember', 'Ember accent on', `(${PAGE.root} || {}).accent === 'ember' && ${PAGE.paletteLink}`, 'ember');
        const ember = await t.evaluate(PAGE.root);
        await step('tide', 'Tide accent on', `(${PAGE.root} || {}).accent === 'tide'`, 'tide');
        const tide = await t.evaluate(PAGE.root);
        if (ember && tide && ember.accentText === tide.accentText) out.push('ember and tide resolve to the same accent colour: ' + ember.accentText);
        if (before && ember && before.accentText === ember.accentText) out.push('ember did not change the accent colour: ' + ember.accentText);
        await step('ember', 'Ember accent on', `(${PAGE.root} || {}).accent === 'ember'`, 'ember again');
        await step('ember', 'Ember accent off', `!(${PAGE.root} || {}).accent && !${PAGE.paletteLink}`, 'second ember');
        await step('timing', 'Timing overlay on', PAGE.overlay, 'timing');
        const txt = String(await t.evaluate(PAGE.foundText));
        if (!txt || txt === 'null') out.push('Settings has no codes-found list (the Memory card fragment)');
        else {
          if (!txt.includes('Codes found: 5 of 7')) out.push('the found list says: ' + txt.slice(0, 120));
          for (const id of ['cartridge', 'plastic', 'ember', 'tide', 'timing']) if (!txt.includes(FOUND_NAMES[id])) out.push('the found list lacks the name ' + FOUND_NAMES[id]);
          for (const id of ['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance']) if (new RegExp('\\b' + id + '\\b', 'i').test(txt)) out.push('the found list shows a sequence: ' + id);
        }
        out.push(...t.errors());
      } finally { await leave(t, prefs); }
      return out;
    },

    async 'cheats-off-zero-cost'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      let id = null, prefs = null;
      try {
        prefs = await t.evaluate(PAGE.prefs);
        id = (await t.send('Page.addScriptToEvaluateOnNewDocument', { source: KD_HOOK })).identifier;
        await t.reload();
        const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;
        if (!await t.waitFor(READY + ' && !!window.hqFake', 15000)) return out.concat('the app never mounted after the reload');
        await t.evaluate(PAGE.reset);
        await pause(150);
        const n0 = await t.evaluate(PAGE.keydownCount);
        if (n0 < 0) return out.concat('the keydown counting hook did not install before the app ran');
        if (n0 !== EXPECT_KEYDOWN) out.push('window keydown listeners with the layer off: ' + n0 + ', want ' + EXPECT_KEYDOWN + ' (app.js and the cheats host)');
        const probe = await t.evaluate(PAGE.probe);
        if (probe == null) out.push('window.__hqLayerProbe is missing (the console layer dish)');
        else if (!/^\{"links":0,"listeners":0,"timers":0,"frames":0\}$/.test(probe.replace(/\s+/g, ''))) out.push('the layer probe is not all zeros with the layer off: ' + probe);
        if (await t.evaluate(PAGE.paletteLink)) out.push('the palettes stylesheet is attached with the layer off');
        if (await t.evaluate(PAGE.consoleNodes)) out.push('a [data-hq-console] node exists with the layer off');
        if (await t.evaluate(PAGE.overlay)) out.push('the timing overlay exists with the layer off');
        const root = await t.evaluate(PAGE.root);
        if (root && root.accent) out.push('data-hq-accent is "' + root.accent + '", want empty');
        const w0 = await t.evaluate(PAGE.wrapper);
        if (w0.own || w0.ring) out.push('a render wrapper or ring exists with the layer off');
        // on, with the overlay, then off again: the listener count never moves and everything goes
        await t.evaluate(PAGE.setLayer({ on: true, debug: true }));
        if (!await t.waitFor(PAGE.overlay, 3000)) out.push('the overlay never appeared with the layer and the flag on');
        if ((await t.evaluate(PAGE.keydownCount)) !== EXPECT_KEYDOWN) out.push('switching the layer on changed the keydown listener count to ' + await t.evaluate(PAGE.keydownCount));
        await t.evaluate(PAGE.setLayer({}));
        if (!await t.waitFor(`!${PAGE.overlay}`, 3000)) out.push('the overlay stayed after the layer went off');
        await pause(150);
        if ((await t.evaluate(PAGE.keydownCount)) !== EXPECT_KEYDOWN) out.push('switching the layer off changed the keydown listener count to ' + await t.evaluate(PAGE.keydownCount));
        const w1 = await t.evaluate(PAGE.wrapper);
        if (w1.own || w1.ring) out.push('the render wrapper or the ring is still there after the layer went off');
        const probe1 = await t.evaluate(PAGE.probe);
        if (probe1 != null && !/^\{"links":0,"listeners":0,"timers":0,"frames":0\}$/.test(probe1.replace(/\s+/g, ''))) out.push('the layer probe is not back to zeros: ' + probe1);
        out.push(...t.errors());
      } finally {
        await t.evaluate(PAGE.reset).catch(() => {});
        await t.evaluate(PAGE.restorePrefs(prefs)).catch(() => {});
        if (id) { await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }).catch(() => {}); await t.reload().catch(() => {}); }
      }
      return out;
    },

    async 'cheats-debug-overlay'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      try {
        await typeKeys(t, 'cartridge');
        await typeKeys(t, 'timing');
        if (!await t.waitFor(PAGE.overlay, 3000)) return out.concat('typing timing did not open the overlay');
        await pause(100);
        await t.evaluate(PAGE.wake);
        await t.evaluate(PAGE.wake);
        if (!await t.waitFor(`/last render\\s*[0-9.]*[1-9][0-9.]* ms/.test(${PAGE.overlayText})`, 4000)) out.push('the overlay never showed a nonzero last render: ' + String(await t.evaluate(PAGE.overlayText)).slice(0, 200));
        const txt = String(await t.evaluate(PAGE.overlayText));
        for (const w of ['p50', 'p95', 'renders, last minute', 'values', 'last live update']) if (!txt.includes(w)) out.push('the overlay lacks "' + w + '"');
        if (/NaN|undefined|Infinity/.test(txt)) out.push('the overlay shows a broken number: ' + txt.slice(0, 160));
        const st = await t.evaluate(PAGE.overlayStyle);
        if (!st || st.panelEvents !== 'none') out.push('the overlay panel takes pointer events: ' + JSON.stringify(st));
        if (st && st.buttonEvents !== 'auto') out.push('the close button does not take pointer events: ' + JSON.stringify(st));
        const w = await t.evaluate(PAGE.wrapper);
        if (!w.own || !w.ring) out.push('while the overlay is open the render wrapper and the ring should exist');
        await t.evaluate(PAGE.closeOverlay);
        if (!await t.waitFor(`!${PAGE.overlay}`, 3000)) out.push('the close button did not remove the overlay');
        await pause(150);
        const w2 = await t.evaluate(PAGE.wrapper);
        if (w2.own) out.push('the render wrapper stayed after the overlay closed');
        if (w2.ring) out.push('the ring stayed after the overlay closed');
        if (w2.stats !== null) out.push('cheatsDebugStats still answers after the overlay closed');
        const layer = await json(t, PAGE.layer, {});
        if (layer.debug || !layer.on) out.push('closing the overlay should clear only the debug flag: ' + JSON.stringify(layer));
        out.push(...t.errors());
      } finally { await leave(t, prefs); }
      return out;
    },

    async 'cheats-reduced-motion'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.setState({ petOn: true, reduceMotion: true }));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await pause(200);
        await typeKeys(t, 'cartridge');
        await typeKeys(t, 'ember');
        await typeKeys(t, 'timing');
        if (!await t.waitFor(`(${PAGE.root} || {}).accent === 'ember'`, 3000)) out.push('ember did not apply with reduced motion');
        if (!await t.waitFor(PAGE.overlay, 3000)) out.push('timing did not open the overlay with reduced motion');
        const st = await t.evaluate(PAGE.overlayStyle);
        if (st) {
          if (!/^(0s)(, 0s)*$/.test(String(st.transition).trim())) out.push('the overlay has a transition: ' + st.transition);
          if (st.animations) out.push('the overlay has a running animation (' + st.animations + ')');
        }
        await typeKeys(t, 'bit');
        if (!await t.waitFor(`${PAGE.bubble}.includes('you found me')`, 3000)) out.push('Bit did not answer bit with reduced motion');
        await pause(250);
        const hearts = await t.evaluate(PAGE.hearts);
        if (hearts > 0) out.push('Bit threw ' + hearts + ' animated hearts with reduced motion; it should be the short form');
        if (!(await t.evaluate(PAGE.reducedState))) out.push('reduceMotion did not stay on');
        out.push(...t.errors());
      } finally { await leave(t, prefs); }
      return out;
    },

    async 'cheats-found-persist'(t) {
      const { pre, prefs } = await begin(t); if (pre) return pre;
      const out = [];
      try {
        await typeKeys(t, 'cartridge');
        await typeKeys(t, 'ember');
        await typeKeys(t, 'bit');
        if (!await t.waitFor(`(${PAGE.found}).includes('"bit"') && (${PAGE.found}).includes('"ember"') && (${PAGE.found}).includes('"cartridge"')`, 4000)) return out.concat('the found list never held the three codes: ' + await t.evaluate(PAGE.found));
        if (!await t.waitFor(`(${PAGE.savedFound}).includes('ember')`, 4000)) return out.concat('cheatsFound never reached the saved prefs: ' + await t.evaluate(PAGE.savedFound));
        await t.reload();
        const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;
        if (!await t.waitFor(READY + ' && !!window.hqFake', 15000)) return out.concat('the app never mounted after the reload');
        const found = await json(t, PAGE.found, []);
        for (const id of ['cartridge', 'ember', 'bit']) if (!found.includes(id)) out.push(id + ' did not survive the reload');
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`${PAGE.foundText} !== null`, 5000)) out.push('Settings has no codes-found list after the reload (layer pref lost, or no Memory card fragment)');
        else {
          const txt = String(await t.evaluate(PAGE.foundText));
          if (!txt.includes('Codes found: 3 of 7')) out.push('the found list says: ' + txt.slice(0, 120));
          for (const id of ['cartridge', 'ember', 'bit']) if (!txt.includes(FOUND_NAMES[id])) out.push('the name ' + FOUND_NAMES[id] + ' is missing');
          for (const id of ALL_CODES) if (new RegExp('\\b' + id + '\\b', 'i').test(txt)) out.push('the list shows a sequence: ' + id);
        }
        out.push(...t.errors());
      } finally { await leave(t, prefs); await t.reload().catch(() => {}); }
      return out;
    },
  };
}
