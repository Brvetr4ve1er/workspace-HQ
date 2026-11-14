// node --test dashboard-v5/tools/cdp-brief-quiet.test.mjs
// The unclogged-Brief cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that the placeholder fields are exactly what the engine (dashboard/brief-quiet.mjs) produces, and that each scenario stops at a failed
// fresh(), reports a panel that never renders, and leaves the page as it found it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeBriefQuietScenarios, PAGE, QUIET, SINCE, DIRTY, QUEST, briefOf, groupRow, agedQuest, FRESH_A, FRESH_B, STANDING_LOW } from './cdp-brief-quiet.mjs';
import { groupField, agedSlot, pickQuiet, DAY_MS } from '../../dashboard/brief-quiet.mjs';

const NAMES = ['brief-group-row', 'brief-aged-slot', 'brief-quiet-lane'];

test('the factory returns exactly the three scenarios, each an async function of one argument', () => {
  const S = makeBriefQuietScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.sec, PAGE.rows, PAGE.texts, PAGE.outside, PAGE.where, PAGE.calls, PAGE.reset, PAGE.buttons(2), PAGE.click(0, 'Open Projects'), PAGE.tipped('Quiet lane'),
    PAGE.serve(briefOf({ items: [groupRow('p1')], quiet: QUIET }))];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the placeholder group row carries exactly the field the engine builds', () => {
  const bare = { ...groupRow('p1') };
  delete bare.group;
  assert.deepEqual(groupRow('p1').group, groupField(bare, { 'group:dirty': { first: SINCE, last: SINCE } }));
  assert.equal(groupRow('p1').key, DIRTY);
  assert.equal(groupRow('p1').action.projectId, 'p1', 'the worst-project action is kept for Commit');
});

test('the placeholder aged row is what the engine yields for a standing quest on a day that shows it', () => {
  const standing = [{ ...agedQuest(), since: agedQuest().aged.since }];
  delete standing[0].aged;
  let found = null;
  for (let d = 10; d < 14 && !found; d++) { const r = agedSlot({ fresh: [FRESH_A, FRESH_B], standing, now: d * DAY_MS + 3600e3, cap: 3 }); if (r.aged) found = r.aged; }
  assert.ok(found, 'one of four days shows the single candidate');
  assert.deepEqual(found.aged, agedQuest().aged);
  assert.equal(found.key, QUEST);
  assert.equal('since' in found, false);
});

test('the placeholder quiet entry is the engine\'s own line for a Security walkthrough never started', () => {
  const q = pickQuiet({ quietInputs: { security: { started: false }, bridge: { paired: true }, moneyOpened: true, sources: [] }, money: null, now: 20000 * DAY_MS });
  assert.deepEqual(q, QUIET);
  assert.deepEqual(Object.keys(QUIET).sort(), ['action', 'age', 'key', 'kind', 'rule', 'source', 'text', 'why']);
});

test('the placeholder briefs carry no real names (the repo is public)', () => {
  const text = JSON.stringify([QUIET, groupRow('p1'), agedQuest(), FRESH_A, FRESH_B, STANDING_LOW, briefOf({})]);
  assert.doesNotMatch(text, /workspace|veemo|C:\\|\.env|alliance/i);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefQuietScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a Brief that never renders is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return 'p1'; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeBriefQuietScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.some((s) => s === PAGE.reset), name + ' leaves the fake as it found it');
  }
});

test('the group scenario reports a main button that opens one project instead of the list', async () => {
  const t = {
    evaluate: async (s) => (s.includes('projectsAt') ? 'p1' : s === PAGE.texts ? ['Project A has 12 uncommitted files and 2 more projects scan 1 h ago from scan 1 h ago · oldest since 7 Nov']
      : s === PAGE.buttons(0) ? ['Open Projects', 'Commit…', 'Dismiss'] : s === PAGE.where ? JSON.stringify({ tab: 'projects', route: { type: 'project', id: 'p1' }, sub: null }) : true),
    waitFor: async (e) => !e.includes('commit'), errors: () => [], clearErrors() {},
  };
  const S = makeBriefQuietScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['brief-group-row'](t);
  assert.ok(out.some((m) => /opened one project, not the list/.test(m)), JSON.stringify(out));
});

test('the quiet scenario reports a quiet line that became a card', async () => {
  const t = {
    evaluate: async (s) => (s === `${PAGE.rows}.length` ? 2 : s === PAGE.tipped('Quiet lane') ? { text: QUIET.text, title: 'Quiet lane · changes daily' } : s === PAGE.tipped('Standing since') ? { text: 'x', title: 'Standing since 8 Nov' }
      : s === PAGE.outside ? 'Standing, oldest since 8 Nov: Project Z has 11 uncommitted files · ' + QUIET.text + ' Nothing needs you right now Quiet:' : true),
    waitFor: async () => true, errors: () => [], clearErrors() {},
  };
  const S = makeBriefQuietScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S['brief-quiet-lane'](t);
  assert.ok(out.some((m) => /became a card/.test(m)), JSON.stringify(out));
});
