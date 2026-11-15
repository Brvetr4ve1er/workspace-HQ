// CDP scenarios for Settings > "Memory card" (only while the Console layer is on). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeMemoryCardScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario memory-off-no-call,memory-render,...   (needs --preload=fake)
//
// The fake preload answers hq.memory.read with inventedMemoryRead() of src/selftest-memory-card.mjs: ten invented kinds with fixed sizes and ages
// counted back from a fixed read instant, and a snapshot 7 h old with 3 of 7 kept. fake-preload.js carries a pasted copy of that function's source
// (fakeMemorySource() prints the exact text, the unit test pins it) registered as ['memory.read', () => inventedMemoryRead()].
// hqFake.calls('memory.read') lists what the page asked. What a scenario EXPECTS is written out below as plain words and numbers (EXPECT), never
// asked of the page's own code. Each scenario ends with the Settings dialog closed, the layer, motion preference and bridge put back, and the fake reset.
//
//   memory-off-no-call      layer off: Settings opens with no Memory card section, and hq.memory.read was never called - not with the layer off, and not
//                           with the layer on while Settings is closed
//   memory-render           layer on, Settings open: one block per kind with its size, file count and age, the snapshot slot, the bars scaled to the
//                           largest kind, the text twin, the read-only note, the two inert hooks; read exactly once per opening of Settings; no file names
//   memory-read-only        the section has no button whose label matches forget|delete|clear|erase|export|reset (its buttons are Refresh and the Empty slot door to the back room), no input
//                           or link, and nothing but hq.memory.read was ever called
//   memory-no-bridge        hq.memory absent: the section says only that the memory card needs the desktop app, has no button, reads nothing, logs no error
//   memory-reduced-motion   with reduceMotion set and prefers-reduced-motion: reduce emulated, nothing inside the section animates or transitions
//   memory-refresh          Refresh re-reads exactly once and the age it shows follows the new answer
import { inventedMemoryRead } from '../src/selftest-memory-card.mjs';

const SEC = `document.querySelector('section[data-mcd="section"]')`;
const slot = (kind) => `document.querySelector('svg[data-mcd="slot"][data-mcd-kind="${kind}"]')`;
export const PAGE = Object.freeze({
  section: SEC,
  dialog: `document.querySelector('[role="dialog"][aria-label="Settings"]')`,
  dialogText: `(() => { const d = document.querySelector('[role="dialog"][aria-label="Settings"]'); return d ? d.textContent.replace(/\\s+/g, ' ') : ''; })()`,
  text: `(${SEC} ? ${SEC}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  slots: `[...document.querySelectorAll('svg[data-mcd="slot"]')]`,
  kinds: `[...document.querySelectorAll('svg[data-mcd="slot"]')].map((s) => s.getAttribute('data-mcd-kind'))`,
  big: (kind) => `(() => { const e = ${slot(kind)}; const t = e && e.querySelector('[data-mcd="big"]'); return t ? t.textContent.trim() : null; })()`,
  small: (kind) => `(() => { const e = ${slot(kind)}; const t = e && e.querySelector('[data-mcd="small"]'); return t ? t.textContent.trim() : null; })()`,
  aria: (kind) => `(() => { const e = ${slot(kind)}; return e ? e.getAttribute('role') + '|' + e.getAttribute('aria-label') : null; })()`,
  fillW: (kind) => `(() => { const e = ${slot(kind)}; const r = e && e.querySelector('[data-mcd="fill"]'); return r ? parseFloat(r.getAttribute('width')) : null; })()`,
  twinCount: `(() => { const u = ${SEC} && ${SEC}.querySelector('[data-mcd="twin"]'); return u ? u.querySelectorAll('li').length : 0; })()`,
  summary: `(() => { const e = ${SEC} && ${SEC}.querySelector('[data-mcd="summary"]'); return e ? e.textContent.trim() : ''; })()`,
  note: `(() => { const e = ${SEC} && ${SEC}.querySelector('[data-mcd="note"]'); return e ? e.textContent.trim() : ''; })()`,
  emptySlot: `(() => { const e = ${SEC} && ${SEC}.querySelector('[data-mcd="empty-slot"]'); return e ? e.textContent.trim() : null; })()`,
  codesSlot: `(() => { const e = ${SEC} && ${SEC}.querySelector('[data-mcd="codes-slot"]'); return e ? e.childElementCount + '|' + e.textContent.trim() : null; })()`,
  buttons: `(${SEC} ? [...${SEC}.querySelectorAll('button, [role="button"], a[href], input, select, textarea, [onclick]')].map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim()) : [])`,
  refresh: `(${SEC} && ${SEC}.querySelector('[data-mcd="refresh"]'))`,
  refreshText: `(() => { const b = ${SEC} && ${SEC}.querySelector('[data-mcd="refresh"]'); return b ? b.textContent.trim() : null; })()`,
  calls: `hqFake.calls('memory.read').length`,
  memoryCalls: `hqFake.calls().filter((c) => c.method.indexOf('memory.') === 0).map((c) => c.method)`,
  // layer + Settings state, set on the app's own logic (state only: the page's own render does the rest)
  open: (layerOn) => `(() => { const L = WHQ.app.logic; if (!window.__mcdSaved) window.__mcdSaved = { layer: L.state.consoleLayer, reduce: L.state.reduceMotion, hq: null }; L._mcdAsked = false; L._mcdReading = false; L.setState({ consoleLayer: Object.assign({}, L.state.consoleLayer || {}, { on: ${layerOn ? 'true' : 'false'} }), mcd: null, settingsOpen: true }); return true; })()`,
  close: `(() => { WHQ.app.logic.setState({ settingsOpen: false }); return true; })()`,
  reopen: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  layerOnClosed: `(() => { const L = WHQ.app.logic; if (!window.__mcdSaved) window.__mcdSaved = { layer: L.state.consoleLayer, reduce: L.state.reduceMotion, hq: null }; L._mcdAsked = false; L.setState({ consoleLayer: Object.assign({}, L.state.consoleLayer || {}, { on: true }), mcd: null, settingsOpen: false }); return true; })()`,
  noBridge: `(() => { if (!window.__mcdHq) window.__mcdHq = WHQ.store.hq; WHQ.store.hq = Object.assign({}, WHQ.store.hq, { memory: undefined }); return true; })()`,
  reduce: `(() => { const L = WHQ.app.logic; if (!window.__mcdSaved) window.__mcdSaved = { layer: L.state.consoleLayer, reduce: L.state.reduceMotion, hq: null }; L.setState({ reduceMotion: true }); return true; })()`,
  motion: `(() => { const s = ${SEC}; if (!s) return null; const els = [s].concat([...s.querySelectorAll('*')]); const bad = []; for (const e of els) { const c = getComputedStyle(e); const t = c.transitionProperty !== 'none' && c.transitionDuration.split(',').some((x) => parseFloat(x) > 0); const a = c.animationName !== 'none' && c.animationName !== ''; if (t || a) bad.push(e.tagName.toLowerCase()); } return { elements: els.length, bad: bad, running: s.getAnimations ? s.getAnimations({ subtree: true }).length : 0, media: matchMedia('(prefers-reduced-motion: reduce)').matches }; })()`,
  setAnswer: (answer) => `(() => { hqFake.set('memory.read', ${JSON.stringify(answer)}); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; const s = window.__mcdSaved; if (window.__mcdHq) { WHQ.store.hq = window.__mcdHq; delete window.__mcdHq; } hqFake.reset(true); L._mcdAsked = false; L._mcdReading = false; L.setState({ settingsOpen: false, mcd: null, toasts: [], consoleLayer: s ? s.layer : L.state.consoleLayer, reduceMotion: s ? s.reduce : L.state.reduceMotion }); delete window.__mcdSaved; return true; })()`,
});

/** What the invented answer must look like on the page, in plain words (a unit test pins these against the answer's numbers). */
export const EXPECT = Object.freeze([
  Object.freeze({ kind: 'scans', size: '12 MB', small: '34 files · 3 h ago' }),
  Object.freeze({ kind: 'brief', size: '47 KB', small: '5 files · 20 min ago' }),
  Object.freeze({ kind: 'money', size: '9.6 KB', small: '2 files · 1 d ago' }),
  Object.freeze({ kind: 'cosmos', size: '4.7 GB', small: '812 files · 5 d ago' }),
  Object.freeze({ kind: 'security', size: '21 KB', small: '3 files · 2 d ago' }),
  Object.freeze({ kind: 'delivery', size: '0 B', small: 'empty' }),
  Object.freeze({ kind: 'chat-index', size: '839 MB', small: '4 files · just now' }),
  Object.freeze({ kind: 'logs', size: '3.1 MB', small: '30 files · 59 min ago' }),
  Object.freeze({ kind: 'today-drift', size: '156 KB', small: '6 files · 1 h ago' }),
  Object.freeze({ kind: 'other', size: '100 B', small: '2 files · 10 d ago' }),
]);
export const SNAPSHOT_EXPECT = Object.freeze({ big: '7 h ago', small: '3 of 7 kept' });
/** The bars, by hand: 140 units is the largest kind (the library, 5.1 GB); the rest are bytes / 5.1e9 of it. */
export const FILL_EXPECT = Object.freeze({ cosmos: 140, 'chat-index': 24.16, scans: 0.34, delivery: 0 });
export const KIND_ORDER = Object.freeze([...EXPECT.map((e) => e.kind), 'snapshot']);
export const MEMORY_SCENARIOS = Object.freeze(['memory-off-no-call', 'memory-render', 'memory-read-only', 'memory-no-bridge', 'memory-reduced-motion', 'memory-refresh']);
export const NO_FORGET = /forget|delete|clear|erase|export|reset/i;
export const NO_TEXT = /undefined|\[object|NaN|Infinity/;
export const NO_NAMES = /\.(json|jsonl|sqlite|log|md|bin|kdbx)\b/i;   // a file name never reaches the card: only kinds, sizes and ages do

/** The exact text fake-preload.js pastes (a plain script cannot import the module): the function's own source, named, plus the line that registers it. */
export const fakeMemorySource = () => 'const inventedMemoryRead = ' + inventedMemoryRead.toString() + ';';
export const FAKE_REGISTER_LINE = `['memory.read', () => inventedMemoryRead()],`;

export function makeMemoryCardScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const near = (a, b, tol = 0.05) => typeof a === 'number' && Math.abs(a - b) <= tol;
  const opened = async (t, out) => {
    await t.evaluate(PAGE.reset);
    await t.evaluate(PAGE.open(true));
    if (!await t.waitFor(`${PAGE.slots}.length === 11`, 6000)) { out.push('Settings never showed eleven blocks: ' + String(await t.evaluate(PAGE.text)).slice(0, 240)); return false; }
    return true;
  };

  return {
    async 'memory-off-no-call'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open(false));
        if (!await t.waitFor(`!!${PAGE.dialog}`, 6000)) return out.concat('Settings never opened');
        await pause(300);
        if (await t.evaluate(`!!${PAGE.section}`)) out.push('the Memory card section exists while the Console layer is off');
        if (/memory card/i.test(String(await t.evaluate(PAGE.dialogText)))) out.push('Settings mentions the memory card while the layer is off');
        await t.evaluate(PAGE.close);
        await t.evaluate(PAGE.layerOnClosed);
        await pause(300);
        const n = await t.evaluate(PAGE.calls);
        if (n !== 0) out.push('hq.memory.read was called ' + n + ' time(s) with the layer off or Settings closed, want 0');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'memory-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await opened(t, out)) return out;
        await pause(300);
        const kinds = await t.evaluate(PAGE.kinds);
        if (JSON.stringify(kinds) !== JSON.stringify(KIND_ORDER)) out.push('blocks ' + JSON.stringify(kinds) + ', want ' + JSON.stringify(KIND_ORDER));
        for (const e of EXPECT) {
          const big = await t.evaluate(PAGE.big(e.kind)), small = await t.evaluate(PAGE.small(e.kind));
          if (big !== e.size) out.push(e.kind + ' size reads "' + big + '", want "' + e.size + '"');
          if (small !== e.small) out.push(e.kind + ' says "' + small + '", want "' + e.small + '"');
          const aria = String(await t.evaluate(PAGE.aria(e.kind)));
          if (!aria.startsWith('img|') || aria.length < 12) out.push(e.kind + ' is not an img with a label: ' + aria);
        }
        const sbig = await t.evaluate(PAGE.big('snapshot')), ssmall = await t.evaluate(PAGE.small('snapshot'));
        if (sbig !== SNAPSHOT_EXPECT.big || ssmall !== SNAPSHOT_EXPECT.small) out.push('the snapshot slot says "' + sbig + '" / "' + ssmall + '", want "' + SNAPSHOT_EXPECT.big + '" / "' + SNAPSHOT_EXPECT.small + '"');
        for (const [kind, w] of Object.entries(FILL_EXPECT)) {
          const got = await t.evaluate(PAGE.fillW(kind));
          if (!near(got, w)) out.push(kind + ' bar is ' + got + ' wide, want about ' + w + ' (scaled to the largest kind)');
        }
        if (await t.evaluate(PAGE.fillW('snapshot')) !== null) out.push('the snapshot slot has a size bar');
        const tw = await t.evaluate(PAGE.twinCount);
        if (tw !== 11) out.push('the text twin lists ' + tw + ' items, want 11');
        if (!/^Read-only/.test(String(await t.evaluate(PAGE.note)))) out.push('the read-only note is missing: "' + String(await t.evaluate(PAGE.note)).slice(0, 120) + '"');
        if (!/read \d\d:\d\d/.test(String(await t.evaluate(PAGE.summary)))) out.push('the summary does not say when it was read: "' + String(await t.evaluate(PAGE.summary)) + '"');
        if (await t.evaluate(PAGE.emptySlot) !== 'Empty slot') out.push('the final empty slot block is missing');
        // the slot was empty in the Memory card dish; the cheat codes dish puts the codes-found list in it (one block, "Codes found: N of M", names only)
        if (!/^1\|Codes found: \d+ of \d+/.test(String(await t.evaluate(PAGE.codesSlot)))) out.push('the codes slot hook is missing or does not hold the found list: ' + String(await t.evaluate(PAGE.codesSlot)));
        const txt = String(await t.evaluate(PAGE.text));
        if (NO_TEXT.test(txt)) out.push('an unresolved binding reached the section text');
        if (NO_NAMES.test(txt)) out.push('something that looks like a file name reached the section: ' + txt.slice(0, 160));
        if (await t.evaluate(PAGE.calls) !== 1) out.push('opening Settings read the memory card ' + await t.evaluate(PAGE.calls) + ' times, want exactly 1');
        await t.evaluate(PAGE.close);
        await pause(150);
        await t.evaluate(PAGE.reopen);
        if (!await t.waitFor(`${PAGE.calls} === 2`, 4000)) out.push('opening Settings a second time did not read again (reads: ' + await t.evaluate(PAGE.calls) + ')');
        await pause(300);
        if (await t.evaluate(PAGE.calls) !== 2) out.push('the second opening read ' + await t.evaluate(PAGE.calls) + ' times in all, want 2');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'memory-read-only'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await opened(t, out)) return out;
        const controls = await t.evaluate(PAGE.buttons);
        if (!Array.isArray(controls) || controls.length !== 2 || !controls.includes('Empty slot')) out.push('the section has controls ' + JSON.stringify(controls) + ', want exactly two (Refresh, and the Empty slot door to the back room)');
        for (const c of controls || []) if (NO_FORGET.test(String(c))) out.push('a control reads "' + c + '": nothing here may forget, delete, clear, erase, export or reset');
        if (await t.evaluate(PAGE.refreshText) !== 'Refresh') out.push('the one button is not Refresh');
        const methods = await t.evaluate(PAGE.memoryCalls);
        if (!Array.isArray(methods) || methods.some((m) => m !== 'memory.read')) out.push('a call other than memory.read reached main: ' + JSON.stringify(methods));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'memory-no-bridge'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.noBridge);
        await t.evaluate(PAGE.open(true));
        if (!await t.waitFor(`!!${PAGE.section}`, 6000)) return out.concat('the section never showed without the bridge: ' + String(await t.evaluate(PAGE.dialogText)).slice(0, 200));
        await pause(300);
        const said = String(await t.evaluate(PAGE.text));
        if (said !== 'The memory card needs the desktop app') out.push('without the bridge the section says "' + said + '", want only "The memory card needs the desktop app"');
        const controls = await t.evaluate(PAGE.buttons);
        if (!Array.isArray(controls) || controls.length) out.push('the section has controls without a bridge: ' + JSON.stringify(controls));
        if (await t.evaluate(PAGE.calls) !== 0) out.push('a read was recorded without a bridge');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'memory-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await t.evaluate(PAGE.reduce);
        if (!await opened(t, out)) return out;
        await pause(200);
        const m = await t.evaluate(PAGE.motion);
        if (!m) return out.concat('the section was not on the page');
        if (m.media !== true) out.push('the prefers-reduced-motion media query did not apply, so this proves nothing');
        if (m.bad.length) out.push('these elements animate or transition inside the section: ' + m.bad.join(', '));
        if (m.running !== 0) out.push(m.running + ' animation(s) are running inside the section');
        out.push(...t.errors());
      } finally {
        await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
        await leave(t);
      }
      return out;
    },

    async 'memory-refresh'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await opened(t, out)) return out;
        await pause(300);
        if (await t.evaluate(PAGE.small('scans')) !== '34 files · 3 h ago') out.push('the first read shows "' + await t.evaluate(PAGE.small('scans')) + '" for the scans kind');
        if (await t.evaluate(PAGE.calls) !== 1) out.push('the arrival read ' + await t.evaluate(PAGE.calls) + ' times, want 1');
        await t.evaluate(PAGE.setAnswer(inventedMemoryRead({ fresher: true })));
        await t.evaluate(`${PAGE.refresh}.click()`);
        if (!await t.waitFor(`${PAGE.small('scans')} === '34 files · 1 min ago'`, 5000)) out.push('Refresh did not update the age: "' + await t.evaluate(PAGE.small('scans')) + '"');
        await pause(300);
        const n = await t.evaluate(PAGE.calls);
        if (n !== 2) out.push('Refresh made the page read ' + n + ' times in all, want 2');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
