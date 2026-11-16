// Brief history strip, clean card and Settings counts (batch 8, dish strip and clean card). Placeholder data only.
//   node --test dashboard-v5/src/logic/brief-history-strip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  briefHistoryLogic, normalizeAnswer, normalizeStrip, entryLine, stripLines, settingsRows, asideLines, cleanCardOf, HELD_NOTE, CLEAN_EXEMPT,
} from './brief-history.js';
import { briefHistoryVals } from '../vals/brief-history.js';
import { bhsFooter, bhsAllClear, bhsSettings } from '../tpl/brief-history.tpl.js';
import { STANDING_EXEMPT } from '../../../dashboard/brief-core.mjs';
import { wbnArt } from '../tpl/workbench.tpl.js';   // the Workbench art sits inside the clean-board card; it is tested in workbench-art.test.mjs, so it is cut out here

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const local = (d, h = 9, mi = 0) => new Date(2026, 10, d, h, mi).toISOString();   // 2026-11-<d> local: Nov 10 2026 is a Tuesday
const entry = (o) => ({ text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: local(10, 9, 12), ended: local(12, 14, 0), how: 'resolved', after: '2 d', ...o });
const CLEAR = { since: local(12, 14, 0), resolved: [{ text: 'Work not pushed', after: '2 d', how: 'resolved', ended: local(12, 14, 0) }] };
const brief = (o) => ({ v: 1, generatedAt: '2026-11-12T13:00:00.000Z', items: [], more: 0, overflow: [], standing: [], errors: [], ...(o || {}) });
const live = (b) => ({ brief: b, error: '', loaded: true });

function rig({ api, state } = {}) {
  return Object.assign({
    hq: api === null ? {} : { briefHistory: api },
    state: { bhsLoaded: false, bhsData: null, bhsErr: '', bhsBusy: false, ...(state || {}) },
    toasts: [], marks: [],
    setState(p) { Object.assign(this.state, p); },
    toast(kind, text) { this.toasts.push([kind, text]); },
    useMark(s) { this.marks.push(s); return true; },
  }, briefHistoryLogic);
}
const vals = (self, { tab = 'home', sub = null, b = brief(), isLive = true, settings = false } = {}) => briefHistoryVals.call(self, { S: { ...self.state, tab, sub: sub ? { [tab]: sub } : {}, settingsOpen: settings }, LIVE: { brief: live(b) }, live: isLive });

const base8 = { clears: { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 0 }, heldThisWeek: 0, pendingNow: 0, cameBackThisWeek: 0, openCount: 0, oldestOpen: null, outside: { count: 0, rules: [] }, setAside: { count: 0, oldest: null, items: [] } };
const ans8 = (o) => normalizeAnswer({ entries: [], clearedThisWeek: 0, dismissedThisWeek: 0, allClear: null, notice: '', ...base8, ...(o || {}) });
const aside = (n) => ({ count: n, oldest: { since: local(1), after: '9 d' }, items: Array.from({ length: n }, (_, i) => ({ text: 'Item ' + i, rule: 'dirty', severity: 'low', first: local(1), after: '9 d' })) });
const mk8 = (a, extra) => rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: ans8(a), ...(extra || {}) } });

test('an older answer with no counts has no strip and the old footer line stands in; the normalized answer gains a strip only when main sent counts', () => {
  assert.equal(normalizeStrip({}), null);
  assert.equal('strip' in normalizeAnswer({ clearedThisWeek: 2 }), false);
  assert.deepEqual(Object.keys(normalizeAnswer(base8)), ['entries', 'clearedThisWeek', 'dismissedThisWeek', 'allClear', 'notice', 'strip']);
  const old = rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ clearedThisWeek: 3, dismissedThisWeek: 1 }) } });
  const v = vals(old).bhs;
  assert.equal(v.bhsStripShow, false);
  assert.equal(v.bhsFootText, '3 cleared this week · 1 dismissed');
});

test('strip: week one reads "0 held", plain counts only, never a score or a total', () => {
  assert.deepEqual(stripLines(ans8()), ['0 cleared this week · 0 still gone after 72 hours', 'Nothing open']);
  const busy = ans8({ clearedThisWeek: 5, heldThisWeek: 2, pendingNow: 1, cameBackThisWeek: 1, clears: { inPlace: 2, markedDone: 1, scanConfirmed: 1, unknown: 1 }, openCount: 3, oldestOpen: { since: local(5), after: '4 d' }, setAside: aside(2), outside: { count: 1, rules: ['pc-ember'] } });
  const all = stripLines(busy);
  assert.equal(all[0], '5 cleared this week · 2 still gone after 72 hours · 1 waiting out the hold · 1 came back');
  assert.equal(all[1], 'Of those: 2 in place · 1 marked done · 1 confirmed by a scan · 1 source cannot confirm');
  assert.equal(all[2], '3 open · oldest 4 d (since the app first noticed it)');
  assert.equal(all[3], '2 set aside, the oldest 9 d');
  assert.equal(all[4], '1 row is waiting on something outside the app');
  assert.doesNotMatch(all.join(' ') + HELD_NOTE.replace('no score', ''), /score|total|level|xp|points|streak|%/i);
  assert.match(HELD_NOTE, /no score/);
  assert.deepEqual(stripLines(normalizeAnswer({ clearedThisWeek: 2 })), []);
});

test('junk counts become zero, never NaN, and an unknown entry label or hold is dropped', () => {
  const S = normalizeStrip({ clears: { inPlace: -1, markedDone: 'x', scanConfirmed: 2.5, unknown: 3 }, heldThisWeek: null, outside: { count: 2, rules: [7, 'pc-ember'] }, setAside: { items: [null, { text: '' }, { text: 'ok', severity: 'weird' }] } });
  assert.deepEqual(S.clears, { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 3 });
  assert.equal(S.held, 0);
  assert.deepEqual(S.outside.rules, ['pc-ember']);
  assert.deepEqual(S.setAside.items.map((x) => [x.text, x.severity]), [['ok', 'low']]);
  const e = normalizeAnswer({ entries: [entry({ label: 'weird', hold: 'nope' }), entry({ label: 'in-place', hold: 'held', setAside: true })] }).entries;
  assert.equal('label' in e[0] || 'hold' in e[0], false);
  assert.deepEqual([e[1].label, e[1].hold, e[1].setAside], ['in-place', 'held', true]);
});

test('entry words: a clear says how and where its hold stands; a dismissal says set aside and is never worded as a clear', () => {
  assert.equal(entryLine(entry({ label: 'in-place', hold: 'held' })), 'Work not pushed: noticed Tue 09:12, resolved Thu after 2 d · in place · stayed gone');
  assert.match(entryLine(entry({ how: 'acted', label: 'scan-confirmed', hold: 'pending' })), /acted on Thu after 2 d · confirmed by a scan · waiting out the 72 hour hold$/);
  assert.match(entryLine(entry({ label: 'unknown', hold: 'never' })), /the source cannot confirm it$/);
  assert.match(entryLine(entry({ hold: 'came-back' })), /came back$/);
  const d = entryLine(entry({ how: 'dismissed', setAside: true, label: 'in-place' }));
  assert.match(d, /dismissed Thu after 2 d · set aside$/);
  assert.doesNotMatch(d, /resolved|cleared|in place/);
  for (const how of ['silent', 'changed']) assert.doesNotMatch(entryLine(entry({ how, label: 'in-place', hold: 'held' })), /resolved|in place|stayed gone/);
});

test('clean card: "Board clean since X" only when open, outside and set aside are all zero', () => {
  const D = ans8({ entries: [entry({ ended: local(11, 14, 10) }), entry({ how: 'dismissed', ended: local(12, 9, 0) })] });
  assert.deepEqual(cleanCardOf(D, true), { title: 'Board clean since Wed 14:10', lines: [] }, 'a dismissal is never the moment the board went clean');
  assert.equal(cleanCardOf(ans8(), true).title, 'Board clean', 'no close to name a time for');
  const quiet = ans8({ entries: [entry({ ended: local(11, 14, 10) }), entry({ how: 'silent', ended: local(12, 9, 0) }), entry({ how: 'changed', ended: local(12, 10, 0) }), entry({ ended: local(12, 11, 0), hold: 'came-back' })] });
  assert.equal(cleanCardOf(quiet, true).title, 'Board clean since Wed 14:10', 'a row that went quiet, changed value or came back is not the moment it was clean');
  assert.equal(cleanCardOf(ans8({ entries: [entry({ how: 'silent' }), entry({ how: 'changed' })] }), true).title, 'Board clean', 'no real clear, no date');
  assert.equal(cleanCardOf(D, false), null, 'the brief on screen is not empty');
  assert.equal(cleanCardOf(ans8({ openCount: 1 }), true), null, 'a row the Brief is not showing: no card');
  assert.equal(cleanCardOf(normalizeAnswer({ clearedThisWeek: 1 }), true), null, 'no counts, no card');
  assert.equal(cleanCardOf(null, true), null);
});

test('clean card: set-aside rows make it "Nothing new needs you, N set aside" and name the high-severity ones; outside rows never make "Board clean"', () => {
  const high = { count: 2, oldest: { since: local(1), after: '9 d' }, items: [{ text: 'A bill is late', rule: 'money-late', severity: 'high', first: local(1), after: '9 d' }, { text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: local(2), after: '8 d' }] };
  const c = cleanCardOf(ans8({ setAside: high }), true);
  assert.equal(c.title, 'Nothing new needs you, 2 set aside');
  assert.deepEqual(c.lines, ['A bill is late · set aside 9 d']);
  const o = cleanCardOf(ans8({ outside: { count: 1, rules: ['pc-ember'] } }), true);
  assert.equal(o.title, 'Nothing new needs you');
  assert.doesNotMatch(o.title, /clean/);
});

test('clean card: a rule that never steps aside is never eligible for the clean line (parity with brief-core STANDING_EXEMPT)', () => {
  assert.deepEqual([...CLEAN_EXEMPT].sort(), [...STANDING_EXEMPT].sort());
  for (const rule of CLEAN_EXEMPT) {
    const c = cleanCardOf(ans8({ setAside: { count: 1, oldest: null, items: [{ text: 'Thing', rule, severity: 'high', first: local(1), after: '3 d' }] } }), true);
    assert.doesNotMatch(c.title, /Board clean/, rule);
    assert.match(c.title, /1 set aside/);
  }
});

test('vals: the strip shows on Home with a brief; the clean card only on a clear board, never beside the one-time card, and it has no button', () => {
  const itemBrief = brief({ items: [{ key: 'dirty:a:1', rule: 'dirty', severity: 'low', text: 'x', why: 'y', source: 'scan', age: '', action: { kind: 'scan' }, count: 0 }] });
  const withItem = vals(mk8({ clearedThisWeek: 2 }), { b: itemBrief }).bhs;
  assert.equal(withItem.bhsStripShow, true);
  assert.equal(withItem.bhsStripLines[0].text, '2 cleared this week · 0 still gone after 72 hours');
  assert.equal(withItem.bhsFootShow, false, 'the strip replaces the footer line');
  assert.equal(withItem.bhsCleanShow, false);
  const clear = vals(mk8({ clearedThisWeek: 2 })).bhs;
  assert.equal(clear.bhsCleanShow, true);
  assert.equal(clear.bhsCleanTitle, 'Board clean');
  const both = vals(mk8({ allClear: CLEAR, clearedThisWeek: 1 })).bhs;
  assert.equal(both.bhsCardShow, true);
  assert.equal(both.bhsCleanShow, false, 'one card at a time');
  assert.equal(vals(mk8({}), { tab: 'projects' }).bhs.bhsCleanShow, false, 'Home only');
  assert.doesNotMatch(bhsAllClear.slice(0, bhsAllClear.indexOf('Brief: all clear')), /<button/, 'the clean card has nothing to click');
  assert.equal(vals(mk8({}), { isLive: false }).bhs.bhsStripShow, false, 'an older scan being viewed shows no strip');
});

test('vals: History shows the strip and the set-aside rows with their age; set aside is not in the cleared count', () => {
  const v = vals(mk8({ clearedThisWeek: 1, setAside: aside(2), dismissedThisWeek: 2 }), { tab: 'history', sub: 'timeline' }).bhs;
  assert.equal(v.bhsOpStripShow, true);
  assert.equal(v.bhsOpStripLines[0].text, '1 cleared this week · 0 still gone after 72 hours');
  assert.equal(v.bhsOpAsideShow, true);
  assert.deepEqual(v.bhsOpAsideLines.map((x) => x.text), ['Item 0 · set aside 9 d', 'Item 1 · set aside 9 d']);
  assert.equal(v.bhsOpHasSummary, false, 'the old summary line stands down once the strip is there');
  assert.deepEqual(asideLines(normalizeAnswer({})), []);
});

test('vals: Settings opens one read and shows the counts, honest while loading, on error and with an older main', async () => {
  let reads = 0;
  const self = rig({ api: { read: async () => { reads++; return { ...base8, entries: [], clearedThisWeek: 4 }; } } });
  assert.equal(vals(self, { tab: 'projects' }).bhs.bhsSetShow, false);
  const first = vals(self, { tab: 'projects', settings: true }).bhs;
  assert.equal(first.bhsSetShow, true);
  assert.equal(first.bhsSetLoading, true);
  await tick(30);
  assert.equal(reads, 1);
  const done = vals(self, { tab: 'projects', settings: true }).bhs;
  assert.equal(done.bhsSetHas, true);
  assert.deepEqual([done.bhsSetRows[0].label, done.bhsSetRows[0].value], ['Cleared this week', '4']);
  assert.equal(done.bhsSetRows.find((r) => r.label.startsWith('Held')).value, '0');
  assert.equal(done.bhsSetNote, HELD_NOTE);
  const err = vals(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsErr: 'nope' } }), { settings: true }).bhs;
  assert.deepEqual([err.bhsSetError, err.bhsSetHas], [true, false]);
  const oldMain = vals(rig({ api: { read: async () => ({}) }, state: { bhsLoaded: true, bhsData: normalizeAnswer({ clearedThisWeek: 1 }) } }), { settings: true }).bhs;
  assert.deepEqual([oldMain.bhsSetOld, oldMain.bhsSetHas], [true, false]);
  assert.equal(vals(rig({ api: null }), { settings: true }).bhs.bhsSetShow, false, 'no bridge: nothing to show');
  assert.deepEqual(settingsRows(null), []);
});

test('the strip and Settings views send no marks and write nothing', async () => {
  const self = mk8({ clearedThisWeek: 1 });
  vals(self, { settings: true }); vals(self, {}); await tick();
  assert.deepEqual(self.marks, [], 'looking at the strip counts nothing');
});

test('the fragments: the strip and the settings block bind only bhs keys vals return; settings is read-only', () => {
  const have = new Set(Object.keys(vals(rig({ api: { read: async () => ({}) } })).bhs));
  for (const [name, frag] of [['footer', bhsFooter], ['card', bhsAllClear.split(wbnArt('cleared')).join('')], ['settings', bhsSettings]]) {
    for (const m of frag.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) {
      const [head, root] = m[1].split('.');
      if (['l', 'c', 'r', 'x', 'true', 'false'].includes(head)) continue;
      assert.equal(head, 'bhs', name + ' binds ' + m[1]);
      assert.ok(have.has(root), name + ' binds ' + m[1] + ' which vals does not return');
    }
  }
  assert.doesNotMatch(bhsSettings, /<button|<input|onClick|onChange/);
  assert.match(bhsSettings, /aria-label="Brief history counts"/);
  assert.match(bhsFooter, /aria-label="Brief: this week"/);
  assert.match(bhsAllClear, /aria-label="Brief: board clean"/);
});
