// node --test dashboard-v5/src/live/foldable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDABLE, MEASURED_ZERO_14D, FOLD_LABELS, decideFold, sanitizeIds, normalizeFoldPrefs, isFolded, canMark, surfaceOf,
  navDigit, withDigits, foldNav, bottomNav, moreNav, numberKeyTarget, foldSubs, resolveTarget, foldLine, foldRow,
  LINE_MEASURED, LINE_OWNER, LINE_NOTHING, SHOW_EVERYTHING_LABEL,
} from './foldable.mjs';
import { NAV, SUBS } from './catalog.mjs';

const sorted = (s) => [...s].sort();

test('the four foldable surfaces are exactly the planned ones', () => {
  assert.deepEqual(FOLDABLE.map((f) => ({ ...f })), [
    { id: 'projects/archived', kind: 'sub', surface: 'projects-archived' },
    { id: 'system/hub-panel', kind: 'panel', surface: 'system-hub-panel' },
    { id: 'automations/library', kind: 'sub', surface: 'automations-library' },
    { id: 'life', kind: 'space', surface: 'space-life' },
  ]);
  assert.ok(Object.isFrozen(FOLDABLE) && Object.isFrozen(FOLDABLE[0]));
  for (const f of FOLDABLE) assert.ok(FOLD_LABELS[f.id], 'a name in words for ' + f.id);
});

test('the shipped default hides nothing: MEASURED_ZERO_14D is empty and an empty fold list folds nothing', () => {
  assert.deepEqual([...MEASURED_ZERO_14D], []);
  const d = decideFold({});
  assert.equal(d.folded.size, 0);
  assert.equal(d.hasFolded, false);
  assert.deepEqual(d.names, []);
  assert.equal(foldRow(d), null, 'no Show-everything row');
  assert.equal(foldLine(d), LINE_NOTHING, 'and the line says nothing is hidden');
  assert.equal(decideFold().folded.size, 0, 'no argument at all');
});

test('measuredZero or foldIds fold exactly those ids, and both sources add up', () => {
  assert.deepEqual(sorted(decideFold({ measuredZero: ['automations/library'] }).folded), ['automations/library']);
  assert.deepEqual(sorted(decideFold({ ownerFolded: ['projects/archived', 'life'] }).folded), ['life', 'projects/archived']);
  const both = decideFold({ measuredZero: ['life'], ownerFolded: ['life', 'system/hub-panel'] });
  assert.deepEqual(sorted(both.folded), ['life', 'system/hub-panel']);
  assert.deepEqual(sorted(both.measured), ['life']);
  assert.deepEqual(sorted(both.owner), ['life', 'system/hub-panel']);
  assert.equal(both.hasFolded, true);
});

test('showEverything wins: nothing is folded, but the row stays so it can be turned off', () => {
  const d = decideFold({ ownerFolded: ['projects/archived', 'life'], showEverything: true });
  assert.equal(d.folded.size, 0);
  assert.equal(d.hasFolded, true);
  assert.equal(d.showing, true);
  const row = foldRow(d);
  assert.equal(row.label, SHOW_EVERYTHING_LABEL);
  assert.equal(row.on, true);
  assert.match(row.desc, /^Showing: Projects › Archived, Life\./);
  assert.equal(isFolded(d, 'life'), false);
  assert.equal(canMark(d, 'life'), true, 'a surface shown on purpose is counted');
  for (const bad of [1, 'true', 'yes', null, {}]) assert.equal(decideFold({ ownerFolded: ['life'], showEverything: bad }).folded.size, 1, 'only true counts: ' + String(bad));
});

test('unknown ids in foldIds or measuredZero are ignored, and bad input never throws', () => {
  const d = decideFold({ measuredZero: ['space-money', 42, null], ownerFolded: ['nope', 'life', 'life', {}] });
  assert.deepEqual(sorted(d.folded), ['life']);
  assert.deepEqual(sorted(decideFold({ ownerFolded: ['space-money', 'projects/grid', '__proto__'] }).folded), []);
  assert.doesNotThrow(() => decideFold({ measuredZero: 'life', ownerFolded: { 0: 'life' } }));
  assert.equal(decideFold({ measuredZero: 'life', ownerFolded: { 0: 'life' } }).folded.size, 0, 'not arrays: nothing');
  assert.deepEqual(sanitizeIds(['life', 'life', 'nope', 7, 'projects/archived']), ['projects/archived', 'life'], 'known, unique, FOLDABLE order');
  assert.deepEqual(sanitizeIds('life'), []);
});

test('normalizeFoldPrefs cleans the two renderer prefs', () => {
  assert.deepEqual(normalizeFoldPrefs(undefined), { showEverything: false, foldIds: [] });
  assert.deepEqual(normalizeFoldPrefs({ showEverything: 1, foldIds: 'life' }), { showEverything: false, foldIds: [] });
  assert.deepEqual(normalizeFoldPrefs({ showEverything: true, foldIds: ['life', 'x'] }), { showEverything: true, foldIds: ['life'] });
});

test('the Settings row lists the names in words and the quiet line is the owner-approved sentence', () => {
  const d = decideFold({ measuredZero: ['projects/archived', 'life'] });
  const row = foldRow(d);
  assert.equal(row.on, false);
  assert.equal(row.desc, 'Hidden: Projects › Archived, Life. ' + LINE_MEASURED);
  assert.equal(LINE_MEASURED, 'Hidden because nobody opened them in 14 days (counted on this PC).');
  const mine = decideFold({ ownerFolded: ['system/hub-panel'] });
  assert.equal(foldLine(mine), LINE_OWNER, 'a fold the owner chose is not blamed on the measurement');
  assert.equal(foldLine(decideFold({ measuredZero: ['life'], ownerFolded: ['life', 'projects/archived'] })), LINE_MEASURED + ' ' + LINE_OWNER);
});

test('a measured space keeps nav digits: folding Life, the next space keeps its own digit', () => {
  const folded = decideFold({ measuredZero: ['life'] });
  const all = withDigits(NAV), some = foldNav(NAV, folded);
  assert.equal(all.length, NAV.length);
  assert.equal(some.length, NAV.length - 1);
  assert.ok(!some.some((n) => n.id === 'life'));
  const digitOf = (list, id) => list.find((n) => n.id === id).digit;
  for (const n of some) assert.equal(n.digit, digitOf(all, n.id), n.id + ' keeps its digit');
  assert.equal(digitOf(some, 'money'), '9', 'Money was 9 with Life before it, and still is');
  assert.equal(digitOf(some, 'cosmos'), '0');
  assert.equal(digitOf(some, 'security'), '', 'the 11th has no key, folded or not');
  assert.equal(digitOf(withDigits(NAV), 'life'), '8');
});

test('number keys still reach a folded space, and digits read the unfolded order', () => {
  assert.equal(numberKeyTarget(NAV, '8'), 'life');
  assert.equal(numberKeyTarget(NAV, '9'), 'money');
  assert.equal(numberKeyTarget(NAV, '0'), 'cosmos');
  assert.equal(numberKeyTarget(NAV, '1'), 'home');
  for (const bad of ['a', '', '10', 5, null, undefined]) assert.equal(numberKeyTarget(NAV, bad), null, String(bad));
  assert.equal(numberKeyTarget(NAV.slice(0, 3), '5'), null);
  assert.equal(navDigit(0), '1');
  assert.equal(navDigit(9), '0');
  assert.equal(navDigit(10), '');
});

test('the bottom nav is the original first four minus a folded one, and More is the rest from the fifth', () => {
  const none = decideFold({});
  assert.deepEqual(bottomNav(NAV, none).map((n) => n.id), ['home', 'projects', 'tasks', 'automations']);
  assert.deepEqual(moreNav(NAV, none).map((n) => n.id), NAV.slice(4).map((n) => n.id));
  const fake = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'life' }, { id: 'e' }];
  const f = decideFold({ ownerFolded: ['life'] });
  assert.deepEqual(bottomNav(fake, f).map((n) => n.id), ['a', 'b', 'c'], 'the fifth does not move up');
  assert.deepEqual(moreNav(fake, f).map((n) => [n.id, n.digit]), [['e', '5']]);
  const lifeFolded = decideFold({ ownerFolded: ['life'] });
  assert.ok(!moreNav(NAV, lifeFolded).some((n) => n.id === 'life'));
  assert.equal(moreNav(NAV, lifeFolded).find((n) => n.id === 'money').digit, '9');
});

test('a folded sub leaves the sub bar and nothing else does', () => {
  const f = decideFold({ ownerFolded: ['projects/archived', 'automations/library', 'life'] });
  assert.deepEqual(foldSubs('projects', SUBS.projects, f).map((s) => s[0]), ['grid', 'map', 'github', 'accounts', 'clients']);
  assert.deepEqual(foldSubs('automations', SUBS.automations, f).map((s) => s[0]), ['runnable', 'scheduled']);
  assert.deepEqual(foldSubs('tasks', SUBS.tasks, f), SUBS.tasks, 'an unfolded space keeps every sub');
  assert.deepEqual(foldSubs('life', SUBS.life, decideFold({})), SUBS.life);
  assert.deepEqual(foldSubs('system', undefined, f), []);
  const on = decideFold({ ownerFolded: ['projects/archived'], showEverything: true });
  assert.deepEqual(foldSubs('projects', SUBS.projects, on), SUBS.projects, 'Show everything brings it back');
});

test('a folded space or sub is still resolvable by route (reversible, never unreachable)', () => {
  const f = decideFold({ ownerFolded: ['life', 'projects/archived'] });
  const life = resolveTarget({ nav: NAV, subs: SUBS, tab: 'life', sub: 'notes', folded: f });
  assert.deepEqual(life, { ok: true, tab: 'life', sub: 'notes', folded: true });
  const arch = resolveTarget({ nav: NAV, subs: SUBS, tab: 'projects', sub: 'archived', folded: f });
  assert.deepEqual(arch, { ok: true, tab: 'projects', sub: 'archived', folded: true });
  assert.deepEqual(resolveTarget({ nav: NAV, subs: SUBS, tab: 'projects', sub: 'grid', folded: f }), { ok: true, tab: 'projects', sub: 'grid', folded: false });
  assert.deepEqual(resolveTarget({ nav: NAV, subs: SUBS, tab: 'life', folded: f }), { ok: true, tab: 'life', sub: null, folded: true });
  assert.equal(resolveTarget({ nav: NAV, subs: SUBS, tab: 'nowhere', folded: f }).ok, false);
  assert.equal(resolveTarget({ nav: NAV, subs: SUBS, tab: 'life', sub: 'nowhere', folded: f }).ok, false);
});

test('a use mark waits while its surface is folded, and surfaceOf names the measuring mark', () => {
  const f = decideFold({ ownerFolded: ['projects/archived'] });
  assert.equal(canMark(f, 'projects/archived'), false);
  assert.equal(canMark(f, 'automations/library'), true);
  assert.equal(canMark(f.folded, 'projects/archived'), false, 'a plain Set works too');
  assert.equal(surfaceOf('system/hub-panel'), 'system-hub-panel');
  assert.equal(surfaceOf('life'), 'space-life');
  assert.equal(surfaceOf('nope'), '');
});

test('every surface it names is a real destination or a real sub of the catalog', () => {
  for (const f of FOLDABLE) {
    const [space, sub] = f.id.split('/');
    assert.ok(NAV.some((n) => n.id === space), f.id + ': the space exists');
    if (f.kind === 'sub') assert.ok(SUBS[space].some((s) => s[0] === sub), f.id + ': the sub exists');
    if (f.kind === 'space') assert.equal(sub, undefined);
  }
});

test('the selftest rows (src/selftest-fold.mjs) use real destinations, real fold ids and unique names', async () => {
  const { foldStates, FOLD_RESET } = await import('../selftest-fold.mjs');
  const rows = foldStates();
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, 'unique names');
  for (const [name, tab, sub, st, extra] of rows) {
    assert.ok(NAV.some((n) => n.id === tab), name + ': tab');
    if (sub) assert.ok((SUBS[tab] || []).some((s) => s[0] === sub), name + ': sub');
    assert.deepEqual(sanitizeIds(st.foldIds), st.foldIds, name + ': known ids in FOLDABLE order');
    assert.equal(typeof st.showEverything, 'boolean', name);
    assert.ok(extra && typeof extra === 'object', name);
  }
  assert.ok(rows.some((r) => r[3].foldIds.length === 0 && r[4].settingsOpen), 'a row with Settings open and nothing folded');
  assert.ok(rows.some((r) => r[3].showEverything && r[3].foldIds.length), 'a row with Show everything on');
  assert.deepEqual({ ...FOLD_RESET }, { foldIds: [], showEverything: false, settingsOpen: false });
});
