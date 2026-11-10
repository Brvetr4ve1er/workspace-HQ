// Client delivery check, renderer side: vals/delivery-check.js + logic/delivery-check.js + tpl/delivery-check.tpl.js on a
// rigged component (no DOM, no main). Pins: dck-prefixed keys, every template binding has a value, honest exclusive states,
// nothing called at boot or on a non-client page, the owner-confirmed URL, a double click runs once, a stale answer for
// another project is dropped, a held report is never blanked by a later error.
//   node --test dashboard-v5/src/logic/delivery-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCheckLogic } from './delivery-check.js';
import { deliveryCheckVals } from '../vals/delivery-check.js';
import tpl from '../tpl/delivery-check.tpl.js';

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const READY = { state: 'ready', startedHere: false, candidates: [{ origin: 'http://127.0.0.1:5173', title: 'Acme Studio' }], hasCommand: true };
const NOTHING = { state: 'nothing-answering', startedHere: false, candidates: [], hasCommand: true };
const REPORT = (o = {}) => ({
  v: 1, at: iso(2 * 3600e3), origin: '127.0.0.1:5173', phone: { width: 390, height: 844, scale: 3 },
  routes: [{ path: '/', locale: 'en', title: 'Acme Studio', loaded: true, shot: 'a-0.png' }, { path: '/fr', locale: 'fr', title: 'Acme (fr)', loaded: true, shot: 'a-1.png' }],
  findings: [
    { id: 'overflow', level: 'problem', route: '/', text: 'Sideways scroll at 390 px: the page is 900 px wide · widest: table.wide', offenders: ['table.wide'] },
    { id: 'small-text', level: 'heads-up', route: '/', text: '1 piece of visible text under 12 px' },
    { id: 'identical', level: 'heuristic', route: '/fr', text: 'Heuristic: 3 strings on /fr are word for word the same as on /', samples: ['Welcome to Acme'] },
  ],
  counts: { problem: 1, headsUp: 1, heuristic: 1 }, languageSwitch: 'found', blocked: { count: 4, hosts: [{ host: 'fonts.example.test', count: 3 }] }, requestsSeen: 12,
  truncated: { routes: false, requests: false, time: false }, summary: '1 to fix · 1 to look at · 1 heuristic (may be wrong) · 2 pages at 390 px',
  blockedLine: '4 outside requests blocked (fonts.example.test)', notes: [], shots: ['a-0.png', 'a-1.png'], ...o,
});
const DELIVERY = (client = true) => ({ byProject: { 'acme-site': { projectId: 'acme-site', client } }, error: '', loaded: true });

function rig(o = {}) {
  const calls = [], toasts = [];
  const gate = o.gate || null;
  const hqCheck = o.noBridge ? null : {
    detect: async (id) => { calls.push(['detect', id]); return o.detect === undefined ? READY : typeof o.detect === 'function' ? o.detect(id) : o.detect; },
    run: async (id, url) => { calls.push(['run', id, url]); if (gate) await gate; else await new Promise((r) => setTimeout(r, 5)); return o.run ? o.run(id, url) : REPORT(); },
    read: async (id) => { calls.push(['read', id]); return o.read === undefined ? null : o.read; },
    forget: async (id) => { calls.push(['forget', id]); return { ok: true }; },
  };
  const self = Object.assign(Object.create(deliveryCheckLogic), {
    state: { route: { type: 'project', id: 'acme-site' }, dck: undefined, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]), denied(why) { toasts.push(['denied', why]); }, ps: () => (o.ps || 'live'),
    useMark: (surface, action) => calls.push(['mark', surface, action]),
    dlvView() { const D = this.LIVE.delivery; return D && D.byProject ? D.byProject[this.state.route.id] || null : null; },
    LIVE: { delivery: o.delivery === undefined ? DELIVERY(true) : o.delivery },
    hq: hqCheck ? { deliveryCheck: hqCheck } : {},
  });
  const vals = () => deliveryCheckVals.call(self, { S: self.state, LIVE: self.LIVE, live: true });
  return { self, calls, toasts, vals };
}
const names = (calls, n) => calls.filter((c) => c[0] === n);

test('every key is dck-prefixed (one shared namespace with the other surfaces)', async () => {
  for (const o of [{}, { noBridge: true }, { delivery: DELIVERY(false) }, { delivery: { byProject: {}, error: '', loaded: false } }]) {
    for (const k of Object.keys(rig(o).vals())) assert.match(k, /^(dck|onDck)[A-Z]/, k);
  }
});

test('every {{ binding }} in the template has a value in the vals (loop variables excepted)', async () => {
  const states = [{}, { noBridge: true }];
  const r = rig({ read: REPORT() }); await r.self.dckArrive('acme-site');
  const keys = new Set(Object.keys(r.vals()));
  for (const o of states) for (const k of Object.keys(rig(o).vals())) keys.add(k);
  const bound = new Set([...tpl.matchAll(/\{\{\s*!?\s*([A-Za-z0-9_.]+)\s*\}\}/g)].map((m) => m[1]).filter((b) => !/^(f|r|n)\./.test(b) && b !== 'true' && b !== 'false'));
  for (const b of bound) assert.ok(keys.has(b), 'template binds ' + b + ' but the vals do not provide it');
  assert.ok(!tpl.includes('`'), 'the template must not hold a backtick');
  // and every loop-variable path the template reads exists on a built item
  const v = r.vals();
  for (const [list, item, props] of [['dckFindings', 'f', ['tag', 'tagStyle', 'route', 'text', 'hasSamples', 'samplesText']], ['dckRoutes', 'r', ['path', 'meta']], ['dckNotes', 'n', ['text']]]) {
    const sample = list === 'dckNotes' ? { text: 'x' } : v[list][0];
    for (const p of props) assert.ok(list === 'dckNotes' || p in sample, item + '.' + p + ' is provided by ' + list);
  }
});

test('nothing is called at boot, on a project that is not a client job, or without the bridge', async () => {
  const boot = rig(); assert.deepEqual(boot.calls, []);
  const notClient = rig({ delivery: DELIVERY(false) });
  await notClient.self.dckArrive('acme-site');
  assert.deepEqual(names(notClient.calls, 'detect'), [], 'no port probing on a non-client page');
  assert.equal(notClient.vals().dckShow, false);
  const off = rig({ noBridge: true }); await off.self.dckArrive('acme-site');
  assert.deepEqual(off.calls, []);
  const nb = rig({ ps: 'nobridge' }); await nb.self.dckArrive('acme-site');
  assert.deepEqual(nb.calls, []);
});

test('arriving on a client job reads the last report and looks for the server; ready prefills the field', async () => {
  const { self, calls, vals } = rig({ read: REPORT() });
  await self.dckArrive('acme-site');
  assert.deepEqual(calls, [['read', 'acme-site'], ['detect', 'acme-site']]);
  const v = vals();
  assert.deepEqual([v.dckShow, v.dckReady, v.dckNothing, v.dckNotLooked, v.dckUrl], [true, true, false, false, 'http://127.0.0.1:5173']);
  assert.match(v.dckReadyText, /Answering at http:\/\/127\.0\.0\.1:5173 · “Acme Studio” · started elsewhere \(your own terminal\)\. Confirm it is the right app, then Check\./);
  assert.equal(v.dckHasReport, true); assert.match(v.dckCheckedLine, /^checked 2 h ago against 127\.0\.0\.1:5173 at 390 px$/);
  const here = rig({ detect: { ...READY, startedHere: true } }); await here.self.dckArrive('acme-site');
  assert.match(here.vals().dckReadyText, /started from this app/);
});

test('nothing answering is an honest state with the type-an-address field; no saved command is a hint, not a dead end', async () => {
  const { self, vals } = rig({ detect: { ...NOTHING, hasCommand: false } });
  await self.dckArrive('acme-site');
  const v = vals();
  assert.deepEqual([v.dckNothing, v.dckReady, v.dckNoCommand, v.dckUrl], [true, false, true, '']);
  assert.equal(v.dckNothingText, 'Nothing answered on the usual local ports. Start the dev server (from this page when the project has a dev command) or type its address.');
  assert.match(v.dckNoCommandText, /only the usual framework ports were tried/);
  assert.equal(v.dckRunOff, true, 'Check waits for an address');
  self.dckField('http://localhost:3000');
  assert.deepEqual([vals().dckUrl, vals().dckRunOff], ['http://localhost:3000', false]);
  assert.match(tpl, /aria-label="Dev server address on this PC"/, 'the field is always in the template');
});

test('the owner confirms the URL: Check sends the field as typed, once per click, and counts one use', async () => {
  const { self, calls, vals } = rig();
  await self.dckArrive('acme-site');
  self.dckField('  http://127.0.0.1:4000 ');
  const a = self.dckRun(), b = self.dckRun();
  assert.equal(vals().dckRunning, true); assert.equal(vals().dckRunLabel, 'Checking…'); assert.equal(vals().dckRunOff, true);
  await Promise.all([a, b]);
  assert.deepEqual(names(calls, 'run'), [['run', 'acme-site', 'http://127.0.0.1:4000']]);
  assert.deepEqual(names(calls, 'mark'), [['mark', 'delivery-check', 'act']]);
  assert.equal(vals().dckHasReport, true); assert.equal(vals().dckRunning, false);
  await self.dckRun();   // the guard released: the next deliberate Check goes through
  assert.equal(names(calls, 'run').length, 2);
});

test('an empty field asks for an address and calls nothing', async () => {
  const { self, calls, toasts } = rig({ detect: NOTHING });
  await self.dckArrive('acme-site');
  await self.dckRun();
  assert.deepEqual(names(calls, 'run'), []);
  assert.deepEqual(toasts, [['error', 'Type the address of the dev server first']]);
});

test('main\'s refusal is shown in the block and never blanks a held report', async () => {
  const { self, vals } = rig({ read: REPORT(), run: () => ({ error: 'Only a dev server on this PC can be checked.' }) });
  await self.dckArrive('acme-site');
  self.dckField('https://acme.example.test');
  await self.dckRun();
  const v = vals();
  assert.deepEqual([v.dckHasErr, v.dckErr, v.dckHasReport], [true, 'Only a dev server on this PC can be checked.', true]);
  self.dckField('http://127.0.0.1:5173');
  assert.equal(vals().dckHasErr, false, 'typing clears the old error');
  const thrower = rig({ run: () => { throw new Error('ipc closed'); } });
  await thrower.self.dckArrive('acme-site'); await thrower.self.dckRun();
  assert.equal(thrower.vals().dckErr, 'ipc closed'); assert.equal(thrower.vals().dckBusy, false);
});

test('the report: findings with level tags, the heuristics labelled, routes, blocked line, shots count', async () => {
  const { self, vals } = rig({ read: REPORT({ notes: ['No language switch found, so nothing was checked per language'] }) });
  await self.dckArrive('acme-site');
  const v = vals();
  assert.deepEqual(v.dckFindings.map((f) => [f.tag, f.route]), [['to fix', '/'], ['to look at', '/'], ['heuristic · may be wrong', '/fr']]);
  assert.equal(v.dckFindings[2].hasSamples, true); assert.equal(v.dckFindings[2].samplesText, 'Welcome to Acme');
  assert.deepEqual([v.dckClean, v.dckHasFindings, v.dckHasRoutes], [false, true, true]);
  assert.equal(v.dckBlockedLine, '4 outside requests blocked (fonts.example.test)');
  assert.equal(v.dckHasNotes, true); assert.equal(v.dckShotsLine, '2 phone-size screenshots saved in data/delivery/shots on this PC');
  assert.match(v.dckSummary, /1 heuristic \(may be wrong\)/);
  const clean = rig({ read: REPORT({ findings: [], counts: { problem: 0, headsUp: 0, heuristic: 0 }, summary: 'Nothing found · 2 pages at 390 px' }) });
  await clean.self.dckArrive('acme-site');
  assert.deepEqual([clean.vals().dckClean, clean.vals().dckHasFindings], [true, false]);
  // a damaged stored report is not shown
  const bad = rig({ read: { v: 2 } }); await bad.self.dckArrive('acme-site');
  assert.equal(bad.vals().dckHasReport, false);
  const many = rig({ read: REPORT({ findings: Array.from({ length: 55 }, (_, i) => ({ id: 'x', level: 'heads-up', route: '/', text: 't' + i })) }) });
  await many.self.dckArrive('acme-site');
  assert.equal(many.vals().dckFindings.length, 40); assert.equal(many.vals().dckFindingsMore, '+15 more not shown');
});

test('Forget results deletes through main once and clears the report', async () => {
  const { self, calls, vals } = rig({ read: REPORT() });
  await self.dckArrive('acme-site');
  await Promise.all([self.dckForget(), self.dckForget()]);
  assert.deepEqual(names(calls, 'forget'), [['forget', 'acme-site']]);
  assert.equal(vals().dckHasReport, false);
});

test('a late answer for a project the owner already left is dropped', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { self, vals } = rig({ gate });
  await self.dckArrive('acme-site');
  self.dckField('http://127.0.0.1:5173');
  const pending = self.dckRun();
  self.state = { ...self.state, route: { type: 'project', id: 'beta-site' } };   // navigated away mid-check
  await self.dckArrive('beta-site');
  release(); await pending;
  assert.equal(self.state.dck.pid, 'beta-site');
  assert.equal(self.state.dck.report, null, 'the other project\'s report did not land on this page');
  assert.equal(vals().dckHasReport, false);
});

test('without the bridge a guarded action says so and calls nothing; the block names the missing module', async () => {
  const { self, calls, toasts, vals } = rig({ noBridge: true });
  await self.dckRun(); await self.dckForget(); await self.dckDetect();
  assert.deepEqual(calls, []);
  assert.ok(toasts.every((t) => t[0] === 'error' || t[0] === 'denied'));
  const v = vals();
  assert.deepEqual([v.dckShow, v.dckOffline, v.dckReady, v.dckNothing], [true, true, false, false]);
});
