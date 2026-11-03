// Prompt note {{variables}} (spec 2026-10-15 §6.1). Pure; no vault is touched. The slug/note-writing and
// P3 run-fill tests went with those halves (prompt library removal) — restore from tag cleanup-base-2026-10-28.
import test from 'node:test';
import assert from 'node:assert/strict';
import note from './claude-prompt-note.js';

const { variablesOf } = note;

test('variablesOf: body tokens ∪ frontmatter, junk ignored', () => {
  assert.deepEqual(variablesOf({ variables: ['project', 'file'] }, 'Use {{file}} and {{ extra }} and {{bad name}} {{1x}} {{}}'), ['project', 'file', 'extra']);
  assert.deepEqual(variablesOf({ variables: 'a, b' }, ''), ['a', 'b']);   // a bare string in hand-written frontmatter
  assert.deepEqual(variablesOf(null, '{{x}}{{x}} {{ x }}'), ['x']);
  assert.deepEqual(variablesOf({ variables: [1, {}, 'ok', 'has space'] }, null), ['ok']);
  assert.deepEqual(variablesOf({}, 'no variables here {single}'), []);
  const many = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(' ');
  assert.equal(variablesOf(null, many).length, 20);
});
