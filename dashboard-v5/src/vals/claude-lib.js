// Claude library render values (H2): Chats (+ Projects, project page, History, System in Task 10).
import { chatsView, projectsView, activityView, pageChats, hubWhy } from '../logic/claude-lib.js';

export function claudeLibVals(ctx) {
  const { S, LIVE, sub, tabStyle, projects, onPage } = ctx;
  const chip = (active, go, label) => ({ label, go, style: Object.assign(tabStyle(active), { height: 28, padding: '0 8px', fontSize: 12 }) });
  const L = LIVE.claudeLib, cv = chatsView(L, LIVE.claudeHub, S, !!this.hq);
  const projs = (L.projects || []).filter((p) => p.conversations > 0);
  const t = cv.thread;
  const pv = projectsView(L, projects, S), byHq = L.byHq || {}, pageErr = L.pageErr || {};
  const pageId = onPage && S.route ? S.route.id : '', pageProj = projects.find((p) => p.id === pageId) || null, pageRows = pageId ? pageChats(byHq[pageId]) : [];
  const hub = LIVE.claudeHub;
  return {
    isChats: sub === 'chats',
    clSrcChips: [['all', 'All'], ['code', 'Code'], ['web', 'claude.ai'], ['chatgpt', 'ChatGPT']].map(([k, l]) => chip(S.clSrc === k, () => this.clSetFilter('clSrc', k), l)),
    clSinceChips: [['all', 'Any time'], ['7', '7 days'], ['30', '30 days']].map(([k, l]) => chip(S.clSince === k, () => this.clSetFilter('clSince', k), l)),
    clProjChips: [chip(!S.clProj, () => this.clSetFilter('clProj', ''), 'All projects')].concat(projs.map((p) => chip(S.clProj === p.id, () => this.clSetFilter('clProj', p.id), p.name || p.key))),
    clQuery: S.clQuery, onClQuery: (e) => this.onClQuery(e), clSearch: () => this.clSearch(), clClearSearch: () => this.clClearSearch(),
    clSearchKey: (e) => { if (e && e.key === 'Enter') this.clSearch(); },
    clSearched: !!S.clSearched,
    clRows: cv.rows.map((r) => ({ ...r, hasTokens: !!r.tokens, open: () => this.clOpenChat(r.id), sel: !!(t && t.id === r.id) })),
    clHasRows: cv.hasRows, clMore: cv.more, clLoadMore: () => this.store.moreClaudeConvs && this.store.moreClaudeConvs(),
    clEmptyText: cv.emptyText, clShowEmpty: !cv.hasRows,
    clHits: cv.hits.map((h) => ({ ...h, open: () => this.clOpenChat(h.conversationId) })), clHasHits: cv.hasHits, clHitsText: cv.hitsText,
    clHasThread: !!(S.clOpen && t), clThread: Object.assign({ title: '', gone: '', project: '', model: null, branch: null, tokens: null, activeEst: '' }, t || {}),   // the "gone" thread has no title/model/... — every bound key must still resolve
    clThreadMsgs: t ? t.messages.map((m) => ({ ...m, toggle: () => this.clToggleTool(m.id), open: !m.collapsed, showTool: m.tool && !m.collapsed, arrow: m.collapsed ? '▸' : '▾' })) : [],
    clThreadMore: !!(t && t.hasMore), clEarlier: () => this.clEarlier(), clCloseChat: () => this.clCloseChat(),
    clForgetAsk: !!S.clForgetAsk, clForgetStart: () => this.setState({ clForgetAsk: true }), clForgetCancel: () => this.setState({ clForgetAsk: false }),
    clForget: () => this.clForget(), clTerminal: () => this.clTerminal(),
    clError: cv.error, clHasError: !!cv.error, clBusy: cv.busy,
    // Projects (link chips), project-page Claude section, History activity, System Reindex (Task 10)
    isClProjects: sub === 'projects',
    clProjRows: pv.rows.map((p) => ({ ...p,
      confirm: () => this.clLink(p.id, p.hqProjectId, 'confirmed'), unlink: () => this.clLink(p.id, null, 'rejected'), pick: () => this.clPick(p.id),
      choices: projects.map((h) => ({ label: h.name, go: () => this.clLink(p.id, h.id, 'confirmed'), style: Object.assign(tabStyle(p.hqProjectId === h.id), { height: 26, padding: '0 8px', fontSize: 12 }) })) })),
    clProjEmpty: pv.emptyText,
    clPageChats: pageRows.map((c) => ({ ...c, open: () => { this.go('claude', 'chats'); this.clOpenChat(c.id); } })),
    clPageHasChats: pageRows.length > 0,
    clPageEmpty: !pageId ? '' : byHq[pageId] === undefined ? (hubWhy(hub, !!this.hq) || (pageErr[pageId] ? 'Couldn’t load Claude chats · ' + pageErr[pageId] : 'Loading Claude chats…')) : pageRows.length ? '' : 'No Claude chats linked to this project yet — link its folder under Claude › Projects.',
    clNewChat: () => this.clNewChat(pageProj),
    clAct: activityView(L.stats, hub, !!this.hq, L.statsErr),
    clReindex: () => this.clReindex(), clCanReindex: !!(hub && hub.role === 'writer' && hub.state === 'ready'),
    clReindexTip: hub && hub.role === 'reader' ? 'Another WorkspaceHQ owns the index (read-only here)' : 'Re-read every transcript from scratch',
  };
}
