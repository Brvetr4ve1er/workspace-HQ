// dashboard-v5/src/vals/claude-chat.js — Claude Hub H3 composer render values (spec §8–§9).
import { composerView, composerRows } from '../logic/claude-chat.js';

export function claudeChatVals(ctx) {
  const { S, LIVE, v, sub, projects, cantWrite, writeReason, tabStyle } = ctx;
  const onChats = !!(v && v.claude && sub === 'chats');
  const cv = composerView(S, LIVE, { hasBridge: !!(this.hq && this.hq.claudeChat), canWrite: !cantWrite, writeReason, hqProjects: projects });
  const chip = (on) => Object.assign(tabStyle(on), { height: 28 });
  const thread = LIVE && LIVE.claudeLib && LIVE.claudeLib.thread;
  const rows = composerRows(cv.turns);
  return {
    ccBarShow: onChats, ccNewChat: () => this.ccNew(''),
    ccShow: onChats && cv.open, ccIsNew: cv.isNew && !cv.convId, ccTitle: cv.title,
    ccText: cv.text, onCcText: (e) => this.onCcText(e),
    ccPicks: cv.picks.map((p) => ({ label: p.label, on: p.on, go: () => this.ccPick(p.id), style: chip(p.on) })),
    ccHasPicks: cv.picks.length > 0, ccNoPicks: 'No projects to start in yet — run a scan, or start a Claude Code session in a folder first',
    ccReadOnlyOn: cv.mode === 'read-only', ccEditsOn: cv.mode === 'edits',
    ccSetReadOnly: () => this.ccSetMode('read-only'), ccSetEdits: () => this.ccSetMode('edits'),
    ccReadOnlyStyle: chip(cv.mode === 'read-only'), ccEditsStyle: chip(cv.mode === 'edits'), ccModeNote: cv.modeNote,
    ccRows: rows, ccHasRows: rows.length > 0,
    ccSend: () => this.ccSend(), ccCantSend: !cv.canSend, ccSendTip: cv.sendTip,
    ccStop: () => this.ccStop(), ccRunning: cv.running, ccQuota: cv.quota, ccClose: () => this.ccClose(),
    ccContinue: () => this.ccContinue(), ccCanContinue: !!(thread && thread.conversation && thread.conversation.id),
    ccShowPicks: cv.showPicks, ccIsWeb: cv.isWeb, ccWebNote: cv.webNote,
    ccContinueLabel: thread && thread.conversation && (thread.conversation.source === 'web' || thread.conversation.source === 'chatgpt') ? 'Continue in Claude Code' : 'Continue',
    ccOpenThread: () => this.ccOpenThread(), ccHasConv: !!cv.convId, ccSending: cv.sending,
  };
}
