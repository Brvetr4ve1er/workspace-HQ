// Prompt note format (spec 2026-10-15 §6.1, phase P1). Pure; no vault is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import note from './claude-prompt-note.js';
import { parseFrontmatter, docId } from './claude-hub/ingest-docs.mjs';

const { slugify, noteName, variablesOf, promptNoteText, promptDocId, PROMPTS_REL, SLUG_MAX } = note;

test('slugify: reserved, empty, long, punctuation', () => {
  assert.equal(slugify('Review a PR like a staff engineer'), 'review-a-pr-like-a-staff-engineer');
  assert.equal(slugify('Review: PR #1 [draft]'), 'review-pr-1-draft');
  assert.equal(slugify('Café crème — brûlée'), 'cafe-creme-brulee');
  for (const t of ['', '???', null, undefined, '日本語', '   ']) assert.equal(slugify(t), 'prompt', String(t));
  assert.equal(slugify('CON'), 'prompt-con');
  assert.equal(slugify('com1'), 'prompt-com1');
  assert.equal(slugify('lpt9'), 'prompt-lpt9');
  assert.equal(slugify('console'), 'console');
  assert.equal(slugify('a'.repeat(200)).length, SLUG_MAX);
  const long = slugify('word '.repeat(30));
  assert.ok(long.length <= SLUG_MAX && !long.endsWith('-') && !long.startsWith('-'), long);
  assert.match(slugify('../../etc/passwd'), /^[a-z0-9-]+$/);
});

test('noteName: first name, then -2 … for clashes', () => {
  assert.equal(noteName('review-a-pr'), 'review-a-pr.md');
  assert.equal(noteName('review-a-pr', 1), 'review-a-pr.md');
  assert.equal(noteName('review-a-pr', 2), 'review-a-pr-2.md');
  assert.deepEqual(PROMPTS_REL, ['40_Resources', 'Prompts']);
});

test('variablesOf: body tokens ∪ frontmatter, junk ignored', () => {
  assert.deepEqual(variablesOf({ variables: ['project', 'file'] }, 'Use {{file}} and {{ extra }} and {{bad name}} {{1x}} {{}}'), ['project', 'file', 'extra']);
  assert.deepEqual(variablesOf({ variables: 'a, b' }, ''), ['a', 'b']);   // a bare string in hand-written frontmatter
  assert.deepEqual(variablesOf(null, '{{x}}{{x}} {{ x }}'), ['x']);
  assert.deepEqual(variablesOf({ variables: [1, {}, 'ok', 'has space'] }, null), ['ok']);
  assert.deepEqual(variablesOf({}, 'no variables here {single}'), []);
  const many = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(' ');
  assert.equal(variablesOf(null, many).length, 20);
});

test('promptNoteText: §6.1 layout that H6 parseFrontmatter reads back', () => {
  const file = path.join(os.tmpdir(), 'vault', ...PROMPTS_REL, 'review-a-pr.md');
  const id = promptDocId(file);
  const text = promptNoteText({
    title: 'Review: a PR\nlike staff #1', tags: ['review', 'code', 'bad tag!', ''], variables: ['project', 'file'],
    created: '2026-10-15T10:00:00Z', source: { kind: 'code', conversation: 'code:s1', at: '2026-09-02T14:03:00Z' }, id,
    body: 'You are reviewing {{file}} in {{project}}. Placeholder body.',
  });
  assert.ok(text.startsWith('---\ntitle: '));
  assert.ok(text.endsWith('Placeholder body.\n'));
  const fm = parseFrontmatter(text);
  assert.equal(fm.has, true);
  assert.equal(fm.data.title, 'Review: a PR like staff #1');
  assert.deepEqual(fm.data.tags, ['review', 'code', 'badtag']);
  assert.deepEqual(fm.data.variables, ['project', 'file']);
  assert.equal(fm.data.version, 1);
  assert.deepEqual(fm.data.source, { kind: 'code', conversation: 'code:s1', at: '2026-09-02T14:03:00Z' });
  assert.deepEqual(fm.data.hq, { id });
  assert.equal(fm.body, 'You are reviewing {{file}} in {{project}}. Placeholder body.\n');
  const bare = parseFrontmatter(promptNoteText({ title: 'T', body: 'B', created: '2026-10-15T10:00:00Z' }));
  assert.equal(bare.data.source, undefined, 'source only when harvested');
  assert.deepEqual(bare.data.tags, []);
});

test('promptDocId equals the H6 document id of the same file (any case)', () => {
  const file = path.join(os.tmpdir(), 'Vault', '40_Resources', 'Prompts', 'Review-A-PR.md');
  assert.equal(promptDocId(file), docId('prompt', file));
  assert.equal(promptDocId(file.toUpperCase()), docId('prompt', file));
  assert.match(promptDocId(file), /^prompt:[0-9a-f]{40}$/);
});
