// System › Machine › "How the PC changed": the reads, the honest states, the opt-in estimate, the render values, and a static check that
// every key the template reads exists in the vals. Rig in the logic/sessions-board.test.mjs style: a never-mounted object over the real
// mixin and vals, a fake window.hq. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/drift.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { driftLogic, dftInit, cleanDisk, DFT_SURFACE } from './drift.js';
import { driftVals, diskLineText, DFT_EMPTY } from '../vals/drift.js';
import tpl from '../tpl/drift.tpl.js';
import { driftStates, inventedHistory, inventedAnswer, PARTIAL_DISK_NOTE, DRIFT_OFFLINE_ROWS } from '../selftest-drift.mjs';
import { parseLocal, estimateDisk } from '../live/machine-history.mjs';
import { createRequire } from 'node:module';

const pad = (n) => String(n).padStart(2, '0');
function at(i, stepH = 6) {
  const d = new Date(Date.UTC(2026, 10, 1, 6 + i * stepH, 0, 0));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}
const hist = (n, f = () => ({}), stepH = 6) => Array.from({ length: n }, (_, i) => ({ at: at(i, stepH), cpu: 20, ram: 60, diskFreeGB: 130 - i * 2, startup: 10, temp: 3, pingMs: 10, updateDays: 3, ...f(i) }));
const answer = (rows, o = {}) => ({ ok: true, rows, disk: { lines: [], note: 'needs two days of readings' }, counts: { rows: rows.length, dropped: 0, diskDays: 0 }, ...o });
const tick = () => new Promise((r) => setTimeout(r, 5));

function rig(o = {}) {
  const calls = [], marks = [];
  let inflight = 0, maxInflight = 0;
  const reply = typeof o.reply === 'function' ? o.reply : () => (o.reply === undefined ? answer(hist(40)) : o.reply);
  const self = Object.assign(Object.create(driftLogic), {
    state: { tab: 'system', sub: { system: 'machine' }, route: null, sysExamining: false, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    hq: o.noBridge ? null : { machineHistory: { read: async () => { calls.push('read'); inflight++; maxInflight = Math.max(maxInflight, inflight); try { if (o.gate) await o.gate(calls.length); if (o.reject) throw new Error('bridge down'); return reply(calls.length); } finally { inflight--; } } } },
    useMark: o.noMark ? undefined : (n, a) => marks.push(a && a !== 'open' ? n + '/' + a : n),
  });
  const ctx = (extra = {}) => ({ S: self.state, v: { system: true }, sub: 'machine', ...extra });
  const vals = (extra) => driftVals.call(self, ctx(extra)).dftv;   // the 22 dft* keys ride under ONE top-level key (renderVals key ceiling)
  return { self, calls, marks, vals, stats: () => ({ maxInflight }) };
}
const open = async (r) => { r.vals(); await tick(); return r.vals(); };

test('the surface adds exactly ONE top-level key to renderVals (the key ceiling), dftv', () => {
  const r = rig();
  const top = driftVals.call(r.self, { S: r.self.state, v: { system: true }, sub: 'machine' });
  assert.deepEqual(Object.keys(top), ['dftv']);
  const off = driftVals.call(r.self, { S: r.self.state, v: { system: false }, sub: undefined });
  assert.deepEqual(Object.keys(off), ['dftv']);
  assert.equal(Object.keys(top.dftv).length, 22);
});

test('every key is dft-prefixed, shown and hidden (one shared namespace with the other surfaces)', async () => {
  const r = rig();
  for (const k of Object.keys(r.vals())) assert.match(k, /^dft[A-Z]/, k);
  await tick();
  const ready = r.vals();
  for (const k of Object.keys(ready)) assert.match(k, /^dft[A-Z]/, k);
  for (const k of Object.keys(ready.dftCharts[0])) assert.ok(typeof k === 'string');
  const hidden = rig({ state: { tab: 'home', sub: {} } }).vals({ v: { system: false }, sub: undefined });
  for (const k of Object.keys(hidden)) assert.match(k, /^dft[A-Z]/, k);
});

test('while the owner is elsewhere the panel is ONE frozen constant: no read, no mark, and the next opening is re-armed', async () => {
  const r = rig({ state: { tab: 'home', sub: {} } });
  const a = r.vals({ v: { system: false }, sub: undefined }), b = r.vals({ v: { system: false }, sub: undefined });
  assert.equal(a, b);
  assert.ok(Object.isFrozen(a));
  assert.equal(a.dftShow, false);
  await tick();
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.marks, []);
  const clutter = rig().vals({ sub: 'clutter' });
  assert.equal(clutter.dftShow, false, 'System › Clutter is not the Machine panel');
});

test('no bridge: an honest offline line, nothing read, nothing broken', async () => {
  const r = rig({ noBridge: true });
  const v = r.vals();
  assert.equal(v.dftShow, true);
  assert.equal(v.dftOffline, true);
  assert.match(v.dftOfflineText, /needs the desktop app/);
  assert.equal(v.dftLoading, false);
  assert.equal(v.dftReady, false);
  assert.equal(v.dftRefreshOff, true);
  assert.equal(await r.self.dftLoad(), false);
  assert.equal(r.self.dftCan(), false);
});

test('opening the panel reads exactly once (never at boot, never per render); closing re-arms; the usage mark is one per arrival', async () => {
  const r = rig();
  assert.equal(r.calls.length, 0, 'nothing is read until the panel is rendered');
  const first = r.vals();
  assert.equal(first.dftLoading, true);
  assert.equal(first.dftReady, false);
  r.vals(); r.vals();
  await tick();
  assert.equal(r.calls.length, 1, 'three renders, one read');
  const v = r.vals();
  assert.equal(v.dftReady, true);
  assert.equal(v.dftLoading, false);
  assert.ok(r.marks.every((m) => m === DFT_SURFACE), JSON.stringify(r.marks));
  r.vals({ v: { system: false }, sub: undefined });   // leave
  r.vals(); await tick();
  assert.equal(r.calls.length, 2, 'the next opening reads fresh');
});

test('Re-examine finishing re-reads the history once; one still running does not', async () => {
  const r = rig();
  await open(r);
  assert.equal(r.calls.length, 1);
  r.self.setState({ sysExamining: true });
  r.vals(); r.vals(); await tick();
  assert.equal(r.calls.length, 1, 'while it runs nothing more is read');
  r.self.setState({ sysExamining: false });
  r.vals(); r.vals(); await tick();
  assert.equal(r.calls.length, 2, 'finished: one more read');
});

test('a read that overlaps another is queued, never run at the same time', async () => {
  let release; const first = new Promise((res) => { release = res; });
  const r = rig({ gate: (n) => (n === 1 ? first : undefined) });
  const a = r.self.dftLoad();
  const b = r.self.dftLoad();
  assert.equal(await b, false, 'the second call is told it did not read');
  release();
  assert.equal(await a, true);
  assert.equal(r.calls.length, 2, 'and one more read followed the first');
  assert.equal(r.stats().maxInflight, 1);
});

test('a failed read says why; with no rows held it is an error, with rows held the last ones stay on screen', async () => {
  const r = rig({ reply: () => ({ error: 'the machine history file is not valid JSON' }) });
  const v = await open(r);
  assert.equal(v.dftHasErr, true);
  assert.match(v.dftErrText, /^Couldn’t read the history · the machine history file is not valid JSON/);
  assert.equal(v.dftReady, false);
  assert.equal(v.dftLoading, false);
  assert.equal(v.dftEmpty, false);

  let n = 0;
  const k = rig({ reply: () => (++n === 1 ? answer(hist(10)) : { error: 'denied' }) });
  const ok = await open(k);
  assert.equal(ok.dftCharts.length, 7);
  await k.self.dftLoad();
  const kept = k.vals();
  assert.equal(kept.dftCharts.length, 7, 'the last good readings are not blanked');
  assert.match(kept.dftErrText, /Couldn’t refresh the history · denied · the last readings stay on screen/);
});

test('a rejected read and an answer with no ok are errors in words, not crashes', async () => {
  const rej = rig({ reject: true });
  assert.match((await open(rej)).dftErrText, /bridge down/);
  const junk = rig({ reply: () => ({ rows: [] }) });
  assert.match((await open(junk)).dftErrText, /no answer/);
  const nothing = rig({ reply: () => null });
  assert.match((await open(nothing)).dftErrText, /no answer/);
});

test('no checks kept yet is said, not drawn as empty charts', async () => {
  const r = rig({ reply: () => answer([]) });
  const v = await open(r);
  assert.equal(v.dftEmpty, true);
  assert.equal(v.dftEmptyText, DFT_EMPTY);
  assert.equal(v.dftReady, false);
  assert.deepEqual(v.dftCharts, []);
});

test('ready: seven chart cards in order with their counts, text twins and no GPU anything', async () => {
  const r = rig({ reply: () => answer(hist(40, (i) => ({ pingMs: i % 10 === 4 ? 0 : 10 + i, cpu: i === 7 ? null : 20 }))) });
  const v = await open(r);
  assert.equal(v.dftReady, true);
  assert.deepEqual(v.dftCharts.map((c) => c.id), ['disk', 'ram', 'cpu', 'temp', 'ping', 'startup', 'updates']);
  assert.deepEqual(v.dftCharts.map((c) => c.title), ['Free disk (GB)', 'RAM in use (%)', 'CPU load (%)', 'Temp files (GB)', 'Ping (ms)', 'Startup apps', 'Days since updates']);
  assert.match(v.dftSummary, /^40 checks · Nov 1 – Nov 11 · only the last 96 checks are kept$/);
  for (const c of v.dftCharts) {
    assert.match(c.countText, /^40 checks over \d+ days$/, c.id);
    assert.ok(c.text.startsWith(c.title), c.id);
    assert.equal(c.hasPath, true, c.id);
  }
  const ping = v.dftCharts.find((c) => c.id === 'ping');
  assert.match(ping.text, /4 checks with no reading/);
  assert.equal(ping.hasNote, true);
  assert.ok(!/gpu|driver|battery/i.test(JSON.stringify(v.dftCharts.map((c) => [c.title, c.text, c.noteText]))));
});

test('the charts are memoised on the rows: a re-render with the same rows draws nothing again', async () => {
  const r = rig();
  await open(r);
  const first = r.self._dftMemo;
  assert.ok(first && first.charts.length === 7);
  r.vals(); r.vals();
  assert.equal(r.self._dftMemo, first);
  await r.self.dftLoad();
  r.vals();
  assert.notEqual(r.self._dftMemo, first, 'fresh rows from main redraw');
});

test('the disk lines: what grew in words, or why not; hidden until main has answered', async () => {
  assert.equal(diskLineText({ label: 'alpha', deltaGB: 4.25, days: 7 }), 'alpha +4.3 GB in 7 days');
  assert.equal(diskLineText({ label: 'beta', deltaGB: 0.1, days: 1 }), 'beta +0.1 GB in 1 day');
  const none = rig({ reply: () => answer(hist(3)) });
  assert.equal(none.vals().dftDiskShow, false, 'not before the first answer');
  await tick();
  const v = none.vals();
  assert.equal(v.dftDiskShow, true);
  assert.equal(v.dftHasDiskLines, false);
  assert.equal(v.dftHasDiskNote, true);
  assert.equal(v.dftDiskNote, 'needs two days of readings');
  const lines = rig({ reply: () => answer(hist(3), { disk: { lines: [{ label: 'alpha', deltaGB: 5, days: 7 }, { label: 'beta', deltaGB: 1.5, days: 7 }], note: '' } }) });
  const w = await open(lines);
  assert.equal(w.dftHasDiskLines, true);
  assert.deepEqual(w.dftDiskLines, [{ text: 'alpha +5.0 GB in 7 days' }, { text: 'beta +1.5 GB in 7 days' }]);
  assert.equal(w.dftHasDiskNote, false, 'lines and a "why not" never show together');
});

test('cleanDisk keeps lines of label / GB / days only and at most five', () => {
  const c = cleanDisk({ lines: [{ label: 'alpha', deltaGB: 2, days: 7, path: 'C:\\placeholder' }, { label: '', deltaGB: 1, days: 1 }, { label: 'x', deltaGB: 'big', days: 1 }, null,
    ...Array.from({ length: 8 }, (_, i) => ({ label: 'f' + i, deltaGB: i + 1, days: 0 }))], note: 'n', extra: 1 });
  assert.equal(c.lines.length, 5);
  assert.deepEqual(c.lines[0], { label: 'alpha', deltaGB: 2, days: 7 });
  assert.equal(c.lines[1].days, 1, 'a zero gap is shown as 1 day, never "in 0 days"');
  assert.deepEqual(cleanDisk(null), { lines: [], note: '' });
});

test('Estimate is opt-in: nothing before the click; 40 six-hourly checks refuse in words; pressing again hides it', async () => {
  const r = rig();   // 40 checks 6 h apart = under ten days
  let v = await open(r);
  assert.equal(v.dftCharts[0].hasEst, false, 'no estimate before the owner asks');
  assert.equal(v.dftCharts[0].isDisk, true);
  assert.equal(v.dftCharts.filter((c) => c.isDisk).length, 1, 'only the disk chart carries the button');
  assert.equal(v.dftCharts[0].estLabel, 'Estimate');
  const est = v.dftCharts[0].est();
  assert.equal(est.ok, false);
  v = r.vals();
  assert.equal(v.dftCharts[0].hasEst, true);
  assert.match(v.dftCharts[0].estText, /at least 14 days/);
  assert.equal(v.dftCharts[0].estLabel, 'Hide estimate');
  assert.equal(v.dftCharts[0].estPressed, true);
  assert.equal(v.dftCharts[0].estStyle.color, 'var(--muted)');
  assert.ok(r.marks.includes(DFT_SURFACE + '/act'));
  v.dftCharts[0].est();
  assert.equal(r.vals().dftCharts[0].hasEst, false);
});

test('Estimate with enough falling data answers in "about N days of room, if nothing changes" and never "will run out"', async () => {
  const r = rig({ reply: () => answer(hist(30, (i) => ({ diskFreeGB: 130 - i * 2 }), 24)) });
  const v = await open(r);
  v.dftCharts[0].est();
  const d = r.vals().dftCharts[0];
  assert.equal(d.estText, 'At this pace there would be about 36 days of room, if nothing changes.');
  assert.equal(d.hasEstBasis, true);
  assert.equal(d.estStyle.color, 'var(--text)');
  assert.ok(!/will run out/i.test(JSON.stringify(d)));
});

test('fresh rows from main drop an estimate that was made on the old ones', async () => {
  const r = rig({ reply: () => answer(hist(30, (i) => ({ diskFreeGB: 130 - i * 2 }), 24)) });
  const v = await open(r);
  v.dftCharts[0].est();
  assert.equal(r.vals().dftCharts[0].hasEst, true);
  await r.self.dftLoad();
  assert.equal(r.vals().dftCharts[0].hasEst, false);
});

test('a bridge without a usage mark still works', async () => {
  const r = rig({ noMark: true });
  const v = await open(r);
  assert.equal(v.dftReady, true);
  v.dftCharts[0].est();
});

test('dftInit is a fresh object each time', () => {
  const a = dftInit(), b = dftInit();
  assert.notEqual(a, b);
  assert.deepEqual(a, { rows: null, disk: null, counts: null, loaded: false, busy: false, error: '', est: null });
});

// ------------------------------------------------------------------ the template
// dc-lite throws a "hole" for a key the vals do not provide; check that statically. Walks the raw template in order, tracking sc-for scopes.
const getPath = (o, p) => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
const hasPath = (o, p) => getPath(o, p) !== undefined;
function scanAll(t, vals) {
  const bad = new Set();
  const scopes = [];
  const re = /<sc-for\s+list="\{\{\s*([\w.]+)\s*\}\}"\s+as="(\w+)"|<\/sc-for>|\{\{\s*!?\s*([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[1]) { if (!hasPath(vals, m[1])) bad.add(m[1]); scopes.push({ as: m[2], sample: (getPath(vals, m[1]) || [])[0] }); }
    else if (m[0] === '</sc-for>') scopes.pop();
    else {
      if (m[3] === 'true' || m[3] === 'false') continue;
      const [head, ...rest] = m[3].split('.');
      const scope = scopes.slice().reverse().find((s) => s.as === head);
      if (scope) { if (scope.sample && !(rest[0] in scope.sample)) bad.add(m[3]); }
      else if (!hasPath(vals, m[3])) bad.add(m[3]);   // dotted paths walk the vals (the dftv key)
    }
  }
  return [...bad];
}

test('the template reads only keys the vals provide, in every state', async () => {
  const states = [
    rig({ state: { tab: 'home', sub: {} } }).vals({ v: { system: false }, sub: undefined }),
    rig({ noBridge: true }).vals(),
    rig().vals(),                                                                   // loading
    await open(rig()),                                                              // ready, 40 checks
    await open(rig({ reply: () => answer([]) })),                                   // empty
    await open(rig({ reply: () => ({ error: 'x' }) })),                             // error
    await open(rig({ reply: () => answer(hist(3), { disk: { lines: [{ label: 'alpha', deltaGB: 5, days: 7 }], note: '' } }) })),
  ];
  const withEst = rig({ reply: () => answer(hist(30, (i) => ({ diskFreeGB: 130 - i * 2 }), 24)) });
  const w = await open(withEst); w.dftCharts[0].est(); states.push(withEst.vals());
  for (const v of states) assert.deepEqual(scanAll(tpl, { dftv: v }), []);
  assert.ok(tpl.includes('How the PC changed') || states[0].dftTitle === 'How the PC changed');
});

test('the template is balanced, wraps itself in dftShow, and uses tokens only (no raw colour)', () => {
  for (const tag of ['sc-if', 'sc-for', 'section', 'svg', 'button']) {
    const open = (tpl.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length, close = (tpl.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    assert.equal(open, close, tag + ' open/close');
  }
  const divs = (tpl.match(/<div[\s>]/g) || []).length, endDivs = (tpl.match(/<\/div>/g) || []).length;
  assert.equal(divs, endDivs, 'div open/close');
  assert.match(tpl.trimStart(), /^<!-- v5: Machine drift/);
  assert.ok(tpl.includes('value="{{ dftv.dftShow }}"'));
  assert.deepEqual((tpl.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []), []);
  assert.ok(!/will run out/i.test(tpl));
});

// ------------------------------------------------------------------ the selftest states and the invented history
const require = createRequire(import.meta.url);

test('the invented history is deterministic, awkward on purpose and entirely placeholder', () => {
  const a = inventedHistory(40), b = inventedHistory(40);
  assert.deepEqual(a, b);
  assert.equal(a.length, 40);
  assert.ok(a.every((r) => Number.isFinite(parseLocal(r.at))), 'every time parses as local time');
  assert.ok(a.some((r) => r.pingMs === 0), 'a zero ping');
  assert.ok(a.some((r) => r.cpu === null), 'a gap');
  assert.ok(a.some((r) => r.updateDays === 0), 'an unknown update age written as 0');
  assert.ok(!JSON.stringify(a).match(/gpu|battery|C:/i));
  const ans = inventedAnswer();
  assert.equal(ans.ok, true);
  assert.equal(ans.counts.rows, 40);
  assert.equal(estimateDisk(ans.rows).reason, 'short-span', 'the cdp scenario relies on this refusal');
});

test('PARTIAL_DISK_NOTE is exactly what main says for a partial-only disk history', () => {
  const DH = require('../../../dashboard/disk-history.js');
  const r = DH.diskLines([{ day: '2026-11-11', at: '2026-11-11T09:00:00.000Z', partial: true, items: [{ label: 'alpha', gb: 5 }] }]);
  assert.equal(r.note, PARTIAL_DISK_NOTE);
});

test('every selftest state renders through the real vals, in a state the owner could see', async () => {
  const rows = driftStates();
  assert.deepEqual(rows.map((r) => r[0]), ['drift-offline', 'drift-loading', 'drift-error', 'drift-error-with-rows', 'drift-empty', 'drift-ready', 'drift-ready-disk-lines', 'drift-estimate-refuses', 'drift-estimate-answers', 'drift-gap']);
  assert.deepEqual([...DRIFT_OFFLINE_ROWS], ['drift-offline']);
  const by = {};
  for (const [name, sub, live, dft, extra] of rows) {
    assert.equal(sub, 'machine', name);
    assert.equal(live, null, name);
    assert.deepEqual(extra, {}, name);
    const r = rig({ noBridge: name === 'drift-offline', state: { dft } });
    r.self._dftAsked = true;   // the caller holds the arrival read
    by[name] = r.vals();
    await tick();
    assert.equal(r.calls.length, 0, name + ' read nothing');
    for (const k of Object.keys(by[name])) assert.match(k, /^dft[A-Z]/);
    assert.deepEqual(scanAll(tpl, { dftv: by[name] }), [], name);
    assert.ok(!/undefined|\[object|NaN/.test(JSON.stringify(by[name], (k, v) => (typeof v === 'function' ? undefined : v))), name + ' has an unresolved value');
  }
  assert.equal(by['drift-offline'].dftOffline, true);
  assert.equal(by['drift-loading'].dftLoading, true);
  assert.equal(by['drift-error'].dftHasErr, true);
  assert.equal(by['drift-error'].dftReady, false);
  assert.equal(by['drift-error-with-rows'].dftReady, true);
  assert.equal(by['drift-error-with-rows'].dftHasErr, true);
  assert.equal(by['drift-empty'].dftEmpty, true);
  assert.equal(by['drift-ready'].dftCharts.length, 7);
  assert.match(by['drift-ready'].dftDiskNote, /partial/);
  assert.equal(by['drift-ready-disk-lines'].dftDiskLines.length, 3);
  assert.match(by['drift-estimate-refuses'].dftCharts[0].estText, /at least 14 days/);
  assert.match(by['drift-estimate-answers'].dftCharts[0].estText, /^At this pace there would be about \d+ days of room, if nothing changes\.$/);
  const ping = by['drift-gap'].dftCharts.find((c) => c.id === 'ping');
  assert.equal(ping.empty, true);
  assert.equal(ping.hasPath, false);
  const gappy = by['drift-ready'].dftCharts.find((c) => c.id === 'cpu');
  assert.ok((gappy.path.match(/M/g) || []).length >= 2, 'the CPU gap breaks the line');
});

test('the fake preload carries the same invented answer as selftest-drift (it cannot import it)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../tools/fake-preload.js', import.meta.url), 'utf8');
  const i = src.indexOf('const machineHistoryRead = () => {'), j = src.indexOf('\n  };\n', i);
  assert.ok(i > 0 && j > i, 'the fake preload has machineHistoryRead');
  const fn = new Function('return (' + src.slice(i + 'const machineHistoryRead = '.length, j + 5).replace(/;\s*$/, '') + ')')();
  assert.deepEqual(fn(), inventedAnswer(40, 6));
});
