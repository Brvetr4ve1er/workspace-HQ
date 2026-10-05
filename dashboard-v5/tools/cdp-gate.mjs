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
// load · t.sleep(ms) · t.errors() console errors, uncaught exceptions and
// error-level log entries (CSP, network) since the last reload or
// t.clearErrors(). Scenarios run in order on the same page.
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
    sleep, errors: () => errs.slice(), clearErrors: () => { errs = []; },
  };
  return t;
}

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
