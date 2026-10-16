// Claude library render values (H2): Chats (+ Projects, project page, History, System in Task 10).
import { chatsView } from '../logic/claude-lib.js';

export function claudeLibVals(ctx) {
  const { S, LIVE, sub, tabStyle } = ctx;
  const chip = (active, go, label) => ({ label, go, style: Object.assign(tabStyle(active), { height: 28, padding: '0 8px', fontSize: 12 }) });
  const L = LIVE.claudeLib, cv = chatsView(L, LIVE.claudeHub, S, !!this.hq);
  const projs = (L.projects || []).filter((p) => p.conversations > 0);
  const t = cv.thread;
  return {
    isChats: sub === 'chats',
    clSrcChips: [['all', 'All'], ['code', 'Code'], ['web', 'claude.ai']].map(([k, l]) => chip(S.clSrc === k, () => this.clSetFilter('clSrc', k), l)),
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
  };
}
