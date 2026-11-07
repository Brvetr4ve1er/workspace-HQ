// Operator Brief engine (spec docs/superpowers/specs/2026-11-05-operator-design.md). Pure: inputs in, brief out.
// Synthetic placeholder inputs only — the real scans are personal and the repo is public.
//   node --test dashboard/brief-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBrief, shouldToast, RULES, SEV_RANK } from './brief-core.mjs';

const NOW = new Date('2026-11-05T10:00:00Z');
const H = 3600e3, D = 24 * H;
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();

// a project with clean git unless overridden
const proj = (id, git = {}, risk = {}) => ({ id, name: 'Project ' + id.toUpperCase(), metrics: { git_safety: { dirty: 0, ahead: 0, unpushed: false, ...git }, risk_security: { secrets_found: 0, ...risk } } });
const scan = (o = {}) => ({ scan: { date: o.date || iso(2 * H) }, projects: o.projects || [proj('a')], quests: o.quests || [] });
const base = (o = {}) => ({ scan: scan(o.scan), liveScan: o.liveScan ?? { state: 'done', endedAt: iso(2 * H), code: 0 }, pc: o.pc ?? { scanned_at: iso(H), organs: [] },
  money: o.money ?? null, moneyMeta: o.moneyMeta ?? null, hub: o.hub ?? { webCount: 5, lastSyncAt: iso(H) }, errors: o.errors || [] });
const run = (inputs, dismissed = []) => computeBrief(inputs, { now: NOW, dismissed });
// the senses' sources (brief-sources.js shapes), all fresh unless overridden
const fresh = () => iso(3 * H);
const vercelWith = (state) => ({ state: 'ok', at: fresh(), partial: false, projects: [{ name: 'alpha-site', prod: { state, at: iso(H) }, deploys: [] }] });
const repoOf = (o = {}) => ({ full: 'owner/alpha-site', name: 'alpha-site', ci: 'failure', archived: false, fork: false, pushedAt: iso(2 * D), ...o });
const githubWith = (o = {}) => ({ state: 'ok', at: fresh(), partial: false, repos: [], waiting: [], ...o });
const withSenses = (o, extra) => ({ ...base(o), ...extra });
const rules = (b) => b.items.map((i) => i.rule);

test('a healthy, fresh workspace has nothing to say', () => {
  const b = run(base());
  assert.deepEqual(b.items, []);
  assert.equal(b.more, 0);
  assert.equal(b.v, 1);
  assert.equal(b.generatedAt, NOW.toISOString());
});

test('each rule fires on its condition, with its severity and action', () => {
  const cases = [
    ['scan-failed', 'high', { kind: 'scan' }, base({ liveScan: { state: 'failed', endedAt: iso(5 * 60e3), code: 1 } })],
    ['secrets', 'high', { kind: 'go', tab: 'projects', projectId: 'a' }, base({ scan: { projects: [proj('a', {}, { secrets_found: 2 })] } })],
    ['money-late', 'high', { kind: 'go', tab: 'money', sub: 'runway' }, base({ money: { hasAccounts: true, accounts: [], obligations: [{ id: 'o1', name: 'Rent', status: 'late', due: '1 Nov', dueLabel: '4 days late' }] } })],
    ['pc-blood', 'high', { kind: 'go', tab: 'system', sub: 'machine' }, base({ pc: { scanned_at: iso(H), organs: [{ id: 'disk', label: 'Disk', status: 'blood', diagnosis: 'C: is 98% full' }] } })],
    ['quest-red', 'high', { kind: 'go', tab: 'tasks' }, base({ scan: { quests: [{ id: 'q1', title: 'Rotate the leaked key', tier: 'red', status: 'open', project_id: 'a' }] } })],
    ['scan-stale', 'med', { kind: 'scan' }, base({ scan: { date: iso(2 * D) } })],
    ['unpushed', 'med', { kind: 'go', tab: 'projects', projectId: 'a' }, base({ scan: { projects: [proj('a', { ahead: 3 })] } })],
    ['money-stale', 'med', { kind: 'go', tab: 'money', sub: 'today' }, base({ money: { hasAccounts: true, accounts: [{ id: 'c1', name: 'Cash', stale: true, confirmed: '9 days ago', anchorAt: iso(9 * D) }], obligations: [] }, moneyMeta: { lastExportAt: iso(D) } })],
    ['pc-ember', 'med', { kind: 'go', tab: 'system', sub: 'machine' }, base({ pc: { scanned_at: iso(H), organs: [{ id: 'startup', label: 'Startup', status: 'ember', diagnosis: '14 startup apps' }] } })],
    ['dirty', 'low', { kind: 'go', tab: 'projects', projectId: 'a' }, base({ scan: { projects: [proj('a', { dirty: 12 })] } })],
    ['money-backup', 'low', { kind: 'go', tab: 'money', sub: 'today' }, base({ money: { hasAccounts: true, accounts: [], obligations: [] }, moneyMeta: null })],
    ['claude-sync', 'low', { kind: 'go', tab: 'claude', sub: 'chats' }, base({ hub: { webCount: 0, lastSyncAt: null } })],
  ];
  // the six senses (brief-senses.mjs) slot into RULES by position; the table below is in RULES order
  cases.splice(2, 0, ['prod-deploy-error', 'high', { kind: 'go', tab: 'projects', sub: 'accounts' }, withSenses({}, { vercel: vercelWith('error') })]);
  cases.splice(8, 0, ['ci-red', 'med', { kind: 'go', tab: 'projects', sub: 'github' }, withSenses({}, { github: githubWith({ repos: [repoOf()] }) })]);
  cases.splice(9, 0, ['session-left-dirty', 'med', { kind: 'go', tab: 'projects', projectId: 'a' }, withSenses({ scan: { projects: [proj('a', { dirty: 12 })] } }, {
    sessions: [{ id: 's1', projectId: 'hp1', hqProjectId: 'a', cwd: 'C:/placeholder/a', lastAt: iso(5 * H) }], hubProjects: [{ id: 'hp1', hqProjectId: 'a', linkState: 'confirmed' }], docsRoot: 'C:/placeholder' })]);
  cases.splice(14, 0, ['review-waiting', 'low', { kind: 'go', tab: 'projects', sub: 'github' }, withSenses({}, { github: githubWith({ waiting: [{ repo: 'owner/alpha-site', number: 1, updatedAt: iso(D), draft: false }] }) })]);
  cases.splice(15, 0, ['reboot-pending', 'low', { kind: 'go', tab: 'system', sub: 'machine' }, withSenses({}, { pcDetail: { scannedAt: fresh(), rebootPending: true } })]);
  cases.splice(16, 0, ['money-empty', 'low', { kind: 'go', tab: 'money', sub: 'today' }, base({ money: { hasAccounts: false, accounts: [], obligations: [] } })]);
  assert.deepEqual(cases.map((c) => c[0]), RULES, 'one case per rule, in rule order');
  for (const [rule, severity, action, inputs] of cases) {
    const b = run(inputs);
    const it = b.items.find((i) => i.rule === rule);
    assert.ok(it, rule + ' fires: got ' + JSON.stringify(rules(b)));
    assert.equal(it.severity, severity, rule);
    assert.deepEqual(it.action, action, rule);
    for (const k of ['key', 'text', 'why', 'source', 'age']) assert.ok(typeof it[k] === 'string' && it[k].length > 0, rule + ' has ' + k);
    assert.ok(it.key.startsWith(rule + ':'), rule + ' key is rule-prefixed: ' + it.key);
    assert.ok(Number.isInteger(it.count) && it.count >= 0, rule + ' carries the additive count field');
  }
});

test('below the thresholds nothing fires (no false alarms)', () => {
  const b = run(base({ scan: { date: iso(30 * H), projects: [proj('a', { dirty: 9 })] }, money: { hasAccounts: false, accounts: [], obligations: [] }, hub: { webCount: 3, lastSyncAt: iso(2 * D) } }));
  assert.deepEqual(rules(b), ['money-empty'], 'scan 30 h old, 9 dirty files, sync 2 d ago: all quiet — only the money sense says Money is not set up');
  const set = run(base({ scan: { date: iso(30 * H), projects: [proj('a', { dirty: 9 })] }, money: { hasAccounts: true, accounts: [], obligations: [] }, moneyMeta: { lastExportAt: iso(D) }, hub: { webCount: 3, lastSyncAt: iso(2 * D) } }));
  assert.deepEqual(rules(set), [], 'with Money set up and exported, nothing fires');
});

test('ranking: severity first, then rule order; cap 3, the rest counted in more', () => {
  const b = run(base({
    scan: { date: iso(3 * D), projects: [proj('a', { dirty: 20, ahead: 2 }, { secrets_found: 1 })], quests: [{ id: 'q1', title: 'Fix the build', tier: 'red', status: 'open', project_id: 'a' }] },
    liveScan: { state: 'failed', endedAt: iso(60e3), code: 2 },
  }));
  assert.deepEqual(rules(b), ['scan-failed', 'secrets', 'quest-red']);
  assert.equal(b.more, 3, 'scan-stale, unpushed and dirty matched but did not fit');
  assert.deepEqual(b.items.map((i) => i.severity), ['high', 'high', 'high']);
  assert.deepEqual(Object.keys(SEV_RANK), ['high', 'med', 'low']);
});

test('a dismissed key stays hidden; a worse value is a new key and shows again', () => {
  const at8 = base({ scan: { projects: [proj('a', { dirty: 12 })] } });
  const key = run(at8).items[0].key;
  assert.equal(key, 'dirty:a:12');
  assert.deepEqual(run(at8, [key]).items, [], 'dismissed');
  assert.equal(run(at8, [key]).more, 0, 'a dismissed item is not counted in more');
  const at20 = base({ scan: { projects: [proj('a', { dirty: 20 })] } });
  assert.equal(run(at20, [key]).items[0].key, 'dirty:a:20', 'grew, so it is back');
});

test('a stale balance keys on its anchor: dismissal holds day after day, a re-confirm resets it', () => {
  const acct = (anchorAt, confirmed, stale = true) => base({ money: { hasAccounts: true, accounts: [{ id: 'c1', name: 'Cash', stale, confirmed, anchorAt }], obligations: [] }, moneyMeta: { lastExportAt: iso(D) } });
  const k = run(acct(iso(9 * D), '9 days ago')).items[0].key;
  assert.deepEqual(run(acct(iso(9 * D), '10 days ago'), [k]).items, [], 'the label moved a day, the fact did not: still hidden');
  assert.deepEqual(run(acct(iso(8 * H), 'today', false), [k]).items, [], 're-confirmed: not stale, nothing to say');
  const later = run(acct(iso(20 * D), '20 days ago'), [k]).items;
  assert.equal(later.length, 1, 'stale again on a NEW anchor: back, despite the old dismissal');
  assert.notEqual(later[0].key, k);
});

test('several matches name the worst one and add "and N more"', () => {
  const b = run(base({ scan: { projects: [proj('a', { dirty: 11 }), proj('b', { dirty: 40 }), proj('c', { dirty: 15 })] } }));
  const it = b.items[0];
  assert.equal(it.rule, 'dirty');
  assert.deepEqual(it.action, { kind: 'go', tab: 'projects', projectId: 'b' }, 'the worst one');
  assert.match(it.text, /Project B has 40 uncommitted files and 2 more projects/);
});

test('ages are stated per source; a stale scan says how stale', () => {
  const b = run(base({ scan: { date: iso(2 * D), projects: [proj('a', { dirty: 12 })] } }));
  const stale = b.items.find((i) => i.rule === 'scan-stale'), dirty = b.items.find((i) => i.rule === 'dirty');
  assert.match(stale.text, /2 days old/);
  assert.equal(dirty.age, 'scan 2 d ago');
  assert.equal(dirty.source, 'scan');
});

test('computeBrief tolerates every missing input, and passes source errors through', () => {
  const nothing = computeBrief({ scan: null, liveScan: null, pc: null, money: null, moneyMeta: null, hub: null, errors: [] }, { now: NOW, dismissed: [] });
  assert.deepEqual(nothing.items, []);
  assert.deepEqual(nothing.errors, []);
  const garbage = computeBrief({ scan: { projects: 'nope', quests: 7 }, liveScan: 'x', pc: { organs: null }, money: { accounts: null }, moneyMeta: 3, hub: [], errors: [{ source: 'pc-health', error: 'unreadable' }] }, { now: NOW, dismissed: [] });
  assert.deepEqual(garbage.items, [], 'wrong shapes are skipped, never thrown');
  assert.deepEqual(garbage.errors, [{ source: 'pc-health', error: 'unreadable' }]);
  assert.doesNotThrow(() => computeBrief(undefined, undefined));
});

test('names are one line, at most 60 chars', () => {
  const long = { ...proj('a', { dirty: 12 }), name: 'A <b>very</b>\nlong project name '.repeat(6) };
  const it = run(base({ scan: { projects: [long] } })).items[0];
  assert.ok(!/[\n\r]/.test(it.text), 'one line');
  const name = it.text.split(' has ')[0];
  assert.ok([...name].length <= 60, 'name cut to 60: ' + name.length);
});

test('deterministic: same inputs and now, deep-equal brief', () => {
  const i = base({ scan: { projects: [proj('a', { dirty: 12, ahead: 1 })] }, hub: { webCount: 0, lastSyncAt: null } });
  assert.deepEqual(run(i), run(i));
});

// ---- P2: change-only toast ----
const hi = (key) => ({ key, rule: 'secrets', severity: 'high', text: 't ' + key, why: '', source: 'scan', age: '', action: { kind: 'scan' } });
const at = (localHour, dayOffset = 0) => { const d = new Date(2026, 10, 5 + dayOffset, localHour, 30); return d; };

test('shouldToast table: new high toasts once per key per 24 h, never in quiet hours, med never', () => {
  let st = { dismissed: [], toasted: {} };
  let r = shouldToast({ items: [hi('k1')] }, st, at(10)); assert.equal(r.toast && r.toast.key, 'k1', 'new high item toasts'); st = r.state;
  r = shouldToast({ items: [hi('k1')] }, st, at(12)); assert.equal(r.toast, null, 'same key within 24 h: silent'); st = r.state;
  r = shouldToast({ items: [hi('k1')] }, st, at(11, 1)); assert.equal(r.toast, null, 'still the same top a day later: change-only, no daily nag'); st = r.state;
  r = shouldToast({ items: [hi('k9')] }, st, at(12, 1)); assert.equal(r.toast && r.toast.key, 'k9', 'a NEW high item takes the top: toast'); st = r.state;
  r = shouldToast({ items: [hi('k1')] }, st, at(13, 2)); assert.equal(r.toast && r.toast.key, 'k1', 'k1 back on top after another item, 24 h after its toast: toast again'); st = r.state;
  r = shouldToast({ items: [{ ...hi('k2'), severity: 'med' }] }, st, at(14)); assert.equal(r.toast, null, 'med never toasts');
  r = shouldToast({ items: [] }, st, at(14)); assert.equal(r.toast, null, 'nothing to say');
  assert.equal(shouldToast({ items: [hi('k3')] }, st, at(23)).toast, null, '23:30 is quiet');
  assert.equal(shouldToast({ items: [hi('k3')] }, st, new Date(2026, 10, 6, 7, 59)).toast, null, '07:59 is quiet');
  assert.equal(shouldToast({ items: [hi('k3')] }, st, new Date(2026, 10, 6, 8, 0)).toast.key, 'k3', '08:00 is not');
});

test('shouldToast: two items flapping at the top toast once each, and old history is pruned', () => {
  let st = { dismissed: [], toasted: {} }, n = 0;
  for (let h = 9; h < 21; h++) {
    const r = shouldToast({ items: [hi(h % 2 ? 'a' : 'b')] }, st, at(h)); if (r.toast) n++; st = r.state;
  }
  assert.equal(n, 2, 'a and b once each, not 12 toasts');
  const r = shouldToast({ items: [] }, st, at(12, 3));
  assert.deepEqual(r.state.toasted, {}, 'entries older than 24 h are pruned');
});

// ---- the senses: count, overflow, the day-one case, the dirty rule stepping aside ----------------------------------------
test('every item carries count (the rule\'s "and N more" number, 0 when none)', () => {
  const b = run(base({ scan: { projects: [proj('a', {}, { secrets_found: 3 }), proj('b', {}, { secrets_found: 1 }), proj('c', {}, { secrets_found: 2 })] } }));
  assert.equal(b.items[0].rule, 'secrets');
  assert.equal(b.items[0].count, 2, 'two other projects have secrets');
  assert.match(b.items[0].text, /and 2 more projects$/);
  assert.equal(run(base({ scan: { projects: [proj('a', { dirty: 12 })] } })).items[0].count, 0);
});

test('overflow holds the ranked items 4 to 12 (same shape), and the cap of 3 is unchanged', () => {
  const b = run(withSenses({
    scan: { date: iso(3 * D), projects: [proj('a', { dirty: 20, ahead: 2 }, { secrets_found: 1 })], quests: [{ id: 'q1', title: 'Fix the build', tier: 'red', status: 'open', project_id: 'a' }] },
    liveScan: { state: 'failed', endedAt: iso(60e3), code: 2 },
  }, { github: githubWith({ repos: [repoOf()], waiting: [{ repo: 'o/r', number: 1, updatedAt: iso(D), draft: false }] }) }));
  assert.deepEqual(rules(b), ['scan-failed', 'secrets', 'quest-red']);
  assert.deepEqual(b.overflow.map((i) => i.rule), ['scan-stale', 'unpushed', 'ci-red', 'dirty', 'review-waiting'], 'severity first, rule order within a severity');
  assert.equal(b.more, b.overflow.length, 'more counts everything past the top 3');
  assert.deepEqual(Object.keys(b.overflow[0]).sort(), Object.keys(b.items[0]).sort(), 'same shape as an item');
  assert.deepEqual(run(base()).overflow, [], 'a quiet brief has an empty overflow');
  // at most 9 ride along (items 4 to 12)
  const many = run(withSenses({ scan: { date: iso(3 * D), projects: [proj('a', { dirty: 20, ahead: 2 }, { secrets_found: 1 })] } }, { github: githubWith({ repos: [repoOf()] }), vercel: vercelWith('error'), pcDetail: { scannedAt: fresh(), rebootPending: true } }));
  assert.ok(many.overflow.length <= 9);
});

test('day one: three standing highs put a new ci-red item in overflow, not in the top 3', () => {
  const standing = {
    scan: { projects: [proj('a', {}, { secrets_found: 2 })], quests: [{ id: 'q1', title: 'Rotate the leaked key', tier: 'red', status: 'open', project_id: 'a' }] },
    pc: { scanned_at: iso(H), organs: [{ id: 'disk', label: 'Disk', status: 'blood', diagnosis: 'C: is 98% full' }] },
  };
  const b = run(withSenses(standing, { github: githubWith({ repos: [repoOf(), repoOf({ full: 'owner/beta-site', name: 'beta-site' })] }) }));
  assert.deepEqual(rules(b), ['secrets', 'pc-blood', 'quest-red']);
  assert.deepEqual(b.overflow.map((i) => i.rule), ['ci-red']);
  assert.equal(b.overflow[0].count, 1, 'CI is failing on a repo and 1 more');
  assert.equal(b.more, 1);
});

test('the dirty rule does not repeat a project session-left-dirty already names', () => {
  const sess = { sessions: [{ id: 's1', projectId: 'hp1', hqProjectId: 'a', cwd: 'C:/placeholder/a', lastAt: iso(5 * H) }], hubProjects: [{ id: 'hp1', hqProjectId: 'a', linkState: 'confirmed' }], docsRoot: 'C:/placeholder' };
  const both = run(withSenses({ scan: { projects: [proj('a', { dirty: 14 })] } }, sess));
  assert.deepEqual(rules(both), ['session-left-dirty'], 'the project is named once, by the med rule');
  const noSession = run(base({ scan: { projects: [proj('a', { dirty: 14 })] } }));
  assert.deepEqual(rules(noSession), ['dirty']);
  const other = run(withSenses({ scan: { projects: [proj('a', { dirty: 14 }), proj('b', { dirty: 11 })] } }, sess));
  assert.deepEqual(rules(other), ['session-left-dirty', 'dirty'], 'another dirty project still gets the low line');
  assert.match(other.items[1].text, /Project B/);
});

test('dismissing session-left-dirty hides only the project it named, not the ones folded into "and N more"', () => {
  const sess = { sessions: [
    { id: 's1', projectId: 'hp1', hqProjectId: 'a', cwd: 'C:/placeholder/a', lastAt: iso(5 * H) },
    { id: 's2', projectId: 'hp2', hqProjectId: 'b', cwd: 'C:/placeholder/b', lastAt: iso(6 * H) }],
    hubProjects: [{ id: 'hp1', hqProjectId: 'a', linkState: 'confirmed' }, { id: 'hp2', hqProjectId: 'b', linkState: 'confirmed' }], docsRoot: 'C:/placeholder' };
  const inputs = withSenses({ scan: { projects: [proj('a', { dirty: 14 }), proj('b', { dirty: 12 })] } }, sess);
  const before = run(inputs);
  assert.deepEqual(rules(before), ['session-left-dirty']);
  assert.equal(before.items[0].count, 1);
  const after = run(inputs, [before.items[0].key]);
  assert.deepEqual(rules(after), ['dirty'], 'b must not vanish with the dismissed item');
  assert.match(after.items[0].text, /Project B/);
});

test('a sense that throws or sees garbage skips only itself', () => {
  const b = run(withSenses({ scan: { projects: [proj('a', { dirty: 12 })] } }, { github: 'nope', vercel: 7, pcDetail: [], sessions: 'x', hubProjects: null, sessionTurns: 3 }));
  assert.deepEqual(rules(b), ['dirty']);
});
