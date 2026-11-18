// node --test dashboard-v5/src/selftest-lantern.test.mjs
// The Lantern selftest rows: the documented rows, each a full consoleLayer patch, and the reader/judge pair against a faked page (a missing card, a wrong
// face, a number on a sealed card, a leftover Workbench picture, a stray sheet all fail). Placeholder state only; no DOM, no Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanternStates, lanternSeen, lanternProblems, lanternInitState } from './selftest-lantern.mjs';
import { normaliseConsoleLayer } from './logic/console-layer.mjs';
import { bindProject } from './logic/lantern-art.mjs';

const rows = lanternStates({ projectId: 'proj-example' });
const row = (name) => rows.find((r) => r.name === name);

function fakeDoc({ look = 'lantern', accent = '', links = 1, wbnLinks = 0, wbnArts = 0, arts = {} } = {}) {
  const el = (attrs, children = {}) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), querySelector: (sel) => children[sel] || null });
  const artEls = Object.entries(arts).map(([k, a]) => el({ 'data-lnt': 'art-' + k, 'data-lnt-face': a.face, 'aria-label': a.label || '' }, {
    '[data-lnt="readout"]': { textContent: a.text }, '[data-lnt="roman"]': { textContent: a.roman || '' },
  }));
  const root = el({ 'data-hq-look': look, 'data-hq-accent': accent });
  return {
    querySelector: (s) => (s === '[data-hq-theme]' ? root : null),
    querySelectorAll: (s) => (s === '[data-lnt^="art-"]' ? artEls : s === 'link#hq-lantern-css' ? Array.from({ length: links }) : s === 'link#hq-workbench-css' ? Array.from({ length: wbnLinks }) : s === '[data-wbn^="art-"]' ? Array.from({ length: wbnArts }) : []),
  };
}

test('the documented rows: every state patch is a normalised consoleLayer, the init state is everything off', () => {
  assert.deepEqual(lanternInitState(), { consoleLayer: normaliseConsoleLayer(null) });
  assert.deepEqual(rows.map((r) => r.name), ['lantern-home', 'lantern-home-palette-inert', 'lantern-home-cheat-palette-inert', 'lantern-home-empty-brief', 'lantern-crew', 'lantern-notes', 'lantern-notes-sealed',
    'lantern-shelf-empty', 'lantern-project', 'lantern-not-chosen', 'lantern-console-skin', 'lantern-workbench-look', 'lantern-off-stored']);
  for (const r of rows) {
    assert.deepEqual(r.state.consoleLayer, normaliseConsoleLayer(r.state.consoleLayer), r.name);
    assert.ok(['home', 'crew', 'notes', 'shelf-empty', 'project'].includes(r.kind), r.name);
  }
  assert.equal(row('lantern-off-stored').state.consoleLayer.on, false);
  assert.equal(row('lantern-off-stored').state.consoleLayer.look, 'lantern', 'a stored look with the layer off');
});

test('a right page passes every row that expects cards; a wrong one is named in words', () => {
  const up = (text, label) => ({ text, face: 'up', label });
  const ok = fakeDoc({ arts: { skills: up('9 SKILLS', '9 skills, card: The Lovers') } });
  assert.deepEqual(lanternProblems(row('lantern-crew'), lanternSeen(ok)), []);
  const card = bindProject('proj-example');
  assert.deepEqual(lanternProblems(row('lantern-project'), lanternSeen(fakeDoc({ arts: { project: { text: card.label, face: 'up', label: card.aria, roman: card.roman } } }))), []);
  assert.deepEqual(lanternProblems(row('lantern-notes-sealed'), lanternSeen(fakeDoc({ arts: { notes: { text: 'SEALED', face: 'sealed', label: 'Not read yet, card face down' } } }))), []);
  const bad = (doc, r = 'lantern-crew') => lanternProblems(row(r), lanternSeen(doc)).join(' | ');
  assert.match(bad(fakeDoc({ arts: {} })), /skills card is not in the page/);
  assert.match(bad(fakeDoc({ arts: { skills: { text: '8 SKILLS', face: 'up', label: '8 skills, card: The Lovers' } } })), /reads "8 SKILLS", want "9 SKILLS"/);
  assert.match(bad(fakeDoc({ arts: { skills: { text: '9 SKILLS', face: 'sealed', label: '' } } })), /face "sealed"/);
  assert.match(bad(fakeDoc({ look: '', links: 0, arts: {} })), /data-hq-look is ""/);
  assert.match(bad(fakeDoc({ links: 0, arts: { skills: up('9 SKILLS', '9 skills, card: The Lovers') } })), /0 #hq-lantern-css link/);
  assert.match(bad(fakeDoc({ wbnLinks: 1, arts: { skills: up('9 SKILLS', '9 skills, card: The Lovers') } })), /Workbench sheet is in the page beside/);
  assert.match(bad(fakeDoc({ wbnArts: 1, arts: { skills: up('9 SKILLS', '9 skills, card: The Lovers') } })), /Workbench picture/);
  assert.match(bad(fakeDoc({ arts: { notes: { text: 'SEALED', face: 'sealed', label: 'Not read yet, card face down' } } }), 'lantern-notes-sealed'), /^$/, 'the sealed row passes with the sealed card');
  assert.match(bad(fakeDoc({ arts: { notes: { text: 'SEALED', face: 'sealed', label: '0 notes' } } }), 'lantern-notes-sealed'), /carries a number/);
  assert.match(bad(fakeDoc({ look: '', links: 0, arts: { skills: up('9 SKILLS', '') } }), 'lantern-not-chosen'), /Lantern look is not chosen/);
  assert.match(bad(fakeDoc({ accent: 'signal', arts: {} }), 'lantern-home-palette-inert'), /data-hq-accent is "signal"/);
});

test('the Workbench row under the Workbench look expects the Workbench look and no Lantern card or sheet; a stray sheet fails it', () => {
  const r = row('lantern-workbench-look');
  assert.equal(r.want.look, 'workbench');
  assert.deepEqual(lanternProblems(r, lanternSeen(fakeDoc({ look: 'workbench', links: 0, wbnLinks: 1, arts: {} }))), []);
  assert.match(lanternProblems(r, lanternSeen(fakeDoc({ look: 'workbench', links: 1, arts: {} }))).join('|'), /1 #hq-lantern-css link/);
});

test('selftest.js walks the rows in both themes, notes every problem under "lantern", and puts the layer, brief and route back', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./selftest.js', import.meta.url), 'utf8');
  assert.match(src, /import\('\.\/selftest-lantern\.mjs'\)/);
  assert.match(src, /for \(const row of lanternStates\(/);
  assert.match(src, /lanternProblems\(row, lanternSeen\(document\)\)\.forEach\(\(p\) => note\('lantern'/);
  assert.match(src, /consoleLayer: cl11, crw: null, vdk: null, shelfMore: null, route: null/);
});

test('a card the row does not list may be in the page (the all-clear card beside the empty Brief line) but it must be honest', () => {
  const r = row('lantern-home-empty-brief');
  const need = { text: '0 NEED YOU', face: 'up', label: '0 need you, card: The Sun' };
  assert.deepEqual(lanternProblems(r, lanternSeen(fakeDoc({ arts: { needyou: need, cleared: { text: '3 CLEARED', face: 'up', label: '3 cleared, card: The Hermit' } } }))), []);
  assert.deepEqual(lanternProblems(r, lanternSeen(fakeDoc({ arts: { needyou: need, cleared: { text: 'SEALED', face: 'sealed', label: 'Not read yet, card face down' } } }))), []);
  assert.match(lanternProblems(r, lanternSeen(fakeDoc({ arts: { needyou: need, cleared: { text: 'SEALED', face: 'sealed', label: '0 cleared' } } }))).join('|'), /sealed cleared card carries a number/);
  assert.match(lanternProblems(r, lanternSeen(fakeDoc({ arts: { needyou: need, cleared: { text: '3 CLEARED', face: 'up', label: 'a card' } } }))).join('|'), /cleared card is not named by its readout first/);
});
