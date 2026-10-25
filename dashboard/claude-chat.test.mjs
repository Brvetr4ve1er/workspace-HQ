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
