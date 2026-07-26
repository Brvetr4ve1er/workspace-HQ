import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, dispatch, all, resolve, _reset } from './actions.mjs';

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
