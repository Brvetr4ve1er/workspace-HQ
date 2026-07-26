import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oracle, triage, anomalies, momentum } from './derive.mjs';

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
