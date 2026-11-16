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

test('batch 6: an aged row moving between standing and the last slot is never closed, a quiet line is never observed, and a group field changes nothing', () => {
  const standing = { ...SECRETS, since: at(0).toISOString() };
  const aged = { ...SECRETS, aged: { since: at(0).toISOString() } };
  const quiet = { key: 'quiet:quiet-bridge-unpaired', rule: 'quiet-bridge-unpaired', kind: null, text: 'x', why: 'x', source: 'bridge', age: 'x', action: { kind: 'scan' } };
  const { ledger } = run([
    [0, brief([UNPUSHED], { standing: [standing] })],
    [D, brief([UNPUSHED, aged], { standing: [] })],                      // the aged day: the standing row sits in the last slot
    [2 * D, brief([UNPUSHED], { standing: [standing] })],                // the rest day: back in standing
    [3 * D, { ...brief([UNPUSHED, { ...aged, group: { n: 2, sinceAt: null, listAction: null } }]), quiet }],
  ]);
  assert.deepEqual(ledger.closed, [], 'the move between standing and items is not a close');
  assert.equal(Object.keys(ledger.open).length, 2, 'the quiet line never opens an entry');
  assert.ok(!JSON.stringify(ledger).includes('quiet'));
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Batch 8 (ledger core): subjects, per-subject closure, labels, the 72 h hold, the one-day gap, came-back, set-aside. Placeholder names only.
import { subjectRefOf, CLEAR_LABELS, HOLDS, HOLD_MS, OUTSIDE_RULES } from './brief-ledger.mjs';

const H = 60;   // minutes in an hour
const sub = (key, rule, source, subject, severity = 'med', extra) => row(key, rule, source, severity, { subject, ...(extra || {}) });
const A1 = sub('unpushed:proj-a:3', 'unpushed', 'scan', 'proj-a');
const A2 = sub('unpushed:proj-a:2', 'unpushed', 'scan', 'proj-a');
const B1 = sub('unpushed:proj-b:1', 'unpushed', 'scan', 'proj-b');
// observe the ledger hourly from minute `from` to `to` (inclusive) with the same rows
const hourly = (ledger, from, to, items, o) => {
  let l = ledger;
  for (let m = from; m <= to; m += H) l = observe(l, brief(items, { at: at(m), ...(o || {}) }), { now: at(m) }).ledger;
  return l;
};

test('subjectRefOf is a one-way hash of rule and subject: stable, 12 hex, differs by rule and subject, never contains the subject', () => {
  const r = subjectRefOf('unpushed', 'proj-a');
  assert.match(r, /^[0-9a-f]{12}$/);
  assert.equal(r, subjectRefOf('unpushed', 'proj-a'));
  assert.notEqual(r, subjectRefOf('unpushed', 'proj-b'));
  assert.notEqual(r, subjectRefOf('dirty', 'proj-a'));
  assert.equal(subjectRefOf('unpushed', undefined), undefined);
  assert.equal(typeof subjectRefOf('scan-stale', ''), 'string', 'an empty subject is still a subject (one thing per rule)');
});

test('the raw subject is never persisted: not in the open map, the closed list or the JSON text', () => {
  const { ledger } = run([[0, brief([A1])], [30, brief([A1], { at: at(30) })], [60, brief([], { at: at(60) })], [90, brief([B1], { at: at(90) })]]);
  const text = JSON.stringify(ledger);
  assert.ok(!text.includes('proj-a') && !text.includes('proj-b') && !text.includes('subject"'), text);
  assert.ok(Object.values(ledger.open).every((e) => /^[0-9a-f]{12}$/.test(e.subjectRef)));
});

test('per-subject closure: a rule shows only its worst subject, so a swap to another subject is changed, never a clear or a hold', () => {
  const { ledger, last } = run([[0, brief([A1])], [30, brief([B1], { at: at(30) })]]);
  assert.deepEqual(last.closed, [{ rule: 'unpushed', how: 'changed' }]);
  assert.equal(ledger.closed[0].how, 'changed');
  assert.equal(ledger.closed[0].label, undefined);
  assert.equal(ledger.closed[0].hold, undefined);
  assert.deepEqual(Object.values(ledger.open).map((e) => e.subjectRef), [subjectRefOf('unpushed', 'proj-b')]);
  // the overtaking case from the taster report: a is still dirty, b overtakes it, 80 hours pass: nothing was cleared and nothing is held
  const r = run([[0, brief([A1])], [30, brief([B1], { at: at(30) })], [80 * 60, brief([B1], { at: at(80 * 60) })]]);
  const s = summarize(r.ledger, brief([B1], { at: at(80 * 60) }), { now: at(80 * 60) });
  assert.equal(s.clearedThisWeek, 0);
  assert.equal(s.clears.scanConfirmed, 0);
  assert.equal(s.heldThisWeek, 0);
});

test('a clear that is only known because the rule went quiet still counts: the rule leaves entirely, then another subject appears', () => {
  const { ledger } = run([[0, brief([A1])], [30, brief([], { at: at(30) })], [60, brief([B1], { at: at(60) })]]);
  assert.equal(ledger.closed[0].how, 'resolved');
  assert.equal(ledger.closed[0].hold, 'pending');
  assert.equal(ledger.closed[0].subjectRef, subjectRefOf('unpushed', 'proj-a'));
});

test('a pending clear with no readable wait is given the full wait from load time (it ended just before), and one observe never turns it held', () => {
  const { ledger } = run([[0, brief([A1])], [30, brief([], { at: at(30) })]]);
  const damaged = JSON.parse(JSON.stringify(ledger));
  delete damaged.closed[0].heldUntil;
  const fixed = cleanLedger(damaged, at(60));
  assert.equal(fixed.closed[0].hold, 'pending');
  assert.equal(fixed.closed[0].heldUntil, new Date(at(60).getTime() + 72 * 3600e3).toISOString());
  const o = observe(damaged, brief([], { at: at(90) }), { now: at(90) });
  assert.equal(o.ledger.closed[0].hold, 'pending');
  assert.equal(o.ledger.closed[0].heldAt, undefined);
});

test('a pending clear with no readable wait that ended long ago stays pending one hour after load, and is not counted held', () => {
  const { ledger } = run([[0, brief([A1])], [30, brief([], { at: at(30) })]]);
  const damaged = JSON.parse(JSON.stringify(ledger));
  delete damaged.closed[0].heldUntil;
  damaged.obsAt = null;
  damaged.closed[0].first = at(-130 * 60).toISOString();
  damaged.closed[0].ended = at(-120 * 60).toISOString();   // ended 120 hours before the app loaded the file
  const o1 = observe(damaged, brief([], { at: at(60) }), { now: at(60) });
  assert.equal(o1.ledger.closed[0].hold, 'pending');
  assert.equal(o1.ledger.closed[0].heldUntil, new Date(at(60).getTime() + 72 * 3600e3).toISOString());
  const o2 = observe(o1.ledger, brief([], { at: at(120) }), { now: at(120) });
  assert.equal(o2.ledger.closed[0].hold, 'pending');
  assert.equal(o2.ledger.closed[0].heldAt, undefined);
  assert.equal(summarize(o2.ledger, { now: at(120) }).heldThisWeek, 0);
});

test('held is a subset of cleared this week, and the headline uses the same one-per-subject basis as the breakdown', () => {
  // ended 8 days ago and held 5 days ago: in neither number
  const old = { v: 1, open: {}, busyFrom: null, lastClearShownAt: null, obsAt: at(8 * D).toISOString(), closed: [{ rule: 'unpushed', severity: 'med', count: 0, first: at(0).toISOString(), ended: at(D).toISOString(), how: 'resolved', label: 'scan-confirmed', hold: 'held', heldAt: at(4 * D).toISOString(), subjectRef: subjectRefOf('unpushed', 'proj-a') }] };
  const s = summarize(old, brief([], { at: at(9 * D) }), { now: at(9 * D) });
  assert.equal(s.clearedThisWeek, 0);
  assert.equal(s.heldThisWeek, 0);
});

test('per-subject closure: the same subject with a new value stays changed and carries its age; nothing counts', () => {
  const { ledger, last } = run([[0, brief([A1])], [3 * D, brief([A2], { at: at(3 * D) })]]);
  assert.deepEqual(last.closed, [{ rule: 'unpushed', how: 'changed' }]);
  assert.equal(ledger.closed[0].how, 'changed');
  assert.equal(ledger.closed[0].hold, undefined);
  assert.equal(ledger.closed[0].label, undefined);
  assert.equal(Object.values(ledger.open)[0].first, at(0).toISOString(), 'age carries across the value change');
  const s = summarize(ledger, brief([A2], { at: at(3 * D) }), { now: at(3 * D) });
  assert.equal(s.clearedThisWeek, 0);
  assert.equal(s.oldestOpen.after, '3 d');
});

test('a pile that shrinks (3 to 2) is the same subject: age carries, nothing counts', () => {
  const p3 = sub('dirty:proj-a:30', 'dirty', 'scan', 'proj-a', 'low', { count: 3 });
  const p2 = sub('dirty:proj-a:29', 'dirty', 'scan', 'proj-a', 'low', { count: 2 });
  const { ledger } = run([[0, brief([p3])], [H, brief([p2], { at: at(H) })]]);
  assert.deepEqual(closedHows(ledger), ['changed']);
  assert.equal(ledger.closed[0].hold, undefined);
  assert.equal(Object.values(ledger.open)[0].first, at(0).toISOString());
});

test('without a subject (a legacy caller) the old rule holds: same rule live means changed, and no label or hold is written', () => {
  const { ledger } = run([[0, brief([UNPUSHED])], [30, brief([row('unpushed:other:1', 'unpushed', 'scan')], { at: at(30) })]]);
  assert.deepEqual(closedHows(ledger), ['changed']);
  const r = run([[0, brief([UNPUSHED])], [30, brief([])]]);
  assert.equal(r.ledger.closed[0].hold, undefined);
  assert.equal(r.ledger.closed[0].subjectRef, undefined);
});

test('opts.subjects supplies the subject by key when the row carries none (brief.js strips it before the file is written)', () => {
  const plain = row('unpushed:proj-a:3', 'unpushed', 'scan');
  const { ledger } = run([[0, brief([plain]), { subjects: { [plain.key]: 'proj-a' } }]]);
  assert.equal(Object.values(ledger.open)[0].subjectRef, subjectRefOf('unpushed', 'proj-a'));
});

test('hold: a clear is pending for 72 h of observation, then held', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })]]).ledger;
  assert.equal(l.closed[0].hold, 'pending');
  assert.equal(l.closed[0].heldUntil, new Date(at(H).getTime() + HOLD_MS).toISOString());
  l = hourly(l, 2 * H, 2 * D, []);   // observed every hour for two days: still pending
  assert.equal(l.closed[0].hold, 'pending');
  let s = summarize(l, brief([], { at: at(2 * D) }), { now: at(2 * D) });
  assert.equal(s.heldThisWeek, 0);
  assert.equal(s.pendingNow, 1);
  l = hourly(l, 2 * D + H, H + 3 * D, []);   // 72 h after the clear: held
  assert.equal(l.closed[0].hold, 'held');
  assert.equal(l.closed[0].heldAt, at(H + 3 * D).toISOString());
  s = summarize(l, brief([], { at: at(H + 3 * D) }), { now: at(H + 3 * D) });
  assert.equal(s.heldThisWeek, 1);
  assert.equal(s.pendingNow, 0);
});

test('gap reset: no observation for over a day restarts the hold', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })]]).ledger;
  l = observe(l, brief([], { at: at(2 * D) }), { now: at(2 * D) }).ledger;     // a 47 h silence: the hold restarts from here
  assert.equal(l.closed[0].hold, 'pending');
  assert.equal(l.closed[0].heldUntil, new Date(at(2 * D).getTime() + HOLD_MS).toISOString());
  // 3 days + 1 h after the clear would have passed the original hold, but a second 49 h silence restarts it again
  l = observe(l, brief([], { at: at(4 * D) }), { now: at(4 * D) }).ledger;
  assert.equal(l.closed[0].hold, 'pending');
  assert.equal(l.closed[0].heldUntil, new Date(at(4 * D).getTime() + HOLD_MS).toISOString());
});

test('a gap under a day (a restart, a nap) does not reset the hold', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })]]).ledger;
  const until = l.closed[0].heldUntil;
  l = observe(l, brief([], { at: at(H + 20 * H) }), { now: at(H + 20 * H), coldStart: true }).ledger;
  assert.equal(l.closed[0].heldUntil, until);
});

test('came-back: the same rule and subject live again inside the hold cancels the pending clear, and it never counts', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })]]).ledger;
  l = observe(l, brief([A1], { at: at(D) }), { now: at(D) }).ledger;
  assert.equal(l.closed[0].hold, 'came-back');
  assert.equal(l.closed[0].cameBackAt, at(D).toISOString());
  assert.equal(l.closed[0].heldUntil, undefined);
  const s = summarize(l, brief([A1], { at: at(D) }), { now: at(D) });
  assert.equal(s.clearedThisWeek, 0, 'a clear that came back is not a clear');
  assert.equal(s.cameBackThisWeek, 1);
  assert.equal(s.pendingNow, 0);
  assert.equal(s.entries.find((e) => e.how === 'resolved').hold, 'came-back');
});

test('came-back is for a pending clear only: a different subject going live does not cancel it', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })], [H + 5, brief([B1], { at: at(H + 5) })]]).ledger;   // a is gone, then b is new
  l = observe(l, brief([B1], { at: at(D) }), { now: at(D) }).ledger;
  assert.equal(l.closed.find((c) => c.subjectRef === subjectRefOf('unpushed', 'proj-a')).hold, 'pending');
});

test('dismissed is set aside: never a clear, never held, never a label, with its age; and it stops being set aside when the subject is live again', () => {
  const { ledger } = run([[0, brief([A1])], [2 * D, brief([], { at: at(2 * D) }), { dismissedKeys: [A1.key] }]]);
  const c = ledger.closed[0];
  assert.equal(c.how, 'dismissed');
  assert.equal(c.setAside, true);
  assert.equal(c.hold, undefined);
  assert.equal(c.label, undefined);
  const s = summarize(ledger, brief([], { at: at(2 * D) }), { now: at(2 * D) });
  assert.equal(s.clearedThisWeek, 0);
  assert.equal(s.dismissedThisWeek, 1);
  assert.equal(s.heldThisWeek, 0);
  assert.equal(s.setAside.count, 1);
  assert.equal(s.setAside.oldest.after, '2 d');
  assert.equal(s.setAside.items[0].text, phraseOf('unpushed', 0));
  // its fact moves on (a new value): the Brief shows it again, it is no longer set aside, and the age is carried
  const back = observe(ledger, brief([A2], { at: at(3 * D) }), { now: at(3 * D) }).ledger;
  assert.equal(back.closed[0].setAside, undefined);
  assert.equal(Object.values(back.open)[0].first, at(0).toISOString());
  assert.equal(summarize(back, brief([A2], { at: at(3 * D) }), { now: at(3 * D) }).setAside.count, 0);
});

test('set-aside rows never make the board clean: allClear stays null for a ledger whose only close is a dismissal', () => {
  const { ledger } = run([[0, brief([A1])], [30, brief([], { at: at(30) }), { dismissedKeys: [A1.key] }]]);
  assert.equal(allClearOf(ledger, brief([], { at: at(30) }), { now: at(30) }), null);
});

test('senses sources are labelled unknown and never held; the clear is shown and counted apart', () => {
  const ci = sub('ci-red:repo-q:1', 'ci-red', 'github', 'repo-q');
  let l = run([[0, brief([ci])], [H, brief([], { at: at(H) })]]).ledger;
  const c = l.closed[0];
  assert.equal(c.how, 'resolved');
  assert.equal(c.label, 'unknown');
  assert.equal(c.hold, 'never');
  assert.equal(c.heldUntil, undefined);
  l = hourly(l, 2 * H, 5 * D, []);
  assert.equal(l.closed[0].hold, 'never', 'never becomes held, however long it stays gone');
  const s = summarize(l, brief([], { at: at(5 * D) }), { now: at(5 * D) });
  assert.equal(s.heldThisWeek, 0);
  assert.deepEqual(s.clears, { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 1 });
});

test('a row the owner acted on closes acted: in place for a verb that changes a fact, marked done for a quest, and only in place is held', () => {
  const dirty = sub('dirty:proj-a:12', 'dirty', 'scan', 'proj-a', 'low', { acted: { verb: 'commit', at: at(10).toISOString() } });
  const quest = sub('quest-red:q-1', 'quest-red', 'scan', 'q-1', 'high', { acted: { verb: 'quest-done', at: at(10).toISOString() } });
  const { ledger } = run([[0, brief([dirty, quest])], [30, brief([], { at: at(30) })]]);
  const by = (rule) => ledger.closed.find((c) => c.rule === rule);
  assert.deepEqual([by('dirty').how, by('dirty').label, by('dirty').hold], ['acted', 'in-place', 'pending']);
  assert.deepEqual([by('quest-red').how, by('quest-red').label, by('quest-red').hold], ['acted', 'marked-done', 'never']);
  const s = summarize(ledger, brief([], { at: at(30) }), { now: at(30) });
  assert.deepEqual(s.clears, { inPlace: 1, markedDone: 1, scanConfirmed: 0, unknown: 0 });
  assert.equal(s.pendingNow, 1, 'only the in-place clear waits out a hold');
});

test('a quiet source (an error on it) cannot call a gone row fixed: silent, no hold', () => {
  const { ledger } = run([[0, brief([A1])], [H, brief([], { at: at(H), errors: [{ source: 'scan', error: 'placeholder' }] })]]);
  assert.equal(ledger.closed[0].how, 'silent');
  assert.equal(ledger.closed[0].hold, undefined);
});

test('one count per rule and subject per week: closing, returning and closing the same subject counts once', () => {
  let l = run([[0, brief([A1])], [H, brief([], { at: at(H) })]]).ledger;
  l = hourly(l, 2 * H, H + 3 * D, []);                                                                    // held
  l = observe(l, brief([A1], { at: at(H + 3 * D + H) }), { now: at(H + 3 * D + H) }).ledger;              // it returns after the hold: a new row
  l = observe(l, brief([], { at: at(H + 3 * D + 2 * H) }), { now: at(H + 3 * D + 2 * H) }).ledger;        // cleared again
  const now = at(H + 3 * D + 2 * H);
  const s = summarize(l, brief([], { at: now }), { now });
  assert.equal(s.clears.scanConfirmed, 1, 'two closes of one subject in a week: one count');
  assert.equal(s.heldThisWeek, 1);
});

test('a first sight closes nothing: a row must be seen in a compute before it can clear', () => {
  const { ledger, last } = run([[0, brief([A1])]]);
  assert.deepEqual(last.closed, []);
  assert.deepEqual(ledger.closed, []);
});

test('the strip numbers: oldest open row excludes the rows the app cannot fix, which sit on their own line', () => {
  const pc = sub('pc-ember:disk-x', 'pc-ember', 'pc-health', 'disk-x', 'med');
  const old = sub('claude-sync:0:never', 'claude-sync', 'claude', '', 'low');
  const { ledger } = run([[0, brief([pc, old])], [5 * D, brief([pc, old, A1], { at: at(5 * D) })]]);
  const now = at(5 * D);
  const s = summarize(ledger, brief([pc, old, A1], { at: now }), { now });
  assert.equal(s.openCount, 1);
  assert.equal(s.oldestOpen.after, durationWords(0), 'only the in-app row counts, and it is new');
  assert.equal(s.outside.count, 2);
  assert.deepEqual(s.outside.rules.sort(), ['claude-sync', 'pc-ember']);
  assert.ok(OUTSIDE_RULES.includes('review-waiting'));
});

test('summarize keeps every earlier field, and the new numbers are plain counts (no score, no total)', () => {
  const s = summarize(emptyLedger(), brief([]), { now: at(0) });
  assert.deepEqual(Object.keys(s).sort(), ['allClear', 'cameBackThisWeek', 'clearedThisWeek', 'clears', 'dismissedThisWeek', 'entries', 'heldThisWeek', 'oldestOpen', 'openCount', 'outside', 'pendingNow', 'setAside']);
  assert.ok(!('score' in s) && !('total' in s) && !('level' in s));
  assert.equal(s.oldestOpen, null);
  assert.deepEqual(s.setAside, { count: 0, oldest: null, items: [] });
});

test('legacy file: a ledger written before batch 8 loads unchanged, keeps its rows, and gains nothing it did not have', () => {
  const legacy = {
    v: 1, busyFrom: at(0).toISOString(), lastClearShownAt: null,
    open: { [refOf('unpushed:proj-a:3')]: { rule: 'unpushed', source: 'scan', severity: 'med', count: 0, first: at(0).toISOString(), last: at(60).toISOString() } },
    closed: [{ rule: 'dirty', severity: 'low', count: 0, first: at(0).toISOString(), ended: at(120).toISOString(), how: 'resolved' }],
  };
  const c = cleanLedger(legacy, at(180));
  assert.deepEqual(c.open[refOf('unpushed:proj-a:3')], legacy.open[refOf('unpushed:proj-a:3')]);
  assert.deepEqual(c.closed, legacy.closed);
  assert.equal(c.obsAt, null);
  const s = summarize(c, brief([]), { now: at(180) });
  assert.equal(s.clearedThisWeek, 1);
  assert.deepEqual(s.clears, { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 0 }, 'a legacy close has no label: counted as before, not as a labelled clear');
  assert.equal(s.heldThisWeek, 0);
  const r = observe(c, brief([A1], { at: at(200) }), { now: at(200) });   // the old open row has no subjectRef: adopted without error
  assert.equal(r.ledger.obsAt, at(200).toISOString());
  assert.ok(Object.values(r.ledger.open).some((e) => e.subjectRef));
});

test('cleanLedger passes the new fields through and drops anything unknown or malformed', () => {
  const ref = refOf('x');
  const c = cleanLedger({
    v: 1, obsAt: at(5).toISOString(), open: { [ref]: { rule: 'dirty', source: 'scan', severity: 'low', count: 1, first: at(0).toISOString(), last: at(5).toISOString(), subjectRef: ref, actedVerb: 'commit', acted: at(3).toISOString(), extra: 'x' } },
    closed: [{ rule: 'dirty', severity: 'low', count: 1, first: at(0).toISOString(), ended: at(5).toISOString(), how: 'acted', subjectRef: ref, label: 'in-place', hold: 'pending', heldUntil: at(9).toISOString(), setAside: true, junk: 1 },
      { rule: 'dirty', severity: 'low', count: 1, first: at(0).toISOString(), ended: at(5).toISOString(), how: 'acted', subjectRef: 'not a ref', label: 'bogus', hold: 'bogus', heldUntil: 'not a date', setAside: 'yes' }],
  }, at(10));
  assert.deepEqual(Object.keys(c.open[ref]).sort(), ['acted', 'actedVerb', 'count', 'first', 'last', 'rule', 'severity', 'source', 'subjectRef']);
  assert.deepEqual(Object.keys(c.closed[0]).sort(), ['count', 'ended', 'first', 'heldUntil', 'hold', 'how', 'label', 'rule', 'setAside', 'severity', 'subjectRef']);
  assert.deepEqual(Object.keys(c.closed[1]).sort(), ['count', 'ended', 'first', 'how', 'rule', 'severity']);
  assert.equal(CLEAR_LABELS.length, 4);
  assert.equal(HOLDS.length, 4);
});

test('the engine never throws on junk with subjects, and does not mutate its inputs', () => {
  const b = brief([A1, { key: 5, rule: {}, subject: 9 }, null]);
  const copy = JSON.stringify(b), led = run([[0, brief([A1])]]).ledger, ledCopy = JSON.stringify(led);
  assert.doesNotThrow(() => observe(led, b, { now: at(10), subjects: 'nope' }));
  assert.doesNotThrow(() => observe(led, brief([]), { now: at(2 * D), subjects: { a: 1 } }));
  assert.equal(JSON.stringify(b), copy);
  assert.equal(JSON.stringify(led), ledCopy);
});
