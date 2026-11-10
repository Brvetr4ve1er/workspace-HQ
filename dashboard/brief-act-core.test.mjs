// Brief act-in-place — the pure core. Placeholder data only (public repo).
//   node --test dashboard/brief-act-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, VERBS, RULE_VERBS, ACTED_TTL_MS, planAct, decorate, prune, markActed, checkBalance, findItem, briefKeys } from './brief-act-core.mjs';
import { computeBrief } from './brief-core.mjs';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const ANCHOR = '2026-10-01T08:30:00.000Z';   // an ISO timestamp: full of colons, which is why keys are never parsed
const LAST = '2026-11-10T11:10:00.000Z';

const item = (key, rule, extra = {}) => ({ key, rule, severity: 'med', text: 'Placeholder ' + rule, why: 'why', source: 'scan', age: 'now', action: { kind: 'go', tab: 'tasks' }, count: 0, ...extra });
const questItem = (id) => item(KEYS.questRed(id), 'quest-red');
const moneyItem = (id, anchorAt) => item(KEYS.moneyStale(id, anchorAt), 'money-stale', { action: { kind: 'go', tab: 'money', sub: 'today' } });
const waitItem = (id, lastAt) => item(KEYS.sessionWaiting(id, lastAt), 'session-waiting', { action: { kind: 'go', tab: 'claude', sub: 'sessions' } });
const dirtyItem = (pid) => item('dirty:' + pid + ':12', 'dirty', { action: { kind: 'go', tab: 'projects', projectId: pid } });
const leftItem = (pid) => item('session-left-dirty:' + pid + ':' + LAST, 'session-left-dirty', { action: { kind: 'go', tab: 'projects', projectId: pid } });

const brief = (items, o = {}) => ({ v: 1, generatedAt: iso(NOW), items, more: 0, overflow: [], standing: [], errors: [], ...o });
const SRC = {
  redQuests: [{ id: 'wq:abc' }, { id: 'q-2' }],
  staleAccounts: [{ id: 'acc-1', anchorAt: ANCHOR }],
  waitingSessions: [{ id: 'sess-1', lastAt: LAST }],
};
const plan = (req, over = {}) => planAct(req, { brief: brief([questItem('wq:abc'), moneyItem('acc-1', ANCHOR), waitItem('sess-1', LAST), dirtyItem('proj-a'), leftItem('proj-b')]), sources: SRC, acted: {}, now: NOW, ...over });

test('the VERBS table: four verbs, each belongs to exactly its rule(s), and none is an outbound verb', () => {
  assert.deepEqual(Object.keys(VERBS).sort(), ['commit', 'confirm-balance', 'open-folder', 'quest-done']);
  assert.deepEqual(RULE_VERBS, { 'quest-red': ['quest-done'], 'money-stale': ['confirm-balance'], dirty: ['commit'], 'session-left-dirty': ['commit'], 'session-waiting': ['open-folder'] });
  for (const rule of Object.keys(RULE_VERBS)) assert.equal(RULE_VERBS[rule].length, 1, rule + ' offers one verb');
  for (const [name, v] of Object.entries(VERBS)) assert.doesNotMatch(name + ' ' + v.label, /push|publish|send|post|upload|deploy|delete|remove/i, name);
  assert.ok(Object.isFrozen(VERBS) && Object.isFrozen(VERBS.commit) && Object.isFrozen(RULE_VERBS));
});

test('KEYS builds the strings the rules emit (golden: nothing moves when brief-core calls it)', () => {
  const scan = { scan: { date: iso(NOW - H) }, projects: [], quests: [{ id: 'wq:abc', tier: 'red', title: 'Placeholder quest', status: 'open' }] };
  const money = { accounts: [{ id: 'acc-1', name: 'Placeholder account', stale: true, anchorAt: ANCHOR, confirmed: 'a while ago' }], obligations: [], hasAccounts: true };
  const b = computeBrief({ scan, money }, { now: new Date(NOW) });
  const keys = b.items.map((i) => i.key);
  assert.ok(keys.includes(KEYS.questRed('wq:abc')), keys.join('|'));
  assert.ok(keys.includes(KEYS.moneyStale('acc-1', ANCHOR)), keys.join('|'));
  assert.equal(KEYS.questRed('wq:abc'), 'quest-red:wq:abc');
  assert.equal(KEYS.moneyStale('acc-1', ANCHOR), 'money-stale:acc-1:' + ANCHOR);
  assert.equal(KEYS.moneyStale('acc-1', ''), 'money-stale:acc-1:');
  assert.equal(KEYS.moneyStale('acc-1', undefined), 'money-stale:acc-1:');
  assert.equal(KEYS.sessionWaiting('sess-1', LAST), 'session-waiting:sess-1:' + LAST);
});

test('quest-done: the id comes from the rebuilt record, including a daily-note id with a colon', () => {
  const r = plan({ key: 'quest-red:wq:abc', verb: 'quest-done' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, { kind: 'quest-done', id: 'wq:abc' });
  assert.equal(r.rule, 'quest-red');
});

test('confirm-balance: an ISO anchorAt in the key is matched, not parsed; the typed value rides along', () => {
  const r = plan({ key: 'money-stale:acc-1:' + ANCHOR, verb: 'confirm-balance', value: '2 500,50' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, { kind: 'confirm-balance', id: 'acc-1', balance: '2 500,50' });
  const num = plan({ key: 'money-stale:acc-1:' + ANCHOR, verb: 'confirm-balance', value: 0 });
  assert.equal(num.plan.balance, 0, 'zero is a real balance');
});

test('open-folder: the session id comes from the waiting record whose rebuilt key matches', () => {
  const r = plan({ key: 'session-waiting:sess-1:' + LAST, verb: 'open-folder' });
  assert.deepEqual(r.plan, { kind: 'open-folder', sessionId: 'sess-1' });
});

test('commit: the project id comes from the item action, never from the key; both git rules offer it', () => {
  assert.deepEqual(plan({ key: 'dirty:proj-a:12', verb: 'commit' }).plan, { kind: 'commit', projectId: 'proj-a' });
  assert.deepEqual(plan({ key: 'session-left-dirty:proj-b:' + LAST, verb: 'commit' }).plan, { kind: 'commit', projectId: 'proj-b' });
  // a key that LOOKS like it names project X while the item's own action names Y: Y wins
  const odd = item('dirty:proj-x:12', 'dirty', { action: { kind: 'go', tab: 'projects', projectId: 'proj-y' } });
  assert.equal(plan({ key: 'dirty:proj-x:12', verb: 'commit' }, { brief: brief([odd]) }).plan.projectId, 'proj-y');
  // no project on the item: refused (a scan or tab action never becomes a commit)
  const none = item('dirty:z:12', 'dirty', { action: { kind: 'go', tab: 'tasks' } });
  assert.match(plan({ key: 'dirty:z:12', verb: 'commit' }, { brief: brief([none]) }).error, /project/);
});

test('a forged key is refused: not on the brief, or on the brief but not rebuilt by any live record', () => {
  assert.match(plan({ key: 'quest-red:wq:nope', verb: 'quest-done' }).error, /not on the brief/);
  assert.match(plan({ key: '', verb: 'quest-done' }).error, /unknown item/);
  assert.match(plan({ key: 'x'.repeat(201), verb: 'quest-done' }).error, /unknown item/);
  assert.match(plan({ key: 7, verb: 'quest-done' }).error, /unknown item/);
  // the brief says it, the live source no longer does (the quest left the red list): nothing to act on
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { sources: { ...SRC, redQuests: [{ id: 'q-2' }] } }).error, /no longer matches/);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { sources: null }).error, /live records/);
  assert.match(plan(null).error, /unknown action/);
});

test('a verb of another rule, and an unknown verb, are refused', () => {
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'confirm-balance', value: '10' }).error, /not offered/);
  assert.match(plan({ key: 'dirty:proj-a:12', verb: 'quest-done' }).error, /not offered/);
  assert.match(plan({ key: 'session-waiting:sess-1:' + LAST, verb: 'commit' }).error, /not offered/);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'push' }).error, /unknown action/);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'constructor' }).error, /unknown action/);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: '__proto__' }).error, /unknown action/);
});

test('an expired key is refused: it left the brief, or the item is only in standing', () => {
  const gone = brief([moneyItem('acc-1', ANCHOR)]);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { brief: gone }).error, /not on the brief/);
  const standing = brief([], { standing: [{ ...questItem('wq:abc'), since: iso(NOW - 80 * H) }] });
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { brief: standing }).error, /not on the brief/);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { brief: null }).error, /not on the brief/);
  // overflow items are visible rows and may be acted on
  const over = brief([moneyItem('acc-1', ANCHOR)], { overflow: [questItem('wq:abc')] });
  assert.equal(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { brief: over }).ok, true);
});

test('a value on a verb that takes none is refused; a balance needs a real, non-negative number', () => {
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done', value: '5' }).error, /takes no value/);
  assert.match(plan({ key: 'dirty:proj-a:12', verb: 'commit', value: 1 }).error, /takes no value/);
  assert.match(plan({ key: 'session-waiting:sess-1:' + LAST, verb: 'open-folder', value: {} }).error, /takes no value/);
  const bal = (value) => plan({ key: 'money-stale:acc-1:' + ANCHOR, verb: 'confirm-balance', value });
  for (const bad of [undefined, null, '', '   ', -5, '-5', NaN, Infinity, 'NaN', 'abc', '12e3', '1e9', 1e9, {}, [5], true, '9'.repeat(13), '--', '.,'])
    assert.ok(bal(bad).error, 'refused: ' + String(bad));
  for (const good of [0, 12.5, '0', '0,00', '2 500', '1.200,00', ' 42 ']) assert.equal(bal(good).ok, true, 'accepted: ' + good);
  assert.deepEqual(checkBalance(' 42 '), { ok: true, value: '42' });
});

test('two live records that rebuild to the same key are never guessed between', () => {
  // ids 'a' + anchor 'b:2026' versus id 'a:b' + anchor '2026' rebuild to one string
  const key = KEYS.moneyStale('a', 'b:2026');
  assert.equal(key, KEYS.moneyStale('a:b', '2026'));
  const b = brief([item(key, 'money-stale')]);
  const r = planAct({ key, verb: 'confirm-balance', value: '10' }, { brief: b, sources: { staleAccounts: [{ id: 'a', anchorAt: 'b:2026' }, { id: 'a:b', anchorAt: '2026' }] }, now: NOW });
  assert.match(r.error, /share/);
  // with only one of them live, that one is the match
  const one = planAct({ key, verb: 'confirm-balance', value: '10' }, { brief: b, sources: { staleAccounts: [{ id: 'a:b', anchorAt: '2026' }] }, now: NOW });
  assert.equal(one.plan.id, 'a:b');
});

test('a malformed source record is skipped, never thrown on', () => {
  const r = plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { sources: { redQuests: [null, 7, 'x', { id: null }, { id: 'wq:abc' }] } });
  assert.equal(r.plan.id, 'wq:abc');
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { sources: { redQuests: 'nope' } }).error, /no longer matches/);
});

test('a marked state-changing item refuses a repeat while the marker lives; commit and open-folder may repeat', () => {
  const acted = markActed({}, 'quest-red:wq:abc', 'quest-done', NOW - 60e3);
  assert.match(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { acted }).error, /already done/);
  // 24 h later the marker is dead and the verb is offered again
  assert.equal(plan({ key: 'quest-red:wq:abc', verb: 'quest-done' }, { acted, now: NOW + ACTED_TTL_MS }).ok, true);
  const folderMarked = { ['session-waiting:sess-1:' + LAST]: { verb: 'open-folder', at: iso(NOW - 1000) } };
  assert.equal(plan({ key: 'session-waiting:sess-1:' + LAST, verb: 'open-folder' }, { acted: folderMarked }).ok, true);
});

test('decorate adds acted to every list, and never mutates the input', () => {
  const b = brief([questItem('wq:abc'), moneyItem('acc-1', ANCHOR)], { overflow: [dirtyItem('proj-a')], standing: [{ ...waitItem('sess-1', LAST), since: iso(NOW - 80 * H) }] });
  const frozen = JSON.stringify(b);
  const acted = { 'quest-red:wq:abc': { verb: 'quest-done', at: iso(NOW - 2 * 60e3) }, 'dirty:proj-a:12': { verb: 'quest-done', at: iso(NOW - 1000) } };
  const d = decorate(b, acted, NOW);
  assert.equal(JSON.stringify(b), frozen, 'input untouched');
  assert.deepEqual(d.items[0].acted, { verb: 'quest-done', at: iso(NOW - 2 * 60e3) });
  assert.equal('acted' in d.items[1], false);
  assert.equal(d.overflow[0].acted.verb, 'quest-done');
  assert.equal('acted' in d.standing[0], false);
  assert.notEqual(d, b); assert.notEqual(d.items[0], b.items[0]);
  assert.equal(d.more, 0); assert.equal(d.generatedAt, b.generatedAt);
});

test('decorate drops an expired marker, a marker of an unknown verb, and an acted the map does not back', () => {
  const stale = { ...questItem('wq:abc'), acted: { verb: 'quest-done', at: iso(NOW) } };   // a forged field riding in on the input
  const b = brief([stale, moneyItem('acc-1', ANCHOR)]);
  const d = decorate(b, { [KEYS.moneyStale('acc-1', ANCHOR)]: { verb: 'quest-done', at: iso(NOW - ACTED_TTL_MS - 1) } }, NOW);
  assert.equal('acted' in d.items[0], false, 'unbacked acted is dropped');
  assert.equal('acted' in d.items[1], false, 'expired marker is dropped');
  const d2 = decorate(b, { [KEYS.questRed('wq:abc')]: { verb: 'launch-missiles', at: iso(NOW) }, '__proto__': { verb: 'quest-done', at: iso(NOW) } }, NOW);
  assert.equal('acted' in d2.items[0], false);
  assert.equal(decorate(null, {}, NOW), null);
  assert.deepEqual(decorate({ v: 1 }, null, NOW), { v: 1 });
});

test('prune drops acted for keys no longer on the brief, and after 24 h', () => {
  const b = brief([questItem('wq:abc')], { standing: [{ ...moneyItem('acc-1', ANCHOR), since: iso(NOW - 80 * H) }] });
  const acted = {
    'quest-red:wq:abc': { verb: 'quest-done', at: iso(NOW - H) },
    ['money-stale:acc-1:' + ANCHOR]: { verb: 'confirm-balance', at: iso(NOW - 2 * H) },   // standing keeps its marker
    'quest-red:gone': { verb: 'quest-done', at: iso(NOW - 1000) },                          // key left the brief
  };
  assert.deepEqual(Object.keys(prune(acted, b, NOW)).sort(), ['money-stale:acc-1:' + ANCHOR, 'quest-red:wq:abc']);
  assert.deepEqual(prune(acted, b, NOW + 23 * H + 30 * 60e3 + 60e3).hasOwnProperty('quest-red:wq:abc'), false, 'the 24 h cap');
  assert.deepEqual(prune(acted, b, NOW + 22 * H)['quest-red:wq:abc'].verb, 'quest-done');
  assert.deepEqual(prune({ k: 'junk', 'quest-red:wq:abc': { verb: 'nope', at: iso(NOW) } }, b, NOW), {});
  assert.deepEqual(prune(null, b, NOW), {});
  assert.deepEqual(prune(acted, null, NOW), {});
});

test('markActed returns a new map and forgets dead entries', () => {
  const old = { a: { verb: 'quest-done', at: iso(NOW - ACTED_TTL_MS - 5) }, b: { verb: 'quest-done', at: iso(NOW - 5) } };
  const m = markActed(old, 'c', 'confirm-balance', NOW);
  assert.deepEqual(Object.keys(m).sort(), ['b', 'c']);
  assert.deepEqual(m.c, { verb: 'confirm-balance', at: iso(NOW) });
  assert.equal(Object.keys(old).length, 2);
});

test('findItem and briefKeys read items and overflow (keys also standing)', () => {
  const b = brief([questItem('q1')], { overflow: [questItem('q2')], standing: [{ ...questItem('q3'), since: iso(NOW) }] });
  assert.equal(findItem(b, 'quest-red:q2').rule, 'quest-red');
  assert.equal(findItem(b, 'quest-red:q3'), null);
  assert.deepEqual([...briefKeys(b)].sort(), ['quest-red:q1', 'quest-red:q2', 'quest-red:q3']);
});
