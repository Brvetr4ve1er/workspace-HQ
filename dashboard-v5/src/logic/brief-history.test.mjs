// Brief history, renderer side: the wording, the answer shaping, the mixin and the render values. Placeholder data only.
//   node --test dashboard-v5/src/logic/brief-history.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  briefHistoryLogic, normalizeAnswer, entryLine, clearedLine, clearLine, clearSince, dayName, dayClock,
  HOW_WORD, HOW_NOTE, HOW_GLYPH, HOW_COLOR, BHS_EMPTY, BHS_OFFLINE, BHS_CLEAR_LEAD,
} from './brief-history.js';
import { briefHistoryVals } from '../vals/brief-history.js';
import { briefHistoryStates, BHS_STATE_KEYS } from '../selftest-brief-history.mjs';
import bhsTpl, { bhsFooter, bhsAllClear } from '../tpl/brief-history.tpl.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const local = (d, h = 9, mi = 0) => new Date(2026, 10, d, h, mi).toISOString();   // 2026-11-<d> local: Nov 10 2026 is a Tuesday
const entry = (o) => ({ text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: local(10, 9, 12), ended: local(12, 14, 0), how: 'resolved', after: '2 d', ...o });
const CLEAR = { since: local(12, 14, 0), resolved: [{ text: 'Work not pushed', after: '2 d', how: 'resolved', ended: local(12, 14, 0) }] };
const brief = (o) => ({ v: 1, generatedAt: '2026-11-12T13:00:00.000Z', items: [], more: 0, overflow: [], standing: [], errors: [], ...(o || {}) });
const live = (b) => ({ brief: b, error: '', loaded: true });

// a stand-in for the Component: the mixin methods, a merging setState, a toast spy, a useMark spy
function rig({ api, state } = {}) {
  const self = Object.assign({
    hq: api === null ? {} : { briefHistory: api },
    state: { bhsLoaded: false, bhsData: null, bhsErr: '', bhsBusy: false, ...(state || {}) },
    toasts: [], marks: [],
    setState(p) { Object.assign(this.state, p); },
    toast(kind, text) { this.toasts.push([kind, text]); },
    useMark(s) { this.marks.push(s); return true; },
  }, briefHistoryLogic);
  return self;
}
const vals = (self, { tab = 'home', sub = null, b = brief(), isLive = true } = {}) => briefHistoryVals.call(self, { S: { ...self.state, tab, sub: sub ? { [tab]: sub } : {} }, LIVE: { brief: live(b) }, live: isLive });

test('dayName / dayClock are local-time words, and empty for an unreadable time', () => {
  assert.equal(dayName(local(10)), 'Tue');
  assert.equal(dayClock(local(10, 9, 12)), 'Tue 09:12');
  assert.equal(dayClock(local(12, 4, 5)), 'Thu 04:05');
  assert.equal(dayName('nope'), '');
  assert.equal(dayClock(null), '');
});

test('entryLine: each way an entry ended, in words', () => {
  assert.equal(entryLine(entry()), 'Work not pushed: noticed Tue 09:12, resolved Thu after 2 d');
  assert.equal(entryLine(entry({ how: 'open', ended: null, after: '3 d' })), 'Work not pushed: noticed Tue 09:12, still open after 3 d');
  assert.equal(entryLine(entry({ how: 'acted' })), 'Work not pushed: noticed Tue 09:12, acted on Thu after 2 d');
  assert.equal(entryLine(entry({ how: 'dismissed' })), 'Work not pushed: noticed Tue 09:12, dismissed Thu after 2 d');
  assert.match(entryLine(entry({ how: 'changed' })), /changed Thu after 2 d: a newer version of it took its place$/);
  assert.match(entryLine(entry({ how: 'silent' })), /went quiet Thu after 2 d: a source was not readable, so it is not counted as done$/);
  assert.equal(entryLine(entry({ first: '', ended: '', after: '' })), 'Work not pushed: resolved', 'missing times are left out, not invented');
});

test('honesty: a silent or changed close is never worded as fixed or resolved; resolved is only for resolved', () => {
  for (const how of ['silent', 'changed']) {
    const line = entryLine(entry({ how }));
    assert.doesNotMatch(line, /fixed|resolv|solved|cleared|done by|complete/i, how + ': ' + line);
    assert.doesNotMatch(HOW_WORD[how], /fixed|resolv/i);
    assert.doesNotMatch(HOW_NOTE[how], /fixed|resolv/i);
  }
  for (const how of ['open', 'dismissed', 'acted']) assert.doesNotMatch(entryLine(entry({ how })), /fixed|resolved/i, how);
  assert.match(entryLine(entry({ how: 'resolved' })), /resolved/);
  assert.doesNotMatch(HOW_WORD.dismissed, /fixed|resolv|cleared/);
  for (const how of Object.keys(HOW_WORD)) { assert.ok(HOW_GLYPH[how], how); assert.ok(HOW_COLOR[how], how); }
});

test('clearedLine counts dismissed apart from cleared and says nothing when both are zero', () => {
  assert.equal(clearedLine(3, 1), '3 cleared this week · 1 dismissed');
  assert.equal(clearedLine(3, 0), '3 cleared this week');
  assert.equal(clearedLine(0, 2), '2 dismissed');
  assert.equal(clearedLine(0, 0), '');
  assert.doesNotMatch(clearedLine(0, 2), /cleared/, 'dismissals are never worded as cleared');
});

test('clearLine and clearSince', () => {
  assert.equal(clearLine({ text: 'Work not pushed', after: '2 d', how: 'resolved', ended: local(12) }), 'Work not pushed · resolved Thu after 2 d');
  assert.equal(clearLine({ text: 'A bill is late', after: '', how: 'acted', ended: '' }), 'A bill is late · acted on');
  assert.equal(clearSince(local(12, 14, 0)), 'Clear since Thu 14:00.');
  assert.equal(clearSince(''), '');
});

test('normalizeAnswer: a good answer passes, junk becomes an error or empty fields, never a throw', () => {
  const ok = normalizeAnswer({ entries: [entry()], clearedThisWeek: 2, dismissedThisWeek: 1, allClear: CLEAR, notice: 'n' });
  assert.deepEqual(Object.keys(ok), ['entries', 'clearedThisWeek', 'dismissedThisWeek', 'allClear', 'notice']);
  assert.equal(ok.entries.length, 1);
  assert.equal(ok.allClear.resolved.length, 1);
  assert.deepEqual(normalizeAnswer(null), { error: 'no answer' });
  assert.deepEqual(normalizeAnswer('x'), { error: 'no answer' });
  assert.deepEqual(normalizeAnswer({ error: 'main says no' }), { error: 'main says no' });
  const junk = normalizeAnswer({ entries: [null, { text: '' }, { text: 'ok', how: 'weird', severity: 'weird', first: 'x', ended: 'y' }, 5], clearedThisWeek: -4, dismissedThisWeek: 'x', allClear: { resolved: [] } });
  assert.deepEqual(junk.entries, [{ text: 'ok', rule: '', severity: 'low', first: '', ended: null, how: 'open', after: '' }]);
  assert.equal(junk.clearedThisWeek, 0);
  assert.equal(junk.dismissedThisWeek, 0);
  assert.equal(junk.allClear, null, 'a card with nothing resolved is no card');
  assert.equal(normalizeAnswer({ allClear: { resolved: [{ text: 'x', how: 'dismissed' }] } }).allClear.resolved[0].how, 'resolved', 'only resolved or acted can appear on the card');
  assert.equal(normalizeAnswer({ entries: Array.from({ length: 100 }, () => entry()) }).entries.length, 60);
});

test('bhsEnsure reads once per signature; _bhsHold stops every read', async () => {
  let reads = 0;
  const self = rig({ api: { read: async () => { reads++; return { entries: [entry()], clearedThisWeek: 1, dismissedThisWeek: 0, allClear: null, notice: '' }; }, ack: async () => ({ ok: true }) } });
  self.bhsEnsure('home|a'); self.bhsEnsure('home|a'); self.bhsEnsure('home|a');
  await tick();
  assert.equal(reads, 1);
  assert.equal(self.state.bhsLoaded, true);
  assert.equal(self.state.bhsData.entries.length, 1);
  self.bhsEnsure('home|b');                       // a new brief arrived
  await tick();
  assert.equal(reads, 2);
  const held = rig({ api: { read: async () => { reads++; return {}; } } });
  held._bhsHold = true;
  held.bhsEnsure('x');
  await tick();
  assert.equal(reads, 2, 'a held rig never reads');
});

test('bhsLoad: a failed or malformed read becomes an error line, not a crash; a read during a read runs once more', async () => {
  const a = rig({ api: { read: async () => { throw new Error('ipc down'); } } });
  await a.bhsLoad();
  assert.equal(a.state.bhsErr, 'ipc down');
  assert.equal(a.state.bhsLoaded, true);
  const b = rig({ api: { read: async () => 'garbage' } });
  await b.bhsLoad();
  assert.equal(b.state.bhsErr, 'no answer');
  const c = rig({ api: { read: async () => ({ error: 'file busy' }) } });
  await c.bhsLoad();
  assert.equal(c.state.bhsErr, 'file busy');
  let n = 0, release;
  const d = rig({ api: { read: () => { n++; return n === 1 ? new Promise((r) => { release = () => r({ entries: [], clearedThisWeek: 0, dismissedThisWeek: 0 }); }) : Promise.resolve({ entries: [entry()], clearedThisWeek: 0, dismissedThisWeek: 0 }); } } });
  const first = d.bhsLoad();
  await tick();
  assert.equal(await d.bhsLoad(), false, 'the second call joins the first');
  release();
  await first;
  assert.equal(n, 2, 'one more read ran for the newer signature');
  assert.equal(d.state.bhsData.entries.length, 1);
  assert.equal(await rig({ api: null }).bhsLoad(), false, 'no bridge: nothing to read');
});

test('bhsAck: one write per click, the card goes only when main says ok, a failure keeps it and says so', async () => {
  let acks = 0;
  const ok = rig({ api: { read: async () => ({}), ack: async () => { acks++; return { ok: true, acked: true }; } }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ allClear: CLEAR, clearedThisWeek: 1 }) } });
  await Promise.all([ok.bhsAck(), ok.bhsAck(), ok.bhsAck()]);
  assert.equal(acks, 1, 'a double click is one write');
  assert.equal(ok.state.bhsData.allClear, null);
  assert.equal(ok.state.bhsData.clearedThisWeek, 1, 'the footer count stays');
  assert.equal(ok.state.bhsBusy, false);

  for (const bad of [{ error: 'disk full' }, null, { ok: false }]) {
    const f = rig({ api: { ack: async () => bad }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ allClear: CLEAR }) } });
    assert.equal(await f.bhsAck(), false);
    assert.ok(f.state.bhsData.allClear, 'the card stays');
    assert.equal(f.toasts.length, 1);
    assert.match(f.toasts[0][1], /^Not saved · /);
  }
  const t = rig({ api: { ack: async () => { throw new Error('boom'); } }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ allClear: CLEAR }) } });
  assert.equal(await t.bhsAck(), false);
  assert.ok(t.state.bhsData.allClear);
  assert.equal(await rig({ api: null }).bhsAck(), false);
});

test('vals: ONE top-level key (bhs, see the vals file: the flat vals object must stay under V8\'s ~1020-property limit), every inner key bhs-prefixed, the same keys in every state', () => {
  const states = [rig({ api: null }), rig({ api: { read: async () => ({}) } }), rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsErr: 'x' } })];
  const shapes = new Set();
  for (const s of states) for (const [tab, sub] of [['home', null], ['history', 'timeline'], ['projects', null]]) {
    const v = vals(s, { tab, sub });
    assert.deepEqual(Object.keys(v), ['bhs']);
    for (const k of Object.keys(v.bhs)) assert.match(k, /^bhs[A-Z]/, k);
    shapes.add(Object.keys(v.bhs).join());
  }
  assert.equal(shapes.size, 1, 'one key set everywhere (the goldens depend on it)');
});

test('vals: no read and no mark when no surface that shows the history is on screen', async () => {
  let reads = 0;
  const self = rig({ api: { read: async () => { reads++; return {}; } } });
  vals(self, { tab: 'projects' });
  vals(self, { tab: 'history', sub: 'trends' });
  vals(self, { tab: 'home', isLive: false });          // an older scan is being viewed
  await tick();
  assert.equal(reads, 0);
  assert.deepEqual(self.marks, []);
});

test('vals: the Operator section states, in order (offline, loading, error, empty, rows)', async () => {
  const timeline = (self, b) => vals(self, { tab: 'history', sub: 'timeline', b });
  const off = timeline(rig({ api: null }));
  assert.deepEqual([off.bhs.bhsOpShow, off.bhs.bhsOpOffline, off.bhs.bhsOpLoading, off.bhs.bhsOpHas], [true, true, false, false]);
  assert.equal(off.bhs.bhsOpOfflineText, BHS_OFFLINE);

  const loading = timeline(rig({ api: { read: async () => new Promise(() => {}) } }));
  assert.deepEqual([loading.bhs.bhsOpLoading, loading.bhs.bhsOpEmpty, loading.bhs.bhsOpError, loading.bhs.bhsOpOffline], [true, false, false, false]);

  const err = timeline(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsErr: 'file busy' } }));
  assert.deepEqual([err.bhs.bhsOpError, err.bhs.bhsOpLoading, err.bhs.bhsOpEmpty], [true, false, false]);
  assert.equal(err.bhs.bhsOpErrorText, 'Couldn’t read the Brief history · file busy');

  const empty = timeline(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({}) } }));
  assert.deepEqual([empty.bhs.bhsOpEmpty, empty.bhs.bhsOpHas], [true, false]);
  assert.equal(empty.bhs.bhsOpEmptyText, BHS_EMPTY);

  const rows = timeline(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ entries: [entry(), entry({ how: 'silent' }), entry({ how: 'open', ended: null, after: '1 h' })], clearedThisWeek: 1, dismissedThisWeek: 2, notice: 'set aside' }) } }));
  assert.equal(rows.bhs.bhsOpHas, true);
  assert.deepEqual(rows.bhs.bhsOpRows.map((r) => r.glyph), [HOW_GLYPH.resolved, HOW_GLYPH.silent, HOW_GLYPH.open]);
  assert.doesNotMatch(rows.bhs.bhsOpRows[1].line, /resolved|fixed/i);
  assert.equal(rows.bhs.bhsOpSummary, '1 cleared this week · 2 dismissed');
  assert.equal(rows.bhs.bhsOpNoticeText, 'set aside');
  assert.equal(rows.bhs.bhsOpHasNotice, true);
  assert.equal(new Set(rows.bhs.bhsOpRows.map((r) => r.key)).size, 3, 'row keys are unique');
});

test('vals: the Operator section marks the surface once the rows are on screen, and only there', async () => {
  const self = rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({}) } });
  vals(self, { tab: 'home' });
  assert.deepEqual(self.marks, []);
  vals(self, { tab: 'history', sub: 'timeline' });
  assert.deepEqual(self.marks, ['brief-history']);
});

test('vals: the all-clear card shows only while the brief on screen is empty in the strict sense', () => {
  const data = normalizeAnswer({ allClear: CLEAR, clearedThisWeek: 1 });
  const mk = () => rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: data } });
  const show = vals(mk(), { b: brief() });
  assert.equal(show.bhs.bhsCardShow, true);
  assert.equal(show.bhs.bhsCardLines.length, 1);
  assert.equal(show.bhs.bhsCardLines[0].text, 'Work not pushed · resolved Thu after 2 d');
  assert.ok(show.bhs.bhsCardLead.startsWith(BHS_CLEAR_LEAD));
  assert.match(show.bhs.bhsCardLead, /Clear since Thu 14:00\.$/);
  const it = { key: 'dirty:p:12', rule: 'dirty', severity: 'low', text: 'x', why: 'y', source: 'scan', age: '', action: null, count: 0 };
  for (const [label, b] of [['an item', brief({ items: [it] })], ['overflow', brief({ overflow: [it] })], ['standing', brief({ standing: [it] })], ['hidden rows', brief({ more: 2 })], ['a source error', brief({ errors: [{ source: 'money', error: 'x' }] })]]) {
    assert.equal(vals(mk(), { b }).bhs.bhsCardShow, false, label);
  }
  assert.equal(vals(mk(), { tab: 'history', sub: 'timeline' }).bhs.bhsCardShow, false, 'the card lives on Home');
  assert.equal(vals(mk(), { isLive: false }).bhs.bhsCardShow, false, 'not while an older scan is viewed');
  assert.equal(vals(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ allClear: null }) } })).bhs.bhsCardShow, false, 'main said no card');
  const brokenBrief = { ...rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: data } }) };
  assert.equal(briefHistoryVals.call(brokenBrief, { S: { ...brokenBrief.state, tab: 'home', sub: {} }, LIVE: { brief: { brief: null, error: '', loaded: true } }, live: true }).bhs.bhsCardShow, false, 'no brief: no card');
});

test('vals: the footer counts cleared and dismissed apart, and says nothing for zero', () => {
  const mk = (a) => rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer(a) } });
  assert.equal(vals(mk({ clearedThisWeek: 3, dismissedThisWeek: 1 })).bhs.bhsFootText, '3 cleared this week · 1 dismissed');
  assert.equal(vals(mk({ dismissedThisWeek: 2 })).bhs.bhsFootText, '2 dismissed');
  assert.equal(vals(mk({})).bhs.bhsFootShow, false);
  assert.equal(vals(mk({ clearedThisWeek: 3 }), { tab: 'history', sub: 'timeline' }).bhs.bhsFootShow, false, 'the footer lives on Home');
});

test('the ack button is wired to bhsAck and greys out while busy', async () => {
  let acks = 0;
  const self = rig({ api: { read: async () => ({}), ack: async () => { acks++; return { ok: true }; } }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ allClear: CLEAR }) } });
  const v = vals(self);
  assert.equal(v.bhs.bhsCardBusy, false);
  await v.bhs.bhsCardAck();
  assert.equal(acks, 1);
  assert.equal(vals(self).bhs.bhsCardShow, false, 'gone after main said ok');
  self.state.bhsBusy = true;
  assert.equal(vals(self).bhs.bhsCardBusy, true);
});

test('the selftest rows render what they claim, with no unresolved binding', () => {
  const rows = briefHistoryStates();
  assert.equal(rows.length, new Set(rows.map((r) => r.name)).size);
  for (const r of rows) {
    assert.match(r.name, /^bhs-/);
    assert.deepEqual(Object.keys(r.hist).sort(), BHS_STATE_KEYS.slice().sort(), r.name);
    const self = rig({ api: r.name === 'bhs-operator-offline' ? null : { read: async () => ({}) }, state: r.hist });
    const v = vals(self, { tab: r.tab, sub: r.sub, b: r.brief.brief });
    const text = JSON.stringify([v.bhs.bhsOpRows, v.bhs.bhsCardLines, v.bhs.bhsFootText, v.bhs.bhsCardLead, v.bhs.bhsOpSummary]);
    assert.doesNotMatch(text, /undefined|\[object|NaN/, r.name);
  }
  const by = Object.fromEntries(rows.map((r) => [r.name, vals(rig({ api: r.name === 'bhs-operator-offline' ? null : { read: async () => ({}) }, state: r.hist }), { tab: r.tab, sub: r.sub, b: r.brief.brief })]));
  assert.equal(by['bhs-all-clear'].bhs.bhsCardShow, true);
  assert.equal(by['bhs-all-clear-busy'].bhs.bhsCardBusy, true);
  for (const n of ['bhs-clear-no-card', 'bhs-clear-with-standing', 'bhs-clear-source-error', 'bhs-card-stale-guard', 'bhs-footer']) assert.equal(by[n].bhs.bhsCardShow, false, n);
  assert.equal(by['bhs-operator-entries'].bhs.bhsOpRows.length, 6);
  assert.equal(by['bhs-operator-offline'].bhs.bhsOpOffline, true);
  assert.equal(by['bhs-operator-loading'].bhs.bhsOpLoading, true);
  assert.equal(by['bhs-operator-error'].bhs.bhsOpError, true);
  assert.equal(by['bhs-footer-dismissed-only'].bhs.bhsFootText, '2 dismissed');
  const silent = by['bhs-operator-entries'].bhs.bhsOpRows.find((x) => x.line.includes('went quiet'));
  assert.ok(silent && !/resolved|fixed/i.test(silent.line));
});

test('the template fragments bind only bhs keys that the vals return, and use the dc-lite dialect', () => {
  const v = vals(rig({ api: { read: async () => ({}) } }));
  const have = new Set(Object.keys(v.bhs));
  const loopVars = new Set(['r', 'c']);
  for (const [name, frag] of [['operator', bhsTpl], ['footer', bhsFooter], ['card', bhsAllClear]]) {
    for (const m of frag.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) {
      const [head, root] = m[1].split('.');
      if (loopVars.has(head) || head === 'true' || head === 'false') continue;   // loop variables and hint-placeholder literals
      assert.equal(head, 'bhs', name + ' binds ' + m[1] + ' outside the one bhs key');
      assert.ok(/^bhs[A-Z]/.test(root) && have.has(root), name + ' binds ' + m[1] + ' which vals does not return');
    }
    assert.doesNotMatch(frag, /\{\{[^}]*(\(|\?|&&|\|\||=>)/, name + ' uses an expression the dialect does not support');
  }
  assert.match(bhsTpl, /aria-label="Operator: what the Brief noticed"/);
  assert.match(bhsAllClear, /aria-label="Brief: all clear"/);
  assert.match(bhsAllClear, /onClick="\{\{ bhs.bhsCardAck \}\}"/);
});
