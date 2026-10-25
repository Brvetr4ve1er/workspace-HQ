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
