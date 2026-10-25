// dashboard-v5/src/logic/claude-chat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerOptions, composerTarget, composerView, composerRows, claudeChatLogic, QUOTA } from './claude-chat.js';
import { chatTurnNew, chatReduce } from '../live/adapter.mjs';

const SID = '00000000-0000-4000-8000-000000000001';
const HQP = [{ id: 'project-a', name: 'Project A' }];
const HUBP = [{ id: 'code:C--placeholder-project-a', source: 'code', name: 'project-a', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a' },
  { id: 'code:C--placeholder-Desktop-project-b', source: 'code', name: 'project-b', path: 'C:\\placeholder\\Desktop\\project-b', hq_project_id: null },
  { id: 'web:p1', source: 'web', name: 'Web project', path: null, hq_project_id: null }];
const S0 = { ccOpen: true, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false };
const LIVE0 = (o = {}) => ({ claudeChat: { turns: [] }, claudeLib: { projects: HUBP, thread: null }, ...o });
const OPTS = { hasBridge: true, canWrite: true, writeReason: '', hqProjects: HQP };

test('pickerOptions: WorkspaceHQ projects, then unlinked Claude Code folders; web projects are not folders', () => {
  assert.deepEqual(pickerOptions(HQP, HUBP), [{ id: 'project-a', label: 'Project A' }, { id: 'code:C--placeholder-Desktop-project-b', label: 'project-b · Claude Code folder' }]);
  assert.deepEqual(pickerOptions(null, null), []);
});

test('composerView: the send button says why it is off, in order', () => {
  const V = (s, o = {}) => composerView({ ...S0, ...s }, LIVE0(o.live), { ...OPTS, ...o });
  assert.equal(V({}, { hasBridge: false }).sendTip, 'This window has no app bridge');
  assert.equal(V({}, { canWrite: false, writeReason: 'Viewing an old snapshot' }).sendTip, 'Viewing an old snapshot');
  assert.equal(V({}).sendTip, 'Pick a project'); assert.equal(V({}).needsPick, true);
  assert.equal(V({ ccProj: 'project-a' }).sendTip, 'Type a message');
  const ok = V({ ccProj: 'project-a', ccText: 'Hi' });
  assert.equal(ok.canSend, true); assert.equal(ok.sendTip, 'Send to Claude Code (uses your Claude quota)'); assert.equal(ok.quota, QUOTA);
  assert.equal(ok.title, 'New chat · Project A'); assert.equal(ok.modeNote, 'Read-only: Claude can read and answer, but not edit files or run commands');
  assert.equal(V({ ccProj: 'project-a', ccText: 'Hi', ccSending: true }).sendTip, 'Sending…');
  const running = chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'x', mode: 'read-only', now: 0 });
  const busy = V({ ccConv: 'code:' + SID, ccText: 'more' }, { live: { claudeChat: { turns: [running] } } });
  assert.equal(busy.sendTip, 'A reply is still running — wait for it or press Stop'); assert.equal(busy.running, true); assert.equal(busy.runningTurnId, 't1');
  assert.equal(busy.isNew, false); assert.equal(busy.needsPick, false);
});

test('composerTarget: a new chat follows its first turn into the session it created', () => {
  let t = chatTurnNew({ turnId: 't9', convId: null, prompt: 'Hi', mode: 'edits', now: 0 });
  assert.equal(composerTarget({ ...S0, ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } })), null);
  const v0 = composerView({ ...S0, ccProj: 'project-a', ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } }), OPTS);
  assert.deepEqual(v0.turns.map((x) => x.id), ['t9'], 'before the session event the turn still shows');
  t = chatReduce(t, { kind: 'session', sessionId: SID }, 1);
  assert.equal(composerTarget({ ...S0, ccTurn: 't9' }, LIVE0({ claudeChat: { turns: [t] } })), 'code:' + SID);
});

test('composerRows: mode on every turn, collapsed tool rows, errors and seed notes as their own rows', () => {
  let t = chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'Read it', mode: 'edits', seeded: { chars: 120, trimmed: false }, now: 0 });
  t = chatReduce(t, { kind: 'delta', text: 'Reading' }, 1); t = chatReduce(t, { kind: 'tool', name: 'Read', hint: 'README.md' }, 2);
  t = chatReduce(t, { kind: 'done', usage: { in: 6, out: 40 } }, 3);
  const v = composerView({ ...S0, ccConv: 'code:' + SID }, LIVE0({ claudeChat: { turns: [t] } }), OPTS);
  const rows = composerRows(v.turns);
  assert.deepEqual(rows.map((r) => [r.isMeta, r.isPrompt, r.isText, r.isTool, r.isError, r.text]), [
    [true, false, false, false, false, 'Allow edits · Done · 46 tokens'],
    [true, false, false, false, false, 'Copied the claude.ai chat (120 characters)'],
    [false, true, false, false, false, 'Read it'],
    [false, false, true, false, false, 'Reading'],
    [false, false, false, true, false, '▸ Read README.md'],
  ]);
  const e = composerRows([{ ...v.turns[0], error: 'stopped after 10 min', items: [] }]);
  assert.equal(e[e.length - 1].isError, true); assert.equal(e[e.length - 1].text, 'stopped after 10 min');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique');
});

function fakeThis(state = {}, live = LIVE0(), answer = { turnId: 't1' }) {
  const sent = [], toasts = [], cancels = [], opened = [];
  const self = {
    state: { ...S0, ...state }, LIVE: live, hq: {},
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); },
    canWrite: () => true, writeReason: () => '', toast: (k, t) => toasts.push([k, t]), go: () => {},
    clOpenChat: (id) => opened.push(id),
    store: { sendClaudeChat: async (req) => { sent.push(req); return answer; }, cancelClaudeChat: async (id) => { cancels.push(id); return false; } },
    ...claudeChatLogic,
  };
  return { self, sent, toasts, cancels, opened };
}

test('ccSend: sends exactly the target, clears the text, remembers the turn; an error is toasted', async () => {
  const a = fakeThis({ ccProj: 'project-a', ccText: 'Hello', ccMode: 'edits' });
  await a.self.ccSend();
  assert.deepEqual(a.sent, [{ conversationId: undefined, projectId: 'project-a', text: 'Hello', mode: 'edits' }]);
  assert.equal(a.self.state.ccText, ''); assert.equal(a.self.state.ccTurn, 't1'); assert.equal(a.self.state.ccSending, false);
  const b = fakeThis({ ccConv: 'code:' + SID, ccText: 'More' }, LIVE0(), { error: 'this chat already has a turn running — wait for it or press Stop' });
  await b.self.ccSend();
  assert.deepEqual(b.sent[0], { conversationId: 'code:' + SID, projectId: undefined, text: 'More', mode: 'read-only' });
  assert.deepEqual(b.toasts, [['error', 'Claude didn’t start · this chat already has a turn running — wait for it or press Stop']]);
  assert.equal(b.self.state.ccText, 'More', 'the owner’s text is kept on failure');
  const c = fakeThis({ ccText: '   ' });
  await c.self.ccSend();
  assert.equal(c.sent.length, 0);
});

test('ccSetMode / ccContinue / ccStop / ccNew', async () => {
  const live = LIVE0({ claudeLib: { projects: HUBP, thread: { conversation: { id: 'code:' + SID, source: 'code', title: 'Release planning' }, messages: [] } },
    claudeChat: { turns: [chatTurnNew({ turnId: 't1', convId: 'code:' + SID, prompt: 'x', mode: 'read-only', now: 0 })] } });
  const f = fakeThis({ ccOpen: false }, live);
  f.self.ccSetMode('bypassPermissions'); assert.equal(f.self.state.ccMode, 'read-only');
  f.self.ccSetMode('edits'); assert.equal(f.self.state.ccMode, 'edits');
  f.self.ccContinue();
  assert.equal(f.self.state.ccOpen, true); assert.equal(f.self.state.ccConv, 'code:' + SID); assert.equal(f.self.state.ccMode, 'read-only', 'every composer opens Read-only');
  await f.self.ccStop();
  assert.deepEqual(f.cancels, ['t1']); assert.deepEqual(f.toasts, [['info', 'That reply had already finished']]);
  f.self.ccNew('project-a');
  assert.equal(f.self.state.ccConv, null); assert.equal(f.self.state.ccProj, 'project-a'); assert.equal(f.self.state.ccTurn, null);
  // from a project page (a route over the Claude › Chats tab) New chat must leave the page, or the composer never shows
  const went = [], p = fakeThis({ route: { type: 'project', id: 'project-a' }, tab: 'claude', sub: { claude: 'chats' } });
  p.self.go = (...a) => went.push(a);
  p.self.ccNew('project-a');
  assert.deepEqual(went, [['claude', 'chats']]);
});

import { claudeChatVals } from '../vals/claude-chat.js';
test('claudeChatVals: composer only on Claude › Chats when open; quota label always; Send carries its reason', () => {
  const self = { hq: { claudeChat: {} }, ...claudeChatLogic, setState() {}, ccNew() {}, ccContinue() {} };
  const ctx = (S, o = {}) => ({ S: { ...S0, ...S }, LIVE: LIVE0(o.live), v: { claude: true }, sub: 'chats', projects: HQP, cantWrite: false, writeReason: '', tabStyle: (on) => ({ color: on ? 'on' : 'off' }), ...o.ctx });
  const closed = claudeChatVals.call(self, ctx({ ccOpen: false }));
  assert.equal(closed.ccShow, false); assert.equal(closed.ccBarShow, true); assert.equal(closed.ccQuota, 'Uses your Claude quota');
  const open = claudeChatVals.call(self, ctx({ ccOpen: true, ccProj: 'project-a', ccText: 'Hi' }));
  assert.equal(open.ccShow, true); assert.equal(open.ccIsNew, true); assert.equal(open.ccCantSend, false);
  assert.equal(open.ccReadOnlyOn, true); assert.equal(open.ccEditsOn, false);
  assert.deepEqual(open.ccPicks.map((p) => [p.label, p.on]), [['Project A', true], ['project-b · Claude Code folder', false]]);
  assert.equal(claudeChatVals.call(self, ctx({ ccOpen: true }, { ctx: { sub: 'sessions' } })).ccShow, false);
  assert.equal(claudeChatVals.call(self, ctx({ ccOpen: true }, { ctx: { v: { claude: false } } })).ccBarShow, false);
  const nob = claudeChatVals.call({ ...self, hq: null }, ctx({ ccOpen: true, ccProj: 'project-a', ccText: 'Hi' }));
  assert.equal(nob.ccCantSend, true); assert.equal(nob.ccSendTip, 'This window has no app bridge');
});

test('composerView: a claude.ai chat continues in Claude Code — picker shown, pick required without a link (H4)', () => {
  const web = { conversation: { id: 'web:web-chat-1', source: 'web', title: 'Release planning (web)', project_id: 'web:web-proj-1' }, messages: [], hasMore: false };
  const lib = (linked) => ({ thread: web, projects: [{ id: 'web:web-proj-1', source: 'web', hq_project_id: linked ? 'project-a' : null }] });
  const S = { ccOpen: true, ccConv: 'web:web-chat-1', ccProj: '', ccText: 'Go on', ccMode: 'read-only', ccTurn: null, ccSending: false };
  const opts = { hasBridge: true, canWrite: true, writeReason: '', hqProjects: [{ id: 'project-a', name: 'Project A' }] };
  const v = composerView(S, { claudeLib: lib(false), claudeChat: { turns: [] } }, opts);
  assert.deepEqual([v.isWeb, v.showPicks, v.needsPick, v.sendTip], [true, true, true, 'Pick a project']);
  assert.equal(v.title, 'Continue in Claude Code · Release planning (web)');
  assert.match(v.webNote, /NEW Claude Code chat .* last 30 000 characters/);
  assert.equal(composerView({ ...S, ccProj: 'project-a' }, { claudeLib: lib(false), claudeChat: { turns: [] } }, opts).canSend, true);
  const linked = composerView(S, { claudeLib: lib(true), claudeChat: { turns: [] } }, opts);
  assert.deepEqual([linked.needsPick, linked.canSend], [false, true]);
  const code = composerView({ ...S, ccConv: 'code:sess-a1' }, { claudeLib: { thread: { conversation: { id: 'code:sess-a1', source: 'code', title: 't' }, messages: [] }, projects: [] }, claudeChat: { turns: [] } }, opts);
  assert.deepEqual([code.isWeb, code.showPicks, code.webNote], [false, false, '']);
});

test('ccSend from a claude.ai chat then follows the NEW Code chat — a second send never re-seeds a fresh chat (H4)', async () => {
  const sent = [];
  const self = { ...claudeChatLogic,
    state: { ccOpen: true, ccConv: 'web:web-chat-1', ccProj: 'project-a', ccText: 'Go on', ccMode: 'read-only', ccTurn: null, ccSending: false },
    LIVE: { claudeLib: {}, claudeChat: { turns: [] } }, canWrite: () => true, toast: () => {},
    setState(p) { Object.assign(this.state, p); },
    store: { sendClaudeChat: async (a) => { sent.push(a); return { turnId: 't1' }; } } };
  await self.ccSend();
  assert.deepEqual([sent[0].conversationId, sent[0].projectId], ['web:web-chat-1', 'project-a']);
  assert.deepEqual([self.state.ccConv, self.state.ccTurn], [null, 't1'], 'composerTarget now follows the turn (code:<session> once its session event lands)');
  const code = { ...self, state: { ...self.state, ccConv: 'code:sess-a1', ccText: 'more', ccTurn: null } };
  await code.ccSend();
  assert.equal(code.state.ccConv, 'code:sess-a1', 'a Code chat keeps its target');
});

// ---- Claude Hub H4: claude.ai export import (counts only — the report never holds chat text)
export function importReportLines(r) {
  if (!r || typeof r !== 'object') return [];
  const c = obj(r.conversations), m = obj(r.messages), p = obj(r.projects);
  const lines = [
    `Chats: ${num(c.imported, 0)} imported · ${num(c.unchanged, 0)} unchanged · ${num(c.forgotten, 0)} forgotten · ${num(c.skipped, 0)} skipped`,
    `Messages: ${num(m.imported, 0)} imported · ${num(m.skipped, 0)} skipped · ${num(m.empty, 0)} empty`,
    `Projects: ${num(p.imported, 0)} imported · ${num(p.unchanged, 0)} unchanged · ${num(p.skipped, 0)} skipped`,
  ];
  const u = Object.entries(obj(r.unknownFields)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (u.length) lines.push('Not understood (counted, not imported): ' + u.slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(', ') + (u.length > 5 ? `, +${u.length - 5} more` : ''));
  if (r.truncated) lines.push('The export file ended early — what came before the cut was imported.');
  return lines;
}

const IMPORT_PHASE = { unzip: 'Unpacking the export…', projects: 'Reading claude.ai Projects…', conversations: 'Reading chats…' };
export function importView(imp, hub, { hasBridge, canWrite, writeReason } = {}) {
  const cur = imp && imp.kind === 'import' ? imp : null;
  const ended = !!cur && (cur.phase === 'done' || cur.phase === 'failed');
  const running = (!!cur && !ended) || (!!hub && !!hub.importing && !ended);
  const why = !hasBridge ? 'Importing needs the WorkspaceHQ app — this preview has no app bridge.'
    : !hub || ['no-node', 'down', 'starting'].includes(hub.state) ? 'The Claude Hub is not running — import is unavailable.'
      : hub.role === 'reader' ? 'Another WorkspaceHQ window owns the Claude index — import from that one.'
        : !canWrite ? (writeReason || 'Read-only right now')
          : running ? 'An import is running.' : '';
  let text = '', tone = 'muted', report = [];
  if (running) {
    text = (cur && IMPORT_PHASE[cur.phase]) || 'Importing…';
    if (cur && cur.phase === 'conversations' && num(cur.done, 0)) text += ` ${num(cur.done, 0)} read`;
  } else if (cur && cur.phase === 'failed') { text = 'Import failed: ' + String(cur.error || 'unknown error'); tone = 'error'; }
  else {
    const last = cur && cur.phase === 'done' ? { ok: true, report: cur.report, at: null } : hub && hub.lastImport ? hub.lastImport : null;
    if (last && last.ok) {
      const c = obj(obj(last.report).conversations), day = last.at ? ` (${String(last.at).slice(0, 10)})` : '';
      const n = num(c.imported, 0), u = num(c.unchanged, 0);
      text = n ? `Imported ${n} chat${n === 1 ? '' : 's'}${day}` : u ? `Nothing new — ${u} chat${u === 1 ? ' was' : 's were'} already imported${day}` : 'No chats found in that export';
      tone = 'ok'; report = importReportLines(last.report);
    } else if (last) { text = 'Last import failed: ' + String(last.error || 'unknown error'); tone = 'error'; }
  }
  return { canImport: !why, why, running, text, tone, report, hasReport: report.length > 0 };
}
