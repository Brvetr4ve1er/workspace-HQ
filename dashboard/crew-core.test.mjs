// node --test dashboard/crew-core.test.mjs - the Crew's pure half. Invented names only (the repo is public).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './crew-core.mjs';

test('the role table is frozen, in this order, with "other" last', () => {
  assert.deepEqual(C.ROLES.map((r) => r.id), ['developers', 'designers', 'marketing', 'finance', 'legal', 'operations', 'sales', 'people', 'data', 'product', 'other']);
  assert.ok(Object.isFrozen(C.ROLES) && C.ROLES.every((r) => Object.isFrozen(r)));
  assert.ok(Object.isFrozen(C.PLUGIN_ROLES) && Object.isFrozen(C.NAME_STEMS));
  for (const r of Object.values(C.PLUGIN_ROLES)) assert.ok(C.ROLES.some((x) => x.id === r), r);
  assert.deepEqual(Object.keys(C.NAME_STEMS), C.ROLES.filter((r) => r.id !== 'other').map((r) => r.id));
});

test('parseSkillHead: name and description from frontmatter only', () => {
  const r = C.parseSkillHead('---\nname: alpha\ndescription: Does a thing.\n---\n\n# Body\ndescription: not this one\n');
  assert.deepEqual(r, { name: 'alpha', description: 'Does a thing.' });
});

test('parseSkillHead: quoted, folded and block descriptions', () => {
  assert.equal(C.parseSkillHead('---\nname: a\ndescription: "Quoted words."\n---\n').description, 'Quoted words.');
  assert.equal(C.parseSkillHead('---\nname: a\ndescription: >\n  folded one\n  folded two\n---\n').description, 'folded one folded two');
  assert.equal(C.parseSkillHead('---\nname: a\ndescription: |\n  line one\n  line two\n---\n').description, 'line one line two');
  assert.equal(C.parseSkillHead('---\r\nname: a\r\ndescription: crlf text\r\n---\r\n').description, 'crlf text');
});

test('parseSkillHead: odd frontmatter degrades to empty strings (a name-only row), never throws', () => {
  for (const t of ['', 'no frontmatter at all', '---\nname: a\ndescription: never closed', '---\n---\n', null, undefined, 42, '---\n: : :\n---\n']) {
    assert.doesNotThrow(() => C.parseSkillHead(t));
    const r = C.parseSkillHead(t);
    assert.equal(r.description, '', String(t));
  }
});

test('parseSkillHead reads the first 2 KB only: a closing line past 2 KB is not found, and the body is never used', () => {
  const long = '---\nname: a\ndescription: ' + 'x'.repeat(3000) + '\n---\nbody\n';
  assert.equal(C.parseSkillHead(long).description, '', 'the head was cut before the frontmatter closed');
  const ok = '---\nname: a\ndescription: short\n---\n' + 'body line\n'.repeat(500);
  assert.equal(C.parseSkillHead(ok).description, 'short');
  assert.equal(C.HEAD_BYTES, 2048);
});

test('plainText: one line, control and bidi characters gone, cut at 140 with an ellipsis', () => {
  assert.equal(C.plainText('a\nb\t\tc\u0000d‮e'), 'a b c d e');
  const s = C.plainText('word '.repeat(100), C.DESC_MAX);
  assert.ok(Array.from(s).length <= 140 && s.endsWith('…'));
  assert.equal(C.plainText('short'), 'short');
  assert.equal(C.plainText(null), '');
  assert.equal(C.DESC_MAX, 140);
});

test('assignRole: the plugin table first, then name stems, then description stems, then other', () => {
  assert.equal(C.assignRole({ plugin: 'design', name: 'anything', description: '' }), 'designers');
  assert.equal(C.assignRole({ plugin: 'Human-Resources', name: 'x', description: '' }), 'people');
  assert.equal(C.assignRole({ plugin: 'unknown-plugin', name: 'ledger-check', description: '' }), 'finance');
  assert.equal(C.assignRole({ name: 'plain-thing', description: 'Helps write a newsletter and an email campaign.' }), 'marketing');
  assert.equal(C.assignRole({ name: 'plain-thing', description: 'Nothing recognisable here.' }), 'other');
  assert.equal(C.assignRole({ plugin: 'design', name: 'lint-thing' }), 'designers', 'the plugin table wins over a name stem');
  assert.equal(C.assignRole(), 'other');
  assert.equal(C.assignRole({ plugin: '__proto__', name: 'x' }), 'other', 'a prototype key is not a plugin');
});

test('assignRole: a role is always one of the table', () => {
  const ids = new Set(C.ROLES.map((r) => r.id));
  for (const name of ['alpha-lint', 'beta-palette', 'gamma-ledger', 'zeta', '', '123']) assert.ok(ids.has(C.assignRole({ name })), name);
});

test('groupByRole: ROLES order, only roles with rows, rows by name', () => {
  const rows = [{ id: 'b', name: 'b', role: 'finance' }, { id: 'a', name: 'a', role: 'finance' }, { id: 'c', name: 'c', role: 'developers' }, { id: 'z', name: 'z', role: 'made-up' }];
  const g = C.groupByRole(rows);
  assert.deepEqual(g.map((x) => x.role), ['developers', 'finance', 'other']);
  assert.deepEqual(g[1].rows.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(C.groupByRole(null), []);
});

test('validId and buildStartPrompt: the one id shape and the one fixed sentence', () => {
  for (const ok of ['alpha-lint', 'acme-design:mood-board', '-dash-lead', 'a.b_c:1']) assert.ok(C.validId(ok), ok);
  for (const bad of ['', 'bad name', 'a;b', 'a&b', 'a"b', 'a\nb', '../x', 'a/b', 'x'.repeat(101), null, 5, undefined]) assert.equal(C.validId(bad), false, String(bad));
  assert.equal(C.buildStartPrompt('alpha-lint'), 'Use the alpha-lint skill to help me with:');
  assert.equal(C.buildStartPrompt('-dash-lead'), 'Use the -dash-lead skill to help me with:', 'a dash-leading id sits inside a sentence, so it can never read as an option');
  assert.equal(C.buildStartPrompt('bad name'), null);
  assert.ok(C.buildStartPrompt('x'.repeat(100)).length < 500, 'the longest id still survives the launcher cut');
});
