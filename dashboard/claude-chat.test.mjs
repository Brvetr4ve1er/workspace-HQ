// dashboard/claude-chat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { MODES, FORBIDDEN_ARGS, buildArgs, isSessionId, cwdRefusal, seedPrompt, SEED_MAX } = require('./claude-chat.js');

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BASE = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none', '--permission-mode'];

test('buildArgs: exact argv per mode, resume only with a UUID', () => {
  assert.deepEqual(buildArgs({ mode: 'read-only' }), [...BASE, 'plan']);
  assert.deepEqual(buildArgs({ mode: 'edits' }), [...BASE, 'acceptEdits']);
  assert.deepEqual(buildArgs({ mode: 'read-only', sessionId: SID }), [...BASE, 'plan', '--resume', SID]);
  for (const bad of ['x" & calc', 'abc', `${SID} --dangerously-skip-permissions`, `${SID}\n`, '../x', '']) {
    assert.throws(() => buildArgs({ mode: 'read-only', sessionId: bad }), /bad session id/, JSON.stringify(bad));
  }
});

test('never bypass: only plan/acceptEdits exist, every other mode is refused, no forbidden token in any argv', () => {
  assert.deepEqual(Object.values(MODES).sort(), ['acceptEdits', 'plan']);
  assert.ok(Object.isFrozen(MODES));
  for (const m of ['bypassPermissions', 'auto', 'dontAsk', 'manual', 'plan', 'acceptEdits', '__proto__', 'constructor', 'toString', '', null, undefined]) {
    assert.throws(() => buildArgs({ mode: m }), /unknown mode/, String(m));
  }
  for (const mode of Object.keys(MODES)) for (const sessionId of [null, SID]) {
    const argv = buildArgs({ mode, sessionId });
    for (const f of FORBIDDEN_ARGS) assert.ok(!argv.some((a) => a.includes(f)), `${mode}/${sessionId} carries ${f}`);
    assert.equal(argv[argv.indexOf('--permission-prompts') + 1], 'none');
  }
});

test('isSessionId: UUID shape only', () => {
  assert.equal(isSessionId(SID), true);
  assert.equal(isSessionId(SID.toUpperCase()), true);
  for (const s of [null, 42, '', 'sess-a1', SID + 'x', ' ' + SID, SID.replace(/-/g, '')]) assert.equal(isSessionId(s), false, String(s));
});

test('cwdRefusal: deny list (drive roots, Windows, Program Files, the profile root itself)', { skip: process.platform !== 'win32' && 'win32 paths' }, () => {
  const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramW6432: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\placeholder' };
  const cases = [
    ['C:\\', 'a drive root'], ['D:\\', 'a drive root'], ['c:', 'not an absolute folder'], ['relative\\dir', 'not an absolute folder'], ['', 'not an absolute folder'], [null, 'not an absolute folder'],
    ['C:\\Windows', 'the Windows folder'], ['c:\\windows\\system32', 'the Windows folder'],
    ['C:\\Program Files\\x', 'Program Files'], ['C:\\Program Files (x86)', 'Program Files'],
    ['C:\\Users\\placeholder', 'your user folder itself'], ['C:\\Users\\PLACEHOLDER\\', 'your user folder itself'],
    ['\\\\server\\share\\x', 'a network or device path'], ['\\\\?\\C:\\x', 'a network or device path'],
    ['C:\\Users\\placeholder\\Documents\\project-a', null], ['C:\\Users\\placeholder\\Desktop\\project-b', null], ['C:\\Windowsish\\x', null], ['D:\\work\\project-c', null],
  ];
  for (const [dir, want] of cases) assert.equal(cwdRefusal(dir, env), want, JSON.stringify(dir));
});

test('seedPrompt: header, last 30 000 chars, surrogate-safe, message last', () => {
  const s = seedPrompt({ title: 'Release planning', text: 'short chat', message: 'Go on' });
  assert.equal(s.trimmed, false); assert.equal(s.chars, 10);
  assert.equal(s.prompt, 'Context: a claude.ai conversation titled "Release planning", copied into Claude Code by WorkspaceHQ\n\nshort chat\n\n---\n\nGo on');
  const t = seedPrompt({ title: '', text: 'A'.repeat(SEED_MAX) + 'B'.repeat(10), message: 'm' });
  assert.equal(t.trimmed, true); assert.equal(t.chars, SEED_MAX);
  assert.match(t.prompt, /^Context: a claude\.ai conversation titled "Untitled chat", copied into Claude Code by WorkspaceHQ \(trimmed to its last 30000 characters\)\n\n/);
  assert.ok(t.prompt.endsWith('B'.repeat(10) + '\n\n---\n\nm'));
  const u = seedPrompt({ title: 't', text: '🚀'.repeat(SEED_MAX) + 'x', message: 'm' });   // the cut lands at an odd offset inside the run: a naive cut starts on a low surrogate
  assert.equal(/^[\uDC00-\uDFFF]/.test(u.prompt.split('\n\n')[1]), false, 'no lone low surrogate at the cut');
  assert.equal(u.chars, SEED_MAX - 1, 'the half pair was dropped');
});

// append to dashboard/claude-chat.test.mjs
const { resolveTarget, PROMPT_MAX } = require('./claude-chat.js');
const ENV = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\placeholder' };
const DOCS_A = 'C:\\Users\\placeholder\\Documents\\project-a';
const DESK_B = 'C:\\Users\\placeholder\\Desktop\\project-b';
const SID2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
function fakeHub(convs = {}, projects = []) {
  const calls = [];
  const hub = async (op, args) => {
    calls.push([op, args]);
    if (op === 'getConversation') return convs[args.id] || null;
    if (op === 'listProjects') return projects.filter((p) => !args.source || p.source === args.source);
    return { error: 'unknown op' };
  };
  return { hub, calls };
}
const conv = (row, messages = []) => ({ conversation: row, messages, hasMore: false });
const deps = (h, dirs = [DOCS_A, DESK_B], hq = [{ id: 'project-a', name: 'Project A', path: DOCS_A }]) =>
  ({ hub: h.hub, getProjects: () => hq, isDir: (p) => dirs.includes(p), env: ENV });
const win = { skip: process.platform !== 'win32' && 'win32 paths' };

test('resolveTarget: input checks come first and spawn nothing', async () => {
  const h = fakeHub();
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: '  ', mode: 'read-only' }, deps(h)), { error: 'empty message' });
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'x'.repeat(PROMPT_MAX + 1), mode: 'read-only' }, deps(h)), { error: 'message is over 100000 characters' });
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'hi', mode: 'bypassPermissions' }, deps(h)), { error: 'unknown mode' });
  assert.deepEqual(await resolveTarget({ text: 'hi', mode: 'read-only' }, deps(h)), { error: 'pick a project or a chat' });
  assert.equal(h.calls.length, 0);
});

test('resolveTarget: continue a Code chat in its recorded folder — a Desktop folder the Hub recorded is allowed', win, async () => {
  const h = fakeHub({ ['code:' + SID2]: conv({ id: 'code:' + SID2, source: 'code', native_id: SID2, cwd: DESK_B, title: 'Fix the café bug' }) });
  assert.deepEqual(await resolveTarget({ conversationId: 'code:' + SID2, text: 'go on', mode: 'edits' }, deps(h)),
    { cwd: DESK_B, sessionId: SID2, key: 'code:' + SID2, prompt: 'go on', seeded: null });
});

test('resolveTarget: hostile ids and folders never reach argv or cwd; the deny list beats "recorded"', win, async () => {
  const rows = {
    'code:evil': conv({ id: 'code:evil', source: 'code', native_id: 'x" & calc', cwd: DOCS_A }),
    'code:root': conv({ id: 'code:root', source: 'code', native_id: SID2, cwd: 'C:\\' }),
    'code:sys': conv({ id: 'code:sys', source: 'code', native_id: SID2, cwd: 'C:\\Windows\\System32' }),
    'code:home': conv({ id: 'code:home', source: 'code', native_id: SID2, cwd: 'C:\\Users\\placeholder' }),
    'code:gone': conv({ id: 'code:gone', source: 'code', native_id: SID2, cwd: 'C:\\Users\\placeholder\\Documents\\deleted' }),
  };
  const h = fakeHub(rows, [{ id: 'code:C--Windows', source: 'code', path: 'C:\\Windows' }]);
  const R = (req) => resolveTarget({ text: 'hi', mode: 'read-only', ...req }, deps(h));
  assert.deepEqual(await R({ conversationId: 'code:x" & calc' }), { error: 'that chat is not in the index (forgotten, or not indexed yet)' });
  assert.deepEqual(await R({ conversationId: 'code:evil' }), { error: 'this chat has no resumable Claude Code session id' });
  assert.deepEqual(await R({ conversationId: 'code:root' }), { error: 'refused folder (a drive root)' });
  assert.deepEqual(await R({ conversationId: 'code:sys' }), { error: 'refused folder (the Windows folder)' });
  assert.deepEqual(await R({ conversationId: 'code:home' }), { error: 'refused folder (your user folder itself)' });
  assert.deepEqual(await R({ conversationId: 'code:gone' }), { error: 'the folder no longer exists' });
  assert.deepEqual(await R({ projectId: 'code:..\\..\\Windows' }), { error: 'unknown Claude Code project' });
  assert.deepEqual(await R({ projectId: 'code:C--Windows' }), { error: 'refused folder (the Windows folder)' });
  assert.deepEqual(await R({ projectId: '..\\..\\Windows' }), { error: 'unknown WorkspaceHQ project, or its folder is outside Documents' });
  assert.deepEqual(await R({ projectId: 42 }), { error: 'pick a project or a chat' });
});

test('resolveTarget: new chats — WorkspaceHQ id or Hub code project; a Hub error surfaces', win, async () => {
  const h = fakeHub({}, [{ id: 'code:C--placeholder-Desktop-project-b', source: 'code', path: DESK_B }]);
  assert.deepEqual(await resolveTarget({ projectId: 'project-a', text: 'hi', mode: 'read-only' }, deps(h)),
    { cwd: DOCS_A, sessionId: null, key: null, prompt: 'hi', seeded: null });
  assert.deepEqual(await resolveTarget({ projectId: 'code:C--placeholder-Desktop-project-b', text: 'hi', mode: 'read-only' }, deps(h)),
    { cwd: DESK_B, sessionId: null, key: null, prompt: 'hi', seeded: null });
  const down = { hub: async () => ({ error: 'hub not running' }), getProjects: () => [], isDir: () => true, env: ENV };
  assert.deepEqual(await resolveTarget({ conversationId: 'code:' + SID2, text: 'hi', mode: 'read-only' }, down), { error: 'Claude Hub: hub not running' });
});

test('resolveTarget: a claude.ai chat starts a NEW Code chat in the linked project, seeded', win, async () => {
  const web = conv({ id: 'web:w1', source: 'web', project_id: 'web:p1', native_id: 'w1', title: 'Release planning', cwd: null },
    [{ role: 'user', text: 'Plan the release' }, { role: 'assistant', text: 'Here is a plan' }]);
  const h = fakeHub({ 'web:w1': web }, [{ id: 'web:p1', source: 'web', path: null, hq_project_id: 'project-a' }]);
  const r = await resolveTarget({ conversationId: 'web:w1', text: 'Continue here', mode: 'read-only' }, deps(h));
  assert.equal(r.cwd, DOCS_A); assert.equal(r.sessionId, null); assert.equal(r.key, 'web:w1');
  assert.deepEqual(r.seeded, { chars: 'Owner: Plan the release\n\nClaude: Here is a plan'.length, trimmed: false });
  assert.equal(r.prompt, 'Context: a claude.ai conversation titled "Release planning", copied into Claude Code by WorkspaceHQ\n\nOwner: Plan the release\n\nClaude: Here is a plan\n\n---\n\nContinue here');
  const unlinked = fakeHub({ 'web:w1': web }, [{ id: 'web:p1', source: 'web', path: null, hq_project_id: null }]);
  assert.deepEqual(await resolveTarget({ conversationId: 'web:w1', text: 'x', mode: 'read-only' }, deps(unlinked)),
    { error: 'link this claude.ai project to a WorkspaceHQ project first (Claude › Projects)' });
  const picked = await resolveTarget({ conversationId: 'web:w1', projectId: 'project-a', text: 'x', mode: 'read-only' }, deps(unlinked));
  assert.equal(picked.cwd, DOCS_A, 'a project picked in the composer wins over a missing link');
});

// append to dashboard/claude-chat.test.mjs
import { EventEmitter } from 'node:events';
const { createChat, resolveClaudeBin, EVENT } = require('./claude-chat.js');

function fakeSpawn() {
  const kids = [];
  let pid = 1000;
  const spawnFn = (cmd, args, opts) => {
    const k = new EventEmitter();
    k.pid = ++pid; k.cmd = cmd; k.args = args; k.opts = opts; k.stdinText = ''; k.stdinEnded = false;
    k.stdin = Object.assign(new EventEmitter(), { write: (s) => { k.stdinText += s; return true; }, end: () => { k.stdinEnded = true; } });
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter();
    k.out = (...lines) => k.stdout.emit('data', Buffer.from(lines.map((l) => JSON.stringify(l)).join('\r\n') + '\r\n'));
    kids.push(k);
    return k;
  };
  return { kids, spawnFn };
}
function rig(o = {}) {
  const sp = fakeSpawn(), pushed = [], killed = [], logs = [];
  const target = o.target || ((req) => ({ cwd: DOCS_A, sessionId: req.conversationId ? SID2 : null, key: req.conversationId || null, prompt: req.text, seeded: null }));
  const c = createChat({ resolve: async (req) => target(req), bin: () => (o.bin === undefined ? { cmd: 'C:\\fake\\claude.cmd', viaCmd: true } : o.bin),
    spawnFn: sp.spawnFn, kill: (pid) => killed.push(pid), send: (ch, d) => pushed.push([ch, d]), log: { error: (n, m) => logs.push([n, m]) },
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, turnMs: o.turnMs || 60000, maxTurns: 3, graceMs: o.graceMs || 5000 });
  const ev = (turnId) => pushed.filter(([ch, d]) => ch === EVENT && d.turnId === turnId).map(([, d]) => d);
  return { c, ...sp, pushed, killed, logs, ev };
}
const tick = () => new Promise((r) => setImmediate(r));
const SESSION = { type: 'system', subtype: 'init', session_id: SID2 };
const D = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const RESULT = { type: 'result', subtype: 'success', is_error: false, session_id: SID2, result: 'Hi there', usage: { input_tokens: 1, output_tokens: 2 } };

test('runner: argv through cmd.exe, prompt on stdin, events in order, one done', async () => {
  const r = rig();
  const res = await r.c.send({ projectId: 'project-a', text: 'Say hi', mode: 'read-only' });
  assert.match(res.turnId, /^ct-/); assert.equal(res.sessionId, undefined);
  const k = r.kids[0];
  assert.equal(k.cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(k.args, ['/d', '/v:off', '/s', '/c', '""C:\\fake\\claude.cmd" ' + buildArgs({ mode: 'read-only' }).join(' ') + '"']);
  assert.equal(k.opts.windowsVerbatimArguments, true); assert.equal(k.opts.cwd, DOCS_A); assert.equal(k.opts.windowsHide, true);
  assert.equal(k.stdinText, 'Say hi'); assert.equal(k.stdinEnded, true);
  k.out(SESSION, D('Hi'), D(' there'), { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there' }] } }, RESULT);
  k.emit('close', 0); k.emit('close', 0);
  k.out(D('late'));
  assert.deepEqual(r.ev(res.turnId).map((e) => e.kind), ['session', 'delta', 'delta', 'done']);
  assert.deepEqual(r.ev(res.turnId)[3], { turnId: res.turnId, kind: 'done', sessionId: SID2, mode: 'read-only', usage: { in: 1, out: 2, cacheRead: 0, cacheWrite: 0 }, isError: false, subtype: 'success', result: '', stopped: false });
  assert.equal(r.c.running(), 0);
});

test('runner: a direct .exe is spawned without a shell; a resumed turn reports its session at once', async () => {
  const r = rig({ bin: { cmd: 'C:\\fake\\claude.exe', viaCmd: false } });
  const res = await r.c.send({ conversationId: 'code:' + SID2, text: 'more', mode: 'edits' });
  assert.equal(res.sessionId, SID2);
  assert.equal(r.kids[0].cmd, 'C:\\fake\\claude.exe');
  assert.deepEqual(r.kids[0].args, buildArgs({ mode: 'edits', sessionId: SID2 }));
  assert.equal(r.kids[0].opts.windowsVerbatimArguments, undefined);
});

test('runner: Stop mid-tool kills the tree once and ends with done{stopped}; cancel twice is false', async () => {
  const r = rig();
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'Read the readme', mode: 'read-only' });
  const k = r.kids[0];
  k.out(SESSION, D('Reading'), { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
  assert.equal(r.c.cancel(turnId), true);
  assert.deepEqual(r.killed, [k.pid]);
  assert.equal(r.c.cancel(turnId), true, 'still running until close: a second Stop is harmless');
  assert.deepEqual(r.killed, [k.pid], 'but kills only once');
  k.emit('close', 1);
  assert.equal(r.c.cancel(turnId), false);
  const kinds = r.ev(turnId).map((e) => e.kind);
  assert.deepEqual(kinds, ['session', 'delta', 'tool', 'done']);
  assert.equal(r.ev(turnId)[3].stopped, true); assert.equal(r.ev(turnId)[3].sessionId, SID2);
  assert.equal(r.c.cancel('ct-unknown'), false);
});

test('runner: limits — per chat and 3 in total; nothing spawned when refused; a freed slot is reusable', async () => {
  const r = rig();
  const a = await r.c.send({ conversationId: 'code:' + SID2, text: 'one', mode: 'read-only' });
  assert.deepEqual(await r.c.send({ conversationId: 'code:' + SID2, text: 'two', mode: 'read-only' }), { error: 'this chat already has a turn running — wait for it or press Stop' });
  await r.c.send({ projectId: 'project-a', text: 'n1', mode: 'read-only' });
  await r.c.send({ projectId: 'project-a', text: 'n2', mode: 'read-only' });
  assert.deepEqual(await r.c.send({ projectId: 'project-a', text: 'n3', mode: 'read-only' }), { error: '3 Claude turns are already running — wait for one or press Stop' });
  assert.equal(r.kids.length, 3);
  r.kids[0].out(RESULT); r.kids[0].emit('close', 0);
  assert.equal(r.c.running(), 2);
  assert.ok((await r.c.send({ conversationId: 'code:' + SID2, text: 'again', mode: 'read-only' })).turnId);
  assert.equal(r.kids.length, 4);
  assert.ok(a.turnId);
});

test('runner: a new chat counts as its code:<session> once the CLI names it — a Continue on it is BUSY until the turn ends', async () => {
  const BUSY = { error: 'this chat already has a turn running — wait for it or press Stop' };
  const r = rig({ target: (req) => (req.conversationId === 'code:' + SID2
    ? { cwd: DOCS_A, sessionId: SID2, key: 'code:' + SID2, prompt: req.text, seeded: null }
    : { cwd: DOCS_A, sessionId: null, key: null, prompt: req.text, seeded: null }) });
  const a = await r.c.send({ projectId: 'project-a', text: 'new chat', mode: 'edits' });
  r.kids[0].out(SESSION, D('Working'));
  assert.deepEqual(await r.c.send({ conversationId: 'code:' + SID2, text: 'second writer', mode: 'read-only' }), BUSY);
  assert.equal(r.kids.length, 1, 'no second claude --resume on the same session');
  r.kids[0].out(RESULT); r.kids[0].emit('close', 0);
  assert.equal(r.ev(a.turnId).pop().kind, 'done');
  assert.ok((await r.c.send({ conversationId: 'code:' + SID2, text: 'after', mode: 'read-only' })).turnId, 'free again once the turn ended');
});

test('runner: a claude.ai-seeded turn is BUSY under both its claude.ai id and its new code:<session>', async () => {
  const BUSY = { error: 'this chat already has a turn running — wait for it or press Stop' };
  const r = rig({ target: (req) => (req.conversationId === 'ai:chat-a'
    ? { cwd: DOCS_A, sessionId: null, key: 'ai:chat-a', prompt: 'seed: ' + req.text, seeded: { chars: 4, trimmed: false } }
    : { cwd: DOCS_A, sessionId: SID2, key: req.conversationId, prompt: req.text, seeded: null }) });
  await r.c.send({ conversationId: 'ai:chat-a', text: 'go on', mode: 'read-only' });
  r.kids[0].out(SESSION);
  assert.deepEqual(await r.c.send({ conversationId: 'ai:chat-a', text: 'again', mode: 'read-only' }), BUSY);
  assert.deepEqual(await r.c.send({ conversationId: 'code:' + SID2, text: 'resume it', mode: 'read-only' }), BUSY);
  assert.equal(r.kids.length, 1);
});

test('runner: the 10-min cap tree-stops the turn and ends it as an error', async () => {
  const r = rig({ turnMs: 30 });
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'slow', mode: 'read-only' });
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(r.killed, [r.kids[0].pid]);
  r.kids[0].emit('close', 1);
  const end = r.ev(turnId).pop();
  assert.equal(end.kind, 'error'); assert.match(end.error, /^stopped after \d+ min$/);
  assert.equal(r.logs.length, 1); assert.equal(r.logs[0][0], 'claude-chat');
});

test('runner: a turn that never closes after a kill still ends (grace)', async () => {
  const r = rig({ graceMs: 20 });
  const { turnId } = await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' });
  r.c.cancel(turnId);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.ev(turnId).pop().kind, 'done'); assert.equal(r.c.running(), 0);
});

test('runner: failures say why — exit without result, spawn error, missing binary, resolve error, raw lines kept', async () => {
  const r = rig();
  const t1 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[0].stdout.emit('data', Buffer.from('Some banner\r\n'));
  r.kids[0].stderr.emit('data', Buffer.from('first\nAuthentication required\n'));
  r.kids[0].emit('close', 1);
  assert.deepEqual(r.ev(t1).map((e) => [e.kind, e.text || e.error]), [['delta', 'Some banner\n'], ['error', 'Claude Code exited with code 1: Authentication required']]);
  const t2 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[1].emit('error', new Error('spawn ENOENT'));
  r.kids[1].emit('close', -1);
  assert.deepEqual(r.ev(t2).map((e) => e.kind), ['error']);
  assert.equal(r.ev(t2)[0].error, 'could not start Claude Code: spawn ENOENT');
  const nob = rig({ bin: { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' } });
  assert.deepEqual(await nob.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
  const bad = rig({ target: () => ({ error: 'refused folder (a drive root)' }) });
  assert.deepEqual(await bad.c.send({ projectId: 'x', text: 'x', mode: 'read-only' }), { error: 'refused folder (a drive root)' });
  assert.equal(nob.kids.length + bad.kids.length, 0);
});

test('runner: a successful run with no deltas still shows its text; an is_error result carries its reason', async () => {
  const r = rig();
  const t = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[0].out(SESSION, RESULT); r.kids[0].emit('close', 0);
  assert.deepEqual(r.ev(t).map((e) => e.kind), ['session', 'delta', 'done']);
  assert.equal(r.ev(t)[1].text, 'Hi there');
  const t2 = (await r.c.send({ projectId: 'project-a', text: 'x', mode: 'read-only' })).turnId;
  r.kids[1].out({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached max turns' }); r.kids[1].emit('close', 1);
  const d = r.ev(t2).pop();
  assert.equal(d.kind, 'done'); assert.equal(d.isError, true); assert.equal(d.result, 'Reached max turns'); assert.equal(d.usage, null);
});

test('resolveClaudeBin: HQ_CLAUDE_BIN first, then claude.exe / claude.cmd on PATH; unsafe paths refused', () => {
  const have = new Set(['C:\\bin2\\claude.cmd', 'C:\\bin3\\claude.exe', 'C:\\fake\\claude.cmd', 'C:\\R&D\\claude.cmd']);
  const exists = (p) => have.has(p);
  assert.deepEqual(resolveClaudeBin({ HQ_CLAUDE_BIN: 'C:\\fake\\claude.cmd', PATH: 'C:\\bin3' }, { exists }), { cmd: 'C:\\fake\\claude.cmd', viaCmd: true });
  assert.deepEqual(resolveClaudeBin({ PATH: 'C:\\bin1;C:\\bin2;C:\\bin3' }, { exists }), { cmd: 'C:\\bin2\\claude.cmd', viaCmd: true });
  assert.deepEqual(resolveClaudeBin({ Path: 'C:\\bin3' }, { exists }), { cmd: 'C:\\bin3\\claude.exe', viaCmd: false });
  assert.deepEqual(resolveClaudeBin({ PATH: 'C:\\R&D' }, { exists }), { error: 'unsafe Claude Code path' });
  assert.deepEqual(resolveClaudeBin({ HQ_CLAUDE_BIN: 'relative\\claude.cmd' }, { exists }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
  assert.deepEqual(resolveClaudeBin({ PATH: '' }, { exists }), { error: 'Claude Code CLI not found (install it, or set HQ_CLAUDE_BIN)' });
});

// --- Task 6: main-process wiring (init)
const { init } = require('./claude-chat.js');
import fsm from 'node:fs';
import osm from 'node:os';
import pathm from 'node:path';
test('init: two handlers, renderer cannot inject a session id, before-quit stops running turns', async () => {
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'hq-chat-init-'));
  try {
    const bin = pathm.join(dir, 'claude.exe'); fsm.writeFileSync(bin, '');
    const proj = pathm.join(dir, 'project-a'); fsm.mkdirSync(proj);
    const handlers = {}, quit = [], sp = fakeSpawn(), killed = [];
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const hub = { request: async (op, args) => (op === 'getConversation' && args.id === 'code:' + SID2
      ? { conversation: { id: 'code:' + SID2, source: 'code', native_id: SID2, cwd: proj }, messages: [], hasMore: false } : null) };
    init({ ipcMain, send: () => {}, app: { on: (ev, fn) => { if (ev === 'before-quit') quit.push(fn); } }, hub,
      env: { HQ_CLAUDE_BIN: bin, USERPROFILE: 'C:\\Users\\placeholder', SystemRoot: 'C:\\Windows' }, spawnFn: sp.spawnFn, kill: (pid) => killed.push(pid) });
    assert.deepEqual(Object.keys(handlers).sort(), ['hq:claude-chat:cancel', 'hq:claude-chat:send']);
    const r = await handlers['hq:claude-chat:send']({}, { conversationId: 'code:' + SID2, text: 'hi', mode: 'read-only', sessionId: 'evil', cwd: 'C:\\', args: ['--dangerously-skip-permissions'] });
    assert.equal(r.sessionId, SID2);
    assert.deepEqual(sp.kids[0].args, buildArgs({ mode: 'read-only', sessionId: SID2 }));
    assert.equal(sp.kids[0].opts.cwd, proj);
    assert.deepEqual(await handlers['hq:claude-chat:send']({}, null), { error: 'empty message' });
    assert.equal(await handlers['hq:claude-chat:cancel']({}, 'nope'), false);
    assert.equal(quit.length, 1); quit[0]();
    assert.deepEqual(killed, [sp.kids[0].pid]);
  } finally { fsm.rmSync(dir, { recursive: true, force: true }); }
});

test('init: a window reload mid-turn stops that turn (Allow edits included); listeners are removed when it ends; the chat is free again', async () => {
  const { watchSender } = require('./claude-chat.js');
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'hq-chat-reload-'));
  try {
    const bin = pathm.join(dir, 'claude.exe'); fsm.writeFileSync(bin, '');
    const proj = pathm.join(dir, 'project-a'); fsm.mkdirSync(proj);
    const handlers = {}, sp = fakeSpawn(), killed = [], pushed = [];
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    let hold = null;   // lets the test reload the window while the target is still resolving
    const hub = { request: async (op, args) => {
      if (hold) await hold;
      return op === 'getConversation' && args.id === 'code:' + SID2
        ? { conversation: { id: 'code:' + SID2, source: 'code', native_id: SID2, cwd: proj }, messages: [], hasMore: false } : null;
    } };
    init({ ipcMain, send: (ch, d) => pushed.push(d), hub,
      env: { HQ_CLAUDE_BIN: bin, USERPROFILE: 'C:\Users\placeholder', SystemRoot: 'C:\Windows' }, spawnFn: sp.spawnFn, kill: (pid) => killed.push(pid) });
    const mkSender = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const req = { conversationId: 'code:' + SID2, text: 'edit the readme', mode: 'edits' };
    const ends = (id) => pushed.filter((d) => d.turnId === id && (d.kind === 'done' || d.kind === 'error'));

    const w = mkSender();
    const { turnId } = await handlers['hq:claude-chat:send']({ sender: w }, req);
    assert.ok(turnId);
    assert.equal(w.listenerCount('did-start-navigation'), 1);
    w.emit('did-start-navigation', { isMainFrame: false });
    w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    assert.deepEqual(killed, [], 'a subframe or in-page navigation is not a reload');
    w.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });   // main.js mainWindow.reload()
    assert.deepEqual(killed, [sp.kids[0].pid], 'the reload stopped the turn');
    w.emit('destroyed');
    assert.deepEqual(killed, [sp.kids[0].pid], 'stopped once');
    sp.kids[0].emit('close', 1);
    assert.equal(ends(turnId).length, 1); assert.equal(ends(turnId)[0].kind, 'done'); assert.equal(ends(turnId)[0].stopped, true);
    for (const ev of ['did-start-navigation', 'destroyed', 'render-process-gone']) assert.equal(w.listenerCount(ev), 0, 'no listener left: ' + ev);

    const w2 = mkSender();
    const second = await handlers['hq:claude-chat:send']({ sender: w2 }, req);
    assert.ok(second.turnId, 'slot and chat are free again');
    w2.emit('render-process-gone', {});
    assert.equal(killed.length, 2, 'a crashed renderer stops its turn too');
    sp.kids[1].emit('close', 1);

    const w3 = mkSender();
    let release; hold = new Promise((r) => { release = r; });
    const pending = handlers['hq:claude-chat:send']({ sender: w3 }, req);
    w3.emit('did-start-navigation', { isMainFrame: true });
    release(); hold = null;
    assert.deepEqual(await pending, { error: 'the window that asked was reloaded — nothing was sent' });
    assert.equal(sp.kids.length, 2, 'nothing spawned for a window that reloaded while the target resolved');
    assert.equal(w3.listenerCount('did-start-navigation'), 0);

    const gone = Object.assign(new EventEmitter(), { isDestroyed: () => true });
    assert.deepEqual(await handlers['hq:claude-chat:send']({ sender: gone }, req), { error: 'the window that asked was reloaded — nothing was sent' });
    let hit = 0; const d = watchSender(null, () => hit++); d(); assert.equal(hit, 0, 'no sender: no watch (unit callers)');
  } finally { fsm.rmSync(dir, { recursive: true, force: true }); }
});
