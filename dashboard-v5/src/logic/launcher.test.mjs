// The Launcher, renderer side (batch 9, dish "launcher screens"): the pure cleaning and words, the mixin (read per opening, one call at a time, every change
// answered by main's fixed words, Open workspace and the project page's Allow and run), the vals (ONE top-level key, the same key set in every state,
// pg.workspace exactly four keys), the palette rows and a static check that every key the template reads exists. The renderer sends NO usage mark.
// Rig in the crew.test.mjs style. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/launcher.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WS_WORKING_TEXT } from './launcher.js';
import { launcherLogic, cleanRead, addText, workspaceLine, devUnconfirmed, lnchInit, LNCH_OFF, CHANGED_TEXT, WS_BUSY_TEXT, WS_FAILED_TEXT, LOCKED_TEXT } from './launcher.js';
import { paletteLogic } from './palette.js';
import { launcherVals, workspaceVals } from '../vals/launcher.js';
import { hashShown, REFUSED_TEXT } from './dev-allow.mjs';
import tpl from '../tpl/launcher.tpl.js';
import { makeLauncherFake } from '../../tools/launcher-fixture.mjs';

globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const PROJECTS = [{ id: 'a', name: 'Project A', dev: 'npm run dev' }, { id: 'b', name: 'Project B', dev: null }];

function rig(o = {}) {
  const calls = [], marks = [];
  const devAllowed = new Set();
  const F = makeLauncherFake({ mode: () => o.mode || '', record: (m, a) => { if (m === 'use') marks.push(a.join('/')); }, devAllowed });
  const row = (n) => F.rows.find((x) => x[0] === n)[1];
  const wrap = (name, fn) => async (...a) => { calls.push(name + ':' + a.join(',')); await (o.gate || Promise.resolve()); if (o.reject) throw new Error('boom'); return o.answers && o.answers[name] !== undefined ? o.answers[name] : fn(...a); };
  const launcher = o.noMethod ? {} : {
    read: wrap('read', () => row('launcher.read')()), add: wrap('add', (k) => row('launcher.add')(k)), remove: wrap('remove', (id) => row('launcher.remove')(id)),
    setEditor: wrap('setEditor', (id) => row('launcher.setEditor')(id)), open: wrap('open', (id) => row('launcher.open')(id)), openWorkspace: wrap('openWorkspace', (id) => row('launcher.openWorkspace')(id)),
  };
  const hq = o.noBridge ? null : { launcher, use: (s, a) => { marks.push(s + '/' + a); },
    devAllow: async (id, h) => { calls.push('devAllow:' + id + ',' + h); if (o.allowAnswer) return o.allowAnswer; devAllowed.add(id); return 'allowed'; },
    devForget: async (id) => { calls.push('devForget:' + id); return devAllowed.delete(id) ? 'removed' : 'none'; } };
  const self = Object.assign(Object.create(Object.assign({}, launcherLogic, paletteLogic)), {
    state: { settingsOpen: false, paletteOpen: false, paletteQuery: '', paletteSel: 0, snapOffset: 0, lnch: o.lnch || null, devAsk: {}, petOn: false, askHistory: [], ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    hq, projectsAt: () => PROJECTS, openProject(id) { calls.push('openProject:' + id); },
    openTasks: () => [],
    M: { NAV: ['home', 'projects', 'tasks', 'automations', 'claude', 'history', 'system', 'life', 'money'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), glyph: '·' })), AUTOS: [], INTERACTIVE: [] },
  });
  return { self, calls, marks, devAllowed, vals: () => launcherVals.call(self, { S: self.state }).lnchv };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

// ------------------------------------------------------------------ pure
test('cleanRead: a plain id and a known kind keep an entry; the editor must be an app entry; a project needs a plain id; junk is no answer', () => {
  const ok = cleanRead({ entries: [{ id: 'aaaa0001', kind: 'folder', name: 'x\ny' }, { id: 'BAD', kind: 'folder', name: 'n' }, { id: 'aaaa0002', kind: 'app', name: 'Ed' }, { id: 'aaaa0003', kind: 'weird', name: 'n' }, 5],
    editor: 'aaaa0001', projects: [{ id: 'a', name: 'A', dev: 'allowed' }, { id: '../x', name: 'n', dev: 'allowed' }, { id: 'b', name: 'B', dev: 'bogus' }], terminal: 'wt', locked: false, limit: 40 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.entries.map((e) => e.id), ['aaaa0001', 'aaaa0002']);
  assert.equal(ok.data.entries[0].name, 'x y');
  assert.equal(ok.data.editor, null, 'a folder cannot be the editor');
  assert.deepEqual(ok.data.projects.map((p) => [p.id, p.dev]), [['a', 'allowed'], ['b', 'none']]);
  assert.equal(cleanRead(null).ok, false);
  assert.equal(cleanRead({ error: 'the launcher could not be read' }).error, 'the launcher could not be read');
  assert.equal(cleanRead({ entries: 'no', projects: [] }).ok, false);
});

test('addText and workspaceLine say main\'s fixed words; a forged state says nothing it should not', () => {
  assert.equal(addText({ state: 'added' }, 'app').text, 'App added');
  assert.equal(addText({ state: 'cancelled' }, 'app').text, '');
  assert.equal(addText({ state: 'refused', why: 'an app must be an .exe file' }, 'app').text, 'Not added: an app must be an .exe file');
  assert.equal(addText({ state: 'locked' }, 'app').text, LOCKED_TEXT);
  assert.equal(addText({ state: 'whatever' }, 'app').bad, true);
  assert.equal(addText(null, 'app').text, 'Not added');
  assert.equal(workspaceLine({ ok: true, steps: [], line: 'Dev server: started. Editor: opened.' }), 'Dev server: started. Editor: opened.');
  assert.equal(workspaceLine({ state: 'busy' }), WS_BUSY_TEXT);
  assert.equal(workspaceLine({ state: 'working' }), WS_WORKING_TEXT, 'another launch running is not the hour\'s limit');
  assert.notEqual(WS_WORKING_TEXT, WS_BUSY_TEXT);
  assert.match(WS_WORKING_TEXT, /still running/);
  assert.match(WS_FAILED_TEXT, /Try again/);
  assert.match(LOCKED_TEXT, /restart the app/);
  assert.equal(workspaceLine({ state: 'refused' }), WS_FAILED_TEXT);
  assert.equal(workspaceLine(null), WS_FAILED_TEXT);
  assert.equal(devUnconfirmed({ steps: [{ step: 'dev', state: 'unconfirmed' }] }), true);
  assert.equal(devUnconfirmed({ steps: [{ step: 'dev', state: 'started' }] }), false);
  assert.equal(devUnconfirmed(null), false);
});

// ------------------------------------------------------------------ mixin
test('Settings reads once per opening (deferred), never at boot, and re-arms when Settings and the palette are both closed', async () => {
  const r = rig();
  r.vals();   // closed: nothing
  assert.deepEqual(r.calls, []);
  r.self.state.settingsOpen = true;
  r.vals(); r.vals(); r.vals();
  await settle();
  assert.deepEqual(r.calls, ['read:']);
  assert.equal(r.self.state.lnch.loaded, true);
  r.self.state.settingsOpen = false;
  r.vals();
  r.self.state.settingsOpen = true;
  r.vals();
  await settle();
  assert.equal(r.calls.filter((c) => c === 'read:').length, 2);
});

test('a read that fails says so; the last list stays on screen', async () => {
  const r = rig();
  assert.equal(await r.self.lnchLoad(), true);
  r.self.hq.launcher.read = async () => ({ error: 'the launcher could not be read' });
  assert.equal(await r.self.lnchLoad(), false);
  assert.equal(r.self.state.lnch.error, 'the launcher could not be read');
  assert.equal(r.self.state.lnch.data.entries.length, 3, 'the list is kept');
  r.self.hq.launcher.read = async () => { throw new Error('boom at C:\\secret'); };
  assert.equal(await r.self.lnchLoad(), false);
  assert.equal(r.self.state.lnch.error, 'the launcher could not be read', 'no raw error text reaches the screen');
});

test('add: main opens the dialog, the answer is said in words and the list reloads; a cancel says nothing; the renderer sends no mark', async () => {
  const r = rig();
  await r.self.lnchLoad();
  assert.equal(await r.self.lnchAdd('folder'), true);
  assert.equal(r.self.state.lnch.notice, 'Folder added');
  assert.equal(r.self.state.lnch.data.entries.length, 4);
  assert.equal(await r.self.lnchAdd('nope'), false);
  assert.deepEqual(r.calls.filter((c) => c.startsWith('add:')), ['add:folder'], 'a bad kind never reaches main');
  const c = rig({ answers: { add: { state: 'cancelled' } } });
  await c.self.lnchAdd('file');
  assert.equal(c.self.state.lnch.notice, '');
  assert.deepEqual(r.marks, []);
  const f = rig({ mode: 'refuse' });
  assert.equal(await f.self.lnchAdd('app'), false);
  assert.match(f.self.state.lnch.notice, /^Not added: that is not a full path/);
  assert.equal(f.self.state.lnch.noticeBad, true);
});

test('one change at a time: a second click while one is in flight is dropped', async () => {
  let go; const gate = new Promise((res) => { go = res; });
  const r = rig({ gate });
  const a = r.self.lnchAdd('folder'); const b = r.self.lnchAdd('folder');
  assert.equal(await b, false);
  go(); await a;
  assert.equal(r.calls.filter((c) => c.startsWith('add:')).length, 1);
});

test('remove, use as editor and open go to main with the id only and say its word', async () => {
  const r = rig();
  await r.self.lnchLoad();
  assert.equal(await r.self.lnchSetEditor('aaaa0001'), false);
  assert.match(r.self.state.lnch.notice, /^Not chosen: an app must be an \.exe file/);
  assert.equal(await r.self.lnchSetEditor('aaaa0002'), true);
  assert.equal(await r.self.lnchOpen('aaaa0003'), true);
  assert.equal(await r.self.lnchRemove('aaaa0001'), true);
  assert.equal(r.self.state.lnch.data.entries.length, 2);
  assert.equal(await r.self.lnchRemove('not an id'), false);
  assert.equal(await r.self.lnchOpen('x'), false);
  assert.ok(!r.calls.some((c) => c.includes('not an id')), 'a bad id never reaches main');
});

test('Allow this command sends the hash of the text shown; "changed" says so and nothing is stored; Remove permission goes through devForget', async () => {
  const r = rig();
  await r.self.lnchLoad();
  assert.equal(await r.self.lnchAllow('a', 'npm run dev'), true);
  assert.deepEqual(r.calls.filter((c) => c.startsWith('devAllow')), ['devAllow:a,' + hashShown('npm run dev')]);
  assert.equal(r.self.state.lnch.data.projects.find((p) => p.id === 'a').dev, 'allowed', 'the list was re-read');
  assert.equal(r.self.state.devAsk.a, null, 'the project page stops offering Allow and run');
  assert.equal(await r.self.lnchForget('a'), true);
  assert.equal(r.self.state.lnch.data.projects.find((p) => p.id === 'a').dev, 'unconfirmed');
  const c = rig({ allowAnswer: 'changed' });
  assert.equal(await c.self.lnchAllow('a', 'npm run dev'), false);
  assert.equal(c.self.state.lnch.notice, CHANGED_TEXT);
  const f = rig({ allowAnswer: 'refused' });
  await f.self.lnchAllow('a', 'npm run dev');
  assert.equal(f.self.state.lnch.notice, REFUSED_TEXT);
  assert.equal(await r.self.lnchAllow('a', ''), false, 'no text, no call');
  assert.equal(await r.self.lnchForget('../x'), false);
});

test('Open workspace: one call per project, the line is main\'s own sentence, no mark from the renderer, a not-allowed dev step leaves Allow and run on the dev button', async () => {
  let go; const gate = new Promise((res) => { go = res; });
  const r = rig({ gate });
  const a = r.self.lnchWorkspace('a', 'npm run dev'); const b = r.self.lnchWorkspace('a', 'npm run dev');
  assert.equal(await b, null, 'a double click is one call');
  assert.equal(r.self.state.lnch.ws.a.busy, true);
  go(); const ans = await a;
  assert.equal(r.calls.filter((c) => c.startsWith('openWorkspace')).length, 1);
  assert.equal(r.self.state.lnch.ws.a.busy, false);
  assert.equal(r.self.state.lnch.ws.a.line, ans.line);
  assert.match(ans.line, /Dev server: not allowed yet\. Press Allow and run\./);
  assert.deepEqual(r.self.state.devAsk.a, { kind: 'allow', text: 'npm run dev', hash: hashShown('npm run dev') });
  assert.equal(r.marks.filter((m) => m !== 'launcher-workspace/act').length, 0, 'the renderer writes no mark of its own');
  assert.equal(rig({ noMethod: true }).self.lnchCanWorkspace(), false);
  assert.equal(await rig({ noMethod: true }).self.lnchWorkspace('a', 'x'), null);
  assert.equal(await r.self.lnchWorkspace('../x', 'x'), null);
  const busy = rig({ answers: { openWorkspace: { ok: false, steps: [], line: '', state: 'busy' } } });
  await busy.self.lnchWorkspace('a', 'x');
  assert.equal(busy.self.state.lnch.ws.a.line, WS_BUSY_TEXT);
});

test('the renderer source has no usage mark for the Launcher and no path, command or argument is ever built here', () => {
  const src = fs.readFileSync(new URL('./launcher.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../vals/launcher.js', import.meta.url), 'utf8');
  assert.ok(!/useMark|useActOnce|hq\.use\b/.test(src), 'no usage mark');
  assert.ok(!/spawn|exec\(|shell\.|require\(/.test(src.replace(/\/\/.*$/gm, '')), 'nothing here starts a process');
});

// ------------------------------------------------------------------ vals
test('vals: ONE top-level key, a frozen constant while Settings is closed, and the same key set in every state', async () => {
  const r = rig();
  const off = r.vals();
  assert.equal(off.show, false);
  assert.ok(Object.isFrozen(off));
  const keys = Object.keys(off).sort();
  assert.deepEqual(Object.keys(launcherVals.call(r.self, { S: { settingsOpen: false } })), ['lnchv']);
  r.self.state.settingsOpen = true;
  const states = {};
  states.loading = r.vals();
  await settle();
  states.ready = r.vals();
  const no = rig({ noBridge: true, state: { settingsOpen: true } }); states.offline = no.vals();
  const er = rig({ mode: 'error', state: { settingsOpen: true } }); er.vals(); await settle(); states.error = er.vals();
  const lk = rig({ mode: 'locked', state: { settingsOpen: true } }); lk.vals(); await settle(); states.locked = lk.vals();
  const em = rig({ state: { settingsOpen: true } }); await em.self.lnchLoad(); em.self.state.lnch.data.entries = []; states.empty = em.vals();
  for (const [n, v] of Object.entries(states)) assert.deepEqual(Object.keys(v).sort(), keys, n + ' has the same key set');
  assert.equal(states.offline.offline, true);
  assert.equal(states.offline.offlineText, LNCH_OFF);
  assert.equal(states.loading.loading, true);
  assert.equal(states.error.hasErr, true);
  assert.equal(states.error.refreshLabel, 'Retry');
  assert.equal(states.locked.locked, true);
  assert.equal(states.locked.ready, false);
  assert.equal(states.locked.addsOff, true);
  assert.equal(states.empty.hasEntries, false);
  assert.equal(states.ready.entries.length, 3);
  assert.equal(states.ready.entries.filter((e) => e.isEditor).length, 1);
  assert.equal(states.ready.hasEditor, true);
  assert.equal(states.ready.terminalText, 'Windows Terminal (found)');
  assert.deepEqual(states.ready.adds.map((a) => a.label), ['Add folder', 'Add file', 'Add app', 'Add link']);
});

test('vals: the command rows show the scan\'s text, main\'s state, and the right button', async () => {
  const r = rig({ state: { settingsOpen: true } });
  await r.self.lnchLoad();
  let v = r.vals();
  assert.deepEqual(v.cmds.map((c) => [c.id, c.text, c.stateText, c.canAllow, c.allowed]), [['a', 'npm run dev', 'Not allowed yet', true, false]], 'a project with no command has no row');
  await r.self.lnchAllow('a', 'npm run dev');
  v = r.vals();
  assert.deepEqual(v.cmds.map((c) => [c.stateText, c.canAllow, c.allowed]), [['Allowed', false, true]]);
  r.self.state.lnch = { ...r.self.state.lnch, data: { ...r.self.state.lnch.data, projects: [{ id: 'a', name: 'Project A', dev: 'refused' }] } };
  v = r.vals();
  assert.equal(v.cmds[0].stateText, REFUSED_TEXT);
  assert.equal(v.cmds[0].canAllow, false);
  assert.equal(v.cmds[0].allowed, false);
});

test('pg.workspace is exactly { on, label, busy, line }; the button is off with no bridge, and stays enabled while it runs', async () => {
  const r = rig();
  const w = workspaceVals.call(r.self, { id: 'a' });
  assert.deepEqual(Object.keys(w).sort(), ['busy', 'label', 'line', 'on']);
  assert.equal(w.on, true);
  assert.equal(w.label, '⌂ Open workspace');
  r.self.state.lnch = { ...lnchInit(), ws: { a: { busy: true, line: '' } } };
  const b = workspaceVals.call(r.self, { id: 'a' });
  assert.deepEqual([b.on, b.busy, b.label], [true, true, 'Opening…']); // enabled while busy so keyboard focus is kept
  assert.equal(workspaceVals.call(rig({ noBridge: true }).self, { id: 'a' }).on, false);
  r.self.state.lnch = { ...lnchInit(), ws: { a: { busy: false, line: 'Folder not found: rescan' } } };
  assert.equal(workspaceVals.call(r.self, { id: 'a' }).line, 'Folder not found: rescan');
});

// ------------------------------------------------------------------ palette
const labels = (self) => self.paletteItems().groups.flatMap((g) => g.items.map((i) => g.name + '|' + i.label));
test('palette: Open workspace rows only for a typed query; the empty palette is unchanged', async () => {
  const r = rig();
  const empty = labels(r.self);
  assert.ok(!empty.some((l) => /workspace|Launcher/i.test(l)), 'nothing about the Launcher in the empty palette');
  r.self.state.paletteQuery = 'workspace';
  assert.deepEqual(labels(r.self).filter((l) => l.startsWith("Do|") && /workspace/i.test(l)), ['Do|Open workspace · Project A', 'Do|Open workspace · Project B']);
  r.self.state.paletteQuery = 'open workspace project a';
  assert.deepEqual(labels(r.self).filter((l) => l.startsWith("Do|") && /workspace/i.test(l)), ['Do|Open workspace · Project A']);
  r.self.state.paletteQuery = 'open project b';
  assert.ok(labels(r.self).includes('Do|Open workspace · Project B') && labels(r.self).includes('Do|Open Project B'));
  r.self.state.paletteQuery = 'workspace';
  const item = r.self.paletteItems().flat.find((i) => i.label === 'Open workspace · Project A');
  item.run();
  await settle();
  assert.deepEqual(r.calls.filter((c) => c.startsWith('openWorkspace')), ['openWorkspace:a']);
  assert.ok(r.calls.includes('openProject:a'));
  const no = rig({ noBridge: true }); no.self.state.paletteQuery = 'workspace';
  assert.ok(!labels(no.self).some((l) => /Open workspace/.test(l)), 'no bridge, no rows');
});

test('palette: Set up Launcher appears only once the Launcher is read and no editor is chosen', async () => {
  const r = rig();
  r.self.state.paletteQuery = 'launcher';
  assert.ok(!labels(r.self).some((l) => /Set up Launcher/.test(l)), 'not read yet: not offered');
  await settle();
  assert.equal(r.calls.filter((c) => c === 'read:').length, 1, 'the palette read the Launcher once');
  assert.ok(!labels(r.self).some((l) => /Set up Launcher/.test(l)), 'an editor is chosen: not offered');
  await r.self.lnchRemove('aaaa0002');
  const sl = r.self.paletteItems().flat.find((i) => i.label === 'Set up Launcher');
  assert.ok(sl, 'no editor: offered');
  sl.run();
  assert.equal(r.self.state.settingsOpen, true);
  assert.equal(r.self.state.paletteOpen, false);
  r.self.state.paletteQuery = '';
  assert.ok(!labels(r.self).some((l) => /Set up Launcher/.test(l)), 'the empty palette never shows it (Commands lists its first four)');
});

// ------------------------------------------------------------------ the template reads only keys the vals have
test('every {{ lnchv.x }} the template reads exists in the vals, and every row key it reads exists on a row', async () => {
  const r = rig({ state: { settingsOpen: true } });
  await r.self.lnchLoad();
  const v = r.vals();
  const top = new Set([...tpl.matchAll(/lnchv\.(\w+)/g)].map((m) => m[1]));
  for (const k of top) assert.ok(k in v, 'lnchv.' + k + ' is missing from the vals');
  const rowKeys = (alias, list) => [...tpl.matchAll(new RegExp('\\{\\{ ' + alias + '\\.(\\w+) \\}\\}', 'g'))].map((m) => m[1]).forEach((k) => assert.ok(list.every((x) => k in x), alias + '.' + k + ' is missing on a row'));
  rowKeys('e', v.entries); rowKeys('a', v.adds);
  await r.self.lnchAllow('a', 'npm run dev');
  rowKeys('c', r.vals().cmds);
  assert.ok(!/\{\{[^}]*(\|\||&&|\?|\()/.test(tpl.replace(/\$\{[^}]*\}/g, '')), 'dc-lite: no expressions in bindings');
  assert.ok(!/transition|animation/.test(tpl), 'nothing animates');
});

// ------------------------------------------------------------------ batch 9 reviewer fixes
test('the line under Open workspace goes when the project page opens or its dev server starts, and never while a click is running', async () => {
  const r = rig();
  r.self.state.lnch = { ...lnchInit(), ws: { a: { busy: false, line: 'Dev server: not allowed yet. Press Allow and run.' } } };
  r.self.lnchClearLine('a');
  assert.deepEqual(r.self.state.lnch.ws.a, { busy: false, line: '' });
  r.self.state.lnch = { ...lnchInit(), ws: { a: { busy: true, line: '' }, b: { busy: false, line: 'x' } } };
  r.self.lnchClearLine('a');
  assert.equal(r.self.state.lnch.ws.a.busy, true, 'a running click keeps its place');
  r.self.lnchClearLine('nope');
  assert.equal(r.self.state.lnch.ws.b.line, 'x', 'another project is untouched');
});

test('a button for the editor already chosen is off; every label starts with what is shown on the button', () => {
  const r = rig();
  r.self.state.settingsOpen = true;
  r.self.state.lnch = { ...lnchInit(), loaded: true, data: { entries: [{ id: 'aaaa0001', kind: 'app', name: 'Example editor', host: '' }, { id: 'aaaa0002', kind: 'app', name: 'Other app', host: '' }], editor: 'aaaa0001', projects: [{ id: 'a', name: 'Project A', dev: 'unconfirmed' }], terminal: 'wt', locked: false, limit: 40 } };
  const v = r.vals();
  const cur = v.entries.find((e) => e.isEditor), other = v.entries.find((e) => !e.isEditor);
  assert.equal(cur.editorOff, true, 'pressing it again would only spend the hour\'s allowance');
  assert.equal(other.editorOff, false);
  assert.equal(cur.editorLabel, 'My editor');
  assert.ok(cur.editorAria.startsWith(cur.editorLabel), cur.editorAria);
  assert.ok(other.editorAria.startsWith(other.editorLabel), other.editorAria);
  for (const c of v.cmds) { assert.ok(c.allowAria.startsWith(c.allowLabel), c.allowAria); assert.ok(c.forgetAria.startsWith(c.forgetLabel), c.forgetAria); }
});

test('with no Launcher bridge the Open workspace line says why the button is off', () => {
  const none = workspaceVals.call(rig({ noBridge: true }).self, { id: 'a' });
  assert.equal(none.on, false);
  assert.equal(none.line, 'Open workspace needs the desktop app');
  const r = rig();
  r.self.state.lnch = { ...lnchInit(), ws: { a: { busy: false, line: 'Opened.' } } };
  assert.equal(workspaceVals.call(r.self, { id: 'a' }).line, 'Opened.');
});

test('lnchOpen says another launch is running for the working answer, not a limit', async () => {
  const r = rig({ answers: { open: { state: 'working' } } });
  await r.self.lnchOpen('aaaa0001');
  assert.equal(r.self.state.lnch.notice, WS_WORKING_TEXT);
});
