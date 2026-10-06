// board-model.test.mjs — headless unit test for the TASKS board model.
// Runs under `node --test legacy/dashboard-v4/src/surfaces/tasks/board-model.test.mjs`
// (by FILE — this machine mis-discovers directory tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, hpPct, GROUPS } from './board-model.mjs';

// A snapshot exercising every section at once: one project with secrets +
// dirty files + staleness + no tests + no CI, open quests, an idea, and the
// signal gaps agency.mjs derives from the same shape.
const SNAP = {
  projects: [
    {
      id: 'p1', name: 'Alpha', path: 'C:/x/Alpha',
      metrics: { risk_security: { secrets_found: 3 }, git_safety: { dirty: 12 }, code_health: {} },
      activity: { days_since_commit: 40 },
      signals: { has_tests: false, has_ci: false },
    },
    {
      id: 'p2', name: 'Beta', path: 'C:/x/Beta',
      metrics: { risk_security: { secrets_found: 0 }, git_safety: { dirty: 0 }, code_health: {} },
      activity: { days_since_commit: 1 },
      signals: { has_tests: true, has_ci: true },
    },
  ],
  quests: [
    { id: 'q1', title: 'Rotate the leaked key', tier: 'red', status: 'open', project_id: 'p1', insight: 'a secret is live' },
    { id: 'q2', title: 'Write a README', tier: 'yellow', status: 'in_progress', project_id: 'p2', insight: '' },
    { id: 'q3', title: 'Already done', tier: 'red', status: 'done', project_id: 'p1', insight: '' },
  ],
  side_quests: [
    { id: 's1', kind: 'idea', title: 'Add a LICENSE', detail: 'clarify usage rights', project_id: 'p1' },
    { id: 's2', kind: 'chore', title: 'not an idea', project_id: 'p1' },
  ],
};

const groupOf = (board, id) => board.groups.find((g) => g.id === id);

test('every row buildQueue emits lands in exactly one section', () => {
  const board = buildBoard(SNAP);
  assert.equal(board.total, board.items.length);
  const placed = board.groups.reduce((n, g) => n + g.count, 0);
  assert.equal(placed, board.total, 'a row fell out of the board');
  const ids = board.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length, 'a row was placed in two sections');
});

test('threat sections split by kind; the other three follow queue source', () => {
  const board = buildBoard(SNAP);
  assert.equal(groupOf(board, 'security').count, 1);        // Alpha's 3 secrets
  assert.equal(groupOf(board, 'uncommitted').count, 1);     // Alpha's 12 dirty files
  assert.equal(groupOf(board, 'stale').count, 1);           // Alpha at 40 days
  assert.equal(groupOf(board, 'hygiene').count, 2);         // no tests + no CI, one section
  assert.equal(groupOf(board, 'task').count, 2);            // q3 is done, so it is not open work
  assert.equal(groupOf(board, 'idea').count, 1);            // s2 is not kind:'idea'
  // GAPS come from agency.mjs; assert the section agrees with the queue's own
  // per-source count rather than hard-coding that module's current rule set.
  assert.equal(groupOf(board, 'gap').count, board.counts.gap || 0);
});

test('threat rows carry kind + a blast bar joined from triage; nothing else does', () => {
  const board = buildBoard(SNAP);
  const sec = groupOf(board, 'security').items[0];
  assert.equal(sec.kind, 'security');
  assert.equal(sec.blastRadius, 103);                       // 100 + 3 secrets
  assert.equal(sec.hpPct, 98);                              // round(103/105 * 100)
  const unc = groupOf(board, 'uncommitted').items[0];
  assert.equal(unc.blastRadius, 62);                        // 50 + min(12, 40)
  assert.equal(unc.hpPct, 69);                              // round(62/90 * 100)
  for (const g of ['task', 'gap', 'idea']) {
    for (const it of groupOf(board, g).items) {
      assert.equal(it.hpPct, undefined, `${g} rows must not claim a blast reading`);
    }
  }
});

test('hpPct anchors to the per-kind ceiling and never reads 0 or over 100', () => {
  assert.equal(hpPct(105, 'security'), 100);
  assert.equal(hpPct(90, 'uncommitted'), 100);
  assert.equal(hpPct(50, 'stale'), 100);
  assert.equal(hpPct(15, 'no-tests'), 100);
  assert.equal(hpPct(1, 'security'), 4);                    // clamped up: a hairline is still visible
  assert.equal(hpPct(9999, 'stale'), 100);                  // clamped down
  assert.equal(hpPct(50, 'unknown-kind'), 48);              // falls back to the worst-case ceiling
  assert.equal(hpPct(null, 'security'), null);
  assert.equal(hpPct('nonsense', 'security'), null);
});

test('the hero number counts only rows that carry a severity', () => {
  const board = buildBoard(SNAP);
  const bySev = board.items.filter((i) => i.severity !== 'dim').length;
  assert.equal(board.flagged, bySev);
  assert.ok(board.flagged < board.total, 'the dim long tail must not inflate the hero count');
  assert.equal(board.worstSev, 'red');                      // secrets + a red quest
});

test('worstSev degrades to dim when nothing is wrong, and the board can be empty', () => {
  const calmScan = {
    projects: [{ id: 'p2', name: 'Beta', path: 'C:/x/Beta', metrics: {}, activity: { days_since_commit: 1 }, signals: { has_tests: true, has_ci: true } }],
    quests: [], side_quests: [],
  };
  const calm = buildBoard(calmScan);
  assert.equal(calm.flagged, 0);
  assert.equal(calm.worstSev, 'dim');
  for (const board of [buildBoard(null), buildBoard({}), buildBoard('garbage'), buildBoard([])]) {
    assert.equal(board.total, 0);
    assert.equal(board.flagged, 0);
    assert.equal(board.worstSev, 'dim');
    assert.equal(board.shape, '');
    assert.deepEqual(board.radar, []);
    assert.equal(board.groups.length, GROUPS.length);
  }
});

test('the shape line is mixed case and names every populated section', () => {
  const board = buildBoard(SNAP);
  assert.match(board.shape, /^1 security . 1 uncommitted . 1 stale . 2 hygiene . 2 tasks/);
  assert.notEqual(board.shape, board.shape.toUpperCase(), 'the shape line must not shout');
  for (const g of board.groups) {
    if (g.count) assert.ok(board.shape.includes(`${g.count} ${g.word}`), `${g.id} missing from the shape`);
    else assert.ok(!board.shape.includes(` ${g.word}`), `${g.id} claimed a count it does not have`);
  }
});

test('radar blips: one per threat, worst nearest the eye, all inside the rim', () => {
  const board = buildBoard(SNAP);
  const threats = board.items.filter((i) => i.source === 'threat');
  assert.equal(board.radar.length, threats.length);
  for (const b of board.radar) {
    assert.ok(b.radius > 0 && b.radius <= 0.95, `radius ${b.radius} is off the scope`);
    assert.ok(b.angle >= 0 && b.angle < Math.PI * 2);
    assert.ok(['red', 'orange', 'yellow', 'dim'].includes(b.sev));
  }
  // threats arrive blast-sorted desc, so blip 0 is the worst and sits innermost
  const radii = board.radar.map((b) => b.radius);
  assert.deepEqual(radii, [...radii].sort((a, b) => a - b), 'blips must run inner-worst to outer-calm');
});
