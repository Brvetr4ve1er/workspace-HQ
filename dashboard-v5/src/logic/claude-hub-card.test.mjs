// dashboard-v5/src/logic/claude-hub-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubCard } from './claude-hub.js';

test('every hub state reads honestly', () => {
  assert.deepEqual(hubCard(null, false), { show: false, state: '', color: 'var(--muted)', detail: '', size: '', bar: false, barW: '0%' });
  assert.equal(hubCard(null, true).state, 'Starting…');
  const idx = hubCard({ state: 'indexing', backfill: { done: 8, total: 32 }, counts: { projects: 3, conversations: 40, messages: 900 }, dbBytes: 5 * 1048576 }, true);
  assert.equal(idx.state, 'Indexing 8 of 32 sessions'); assert.equal(idx.bar, true); assert.equal(idx.barW, '25%'); assert.equal(idx.size, '5.0 MB');
  const ok = hubCard({ state: 'ready', role: 'writer', counts: { projects: 3, conversations: 40, messages: 900 }, dbBytes: 2048 }, true);
  assert.equal(ok.state, 'Indexed'); assert.equal(ok.detail, '40 chats · 3 projects · 900 messages'); assert.equal(ok.color, 'var(--green)');
  assert.equal(hubCard({ state: 'ready', role: 'reader', counts: { projects: 0, conversations: 0, messages: 0 } }, true).detail,
    'Read-only — another WorkspaceHQ window owns the index · nothing indexed yet');
  assert.equal(hubCard({ state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.13 or newer (found v20.1.0)' }, true).state, 'Needs Node 22.13 or newer (found v20.1.0)');
  assert.equal(hubCard({ state: 'down', error: 'Claude Hub exited (1)' }, true).detail, 'Claude Hub exited (1)');
});

// A first backfill: the health() answer predates the pass (zero counts) and the counts are only re-pulled when it ends.
// "nothing indexed yet" next to "Indexing 20 of 32 sessions" would be a false empty-state claim.
test('indexing with zero counts does not claim "nothing indexed yet" once sessions have been read', () => {
  const zero = { projects: 0, conversations: 0, messages: 0 };
  const mid = hubCard({ state: 'indexing', backfill: { done: 20, total: 32 }, counts: zero }, true);
  assert.equal(mid.state, 'Indexing 20 of 32 sessions');
  assert.equal(mid.detail, 'counts appear when indexing finishes');
  assert.equal(mid.bar, true); assert.equal(mid.barW, '63%');
  // a progress event that arrived before any counts were known (health answered "starting"): no `counts` key at all
  assert.equal(hubCard({ state: 'indexing', backfill: { done: 20, total: 32 } }, true).detail, 'counts appear when indexing finishes');
  // nothing read yet: zero counts are accurate, and the state line says why
  const fresh = hubCard({ state: 'indexing', backfill: { done: 0, total: 32 }, counts: zero }, true);
  assert.equal(fresh.state, 'Indexing 0 of 32 sessions'); assert.equal(fresh.detail, 'nothing indexed yet');
  assert.equal(hubCard({ state: 'indexing', backfill: { done: 0, total: 0 }, counts: zero }, true).detail, 'nothing indexed yet');
  // an index that already holds data (a re-launch, a reindex) keeps showing its numbers
  assert.equal(hubCard({ state: 'indexing', backfill: { done: 20, total: 32 }, counts: { projects: 3, conversations: 40, messages: 900 } }, true).detail,
    '40 chats · 3 projects · 900 messages');
  // once the pass ends the counts are real again, zero included
  assert.equal(hubCard({ state: 'ready', role: 'writer', counts: zero }, true).detail, 'nothing indexed yet');
});
