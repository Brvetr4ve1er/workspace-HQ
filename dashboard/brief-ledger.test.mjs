// Brief ledger engine (dashboard/brief-ledger.mjs): how each thing the Brief noticed ended. Placeholder rows only (the repo is public).
//   node --test dashboard/brief-ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  observe, summarize, allClearOf, markShown, cleanLedger, emptyLedger, hiddenRows, liveRows, trustFn, durationWords, phraseOf,
  SOURCE_ALIAS, CLOSED_MAX, CLOSED_KEEP_MS, OPEN_SILENT_MS, HOWS, refOf,
} from './brief-ledger.mjs';
import { WORDING } from './brief-project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-11-10T09:00:00Z');
const at = (min) => new Date(T0 + min * 60e3);
const D = 24 * 60;   // minutes in a day

// a row as the engine emits it; `text` deliberately names a placeholder project so the tests can prove it never reaches the ledger
const row = (key, rule, source, severity = 'med', extra) => Object.assign({ key, rule, severity, text: 'Placeholder Project Zed — ' + rule, why: 'Placeholder reason.', source, age: 'scan 1 h ago', action: { kind: 'scan' }, count: 0 }, extra || {});
const brief = (items, o = {}) => ({ v: 1, generatedAt: (o.at || at(0)).toISOString(), items, more: o.more || 0, overflow: o.overflow || [], standing: o.standing || [], errors: o.errors || [] });
const UNPUSHED = row('unpushed:proj-zed:3', 'unpushed', 'scan');
const SECRETS = row('secrets:proj-zed:2', 'secrets', 'scan', 'high');
const LATE = row('money-late:bill-1:2026-11-09', 'money-late', 'money', 'high');
const CI = row('ci-red:repo-q:main', 'ci-red', 'github', 'med');

// run a sequence of [minute, brief, opts] observations from an empty ledger
function run(steps) {
  let ledger = emptyLedger(), last = null;
  for (const [min, b, o] of steps) { last = observe(ledger, b, { now: at(min), ...(o || {}) }); ledger = last.ledger; }
  return { ledger, last };
}
const closedHows = (ledger) => ledger.closed.map((c) => c.how);

test('a key that leaves with no error is resolved, and its clock is first-seen to now', () => {
  const { ledger, last } = run([[0, brief([UNPUSHED])], [60, brief([UNPUSHED], { at: at(60) })], [2 * D, brief([], { at: at(2 * D) })]]);
  assert.deepEqual(ledger.open, {});
  assert.equal(ledger.closed.length, 1);
  assert.deepEqual(ledger.closed[0], { rule: 'unpushed', severity: 'med', count: 0, first: at(0).toISOString(), ended: at(2 * D).toISOString(), how: 'resolved' });
  assert.deepEqual(last.closed, [{ rule: 'unpushed', how: 'resolved' }]);
});

test('the same close with its own source erroring is silent, never resolved', () => {
  for (const source of ['scan', 'pc-health', 'money', 'claude', 'brief-senses']) {
    const it = row('x:1', source === 'scan' ? 'unpushed' : source === 'money' ? 'money-late' : source === 'pc-health' ? 'pc-ember' : source === 'claude' ? 'claude-sync' : 'ci-red', source === 'brief-senses' ? 'github' : source);
    const { ledger } = run([[0, brief([it])], [30, brief([], { errors: [{ source, error: 'placeholder' }] })]]);
    assert.deepEqual(closedHows(ledger), ['silent'], source);
  }
});

test('an error on ANOTHER known source does not silence this one', () => {
  const { ledger } = run([[0, brief([UNPUSHED])], [30, brief([], { errors: [{ source: 'money', error: 'placeholder' }] })]]);
  assert.deepEqual(closedHows(ledger), ['resolved']);
});

test('github, vercel and claude-code errors map to the senses and silence every senses row', () => {
  for (const src of ['github', 'vercel', 'claude-code']) {
    const { ledger } = run([[0, brief([CI])], [30, brief([], { errors: [{ source: src, error: 'placeholder' }] })]]);
    assert.deepEqual(closedHows(ledger), ['silent'], src);
  }
});

test('a live scan-stale (or scan-failed) row makes the scan rows that leave silent', () => {
  for (const stale of [row('scan-stale:2026-11-05', 'scan-stale', 'scan'), row('scan-failed:2026-11-10', 'scan-failed', 'scan-run', 'high')]) {
    const { ledger } = run([[0, brief([UNPUSHED, stale])], [30, brief([stale])]]);
    assert.deepEqual(closedHows(ledger), ['silent'], stale.rule);
  }
  // a money row leaving while scan-stale is live is still resolved
  const stale = row('scan-stale:2026-11-05', 'scan-stale', 'scan');
  assert.deepEqual(closedHows(run([[0, brief([LATE, stale])], [30, brief([stale])]]).ledger), ['resolved']);
});

test('a dismissed key is dismissed (the key is compared by its ref)', () => {
  const { ledger } = run([[0, brief([SECRETS, UNPUSHED])], [30, brief([UNPUSHED]), { dismissedKeys: [SECRETS.key, 'other:key'] }]]);
  assert.deepEqual(ledger.closed.map((c) => [c.rule, c.how]), [['secrets', 'dismissed']]);
  assert.ok(Object.keys(ledger.open).includes(refOf(UNPUSHED.key)));
});

test('a row carrying the acted marker closes acted; one that lost its marker does not', () => {
  const marked = { ...UNPUSHED, acted: { verb: 'quest-done', at: at(10).toISOString() } };
  assert.deepEqual(closedHows(run([[0, brief([UNPUSHED])], [10, brief([marked])], [60, brief([])]]).ledger), ['acted']);
  assert.deepEqual(closedHows(run([[0, brief([marked])], [10, brief([UNPUSHED])], [60, brief([])]]).ledger), ['resolved'], 'the last-seen row decides');
  const noVerb = { ...UNPUSHED, acted: { at: at(10).toISOString() } };
  assert.deepEqual(closedHows(run([[0, brief([noVerb])], [60, brief([])]]).ledger), ['resolved'], 'a marker without a verb is not a marker');
});

test('a key that leaves while the same rule is live under a new key is changed, never resolved', () => {
  const a = row('unpushed:proj-zed:3', 'unpushed', 'scan'), b = row('unpushed:proj-zed:5', 'unpushed', 'scan');
  const { ledger } = run([[0, brief([a])], [30, brief([b])]]);
  assert.deepEqual(closedHows(ledger), ['changed']);
  assert.deepEqual(Object.values(ledger.open).map((e) => e.rule), ['unpushed'], 'the new fact is open');
  assert.equal(summarize(ledger, brief([b], { at: at(30) }), { now: at(30) }).clearedThisWeek, 0, 'changed is not counted');
});

test('a row pushed below rank 12 (hidden rows above 0) stays open, however long', () => {
  const overflow = Array.from({ length: 9 }, (_, i) => row('dirty:p' + i + ':12', 'dirty', 'scan', 'low'));
  const full = brief([SECRETS, LATE, UNPUSHED], { more: 12, overflow });                 // 12 fresh rows + 3 hidden
  const base = [[0, brief([SECRETS])], [10, full]];
  assert.equal(hiddenRows(full), 3);
  const { ledger } = run(base.concat([[20, brief([LATE, UNPUSHED], { more: 12, overflow, at: at(20) })]]));
  assert.ok(Object.keys(ledger.open).includes(refOf(SECRETS.key)), 'the secrets row is below the line, not gone');
  assert.deepEqual(ledger.closed, []);
});

test('an open entry not live for 30 days with hidden rows still present closes silent, never resolved', () => {
  const overflow = Array.from({ length: 9 }, (_, i) => row('dirty:p' + i + ':12', 'dirty', 'scan', 'low'));
  const crowded = (min) => brief([LATE, UNPUSHED, CI], { more: 13, overflow, at: at(min) });
  const first = observe(emptyLedger(), brief([SECRETS], { at: at(0) }), { now: at(0) }).ledger;
  const kept = observe(first, crowded(60), { now: at(60) }).ledger;
  assert.equal(Object.keys(kept.open).length >= 1 && kept.closed.length, 0);
  const later = new Date(T0 + OPEN_SILENT_MS + 3600e3);
  const out = observe(kept, crowded(0), { now: later }).ledger;
  assert.deepEqual(closedHows(out), ['silent']);
  assert.equal(out.closed[0].rule, 'secrets');
});

test('an error source brief, or an unknown error source, makes every close silent that computation', () => {
  for (const bad of ['brief', 'something-new']) {
    const { ledger } = run([[0, brief([UNPUSHED, LATE])], [30, brief([], { errors: [{ source: bad, error: 'placeholder' }] })]]);
    assert.deepEqual(closedHows(ledger).sort(), ['silent', 'silent'], bad);
  }
  assert.deepEqual(closedHows(run([[0, brief([UNPUSHED])], [30, brief([], { errors: [{ error: 'no source' }, 7] })]]).ledger), ['silent'], 'a malformed error entry is unknown');
  // an item whose own source is not in the table can never be called resolved
  const odd = row('unpushed:z:1', 'unpushed', 'mystery');
  assert.deepEqual(closedHows(run([[0, brief([odd])], [30, brief([])]]).ledger), ['silent']);
});

test('opts.errors overrides brief.errors (brief.js passes its own list)', () => {
  const steps = [[0, brief([UNPUSHED])], [30, brief([]), { errors: [{ source: 'scan', error: 'placeholder' }] }]];
  assert.deepEqual(closedHows(run(steps).ledger), ['silent']);
});

test('the first computation after a restart closes nothing: it only re-opens', () => {
  const seeded = observe(emptyLedger(), brief([UNPUSHED, LATE]), { now: at(0) }).ledger;
  const cold = observe(seeded, brief([LATE], { at: at(5) }), { now: at(5), coldStart: true });
  assert.deepEqual(cold.ledger.closed, []);
  assert.equal(Object.keys(cold.ledger.open).length, 2, 'the unpushed row is still open');
  const warm = observe(cold.ledger, brief([LATE], { at: at(20) }), { now: at(20) });
  assert.deepEqual(closedHows(warm.ledger), ['resolved'], 'the next computation decides');
  // and a cold start with an empty brief still keeps everything open
  assert.deepEqual(observe(seeded, brief([]), { now: at(5), coldStart: true }).ledger.closed, []);
});

test('a key that returns after closing starts a new entry with a new first', () => {
  const { ledger } = run([[0, brief([UNPUSHED])], [30, brief([])], [60, brief([UNPUSHED], { at: at(60) })]]);
  assert.equal(ledger.closed.length, 1);
  assert.equal(ledger.open[refOf(UNPUSHED.key)].first, at(60).toISOString());
});

test('closed entries are kept 30 days and at most 300, newest kept', () => {
  const closed = Array.from({ length: 320 }, (_, i) => ({ rule: 'unpushed', severity: 'med', count: 0, first: at(0).toISOString(), ended: new Date(T0 + (i + 1) * 60e3).toISOString(), how: 'resolved' }));
  const cleaned = cleanLedger({ v: 1, closed }, new Date(T0 + 400 * 60e3));
  assert.equal(cleaned.closed.length, CLOSED_MAX);
  assert.equal(cleaned.closed[CLOSED_MAX - 1].ended, closed[319].ended);
  assert.equal(cleaned.closed[0].ended, closed[20].ended);
  const old = [{ rule: 'unpushed', severity: 'med', count: 0, first: at(0).toISOString(), ended: at(1).toISOString(), how: 'resolved' }];
  assert.equal(cleanLedger({ closed: old }, new Date(T0 + CLOSED_KEEP_MS + 3 * 60e3)).closed.length, 0, 'older than 30 days is dropped');
  assert.equal(cleanLedger({ closed: old }, new Date(T0 + CLOSED_KEEP_MS - 3600e3)).closed.length, 1);
  // observe applies the same trim as it closes
  const big = { ...emptyLedger(), closed };
  const out = observe(big, brief([UNPUSHED], { at: at(500) }), { now: at(500) });
  assert.ok(out.ledger.closed.length <= CLOSED_MAX);
});

test('the ledger holds refs, rule ids and times only: no raw key, no row text, no project name', () => {
  const { ledger } = run([[0, brief([SECRETS, UNPUSHED, LATE, CI])], [30, brief([UNPUSHED], { at: at(30) }), { dismissedKeys: [SECRETS.key] }], [90, brief([])]]);
  const text = JSON.stringify(ledger);
  for (const bad of ['proj-zed', 'Zed', 'Placeholder', 'secrets:', 'unpushed:', 'bill-1', 'repo-q', 'why', 'text', 'key"']) assert.ok(!text.includes(bad), 'the ledger leaks ' + bad);
  for (const ref of Object.keys(ledger.open)) assert.match(ref, /^[0-9a-f]{12}$/);
  for (const c of ledger.closed) assert.deepEqual(Object.keys(c), ['rule', 'severity', 'count', 'first', 'ended', 'how']);
  const sum = JSON.stringify(summarize(ledger, brief([]), { now: at(100) }));
  for (const bad of ['proj-zed', 'Zed', 'Placeholder', 'bill-1', 'repo-q']) assert.ok(!sum.includes(bad), 'the read answer leaks ' + bad);
});

test('wording comes only from the WORDING table, by rule id', () => {
  for (const [rule, w] of Object.entries(WORDING)) {
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    assert.equal(phraseOf(rule, 0), cap(w.short), rule);
    if (w.shortMany) assert.equal(phraseOf(rule, 3), cap(w.shortMany.replace('{n}', '4')), rule + ' many');
    else assert.equal(phraseOf(rule, 3), cap(w.short), rule + ' has no plural form');
  }
  assert.equal(phraseOf('invented-rule', 0), 'Something else');
  assert.equal(phraseOf('__proto__', 0), 'Something else');
  // a row with a rule the table does not know is stored as 'unknown' and worded generically
  const { ledger } = run([[0, brief([row('mystery:1', 'mystery', 'scan')])], [30, brief([])]]);
  assert.equal(ledger.closed[0].rule, 'unknown');
  assert.equal(summarize(ledger, brief([]), { now: at(31) }).entries[0].text, 'Something else');
});

test('every source literal in brief-core.mjs, brief-senses.mjs and brief-session-waiting.mjs is in the alias table', () => {
  const seen = new Set();
  for (const f of ['brief-core.mjs', 'brief-senses.mjs', 'brief-session-waiting.mjs']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const m of src.matchAll(/\bsource:\s*'([a-z0-9-]+)'/g)) seen.add(m[1]);
  }
  assert.ok(seen.size >= 6, 'the grep found the item sources: ' + [...seen].join(','));
  for (const s of seen) assert.ok(Object.prototype.hasOwnProperty.call(SOURCE_ALIAS, s), 'source "' + s + '" is missing from SOURCE_ALIAS, so its rows could never close as resolved');
  assert.equal(SOURCE_ALIAS['scan-run'], 'scan');
  for (const s of ['github', 'vercel', 'claude-code']) assert.equal(SOURCE_ALIAS[s], 'brief-senses');
  // the error vocabulary the brief gathers (brief.js buildInputs, brief-sources.js)
  for (const s of ['scan', 'pc-health', 'money', 'claude', 'brief-senses']) assert.ok(SOURCE_ALIAS[s], s);
});

test('liveRows covers items, overflow and standing, skips malformed rows and de-duplicates', () => {
  const b = brief([UNPUSHED, { nope: 1 }, UNPUSHED], { overflow: [LATE], standing: [{ ...SECRETS, since: at(0).toISOString() }, row('k', 'dirty', 'scan', 'bogus')] });
  assert.deepEqual(liveRows(b).map((r) => r.row.rule), ['unpushed', 'money-late', 'secrets']);
  assert.deepEqual(liveRows(null), []);
});

test('a standing row stays open while standing and is not closed by stepping aside', () => {
  const standing = { ...UNPUSHED, since: at(0).toISOString() };
  const { ledger } = run([[0, brief([UNPUSHED])], [30, brief([], { standing: [standing] })]]);
  assert.deepEqual(ledger.closed, []);
  assert.equal(Object.keys(ledger.open).length, 1);
});

test('trustFn: scan-run counts as scan, and an unknown item source is never trusted', () => {
  const t = trustFn([{ source: 'scan', error: 'x' }], []);
  assert.equal(t('scan-run'), false);
  assert.equal(t('money'), true);
  assert.equal(t('mystery'), false);
  assert.equal(trustFn([], [])('github'), true);
});

test('the engine never throws on junk and does not mutate its inputs', () => {
  assert.deepEqual(observe(null, null, { now: at(0) }).ledger, emptyLedger());
  assert.equal(observe('x', undefined).skipped, 'no brief');
  const l = Object.freeze({ ...emptyLedger(), open: Object.freeze({}), closed: Object.freeze([]) });
  const b = Object.freeze(brief([Object.freeze({ ...UNPUSHED })]));
  assert.doesNotThrow(() => observe(l, b, { now: at(0) }));
  assert.deepEqual(cleanLedger({ open: { 'not-a-ref': {}, [refOf('k')]: { rule: 'unpushed', first: 'x', last: 'y' } }, closed: [null, { how: 'bogus' }] }, at(0)), emptyLedger());
});

test('summarize: open facts first, then closed newest first, last 14 days, with the way each ended', () => {
  const { ledger } = run([[0, brief([UNPUSHED, LATE])], [2 * D, brief([UNPUSHED], { at: at(2 * D) })], [3 * D, brief([UNPUSHED], { at: at(3 * D) }), { dismissedKeys: [] }]]);
  const s = summarize(ledger, brief([UNPUSHED]), { now: at(3 * D) });
  assert.deepEqual(s.entries.map((e) => [e.rule, e.how, e.ended === null]), [['unpushed', 'open', true], ['money-late', 'resolved', false]]);
  assert.equal(s.entries[1].after, '2 d');
  assert.equal(s.entries[0].after, '3 d');
  assert.equal(s.clearedThisWeek, 1);
  assert.equal(s.dismissedThisWeek, 0);
  const later = summarize(ledger, brief([]), { now: new Date(T0 + 20 * D * 60e3) });
  assert.deepEqual(later.entries.filter((e) => e.how !== 'open'), [], 'closed entries older than 14 days drop out of the list');
  assert.equal(later.clearedThisWeek, 0);
  for (const e of s.entries) assert.deepEqual(Object.keys(e), ['text', 'rule', 'severity', 'first', 'ended', 'how', 'after']);
});

test('dismissed is counted separately and never as cleared', () => {
  const { ledger } = run([[0, brief([SECRETS, UNPUSHED])], [30, brief([UNPUSHED]), { dismissedKeys: [SECRETS.key] }], [60, brief([])]]);
  const s = summarize(ledger, brief([]), { now: at(61) });
  assert.equal(s.dismissedThisWeek, 1);
  assert.equal(s.clearedThisWeek, 1);
});

test('durationWords: whole units, never zero', () => {
  assert.equal(durationWords(0), '1 min');
  assert.equal(durationWords(59 * 60e3), '59 min');
  assert.equal(durationWords(5 * 3600e3), '5 h');
  assert.equal(durationWords(48 * 3600e3), '2 d');
  assert.equal(durationWords(NaN), '1 min');
});

// ---- the all-clear: pure conditions (the once-only flow with a real file is in brief-ledger.main.test.mjs)
const clearSteps = [[0, brief([UNPUSHED])], [2 * D, brief([], { at: at(2 * D) })]];
test('allClear: a real resolve, then an empty fresh brief, lists what got resolved', () => {
  const { ledger } = run(clearSteps);
  const a = allClearOf(ledger, brief([], { at: at(2 * D) }), { now: at(2 * D + 5) });
  assert.deepEqual(a, { since: at(2 * D).toISOString(), resolved: [{ text: 'Work not pushed', after: '2 d', how: 'resolved', ended: at(2 * D).toISOString() }] });
});

test('allClear is null for standing rows, hidden rows, source errors, a stale brief, items, or an open ledger', () => {
  const { ledger } = run(clearSteps);
  const now = at(2 * D + 5);
  const ok = brief([], { at: at(2 * D) });
  assert.ok(allClearOf(ledger, ok, { now }));
  assert.equal(allClearOf(ledger, brief([], { at: at(2 * D), standing: [{ ...SECRETS, since: at(0).toISOString() }] }), { now }), null, 'standing');
  assert.equal(allClearOf(ledger, { ...ok, more: 2 }, { now }), null, 'hidden rows');
  assert.equal(allClearOf(ledger, brief([], { at: at(2 * D), errors: [{ source: 'money', error: 'x' }] }), { now }), null, 'source errors');
  assert.equal(allClearOf(ledger, ok, { now: at(2 * D + 31) }), null, 'stale brief (31 min old)');
  assert.ok(allClearOf(ledger, ok, { now: at(2 * D + 30) }), '30 minutes is still fresh');
  assert.equal(allClearOf(ledger, brief([UNPUSHED], { at: at(2 * D) }), { now }), null, 'an item');
  assert.equal(allClearOf(ledger, brief([], { at: at(2 * D), overflow: [UNPUSHED] }), { now }), null, 'overflow');
  assert.equal(allClearOf(ledger, { ...ok, generatedAt: 'garbage' }, { now }), null, 'no readable time');
  const withOpen = observe(ledger, brief([CI], { at: at(2 * D + 1) }), { now: at(2 * D + 1) }).ledger;
  assert.equal(allClearOf(withOpen, ok, { now }), null, 'something is still open in the ledger');
  assert.equal(allClearOf(ledger, null, { now }), null);
});

test('allClear: a clear that is only silence, change or dismissal never shows the card', () => {
  const a = row('unpushed:proj-zed:3', 'unpushed', 'scan'), b2 = row('unpushed:proj-zed:5', 'unpushed', 'scan');
  const silent = run([[0, brief([UNPUSHED])], [30, brief([], { errors: [{ source: 'scan', error: 'x' }] })], [60, brief([], { at: at(60) })]]);
  assert.equal(allClearOf(silent.ledger, brief([], { at: at(60) }), { now: at(61) }), null, 'silence');
  const changed = run([[0, brief([a])], [30, brief([b2])], [60, brief([], { at: at(60) }), { dismissedKeys: [b2.key] }]]);
  assert.deepEqual(closedHows(changed.ledger), ['changed', 'dismissed']);
  assert.equal(allClearOf(changed.ledger, brief([], { at: at(60) }), { now: at(61) }), null, 'change then dismissal');
});

test('allClear: the whole busy stretch is listed, so a row closed earlier while others were live is not lost', () => {
  const { ledger } = run([[0, brief([UNPUSHED, LATE])], [60, brief([LATE], { at: at(60) })], [120, brief([], { at: at(120) })]]);
  const a = allClearOf(ledger, brief([], { at: at(120) }), { now: at(121) });
  assert.deepEqual(a.resolved.map((r) => r.text), ['Work not pushed', 'A bill is late']);
});

test('allClear: acted counts like resolved, and the ack makes it null until the Brief has had something again', () => {
  const marked = { ...UNPUSHED, acted: { verb: 'quest-done', at: at(10).toISOString() } };
  let { ledger } = run([[0, brief([UNPUSHED])], [10, brief([marked])], [60, brief([], { at: at(60) })]]);
  const empty = brief([], { at: at(60) });
  assert.equal(allClearOf(ledger, empty, { now: at(61) }).resolved[0].how, 'acted');
  ledger = markShown(ledger, at(62));
  assert.equal(ledger.lastClearShownAt, at(62).toISOString());
  assert.equal(allClearOf(ledger, empty, { now: at(63) }), null, 'shown once');
  assert.equal(allClearOf(ledger, empty, { now: at(63 + 10 * D) }), null, 'and not again days later');
  // the Brief has something again, then clears by a real resolve: a new episode, a new card
  ledger = observe(ledger, brief([CI], { at: at(100) }), { now: at(100) }).ledger;
  ledger = observe(ledger, brief([], { at: at(160) }), { now: at(160) }).ledger;
  const again = allClearOf(ledger, brief([], { at: at(160) }), { now: at(161) });
  assert.deepEqual(again.resolved.map((r) => r.text), ['CI failing on a repo'], 'only the new episode, not the one already shown');
});

test('a count in the ledger words the many-form of a rule', () => {
  const many = row('unpushed:proj-zed:3', 'unpushed', 'scan', 'med', { count: 3 });
  const { ledger } = run([[0, brief([many])], [30, brief([])]]);
  assert.equal(summarize(ledger, brief([]), { now: at(31) }).entries[0].text, 'Work not pushed in 4 projects');
  assert.deepEqual(HOWS, ['resolved', 'acted', 'dismissed', 'changed', 'silent']);
});
