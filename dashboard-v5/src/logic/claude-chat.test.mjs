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
