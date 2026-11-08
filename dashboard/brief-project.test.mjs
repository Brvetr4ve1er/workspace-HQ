// The Brief's screen-safe projection (dashboard/brief-project.mjs). Placeholder names only (public repo).
//   node --test dashboard/brief-project.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectBrief, refOf, WORDING, STALE_MIN } from './brief-project.mjs';
import { RULES } from './brief-core.mjs';

const NOW = Date.parse('2026-11-07T14:05:00Z');
const MIN = 60e3, H = 3600e3;
const it = (rule, severity, key, o = {}) => ({ key, rule, severity, text: 'FULL TEXT NAMING ' + key, why: 'WHY NAMING ' + key, source: 'scan', age: 'scan 2 h ago', action: { kind: 'go', tab: 'projects' }, count: 0, ...o });
const SECRET = 'Zorblax Prime', BILL = 'Quux Rent', QUEST = 'Fix the Frobnicator', PID = 'proj-id-7731', QID = 'quest-id-4410', PATH = 'C:/work/zorblax-prime';
const BRIEF = {
  v: 1, generatedAt: new Date(NOW - 5 * MIN).toISOString(), more: 4, errors: [{ source: 'github', error: 'data/github.json is partial at C:/secret/path' }, { source: 'github', error: 'dup' }],
  items: [
    it('secrets', 'high', 'secrets:' + PID + ':2', { text: SECRET + ' has 2 secrets in plain sight', why: 'rotate ' + PATH, action: { kind: 'go', tab: 'projects', projectId: PID } }),
    it('money-late', 'high', 'money-late:bill-9:2026-11-01', { text: BILL + ' is 6 days late', count: 1, action: { kind: 'go', tab: 'money', sub: 'runway' } }),
    it('quest-red', 'high', 'quest-red:' + QID, { text: QUEST, action: { kind: 'go', tab: 'tasks' } }),
  ],
  overflow: [
    it('ci-red', 'med', 'ci-red:owner/alpha-site:2026-11-06T00:00:00Z', { count: 3, action: { kind: 'go', tab: 'projects', sub: 'github' }, age: 'github.json 3 h ago' }),
    it('review-waiting', 'low', 'review-waiting:2026-11-05T00:00:00Z', { count: 1, action: { kind: 'go', tab: 'projects', sub: 'github' } }),
    it('reboot-pending', 'low', 'reboot-pending:2026-11-07', { action: { kind: 'go', tab: 'system', sub: 'machine' } }),
    it('money-empty', 'low', 'money-empty:never', { action: { kind: 'go', tab: 'money', sub: 'today' } }),
  ],
};
const FIRST = { ['secrets:' + PID + ':2']: { first: new Date(NOW - 2 * H).toISOString(), last: new Date(NOW).toISOString() }, ['quest-red:' + QID]: { first: new Date(NOW - 3 * 24 * H).toISOString(), last: new Date(NOW).toISOString() } };
const P = () => projectBrief(BRIEF, { now: NOW, firstSeen: FIRST });

test('snapshot of the key set: top level, items and overflow rows', () => {
  const p = P();
  assert.deepEqual(Object.keys(p), ['v', 'generatedAt', 'ageMinutes', 'stale', 'counts', 'items', 'overflow', 'overflowLine', 'more', 'errorSources', 'standing']);
  assert.deepEqual(Object.keys(p.items[0]), ['ref', 'rule', 'severity', 'sevWord', 'text', 'count', 'isNew', 'age', 'nav']);
  assert.deepEqual(Object.keys(p.overflow[0]), ['ref', 'rule', 'severity', 'text', 'count', 'isNew']);
  assert.equal(p.v, 1);
});

test('the serialized projection contains no names, project ids, quest ids, bill names, paths or the why text', () => {
  const s = JSON.stringify(P());
  for (const secret of [SECRET, BILL, QUEST, PID, QID, PATH, 'bill-9', 'alpha-site', 'owner/', 'WHY', 'FULL TEXT', 'C:/secret', 'rotate']) assert.ok(!s.includes(secret), secret);
});

test('nav has only kind, tab and sub; a project id never rides along', () => {
  const p = P();
  for (const x of p.items) assert.deepEqual(Object.keys(x.nav), ['kind', 'tab', 'sub']);
  assert.deepEqual(p.items[0].nav, { kind: 'go', tab: 'projects', sub: null });
  assert.deepEqual(p.items[1].nav, { kind: 'go', tab: 'money', sub: 'runway' });
  const odd = projectBrief({ generatedAt: BRIEF.generatedAt, items: [it('x', 'low', 'k', { action: { kind: 'go', tab: '../../etc', sub: 'A B', projectId: PID } }), it('scan-failed', 'high', 'k2', { action: { kind: 'scan' } }), it('x', 'low', 'k3', { action: { kind: 'shell', cmd: 'rm' } }), it('x', 'low', 'k4', { action: null })] }, { now: NOW });
  assert.deepEqual(odd.items[0].nav, { kind: 'go', tab: null, sub: null });
  assert.deepEqual(odd.items[1].nav, { kind: 'scan', tab: null, sub: null });
  assert.deepEqual(odd.items[2].nav, { kind: null, tab: null, sub: null });
  assert.deepEqual(odd.items[3].nav, { kind: null, tab: null, sub: null });
});

test('ref is the first 12 hex of sha256(key), stable, and distinct per key', () => {
  const p = P();
  for (const x of p.items.concat(p.overflow)) assert.match(x.ref, /^[0-9a-f]{12}$/);
  assert.equal(p.items[0].ref, createHash('sha256').update('secrets:' + PID + ':2').digest('hex').slice(0, 12));
  assert.equal(refOf('a'), refOf('a'));
  assert.notEqual(refOf('a'), refOf('b'));
  assert.equal(new Set(p.items.concat(p.overflow).map((x) => x.ref)).size, 7);
});

test('isNew flips around 24 h of the first sighting, and is false with no first-seen entry', () => {
  const at = (hoursAgo) => projectBrief(BRIEF, { now: NOW, firstSeen: { ['secrets:' + PID + ':2']: { first: new Date(NOW - hoursAgo * H).toISOString() } } }).items[0].isNew;
  assert.equal(at(0), true);
  assert.equal(at(23.9), true);
  assert.equal(at(24), false);
  assert.equal(at(30), false);
  const p = P();
  assert.deepEqual(p.items.map((x) => x.isNew), [true, false, false]);
  assert.ok(p.overflow.every((x) => x.isNew === false));
  assert.equal(projectBrief(BRIEF, { now: NOW }).items[0].isNew, false);
  assert.equal(projectBrief(BRIEF, { now: NOW, firstSeen: 'junk' }).items[0].isNew, false);
  assert.equal(projectBrief(BRIEF, { now: NOW, firstSeen: { ['secrets:' + PID + ':2']: { first: new Date(NOW + 5 * H).toISOString() } } }).items[0].isNew, false);   // from the future: unknown
});

test('the overflow line is built from counts and projection wording, at most two rule phrases', () => {
  const p = P();
  assert.equal(p.more, 4);
  assert.equal(p.overflowLine, '+4 more · CI failing on 4 repos · 2 pull requests waiting');
  const one = projectBrief({ ...BRIEF, more: 1, overflow: [BRIEF.overflow[0]].map((x) => ({ ...x, count: 0 })) }, { now: NOW });
  assert.equal(one.overflowLine, '+1 more · CI failing on a repo');
  assert.equal(projectBrief({ ...BRIEF, more: 0, overflow: [] }, { now: NOW }).overflowLine, '');
  assert.equal(projectBrief({ ...BRIEF, overflow: undefined, more: 5 }, { now: NOW }).overflowLine, '+5 more');   // an older brief: a count, no phrases
});

test('wording: items read from the fixed table, using count + 1', () => {
  const p = P();
  assert.equal(p.items[0].text, 'A project has secrets in plain sight');
  assert.equal(p.items[1].text, '2 bills are late');
  assert.equal(p.items[2].text, 'A critical quest is open');
  assert.equal(p.overflow[0].text, 'CI is failing on 4 repos');
  assert.equal(p.overflow[1].text, '2 pull requests are waiting on you');
  assert.equal(p.items[0].sevWord, 'urgent');
  assert.equal(p.overflow[0].severity, 'med');
});

test('every brief-core rule id has a wording row; an unknown rule reads "Something needs you"', () => {
  for (const r of RULES) assert.ok(Object.hasOwn(WORDING, r), r);
  for (const r of ['prod-deploy-error', 'ci-red', 'session-left-dirty', 'review-waiting', 'reboot-pending', 'money-empty']) assert.ok(Object.hasOwn(WORDING, r), r);
  const p = projectBrief({ generatedAt: BRIEF.generatedAt, items: [it('brand-new-rule', 'med', 'k1'), it('__proto__', 'med', 'k2'), it('constructor', 'low', 'k3')] }, { now: NOW });
  assert.deepEqual(p.items.map((x) => x.text), ['Something needs you', 'Something needs you', 'Something needs you']);
  assert.deepEqual(p.items.map((x) => x.rule), ['unknown', 'unknown', 'unknown']);
});

test('errors reduce to source names, unique, well-formed only', () => {
  assert.deepEqual(P().errorSources, ['github']);
  const p = projectBrief({ generatedAt: BRIEF.generatedAt, items: [], errors: [{ source: 'claude-code', error: 'x' }, { source: 'Bad Source!', error: 'x' }, { source: 5 }, null, { source: 'pc-health' }] }, { now: NOW });
  assert.deepEqual(p.errorSources, ['claude-code', 'pc-health']);
});

test('age: counts, staleness at 30 min, and unknown generatedAt', () => {
  assert.equal(P().ageMinutes, 5);
  assert.equal(P().stale, false);
  assert.deepEqual(P().counts, { high: 3, med: 1, low: 3 });
  const old = projectBrief({ ...BRIEF, generatedAt: new Date(NOW - (STALE_MIN + 1) * MIN).toISOString() }, { now: NOW });
  assert.equal(old.stale, true);
  assert.equal(projectBrief({ ...BRIEF, generatedAt: new Date(NOW - STALE_MIN * MIN).toISOString() }, { now: NOW }).stale, false);
  const unk = projectBrief({ ...BRIEF, generatedAt: 'garbage' }, { now: NOW });
  assert.equal(unk.generatedAt, null); assert.equal(unk.ageMinutes, null); assert.equal(unk.stale, true);
});

test('age strings pass only when they look like an age; the item count is a small non-negative integer', () => {
  const p = projectBrief({ generatedAt: BRIEF.generatedAt, items: [it('ci-red', 'med', 'k', { age: 'Zorblax Prime says <b>hi</b>', count: -4 }), it('ci-red', 'med', 'k2', { age: 'github.json 3 h ago', count: 2.5 })] }, { now: NOW });
  assert.equal(p.items[0].age, ''); assert.equal(p.items[0].count, 0);
  assert.equal(p.items[1].age, 'github.json 3 h ago'); assert.equal(p.items[1].count, 0);
});

test('deterministic for a fixed now, accepts a Date or ms, and survives garbage', () => {
  assert.deepEqual(P(), P());
  assert.deepEqual(projectBrief(BRIEF, { now: new Date(NOW), firstSeen: FIRST }), P());
  assert.equal(projectBrief(null, { now: NOW }), null);
  assert.equal(projectBrief('x'), null);
  assert.equal(projectBrief([], {}), null);
  const g = projectBrief({ items: [null, 5, { key: 1 }, { key: 'a', rule: 'ci-red', severity: 'extreme' }], overflow: 'no', errors: 'no', more: 'lots' }, {});
  assert.deepEqual(g.items, []); assert.deepEqual(g.overflow, []); assert.equal(g.more, 0); assert.equal(g.overflowLine, '');
});

// ---- standing: a count and a date, never a ref or a name (2026-11-08) ---------------------------------------------------------
const STD = (key, since, rule = 'dirty') => it(rule, 'low', key, { text: 'STANDING NAME Zorblax', why: 'STANDING WHY', since, action: { kind: 'go', tab: 'projects', projectId: PID } });

test('standing: the projection carries only { count, since, line }, the oldest date, and holds no names', () => {
  const p = projectBrief({ ...BRIEF, standing: [STD('dirty:' + PID + ':12', '2026-11-06T12:00:00.000Z'), STD('unpushed:' + PID + ':3', '2026-11-05T12:00:00.000Z', 'unpushed')] }, { now: NOW, firstSeen: FIRST });
  assert.deepEqual(p.standing, { count: 2, since: '2026-11-05', line: '2 standing since 5 Nov' });
  const s = JSON.stringify(p);
  for (const bad of ['STANDING NAME', 'Zorblax', 'STANDING WHY', 'dirty:', refOf('dirty:' + PID + ':12')]) assert.ok(!s.includes(bad), bad);
  assert.deepEqual(p.items, P().items, 'the items do not move');
  assert.deepEqual(p.counts, P().counts, 'standing is not in counts');
  assert.equal(p.more, P().more);
});

test('standing: none, malformed or undated rows give null; a row that is not a live item is not counted', () => {
  assert.equal(P().standing, null);
  assert.equal(projectBrief({ ...BRIEF, standing: [] }, { now: NOW }).standing, null);
  assert.equal(projectBrief({ ...BRIEF, standing: 'no' }, { now: NOW }).standing, null);
  assert.equal(projectBrief({ ...BRIEF, standing: [STD('k', 'garbage'), null, 5, { key: 'x', rule: 'dirty', severity: 'extreme', since: '2026-11-05T12:00:00.000Z' }] }, { now: NOW }).standing, null);
  assert.equal(projectBrief({ ...BRIEF, standing: [STD('k', '2026-11-05T12:00:00.000Z'), STD('j', 'garbage')] }, { now: NOW }).standing.count, 1);
  assert.equal(projectBrief({ ...BRIEF, standing: [STD('k', '2026-11-05T12:00:00.000Z')] }, { now: NOW }).standing.line, '1 standing since 5 Nov');
});
