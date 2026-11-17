// node --test tools/thesis.test.mjs
// The thesis, said out loud in the two files a stranger reads first (batch 7, subtraction):
//   WorkspaceHQ says what needs the owner, where they are, then lets them act in place;
//   and the FREEZE RULE (amended by the owner 2026-11-17): no new space and no new MCP tool; views inside an existing space are allowed, one stage
//   at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view
//   with fewer than 3 uses in 14 days is deleted.
// README.md: the opening, everything above "## Status". CLAUDE.md: its first paragraph (the first block of text under the title).
//
// The real-file check starts as a `todo` while NEITHER file says the thesis yet (the shared edit has not landed); the moment either does, both
// are held to it. The fixture checks below always run. A doesNotMatch is used only for GENERIC placeholders and machine paths, never a real name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const THESIS = /says what needs (?:you|the owner), where (?:you are|they are),? (?:and )?then lets (?:you|them) act in place/i;
const FREEZE = [
  [/freeze rule/i, 'names itself the freeze rule'],
  [/no new space/i, 'no new space'],
  [/no new MCP tool/i, 'no new MCP tool'],
  [/views inside an existing space are allowed/i, 'views inside an existing space are allowed'],
  [/one stage at a time/i, 'one stage at a time'],
  [/the use report is read before every stage/i, 'the use report is read before every stage'],
  [/the next stage waits for the previous act bar/i, 'the next stage waits for the previous act bar'],
  [/fewer than 3 uses in 14 days is deleted/i, 'fewer than 3 uses in 14 days is deleted'],
];
const PLACEHOLDERS = [/\{\{[^}]*\}\}/, /<owner[^>]*>/i, /\bOWNER_NAME\b/, /\[owner name\]/i, /\bYOUR NAME\b/, /\bTODO\b/, /\blorem ipsum\b/i, /\bJohn Doe\b/, /\bJane Doe\b/];
const MACHINE = [/[A-Za-z]:\\Users\\[^\\\s]+/, /\/Users\/[^/\s]+\//, /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/];

export function readmeOpening(text) {
  const i = text.indexOf('\n## Status');
  return i < 0 ? '' : text.slice(0, i);
}

export function claudeFirstParagraph(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.find((b) => !b.split('\n').every((l) => /^#/.test(l))) || '';
}

/** Every complaint about the two texts (empty = the thesis is in place). */
export function checkThesis(readme, claude) {
  const out = [];
  const opening = readmeOpening(readme), first = claudeFirstParagraph(claude);
  if (!opening) out.push('README.md has no "## Status" heading to end the opening at');
  const where = [['README.md opening', opening], ['CLAUDE.md first paragraph', first]];
  for (const [name, text] of where) {
    if (!THESIS.test(text)) out.push(name + ' does not say: WorkspaceHQ says what needs the owner, where they are, then lets them act in place');
    for (const [re, what] of FREEZE) if (!re.test(text)) out.push(name + ' lacks the freeze rule part: ' + what);
    for (const re of PLACEHOLDERS) if (re.test(text)) out.push(name + ' holds a placeholder or unfilled token: ' + re);
    for (const re of MACHINE) if (re.test(text)) out.push(name + ' holds a machine path or an address: ' + re);
  }
  if (!/personal tool/i.test(readme) || !/one (?:Windows )?machine/i.test(readme)) out.push('README.md lost its "personal tool, one Windows machine" framing');
  if (!/placeholder data/i.test(readme)) out.push('README.md lost the trailer placeholder-data note');
  return out;
}

const GOOD_README = [
  '# WorkspaceHQ', '',
  'WorkspaceHQ says what needs you, where you are, then lets you act in place.', '',
  'Freeze rule: No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted.', '',
  '> **The trailers show placeholder data.**', '',
  '## Status', '', '- A personal tool, built for one machine. Windows only, no installer.', '',
].join('\n');
const GOOD_CLAUDE = [
  '# WorkspaceHQ — session contract', '',
  'WorkspaceHQ says what needs the owner, where they are, then lets them act in place. FREEZE RULE: No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted.', '',
  'Two sessions work this repo.', '',
].join('\n');

test('fixture: a README opening and a CLAUDE.md first paragraph that say it pass', () => {
  assert.deepEqual(checkThesis(GOOD_README, GOOD_CLAUDE), []);
});

test('fixture: each missing part is named', () => {
  const noThesis = checkThesis(GOOD_README.replace('says what needs you, where you are, then lets you act in place', 'is a console'), GOOD_CLAUDE);
  assert.ok(noThesis.some((m) => /README\.md opening does not say/.test(m)), noThesis.join('\n'));
  for (const [re, what] of FREEZE) {
    const claude = GOOD_CLAUDE.replace(new RegExp(re.source, 'gi'), 'x');
    assert.ok(checkThesis(GOOD_README, claude).some((m) => m.includes(what)), 'CLAUDE.md without: ' + what);
  }
  const lateRule = GOOD_README.replace(/Freeze rule:[^\n]*\n\n/, '').replace('## Status', '## Status\n\nFreeze rule: No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted.');
  assert.ok(checkThesis(lateRule, GOOD_CLAUDE).some((m) => /README\.md opening lacks the freeze rule/.test(m)), 'the rule below Status is not in the opening');
  assert.ok(checkThesis(GOOD_README.replace('## Status', '## Elsewhere'), GOOD_CLAUDE).some((m) => /no "## Status" heading/.test(m)));
});

test('fixture: README keeps its honest framing and the trailer note, CLAUDE.md first paragraph is the first text block', () => {
  assert.ok(checkThesis(GOOD_README.replace('A personal tool', 'A product'), GOOD_CLAUDE).some((m) => /framing/.test(m)));
  assert.ok(checkThesis(GOOD_README.replace('placeholder data', 'real data'), GOOD_CLAUDE).some((m) => /placeholder-data note/.test(m)));
  assert.equal(claudeFirstParagraph('# Title\n\n## Sub\n\nFirst block.\nSecond line.\n\nNext block.'), 'First block.\nSecond line.');
  assert.equal(claudeFirstParagraph('# only a title'), '');
});

test('fixture: unfilled tokens and machine paths in the thesis text are refused (generic patterns, no names)', () => {
  const bad = (s) => checkThesis(GOOD_README.replace('# WorkspaceHQ', '# WorkspaceHQ\n\n' + s), GOOD_CLAUDE);
  for (const s of ['Built by {{owner}}.', 'Built by <owner name>.', 'Built by OWNER_NAME.', 'Built by [owner name].', 'TODO write this', 'Built by John Doe.', 'See C:\\Users\\someone\\repo.', 'See /Users/someone/repo/x.', 'Mail someone@example.com.']) {
    assert.ok(bad(s).some((m) => /placeholder or unfilled token|machine path or an address/.test(m)), s);
  }
});

test('the real README opening and CLAUDE.md first paragraph carry the thesis and the freeze rule', (t) => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const said = THESIS.test(readmeOpening(readme)) || THESIS.test(claudeFirstParagraph(claude));
  const complaints = checkThesis(readme, claude);
  if (!said) { t.todo('the thesis edit to README.md and CLAUDE.md has not landed yet (the integrator makes it); this check is strict from the first file that says it'); return; }
  assert.deepEqual(complaints, []);
});
