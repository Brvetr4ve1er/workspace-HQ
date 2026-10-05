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
// t.send(method, params) raw CDP · t.sleep(ms) · t.errors() console errors, uncaught
// exceptions and error-level log entries (CSP, network) since the last reload or
// t.clearErrors(). Scenarios run in order on the same page.
//
// Phase 2 safety scenarios (need --preload=fake; each starts from hqFake.reset(true)):
//   confirm-enter-on-cancel · confirm-hash · commit-env · ask-stream · scan-failed · live-hydrate
// scan-failed and live-hydrate reload with hqFake.set(…, {persist:true}), then reload clean.
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
  await t.evaluate(`(() => { hqFake.reset(true); WHQ.app.logic.setState({ snapOffset: 0, confirm: null, confirmHash: null, confirmPreview: null, commit: null, sheet: null, levelUp: null, lightbox: null, onboard: null,
    askOpen: false, runsOpen: false, paletteOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, scrubOpen: false, toasts: [] }); return true; })()`);
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
};

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
  try { out = await within(SCENARIOS[name](t), 90000, 'scenario ' + name); } catch (e) { out = ['threw: ' + e.message]; }
  const ms = Date.now() - t0;
  if (out.length) { failed++; console.log('FAIL ' + name + ' (' + ms + ' ms)\n  ' + out.join('\n  ')); }
  else console.log('PASS ' + name + ' (' + ms + ' ms)');
}
cdp.close();
console.log('[cdp-gate] ' + (names.length - failed) + '/' + names.length + ' passed');
process.exit(failed ? 1 : 0);
