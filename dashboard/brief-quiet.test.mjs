// Brief unclog: group rows, the aged slot, the quiet lane (dashboard/brief-quiet.mjs). Pure; invented placeholder rows only (the repo is public).
//   node --test dashboard/brief-quiet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shape, agedSlot, groupField, withGroups, groupKeysOf, groupKey, quietCandidates, pickQuiet, isToastable, dayIndex,
  COLLAPSE_RULES, LIST_ACTION_RULES, QUIET_RULES, DARK_KINDS, DARK_LABEL, DARK_MS, DAY_MS,
} from './brief-quiet.mjs';

const H = 3600e3, D = DAY_MS;
const at = (d, h = 10) => d * D + h * H;   // a time inside UTC day number d
const iso = (ms) => new Date(ms).toISOString();

const row = (rule, severity, o = {}) => ({ key: rule + ':placeholder:' + (o.v || 1), rule, severity, text: 'Placeholder ' + rule, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action: { kind: 'go', tab: 'tasks' }, count: 0, ...o });
const standingRow = (rule, severity, sinceMs, o = {}) => ({ ...row(rule, severity, o), since: iso(sinceMs) });

// ---------------------------------------------------------------------------------------------------------------------------------- the slot rule

test('with three fresh rows no standing row ever shows, whatever the day', () => {
  const fresh = [row('scan-failed', 'high'), row('unpushed', 'med'), row('dirty', 'low')];
  const standing = [standingRow('quest-red', 'high', at(0)), standingRow('scan-stale', 'med', at(0))];
  for (let d = 0; d < 12; d++) {
    const r = agedSlot({ fresh, standing, now: at(d), cap: 3 });
    assert.equal(r.aged, null, 'day ' + d);
    assert.equal(r.standing.length, 2);
  }
});

test('two fresh rows and three standing candidates: the candidate at day mod 4, a rest day when that is 3', () => {
  const fresh = [row('scan-failed', 'high'), row('unpushed', 'med')];
  const cands = [standingRow('quest-red', 'high', at(0), { v: 1 }), standingRow('scan-stale', 'med', at(0), { v: 2 }), standingRow('money-stale', 'med', at(0), { v: 3 })];
  const low = standingRow('dirty', 'low', at(0));
  const standing = [cands[0], cands[1], low, cands[2]];   // ranked order; the low row sits between and is not a candidate
  for (let d = 100; d < 112; d++) {
    const r = agedSlot({ fresh, standing, now: at(d), cap: 3 });
    const pos = d % 4;
    if (pos === 3) { assert.equal(r.aged, null, 'rest day ' + d); assert.equal(r.standing.length, 4); }
    else {
      assert.equal(r.aged.key, cands[pos].key, 'day ' + d);
      assert.equal(r.standing.length, 3, 'the aged row left standing that day');
      assert.ok(!r.standing.some((s) => s.key === cands[pos].key));
      assert.ok(r.standing.includes(low), 'the low row stays in the standing line');
    }
  }
});

test('only low standing rows: never in items, whatever the day', () => {
  const standing = [standingRow('dirty', 'low', at(0)), standingRow('money-backup', 'low', at(0))];
  for (let d = 0; d < 10; d++) {
    const r = agedSlot({ fresh: [], standing, now: at(d), cap: 3 });
    assert.equal(r.aged, null);
    assert.deepEqual(r.standing, standing);
  }
});

test('a single candidate shows on alternate days and the day after it is back in standing', () => {
  const one = standingRow('quest-red', 'high', at(0));
  const seen = [];
  for (let d = 40; d < 46; d++) { const r = agedSlot({ fresh: [], standing: [one], now: at(d), cap: 3 }); seen.push(!!r.aged); if (r.aged) assert.deepEqual(r.standing, []); else assert.deepEqual(r.standing, [one]); }
  assert.deepEqual(seen, [true, false, true, false, true, false]);   // day 40 is even: pos = 40 mod 2 = 0
});

test('no standing row holds a slot two days running, and never more than one aged row', () => {
  for (const n of [1, 2, 3, 5]) {
    const standing = Array.from({ length: n }, (_, k) => standingRow('quest-red', k % 2 ? 'med' : 'high', at(0), { v: k + 1 }));
    let prev = null;
    for (let d = 200; d < 240; d++) {
      const r = agedSlot({ fresh: [], standing, now: at(d), cap: 3 });
      const k = r.aged ? r.aged.key : null;
      if (k !== null) assert.notEqual(k, prev, 'n=' + n + ' day ' + d + ' repeats ' + k);
      prev = k;
      assert.equal(standing.length - r.standing.length, r.aged ? 1 : 0, 'at most one row moved');
    }
  }
});

test('shape: items never above three, aged is last and carries aged.since without a top-level since', () => {
  const fresh = [row('scan-failed', 'high'), row('unpushed', 'med')];
  const since = at(1);
  const standing = [standingRow('quest-red', 'high', since)];
  const d = 300;   // 300 mod 2 = 0: the single candidate shows
  const r = shape({ fresh, standing, now: at(d), firstSeen: {}, cap: 3 });
  assert.ok(r.aged);
  const items = r.fresh.slice(0, 3).concat(r.aged ? [r.aged] : []);
  assert.equal(items.length, 3);
  assert.equal(items[2].key, standing[0].key);
  assert.deepEqual(r.aged.aged, { since: iso(since) });
  assert.equal('since' in r.aged, false);
  assert.deepEqual(r.standing, []);
  // the next day it is back, with its since intact
  const r2 = shape({ fresh, standing, now: at(d + 1), firstSeen: {}, cap: 3 });
  assert.equal(r2.aged, null);
  assert.equal(r2.standing[0].since, iso(since));
});

test('shape leaves fresh in length and order, adds nothing when nothing applies, and survives garbage', () => {
  const fresh = [row('scan-failed', 'high'), row('scan-stale', 'med')];
  const r = shape({ fresh, standing: [], now: at(5), firstSeen: {}, quietInputs: null, money: null, cap: 3 });
  assert.deepEqual(r.fresh, fresh);
  assert.deepEqual(r.standing, []);
  assert.equal(r.aged, null);
  assert.equal(r.quiet, null);
  for (const bad of [undefined, null, 5, 'x', [], { fresh: 'nope', standing: 7, now: NaN, quietInputs: 3 }]) assert.doesNotThrow(() => shape(bad));
  assert.deepEqual(shape({ fresh: 'nope', standing: 7, now: NaN }), { fresh: [], standing: [], aged: null, quiet: null });
});

// ---------------------------------------------------------------------------------------------------------------------------------- group rows

test('a collapsed row gains group { n, sinceAt, listAction }; sinceAt comes from the GROUP key, not the item key', () => {
  const worst = row('unpushed', 'med', { key: 'unpushed:placeholder-a:5', count: 3, action: { kind: 'go', tab: 'projects', projectId: 'placeholder-a' } });
  const firstSeen = { 'unpushed:placeholder-a:5': { first: iso(at(9)), last: iso(at(9)) }, 'group:unpushed': { first: iso(at(2)), last: iso(at(9)) } };
  const g = groupField(worst, firstSeen);
  assert.deepEqual(g, { n: 4, sinceAt: iso(at(2)), listAction: { kind: 'go', tab: 'projects', sub: 'grid' } });
  // the worst project rotates to another key: the group clock does not move
  const rotated = { ...worst, key: 'unpushed:placeholder-b:7' };
  assert.equal(groupField(rotated, firstSeen).sinceAt, iso(at(2)));
  // no group key remembered: null, never the item key's time
  assert.equal(groupField(worst, { 'unpushed:placeholder-a:5': { first: iso(at(9)), last: iso(at(9)) } }).sinceAt, null);
  assert.equal(groupField(worst, null).sinceAt, null);
  assert.equal(groupField(worst, { 'group:unpushed': { first: 'not a date', last: 'x' } }).sinceAt, null);
});

test('the row keeps its own action (Commit reads action.projectId) and nothing else changes', () => {
  const r = row('dirty', 'low', { count: 2, action: { kind: 'go', tab: 'projects', projectId: 'placeholder-a' } });
  const [out] = withGroups([r], {});
  assert.deepEqual(out.action, { kind: 'go', tab: 'projects', projectId: 'placeholder-a' });
  const { group, ...rest } = out;
  assert.deepEqual(rest, r);
  assert.equal(group.n, 3);
});

test('no group when count is 0, or for a rule that does not collapse; listAction only on the four project rules', () => {
  assert.equal(groupField(row('unpushed', 'med', { count: 0 }), {}), null);
  assert.equal(groupField(row('money-late', 'high', { count: 2 }), {}), null);
  assert.equal(groupField(row('scan-stale', 'med', { count: 2 }), {}), null);
  assert.equal(groupField({ rule: 'dirty', count: 'many' }, {}), null);
  assert.equal(groupField(null, {}), null);
  assert.deepEqual([...COLLAPSE_RULES].sort(), ['ci-red', 'dirty', 'prod-deploy-error', 'review-waiting', 'secrets', 'session-left-dirty', 'unpushed']);
  for (const rule of COLLAPSE_RULES) {
    const g = groupField(row(rule, 'med', { count: 1 }), {});
    assert.equal(g.n, 2, rule);
    if (LIST_ACTION_RULES.includes(rule)) assert.deepEqual(g.listAction, { kind: 'go', tab: 'projects', sub: 'grid' }, rule);
    else assert.equal(g.listAction, null, rule);
  }
  assert.deepEqual([...LIST_ACTION_RULES].sort(), ['dirty', 'secrets', 'session-left-dirty', 'unpushed']);
});

test('groupKeysOf lists the stable group keys once each, for the engine caller to stamp', () => {
  const rows = [row('unpushed', 'med', { count: 2 }), row('dirty', 'low', { count: 0 }), row('ci-red', 'high', { count: 1 }), row('unpushed', 'med', { count: 4, key: 'unpushed:other:1' })];
  assert.deepEqual(groupKeysOf(rows), ['group:unpushed', 'group:ci-red']);
  assert.equal(groupKey('secrets'), 'group:secrets');
});

test('standing rows get their group field too, so a re-admitted aged row keeps it', () => {
  const s = standingRow('unpushed', 'med', at(0), { count: 2 });
  const r = shape({ fresh: [], standing: [s], now: at(400), firstSeen: { 'group:unpushed': { first: iso(at(1)), last: iso(at(9)) } }, cap: 3 });
  assert.equal(r.aged.group.sinceAt, iso(at(1)));
  assert.equal(r.aged.group.n, 3);
});

// ---------------------------------------------------------------------------------------------------------------------------------- quiet lane

const ALL_TRUE = (now) => ({
  security: { started: false }, bridge: { paired: false }, moneyOpened: false,
  sources: [{ kind: 'pc-health', mtimeMs: now - 4 * D }, { kind: 'github', mtimeMs: now - 5 * D }],
});
const MONEY_EMPTY = { hasAccounts: false, accounts: [] };

test('the candidates are the true facts, in the fixed order, one rule id each', () => {
  const now = at(500);
  const c = quietCandidates({ quietInputs: ALL_TRUE(now), money: MONEY_EMPTY, now });
  assert.deepEqual(c.map((x) => x.key), ['quiet:quiet-security-unstarted', 'quiet:quiet-bridge-unpaired', 'quiet:quiet-money-unopened', 'quiet:quiet-source-dark:pc-health', 'quiet:quiet-source-dark:github']);
  assert.deepEqual(c.map((x) => x.rule), ['quiet-security-unstarted', 'quiet-bridge-unpaired', 'quiet-money-unopened', 'quiet-source-dark', 'quiet-source-dark']);
  assert.deepEqual([...new Set(c.map((x) => x.rule))].every((r) => QUIET_RULES.includes(r)), true);
  for (const x of c) { assert.ok(x.text && x.why && x.source && x.age && x.action && x.action.kind === 'go', x.key); assert.deepEqual(Object.keys(x).sort(), ['action', 'age', 'key', 'kind', 'rule', 'source', 'text', 'why']); }
});

test('the quiet lane shows ONE candidate a day: index = day mod count, rotating over the true ones', () => {
  const now0 = at(600);
  const inputs = { security: { started: false }, bridge: { paired: false }, moneyOpened: true, sources: [{ kind: 'accounts', mtimeMs: now0 - 9 * D }] };
  const c = quietCandidates({ quietInputs: inputs, money: MONEY_EMPTY, now: now0 });
  assert.equal(c.length, 3);
  const seen = [];
  for (let d = 600; d < 606; d++) {
    const q = pickQuiet({ quietInputs: inputs, money: MONEY_EMPTY, now: at(d) });
    assert.equal(q.key, quietCandidates({ quietInputs: inputs, money: MONEY_EMPTY, now: at(d) })[d % 3].key, 'day ' + d);
    seen.push(q.key);
  }
  assert.deepEqual(seen.slice(0, 3), seen.slice(3, 6));
  assert.equal(new Set(seen).size, 3, 'every candidate gets its day');
  // the same day, asked twice: the same line
  assert.equal(pickQuiet({ quietInputs: inputs, money: MONEY_EMPTY, now: at(600, 1) }).key, pickQuiet({ quietInputs: inputs, money: MONEY_EMPTY, now: at(600, 23) }).key);
});

test('none true, or unknown (null) facts: no quiet line', () => {
  const now = at(700);
  assert.equal(pickQuiet({ quietInputs: { security: { started: true }, bridge: { paired: true }, moneyOpened: true, sources: [] }, money: MONEY_EMPTY, now }), null);
  assert.equal(pickQuiet({ quietInputs: { security: { started: null }, bridge: { paired: null }, moneyOpened: null, sources: [] }, money: MONEY_EMPTY, now }), null);
  for (const bad of [undefined, null, {}, { quietInputs: 4 }, { quietInputs: ALL_TRUE(now), now: NaN }]) assert.equal(pickQuiet(bad), null);
});

test('quiet is never in items, overflow, standing or aged, never in the counts (shape returns it apart)', () => {
  const now = at(701);
  const fresh = [row('scan-failed', 'high')];
  const standing = [];
  const r = shape({ fresh, standing, now, firstSeen: {}, quietInputs: ALL_TRUE(now), money: MONEY_EMPTY, cap: 3 });
  assert.ok(r.quiet);
  assert.equal(r.quiet.key.startsWith('quiet:'), true);
  assert.deepEqual(r.fresh, fresh);
  assert.deepEqual(r.standing, []);
  assert.equal(r.aged, null);
  assert.ok(![...r.fresh, ...r.standing].some((x) => x.key === r.quiet.key));
  // the item is quiet-shaped: no severity, no count, nothing a slot or the 'more' number could use
  assert.equal('severity' in r.quiet, false);
  assert.equal('count' in r.quiet, false);
});

test('money-unopened is suppressed while money-empty is on the brief (fresh or standing): one voice', () => {
  const now = at(702);
  const inputs = { security: { started: true }, bridge: { paired: true }, moneyOpened: false, sources: [] };
  assert.equal(pickQuiet({ quietInputs: inputs, money: MONEY_EMPTY, now }).rule, 'quiet-money-unopened');
  assert.equal(shape({ fresh: [row('money-empty', 'low')], standing: [], now, firstSeen: {}, quietInputs: inputs, money: MONEY_EMPTY }).quiet, null);
  assert.equal(shape({ fresh: [], standing: [standingRow('money-empty', 'low', at(0))], now, firstSeen: {}, quietInputs: inputs, money: MONEY_EMPTY }).quiet, null);
  // not on the brief (dismissed): the quiet line may speak
  assert.equal(shape({ fresh: [], standing: [], now, firstSeen: {}, quietInputs: inputs, money: MONEY_EMPTY }).quiet.rule, 'quiet-money-unopened');
});

test('money-unopened needs a Money view that says no accounts, and a log that says never opened', () => {
  const now = at(703);
  const base = { security: { started: true }, bridge: { paired: true }, sources: [] };
  assert.equal(pickQuiet({ quietInputs: { ...base, moneyOpened: false }, money: { hasAccounts: true, accounts: [{}] }, now }), null);
  assert.equal(pickQuiet({ quietInputs: { ...base, moneyOpened: false }, money: null, now }), null);
  assert.equal(pickQuiet({ quietInputs: { ...base, moneyOpened: false }, money: {}, now }), null);
  assert.equal(pickQuiet({ quietInputs: { ...base, moneyOpened: true }, money: MONEY_EMPTY, now }), null);
  assert.equal(pickQuiet({ quietInputs: { ...base, moneyOpened: null }, money: MONEY_EMPTY, now }), null);
});

test('a dark source: only after 3 days, only a file that existed, the kind named and no path', () => {
  const now = at(704);
  const one = (kind, ageMs) => ({ security: { started: true }, bridge: { paired: true }, moneyOpened: true, sources: [{ kind, mtimeMs: now - ageMs }] });
  assert.equal(pickQuiet({ quietInputs: one('pc-health', DARK_MS - 1), now }), null);
  const q = pickQuiet({ quietInputs: one('pc-health', DARK_MS), now });
  assert.equal(q.rule, 'quiet-source-dark');
  assert.equal(q.kind, 'pc-health');
  assert.equal(q.key, 'quiet:quiet-source-dark:pc-health');
  assert.equal(q.text, DARK_LABEL['pc-health'].text);
  assert.equal(q.source, 'pc-health');
  assert.match(q.age, /^last written 3 d ago$/);
  // an absent file is not in sources at all: nothing to say
  assert.equal(pickQuiet({ quietInputs: { security: { started: true }, bridge: { paired: true }, moneyOpened: true, sources: [] }, now }), null);
  // every kind has its own words and a go action; an unknown kind, a duplicate and a junk row are ignored
  for (const kind of DARK_KINDS) {
    const k = pickQuiet({ quietInputs: one(kind, 10 * D), now });
    assert.equal(k.kind, kind);
    assert.equal(k.action.kind, 'go');
    const blob = JSON.stringify(k);
    assert.doesNotMatch(blob, /[\\/]|\.json|\.log|C:/, kind + ' leaks a path-like string');
  }
  assert.equal(pickQuiet({ quietInputs: { sources: [{ kind: 'secrets-file', mtimeMs: 0 }, { kind: 'github' }, null, { kind: 'github', mtimeMs: 'x' }] }, now }), null);
  const dup = quietCandidates({ quietInputs: { sources: [{ kind: 'github', mtimeMs: now - 9 * D }, { kind: 'github', mtimeMs: now - 8 * D }] }, now });
  assert.equal(dup.length, 1);
});

test('quiet text uses the fixed wording only', () => {
  const now = at(705);
  const c = quietCandidates({ quietInputs: ALL_TRUE(now), money: MONEY_EMPTY, now });
  assert.equal(c[0].text, 'The Security walkthrough has not been started');
  assert.equal(c[1].text, 'The browser extension is not paired');
  assert.equal(c[2].text, 'Money has never been opened');
  assert.equal(c[3].text, 'The PC health readings have stopped updating');
  assert.equal(c[2].source, 'money');
});

// ---------------------------------------------------------------------------------------------------------------------------------- toasts and time

test('isToastable is false for an aged row, true for a plain item, false for junk', () => {
  assert.equal(isToastable(row('scan-failed', 'high')), true);
  assert.equal(isToastable({ ...row('quest-red', 'high'), aged: { since: iso(at(0)) } }), false);
  assert.equal(isToastable(null), false);
  assert.equal(isToastable('x'), false);
});

test('dayIndex is the UTC day and the slot rule is stable across the day', () => {
  assert.equal(dayIndex(at(123, 0)), 123);
  assert.equal(dayIndex(at(123, 23)), 123);
  assert.equal(dayIndex(at(124, 0)), 124);
  const one = standingRow('quest-red', 'high', at(0));
  assert.equal(!!agedSlot({ fresh: [], standing: [one], now: at(500, 0), cap: 3 }).aged, !!agedSlot({ fresh: [], standing: [one], now: at(500, 23), cap: 3 }).aged);
  assert.equal(agedSlot({ fresh: [], standing: [one], now: NaN, cap: 3 }).aged, null);
});
