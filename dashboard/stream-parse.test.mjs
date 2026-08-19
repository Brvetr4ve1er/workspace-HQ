// node --test dashboard/stream-parse.test.mjs — fixtures for the stream-json
// line parser (v4.1 Phase 3). Concrete `claude -p --output-format stream-json
// --verbose` shapes: assistant text, tool_use notices, split-mid-line,
// malformed lines, CRLF, protocol-event filtering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk } from './stream-parse.js';

const line = (obj) => JSON.stringify(obj) + '\n';
const assistant = (...content) => ({ type: 'assistant', message: { id: 'msg_1', role: 'assistant', content } });

test('assistant text block becomes plain text (newline-terminated)', () => {
  const r = parseChunk('', line(assistant({ type: 'text', text: 'Hello from the agent' })));
  assert.equal(r.text, 'Hello from the agent\n');
  assert.equal(r.rest, '');
});

test('tool_use block becomes a one-line bracketed notice', () => {
  const r = parseChunk('', line(assistant({ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'C:\\repo\\a.js' } })));
  assert.equal(r.text, '[tool: Read C:\\repo\\a.js]\n');
});

test('tool_use with no usable input still yields a notice', () => {
  const r = parseChunk('', line(assistant({ type: 'tool_use', id: 'toolu_2', name: 'TodoWrite', input: { todos: [{ x: 1 }] } })));
  assert.equal(r.text, '[tool: TodoWrite]\n');
});

test('tool_use long input is truncated and stays one line', () => {
  const cmd = 'echo ' + 'x'.repeat(200) + '\n  && dir';
  const r = parseChunk('', line(assistant({ type: 'tool_use', id: 't', name: 'Bash', input: { command: cmd } })));
  const lines = r.text.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('[tool: Bash echo x'));
  assert.ok(lines[0].length < 100, `notice too long: ${lines[0].length}`);
});

test('split mid-line: partial stays in rest, completes on the next chunk', () => {
  const full = line(assistant({ type: 'text', text: 'two-part token stream' }));
  const cut = Math.floor(full.length / 2);
  const r1 = parseChunk('', full.slice(0, cut));
  assert.equal(r1.text, '');                       // nothing emitted yet
  assert.equal(r1.rest, full.slice(0, cut));       // nothing dropped either
  const r2 = parseChunk(r1.rest, full.slice(cut));
  assert.equal(r2.text, 'two-part token stream\n');
  assert.equal(r2.rest, '');
});

test('malformed complete line passes through raw — never thrown, never dropped', () => {
  const r = parseChunk('', '{"type":"assistant","broken\nnpm warn something real\n');
  assert.equal(r.text, '{"type":"assistant","broken\nnpm warn something real\n');
  assert.equal(r.rest, '');
});

test('non-object JSON lines (numbers, arrays) pass through raw', () => {
  const r = parseChunk('', '42\n[1,2]\n');
  assert.equal(r.text, '42\n[1,2]\n');
});

test('CRLF lines parse (claude.cmd on Windows)', () => {
  const r = parseChunk('', JSON.stringify(assistant({ type: 'text', text: 'crlf ok' })) + '\r\n');
  assert.equal(r.text, 'crlf ok\n');
  assert.equal(r.rest, '');
});

test('multiple events in one chunk, mixed with tool notices', () => {
  const chunk =
    line({ type: 'system', subtype: 'init', cwd: 'C:/x', session_id: 's1', tools: ['Read'] }) +
    line(assistant({ type: 'text', text: 'Looking at the file.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'b.md' } })) +
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }) +
    line(assistant({ type: 'text', text: 'Done.' }));
  const r = parseChunk('', chunk);
  assert.equal(r.text, 'Looking at the file.\n[tool: Read b.md]\nDone.\n');
});

test('system init, user tool-result echoes, and a SUCCESSFUL result are filtered', () => {
  const chunk =
    line({ type: 'system', subtype: 'init', model: 'claude-x' }) +
    line({ type: 'user', message: { role: 'user', content: [] } }) +
    line({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.01 });
  const r = parseChunk('', chunk);
  assert.equal(r.text, '');       // result duplicates assistant text: by-design filter
  assert.equal(r.rest, '');
});

// --- failed result events: the run's only structured diagnostic -------------
// The success filter above must NOT swallow these. A failed run prints no
// assistant text for the result to duplicate, so dropping it left the pane
// empty behind a red "Failed · exit N" chip — told THAT it failed, never WHY.

test('a failed result with a message emits the notice AND the message', () => {
  const r = parseChunk('', line({
    type: 'result', subtype: 'error_during_execution', is_error: true,
    result: 'Credit balance is too low to continue.', total_cost_usd: 0,
  }));
  assert.equal(r.text, '[error: error_during_execution]\nCredit balance is too low to continue.\n');
});

test('a failed result with NO result field still emits its subtype', () => {
  // error_max_turns carries no `result` string — the notice IS the diagnostic.
  const r = parseChunk('', line({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 40 }));
  assert.equal(r.text, '[error: error_max_turns]\n');
});

test('an error subtype without the is_error flag is still surfaced', () => {
  const r = parseChunk('', line({ type: 'result', subtype: 'error_during_execution' }));
  assert.equal(r.text, '[error: error_during_execution]\n');
});

test('is_error with no subtype falls back to a generic notice', () => {
  const r = parseChunk('', line({ type: 'result', is_error: true, result: 'refused' }));
  assert.equal(r.text, '[error: result]\nrefused\n');
});

test('a benign unknown subtype is NOT announced as an error', () => {
  // Guards the deliberate choice of /^error/ over `subtype !== 'success'`:
  // inventing an error for a future subtype would be its own lie.
  const r = parseChunk('', line({ type: 'result', subtype: 'partial_success', is_error: false, result: 'x' }));
  assert.equal(r.text, '');
});

test('a failed result after real assistant text appends, never replaces', () => {
  const chunk =
    line(assistant({ type: 'text', text: 'Starting the refactor.' })) +
    line({ type: 'result', subtype: 'error_max_turns', is_error: true });
  const r = parseChunk('', chunk);
  assert.equal(r.text, 'Starting the refactor.\n[error: error_max_turns]\n');
});

test('a hostile result payload cannot throw or leak a non-string', () => {
  assert.doesNotThrow(() => parseChunk('', line({ type: 'result', is_error: true, subtype: { x: 1 }, result: { y: 2 } })));
  const r = parseChunk('', line({ type: 'result', is_error: true, subtype: { x: 1 }, result: { y: 2 } }));
  assert.equal(r.text, '[error: result]\n');
  assert.equal(typeof r.text, 'string');
});

test('empty and whitespace-only lines are skipped', () => {
  const r = parseChunk('', '\n   \n' + line(assistant({ type: 'text', text: 'after blanks' })));
  assert.equal(r.text, 'after blanks\n');
});

test('never throws on hostile input', () => {
  assert.doesNotThrow(() => parseChunk(null, undefined));
  assert.doesNotThrow(() => parseChunk('', '\u0000\u0001{"a"\n'));
  assert.doesNotThrow(() => parseChunk('', line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 7, input: 'nope' }] } })));
  const r = parseChunk('', line({ type: 'assistant', message: { content: 'not-an-array' } }));
  assert.equal(r.text, '');
});

test('trailing unterminated line flushes when fed a bare newline (end-of-process)', () => {
  const tail = 'stderr died mid-line';
  const r1 = parseChunk('', tail);
  assert.equal(r1.rest, tail);
  const r2 = parseChunk(r1.rest, '\n');
  assert.equal(r2.text, tail + '\n');
  assert.equal(r2.rest, '');
});
