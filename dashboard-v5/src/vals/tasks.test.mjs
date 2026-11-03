// tasksVals empty states: "Board clear" must mean the BOARD is clear, not that the
// current tier filter has no matches (that gets its own noFilterMatch line).
//   node --test dashboard-v5/src/vals/tasks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tasksVals } from './tasks.js';

const T = (id, tier) => ({ id, tier, title: 'Task ' + id, why: '', proj: null, age: 1, xp: 10 });

// the ctx slice tasksVals reads (vals/ctx.js), with a snapshot view (live=false) so
// ideaRows / cleared take their simple branches
function vals(tasks, { taskFilter = 'all', recentDone = [] } = {}) {
  const open = tasks.filter((t) => !recentDone.includes(t.id));
  const self = {
    patched: null,
    setState(p) { this.patched = p; },
    sum: (a, f) => a.reduce((n, x) => n + f(x), 0),
    pname: () => '', sendClaude() {}, denied() {}, openProject() {}, ideasAt: () => [],
  };
  const ctx = {
    S: { taskFilter, recentDone, completed: [] }, H: { KIND: {}, T0: [] },
    live: false, snap: { IDEAS: [] }, tasks, open, sub: 'ranked',
    tabStyle: () => ({}), tk: (t) => ({ title: t.title }),
    tierCount: (k) => open.filter((t) => t.tier === k).length,
  };
  return { v: tasksVals.call(self, ctx), self };
}

test('an empty tier filter is noFilterMatch, never "Board clear"', () => {
  const { v } = vals([T('t1', 'orange'), T('t2', 'yellow')], { taskFilter: 'red' });
  assert.equal(v.taskRows.length, 0);
  assert.equal(v.noTasks, false, 'the board has 2 open tasks — it is not clear');
  assert.equal(v.noFilterMatch, true);
});

test('clearTaskFilter goes back to All', () => {
  const { v, self } = vals([T('t1', 'orange')], { taskFilter: 'red' });
  v.clearTaskFilter();
  assert.deepEqual(self.patched, { taskFilter: 'all' });
});

test('no open tasks at all is noTasks, not noFilterMatch', () => {
  const { v } = vals([]);
  assert.equal(v.noTasks, true);
  assert.equal(v.noFilterMatch, false);
});

test('recently-done rows keep both boxes away (done rows still render)', () => {
  // the only task was just completed: it still shows as a "✓ Done" row, so neither box renders
  const { v } = vals([T('t1', 'orange')], { recentDone: ['t1'] });
  assert.equal(v.taskRows.length, 1);
  assert.equal(v.noTasks, false);
  assert.equal(v.noFilterMatch, false);
});
