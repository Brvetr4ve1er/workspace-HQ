import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, dispatch, all, resolve, _reset, initActions } from './actions.mjs';

test('dispatch runs the action once and reports ok + result', () => {
  _reset();
  let calls = 0;
  register({ id:'x', label:'X', run: () => { calls++; return 42; } });
  const r = dispatch('x', {});
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.result, 42);
});

test('dispatch swallows a throwing action → {ok:false}; unknown id → {ok:false}', () => {
  _reset();
  register({ id:'boom', label:'B', run: () => { throw new Error('nope'); } });
  let r;
  assert.doesNotThrow(() => { r = dispatch('boom', {}); });
  assert.equal(r.ok, false);
  assert.match(r.error, /nope/);
  assert.equal(dispatch('missing', {}).ok, false);
});

test('all(ctx) lists only enabled actions, projected to {id,label,icon}', () => {
  _reset();
  register({ id:'a', label:'A', icon:'✦', run(){}, enabled: () => true });
  register({ id:'b', label:'B', run(){}, enabled: (ctx) => ctx.allow === true });
  assert.deepEqual(all({ allow:false }).map(x => x.id), ['a']);
  assert.deepEqual(all({ allow:true }).map(x => x.id).sort(), ['a','b']);
  assert.equal(resolve('a').label, 'A');
  assert.equal(resolve('nope'), null);
  assert.deepEqual(Object.keys(all({ allow:false })[0]).sort(), ['icon','id','label']);
});

test('initActions seeds go:<realm> + core verbs from injected deps', () => {
  _reset();
  const switched = [];
  initActions({ switchRealm: (id) => switched.push(id), ordered: () => [{ manifest:{ id:'forge', sigil:'⚒' } }], hq: {} });
  assert.ok(resolve('go:forge'));
  assert.ok(resolve('scan:now'));
  assert.ok(resolve('quest:done'));
  dispatch('go:forge', {});
  assert.deepEqual(switched, ['forge']);
  // quest:done is enabled only with a questId in ctx
  assert.equal(all({}).find(a => a.id === 'quest:done'), undefined);
  assert.ok(all({ questId: 'q1' }).find(a => a.id === 'quest:done'));
  // a missing hq method must not throw when dispatched
  assert.doesNotThrow(() => dispatch('scan:now', {}));
});

test('capture:note passes ctx.text to hq.captureSave and needs text to enable', () => {
  _reset();
  const saved = [];
  initActions({ switchRealm: () => {}, ordered: () => [], hq: { captureSave: (t) => saved.push(t) } });
  assert.ok(resolve('capture:note'));
  assert.equal(all({}).find((a) => a.id === 'capture:note'), undefined);       // no text -> disabled
  assert.ok(all({ text: 'x' }).find((a) => a.id === 'capture:note'));
  dispatch('capture:note', { text: 'Clean up: playwright' });
  assert.deepEqual(saved, ['Clean up: playwright']);
  assert.doesNotThrow(() => { _reset(); initActions({ ordered: () => [], hq: {} }); dispatch('capture:note', { text: 'y' }); });
});

test('claude:dispatch forwards path+prompt to hq.claudeQuest and needs both to enable', () => {
  _reset();
  const calls = [];
  initActions({ switchRealm: () => {}, ordered: () => [], hq: { claudeQuest: (p, t) => { calls.push([p, t]); return true; } } });
  assert.ok(resolve('claude:dispatch'));
  assert.equal(all({}).find((a) => a.id === 'claude:dispatch'), undefined);                      // neither
  assert.equal(all({ projectPath: 'A' }).find((a) => a.id === 'claude:dispatch'), undefined);    // prompt missing
  assert.ok(all({ projectPath: 'A', prompt: 'do it' }).find((a) => a.id === 'claude:dispatch')); // both
  const r = dispatch('claude:dispatch', { projectPath: 'A', prompt: 'do it' });
  assert.deepEqual(calls, [['A', 'do it']]);
  assert.equal(r.ok, true);
  // a missing preload method must no-op, not throw
  _reset();
  initActions({ ordered: () => [], hq: {} });
  assert.doesNotThrow(() => dispatch('claude:dispatch', { projectPath: 'A', prompt: 'x' }));
});
