import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardModel } from './warroom-model.mjs';

const ROWS = [
  { projectId:'p1', name:'Crucix', kind:'security',    detail:'2 exposed secrets', blastRadius:102 },
  { projectId:'p1', name:'Crucix', kind:'uncommitted', detail:'12 uncommitted',    blastRadius:62  },
  { projectId:'p2', name:'Hamma',  kind:'stale',       detail:'40 days since commit', blastRadius:40 },
];

test('threats: hp uses the per-kind absolute ceiling, severity keyed by kind, order preserved', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.threats.length, 3);
  assert.equal(m.threats[0].hpPct, 97);               // security 102 / 105
  assert.equal(m.threats[1].hpPct, 69);               // uncommitted 62 / 90
  assert.equal(m.threats[2].hpPct, 80);               // stale 40 / 50
  assert.equal(m.threats[0].sev, 'red');              // security
  assert.equal(m.threats[1].sev, 'orange');           // uncommitted
  assert.equal(m.threats[2].sev, 'yellow');           // stale
  assert.equal(m.threats[0].name, 'Crucix');
});

test('hpPct: snapshot-stable — fixing the worst threat never moves another bar', () => {
  const before = buildBoardModel(ROWS);
  const after = buildBoardModel(ROWS.slice(1));       // the secrets got rotated
  assert.equal(after.threats[0].hpPct, before.threats[1].hpPct);
  assert.equal(after.threats[1].hpPct, before.threats[2].hpPct);
});

test('hpPct: floor-clamped to 4 so a hairline threat still draws a visible bar', () => {
  const m = buildBoardModel([{ projectId:'p', name:'N', kind:'security', detail:'x', blastRadius:1 }]);
  assert.equal(m.threats[0].hpPct, 4);                // 1/105 rounds to 1 -> clamped up
});

test("sev: fixed-blast hygiene kinds and unknown kinds fall back to 'dim'", () => {
  const m = buildBoardModel([
    { projectId:'p1', name:'A', kind:'no-tests', detail:'no tests', blastRadius:15 },
    { projectId:'p2', name:'B', kind:'no-ci',    detail:'no CI',    blastRadius:10 },
    { projectId:'p3', name:'C', kind:'mystery',  detail:'?',        blastRadius:5  },
  ]);
  assert.equal(m.threats[0].sev, 'dim');
  assert.equal(m.threats[1].sev, 'dim');
  assert.equal(m.threats[2].sev, 'dim');              // unknown kind -> dim, never undefined
  assert.equal(m.threats[0].hpPct, 100);              // fixed-blast kinds sit at their own ceiling
  assert.equal(m.threats[1].hpPct, 100);
});

test('vectors: only multi-concern projects link; single-concern none', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.vectors.length, 1);                  // only p1 has 2 rows
  assert.equal(m.vectors[0].projectId, 'p1');
  assert.deepEqual(m.vectors[0].idx, [0, 1]);
});

test('radar: one blip per threat, worst sits at the CENTER, angle spread', () => {
  const m = buildBoardModel(ROWS);
  assert.equal(m.radar.length, 3);
  assert.ok(m.radar.every(b => b.radius >= 0.35 && b.radius <= 0.95));
  assert.ok(m.radar[0].radius < m.radar[1].radius);   // closer to you = more dangerous
  assert.ok(m.radar[1].radius < m.radar[2].radius);
  assert.equal(m.radar[0].sev, 'red');
  assert.ok(m.radar.every((b, i) => b.angle === (i / 3) * Math.PI * 2));
});

test('empty / null never throws', () => {
  assert.deepEqual(buildBoardModel([]), { threats:[], vectors:[], radar:[] });
  assert.doesNotThrow(() => buildBoardModel(null));
});
