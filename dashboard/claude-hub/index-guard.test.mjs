// Index guard (recall dish, commit 1): chats whose transcript is gone exist only in the index, so a reindex must refuse.
//   node --test dashboard/claude-hub/index-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { countIndexOnly, indexOnlyRows, guardReset, codeConversationRows, refusalText } from './index-guard.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-guard-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// a projects root with two folders; sess-1 and sess-2 have transcripts, sess-3 does not
function layout(dir) {
  const root = path.join(dir, 'projects');
  for (const f of ['C--alpha-site', 'C--beta-site']) fs.mkdirSync(path.join(root, f), { recursive: true });
  fs.writeFileSync(path.join(root, 'C--alpha-site', 'sess-1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(root, 'C--beta-site', 'sess-2.jsonl'), '{}\n');
  return root;
}
const row = (folder, native) => ({ id: 'code:' + native, project_id: 'code:' + folder, native_id: native });

test('counts the conversations whose transcript file is gone', () => {
  const dir = tmp();
  try {
    const root = layout(dir);
    const rows = [row('C--alpha-site', 'sess-1'), row('C--beta-site', 'sess-2'), row('C--alpha-site', 'sess-3'), row('C--gamma-site', 'sess-4')];
    assert.equal(countIndexOnly(rows, root), 2);
    assert.deepEqual(indexOnlyRows(rows, root).map((r) => r.native_id), ['sess-3', 'sess-4']);
  } finally { rm(dir); }
});

test('0 when every transcript exists', () => {
  const dir = tmp();
  try {
    const root = layout(dir);
    assert.equal(countIndexOnly([row('C--alpha-site', 'sess-1'), row('C--beta-site', 'sess-2')], root), 0);
    assert.equal(countIndexOnly([], root), 0);
  } finally { rm(dir); }
});

test('a transcript that exists only deeper (subagents) does not count as present', () => {
  const dir = tmp();
  try {
    const root = layout(dir);
    fs.mkdirSync(path.join(root, 'C--alpha-site', 'sess-1', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'C--alpha-site', 'sess-1', 'subagents', 'agent-x.jsonl'), '{}\n');
    assert.equal(countIndexOnly([row('C--alpha-site', 'agent-x')], root), 1);
  } finally { rm(dir); }
});

test('never throws on a missing root, odd rows or a failing check', () => {
  const missing = path.join(os.tmpdir(), 'hq-guard-no-such-root-' + process.pid);
  assert.equal(countIndexOnly([row('C--alpha-site', 'sess-1')], missing), 1);
  assert.equal(countIndexOnly([row('C--alpha-site', 'sess-1')], undefined), 1);
  assert.equal(countIndexOnly(null, missing), 0);
  assert.equal(countIndexOnly([null, {}, { project_id: 'web:x', native_id: 'y' }, { project_id: 'code:..', native_id: '../x' }], missing), 4);
  assert.equal(countIndexOnly([row('a', 'b')], missing, { exists: () => { throw new Error('EPERM'); } }), 1);
});

test('guardReset reads a real store: refuses while an index-only chat exists, allows at 0, ignores forgotten and non-code', () => {
  const dir = tmp();
  const store = openStore(':memory:');
  try {
    const root = layout(dir);
    store.upsertProject({ id: 'code:C--alpha-site', source: 'code', key: 'C--alpha-site', name: 'C--alpha-site', path: null });
    store.ensureConversation({ id: 'code:sess-1', source: 'code', projectId: 'code:C--alpha-site', nativeId: 'sess-1' });
    assert.deepEqual(guardReset(store, root), { indexOnly: 0, allow: true });
    store.ensureConversation({ id: 'code:sess-3', source: 'code', projectId: 'code:C--alpha-site', nativeId: 'sess-3' });
    assert.deepEqual(guardReset(store, root), { indexOnly: 1, allow: false });
    assert.equal(codeConversationRows(store).length, 2);
    store.ensureConversation({ id: 'web:w1', source: 'web', projectId: null, nativeId: 'w1' });   // not a code chat: never counted
    assert.equal(guardReset(store, root).indexOnly, 1);
    store.db.prepare("UPDATE conversation SET forgotten = 1 WHERE id = 'code:sess-3'").run();   // forgotten: the owner already deleted it
    assert.deepEqual(guardReset(store, root), { indexOnly: 0, allow: true });
  } finally { store.close(); rm(dir); }
});

test('guardReset on a store it cannot read refuses and says why', () => {
  const g = guardReset({ db: { prepare: () => { throw new Error('database is locked'); } } }, '/nowhere');
  assert.equal(g.allow, false);
  assert.match(g.error, /locked/);
});

test('refusalText is the sentence the reindex op and the log use', () => {
  assert.equal(refusalText(47), '47 chats exist only in this index — a reindex would delete them');
  assert.equal(refusalText(1), '1 chat exists only in this index — a reindex would delete it', 'one chat is not "1 chats"');
});
