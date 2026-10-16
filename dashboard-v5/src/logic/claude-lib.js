// Claude library (spec 2026-10-13 §9 Chats/Projects; H2). Pure view helpers + the Component mixin.
import { hubConv, hubThread, hubHit } from '../live/adapter.mjs';
import { TERM_SKIPPED } from './project.js';

export const CL_PREFS_KEY = 'hq-claude-lib';
const SINCE_DAYS = { '7': 7, '30': 30 };

export function hubWhy(hub, hasBridge) {
  if (!hasBridge) return 'Chats live in the WorkspaceHQ app — this preview has no app bridge.';
  if (!hub) return 'Asking the Claude Hub…';
  if (hub.state === 'no-node') return 'Claude Hub needs Node 22.13 or newer (found: ' + (hub.node || 'none') + ').';
  if (hub.state === 'down' || hub.state === 'starting') return 'The Claude Hub is not running' + (hub.error ? ' (' + hub.error + ')' : '') + ' — lists show the last loaded data.';
  return null;
}

export function chatsView(lib, hub, S, hasBridge, now = Date.now()) {
  const L = lib || {};
  const filtered = S.clSrc !== 'all' || !!S.clProj || S.clSince !== 'all';
  const rows = (L.convs || []).map((r) => hubConv(r, now));
  let emptyText = hubWhy(hub, hasBridge);
  if (!emptyText) {
    if (L.convs === null) emptyText = L.error ? 'Couldn’t load chats — the Hub answered with an error (shown below). It retries when the Hub reports ready; changing a filter retries too.' : 'Loading chats…';
    else if (!rows.length && hub && hub.state === 'indexing') emptyText = 'The Hub is still reading your transcripts (' + ((hub.backfill && hub.backfill.done) || 0) + ' of ' + ((hub.backfill && hub.backfill.total) || '?') + ' files).';
    else if (!rows.length && filtered) emptyText = 'No chats match these filters.';
    else if (!rows.length) emptyText = 'No Claude Code sessions indexed yet — the Hub reads ~/.claude/projects.';
  }
  const hits = (L.hits || []).map((h) => hubHit(h, now));
  const hitsText = !S.clSearched ? '' : L.noTerms ? 'Search needs letters or digits — punctuation alone matches nothing.'
    : L.hits && !hits.length ? 'No messages contain “' + L.q + '”.' : L.hits ? hits.length + ' message' + (hits.length === 1 ? '' : 's') + ' (best matches first)' : '';
  let thread = null;
  if (L.thread && L.thread.missing) thread = { gone: 'This chat was forgotten or no longer indexed.', messages: [] };
  else if (L.thread) {
    const t = hubThread(L.thread, now);
    thread = t && { ...t, gone: '', messages: t.messages.map((m) => ({ ...m, collapsed: m.tool && !(S.clExpanded || {})[m.id] })) };
  }
  return { rows, hasRows: rows.length > 0, more: !!L.convsMore, emptyText: rows.length ? '' : emptyText || '', hits, hasHits: hits.length > 0, hitsText, thread, error: L.error || '', busy: !!L.busy };
}

const readPrefs = () => { try { return JSON.parse(localStorage.getItem(CL_PREFS_KEY) || '{}') || {}; } catch { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(CL_PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked: filters just do not persist */ } };
export const clPrefs = () => { const p = readPrefs(); return { clSrc: ['all', 'code', 'web'].includes(p.clSrc) ? p.clSrc : 'all', clProj: typeof p.clProj === 'string' ? p.clProj : '', clSince: ['all', '7', '30'].includes(p.clSince) ? p.clSince : 'all' }; };

export const claudeLibLogic = {
  clFilters(S = this.state) {
    const f = {};
    if (S.clSrc !== 'all') f.source = S.clSrc;
    if (S.clProj) f.projectId = S.clProj;
    if (SINCE_DAYS[S.clSince]) f.since = new Date(Date.now() - SINCE_DAYS[S.clSince] * 86400000).toISOString();
    return f;
  },
  clLoad() { if (this.store.refreshClaudeLib) this.store.refreshClaudeLib(this.clFilters()); },
  clSetFilter(key, value) {
    this.setState({ [key]: value }, () => { const S = this.state; writePrefs({ clSrc: S.clSrc, clProj: S.clProj, clSince: S.clSince }); this.clLoad(); });
  },
  onClQuery(e) { this.setState({ clQuery: e && e.target ? e.target.value : '' }); },
  clSearch() { this.setState({ clSearched: true }); return this.store.searchClaude && this.store.searchClaude(this.state.clQuery); },
  clClearSearch() { this.setState({ clQuery: '', clSearched: false }); return this.store.searchClaude && this.store.searchClaude(''); },
  clOpenChat(id) { this.setState({ clOpen: true, clExpanded: {}, clForgetAsk: false }); return this.store.openClaudeThread && this.store.openClaudeThread(id); },
  clCloseChat() { this.setState({ clOpen: false, clForgetAsk: false }); if (this.store.closeClaudeThread) this.store.closeClaudeThread(); },
  clEarlier() { return this.store.earlierClaudeThread && this.store.earlierClaudeThread(); },
  clToggleTool(id) { this.setState((s) => ({ clExpanded: { ...s.clExpanded, [id]: !s.clExpanded[id] } })); },
  async clForget() {
    const t = this.LIVE.claudeLib.thread, id = t && t.conversation && t.conversation.id;
    if (!this.canWrite()) return this.denied();   // same write gate as every other action (time machine / no bridge)
    if (!id || !this.hq || !this.hq.claudeHub) return;
    const ok = await this.call(() => this.hq.claudeHub.forget({ conversationId: id }));
    if (ok === null) return;   // call() already toasted the reason
    this.toast('success', 'Forgotten — removed from the index; the transcript on disk is untouched');
    this.clCloseChat(); this.clLoad();
  },
  // "Open in terminal" (spec §9: the existing path): same guards as questTerminal (logic/project.js) — a click never
  // leaves an unhandled rejection, a refusal says why. Empty prompt: claude opens idle in the chat's folder.
  // One guarded path for every terminal this library opens (Task 10's clNewChat uses it too).
  async clTermAt(dir, noDir) {
    if (!this.canWrite()) return this.denied();
    if (!dir) return this.denied(noDir);
    if (!this.hq || !this.hq.claudeQuest) return this.denied('This window can’t open a terminal');
    let ok;
    try { ok = await this.claudeTerminal(dir, ''); }
    catch (e) { this.toast('error', 'Couldn’t open a terminal · ' + String((e && e.message) || e)); return; }
    if (ok === TERM_SKIPPED) return;
    if (ok === false) this.toast('error', 'Couldn’t open a terminal · the folder wasn’t accepted (main opens only folders under Documents)');
  },
  clTerminal() {
    const t = this.LIVE.claudeLib.thread, c = t && t.conversation;
    return this.clTermAt(c && c.cwd, 'This chat has no recorded folder');
  },
};
