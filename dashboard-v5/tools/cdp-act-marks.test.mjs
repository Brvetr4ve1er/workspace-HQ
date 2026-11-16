// node --test dashboard-v5/tools/cdp-act-marks.test.mjs
// The act-marks cdp scenario needs the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is
// valid JavaScript, that the surfaces it expects are on the main-side allowlist, and that it stops at a failed fresh(), touches nothing, and
// cleans up after itself when the Brief never shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { makeActMarksScenarios, PAGE, SURFACES, EFFECT_SURFACES } from './cdp-act-marks.mjs';

const useLogMain = createRequire(import.meta.url)('../../dashboard/use-log.js');

test('the factory returns exactly use-act-marks and use-act-effect, async functions of one argument', () => {
  const S = makeActMarksScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S), ['use-act-marks', 'use-act-effect']);
  for (const k of Object.keys(S)) { assert.equal(typeof S[k], 'function', k); assert.equal(S[k].length, 1, k); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.rows, PAGE.rowButton(0), PAGE.dismissButton(1), PAGE.marks('cosmos', 'act'), PAGE.allMarks, PAGE.toHome, PAGE.armBrief, PAGE.cosmosCards,
    PAGE.goCosmos, PAGE.favorite('e1'), PAGE.batRun('quest-red', 'quest-done'), PAGE.firstTask, PAGE.doneTask('t1'), PAGE.readyVault, PAGE.saveVault, PAGE.reset];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the surfaces it watches are on the main-side allowlist', () => {
  for (const s of [...SURFACES, ...EFFECT_SURFACES]) assert.ok(useLogMain.SURFACES.includes(s), s);
});

test('it returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeActMarksScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  assert.deepEqual(await S['use-act-marks'](t), ['the app never mounted']);
  assert.equal(evals.length, 0);
});

test('a Brief that never shows is reported, and the page is reset to Home', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeActMarksScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['use-act-marks'](t);
  assert.ok(out.length > 0);
  assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), 'leaves the fake as it found it');
  assert.ok(evals.some((s) => s.includes("L.go('home')")), 'leaves the app on Home');
});

test('a healthy page reports nothing and the clicks are the ones the spec names', async () => {
  const counts = { 'brief-panel/open': 1, 'brief-panel/act': 0, 'cosmos/open': 1, 'cosmos/act': 0, 'claude-vault/act': 0 };
  const clicked = [];
  const t = {
    errors: () => [], clearErrors() {},
    waitFor: async () => true,
    evaluate: async (s) => {
      for (const [k, v] of Object.entries(counts)) { const [sf, ac] = k.split('/'); if (s === PAGE.marks(sf, ac)) return v; }
      if (s === PAGE.dismissButton(0)) { clicked.push('dismiss'); return true; }   // Dismiss is not an act (batch 8)
      if (s === PAGE.rowButton(0)) { clicked.push('row'); return true; }   // Go and Scan are not acts (batch 8)
      if (s === PAGE.cosmosCards) return ['e1', 'e2'];
      if (s === PAGE.favorite('e1')) { clicked.push('favorite'); counts['cosmos/act']++; return true; }
      if (s === PAGE.saveVault) { clicked.push('save'); counts['claude-vault/act']++; return 'saved'; }
      if (s === PAGE.allMarks) return ['brief-panel/open', 'space-cosmos/open'];
      return true;
    },
  };
  const S = makeActMarksScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['use-act-marks'](t);
  assert.deepEqual(out, []);
  assert.deepEqual(clicked, ['dismiss', 'dismiss', 'row', 'favorite', 'save']);
});

test('use-act-effect: a healthy page reports nothing and makes the clicks the counting fix names', async () => {
  const counts = { 'brief-act/act': 0, 'brief-act/handover': 0, 'tasks-board/act': 0 };
  const ran = [];
  const t = {
    errors: () => [], clearErrors() {},
    waitFor: async () => true,
    evaluate: async (s) => {
      for (const [k, v] of Object.entries(counts)) { const [sf, ac] = k.split('/'); if (s === PAGE.marks(sf, ac)) return v; }
      if (s === PAGE.batRun('quest-red', 'quest-done')) { ran.push('done'); counts['brief-act/act'] = 1; return true; }   // the second click adds nothing
      if (s === PAGE.batRun('session-waiting', 'open-folder')) { ran.push('folder'); return true; }
      if (s === PAGE.firstTask) return 't1';
      if (s === PAGE.doneTask('t1')) { ran.push('task'); return true; }
      if (s === PAGE.allMarks) return ['brief-act/act', 'brief-panel/open'];
      return true;
    },
  };
  const S = makeActMarksScenarios({ fresh: async () => null, sleep: async () => {} });
  // the mock bumps the task mark only when the scenario waits for it, the way the page does once the Undo window has passed
  t.waitFor = async (expr) => { if (expr.includes(PAGE.marks('tasks-board', 'act'))) counts['tasks-board/act'] = 1; return true; };
  assert.deepEqual(await S['use-act-effect'](t), []);
  assert.deepEqual(ran, ['done', 'done', 'folder', 'task']);
});

test('use-act-effect: a second Mark done that adds a mark, or an Open folder that marks, is reported', async () => {
  const counts = { 'brief-act/act': 0, 'brief-act/handover': 0, 'tasks-board/act': 1 };
  const t = {
    errors: () => [], clearErrors() {},
    waitFor: async () => true,
    evaluate: async (s) => {
      for (const [k, v] of Object.entries(counts)) { const [sf, ac] = k.split('/'); if (s === PAGE.marks(sf, ac)) return v; }
      if (s === PAGE.batRun('quest-red', 'quest-done')) { counts['brief-act/act']++; return true; }
      if (s === PAGE.batRun('session-waiting', 'open-folder')) { counts['brief-act/handover']++; return true; }
      if (s === PAGE.firstTask) return null;
      if (s === PAGE.allMarks) return [];
      return true;
    },
  };
  const S = makeActMarksScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['use-act-effect'](t);
  assert.ok(out.some((m) => m.includes('same Mark done again')), out.join(' | '));
  assert.ok(out.some((m) => m.includes('Open its folder marked something')), out.join(' | '));
});
