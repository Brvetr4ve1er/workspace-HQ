import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, emit, initNotify } from './notify.mjs';

test('route: OS only when hidden+permitted; toast only when visible', () => {
  assert.deepEqual(route({type:'x'}, { hidden:true,  canNotify:true  }), { os:true,  toast:false });
  assert.deepEqual(route({type:'x'}, { hidden:false, canNotify:true  }), { os:false, toast:true  });
  assert.deepEqual(route({type:'x'}, { hidden:true,  canNotify:false }), { os:false, toast:false });
  assert.deepEqual(route(null, {}), { os:false, toast:false });
});

test('emit routes through injected effects; a throwing effect never escapes', () => {
  const os = [], toast = [];
  initNotify({ isHidden:()=>true, canNotify:()=>true, notify:(e)=>os.push(e.type), toast:(e)=>toast.push(e.type) });
  emit({ type:'streak_risk', title:'t' });
  assert.deepEqual(os, ['streak_risk']);
  assert.deepEqual(toast, []);
  initNotify({ isHidden:()=>false, canNotify:()=>true, notify:()=>{}, toast:()=>{ throw new Error('x'); } });
  assert.doesNotThrow(() => emit({ type:'x' }));
});

test('emit is a safe no-op before initNotify (or after init(null))', () => {
  initNotify(null);
  assert.deepEqual(emit({ type:'x' }), { os:false, toast:false });
});
