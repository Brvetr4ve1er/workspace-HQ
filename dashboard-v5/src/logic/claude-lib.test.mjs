import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatsView, CL_PREFS_KEY } from './claude-lib.js';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const LIB = (o = {}) => ({ projects: null, convs: null, convsMore: false, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false, ...o });
const S = { clSrc: 'all', clProj: '', clSince: 'all', clQuery: '', clSearched: false, clExpanded: {} };

test('empty states say why', () => {
  assert.match(chatsView(LIB(), null, S, false, NOW).emptyText, /WorkspaceHQ app/);
  assert.match(chatsView(LIB(), { state: 'no-node', node: 'v20.0.0' }, S, true, NOW).emptyText, /Node 22\.13 or newer \(found: v20\.0\.0\)/);
  assert.match(chatsView(LIB(), { state: 'down', error: 'x' }, S, true, NOW).emptyText, /not running/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'indexing', backfill: { done: 1, total: 4 } }, S, true, NOW).emptyText, /still reading/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'ready' }, { ...S, clSrc: 'code' }, true, NOW).emptyText, /No chats match/);
  assert.match(chatsView(LIB({ convs: [] }), { state: 'ready' }, S, true, NOW).emptyText, /No Claude Code sessions indexed yet/);
  assert.equal(chatsView(LIB({ convs: [{ id: 'code:s', title: 'T', last_at: '2026-10-04T10:00:00Z', message_count: 1 }] }), { state: 'ready' }, S, true, NOW).hasRows, true);
});

test('search: hits keep markup as text parts; a no-term query explains itself', () => {
  const hits = [{ conversationId: 'code:s', messageId: 'm', title: 'T', at: '2026-10-04T10:00:00Z', snippet: '\u0002<img src=x onerror=alert(1)>\u0003' }];
  const v = chatsView(LIB({ hits, q: 'img' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW);
  assert.equal(v.hits[0].parts[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(v.hits[0].parts[0].hit, true);
  assert.match(chatsView(LIB({ noTerms: true, q: '!!!' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW).hitsText, /letters or digits/);
  assert.match(chatsView(LIB({ hits: [], q: 'zzz' }), { state: 'ready' }, { ...S, clSearched: true }, true, NOW).hitsText, /No messages contain/);
});

test('thread: tool rows collapsed unless expanded; missing chat says so', () => {
  const thread = { conversation: { id: 'code:s', title: 'T' }, hasMore: true, messages: [{ id: 'm1', role: 'tool', at: '2026-10-04T10:00:00Z', text: 'out' }] };
  assert.equal(chatsView(LIB({ thread }), { state: 'ready' }, S, true, NOW).thread.messages[0].collapsed, true);
  assert.equal(chatsView(LIB({ thread }), { state: 'ready' }, { ...S, clExpanded: { m1: true } }, true, NOW).thread.messages[0].collapsed, false);
  assert.match(chatsView(LIB({ thread: { missing: 'code:x' } }), { state: 'ready' }, S, true, NOW).thread.gone, /forgotten or no longer indexed/);
  assert.equal(CL_PREFS_KEY, 'hq-claude-lib');
});

test('a failed first load never reads as "Loading chats…"', () => {
  const v = chatsView(LIB({ convs: null, error: 'Claude Hub: hub not running' }), { state: 'ready' }, S, true, NOW);
  assert.match(v.emptyText, /Couldn’t load chats/);
  assert.equal(chatsView(LIB(), { state: 'ready' }, S, true, NOW).emptyText, 'Loading chats…');
});
