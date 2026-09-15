import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracle, triage, anomalies, momentum, spellFit, streakRisk, achievementNudges } from './derive.mjs';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/sample.json', import.meta.url)));

test('oracle: uncommitted files at risk outrank a calm quest', () => {
  const sel = { ...FIX, projects: [
    { id:'p1', name:'A', metrics:{ git_safety:{ dirty: 24 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 0 } },
    { id:'p2', name:'B', metrics:{ git_safety:{ dirty: 0 }, risk_security:{ secrets_found: 0 } }, activity:{ days_since_commit: 1 } },
  ], quests: [{ id:'q1', title:'tidy', tier:'yellow', status:'open' }] };
  const r = oracle(FIX, sel, '2026-07-26T14:00:00Z');
  assert.equal(r.action, 'commit');
  assert.equal(r.target.projectId, 'p1');
  assert.match(r.reason, /uncommitted/i);
});

test('oracle: never throws on an empty/old scan', () => {
  // Both calls assert the empty/no-candidates → null path (no projects/quests
  // to rank), not any time-of-day behavior — the two `now` values are
  // deliberately different only to show the result is independent of hour.
  assert.doesNotThrow(() => oracle({}, null, '2026-07-26T14:00:00Z'));
  assert.equal(oracle({}, null, '2026-07-26T03:00:00Z'), null);
});

test('triage: secrets outrank a dirty tree; rows sorted desc by blast radius', () => {
  const sel = { projects: [
    { id:'p1', name:'A', metrics:{ risk_security:{secrets_found:2}, git_safety:{dirty:0} }, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} },
    { id:'p2', name:'B', metrics:{ risk_security:{secrets_found:0}, git_safety:{dirty:12} }, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} },
    { id:'p3', name:'C', metrics:{ risk_security:{secrets_found:0}, git_safety:{dirty:0} }, signals:{has_tests:false,has_ci:false}, activity:{days_since_commit:40} },
  ] };
  const r = triage(sel);
  assert.equal(r[0].kind, 'security');
  assert.equal(r[0].projectId, 'p1');
  assert.ok(r.every((x,i,a) => i===0 || a[i-1].blastRadius >= x.blastRadius));
});

test('triage: blast radius is capped per kind — the per-kind ceilings hold', () => {
  // Historical context: the retired WARROOM realm's HP bar divided blastRadius
  // by a per-kind ABSOLUTE ceiling so bars stayed comparable across time-machine
  // snapshots. Those denominators are copied from the formulas below; this test
  // fails loudly if they drift. triage() stayed exported after the 2026-09-15
  // audit retired the realm — pure function, reusable for future features.
  const sel = { projects: [
    { id:'p1', name:'A', metrics:{ risk_security:{secrets_found:5}, git_safety:{dirty:400} },
      signals:{has_tests:false, has_ci:false}, activity:{days_since_commit:900} },
  ] };
  const by = Object.fromEntries(triage(sel).map((r) => [r.kind, r.blastRadius]));
  assert.equal(by.security, 105);        // 100 + secrets, at the 5-secret mark
  assert.equal(by.uncommitted, 90);      // 50 + min(dirty, 40)      — hard cap
  assert.equal(by.stale, 50);            // 20 + min(days, 60) / 2   — hard cap
  assert.equal(by['no-tests'], 15);      // fixed
  assert.equal(by['no-ci'], 10);         // fixed
});

test('triage: clean project → no rows; never throws on empty/null', () => {
  assert.deepEqual(triage({ projects:[{ id:'ok', name:'ok', metrics:{risk_security:{secrets_found:0},git_safety:{dirty:0}}, signals:{has_tests:true,has_ci:true}, activity:{days_since_commit:0} }] }), []);
  assert.doesNotThrow(() => triage({}));
  assert.doesNotThrow(() => triage(null));
});

test('anomalies: counts buckets, normalizes heterogeneous item shapes, sums disk', () => {
  const sel = { inventory:{ clones:[{name:'x'},{name:'y'}], duplicates:[{detail:'z mirrors w'}], empty:['e1','e2','e3'] },
    projects:[{disk:{reclaimable_bytes:100}},{disk:{reclaimable_bytes:50}}] };
  const a = anomalies(sel);
  assert.equal(a.clones, 2); assert.equal(a.duplicates, 1); assert.equal(a.empty, 3);
  assert.equal(a.reclaimableBytes, 150);
  assert.equal(a.items.length, 6);
  assert.ok(a.items.every(i => typeof i.label === 'string' && i.kind));
  assert.doesNotThrow(() => anomalies({}));
});

test('momentum: positive slope → finite ETA; flat/empty → null, no div-by-zero', () => {
  const up = momentum({ xp:[{d:'a',v:100},{d:'b',v:110},{d:'c',v:120},{d:'d',v:130}] }, { xp_to_next:50 }, '2026-07-04T12:00:00Z');
  assert.ok(up.xpSlope > 9 && up.xpSlope < 11);
  assert.ok(up.etaDays > 0 && isFinite(up.etaDays));
  assert.equal(typeof up.etaNextLevel, 'string');
  const flat = momentum({ xp:[{d:'a',v:5},{d:'b',v:5}] }, { xp_to_next:50 }, '2026-07-04T12:00:00Z');
  assert.equal(flat.etaDays, null); assert.equal(flat.etaNextLevel, null);
  assert.doesNotThrow(() => momentum({}, {}, '2026-07-04T12:00:00Z'));
});

test('momentum: invalid/undefined now never throws; etaNextLevel stays null', () => {
  const r = momentum({ xp:[{d:'a',v:100},{d:'b',v:110},{d:'c',v:120},{d:'d',v:130}] }, { xp_to_next:50 }, undefined);
  assert.doesNotThrow(() => momentum({ xp:[{d:'a',v:100},{d:'b',v:110}] }, { xp_to_next:50 }, undefined));
  assert.ok(r.etaDays > 0 && isFinite(r.etaDays));   // slope still computed
  assert.equal(r.etaNextLevel, null);
  assert.doesNotThrow(() => momentum({ xp:[{d:'a',v:1},{d:'b',v:2}] }, { xp_to_next:50 }, 'not-a-date'));
});

test('spellFit: matches a signal gap to a spell by keyword, scoped to the project', () => {
  const bundle = { spellbook:{ spells:[
    { id:'s1', name:'test-scaffold', description:'adds a test suite' },
    { id:'s2', name:'readme-gen', description:'writes a README' },
  ] } };
  const sel = { projects:[ { id:'p1', name:'A', signals:{ has_tests:false, has_readme:true } } ] };
  const r = spellFit(bundle, sel);
  assert.equal(r.length, 1);
  assert.equal(r[0].spellId, 's1');
  assert.equal(r[0].forProjectId, 'p1');
  assert.match(r[0].why, /test/i);
  assert.doesNotThrow(() => spellFit({}, {}));
});

test('streakRisk: alive-but-unscanned-today is at risk; scanned-today is safe', () => {
  const risk = streakRisk({ scan_days:4, last_scan:'2026-07-25' }, '2026-07-26T20:00:00Z');
  assert.equal(risk.atRisk, true);
  assert.equal(risk.streak, 4);
  assert.ok(risk.hoursLeft > 0 && risk.hoursLeft <= 24);
  const safe = streakRisk({ scan_days:4, last_scan:'2026-07-26' }, '2026-07-26T20:00:00Z');
  assert.equal(safe.atRisk, false);
  assert.doesNotThrow(() => streakRisk({}, '2026-07-26T20:00:00Z'));
});

test('streakRisk: invalid/undefined now never throws; streak still returned, not at risk', () => {
  const r = streakRisk({ scan_days: 1 });   // no `now` passed at all
  assert.doesNotThrow(() => streakRisk({ scan_days: 1 }));
  assert.equal(r.atRisk, false);
  assert.equal(r.hoursLeft, 0);
  assert.equal(r.streak, 1);
  assert.doesNotThrow(() => streakRisk({ scan_days: 4, last_scan: '2026-07-26' }, 'not-a-date'));
});

test('achievementNudges: surfaces near-complete locked achievements only', () => {
  const r = achievementNudges([
    { id:'a', unlocked:true,  progress:{ have:5, need:5 } },   // unlocked → skip
    { id:'b', unlocked:false, progress:{ have:4, need:5 } },   // 0.8 → nudge
    { id:'c', unlocked:false, progress:{ have:1, need:8 } },   // 0.125 → skip
    { id:'d', unlocked:false },                                // no progress → skip
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'b');
  assert.equal(r[0].have, 4);
  assert.equal(r[0].need, 5);
  assert.equal(r[0].label, 'b');
  assert.doesNotThrow(() => achievementNudges(null));
});
