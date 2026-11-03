// node --test dashboard/daily-notes-watch.test.mjs — vault→app daily-note sync.
// The contract under test: the debounce is PER FILE, so note B changing right
// after note A no longer cancels A's pending read (the old shared timer dropped
// A's quest ticks whenever two 10_Daily files changed within 1.2s — routine,
// since assemble rewrites today's note and sync plugins touch others).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createScanner, tickedIds, watch } = require('./daily-notes-watch.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-daily-'));
  t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
  return d;
}
function scanner(t, dir, over = {}) {
  const done = [];
  const s = createScanner({ dir, readOverrides: () => ({}), applyDone: (ids) => done.push(ids), debounceMs: 30, log: () => {}, ...over });
  t.after(() => s.close());
  return { s, done };
}

// ---------------------------------------------------------------- tickedIds
test('tickedIds: ticked wq lines only, done ids filtered, all list markers accepted', () => {
  const text = [
    '- [x] wq:q-aaa do the thing',
    '- [ ] wq:q-not-ticked',
    '* [X] wq:sq-bbb side quest',
    '> [x] wq:q-quoted',
    'wq:q-no-checkbox',
    '- [x] no id on this line',
  ].join('\n');
  assert.deepEqual(tickedIds(text, () => false), ['q-aaa', 'sq-bbb', 'q-quoted']);
  assert.deepEqual(tickedIds(text, (id) => id === 'q-aaa'), ['sq-bbb', 'q-quoted']);
});

// ------------------------------------------------------------- per-file debounce
test('two notes changing within the window BOTH get scanned (the dropped-tick failure scenario)', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.md'), '- [x] wq:q-aaa\n');
  fs.writeFileSync(path.join(dir, 'b.md'), '- [x] wq:q-bbb\n');
  const { s, done } = scanner(t, dir);
  s.onEvent('a.md');
  s.onEvent('b.md');   // 10ms later in real life — inside a.md's debounce window
  await sleep(120);
  assert.deepEqual(done.sort((x, y) => String(x) < String(y) ? -1 : 1), [['q-aaa'], ['q-bbb']], 'note A was not cancelled by note B');
});

test('bursts for the SAME file still coalesce to one read', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.md'), '- [x] wq:q-aaa\n');
  const { s, done } = scanner(t, dir);
  s.onEvent('a.md'); s.onEvent('a.md'); s.onEvent('a.md');
  await sleep(120);
  assert.deepEqual(done, [['q-aaa']]);
});

test('already-done ids and non-md / missing files are ignored', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.md'), '- [x] wq:q-aaa\n');
  const { s, done } = scanner(t, dir, { readOverrides: () => ({ 'q-aaa': { status: 'done' } }) });
  s.onEvent('a.md');        // all its ids already done
  s.onEvent('a.txt');       // not a note
  s.onEvent('ghost.md');    // deleted between event and read
  s.onEvent(null);          // fs.watch can hand a null filename
  await sleep(120);
  assert.deepEqual(done, []);
});

test('close() cancels every pending per-file timer', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'a.md'), '- [x] wq:q-aaa\n');
  const { s, done } = scanner(t, dir);
  s.onEvent('a.md');
  s.close();
  await sleep(80);
  assert.deepEqual(done, []);
});

// ------------------------------------------------------------------ watch()
test('watch: a real fs.watch event reaches applyDone; missing dir → null', async (t) => {
  assert.equal(watch({ dir: path.join(os.tmpdir(), 'hq-definitely-missing-dir'), readOverrides: () => ({}), applyDone: () => {} }), null);
  const dir = tmp(t);
  const done = [];
  const w = watch({ dir, readOverrides: () => ({}), applyDone: (ids) => done.push(ids), debounceMs: 30, log: () => {} });
  assert.ok(w, 'watcher started');
  t.after(() => { try { w.close(); } catch {} });
  fs.writeFileSync(path.join(dir, 'today.md'), '- [x] wq:q-live\n');
  for (let i = 0; i < 100 && !done.length; i++) await sleep(30);   // fs.watch delivery is not instant
  assert.deepEqual(done, [['q-live']]);
});
