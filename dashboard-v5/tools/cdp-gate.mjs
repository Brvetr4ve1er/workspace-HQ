// CDP gate for the v5 renderer. Start the dev harness with a debugging port, e.g.
//   ..\dashboard\node_modules\electron\dist\electron.exe dev-main.js --preload=fake --hidden --remote-debugging-port=9342
// then run named scenarios against its page (Node 25: global fetch + WebSocket):
//   node tools/cdp-gate.mjs --port 9342 --scenario boot            (comma list, or "all")
//   options: --match index.html (page URL substring) · --wait 20000 (ms to wait for the port)
// Exit 0 every scenario passed · 1 one failed · 2 couldn't connect / bad usage.
//
// A scenario is `async (t) => [failure strings]` ([] = pass) in SCENARIOS below.
// t.evaluate(expr) evaluates in the page (awaits promises, returns by value) ·
// t.waitFor(expr, ms) polls until truthy · t.reload() reloads and waits for
// load · t.press('Enter'|'Escape', {repeat}) a real key event through CDP Input ·
// t.type(text) text into the focused element (Input.insertText) ·
// t.send(method, params) raw CDP · t.sleep(ms) · t.errors() console errors, uncaught
// exceptions and error-level log entries (CSP, network) since the last reload or
// t.clearErrors(). Scenarios run in order on the same page.
//
// Phase 2 safety scenarios (need --preload=fake; each starts from hqFake.reset(true)):
//   confirm-enter-on-cancel · confirm-hash · commit-env · ask-stream · scan-failed · live-hydrate
// scan-failed and live-hydrate reload with hqFake.set(…, {persist:true}), then reload clean.
// Phase 3 parity scenarios (same rules; localStorage keys they touch are put back):
//   ask-stop-retry · ask-history-v3-compat · system-reexamine ·
//   automations-filters · projects-filter · whats-new-first-launch · capture-toast-first
// H2 Claude library scenarios (same rules; fake Hub answers):
//   claude-library-search · claude-thread-open
// H5 Ask scenario (same rules; the fake chat answers a cited Claude history section):
//   ask-claude-chip · vault-preview-confirm
// H3 in-app chat scenarios (same rules; claudeChat.send/cancel overridden to emit events by hand):
//   claude-chat-stream-stop · claude-chat-mode-readonly
// H6 archive scenario (same rules; the fake Hub answers documents):
//   search-documents
// Every-button scenario (2026-10-27; same rules):
//   button-sweep — clicks every visible button on every screen from a clean one; fails on errors, "isn't wired" (bar any
//     KNOWN_CUTS; none left) and clicks that change nothing. Long (~6 min): has its own TIMEOUT below; not part of a quick run.
import fs from 'node:fs';
import vm from 'node:vm';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); if (i > 0 && process.argv[i + 1]) return process.argv[i + 1]; const eq = process.argv.find((a) => a.startsWith('--' + k + '=')); return eq ? eq.slice(k.length + 3) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what + ' timed out after ' + ms + ' ms'); })]);

// ---- CDP plumbing ------------------------------------------------------------
async function connect(port, match, waitMs) {
  let page = null, last = '';
  for (const t0 = Date.now(); !page && Date.now() - t0 < waitMs; await sleep(page ? 0 : 400)) {
    try {
      // 127.0.0.1, not localhost: Node may resolve localhost to ::1 while Chromium listens on v4
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.includes(match)) || null;
      if (!page) last = 'no page whose URL contains "' + match + '" (' + list.map((t) => t.type + ' ' + t.url).join(', ') + ')';
    } catch (e) { last = e.message; }
  }
  if (!page) throw new Error('no target on port ' + port + ': ' + last);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await within(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket to ' + page.webSocketDebuggerUrl + ' failed')); }), 10000, 'websocket open');
  let seq = 0;
  const pending = new Map(), handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); return; }
    for (const fn of handlers.get(m.method) || []) fn(m.params);
  };
  ws.onclose = () => { for (const p of pending.values()) p.rej(new Error('CDP socket closed')); pending.clear(); };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const on = (method, fn) => { handlers.set(method, (handlers.get(method) || []).concat([fn])); return () => handlers.set(method, handlers.get(method).filter((f) => f !== fn)); };
  return { send, on, url: page.url, close: () => ws.close() };
}

function driver(cdp) {
  let errs = [];
  const text = (args) => (args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errs.push('console.' + p.type + ': ' + text(p.args).slice(0, 400)); });
  cdp.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errs.push('uncaught: ' + ((d.exception && d.exception.description) || d.text || '?').slice(0, 400)); });
  cdp.on('Log.entryAdded', (p) => { const e = p.entry; if (e.level === 'error') errs.push('log.' + e.source + ': ' + e.text + (e.url ? ' (' + e.url + ')' : '')); });
  cdp.on('Runtime.executionContextsCleared', () => { errs = []; });   // a navigation starts a clean slate
  const t = {
    async evaluate(expression) {   // CDP Runtime.evaluate in the page under test
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expression, ms = 10000) {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) { try { if (await t.evaluate(expression)) return true; } catch {} }
      return false;
    },
    async reload() {
      let off;
      const loaded = new Promise((res) => { off = cdp.on('Page.loadEventFired', res); });
      await cdp.send('Page.reload', { ignoreCache: true });
      try { await within(loaded, 30000, 'page load'); } finally { off(); }
    },
    // a real key press through the browser's input pipeline (keydown → keypress → default
    // action, so Enter on a focused button clicks it). {repeat:true} sends one auto-repeat
    // keydown and no keyup, as when the key is held down.
    async press(key, o = {}) {
      const K = { Enter: ['Enter', 13, '\r'], Escape: ['Escape', 27, ''] }[key];
      if (!K) throw new Error('press: no key table entry for ' + key);
      const [code, vk, text] = K, base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: text ? 'keyDown' : 'rawKeyDown', autoRepeat: !!o.repeat }, base, text ? { text, unmodifiedText: text } : null));
      if (!o.repeat) await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    },
    // text into the focused element as if typed (one input event, like an IME commit)
    async type(text) { await cdp.send('Input.insertText', { text: String(text) }); },
    send: (method, params) => cdp.send(method, params),
    sleep, errors: () => errs.slice(), clearErrors: () => { errs = []; },
  };
  return t;
}

// ---- helpers for the scenarios that drive the app (need --preload=fake) ------------
// The harness runs on the owner's real dashboard/data.js and this repo is public:
// scenarios pick projects and automations at run time and never print their names.
const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;
const CONFIRM = `document.querySelector('[role="dialog"][aria-label="Run confirm"]')`;
const COMMIT = `document.querySelector('[role="dialog"][aria-label="Commit"]')`;
const ACTIVITY = `document.querySelector('aside[aria-label="Activity"]')`;
// a known page: loaded, the fake reset (log, overrides, persisted values), no overlay open, live view
async function fresh(t) {
  if (!await t.waitFor(READY, 15000)) return ['the app never mounted'];
  if (!await t.evaluate('!!window.hqFake')) return ['window.hqFake missing · start the harness with --preload=fake'];
  await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L._libRescan = false;
    if (L.store && L.store.live && L.store.live.claudeChat) L.store.live.claudeChat.turns.length = 0;
    L.setState({ snapOffset: 0, confirm: null, confirmHash: null, confirmPreview: null, commit: null, sheet: null, levelUp: null, onboard: null,
    askOpen: false, runsOpen: false, paletteOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, scrubOpen: false, toasts: [],
    // Phase 3 surface state back to app.js's defaults (contract K-4)
    vault: null, whatsNewOpen: false, whatsNewMissing: {}, sysExamining: false, sysSaves: {}, fixed: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false, autoQuery: '',
    clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: '',
    ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false,
    projSearch: '', projStatus: 'all', askChecking: false, route: null, });
    if (L.store && L.store.live) L.store.live.candidates = { rows: null, pooled: null, capped: null, hidden: 0, error: null, busy: false, loaded: false };
    return true; })()`);
  await t.sleep(80);
  t.clearErrors();
  return null;
}
// reload with whatever the fake persisted, and wait until the store's boot reads ran
async function reloadReady(t) {
  await t.reload();
  if (!await t.waitFor(READY + ` && !!window.hqFake && hqFake.calls('liveState').length > 0`, 15000)) return false;
  await t.sleep(400);   // the liveState reply and the first renders land
  return true;
}
// text of the Activity card whose name starts with `name` ('' when there is none)
const activityCard = (name) => `(() => { const a = ${ACTIVITY}; if (!a) return null;
  const card = [...a.querySelectorAll('span')].find((s) => s.textContent.trim().startsWith(${JSON.stringify(name)}));
  const box = card && card.parentElement && card.parentElement.parentElement;   // name row → card (inline styles are re-serialised, so no style selector)
  return box ? box.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`;
// one automation that opens the run confirm (data.js's first; not trusted, so askRun always asks)
const OPEN_CONFIRM = `(() => { const L = WHQ.app.logic, a = L.M.AUTOS.find((x) => !x.destructive) || L.M.AUTOS[0];
  if (!a) return null; L.setState({ trusted: [] }); L.askRun(a); return { id: a.id, hash: a.hash == null ? null : a.hash }; })()`;
// localStorage keys a scenario changes: read them first (null = absent), put them back after
const ASK_KEYS = ['hq-oracle-chat', 'hq-oracle-include'];
const SNAP_KEYS = (keys) => `(() => { const o = {}; for (const k of ${JSON.stringify(keys)}) o[k] = localStorage.getItem(k); return o; })()`;
const RESTORE_KEYS = (saved) => `for (const [k, v] of Object.entries(${JSON.stringify(saved || {})})) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }`;
const focusIn = (dialog, pick) => `(() => { const d = ${dialog}; if (!d) return 'no dialog';
  const b = [...d.querySelectorAll('button')].find((x) => ${pick}); if (!b) return 'no such button';
  b.focus(); return document.activeElement === b ? '' : 'focus did not move to the button'; })()`;

// dashboard/preload.js evaluated with a stub `electron`, walked into dotted method paths
function preloadMethods() {
  const exposed = {}, noop = () => {};
  const electron = { contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } }, ipcRenderer: { invoke: noop, send: noop, on: noop, removeListener: noop } };
  vm.runInNewContext(fs.readFileSync(new URL('../../dashboard/preload.js', import.meta.url), 'utf8'), { require: (m) => { if (m !== 'electron') throw new Error('preload requires ' + m); return electron; } });
  const walk = (o, p, out) => { for (const [k, v] of Object.entries(o || {})) { if (typeof v === 'function') out.push(p + k); else if (v && typeof v === 'object') walk(v, p + k + '.', out); } return out; };
  return walk(exposed.hq, '', []);
}

// ---- scenarios -----------------------------------------------------------------
const SCENARIOS = {
  // A fresh load renders, binds everything and logs nothing at error level.
  async boot(t) {
    await t.reload();
    if (!await t.waitFor(`!!(window.WHQ && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`, 15000)) return ['#app stayed empty for 15 s'];
    await t.sleep(1500);   // boot reads (store.start) and the first frames land
    const s = await t.evaluate(`(() => { const a = document.querySelector('#app');
      return { unresolved: [...WHQ.unresolved], failures: WHQ.failures ? WHQ.failures.count : -1, kids: a.childElementCount,
        text: a.textContent.replace(/\\s+/g, ' ').trim().length, panel: !!a.querySelector('[data-dc="error"]') }; })()`);
    const out = [];
    if (s.unresolved.length) out.push('unresolved bindings: ' + s.unresolved.join(', '));
    if (s.failures !== 0) out.push('runtime render failures: ' + s.failures);
    if (s.panel) out.push('the first-render error panel is showing');
    if (!s.text) out.push('#app has elements but no text');
    return out.concat(t.errors());
  },

  // dc-lite: a failing first render shows the static panel (text only, Reload),
  // the next good render replaces it and mounts; a later failure keeps the DOM.
  async 'error-panel'(t) {
    t.clearErrors();
    const r = await t.evaluate(`(async () => {
      const rt = await import(new URL('./src/dc/runtime.js', location.href).href);
      const tick = () => new Promise((res) => setTimeout(res, 40));
      const f0 = { ...rt.failures }, host = document.createElement('div');
      document.body.appendChild(host);
      let mode = 'throw', mounted = 0;
      class Probe extends rt.DCLogic {
        componentDidMount() { mounted++; }
        renderVals() { if (mode === 'throw') throw new Error('gate <b>boom</b>'); return { x: mode }; }
      }
      const m = rt.mount(host, Probe, '<p class="probe">{{ x }}</p>', {});
      const probe = () => { const p = host.querySelector('p.probe'); return p ? p.textContent : null; };
      const panel = () => !!host.querySelector('[data-dc="error"]');
      await tick();
      const first = { failures: rt.failures.count - f0.count, panel: panel(), text: host.textContent, markup: !!host.querySelector('b'), reload: (host.querySelector('button') || {}).textContent || null, mounted };
      mode = 'ok'; m.logic.forceUpdate(); await tick();
      const recovered = { probe: probe(), panel: panel(), mounted };
      mode = 'throw'; m.logic.forceUpdate(); await tick();
      const later = { failures: rt.failures.count - f0.count, probe: probe(), panel: panel() };
      m.unmount(); host.remove();
      Object.assign(rt.failures, f0);   // the probe's failures aren't the app's
      return { first, recovered, later };
    })()`);
    const out = [];
    const expect = (ok, what) => { if (!ok) out.push(what); };
    expect(r.first.failures === 1, 'first render: failures +' + r.first.failures + ', want +1');
    expect(r.first.panel, 'first render: no error panel');
    expect(r.first.text.includes('gate <b>boom</b>') && !r.first.markup, 'first render: message not shown as plain text');
    expect(r.first.reload === 'Reload', 'first render: no Reload button');
    expect(r.first.mounted === 0, 'first render: componentDidMount ran on a failed render');
    expect(r.recovered.probe === 'ok' && !r.recovered.panel, 'recovery: panel not replaced by the good render');
    expect(r.recovered.mounted === 1, 'recovery: componentDidMount ran ' + r.recovered.mounted + ' times, want 1');
    expect(r.later.failures === 2 && r.later.probe === 'ok' && !r.later.panel, 'later failure: last good DOM not kept');
    for (const e of t.errors()) if (!/\[dc\] renderVals failed/.test(e)) out.push(e);   // the two expected failures log
    return out;
  },

  // tools/fake-preload.js exposes exactly what dashboard/preload.js exposes (needs --preload=fake).
  async 'fake-parity'(t) {
    const want = preloadMethods();
    const s = await t.evaluate(`(() => { const out = []; const walk = (o, p) => { for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'function') out.push(p + k); else if (v && typeof v === 'object') walk(v, p + k + '.'); } };
      if (window.hq) walk(window.hq, ''); return { have: out, fake: !!window.hqFake }; })()`);
    if (!s.fake) return ['window.hqFake missing · start the harness with --preload=fake'];
    const out = [];
    const missing = want.filter((k) => !s.have.includes(k)), extra = s.have.filter((k) => !want.includes(k));
    if (missing.length) out.push('fake lacks: ' + missing.join(', '));
    if (extra.length) out.push('fake has extra: ' + extra.join(', '));
    return out;
  },

  // C-1: Enter on a focused button in the run confirm is that button's click and
  // nothing else — on Cancel it cancels, on an option it picks the option, on Run it
  // runs exactly once. Real key events (CDP Input), so the browser's own activation runs.
  async 'confirm-enter-on-cancel'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const casts = () => t.evaluate(`hqFake.calls('castSpell').length`);
    const open = async () => { const a = await t.evaluate(OPEN_CONFIRM); return a && await t.waitFor('!!' + CONFIRM, 5000) ? a : null; };

    if (!await open()) return ['no automation in data.js to open the run confirm with, or the dialog never showed'];
    let why = await t.evaluate(focusIn(CONFIRM, `/^Cancel/.test(x.textContent.trim())`));
    if (why) return ['Cancel: ' + why];
    await t.press('Enter');
    await t.sleep(300);
    if (await casts()) out.push('Enter on the focused Cancel ran the automation (castSpell called)');
    if (await t.evaluate('!!' + CONFIRM)) out.push('Enter on the focused Cancel did not close the dialog (the key never reached the button, so this proves nothing)');

    if (!await open()) return out.concat(['the dialog did not reopen']);
    why = await t.evaluate(focusIn(CONFIRM, `/Ask every time/.test(x.textContent)`));
    if (why) return out.concat(['option: ' + why]);
    await t.press('Enter');
    await t.sleep(300);
    if (await casts()) out.push('Enter on the focused “Ask every time” option ran the automation');
    if (!await t.evaluate('!!' + CONFIRM)) out.push('Enter on an option closed the dialog');

    why = await t.evaluate(focusIn(CONFIRM, `/Run/.test(x.textContent) && !/Ask|ask/.test(x.textContent)`));
    if (why) return out.concat(['Run: ' + why]);
    await t.press('Enter');
    if (!await t.waitFor(`hqFake.calls('castSpell').length > 0`, 3000)) out.push('Enter on the focused Run button did not run');
    await t.sleep(300);
    const n = await casts();
    if (n > 1) out.push('Enter on the focused Run button cast ' + n + ' times (the key handler ran it besides the click)');
    await t.evaluate(`WHQ.app.logic.setState({ confirm: null, confirmHash: null, confirmPreview: null, toasts: [] })`);
    return out.concat(t.errors());
  },

  // C-2 confirm: main's "confirm first" answer carries the hash to send back; the
  // dialog reopens with it, a held Enter doesn't confirm that reopened dialog, and the
  // next real Enter sends 'fake-hash-2' once — no endless "confirm again" loop.
  async 'confirm-hash'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const a = await t.evaluate(OPEN_CONFIRM);
    if (!a || !await t.waitFor('!!' + CONFIRM, 5000)) return ['no automation in data.js to open the run confirm with, or the dialog never showed'];
    const inDialog = `(() => { const d = ${CONFIRM}; return !!d && d.contains(document.activeElement); })()`;
    if (!await t.waitFor(inDialog, 2000)) out.push('the dialog did not take focus when it opened (Enter would go to the trigger)');
    await t.press('Enter');
    if (!await t.waitFor(`hqFake.calls('castSpell').length === 1 && WHQ.app.logic.state.confirmHash === 'fake-hash-2' && !!${CONFIRM}`, 5000)) {
      return out.concat(['after the first Enter: want one castSpell, then the dialog back with main’s hash; got ' + JSON.stringify(await t.evaluate(`({ calls: hqFake.calls('castSpell').length, hash: WHQ.app.logic.state.confirmHash, open: !!${CONFIRM} })`))]);
    }
    const c1 = await t.evaluate(`hqFake.calls('castSpell')[0].args`);
    if (c1[1] !== a.hash) out.push('the first confirm did not send data.js’s hash for the automation');
    if (!await t.waitFor(inDialog, 2000)) out.push('the reopened dialog did not take focus');
    await t.press('Enter', { repeat: true });   // the key still held from the first press
    await t.sleep(300);
    if (await t.evaluate(`hqFake.calls('castSpell').length`) !== 1) out.push('a held (auto-repeat) Enter confirmed the reopened dialog unseen');
    if (!await t.evaluate('!!' + CONFIRM)) out.push('a held Enter closed the reopened dialog');
    await t.press('Enter');
    if (!await t.waitFor(`hqFake.calls('castSpell').length >= 2`, 5000)) return out.concat(['the second Enter sent nothing']);
    await t.sleep(500);
    const s = await t.evaluate(`({ calls: hqFake.calls('castSpell').map((c) => c.args), open: !!${CONFIRM}, confirm: WHQ.app.logic.state.confirm,
      running: WHQ.app.logic.state.toasts.some((x) => x.kind === 'progress' && x.runSpell === ${JSON.stringify(a.id)}) })`);
    if (s.calls.length !== 2) out.push('castSpell called ' + s.calls.length + ' times, want 2 (the confirm loops)');
    if (s.calls[1] && s.calls[1][1] !== 'fake-hash-2') out.push('the second castSpell carried ' + (s.calls[1][1] === a.hash ? 'data.js’s hash again' : JSON.stringify(s.calls[1][1])) + ', want main’s "fake-hash-2"');
    if (s.calls[1] && s.calls[1][0] !== a.id) out.push('the second castSpell was for another automation');
    if (s.open || s.confirm) out.push('the dialog is still open after main accepted the run');
    if (!s.running) out.push('no "Running" toast after main accepted the run');
    await t.evaluate(`WHQ.app.logic.setState({ toasts: [] })`);
    return out.concat(t.errors());
  },

  // C1: main's preview flags sub/.env (not .env.example) → the dialog names it, Commit
  // is disabled, the copy says what Commit does, and hq.doCommit is never called.
  async 'commit-env'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const pid = await t.evaluate(`(() => { const p = WHQ.app.logic.projectsAt(0).find((x) => x.hasGit); return p ? p.id : null; })()`);
    if (!pid) return ['no git project in data.js to open the commit dialog for'];
    await t.evaluate(`(async () => { const L = WHQ.app.logic; await L.openCommit(${JSON.stringify(pid)});
      L.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: 'chore: placeholder message' }) })); return true; })()`);
    if (!await t.waitFor(`!!${COMMIT} && !${COMMIT}.textContent.includes('Reading git status')`, 5000)) return ['the commit dialog never showed the preview'];
    const s = await t.evaluate(`(() => { const d = ${COMMIT}, btns = [...d.querySelectorAll('button')];
      const row = (name) => { const b = btns.find((x) => [...x.querySelectorAll('span')].some((sp) => sp.textContent.trim() === name)); return b ? b.textContent : null; };
      const commit = btns.find((x) => /^✓/.test(x.textContent.trim()));
      const alert = d.querySelector('[role="alert"]');
      return { alert: alert ? alert.textContent : '', disabled: !!commit && commit.disabled, label: commit ? commit.textContent.trim() : '',
        copy: d.textContent.includes('Commits every changed file (git add -A). Refused if a .env file is in the set.'),
        env: row('sub/.env'), example: row('.env.example'), plain: row('src/a.js'),
        preview: hqFake.calls('commitPreview').length, draft: hqFake.calls('draftCommit').length }; })()`);
    if (!s.alert.includes('A .env file is in this change set') || !s.alert.includes('sub/.env')) out.push('no alert naming sub/.env: ' + JSON.stringify(s.alert));
    if (!s.disabled) out.push('Commit is enabled with an .env file in the change set');
    if (!s.copy) out.push('the honest "git add -A … Refused if a .env file" copy is missing');
    if (s.label !== '✓ Commit 3 files') out.push('Commit label ' + JSON.stringify(s.label) + ', want the preview’s count "✓ Commit 3 files"');
    if (s.env == null || !s.env.includes('may hold secrets')) out.push('the sub/.env row is not flagged');
    if (s.example == null || s.example.includes('may hold secrets')) out.push('.env.example is missing or flagged (main’s env flag is the only source)');
    if (s.plain == null || s.plain.includes('may hold secrets')) out.push('src/a.js is missing or flagged');
    if (s.preview !== 1) out.push('commitPreview called ' + s.preview + ' times, want 1');
    if (s.draft) out.push('a draft was requested for a commit that can’t happen (may use Claude quota)');
    // the disabled button, and the action itself, must still not reach main
    await t.evaluate(`(async () => { const d = ${COMMIT}; const b = [...d.querySelectorAll('button')].find((x) => /^✓/.test(x.textContent.trim())); if (b) b.click(); await WHQ.app.logic.doCommit(); return true; })()`);
    await t.sleep(200);
    const n = await t.evaluate(`hqFake.calls('doCommit').length`);
    if (n) out.push('hq.doCommit was called ' + n + ' time(s) with an .env file in the change set');
    if (!await t.evaluate('!!' + COMMIT)) out.push('the dialog closed (it should stay, blocked)');
    await t.evaluate(`WHQ.app.logic.setState({ commit: null, toasts: [] })`);
    return out.concat(t.errors());
  },

  // C3: the fake model streams 'Fake' → 'Fake answer' → 'Fake answer from the fake model.'
  // (100 ms apart, accumulated) and resolves with the last. Each delta must show at once
  // (stream on, not typed behind), and the settled answer must continue what is shown —
  // never blank or cut back and retype it.
  async 'ask-stream'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await t.evaluate(`(() => { WHQ.app.logic.setState({ reduceMotion: false }); return true; })()`);
      await t.sleep(80);
      if (await t.evaluate(`document.documentElement.dataset.hqReduce === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches`)) return ['reduced motion is on: hq-type renders instantly either way, so this proves nothing'];
      await t.evaluate(`(() => {
        const L = WHQ.app.logic, q = 'Placeholder question for the stream gate', t0 = performance.now(), samples = [], deltas = [];
        const now = () => Math.round(performance.now() - t0);
        window.__ask = { samples, deltas };
        window.__ask.off = hq.llm.onDelta((d) => deltas.push({ t: now(), text: d.text }));
        window.__ask.iv = setInterval(() => {
          const aside = document.querySelector('aside[aria-label="Ask"]'), all = aside ? aside.querySelectorAll('hq-type') : [], el = all[all.length - 1];
          const h = L.state.askHistory[L.state.askHistory.length - 1], status = h && h.q === q ? h.a.status : null;
          const span = el && el.shadowRoot ? el.shadowRoot.querySelector('span') : null;
          const cur = { t: now(), shown: span ? span.textContent : null, stream: el ? el.getAttribute('stream') : null, status };
          const last = samples[samples.length - 1];
          if (!last || last.shown !== cur.shown || last.stream !== cur.stream || last.status !== cur.status) samples.push(cur);
        }, 4);
        L.submitAsk(q);
        return true; })()`);
      if (!await t.waitFor(`(() => { const h = WHQ.app.logic.state.askHistory; return h.length && h[h.length - 1].a.status === 'done'; })()`, 5000)) out.push('the answer never settled');
      await t.sleep(500);   // a retype at the end would show here
      const r = await t.evaluate(`(() => { const a = window.__ask; clearInterval(a.iv); a.off(); return { samples: a.samples, deltas: a.deltas }; })()`);
      const FINAL = 'Fake answer from the fake model.';
      if (r.deltas.map((d) => d.text).join('|') !== ['Fake', 'Fake answer', FINAL].join('|')) return out.concat(['unexpected fake deltas: ' + JSON.stringify(r.deltas.map((d) => d.text))]);
      // each partial is on screen, streaming, while the answer is still in progress, within a few ms of arriving
      for (const d of r.deltas.slice(0, 2)) {
        const s = r.samples.find((x) => x.t >= d.t - 1 && x.shown === d.text);
        if (!s) { out.push('"' + d.text + '" never showed on its own (the partial answer was not visible before the final)'); continue; }
        if (s.status !== 'thinking' || s.stream !== 'true') out.push('"' + d.text + '" showed with status ' + s.status + ' / stream=' + s.stream + ', want thinking / true');
        if (s.t - d.t > 35) out.push('"' + d.text + '" took ' + (s.t - d.t) + ' ms to show (typed out behind the stream?)');
      }
      // once text is on screen, every later sample continues it
      const shown = r.samples.filter((x) => x.shown != null && x.shown !== '' && x.shown !== '…');
      for (let i = 1; i < shown.length; i++) {
        if (!shown[i].shown.startsWith(shown[i - 1].shown)) { out.push('the answer was cut back or retyped: "' + shown[i - 1].shown + '" → "' + shown[i].shown + '" at ' + shown[i].t + ' ms'); break; }
      }
      const end = r.samples[r.samples.length - 1] || {};
      if (end.shown !== FINAL || end.status !== 'done' || end.stream !== 'false') out.push('settled on ' + JSON.stringify(end) + ', want the final answer, done, stream="false"');
      const fin = r.samples.find((x) => x.shown === FINAL);
      if (fin && fin.t - r.deltas[2].t > 35) out.push('the final text took ' + (fin.t - r.deltas[2].t) + ' ms to show');
    } finally {
      await t.send('Emulation.setEmulatedMedia', { features: [] });
      await t.evaluate(`(() => { const a = window.__ask; if (a) { clearInterval(a.iv); try { a.off(); } catch {} } WHQ.app.logic.setState({ askOpen: false }); return true; })()`).catch(() => {});
    }
    return out.concat(t.errors());
  },

  // C2 scan: a failed scan shows in Activity with its exit code (and toasts once when this
  // window watched it run), and still shows after a reload — rebuilt from hq.liveState,
  // without toasting again.
  async 'scan-failed'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const t0 = Date.now(), started = new Date(t0 - 180000).toISOString(), ended = new Date(t0 - 60000).toISOString();
    try {
      await t.evaluate(`hqFake.emit('hq:scan-status', { state: 'running', startedAt: ${JSON.stringify(started)} })`);
      if (!await t.waitFor(`WHQ.app.logic.scanStatus().running`, 3000)) out.push('a running scan push did not reach the app');
      await t.evaluate(`hqFake.emit('hq:scan-status', { state: 'failed', startedAt: ${JSON.stringify(started)}, endedAt: ${JSON.stringify(ended)}, code: 1, error: 'placeholder failure' })`);
      if (!await t.waitFor(`WHQ.app.logic.state.toasts.some((x) => x.kind === 'error' && x.text.includes('Last scan failed (exit 1)'))`, 3000)) out.push('no failure toast for a scan this window watched');
      if (await t.evaluate(`WHQ.app.logic.state.toasts.some((x) => x.scan)`)) out.push('the scan’s progress toast stayed after it failed');
      const check = async (when) => {
        await t.evaluate(`WHQ.app.logic.setState({ runsOpen: true, actTab: 'runs' })`);
        if (!await t.waitFor('!!' + ACTIVITY, 3000)) { out.push(when + ': Activity did not open'); return; }
        const card = await t.evaluate(activityCard('Full scan'));
        if (!card) out.push(when + ': no "Full scan" row in Activity');
        else {
          if (!/Failed/.test(card)) out.push(when + ': the scan row does not say Failed: ' + JSON.stringify(card));
          if (!/exit 1/.test(card)) out.push(when + ': the scan row has no exit code: ' + JSON.stringify(card));
        }
        const header = await t.evaluate(`document.querySelector('#app').textContent.includes('Last scan failed (exit 1)')`);
        if (!header) out.push(when + ': the header does not say "Last scan failed (exit 1)"');
        await t.evaluate(`WHQ.app.logic.setState({ runsOpen: false })`);
      };
      await check('pushed');
      // after a reload main's liveState is all there is (it keeps the code, not the error text)
      await t.evaluate(`hqFake.set('liveState', { dev: [], casts: [], scan: { state: 'failed', startedAt: ${JSON.stringify(started)}, endedAt: ${JSON.stringify(ended)}, code: 1 } }, { persist: true })`);
      if (!await reloadReady(t)) return out.concat(['the page did not come back after the reload']);
      if (!await t.waitFor(`WHQ.app.logic.scanStatus().failed`, 3000)) out.push('after a reload: the failed scan was not hydrated from liveState');
      await check('after a reload');
      if (await t.evaluate(`WHQ.app.logic.state.toasts.some((x) => /scan/i.test(x.text) && x.kind === 'error')`)) out.push('after a reload: the old failure was toasted again');
      out.push(...t.errors());
    } finally {
      await t.evaluate(`hqFake.reset(true)`).catch(() => {});
      await reloadReady(t).catch(() => {});
    }
    return out;
  },

  // F7/C2: a reloaded window rebuilds Activity from hq.liveState — a dev server
  // (with its start time) and a cast whose name comes from main, not the spellbook.
  async 'live-hydrate'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const p = await t.evaluate(`(() => { const L = WHQ.app.logic, p = L.projectsAt(0)[0]; return p ? { id: p.id, name: L.pname(p.id) } : null; })()`);
    if (!p) return ['no project in data.js to hydrate a dev server for'];
    const since = new Date(Date.now() - 25 * 60000), castAt = new Date(Date.now() - 2 * 60000);
    try {
      await t.evaluate(`hqFake.set('liveState', { dev: [{ id: ${JSON.stringify(p.id)}, since: ${JSON.stringify(since.toISOString())} }],
        casts: [{ castId: 'c-hydrate', spellId: 'placeholder:hydrate', name: 'Placeholder hydrated cast', icon: '▶', startedAt: ${JSON.stringify(castAt.toISOString())}, chain: false }],
        scan: { state: 'idle', startedAt: null, endedAt: null, code: null } }, { persist: true })`);
      if (!await reloadReady(t)) return ['the page did not come back after the reload'];
      if (!await t.waitFor(`(() => { const L = WHQ.app.logic.LIVE; return !!L.dev[${JSON.stringify(p.id)}] && !!L.casts['c-hydrate']; })()`, 3000)) out.push('the store did not hydrate the dev server and the cast from liveState');
      const hhmm = await t.evaluate(`(() => { const d = new Date(${since.getTime()}); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })()`);
      await t.evaluate(`WHQ.app.logic.setState({ runsOpen: true, actTab: 'runs' })`);
      if (!await t.waitFor('!!' + ACTIVITY, 3000)) return out.concat(['Activity did not open']);
      const dev = await t.evaluate(activityCard('Dev server · ' + p.name));
      if (!dev) out.push('no dev server row for the hydrated project');
      else {
        if (!dev.includes('running since ' + hhmm)) out.push('the dev row does not say "running since ' + hhmm + '" (main’s start time)');
        if (!dev.includes('■ Stop')) out.push('the hydrated dev row has no Stop button');
      }
      const cast = await t.evaluate(activityCard('Placeholder hydrated cast'));
      if (!cast) out.push('no row for the hydrated cast (named by main, not in the spellbook)');
      else if (!/Running/.test(cast)) out.push('the hydrated cast row is not Running: ' + JSON.stringify(cast));
      await t.evaluate(`WHQ.app.logic.setState({ runsOpen: false })`);
      out.push(...t.errors());
    } finally {
      await t.evaluate(`hqFake.reset(true)`).catch(() => {});
      await reloadReady(t).catch(() => {});
    }
    return out;
  },
  // ---- Phase 3 (v3 parity) ----------------------------------------------------------
  // P1: Stop keeps the partial answer main sends back (the fake now answers a cancel like
  // main: {status:'cancelled', output:<what streamed>}); a stopped pair is never sent back
  // to the model (v3's rule); Retry replaces the stopped pair and asks again; the chat in
  // localStorage stays in v3's format throughout. Ask's keys are put back afterwards.
  async 'ask-stop-retry'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const ASIDE = `document.querySelector('aside[aria-label="Ask"]')`;
    const btn = (label) => `[...(${ASIDE} || document.createElement('i')).querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
    const hist = `WHQ.app.logic.state.askHistory`;
    const saved = await t.evaluate(SNAP_KEYS(ASK_KEYS));
    try {
      await t.evaluate(`(() => { localStorage.removeItem('hq-oracle-chat'); localStorage.removeItem('hq-oracle-include'); const L = WHQ.app.logic; L._askDay = null; L._askStop = null;
        L.setState({ askHistory: [], askInclude: undefined, askDraft: '', askOpen: true }); return true; })()`);
      if (!await t.waitFor('!!' + ASIDE, 3000)) return ['the Ask panel did not open'];
      if (!await t.evaluate(`!!(WHQ.app.logic.LIVE.llm && WHQ.app.logic.LIVE.llm.chatModel)`)) return ['the fake model probe did not land (LIVE.llm has no chat model)'];
      // 1. a finished pair
      await t.evaluate(`WHQ.app.logic.submitAsk('Placeholder question one')`);
      if (!await t.waitFor(`${hist}.length === 1 && ${hist}[0].a.status === 'done'`, 5000)) return ['the first question never finished'];
      // 2. stop the second one after the first delta
      await t.evaluate(`(() => { WHQ.app.logic.submitAsk('Placeholder question two'); return true; })()`);
      if (!await t.waitFor(`${hist}.length === 2 && ${hist}[1].a.text === 'Fake'`, 3000)) return out.concat(['the second answer never streamed its first part']);
      if (!await t.evaluate(`!!${btn('Stop')}`)) out.push('the Ask button does not read Stop while an answer streams');
      // one answer at a time: a third question now is refused, not sent
      await t.evaluate(`WHQ.app.logic.submitAsk('Placeholder question while busy')`);
      if (await t.evaluate(`hqFake.calls('llm.chat').length`) !== 2) out.push('a question asked while one streams was sent anyway');
      // Since 8be7801 a click within STOP_GRACE_MS (500 ms) of sending is the same press that sent
      // it and is ignored (logic/ask.js askButton; ask.test.mjs covers the grace itself). The fake's
      // whole stream is ~300 ms, so step past the grace the way ask.test.mjs ticks its clock —
      // without this the click was swallowed and the scenario failed from 8be7801 on (review 2026-10-07).
      await t.evaluate(`(() => { WHQ.app.logic._askSentAt = Date.now() - 10000; return true; })()`);
      await t.evaluate(`${btn('Stop')}.click()`);
      if (!await t.waitFor(`${hist}[1].a.status === 'cancelled'`, 3000)) return out.concat(['Stop did not settle the answer as cancelled']);
      await t.sleep(150);
      const s = await t.evaluate(`(() => { const h = ${hist}[1], job = h.id, c = hqFake.calls('llm.cancel');
        const chat = JSON.parse(localStorage.getItem('hq-oracle-chat') || 'null');
        const spans = [...${ASIDE}.querySelectorAll('span')].map((x) => x.textContent.trim());
        return { text: h.a.text, cancels: c.map((x) => x.args[0]), job, chat, meta: spans.find((x) => x.startsWith('stopped')) || '', retry: !!${btn('Retry')}, ask: !!${btn('Ask')} }; })()`);
      if (s.text !== 'Fake') out.push('the partial answer was not kept (got ' + JSON.stringify(s.text) + ', want main’s "Fake")');
      if (s.cancels.length !== 1 || s.cancels[0] !== s.job) out.push('hq.llm.cancel was called ' + s.cancels.length + ' time(s), want once with the job id');
      if (!/^stopped · grounded in Scan/.test(s.meta)) out.push('the meta line does not say "stopped · grounded in …": ' + JSON.stringify(s.meta));
      if (!s.retry) out.push('no Retry on the stopped answer');
      if (!s.ask) out.push('the button did not go back to Ask');
      const m = s.chat && s.chat.messages;
      if (!s.chat || !/^\d{4}-\d{2}-\d{2}$/.test(s.chat.day) || !Array.isArray(m) || m.length !== 4) out.push('hq-oracle-chat is not one v3 day with 4 messages: ' + JSON.stringify(s.chat && { day: s.chat.day, n: m && m.length }));
      else {
        if (JSON.stringify(Object.keys(s.chat)) !== '["day","messages"]') out.push('hq-oracle-chat has keys other than day / messages');
        if (m[0].role !== 'user' || 'meta' in m[0]) out.push('a stored question carries a meta (v3 writes none)');
        if (m[3].content !== 'Fake' || !m[3].meta || m[3].meta.status !== 'cancelled') out.push('the stored stopped answer is not {content:"Fake", meta.status:"cancelled"}');
      }
      // 3. a new question: the stopped pair stays out of what the model sees
      await t.evaluate(`WHQ.app.logic.submitAsk('Placeholder question three')`);
      if (!await t.waitFor(`${hist}.length === 3 && ${hist}[2].a.status === 'done'`, 5000)) return out.concat(['the third question never finished']);
      const sent3 = await t.evaluate(`hqFake.calls('llm.chat').at(-1).args[0].messages.map((x) => x.role + ':' + x.content)`);
      const want3 = ['user:Placeholder question one', 'assistant:Fake answer from the fake model.', 'user:Placeholder question three'];
      if (JSON.stringify(sent3) !== JSON.stringify(want3)) out.push('the model got ' + JSON.stringify(sent3) + ', want only the finished pair + the new question');
      const inc = await t.evaluate(`hqFake.calls('llm.chat').at(-1).args[0].include`);
      if (JSON.stringify(inc) !== '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false,"claude":false}') out.push('include sent: ' + JSON.stringify(inc) + ', want v3’s defaults');
      // 4. Retry on the stopped answer: that pair goes, the question is asked again at the end
      await t.evaluate(`${btn('Retry')}.click()`);
      if (!await t.waitFor(`${hist}.length === 3 && ${hist}[2].q === 'Placeholder question two' && ${hist}[2].a.status === 'done'`, 5000)) out.push('Retry did not re-ask the stopped question: ' + JSON.stringify(await t.evaluate(`${hist}.map((h) => h.q + '=' + h.a.status)`)));
      const sentR = await t.evaluate(`hqFake.calls('llm.chat').at(-1).args[0].messages.map((x) => x.role)`);
      if (sentR.join(',') !== 'user,assistant,user,assistant,user') out.push('the retried question was sent with ' + JSON.stringify(sentR));
      const stored = await t.evaluate(`JSON.parse(localStorage.getItem('hq-oracle-chat')).messages.map((x) => x.role + (x.meta ? ':' + (x.meta.status || (x.meta.pending ? 'pending' : '?')) : ''))`);
      if (stored.join(',') !== 'user,assistant:done,user,assistant:done,user,assistant:done') out.push('stored chat after Retry: ' + JSON.stringify(stored));
      // 5. New chat: empties today's chat (stored too) and puts the caret in the box
      await t.evaluate(`${btn('New chat')}.click()`);
      await t.sleep(100);
      const n = await t.evaluate(`({ h: ${hist}.length, chat: JSON.parse(localStorage.getItem('hq-oracle-chat')).messages.length, focus: document.activeElement === ${ASIDE}.querySelector('input'), off: ${btn('New chat')}.disabled })`);
      if (n.h || n.chat) out.push('New chat left ' + n.h + ' entries / ' + n.chat + ' stored messages');
      if (!n.focus) out.push('New chat did not focus the input');
      if (!n.off) out.push('New chat is not disabled on an empty chat');
      out.push(...t.errors());
    } finally {
      await t.evaluate(`(() => { ${RESTORE_KEYS(saved)} const L = WHQ.app.logic; L._askDay = null; L.setState(Object.assign({ askOpen: false }, L.askInitState())); return true; })()`).catch(() => {});
    }
    return out;
  },

  // P1: a chat v3 wrote loads as it is and is written back byte for byte (pending →
  // "interrupted", malformed messages dropped, exactly like v3's loadChat); the sources
  // in hq-oracle-include follow v3's rule (a non-boolean falls back to its default); a
  // chat from another day starts empty. Ask's keys are put back afterwards.
  async 'ask-history-v3-compat'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const saved = await t.evaluate(SNAP_KEYS(ASK_KEYS));
    try {
      const fixture = await t.evaluate(`(() => {
        const day = new Date().toLocaleDateString('en-CA');
        const sec = [{ id: 'scan', label: 'Scan', chars: 1200, clipped: false }, { id: 'tasks', label: 'Tasks', chars: 4000, clipped: true }, { id: 'vault', label: 'Vault', chars: 0, clipped: false, note: 'no matching notes' }];
        const messages = [
          { role: 'user', content: 'Placeholder v3 question one' },
          { role: 'assistant', content: 'Placeholder v3 answer one.', meta: { status: 'done', sections: sec, ms: 1400, model: 'placeholder-model' } },
          { role: 'system', content: 'dropped: not a user or assistant message' },
          { role: 'user', content: 5 },
          { role: 'user', content: 'Placeholder v3 question two' },
          { role: 'assistant', content: '', meta: { pending: true } },
          { role: 'user', content: 'Placeholder v3 question three' },
          { role: 'assistant', content: 'A partial v3 answer', meta: { status: 'cancelled', sections: sec, ms: 800, model: 'placeholder-model' } },
        ];
        // what v3 itself writes back after loading this (view.js loadChat + saveChat)
        const v3 = { day, messages: messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => (m.meta && m.meta.pending ? { ...m, meta: { status: 'error', reason: 'interrupted — the window reloaded' } } : m))
          .map(({ role, content, meta }) => ({ role, content, meta })) };
        localStorage.setItem('hq-oracle-chat', JSON.stringify({ day, messages }));
        localStorage.setItem('hq-oracle-include', JSON.stringify({ scan: false, tasks: true, projects: true, health: true, browser: 'yes', vault: false }));
        return { want: JSON.stringify(v3) };
      })()`);
      if (!await reloadReady(t)) return ['the page did not come back after the reload'];
      const s = await t.evaluate(`(() => { const L = WHQ.app.logic, h = L.state.askHistory;
        return { h: h.map((x) => ({ q: x.q, status: x.a.status, text: x.a.text, reason: x.a.meta && x.a.meta.reason })), inc: L.state.askInclude }; })()`);
      const st = s.h.map((x) => x.status).join(',');
      if (st !== 'done,error,cancelled') out.push('loaded statuses ' + JSON.stringify(st) + ', want done,error,cancelled');
      if (s.h[1] && s.h[1].reason !== 'interrupted — the window reloaded') out.push('a pending answer did not load as "interrupted — the window reloaded"');
      if (s.h[2] && s.h[2].text !== 'A partial v3 answer') out.push('the stopped v3 answer lost its partial text');
      if (JSON.stringify(s.inc) !== '{"scan":false,"tasks":true,"projects":true,"health":true,"browser":false,"vault":false,"claude":false}') out.push('sources loaded as ' + JSON.stringify(s.inc));
      // the panel shows them the way v3 does
      await t.evaluate(`WHQ.app.logic.setState({ askOpen: true })`);
      await t.sleep(150);
      const ui = await t.evaluate(`(() => { const a = document.querySelector('aside[aria-label="Ask"]'); if (!a) return null;
        return { chips: [...a.querySelectorAll('[aria-label="Context sources"] button')].map((b) => b.getAttribute('aria-pressed')).join(','),
          spans: [...a.querySelectorAll('span')].map((x) => x.textContent.trim()) }; })()`);
      if (!ui) out.push('the Ask panel did not open');
      else {
        if (ui.chips !== 'false,true,true,true,false,false,false') out.push('chip aria-pressed ' + ui.chips + ', want false,true,true,true,false,false,false');   // 7 chips (the Instagram & Facebook chip went with the Social tab, 2026-10-28)
        if (!ui.spans.includes('grounded in Scan · Tasks (trimmed) · Vault: no matching notes · 1.4s')) out.push('no v3 meta line "grounded in Scan · Tasks (trimmed) · Vault: no matching notes · 1.4s"');
        if (!ui.spans.includes('error — interrupted — the window reloaded')) out.push('no "error — interrupted — the window reloaded" meta line');
        if (!ui.spans.some((x) => x.startsWith('stopped · grounded in'))) out.push('no "stopped · …" meta line');
      }
      // a save with nothing changed writes back exactly what v3 would
      const got = await t.evaluate(`(() => { WHQ.app.logic.saveAsk(); return localStorage.getItem('hq-oracle-chat'); })()`);
      if (got !== fixture.want) out.push('round trip is not byte-identical to v3’s own write:\n    got  ' + got.slice(0, 300) + '\n    want ' + fixture.want.slice(0, 300));
      // toggling a chip writes v3's include format (all six booleans, v3's key order)
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.toggleAskSource('vault'); L.toggleAskSource('vault'); return true; })()`);
      const inc = await t.evaluate(`localStorage.getItem('hq-oracle-include')`);
      if (inc !== '{"scan":false,"tasks":true,"projects":true,"health":true,"browser":false,"vault":false}') out.push('hq-oracle-include written as ' + inc);
      // a chat from another day starts empty
      await t.evaluate(`(() => { localStorage.setItem('hq-oracle-chat', JSON.stringify({ day: '2001-01-01', messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'old', meta: { status: 'done' } }] })); return true; })()`);
      if (!await reloadReady(t)) return out.concat(['the page did not come back after the second reload']);
      if (await t.evaluate(`WHQ.app.logic.state.askHistory.length`) !== 0) out.push('a chat stored for another day was loaded');
      out.push(...t.errors());
    } finally {
      await t.evaluate(`(() => { ${RESTORE_KEYS(saved)} return true; })()`).catch(() => {});
      await reloadReady(t).catch(() => {});
    }
    return out;
  },

  // P2: Re-examine runs hq.healthScan() (no reload), shows "Scanning…" while it runs,
  // refreshes the verdict from the fresh report, clears the fixed set; {error}, null and a
  // throw each say why and leave the report alone. The baked report is put back.
  async 'system-reexamine'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const BTN = `[...document.querySelectorAll('button')].find((b) => /^(Re-examine|Scanning…)$/.test(b.textContent.trim()))`;
    const hasText = (s) => `document.querySelector('#app').textContent.includes(${JSON.stringify(s)})`;
    const toast = (s) => `WHQ.app.logic.state.toasts.some((x) => x.text === ${JSON.stringify(s)})`;
    try {
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.go('system', 'machine'); L.setState({ fixed: ['organ-gate-fixed'] }); return true; })()`);
      if (!await t.waitFor('!!' + BTN, 3000)) return ['no Re-examine button on System › Machine'];
      if (!await t.evaluate(`!!(WHQ.app.logic.LIVE.llm && WHQ.app.logic.LIVE.llm.chatModel)`)) return ['the fake model probe did not land (the verdict would count the model too)'];
      // a slow scan answering one ember organ
      await t.evaluate(`hqFake.set('healthScan', () => new Promise((res) => setTimeout(() => res({ scanned_at: new Date().toISOString(), host: { cpu: 'placeholder cpu' },
        organs: [{ id: 'gate', label: 'Gate organ', value: 97, unit: '%', status: 'ember', spark: [], diagnosis: 'Placeholder diagnosis', teaching: '', fixes: [] }] }), 400)))`);
      await t.evaluate(`${BTN}.click()`);
      await t.sleep(120);
      const mid = await t.evaluate(`(() => { const b = ${BTN}; return { label: b.textContent.trim(), off: b.disabled }; })()`);
      if (mid.label !== 'Scanning…' || !mid.off) out.push('while the scan runs the button reads ' + JSON.stringify(mid.label) + (mid.off ? '' : ' and is enabled'));
      if (!await t.waitFor(toast('Re-examined · 1 issue to look at'), 4000)) out.push('no "Re-examined · 1 issue to look at" toast');
      const s = await t.evaluate(`({ verdict: ${hasText('1 issue to look at')}, sub: ${hasText('Re-examined ')}, organ: ${hasText('Placeholder diagnosis')}, fixed: WHQ.app.logic.state.fixed, label: ${BTN}.textContent.trim(), calls: hqFake.calls('healthScan').length })`);
      if (!s.verdict) out.push('the verdict does not say "1 issue to look at"');
      if (!s.sub) out.push('the subtitle does not say "Re-examined …"');
      if (!s.organ) out.push('the fresh report’s issue is not listed');
      if (s.fixed.length) out.push('Re-examine did not clear the fixed set: ' + JSON.stringify(s.fixed));
      if (s.label !== 'Re-examine') out.push('the button did not come back');
      if (s.calls !== 1) out.push('healthScan called ' + s.calls + ' times');
      // failures: the reason, and the fresh report stays
      for (const [val, want] of [[`{ error: 'placeholder failure' }`, 'Re-examine failed · placeholder failure'], ['null', 'Re-examine failed · the scan returned no report'], [`{ __reject: 'placeholder throw' }`, 'Re-examine failed · placeholder throw']]) {
        await t.evaluate(`(() => { WHQ.app.logic.setState({ toasts: [] }); hqFake.set('healthScan', ${val}); return true; })()`);
        await t.evaluate(`${BTN}.click()`);
        if (!await t.waitFor(toast(want), 3000)) out.push('no "' + want + '" toast');
        if (!await t.evaluate(hasText('1 issue to look at'))) out.push('a failed Re-examine (' + want + ') dropped the last report');
      }
      out.push(...t.errors());
    } finally {
      await t.evaluate(`(() => { WHQ.store.refreshMachine(null); hqFake.reset(true); WHQ.app.logic.setState({ fixed: [], toasts: [] }); return true; })()`).catch(() => {});
    }
    return out;
  },

  // P6: kind / source / category chips with honest counts, Clear filters, Show more; an
  // interactive item goes through the same confirm ("Opens a terminal", quota when it
  // starts claude) and a {channeled} answer says so; Rescan toasts BEFORE the call (main
  // reloads on success) and an {error} brings the button back. Names never printed.
  async 'automations-filters'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const chip = (re) => `[...document.querySelectorAll('button[aria-pressed]')].find((b) => ${re}.test(b.textContent.trim()))`;
    const count = `(() => { const s = [...document.querySelectorAll('#app span')].map((x) => x.textContent.trim()).find((x) => /^\\d+ of \\d+/.test(x)); return s || ''; })()`;
    const RESCAN = `[...document.querySelectorAll('button')].find((b) => /^(↻ Rescan|Rescanning…)$/.test(b.textContent.trim()))`;
    try {
      const M = await t.evaluate(`(() => { const M = WHQ.app.logic.M; return { autos: M.AUTOS.length, inter: (M.INTERACTIVE || []).length }; })()`);
      if (!M.inter) return ['no interactive (channeled) item in data.js to filter for'];
      await t.evaluate(`(() => { WHQ.app.logic.go('automations', 'runnable'); return true; })()`);
      await t.sleep(300);
      const total = M.autos + M.inter;
      const c0 = await t.evaluate(count);
      if (!c0.startsWith(total + ' of ' + total)) out.push('unfiltered count ' + JSON.stringify(c0) + ', want "' + total + ' of ' + total + '…"');
      if (total > 40 && !c0.endsWith('· showing 40')) out.push('the capped list does not say "· showing 40"');
      await t.evaluate(`${chip('/^Interactive · /')}.click()`);
      await t.sleep(150);
      const c1 = await t.evaluate(`({ count: ${count}, on: ${chip('/^Interactive · /')}.getAttribute('aria-pressed'), clear: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Clear filters'),
        rows: WHQ.app.logic.renderVals().autos.map((a) => a.mode) })`);
      if (!c1.count.startsWith(M.inter + ' of ' + total)) out.push('Interactive count ' + JSON.stringify(c1.count) + ', want "' + M.inter + ' of ' + total + '"');
      if (c1.on !== 'true') out.push('the Interactive chip is not aria-pressed');
      if (!c1.clear) out.push('no Clear filters with a filter on');
      if (c1.rows.some((m) => m !== 'Terminal')) out.push('a non-terminal row passed the Interactive filter');
      // a source chip narrows further and its count is what it shows
      const src = await t.evaluate(`(() => { const vals = WHQ.app.logic.renderVals(); const c = vals.libSources.find((x) => !/^All · /.test(x.label)); if (!c) return null; c.go(); return c.label; })()`);
      await t.sleep(150);
      if (src) {
        const n = Number(src.split(' · ').pop());
        const c2 = await t.evaluate(count);
        if (!c2.startsWith(n + ' of ' + total)) out.push('a source chip promised ' + n + ' rows but the count says ' + JSON.stringify(c2));
      }
      await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear filters').click()`);
      await t.sleep(150);
      const c3 = await t.evaluate(`({ count: ${count}, state: (({ libKind, libSource, libSchool, autoQuery }) => ({ libKind, libSource, libSchool, autoQuery }))(WHQ.app.logic.state) })`);
      if (!c3.count.startsWith(total + ' of ' + total)) out.push('Clear filters did not bring every row back: ' + JSON.stringify(c3.count));
      if (JSON.stringify(c3.state) !== '{"libKind":"all","libSource":"all","libSchool":"all","autoQuery":""}') out.push('Clear filters left ' + JSON.stringify(c3.state));
      if (total > 40) {
        await t.evaluate(`[...document.querySelectorAll('button')].find((b) => /^Show \\d+ more$/.test(b.textContent.trim())).click()`);
        await t.sleep(150);
        const rows = await t.evaluate(`WHQ.app.logic.renderVals().autos.length`);
        if (rows !== Math.min(total, 160)) out.push('Show more shows ' + rows + ' rows, want ' + Math.min(total, 160));
      }
      // the confirm for an interactive item
      const ia = await t.evaluate(`(() => { const L = WHQ.app.logic, a = L.M.INTERACTIVE[0]; L.setState({ trusted: [] }); L.askRun(a); return { id: a.id, claude: /^claude(\\s|$)/i.test(a.cmd) }; })()`);
      if (!await t.waitFor('!!' + CONFIRM, 3000)) return out.concat(['the run confirm did not open for an interactive item']);
      const d = await t.evaluate(`${CONFIRM}.textContent`);
      if (!d.includes('Opens a terminal · output stays there')) out.push('the confirm does not say "Opens a terminal · output stays there"');
      if (ia.claude !== d.includes('Uses Claude quota')) out.push(ia.claude ? 'a Claude skill/command confirm does not say "Uses Claude quota"' : 'a non-Claude item claims Claude quota');
      await t.evaluate(`hqFake.set('castSpell', { channeled: true })`);
      await t.evaluate(`[...${CONFIRM}.querySelectorAll('button')].find((b) => b.textContent.trim() === '▶ Run · Enter').click()`);
      if (!await t.waitFor(`WHQ.app.logic.state.toasts.some((x) => x.text === 'Opened in a terminal — output stays there')`, 3000)) out.push('no "Opened in a terminal — output stays there" toast');
      const cast = await t.evaluate(`hqFake.calls('castSpell').map((c) => c.args[0])`);
      if (cast.length !== 1 || cast[0] !== ia.id) out.push('castSpell was called ' + cast.length + ' time(s) / for another item');
      // Rescan: the toast is up before main is called; an error brings the button back
      await t.evaluate(`(() => { WHQ.app.logic.setState({ toasts: [] }); hqFake.set('rescanSpellbook', () => { window.__rescanToasts = WHQ.app.logic.state.toasts.map((x) => x.text); return { error: 'placeholder rescan failure' }; }); return true; })()`);
      await t.evaluate(`${RESCAN}.click()`);
      if (!await t.waitFor(`WHQ.app.logic.state.toasts.some((x) => x.text === 'Rescan failed · placeholder rescan failure')`, 3000)) out.push('no "Rescan failed · …" toast');
      const r = await t.evaluate(`({ before: window.__rescanToasts || null, now: WHQ.app.logic.state.toasts.map((x) => x.text), label: ${RESCAN}.textContent.trim(), off: ${RESCAN}.disabled })`);
      if (!r.before || !r.before.includes('Rescanning skills, scripts and tasks — the window reloads')) out.push('the Rescan toast was not up when main was called (it reloads the window): ' + JSON.stringify(r.before));
      if (r.now.includes('Rescanning skills, scripts and tasks — the window reloads')) out.push('the progress toast stayed after the error');
      if (r.label !== '↻ Rescan' || r.off) out.push('the Rescan button did not come back after the error');
      out.push(...t.errors());
    } finally {
      await t.evaluate(`(() => { delete window.__rescanToasts; hqFake.reset(true); const L = WHQ.app.logic; L._libRescan = false; L.setState({ confirm: null, toasts: [], libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false, autoQuery: '' }); return true; })()`).catch(() => {});
    }
    return out;
  },

  // P7: status chips (counts follow the search), typed search on name or stack, the
  // "N / M projects" count, the empty state and Clear filters. Names never printed.
  async 'projects-filter'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const SEARCH = `document.querySelector('input[aria-label="Search projects"]')`;
    const count = `(() => { const s = [...document.querySelectorAll('#app span')].map((x) => x.textContent.trim()).find((x) => /^\\d+ \\/ \\d+ projects?$/.test(x)); return s || ''; })()`;
    const cards = `WHQ.app.logic.renderVals().projCards.length`;
    try {
      await t.evaluate(`(() => { WHQ.app.logic.go('projects', 'grid'); return true; })()`);
      if (!await t.waitFor('!!' + SEARCH, 3000)) return ['no project search box on Projects › Grid'];
      await t.sleep(300);
      const n = await t.evaluate(`WHQ.app.logic.projectsAt(0).length`);
      if (!n) return ['no project in data.js'];
      if (await t.evaluate(count) !== n + ' / ' + n + ' project' + (n === 1 ? '' : 's')) out.push('unfiltered count ' + JSON.stringify(await t.evaluate(count)));
      for (const [id, label] of [['risk', 'At risk'], ['care', 'Needs care'], ['idle', 'Idle'], ['ok', 'Healthy']]) {
        const want = await t.evaluate(`WHQ.app.logic.projectsAt(0).filter((p) => p.st === ${JSON.stringify(id)}).length`);
        const b = `[...document.querySelectorAll('button[aria-pressed]')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label + ' · ')}))`;
        if (!await t.evaluate('!!' + b)) { out.push('no "' + label + '" chip'); continue; }
        if (await t.evaluate(`${b}.textContent.trim()`) !== label + ' · ' + want) out.push('the "' + label + '" chip does not count ' + want);
        await t.evaluate(`${b}.click()`);
        await t.sleep(80);
        const s = await t.evaluate(`({ on: ${b}.getAttribute('aria-pressed'), cards: ${cards}, count: ${count} })`);
        if (s.on !== 'true') out.push('the "' + label + '" chip is not aria-pressed when on');
        if (s.cards !== want) out.push('"' + label + '" shows ' + s.cards + ' cards, want ' + want);
        if (!s.count.startsWith(want + ' / ' + n)) out.push('"' + label + '" count says ' + JSON.stringify(s.count));
        await t.evaluate(`${b}.click()`);   // the selected chip again → All
        await t.sleep(60);
        if (await t.evaluate(`WHQ.app.logic.state.projStatus`) !== 'all') out.push('clicking the selected "' + label + '" chip did not go back to All');
      }
      // typed search on a stack word of the first project (never printed)
      const word = await t.evaluate(`(() => { const p = WHQ.app.logic.projectsAt(0).find((x) => x.stack && x.stack.length); return p ? p.stack[0] : null; })()`);
      if (word) {
        await t.evaluate(`${SEARCH}.focus()`);
        await t.type(word.toUpperCase());
        await t.sleep(120);
        const s = await t.evaluate(`(() => { const L = WHQ.app.logic, q = ${JSON.stringify(word.toLowerCase())};
          const want = L.projectsAt(0).filter((p) => (p.name + ' ' + p.stack.join(' ')).toLowerCase().includes(q)).length;
          return { want, cards: ${cards}, state: L.state.projSearch }; })()`);
        if (s.state !== word.toUpperCase()) out.push('typing did not reach projSearch');
        if (!s.want || s.cards !== s.want) out.push('a case-insensitive stack search shows ' + s.cards + ' cards, want ' + s.want);
        await t.evaluate(`WHQ.app.logic.setState({ projSearch: '' })`);
      }
      await t.evaluate(`${SEARCH}.focus()`);
      await t.type('zzz-gate-no-such-project');
      await t.sleep(120);
      const e = await t.evaluate(`({ text: document.querySelector('#app').textContent.includes('No project matches.'), cards: ${cards}, count: ${count} })`);
      if (!e.text) out.push('no "No project matches." empty state');
      if (e.cards !== 0 || !e.count.startsWith('0 / ' + n)) out.push('a search matching nothing shows ' + e.cards + ' cards / ' + JSON.stringify(e.count));
      await t.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear filters').click()`);
      await t.sleep(120);
      const c = await t.evaluate(`({ q: WHQ.app.logic.state.projSearch, st: WHQ.app.logic.state.projStatus, box: ${SEARCH}.value, cards: ${cards} })`);
      if (c.q !== '' || c.st !== 'all' || c.box !== '' || c.cards !== n) out.push('Clear filters left ' + JSON.stringify({ q: !!c.q, st: c.st, box: !!c.box, cards: c.cards }));
      out.push(...t.errors());
    } finally {
      await t.evaluate(`WHQ.app.logic.setState({ projSearch: '', projStatus: 'all' })`).catch(() => {});
    }
    return out;
  },

  // P8: What's new opens once per version, and only once the window has focus (the app
  // starts hidden to the tray: a hidden window never has focus, so a boot that opened it
  // there would burn it unseen). It never autoplays; missing trailers say so; Escape
  // closes it; Settings opens it again on top. whq3-prefs is put back afterwards.
  async 'whats-new-first-launch'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const DLG = `document.querySelector('[role="dialog"][aria-label="What\\'s new"]')`;
    const saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
    // The tray boot: the window has never had focus until its first 'focus' event. CDP
    // input (earlier scenarios' key presses) gives this hidden harness focus for good, so
    // every load during this scenario starts unfocused, as the owner's --hidden boot does.
    const { identifier } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let got = false; addEventListener('focus', () => { got = true; }, true);
      Document.prototype.hasFocus = function () { return got; }; })();` });
    try {
      await t.evaluate(`(() => { let p = {}; try { p = JSON.parse(localStorage.getItem('whq3-prefs') || '{}') || {}; } catch {} delete p.whatsNewSeen; localStorage.setItem('whq3-prefs', JSON.stringify(p)); return true; })()`);
      if (!await reloadReady(t)) return ['the page did not come back after the reload'];
      await t.sleep(500);
      const boot = await t.evaluate(`({ focus: document.hasFocus(), open: WHQ.app.logic.state.whatsNewOpen, dlg: !!${DLG}, seen: JSON.parse(localStorage.getItem('whq3-prefs') || '{}').whatsNewSeen || null })`);
      if (boot.focus) return ['the boot reports focus before any focus event, so this proves nothing'];
      if (boot.open || boot.dlg) out.push('What’s new opened in a window that never had focus');
      if (boot.seen) out.push('a hidden boot marked What’s new seen (' + boot.seen + ')');
      await t.evaluate(`window.dispatchEvent(new Event('focus'))`);
      if (!await t.waitFor('!!' + DLG, 3000)) return out.concat(['the first focus did not open What’s new']);
      const s = await t.evaluate(`(async () => { const d = ${DLG}, wn = await import(new URL('./src/logic/whats-new.js', location.href).href);
        return { seen: JSON.parse(localStorage.getItem('whq3-prefs') || '{}').whatsNewSeen, version: wn.WHATS_NEW_VERSION, bundled: wn.TRAILERS.map((x) => x.bundled),
          videos: [...d.querySelectorAll('video')].map((v) => ({ auto: v.autoplay || v.hasAttribute('autoplay'), preload: v.getAttribute('preload'), paused: v.paused, controls: v.controls })),
          fallback: (d.textContent.match(/Trailer not bundled in this build/g) || []).length }; })()`);
      if (s.seen !== s.version) out.push('opening it did not mark ' + s.version + ' seen (whatsNewSeen=' + JSON.stringify(s.seen) + ')');
      const bundledN = s.bundled.filter(Boolean).length;
      if (s.videos.length !== bundledN) out.push(s.videos.length + ' <video> element(s) for ' + bundledN + ' bundled trailer(s)');
      if (s.fallback !== s.bundled.length - bundledN) out.push(s.fallback + ' "Trailer not bundled" card(s) for ' + (s.bundled.length - bundledN) + ' missing trailer(s)');
      for (const v of s.videos) if (v.auto || v.preload !== 'none' || !v.paused || !v.controls) out.push('a trailer video is not preload=none + controls + paused: ' + JSON.stringify(v));
      await t.press('Escape');
      await t.sleep(150);
      if (await t.evaluate('!!' + DLG)) out.push('Escape did not close What’s new');
      // once per version: the next focused load keeps it closed
      if (!await reloadReady(t)) return out.concat(['the page did not come back after the second reload']);
      await t.evaluate(`window.dispatchEvent(new Event('focus'))`);
      await t.sleep(400);
      if (await t.evaluate('!!' + DLG)) out.push('What’s new opened again for a version already seen');
      // Settings › What's new · trailers opens it on top; Escape closes it first, then Settings
      await t.evaluate(`WHQ.app.logic.setState({ settingsOpen: true })`);
      await t.sleep(150);
      const opened = await t.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Open' && x.parentElement.textContent.includes("What's new · trailers")); if (!b) return false; b.click(); return true; })()`);
      if (!opened) out.push('no "What’s new · trailers" Open button in Settings');
      else {
        if (!await t.waitFor('!!' + DLG, 2000)) out.push('the Settings row did not open What’s new');
        await t.press('Escape');
        await t.sleep(150);
        const st = await t.evaluate(`({ wn: !!${DLG}, settings: WHQ.app.logic.state.settingsOpen })`);
        if (st.wn || !st.settings) out.push('Escape over Settings: What’s new open=' + st.wn + ', Settings open=' + st.settings + ' (want false / true)');
      }
      out.push(...t.errors());
    } finally {
      await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
      await t.evaluate(`(() => { ${RESTORE_KEYS(saved)} WHQ.app.logic.setState({ whatsNewOpen: false, settingsOpen: false }); return true; })()`).catch(() => {});
      await reloadReady(t).catch(() => {});
    }
    return out;
  },

  // Reload safety for hq.captureSave (main re-assembles and RELOADS the window before it
  // answers): the palette's capture verb, System › Clutter's "Note for cleanup" and a
  // project's "Add to ideas" each have their toast up when main is called, and a false
  // answer says "Not saved". The fake answers false and records the toasts at call time.
  async 'capture-toast-first'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const arm = `(() => { window.__capToasts = null; WHQ.app.logic.setState({ toasts: [], sysSaves: {} }); hqFake.set('captureSave', (text) => { window.__capToasts = WHQ.app.logic.state.toasts.map((x) => x.text); return false; }); return true; })()`;
    try {
      // palette: "capture <text>" keeps the text's case
      await t.evaluate(arm);
      await t.evaluate(`WHQ.app.logic.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: 'capture Placeholder Gate Idea', paletteSel: 0 })`);
      await t.sleep(100);
      await t.press('Enter');
      if (!await t.waitFor(`hqFake.calls('captureSave').length === 1`, 3000)) out.push('Enter on "capture …" did not call hq.captureSave');
      else {
        const s = await t.evaluate(`({ args: hqFake.calls('captureSave')[0].args, before: window.__capToasts, now: WHQ.app.logic.state.toasts.map((x) => x.text) })`);
        if (s.args[0] !== 'Placeholder Gate Idea') out.push('the capture text lost its case: ' + JSON.stringify(s.args[0]));
        if (!(s.before || []).includes('Saving to Ideas — the window reloads to show it')) out.push('palette capture: the toast was not up when main was called');
        if (!s.now.includes('Not saved')) out.push('palette capture: no "Not saved" after a false answer');
      }
      // System › Workspace clutter
      await t.evaluate(arm);
      await t.evaluate(`(() => { WHQ.app.logic.go('system', 'clutter'); return true; })()`);
      await t.sleep(300);
      const note = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Note for cleanup' && !b.disabled)`;
      if (await t.evaluate('!!' + note)) {
        const n0 = await t.evaluate(`hqFake.calls('captureSave').length`);
        await t.evaluate(`${note}.click()`);
        if (!await t.waitFor(`hqFake.calls('captureSave').length === ${n0 + 1}`, 3000)) out.push('Note for cleanup did not call hq.captureSave');
        else {
          const s = await t.evaluate(`({ text: hqFake.calls('captureSave').at(-1).args[0], before: window.__capToasts || [] })`);
          if (!s.text.startsWith('Clean up: ')) out.push('Note for cleanup did not send "Clean up: <item>"');
          if (!s.before.some((x) => x.startsWith('Noting for cleanup · “Clean up: '))) out.push('Note for cleanup: the toast was not up when main was called');
          if (!await t.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '✗ Not saved — retry')`, 2000)) out.push('Note for cleanup: the button does not say "✗ Not saved — retry" after a false answer');
        }
      }   // else: this data.js has no clutter item to note
      // a project's "Add to ideas" (missing basics)
      await t.evaluate(arm);
      const pid = await t.evaluate(`(async () => { const A = await import(new URL('./src/live/adapter.mjs', location.href).href); const p = WHQ.app.logic.M.P0.find((x) => A.gapsOf(x).length); return p ? p.id : null; })()`);
      if (pid) {
        await t.evaluate(`(() => { WHQ.app.logic.go('projects', 'grid'); WHQ.app.logic.openProject(${JSON.stringify(pid)}); return true; })()`);
        await t.sleep(300);
        const add = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add to ideas' && !b.disabled)`;
        if (await t.evaluate('!!' + add)) {
          const n0 = await t.evaluate(`hqFake.calls('captureSave').length`);
          await t.evaluate(`${add}.click()`);
          if (!await t.waitFor(`hqFake.calls('captureSave').length === ${n0 + 1}`, 3000)) out.push('Add to ideas did not call hq.captureSave');
          else if (!(await t.evaluate(`window.__capToasts || []`)).some((x) => x.startsWith('Adding to your ideas · “'))) out.push('Add to ideas: the toast was not up when main was called');
        }
      }
      out.push(...t.errors());
    } finally {
      await t.evaluate(`(() => { delete window.__capToasts; hqFake.reset(true); WHQ.app.logic.setState({ toasts: [], sysSaves: {}, paletteOpen: false, route: null }); return true; })()`).catch(() => {});
    }
    return out;
  },
  async 'claude-library-search'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      if (!await t.waitFor(`document.querySelectorAll('[data-cl="row"]').length === 2`, 5000)) fails.push('the fake chats never listed (2 rows)');
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ clQuery: 'release' }); return L.clSearch(); })()`);
      if (!await t.waitFor(`document.querySelectorAll('[data-cl="hit"]').length === 2`, 5000)) fails.push('search hits never rendered (2)');
      const probe = await t.evaluate(`(() => { const box = document.querySelector('[data-cl="hits"]');
        return { img: box.querySelectorAll('img').length, script: box.querySelectorAll('script').length, marks: box.querySelectorAll('mark').length,
          text: box.textContent.includes('<img src=x onerror=alert(1)>'), raw: /[\u0002\u0003]/.test(box.textContent),
          called: hqFake.calls('claudeHub.search').map((c) => c.args[0]) }; })()`);
      if (probe.img || probe.script) fails.push('hit markup was parsed as HTML (img ' + probe.img + ', script ' + probe.script + ')');
      if (!probe.text) fails.push('the hostile snippet is not shown as literal text');
      if (probe.raw) fails.push('a U+0002/U+0003 marker reached the page');
      if (probe.marks < 2) fails.push('highlights missing (' + probe.marks + ' <mark>)');
      if (probe.called[probe.called.length - 1] !== 'release') fails.push('search was not asked for "release"');
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ clQuery: '!!! ...' }); return L.clSearch(); })()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="hits"]').textContent.includes('letters or digits')`, 3000)) fails.push('a punctuation-only query does not say why it found nothing');
    } finally { await t.evaluate(`(() => { hqFake.reset(true); WHQ.app.logic.setState({ clQuery: '', clSearched: false }); return true; })()`); }
    return fails.concat(t.errors());
  },
  async 'claude-thread-open'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`hqFake.set('claudeHub.conversation', (id, o) => o && o.beforeId
        ? { conversation: { id, title: 'Release planning' }, hasMore: false, messages: [{ id: id + ':old', role: 'user', at: '2026-10-04T08:00:00.000Z', text: 'earliest line' }] }
        : { conversation: { id, title: 'Release planning', model: 'claude-placeholder', git_branch: 'main', active_ms: 60000 }, hasMore: true,
            messages: [{ id: id + ':u1', role: 'user', at: '2026-10-04T09:00:00.000Z', text: 'Plan the release' }, { id: id + ':t1', role: 'tool', at: '2026-10-04T09:00:00.000Z', text: 'TOOL BODY' }] })`);
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      await t.waitFor(`document.querySelectorAll('[data-cl="row"]').length > 0`, 5000);
      await t.evaluate(`document.querySelector('[data-cl="row"]').click()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="thread"]')`, 5000)) fails.push('the thread view never opened');
      const s1 = await t.evaluate(`document.querySelector('[data-cl="thread"]').textContent`);
      if (s1.includes('TOOL BODY')) fails.push('a tool row is not collapsed by default');
      await t.evaluate(`[...document.querySelectorAll('[data-cl="thread"] button[aria-expanded]')][0].click()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="thread"]').textContent.includes('TOOL BODY')`, 3000)) fails.push('expanding the tool row did not show it');
      await t.evaluate(`document.querySelector('[data-cl="earlier"]').click()`);
      if (!await t.waitFor(`document.querySelector('[data-cl="thread"]').textContent.includes('earliest line')`, 3000)) fails.push('"Load earlier" did not prepend the earlier page');
      const args = await t.evaluate(`hqFake.calls('claudeHub.conversation').map((c) => c.args[1] || {})`);
      const last = args[args.length - 1];
      if (!(last.before === '2026-10-04T09:00:00.000Z' && /:u1$/.test(last.beforeId))) fails.push('"Load earlier" did not send the (before, beforeId) cursor: ' + JSON.stringify(last));
      await t.evaluate(`[...document.querySelectorAll('[data-cl="thread"] button')].find((b) => b.textContent.trim() === 'Forget').click()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="forget-yes"]')`, 3000)) fails.push('Forget does not ask first');
      if (!/transcript on disk is untouched/.test(await t.evaluate(`document.querySelector('[aria-label="Forget this chat"]').textContent`))) fails.push('the Forget prompt does not say the file stays');
      await t.evaluate(`document.querySelector('[data-cl="forget-yes"]').click()`);
      if (!await t.waitFor(`hqFake.calls('claudeHub.forget').length === 1 && !document.querySelector('[data-cl="thread"]')`, 3000)) fails.push('Forget did not call the Hub and close the thread');
    } finally { await t.evaluate(`(() => { hqFake.reset(true); WHQ.app.logic.setState({ clOpen: false, clForgetAsk: false, clExpanded: {} }); return true; })()`); }
    return fails.concat(t.errors());
  },
  // Claude Hub H3 (spec §8–§9): a turn streams as text, Stop ends it once with the partial text kept, and the mode
  // switch reaches main. Deterministic: claudeChat.send/cancel are overridden to emit events by hand.
  async 'claude-chat-stream-stop'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    try {
      await t.evaluate(`(() => {
        const SID = '00000000-0000-4000-8000-000000000001', ev = (d) => hqFake.emit('hq:claude-chat:event', d);
        hqFake.set('claudeChat.send', (req) => {
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'session', sessionId: SID, mode: req.mode }), 30);
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'delta', text: 'Placeholder <img src=x onerror=alert(1)> partial' }), 60);
          setTimeout(() => ev({ turnId: 'ct-g1', kind: 'tool', name: 'Read', hint: 'README.md' }), 90);
          return { turnId: 'ct-g1' };
        });
        hqFake.set('claudeChat.cancel', (id) => { setTimeout(() => ev({ turnId: id, kind: 'done', sessionId: SID, mode: 'read-only', usage: null, isError: false, subtype: '', result: '', stopped: true }), 0); return true; });
        const L = WHQ.app.logic; L.go('claude', 'chats'); L.ccNew(''); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="composer"]')`, 3000)) return ['the composer never opened'];
      if (!await t.evaluate(`(document.querySelector('[data-cc="quota"]') || {}).textContent === 'Uses your Claude quota'`)) out.push('the quota label is missing');
      if (!await t.evaluate(`document.querySelector('[data-cc="send"]').disabled`)) out.push('Send was enabled with no project picked');
      if (!await t.evaluate(`(() => { const b = document.querySelector('[data-cc="picker"] button'); if (!b) return false; b.click(); return true; })()`)) return out.concat(['no project to pick in the harness']);
      await t.evaluate(`(() => { WHQ.app.logic.setState({ ccText: 'Placeholder question' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="stop"]') && [...document.querySelectorAll('[data-cc="tool"]')].some((e) => e.textContent.includes('Read README.md'))`, 3000)) out.push('the turn never streamed a tool row with Stop showing');
      const sent = await t.evaluate(`hqFake.calls('claudeChat.send').map((c) => c.args[0])`);
      if (sent.length !== 1 || sent[0].mode !== 'read-only' || sent[0].text !== 'Placeholder question' || !sent[0].projectId) out.push('send got ' + JSON.stringify(sent));
      await t.evaluate(`document.querySelector('[data-cc="stop"]').click(), true`);
      if (!await t.waitFor(`!document.querySelector('[data-cc="stop"]') && [...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Read-only · Stopped — the partial answer is kept'))`, 3000)) out.push('Stop did not end the turn as stopped');
      await t.sleep(400);
      const r = await t.evaluate(`(() => { const turns = document.querySelector('[data-cc="turns"]');
        return { cancels: hqFake.calls('claudeChat.cancel').length, texts: [...document.querySelectorAll('[data-cc="text"]')].map((e) => e.textContent),
          markup: turns ? turns.querySelectorAll('img,script').length : -1, metas: [...document.querySelectorAll('[data-cc="meta"]')].map((e) => e.textContent) }; })()`);
      if (r.cancels !== 1) out.push('cancel calls: ' + r.cancels);
      if (r.texts.length !== 1 || r.texts[0] !== 'Placeholder <img src=x onerror=alert(1)> partial') out.push('partial text not kept exactly once as text: ' + JSON.stringify(r.texts));
      if (r.markup !== 0) out.push('streamed text became markup: ' + r.markup);
      if (r.metas.filter((m) => m.includes('Stopped')).length !== 1) out.push('the turn ended more than once: ' + JSON.stringify(r.metas));
      return out.concat(await t.errors());
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.store.live.claudeChat.turns.length = 0; L.setState({ ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false }); return true; })()`);
    }
  },

  async 'claude-chat-mode-readonly'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const pressed = (k) => `document.querySelector('[data-cc="${k}"]').getAttribute('aria-pressed')`;
    try {
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.go('claude', 'chats'); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="new"]')`, 3000)) return ['no New chat button on Claude › Chats'];
      await t.evaluate(`document.querySelector('[data-cc="new"]').click(), true`);
      if (!await t.waitFor(`!!document.querySelector('[data-cc="composer"]')`, 3000)) return ['New chat did not open the composer'];
      if (await t.evaluate(pressed('mode-ro')) !== 'true' || await t.evaluate(pressed('mode-edits')) !== 'false') out.push('the composer did not open Read-only');
      await t.evaluate(`(() => { document.querySelector('[data-cc="picker"] button').click(); WHQ.app.logic.setState({ ccText: 'First' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`[...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Read-only · Done'))`, 4000)) out.push('the first turn never showed "Read-only · Done"');
      await t.evaluate(`document.querySelector('[data-cc="mode-edits"]').click(), true`);
      await t.sleep(80);
      if (await t.evaluate(pressed('mode-edits')) !== 'true') out.push('Allow edits did not switch on');
      await t.evaluate(`(() => { WHQ.app.logic.setState({ ccText: 'Second' }); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="send"]').click(), true`);
      if (!await t.waitFor(`[...document.querySelectorAll('[data-cc="meta"]')].some((e) => e.textContent.startsWith('Allow edits · Done'))`, 4000)) out.push('the second turn never showed "Allow edits · Done"');
      const sent = await t.evaluate(`hqFake.calls('claudeChat.send').map((c) => ({ mode: c.args[0].mode, conv: c.args[0].conversationId || null }))`);
      if (JSON.stringify(sent) !== JSON.stringify([{ mode: 'read-only', conv: null }, { mode: 'edits', conv: 'code:00000000-0000-4000-8000-000000000001' }])) out.push('send calls: ' + JSON.stringify(sent));
      await t.evaluate(`(() => { WHQ.app.logic.ccClose(); return true; })()`);
      await t.sleep(80);
      await t.evaluate(`document.querySelector('[data-cc="new"]').click(), true`);
      await t.sleep(120);
      if (await t.evaluate(pressed('mode-ro')) !== 'true') out.push('Allow edits was remembered: a new composer must open Read-only');
      return out.concat(await t.errors());
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.store.live.claudeChat.turns.length = 0; L.setState({ ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false }); return true; })()`);
    }
  },
  async 'search-documents'(t) {
    const bad = await fresh(t); if (bad) return bad;
    const fails = [];
    try {
      await t.evaluate(`WHQ.app.logic.go('claude', 'chats')`);
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ clQuery: 'tea' }); L.clSearch(); return true; })()`);
      if (!(await t.waitFor(`!!document.querySelector('[data-cd="hit"]')`, 4000))) return ['no document hits rendered'];
      const badges = await t.evaluate(`[...document.querySelectorAll('[data-cd="badge"]')].map((b) => b.textContent)`);
      if (badges.join('|') !== 'memory|CLAUDE.md') fails.push('badges: ' + badges.join('|'));
      if (await t.evaluate(`/[\u0002\u0003]/.test(document.querySelector('[data-cd="hit"]').textContent)`)) fails.push('snippet markers leaked into the text');
      await t.evaluate(`document.querySelector('[data-cd="hit"]').click()`);
      if (!(await t.waitFor(`!!document.querySelector('[data-cd="doc"]') && document.querySelector('[data-cd="doc"]').textContent.includes('Offer fake tea first.')`, 3000))) fails.push('the document did not open in place');
      if ((await t.evaluate(`hqFake.calls('claudeHub.document').length`)) !== 1) fails.push('document() not called once');
      await t.evaluate(`document.querySelector('[data-cd="close"]').click()`);
      if (!(await t.waitFor(`!document.querySelector('[data-cd="doc"]')`, 3000))) fails.push('Close did not close');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.clClearSearch(); L.store.closeClaudeDocument(); L.setState({}); })()`);
    }
    return fails.concat(t.errors());
  },

  async 'ask-claude-chip'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    try {
      await t.evaluate(`(() => { localStorage.removeItem('hq-oracle-include'); localStorage.removeItem('hq-oracle-chat');
        WHQ.app.logic.setState({ askInclude: null, askHistory: [], askOpen: true }); return true; })()`);
      await t.sleep(150);
      const chips = () => t.evaluate(`(() => { const a = document.querySelector('aside[aria-label="Ask"]'); if (!a) return null;
        return [...a.querySelectorAll('[aria-label="Context sources"] button')].map((b) => b.textContent.trim() + '=' + b.getAttribute('aria-pressed')); })()`);
      const c0 = await chips();
      if (!c0) return ['the Ask panel did not open'];
      if (c0.length !== 7 || c0[6] !== 'Claude history=false') out.push('chips ' + JSON.stringify(c0) + ', want 7: "Claude history" last, off');
      await t.evaluate(`(() => { const a = document.querySelector('aside[aria-label="Ask"]'); [...a.querySelectorAll('[aria-label="Context sources"] button')][6].click(); return true; })()`);
      await t.sleep(100);
      const inc = await t.evaluate(`localStorage.getItem('hq-oracle-include')`);
      if (inc !== '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false,"claude":true}') out.push('stored include ' + inc);
      if ((await chips())[6] !== 'Claude history=true') out.push('the chip did not show as on');
      await t.evaluate(`(() => { WHQ.app.logic.submitAsk('What did we decide about the placeholder release?'); return true; })()`);
      if (!await t.waitFor(`(() => { const h = WHQ.app.logic.state.askHistory; return h.length && h[h.length - 1].a.status === 'done'; })()`, 5000)) out.push('the answer never settled');
      const sent = await t.evaluate(`hqFake.calls('llm.chat').map((c) => c.args[0].include)`);
      if (!sent.length || sent[sent.length - 1].claude !== true) out.push('llm.chat was not sent include.claude: ' + JSON.stringify(sent));
      await t.sleep(150);
      const spans = await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Ask"] span')].map((x) => x.textContent.trim())`);
      if (!spans.some((x) => x.includes('Claude history · from chat Fake release planning, 2026-10-01'))) out.push('no meta line naming "chat Fake release planning, 2026-10-01": ' + JSON.stringify(spans.filter((x) => x.includes('grounded'))));
      // off again: the stored string is v3's own, byte for byte
      await t.evaluate(`(() => { WHQ.app.logic.toggleAskSource('claude'); return true; })()`);
      const off = await t.evaluate(`localStorage.getItem('hq-oracle-include')`);
      if (off !== '{"scan":true,"tasks":true,"projects":true,"health":false,"browser":false,"vault":false}') out.push('chip off stored ' + off + ', want v3’s six keys');
    } finally {
      await t.evaluate(`(() => { localStorage.removeItem('hq-oracle-include'); localStorage.removeItem('hq-oracle-chat'); WHQ.app.logic.setState({ askOpen: false, askHistory: [], askInclude: null }); return true; })()`).catch(() => {});
    }
    return out.concat(t.errors());
  },

  // H5 (spec §9 Vault, §11 vault-preview-confirm): the thread view's "Save to vault" drafts (nothing written), the
  // owner's edit is what Save sends, a note that is there is replaced only through the Replace question, a save that
  // answers "exists" returns to that question without a second write, and Escape closes the dialog.
  async 'vault-preview-confirm'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const out = [];
    const DIALOG = `document.querySelector('[role="dialog"][aria-label="Save to vault"]')`;
    const saves = () => t.evaluate(`hqFake.calls('claudeVault.save').map((c) => c.args[0])`);
    const click = (sel) => t.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
    const exists = (id) => ({ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', exists: true, model: 'fake-model', basis: 4,
      markdown: '---\nsource: claude-code\nconversation: "' + id + '"\n---\n# Fake release planning\n' });
    try {
      // a chat open in the thread view (H2), through the live store as the Chats tab leaves it
      await t.evaluate(`(() => { const L = WHQ.app.logic; L.store.live.claudeLib = Object.assign({}, L.store.live.claudeLib, { thread: { conversation: { id: 'code:fake-1', title: 'Fake release planning', source: 'code' }, messages: [], hasMore: false } });
        L.go('claude', 'chats'); L.setState({ clOpen: true }); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-cl="vault"]')`, 5000)) return ['the thread view has no "Save to vault" button'];
      if (!await click('[data-cl="vault"]')) return ['"Save to vault" was disabled for an open chat'];
      if (!await t.waitFor(`!!${DIALOG} && !!${DIALOG}.querySelector('textarea')`, 5000)) return ['the draft never showed'];
      const d = await t.evaluate(`(() => { const d = ${DIALOG}; return { text: d.textContent, draft: d.querySelector('textarea').value }; })()`);
      if (!d.draft.startsWith('---\nsource: claude-code\nconversation: "code:fake-1"')) out.push('the draft is not the preview’s markdown: ' + JSON.stringify(d.draft.slice(0, 80)));
      if (!d.text.includes('Drafted by the local model (fake-model) from 4 chat messages')) out.push('no "Drafted by the local model (fake-model) from 4 chat messages" note');
      if (!d.text.includes('VEEMO CORTEX / 30_Areas/Claude/project-a/2026-10-01 Fake release planning.md')) out.push('the destination path is not shown');
      if ((await saves()).length) out.push('something was saved before Save was pressed');
      // the owner's edit is what lands
      await t.evaluate(`(() => { const a = ${DIALOG}.querySelector('textarea'); a.focus(); a.setSelectionRange(a.value.length, a.value.length); return true; })()`);
      await t.type('my edit');
      await t.evaluate(`(() => { document.activeElement && document.activeElement.blur(); return true; })()`);
      await t.sleep(100);
      if (!await click('[data-vault="save"]')) out.push('Save was disabled');
      if (!await t.waitFor(`!!${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`, 5000)) out.push('no "Saved to" confirmation');
      let s = await saves();
      if (s.length !== 1 || !String(s[0].markdown).endsWith('my edit') || 'replace' in s[0]) out.push('save sent ' + JSON.stringify(s).slice(0, 300) + ', want one save of the edited text without replace');
      // a note that is already there: Save asks; Keep it writes nothing; Replace sends replace:true
      await t.evaluate(`(() => { hqFake.set('claudeVault.preview', ${exists.toString()}); WHQ.app.logic.closeVault(); WHQ.app.logic.openVaultPreview('code:fake-1'); return true; })()`);
      if (!await t.waitFor(`!!document.querySelector('[data-vault="save"]')`, 5000)) out.push('the second draft never showed');
      await click('[data-vault="save"]');
      if (!await t.waitFor(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`, 3000)) out.push('Save on an existing note did not ask to replace it');
      if ((await saves()).length !== 1) out.push('asking to replace wrote something');
      await t.evaluate(`(() => { [...document.querySelectorAll('[role="alertdialog"][aria-label="Replace the note"] button')].find((b) => b.textContent.trim() === 'Keep it').click(); return true; })()`);
      await t.sleep(100);
      if (await t.evaluate(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`)) out.push('Keep it did not close the question');
      if ((await saves()).length !== 1) out.push('Keep it wrote something');
      await click('[data-vault="save"]');
      await t.waitFor(`!!document.querySelector('[data-vault="replace"]')`, 3000);
      await click('[data-vault="replace"]');
      await t.waitFor(`${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`, 5000);
      s = await saves();
      if (s.length !== 2 || s[1].replace !== true) out.push('Replace sent ' + JSON.stringify(s[1] || null).slice(0, 200) + ', want replace:true');
      // a save that answers "exists" goes back to the question, no second write
      await t.evaluate(`(() => { hqFake.set('claudeVault.preview', undefined); hqFake.set('claudeVault.save', { error: 'a note with this name is already there', exists: true }); WHQ.app.logic.closeVault(); WHQ.app.logic.openVaultPreview('code:fake-1'); return true; })()`);
      await t.waitFor(`!!document.querySelector('[data-vault="save"]')`, 5000);
      await click('[data-vault="save"]');
      if (!await t.waitFor(`!!document.querySelector('[role="alertdialog"][aria-label="Replace the note"]')`, 3000)) out.push('a save answering "exists" did not return to the Replace question');
      await t.sleep(300);
      if ((await saves()).length !== 3) out.push('a save answering "exists" was retried on its own (' + (await saves()).length + ' saves)');
      // Escape closes the dialog
      await t.press('Escape');
      await t.sleep(100);
      if (await t.evaluate(`!!${DIALOG}`)) out.push('Escape did not close the dialog');
    } finally {
      await t.evaluate(`(() => { hqFake.reset(true); const L = WHQ.app.logic; L.closeVault(); L.setState({ clOpen: false }); if (L.store.live.claudeLib) L.store.live.claudeLib.thread = null; return true; })()`).catch(() => {});
    }
    return out.concat(t.errors());
  },


  // Every button, every screen (2026-10-27, owner: "test for other broken buttons"). Needs --preload=fake: each click
  // lands on the recording fake, never on the PC. For each tab × sub, a project page and the overlays, every visible,
  // enabled <button> is clicked once from a clean screen (buttons outside <main> once per run). A click is
  //   error      it threw, logged an error or rejected
  //   not-wired  it toasted "… isn't wired in this version yet" (KNOWN_CUTS lists the deliberate ones: brief §11.1)
  //   dead       nothing at all changed: no hq call, no state, no screen, no toast
  // The clipboard and window.open are stubbed for the run; project names are masked in what it prints.
  async 'button-sweep'(t) {
    const pre = await fresh(t); if (pre) return pre;
    const KNOWN_CUTS = [];   // none left
    const views = await t.evaluate(`(() => { const M = WHQ.app.logic.M, v = [];
      const p = (M.P0[0] || {}).id; if (p) v.push({ name: 'project-page', tab: 'projects', sub: 'grid', project: p });   // first: the global buttons are tried away from Home
      for (const n of M.NAV) for (const s of (M.SUBS[n.id] || [[null]])) v.push({ name: n.id + (s[0] ? '/' + s[0] : ''), tab: n.id, sub: s[0] });
      for (const o of ['settingsOpen', 'cheatOpen', 'runsOpen', 'scrubOpen', 'askOpen', 'moreOpen', 'whatsNewOpen']) v.push({ name: 'overlay/' + o, tab: 'home', overlay: o });
      return v; })()`);
    // the clean screen every click starts from: this state and this localStorage (a filter chip persists its pick)
    const base = await t.evaluate(`JSON.stringify({ state: JSON.stringify(WHQ.app.logic.state, (k, v) => (typeof v === 'function' ? undefined : v)), ls: JSON.stringify(Object.assign({}, localStorage)) })`);
    // hooks for one page load (installed again after a reload)
    const install = () => t.evaluate(`(() => { const b = JSON.parse(${JSON.stringify(base)}); window.__sweep = { errs: [], base: b.state, ls: b.ls };
      const ce = console.error.bind(console); console.error = (...a) => { window.__sweep.errs.push(a.map(String).join(' ').slice(0, 200)); ce(...a); };
      window.addEventListener('error', (e) => window.__sweep.errs.push('uncaught: ' + String(e.message).slice(0, 200)));
      window.addEventListener('unhandledrejection', (e) => window.__sweep.errs.push('rejected: ' + String(e.reason && e.reason.message || e.reason).slice(0, 200)));
      try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {}, readText: async () => '' }, configurable: true }); } catch {}
      window.open = () => null; return true; })()`);
    await install();
    const findings = [], seenGlobal = new Set();
    let clicked = 0, skipped = 0, retried = 0;
    // one screen: enumerate its buttons (or just `only`) and click each from a clean screen
    const sweepView = (view, only) => t.evaluate(`(async (view, seenGlobal, only) => {
        const L = WHQ.app.logic, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const names = [...L.M.P0, ...(L.M.at(0).archived || [])].map((p) => p.name).filter((n) => n && n.length > 2).sort((a, b) => b.length - a.length);
        const mask = (s) => { let o = s; for (const n of names) o = o.split(n).join('‹project›'); return o; };
        const CLOSED = { confirm: null, commit: null, sheet: null, levelUp: null, onboard: null, vault: null,
          askOpen: false, runsOpen: false, paletteOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, scrubOpen: false, whatsNewOpen: false, focus: null,
          toasts: [], route: null, snapOffset: 0, clOpen: false, ccOpen: false, pageMore: false };
        const reset = async () => {
          hqFake.reset(true);
          localStorage.clear(); for (const [k, v] of Object.entries(JSON.parse(window.__sweep.ls))) localStorage.setItem(k, v);
          L.setState(Object.assign(JSON.parse(window.__sweep.base), CLOSED)); await sleep(30);
          L.go(view.tab, view.sub || undefined); await sleep(30);
          if (view.project) { L.openProject(view.project); await sleep(30); }
          if (view.overlay) { L.setState({ [view.overlay]: true }); }
          await sleep(220);   // tab animation + store reads on arrival
        };
        const label = (b) => mask(((b.getAttribute('aria-label') || '') + ' ' + b.textContent).replace(/\\s+/g, ' ').trim()).slice(0, 80) || '(no label)';
        const keyOf = (b) => (b.closest('main') ? 'main:' : 'global:') + label(b);
        const visible = (b) => !!(b.offsetParent || b.getClientRects().length) && !b.disabled;
        // the tab / filter you are already on (the design's active style): a click there rightly changes nothing
        const selected = (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || !!b.getAttribute('aria-current') || /var\\(--gold\\) 14%|var\\(--accent-text\\)/.test(b.getAttribute('style') || '');
        await reset();
        const keys = only ? only.slice() : [], seen = new Set(); let off = 0;
        if (!only) for (const b of document.querySelectorAll('#app button')) {
          if (!visible(b)) { if (b.disabled) off++; continue; }
          const k = keyOf(b); if (seen.has(k) || (k.startsWith('global:') && seenGlobal.includes(k))) continue;
          if (view.overlay && k.startsWith('main:')) continue;   // the screen behind an overlay is swept on its own
          seen.add(k); keys.push(k);
        }
        const out = [];
        const snap = () => ({ calls: hqFake.calls().length, state: JSON.stringify(L.state, (k, v) => (k === 'now' || typeof v === 'function' ? undefined : v)),
          dom: document.querySelector('#app').innerHTML, toasts: (L.state.toasts || []).map((x) => x.kind + ':' + x.text) });
        for (const k of keys) {
          await reset();
          const b = [...document.querySelectorAll('#app button')].find((x) => visible(x) && keyOf(x) === k);
          if (!b) { out.push({ key: k, cls: 'vanished' }); continue; }
          window.__sweep.errs = [];
          const wasSelected = selected(b), s0 = snap();
          try { b.click(); } catch (e) { window.__sweep.errs.push('click threw: ' + e.message); }
          await sleep(260);
          const s1 = snap(), toasts = s1.toasts.filter((x) => !s0.toasts.includes(x));
          const errs = window.__sweep.errs.slice();
          const cls = errs.length ? 'error' : toasts.some((x) => /isn.t wired/.test(x)) ? 'not-wired'
            : (s1.calls === s0.calls && s1.state === s0.state && s1.dom === s0.dom && !toasts.length) ? (wasSelected ? 'ok' : 'dead') : 'ok';
          out.push({ key: k, cls, toasts: toasts.map(mask), errs, calls: hqFake.calls().slice(0, 4).map((c) => c.method) });
        }
        await reset();
        return { out, off };
      })(${JSON.stringify(view)}, ${JSON.stringify([...seenGlobal])}, ${JSON.stringify(only || null)})`);
    for (const view of views) {
      const r = await sweepView(view);
      skipped += r.off;
      const gone = [];
      for (const o of r.out) {
        if (o.key.startsWith('global:')) seenGlobal.add(o.key);
        if (o.cls === 'vanished') { gone.push(o.key); continue; }
        clicked++;
        if (o.cls !== 'ok') findings.push({ view: view.name, ...o });
      }
      // an earlier click changed the store's live data (a fake Refresh / Re-examine / Import answer), so the button is
      // not on the clean screen any more: try each once more on a freshly loaded page
      for (const k of gone) {
        retried++;
        await reloadReady(t); await install();
        const o = (await sweepView(view, [k])).out[0];
        clicked++;
        if (o.cls !== 'ok') findings.push({ view: view.name, ...o });
      }
      if (gone.length) { await reloadReady(t); await install(); }
    }
    await fresh(t);
    const line = (f) => f.cls.padEnd(9) + ' ' + f.view.padEnd(22) + ' ' + f.key.replace(/^(main|global):/, '') + (f.toasts && f.toasts.length ? '  → ' + f.toasts.join(' | ') : '') + (f.errs && f.errs.length ? '  ! ' + f.errs.join(' | ') : '');
    console.log('[button-sweep] ' + clicked + ' buttons clicked across ' + views.length + ' screens · ' + retried + ' retried on a fresh page · ' + skipped + ' disabled seen');
    for (const f of findings) console.log('  ' + line(f));
    const cut = (f) => f.cls === 'not-wired' && f.toasts.some((x) => KNOWN_CUTS.some((re) => re.test(x.replace(/^\w+:/, ''))));
    return findings.filter((f) => !cut(f)).map(line);
  },
};

// scenarios that need more than the default 90 s
const TIMEOUT = { 'button-sweep': 900000 };

// ---- runner --------------------------------------------------------------------
const port = Number(arg('port', '9342'));
const which = String(arg('scenario', 'boot'));
const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',').map((s) => s.trim()).filter(Boolean);
const unknown = names.filter((n) => !SCENARIOS[n]);
if (!port || unknown.length || !names.length) {
  console.error('[cdp-gate] usage: node tools/cdp-gate.mjs --port 9342 --scenario ' + Object.keys(SCENARIOS).join('|') + '|all' + (unknown.length ? ' · unknown: ' + unknown.join(', ') : ''));
  process.exit(2);
}
let cdp;
try {
  cdp = await connect(port, String(arg('match', 'index.html')), Number(arg('wait', '20000')));
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
} catch (e) { console.error('[cdp-gate] ' + e.message); process.exit(2); }
const t = driver(cdp);
console.log('[cdp-gate] ' + cdp.url);
let failed = 0;
for (const name of names) {
  const t0 = Date.now();
  let out;
  try { out = await within(SCENARIOS[name](t), TIMEOUT[name] || 90000, 'scenario ' + name); } catch (e) { out = ['threw: ' + e.message]; }
  const ms = Date.now() - t0;
  if (out.length) { failed++; console.log('FAIL ' + name + ' (' + ms + ' ms)\n  ' + out.join('\n  ')); }
  else console.log('PASS ' + name + ' (' + ms + ' ms)');
}
cdp.close();
console.log('[cdp-gate] ' + (names.length - failed) + '/' + names.length + ' passed');
process.exit(failed ? 1 : 0);
