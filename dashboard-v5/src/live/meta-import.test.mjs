// Instagram / Facebook imports in the v5 adapter: who said a DM line, drop cards, the import report, document badges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hubThread, hubConv, dropCards, importReportLines, importView, hubDocHit } from './adapter.mjs';

test('a DM thread names the other person; the owner is You; Instagram / Facebook rows carry their labels', () => {
  const t = hubThread({ conversation: { id: 'instagram:pal_1', title: 'Placeholder Pal' }, messages: [
    { id: 'a', role: 'user', at: '2026-10-02T18:00:00Z', text: 'hi' },
    { id: 'b', role: 'other', at: '2026-10-02T18:01:00Z', text: 'hello', tool_name: 'Placeholder Pal' },
    { id: 'c', role: 'other', at: '2026-10-02T18:02:00Z', text: 'who' }] });
  assert.deepEqual(t.messages.map((m) => [m.who, m.toolName, m.tool]), [['You', null, false], ['Placeholder Pal', null, false], ['Them', null, false]]);
  assert.equal(hubConv({ id: 'facebook:x', source: 'facebook' }).sourceLabel, 'Facebook');
  assert.equal(hubDocHit({ id: 'social:instagram:posts:x:0', source: 'social', origin: 'instagram', title: 'Instagram · your posts' }).badge, 'Instagram');
});

test('drop cards and the import report speak Instagram / Facebook', () => {
  const [card] = dropCards({ found: [{ dropId: 'd1', file: 'instagram-placeholder.zip', bytes: 2048, kind: 'instagram' }] });
  assert.equal(card.kind, 'instagram');
  assert.match(card.text, /^Import Instagram export \(instagram-placeholder\.zip, /);
  const report = { source: 'facebook', owner: true, conversations: { imported: 3, unchanged: 0, forgotten: 0, skipped: 1 }, messages: { imported: 40, skipped: 0, empty: 0 },
    documents: { imported: 12, unchanged: 0, removed: 0, categories: ['your posts and check-ins', 'friends'] }, skippedFiles: { sensitive: 9, other: 4 } };
  assert.deepEqual(importReportLines(report), [
    'Conversations: 3 imported · 0 unchanged · 0 forgotten · 1 skipped',
    'Messages: 40 imported · 0 skipped · 0 empty',
    'Posts, profile and activity: 12 documents imported · 0 unchanged',
    'Read: your posts and check-ins, friends',
    'Never read: 9 files with logins, passwords, payments, contacts, devices or location',
  ]);
  assert.match(importReportLines({ ...report, owner: false }).at(-1), /Your name was not found/);
  const v = importView({ kind: 'import', phase: 'done', report }, { state: 'ready', role: 'writer' }, { hasBridge: true, canWrite: true });
  assert.equal(v.text, 'Imported 3 Facebook conversations');
  assert.equal(importView({ kind: 'import', phase: 'documents', done: 2 }, { state: 'ready', role: 'writer' }, { hasBridge: true, canWrite: true }).text, 'Reading posts, profile and activity…');
});
