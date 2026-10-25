// Claude library (spec 2026-10-13 §9 Chats/Projects; H2). Pure view helpers + the Component mixin.
import { hubConv, hubThread, hubHit, hubProject, hubStats } from '../live/adapter.mjs';
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
    else if (!rows.length && S.clSrc === 'web' && !S.clProj && S.clSince === 'all') emptyText = 'No claude.ai chats yet — import your claude.ai data export (button above) or turn on "Sync claude.ai" in the WorkspaceHQ Bridge extension.';
    else if (!rows.length && S.clSrc === 'chatgpt' && !S.clProj && S.clSince === 'all') emptyText = 'No ChatGPT chats yet — import your ChatGPT data export (button above) or drop it in Documents\\WorkspaceHQ Imports.';
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

export function projectsView(lib, hqProjects, S) {
  const names = new Map((hqProjects || []).map((p) => [p.id, p.name]));
  const nameOf = (id) => (names.has(id) ? names.get(id) : id + ' (not in the latest scan)');
  const rows = ((lib && lib.projects) || []).map((r) => hubProject(r)).map((p) => {
    const hq = p.hqProjectId, st = p.linkState;
    const chipText = st === 'auto' ? 'Matched by path: ' + nameOf(hq) : st === 'confirmed' ? 'Linked: ' + nameOf(hq) : st === 'rejected' ? 'Unlinked' : 'Not linked';
    return { ...p, hqName: hq ? nameOf(hq) : '', chipText, canConfirm: st === 'auto', canChange: st === 'auto' || st === 'confirmed', canUnlink: st === 'auto' || st === 'confirmed', canLink: st === 'none' || st === 'rejected', picking: (S && S.clLinkPick) === p.id };
  });
  const emptyText = lib && lib.projects === null ? 'Loading projects…' : rows.length ? '' : 'No Claude Code project folders indexed yet.';
  return { rows, emptyText };
}
export function activityView(stats, hub, hasBridge, statsErr) {
  const why = hubWhy(hub, hasBridge);
  if (!stats) return { show: false, bars: [], chatsText: '', activeText: '', projects: [], emptyText: why || (statsErr ? 'Couldn’t load Claude activity · ' + statsErr : 'Loading Claude activity…') };
  const s = hubStats(stats), max = Math.max(1, ...s.days.map((d) => d.chats));
  const empty = !s.days.length;
  return { show: !empty, bars: s.days.map((d) => ({ ...d, h: Math.max(4, Math.round((d.chats / max) * 48)) + 'px', tip: d.day + ' · ' + d.chats + ' chats · ~' + d.activeMin + ' min' })),
    chatsText: s.totals.chats + ' chat' + (s.totals.chats === 1 ? '' : 's') + ' in 30 days', activeText: '~' + s.totals.activeMin + ' min active (estimate)',
    // usage has no per-turn time: a chat active in the window brings its whole token total, so the label says so
    projects: s.projects.map((p) => ({ name: p.name, chats: p.chats, tokens: p.tokens || '', hasTokens: !!p.tokens, tokensText: p.tokens ? p.tokens + ' tokens (whole chat)' : '' })),
    tokensTip: 'All tokens of each chat active in these 30 days, including turns before them (per-turn times are not recorded)',
    emptyText: empty ? why || 'No Claude chats in the last 30 days.' : '' };
}
export function pageChats(rows, now = Date.now()) { return (rows || []).slice(0, 5).map((r) => hubConv(r, now)); }

const readPrefs = () => { try { return JSON.parse(localStorage.getItem(CL_PREFS_KEY) || '{}') || {}; } catch { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(CL_PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked: filters just do not persist */ } };
export const clPrefs = () => { const p = readPrefs(); return { clSrc: ['all', 'code', 'web', 'chatgpt'].includes(p.clSrc) ? p.clSrc : 'all', clProj: typeof p.clProj === 'string' ? p.clProj : '', clSince: ['all', '7', '30'].includes(p.clSince) ? p.clSince : 'all' }; };

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
  async clLink(projectId, hqId, state) {
    if (!this.canWrite()) return this.denied();
    if (!this.hq || !this.hq.claudeHub) return;
    const ok = await this.call(() => this.hq.claudeHub.link(projectId, hqId, state));
    if (ok === null) return;
    this.setState({ clLinkPick: '' });
    this.toast('success', state === 'rejected' ? 'Unlinked — automatic matching will leave it alone' : 'Linked');
    this.clLoad();
    const by = this.LIVE.claudeLib.byHq || {};
    if (this.store.refreshClaudeForProject) for (const k of Object.keys(by)) this.store.refreshClaudeForProject(k);
  },
  clPick(projectId) { this.setState((s) => ({ clLinkPick: s.clLinkPick === projectId ? '' : projectId })); },
  async clReindex() {
    if (!this.canWrite()) return this.denied();
    if (!this.hq || !this.hq.claudeHub) return;
    const r = await this.call(() => this.hq.claudeHub.reindex());
    if (r !== null) this.toast('info', 'Reindexing — links and forgotten chats are kept');
  },
  clNewChat(project) { return this.ccNew(project && project.id ? project.id : ''); },   // H3: the in-app composer (was a terminal until H3)
};
