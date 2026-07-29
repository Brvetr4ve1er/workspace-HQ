import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardModel } from './warroom-model.mjs';

const ROWS = [
  { projectId:'p1', name:'Crucix', kind:'security',    detail:'2 exposed secrets', blastRadius:102 },
  { projectId:'p1', name:'Crucix', kind:'uncommitted', detail:'12 uncommitted',    blastRadius:62  },
  { projectId:'p2', name:'Hamma',  kind:'stale',       detail:'40 days since commit', blastRadius:40 },
];

test('threats: hp normalized to top blast, severity keyed by kind, order preserved', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.threats.length, 3);
  assert.equal(m.threats[0].hpPct, 100);              // top blast = 100%
  assert.equal(m.threats[0].sev, 'red');              // security
  assert.equal(m.threats[1].sev, 'orange');           // uncommitted
  assert.equal(m.threats[2].sev, 'yellow');           // stale
  assert.ok(m.threats[1].hpPct > 4 && m.threats[1].hpPct < 100);
  assert.equal(m.threats[0].name, 'Crucix');
});

test('vectors: only multi-concern projects link; single-concern none', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.vectors.length, 1);                  // only p1 has 2 rows
  assert.equal(m.vectors[0].projectId, 'p1');
  assert.deepEqual(m.vectors[0].idx, [0, 1]);
});

test('radar: one blip per threat, radius grows with hp, angle spread', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.radar.length, 3);
  assert.ok(m.radar.every(b => b.radius >= 0.35 && b.radius <= 0.95));
  assert.equal(m.radar[0].sev, 'red');
});

test('empty / null never throws', () => {
  assert.deepEqual(buildBoardModel([]), { threats:[], vectors:[], radar:[] });
  assert.doesNotThrow(() => buildBoardModel(null));
});
