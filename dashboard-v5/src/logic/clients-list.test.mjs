// Projects › Clients: the sort, every empty / error / not-in-scan state, Open card routing, no read at boot, and a static check that
// every key the template reads exists in the vals. Rig in the sessions-board.test.mjs style: a never-mounted object over the real
// mixin and vals, a fake hq. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/clients-list.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientsListLogic, sortClients, clsCleanRow, clsCleanRows, clsLeft, CLS_OFF, CLS_SURFACE, LINK_STATES } from './clients-list.js';
import { clientsVals, clsAgo, CLS_LINK, CLS_EMPTY_TEXT } from '../vals/clients-list.js';
import tpl from '../tpl/clients-list.tpl.js';

process.env.TZ = 'UTC';
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const DAY = 24 * 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const ago = (days) => iso(Date.now() - days * DAY);
const row = (id, o = {}) => ({ id, name: id.toUpperCase(), mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: true, ...o });
// the three invented clients of the fixture + one gone from the scan
const THREE = [
  row('half', { name: 'Half Site', done: 4, total: 9, linkState: 'ready-production', lastCopyAt: ago(3) }),
  row('done', { name: 'Done Site', done: 5, total: 5, linkState: 'ready-preview', lastCopyAt: ago(1) }),
  row('bare', { name: 'Bare Site' }),
];
const answer = (rows, o = {}) => ({ clients: rows, generatedAt: iso(Date.now()), omitted: 0, ...o });

function rig(o = {}) {
  const calls = [], toasts = [], marks = [], opened = [];
  const self = Object.assign(Object.create(clientsListLogic), {
    state: { tab: 'projects', sub: { projects: 'clients' }, route: null, cls: o.cls || {}, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    ps: () => (o.noBridge ? 'nobridge' : 'live'),
    toast: (k, t) => toasts.push([k, t]),
    hq: o.noBridge || o.noMethod ? (o.noMethod ? { delivery: { read() {} } } : null) : { delivery: { clients: async () => { calls.push('clients'); await (o.gate || Promise.resolve()); if (o.reject) throw new Error('bridge down'); return o.reply === undefined ? answer(THREE) : typeof o.reply === 'function' ? o.reply(calls.length) : o.reply; } } },
    proj: (id) => (o.known ? o.known.includes(id) : true) ? { id } : null,
    openProject: (id) => opened.push(id),
    useMark: o.noMark ? undefined : (s, a) => marks.push(s + '/' + a),
  });
  const vals = () => clientsVals.call(self, { S: self.state });
  return { self, calls, toasts, marks, opened, vals };
}

// ------------------------------------------------------------------ sort
test('sort: most left to do first, then the oldest update (never copied first), then name; gone-from-scan last', () => {
  const rows = [
    row('c', { name: 'Cee', done: 1, total: 3, lastCopyAt: ago(2) }),      // 2 left
    row('a', { name: 'Ay', done: 0, total: 5, lastCopyAt: ago(1) }),       // 5 left, copied yesterday
    row('b', { name: 'Bee', done: 0, total: 5, lastCopyAt: ago(9) }),      // 5 left, copied 9 days ago -> before Ay
    row('n', { name: 'Never', done: 0, total: 5 }),                        // 5 left, never copied -> first of the 5s
    row('z', { name: 'Zed', done: 3, total: 3 }),                          // 0 left, never copied
    row('y', { name: 'Yak', done: 2, total: 2, lastCopyAt: ago(5) }),      // 0 left
    row('x', { name: 'Xi' }),                                              // no scope: 0 left, never copied
    row('w', { name: 'Gone', inScan: false, lastCopyAt: ago(40) }),
  ];
  assert.deepEqual(sortClients(rows).map((r) => r.id), ['n', 'b', 'a', 'c', 'x', 'z', 'y', 'w']);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b', 'n', 'z', 'y', 'x', 'w'], 'the input is not reordered');
  // equal on everything but the name, then on the id
  assert.deepEqual(sortClients([row('2', { name: 'same' }), row('1', { name: 'same' }), row('3', { name: 'Aaa' })]).map((r) => r.id), ['3', '1', '2']);
  assert.deepEqual(sortClients([]), []);
  assert.equal(clsLeft(clsCleanRow({ id: 'q', done: 9, total: 4 })), 0, 'left never goes below zero through clean rows');
  assert.equal(clsLeft(row('q', { done: 1, total: 4, inScan: false })), 0, 'a client gone from the scan has nothing to count');
});

test('clean rows: junk from main never reaches the screen', () => {
  assert.equal(clsCleanRow(null), null);
  assert.equal(clsCleanRow({ name: 'no id' }), null);
  assert.equal(clsCleanRow({ id: '' }), null);
  const c = clsCleanRow({ id: 'x', name: 5, done: 'many', total: -3, linkState: 'weird', lastCopyAt: 'not a date', fileState: 7, inScan: 'yes' });
  assert.deepEqual(c, { id: 'x', name: 'x', mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: true });
  assert.deepEqual(clsCleanRow({ id: 'x', done: 9, total: 4 }).done, 4, 'done cannot exceed total');
  assert.equal(clsCleanRow({ id: 'x', inScan: false }).inScan, false);
  assert.deepEqual(clsCleanRows('nope'), []);
  assert.equal(clsCleanRows([{ id: 'a' }, null, 3, { id: 'b' }]).length, 2);
  assert.deepEqual(LINK_STATES, ['ready-production', 'ready-preview', 'not-ready', 'none']);
});

// ------------------------------------------------------------------ reading
test('no read at boot: building the component reads nothing, and arriving anywhere but Projects › Clients reads nothing', async () => {
  const { self, calls, marks } = rig();
  assert.deepEqual(calls, []);
  for (const state of [{ tab: 'home', sub: {} }, { tab: 'projects', sub: { projects: 'grid' } }, { tab: 'claude', sub: { claude: 'sessions' } }, { tab: 'projects', sub: { projects: 'accounts' } }]) {
    const r = rig({ state });
    assert.equal(await r.self.clsArrive(), null);
    assert.deepEqual([r.calls, r.marks], [[], []]);
  }
  assert.deepEqual(marks, []);
  assert.equal(self.state.cls.loaded, undefined);
});

test('arriving on Clients reads once, marks the surface once, and shows the three rows in sort order', async () => {
  const { self, calls, marks, vals } = rig();
  assert.equal(vals().clsLoading, true, 'before the answer: reading');
  const p = self.clsArrive();
  assert.equal(vals().clsRetryLabel, 'Reading…');
  assert.equal(vals().clsRetryOff, true);
  await p;
  assert.deepEqual(calls, ['clients']);
  assert.deepEqual(marks, [CLS_SURFACE + '/open']);
  const v = vals();
  assert.deepEqual([v.clsLoading, v.clsError, v.clsEmpty, v.clsReady, v.clsRetryOff, v.clsRetryLabel], [false, false, false, true, false, 'Refresh']);
  assert.deepEqual(v.clsRows.map((r) => r.name), ['Half Site', 'Bare Site', 'Done Site']);
  assert.equal(v.clsSummary, '3 client jobs · 1 with work left');
  const half = v.clsRows[0];
  assert.deepEqual([half.statusText, half.hasBar, half.barLabel, half.linkText, half.updateText, half.canOpen, half.notInScan], ['4 of 9 done', true, '4 of 9 done · 5 left', 'link ready · production', 'last copied 3 days ago', true, false]);
  const bare = v.clsRows[1];
  assert.deepEqual([bare.statusText, bare.hasBar, bare.linkText, bare.updateText], ['no scope yet', false, 'no link yet', 'never copied']);
  const done = v.clsRows[2];
  assert.deepEqual([done.statusText, done.linkText, done.updateText, done.barStyle.width, done.barStyle.background], ['5 of 5 done', 'link ready · preview', 'last copied 1 day ago', '100%', 'var(--green)']);
});

test('the sub-view marks nothing where hq.use is absent, and a throwing mark never blocks the read', async () => {
  const a = rig({ noMark: true });
  await a.self.clsArrive();
  assert.equal(a.self.state.cls.rows.length, 3);
  const b = rig();
  b.self.useMark = () => { throw new Error('boom'); };
  await b.self.clsArrive();
  assert.equal(b.self.state.cls.rows.length, 3);
});

test('empty: no client marked yet says so, in the one honest line', async () => {
  const { self, vals } = rig({ reply: answer([]) });
  await self.clsArrive();
  const v = vals();
  assert.deepEqual([v.clsEmpty, v.clsEmptyText, v.clsReady, v.clsError, v.clsLoading, v.clsSummary, v.clsRows], [true, 'No client jobs yet. Mark one on a project page.', false, false, false, '', []]);
  assert.equal(CLS_EMPTY_TEXT, 'No client jobs yet. Mark one on a project page.');
});

test('error: the service not answering is an error line with Retry; Retry reads again and recovers', async () => {
  let n = 0;
  const { self, calls, vals } = rig({ reply: () => (++n === 1 ? { error: 'the client delivery file is damaged' } : answer(THREE)) });
  await self.clsArrive();
  let v = vals();
  assert.deepEqual([v.clsError, v.clsErrorText, v.clsLoading, v.clsReady, v.clsEmpty, v.clsRetryLabel, v.clsRetryOff], [true, 'the client delivery file is damaged', false, false, false, 'Retry', false]);
  v.clsRetry();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 2);
  v = vals();
  assert.deepEqual([v.clsError, v.clsReady, v.clsRows.length], [false, true, 3]);
});

test('error: a rejected call and a junk answer are errors too, never a blank or empty list', async () => {
  const a = rig({ reject: true });
  await a.self.clsArrive();
  assert.deepEqual([a.vals().clsError, a.vals().clsErrorText, a.vals().clsEmpty], [true, 'bridge down', false]);
  for (const reply of [null, 'nope', {}, { clients: 'x' }, { error: '' }]) {
    const r = rig({ reply });
    await r.self.clsArrive();
    assert.equal(r.vals().clsError, true, JSON.stringify(reply));
    assert.equal(r.vals().clsEmpty, false);
    assert.equal(r.vals().clsErrorText, 'The client list could not be read');
  }
});

test('a later error keeps the list that was already read and says so above it', async () => {
  let n = 0;
  const { self, vals } = rig({ reply: () => (++n === 1 ? answer(THREE) : { error: 'the scan is not available' }) });
  await self.clsArrive();
  await self.clsRead();
  const v = vals();
  assert.deepEqual([v.clsError, v.clsReady, v.clsRows.length], [true, true, 3]);
  assert.equal(v.clsErrorText, 'the scan is not available — showing the list from the last read');
  assert.equal(v.clsRetryLabel, 'Refresh');
});

test('a double click on Retry is one call', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { self, calls } = rig({ gate });
  const a = self.clsRead(), b = self.clsRead();
  assert.equal(await b, null);
  release();
  await a;
  assert.equal(calls.length, 1);
});

test('no bridge (no hq, a preview without the method, a bridgeless window): offline, nothing is called', async () => {
  for (const o of [{ noBridge: true }, { noMethod: true }]) {
    const r = rig(o);
    assert.deepEqual(await r.self.clsArrive(), { error: CLS_OFF });
    const v = r.vals();
    assert.deepEqual([v.clsOffline, v.clsLoading, v.clsError, v.clsRetryOff, v.clsShow], [true, false, false, true, true]);
    assert.match(v.clsOfflineText, /needs the desktop app/);
    assert.deepEqual(r.calls, []);
  }
});

test('the omitted count (the cap of 50) is told under the list', async () => {
  const { self, vals } = rig({ reply: answer(THREE, { omitted: 3 }) });
  await self.clsArrive();
  const v = vals();
  assert.deepEqual([v.clsHasOmitted, v.clsOmittedText], [true, '3 more client jobs not shown — the list stops at 50']);
  const one = rig({ reply: answer(THREE, { omitted: 1 }) });
  await one.self.clsArrive();
  assert.equal(one.vals().clsOmittedText, '1 more client job not shown — the list stops at 50');
});

// ------------------------------------------------------------------ honest rows
test('a marked project gone from the latest scan: dimmed, named by its id, "not in the latest scan", no Open button, no service error', async () => {
  const { self, vals } = rig({ reply: answer([row('live', { done: 1, total: 2 }), row('delta-gone', { name: 'delta-gone', inScan: false, lastCopyAt: ago(10) })]) });
  await self.clsArrive();
  const v = vals();
  assert.equal(v.clsError, false);
  const gone = v.clsRows.find((r) => r.key === 'delta-gone');
  assert.deepEqual([gone.notInScan, gone.notInScanText, gone.canOpen, gone.hasStatus, gone.hasBar, gone.hasLink, gone.updateText, /opacity:\.6/.test(gone.rowStyle)], [true, 'not in the latest scan', false, false, false, false, 'last copied 10 days ago', true]);
  assert.equal(v.clsRows[1].key, 'delta-gone', 'sorted last');
  assert.equal(v.clsSummary, '2 client jobs · 1 with work left · 1 not in the latest scan');
  assert.ok(!/opacity/.test(v.clsRows[0].rowStyle));
});

test('a scope file that is gone or unreadable says so on its row instead of a bar', async () => {
  const states = { missing: 'scope file not found', outside: 'scope file is outside the project folder', 'too-big': 'scope file is over 64 KB', unreadable: 'scope file could not be read', odd: 'scope file problem' };
  for (const [fileState, text] of Object.entries(states)) {
    const { self, vals } = rig({ reply: answer([row('f', { fileState, done: 1, total: 4 })]) });
    await self.clsArrive();
    const r = vals().clsRows[0];
    assert.deepEqual([r.statusText, r.hasBar, r.canOpen], [text, false, true], fileState);
  }
  const ok = rig({ reply: answer([row('f', { fileState: 'ok', done: 1, total: 4 })]) });
  await ok.self.clsArrive();
  assert.equal(ok.vals().clsRows[0].statusText, '1 of 4 done');
});

test('link words: ready · production, ready · preview, not ready, no link yet', () => {
  assert.deepEqual(CLS_LINK, { 'ready-production': 'link ready · production', 'ready-preview': 'link ready · preview', 'not-ready': 'link not ready', none: 'no link yet' });
});

test('"last copied" in words: minutes, hours, one day, days, and an unreadable date', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(clsAgo('2026-11-10T11:59:50Z', now), '1 min ago');
  assert.equal(clsAgo('2026-11-10T11:30:00Z', now), '30 min ago');
  assert.equal(clsAgo('2026-11-10T07:00:00Z', now), '5 h ago');
  assert.equal(clsAgo('2026-11-09T11:00:00Z', now), '1 day ago');
  assert.equal(clsAgo('2026-11-07T10:00:00Z', now), '3 days ago');
  assert.equal(clsAgo('nonsense', now), 'a while ago');
  assert.equal(clsAgo('2026-11-11T12:00:00Z', now), '1 min ago', 'a clock a little ahead never reads as negative');
});

// ------------------------------------------------------------------ Open card
test('Open card goes to that project\'s page, counts one act, and only for a project the screen knows', async () => {
  const { self, vals, opened, marks, toasts } = rig({ known: ['half', 'done', 'bare'] });
  await self.clsArrive();
  const rows = vals().clsRows;
  rows.find((r) => r.key === 'bare').open();
  rows.find((r) => r.key === 'half').open();
  assert.deepEqual(opened, ['bare', 'half']);
  assert.equal(marks.filter((m) => m === CLS_SURFACE + '/act').length, 2);
  assert.equal(rows.find((r) => r.key === 'half').openLabel, 'Open card for Half Site');
  assert.equal(self.clsOpen(''), false);
  assert.equal(self.clsOpen('ghost'), false, 'not in the screen\'s snapshot: no blank page');
  assert.deepEqual(opened, ['bare', 'half']);
  assert.deepEqual(toasts, [['error', 'That project is not in the current scan']]);
});

// ------------------------------------------------------------------ other screens, keys, template
test('while another screen is open the vals are one frozen constant: nothing sorted, nothing read', async () => {
  const a = rig({ state: { tab: 'home', sub: {} }, cls: { rows: THREE } }).vals();
  const b = rig({ state: { tab: 'projects', sub: { projects: 'grid' } }, cls: { rows: THREE } }).vals();
  assert.equal(a, b);
  assert.deepEqual([a.clsShow, a.clsRows, a.clsReady, a.clsLoading], [false, [], false, false]);
});

test('every key is cls-prefixed (one shared namespace with the other surfaces)', async () => {
  const states = [rig(), rig({ noBridge: true }), rig({ state: { tab: 'home', sub: {} } })];
  const ready = rig(); await ready.self.clsArrive(); states.push(ready);
  for (const r of states) for (const k of Object.keys(r.vals())) assert.match(k, /^cls[A-Z]/, k);
});

// dc-lite throws a "hole" for a key the vals do not provide; check that statically (the walk is the one in sessions-board.test.mjs)
function scanAll(t, vals) {
  const bad = new Set();
  const scopes = [];
  const re = /<sc-for\s+list="\{\{\s*([\w.]+)\s*\}\}"\s+as="(\w+)"|<\/sc-for>|\{\{\s*!?\s*([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[1]) { if (!(m[1] in vals)) bad.add(m[1]); scopes.push({ as: m[2], sample: (vals[m[1]] || [])[0] }); }
    else if (m[0] === '</sc-for>') scopes.pop();
    else {
      if (m[3] === 'true' || m[3] === 'false') continue;
      const [head, ...rest] = m[3].split('.');
      const scope = scopes.slice().reverse().find((s) => s.as === head);
      if (scope) { if (scope.sample && !(rest[0] in scope.sample)) bad.add(m[3]); }
      else if (!(head in vals)) bad.add(m[3]);
    }
  }
  return [...bad];
}

test('the template reads only keys the vals provide, in every state (rows, empty, error, loading, offline, gone-from-scan, hidden)', async () => {
  const mix = rig({ reply: answer([...THREE, row('delta-gone', { inScan: false }), row('f', { fileState: 'missing', total: 2 })], { omitted: 2 }) });
  await mix.self.clsArrive();
  const empty = rig({ reply: answer([]) }); await empty.self.clsArrive();
  const err = rig({ reply: { error: 'x' } }); await err.self.clsArrive();
  const states = [mix.vals(), empty.vals(), err.vals(), rig().vals(), rig({ noBridge: true }).vals(), rig({ state: { tab: 'home', sub: {} } }).vals()];
  for (const v of states) assert.deepEqual(scanAll(tpl, v), []);
  assert.ok(tpl.includes('Open card'));
  assert.ok(tpl.includes('data-cls="list"'));
});

test('the template uses tokens only: no raw colours except the gold button ink', () => {
  const raw = (tpl.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []).filter((c) => c.toLowerCase() !== '#1a0f0a');
  assert.deepEqual(raw, []);
  const mixRaw = clientsVals.toString().match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
  assert.deepEqual(mixRaw, [], 'and the vals');
});
