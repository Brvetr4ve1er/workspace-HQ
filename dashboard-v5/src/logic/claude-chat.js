// dashboard-v5/src/logic/claude-chat.js — Claude Hub H3 composer (spec 2026-10-13 §8–§9).
// Pure view functions + the claudeChatLogic mixin (this = the Component). Every send is labelled
// "Uses your Claude quota"; the mode is shown on every turn and always starts Read-only.
import { chatTurnView, liveTurns } from '../live/adapter.mjs';

export const QUOTA = 'Uses your Claude quota';
export const MODE_NOTE = {
  'read-only': 'Read-only: Claude can read and answer, but not edit files or run commands',
  edits: 'Allow edits: Claude can edit files in this folder; commands are still refused',
};
const MODES = ['read-only', 'edits'];

export function pickerOptions(hqProjects, hubProjects) {
  const out = [];
  for (const p of Array.isArray(hqProjects) ? hqProjects : []) if (p && p.id) out.push({ id: p.id, label: String(p.name || p.id) });
  for (const p of Array.isArray(hubProjects) ? hubProjects : []) {
    if (p && p.source === 'code' && p.path && !p.hq_project_id) out.push({ id: p.id, label: `${p.name || p.id} · Claude Code folder` });
  }
  return out;
}

const turnsOf = (LIVE) => (LIVE && LIVE.claudeChat && Array.isArray(LIVE.claudeChat.turns) ? LIVE.claudeChat.turns : []);
export function composerTarget(S, LIVE) {
  if (S.ccConv) return S.ccConv;
  const t = S.ccTurn ? turnsOf(LIVE).find((x) => x.turnId === S.ccTurn) : null;
  return (t && t.convId) || null;
}

export function composerView(S, LIVE, { hasBridge, canWrite, writeReason, hqProjects }) {
  const lib = (LIVE && LIVE.claudeLib) || {};
  const convId = composerTarget(S, LIVE);
  const isNew = !S.ccConv;
  const thread = lib.thread && lib.thread.conversation && lib.thread.conversation.id === convId ? lib.thread : null;
  const raw = convId ? liveTurns(turnsOf(LIVE), convId, thread) : turnsOf(LIVE).filter((t) => t.turnId === S.ccTurn);
  const turns = raw.map(chatTurnView);
  const run = turns.find((t) => t.running);
  const opts = pickerOptions(hqProjects, lib.projects);
  const picked = opts.find((o) => o.id === S.ccProj);
  const needsPick = isNew && !convId;
  const text = String(S.ccText || '');
  const sendTip = !hasBridge ? 'This window has no app bridge'
    : !canWrite ? (writeReason || 'Read-only right now')
      : run ? 'A reply is still running — wait for it or press Stop'
        : S.ccSending ? 'Sending…'
          : needsPick && !picked ? 'Pick a project'
            : !text.trim() ? 'Type a message'
              : 'Send to Claude Code (uses your Claude quota)';
  const mode = MODES.includes(S.ccMode) ? S.ccMode : 'read-only';
  const tTitle = thread && thread.conversation.title;
  return {
    open: !!S.ccOpen, isNew, convId,
    title: isNew && !convId ? `New chat · ${picked ? picked.label : 'pick a project'}` : `Continue · ${tTitle || 'this chat'}`,
    text, mode, modeNote: MODE_NOTE[mode],
    picks: opts.map((o) => ({ ...o, on: o.id === S.ccProj })), needsPick,
    turns, running: !!run, runningTurnId: run ? run.id : null,
    canSend: sendTip === 'Send to Claude Code (uses your Claude quota)', sendTip, sending: !!S.ccSending, quota: QUOTA,
  };
}

export function composerRows(turns) {
  const rows = [];
  const row = (key, kind, text) => rows.push({ key, isPrompt: kind === 'prompt', isText: kind === 'text', isTool: kind === 'tool', isMeta: kind === 'meta', isError: kind === 'error', text });
  for (const t of Array.isArray(turns) ? turns : []) {
    row(t.id + ':m', 'meta', `${t.modeText} · ${t.statusText}` + (t.hasTokens ? ` · ${t.tokens} tokens` : ''));
    if (t.seededNote) row(t.id + ':s', 'meta', t.seededNote);
    row(t.id + ':p', 'prompt', t.prompt);
    for (const it of t.items) row(it.key, it.tool ? 'tool' : 'text', it.tool ? `▸ ${it.name}${it.hint ? ' ' + it.hint : ''}` : it.text);
    if (t.error) row(t.id + ':e', 'error', t.error);
  }
  return rows;
}

export const claudeChatLogic = {
  ccNew(projectId = '') {
    this.setState({ ccOpen: true, ccConv: null, ccProj: typeof projectId === 'string' ? projectId : '', ccTurn: null, ccText: '', ccMode: 'read-only' });
    // a project page is a route OVER the tab (ctx v.claude is false while route is set): go() clears it
    if (this.state.route || this.state.tab !== 'claude' || (this.state.sub && this.state.sub.claude !== 'chats')) this.go('claude', 'chats');
  },
  ccContinue() {
    const t = this.LIVE.claudeLib && this.LIVE.claudeLib.thread, c = t && t.conversation;
    if (!c || !c.id) return;
    this.setState({ ccOpen: true, ccConv: c.id, ccProj: '', ccTurn: null, ccMode: 'read-only' });
  },
  onCcText(e) { this.setState({ ccText: e && e.target ? String(e.target.value) : '' }); },
  ccSetMode(mode) { if (MODES.includes(mode)) this.setState({ ccMode: mode }); },
  ccPick(id) { this.setState({ ccProj: typeof id === 'string' ? id : '' }); },
  ccClose() { this.setState({ ccOpen: false }); },
  ccOpenThread() { const id = composerTarget(this.state, this.LIVE); if (id) this.clOpenChat(id); },
  async ccSend() {
    const S = this.state;
    const text = String(S.ccText || '');
    if (!text.trim() || S.ccSending || !this.canWrite()) return;
    const convId = composerTarget(S, this.LIVE);
    if (!convId && !S.ccProj) return;
    this.setState({ ccSending: true });
    let r;
    try {
      r = await this.store.sendClaudeChat({ conversationId: convId || undefined, projectId: S.ccProj || undefined, text, mode: MODES.includes(S.ccMode) ? S.ccMode : 'read-only' });
    } finally { this.setState({ ccSending: false }); }
    if (!r || r.error) { this.toast('error', 'Claude didn’t start · ' + ((r && r.error) || 'no answer')); return; }
    this.setState({ ccText: '', ccTurn: r.turnId, ...(convId && !S.ccConv ? { ccConv: convId } : {}) });
    if (r.seeded && r.seeded.trimmed) this.toast('info', `Copied the last ${r.seeded.chars} characters of the claude.ai chat`);
  },
  async ccStop() {
    const id = composerView(this.state, this.LIVE, { hasBridge: true, canWrite: true, writeReason: '', hqProjects: [] }).runningTurnId;
    if (!id) return;
    const ok = await this.store.cancelClaudeChat(id);
    if (!ok) this.toast('info', 'That reply had already finished');
  },
};
