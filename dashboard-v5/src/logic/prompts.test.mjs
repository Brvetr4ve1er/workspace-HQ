import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptsLogic, RUN_LATER } from './prompts.js';

function rig(answers = {}) {
  const toasts = [], calls = [], went = [];
  const self = {
    ...promptsLogic,
    state: { prQuery: 'staff', prSearched: false, prFor: null },
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    toast: (kind, text) => toasts.push([kind, text]),
    go: (tab, sub) => went.push([tab, sub]),
    store: {
      refreshPrompts: () => { calls.push(['refresh']); return Promise.resolve(); },
      searchPrompts: (q) => { calls.push(['search', q]); return Promise.resolve(); },
      openPrompt: (id, how) => { calls.push(['open', id, how]); const a = answers[how]; return Promise.resolve(typeof a === 'function' ? a() : a || { ok: true, how }); },
    },
  };
  return { self, toasts, calls, went };
}

test('prSearch / prClear drive the store search', async () => {
  const r = rig();
  await r.self.prSearch();
  assert.deepEqual(r.calls.at(-1), ['search', 'staff']); assert.equal(r.self.state.prSearched, true);
  await r.self.prClear();
  assert.deepEqual(r.calls.at(-1), ['search', '']); assert.deepEqual([r.self.state.prQuery, r.self.state.prSearched], ['', false]);
  r.self.onPrQuery({ target: { value: 'x' } }); assert.equal(r.self.state.prQuery, 'x');
});

test('prOpen: Obsidian → toast; Obsidian missing → falls back to Open file once; errors say why', async () => {
  const ok = rig(); await ok.self.prOpen('prompt:a', 'obsidian');
  assert.deepEqual(ok.calls, [['open', 'prompt:a', 'obsidian']]);
  assert.deepEqual(ok.toasts, [['info', 'Opened in Obsidian']]);
  const fb = rig({ obsidian: { error: 'Obsidian is not installed — use Open file', fallback: 'file' } });
  await fb.self.prOpen('prompt:a', 'obsidian');
  assert.deepEqual(fb.calls.map((c) => c[2]), ['obsidian', 'file']);
  assert.deepEqual(fb.toasts, [['info', 'Obsidian is not installed — opened the note file instead']]);
  const loop = rig({ obsidian: { error: 'x', fallback: 'file' }, file: { error: 'that prompt note is not in the Prompts folder (moved, renamed or deleted?)' } });
  await loop.self.prOpen('prompt:a', 'obsidian');
  assert.equal(loop.calls.length, 2, 'never more than one fallback');
  assert.deepEqual(loop.toasts.at(-1), ['error', 'Open failed · that prompt note is not in the Prompts folder (moved, renamed or deleted?)']);
});

test('prRun is a labelled placeholder until the run step; it opens and sends nothing', () => {
  const r = rig(); r.self.prRun('prompt:a');
  assert.deepEqual(r.toasts, [['info', RUN_LATER]]);
  assert.match(RUN_LATER, /uses your Claude quota/);
  assert.deepEqual(r.calls, []);
});

test('prForProject: the Library opens with the project as run context; ✕ clears it', async () => {
  const r = rig();
  await r.self.prForProject({ id: 'project-a', name: 'Project A' });
  assert.deepEqual(r.went, [['claude', 'prompts']]);
  assert.equal(r.self.state.prFor, 'project-a');
  assert.deepEqual([r.self.state.prQuery, r.self.state.prSearched], ['', false]);
  assert.ok(r.calls.some((c) => c[0] === 'refresh'));
  r.self.prClearProject(); assert.equal(r.self.state.prFor, null);
  await r.self.prForProject(null); assert.equal(r.self.state.prFor, null);
});
