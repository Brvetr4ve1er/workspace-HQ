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

import { projectsView, activityView, pageChats } from './claude-lib.js';
const HQP = [{ id: 'project-a', name: 'Project A', path: 'project-a' }];
test('projectsView: chip text and actions per link state', () => {
  const lib = { projects: [
    { id: 'code:a', name: 'project-a', conversations: 2, hq_project_id: 'project-a', link_state: 'auto' },
    { id: 'code:b', name: 'project-b', conversations: 1, hq_project_id: null, link_state: 'rejected' },
    { id: 'code:c', name: 'project-c', conversations: 1, hq_project_id: 'gone', link_state: 'confirmed' },
  ] };
  const v = projectsView(lib, HQP, { clLinkPick: 'code:b' });
  const [a, b, c] = v.rows;
  assert.deepEqual([a.chipText, a.canConfirm, a.canChange, a.canUnlink], ['Matched by path: Project A', true, true, true]);
  assert.deepEqual([b.chipText, b.canConfirm, b.canLink, b.picking], ['Unlinked', false, true, true]);
  assert.equal(c.chipText, 'Linked: gone (not in the latest scan)');
  assert.match(projectsView({ projects: [] }, HQP, {}).emptyText, /No Claude Code project folders/);
});
test('activityView: estimate label, tokens only where recorded, empty says why', () => {
  const st = { days: [{ day: '2026-10-04', chats: 2, messages: 5, active_ms: 120000 }], projects: [{ project_id: 'code:a', name: 'project-a', chats: 2, tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_write: null }],
    totals: { chats: 2, active_ms: 120000, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0 } };
  const v = activityView(st, { state: 'ready' }, true);
  assert.equal(v.show, true); assert.match(v.activeText, /\(estimate\)$/);
  assert.equal(v.projects[0].hasTokens, false);
  assert.match(activityView({ days: [], projects: [], totals: { chats: 0, active_ms: 0 } }, { state: 'ready' }, true).emptyText, /No Claude chats in the last 30 days/);
  assert.match(activityView(null, { state: 'no-node', node: 'v20.1.0' }, true).emptyText, /Node 22\.13/);
});
test('pageChats keeps at most 5', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: 'code:' + i, title: 'T' + i, last_at: '2026-10-04T10:00:00Z' }));
  assert.equal(pageChats(rows, Date.parse('2026-10-05T10:00:00Z')).length, 5);
});
test('activityView: a failed load says why instead of Loading forever', () => {
  assert.match(activityView(null, { state: 'ready' }, true, 'Claude Hub: timeout').emptyText, /Couldn’t load Claude activity · Claude Hub: timeout/);
  assert.match(activityView(null, { state: 'ready' }, true).emptyText, /Loading Claude activity/);
});
test('activityView: recorded tokens are labelled whole-chat totals, not window-only (final review)', () => {
  const st = { days: [{ day: '2026-10-04', chats: 1, messages: 2, active_ms: 0 }], projects: [{ project_id: 'code:a', name: 'project-a', chats: 1, tokens_in: 10, tokens_out: 1200, tokens_cache_read: 0, tokens_cache_write: 0 }],
    totals: { chats: 1, active_ms: 0, tokens_in: 10, tokens_out: 1200, tokens_cache_read: 0, tokens_cache_write: 0 } };
  const v = activityView(st, { state: 'ready' }, true);
  assert.equal(v.projects[0].hasTokens, true);
  assert.match(v.projects[0].tokensText, /tokens \(whole chat\)$/);
  assert.match(v.tokensTip, /including turns before/);
});
test('chatsView: the claude.ai filter with no rows says how to get them (H4)', () => {
  const v = chatsView({ convs: [], hits: null, thread: null }, { state: 'ready', role: 'writer' }, { clSrc: 'web', clProj: '', clSince: 'all' }, true);
  assert.equal(v.emptyText, 'No claude.ai chats yet — import your claude.ai data export (button above) or turn on "Sync claude.ai" in the WorkspaceHQ Bridge extension.');
});
test('chatsView: claude.ai source with a time window or project chip says the filters hide rows, not that none exist (H4)', () => {
  const hub = { state: 'ready', role: 'writer' };
  const a = chatsView({ convs: [], hits: null, thread: null }, hub, { clSrc: 'web', clProj: '', clSince: '7d' }, true);
  assert.equal(a.emptyText, 'No chats match these filters.');
  const b = chatsView({ convs: [], hits: null, thread: null }, hub, { clSrc: 'web', clProj: 'project-a', clSince: 'all' }, true);
  assert.equal(b.emptyText, 'No chats match these filters.');
});
