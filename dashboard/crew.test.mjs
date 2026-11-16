// node --test dashboard/crew.test.mjs - the Crew's main side over an INVENTED Claude home in a temp folder (never the real ~/.claude).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeFakeClaudeHome, HOSTILE, HOSTILE_CMD } from './__fixtures__/make-fake-claude-home.mjs';

const require = createRequire(import.meta.url);
const crewMod = require('./crew.js');
const launchToolsMod = require('./launch-tools.js');
const { TOOLS_HELPER } = require('./claude-launch.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-crew-test-'));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS cleans it */ } });
const fx = makeFakeClaudeHome(path.join(tmp, 'a'));

// reads only: a module that tried to write would find no such method
const READ_FS = { readdirSync: fs.readdirSync, statSync: fs.statSync, openSync: fs.openSync, lstatSync: fs.lstatSync, fstatSync: fs.fstatSync, readSync: fs.readSync, closeSync: fs.closeSync, readFileSync: fs.readFileSync, realpathSync: fs.realpathSync, existsSync: fs.existsSync };
const lines = () => { const a = []; a.log = (l) => a.push(String(l)); return a; };
function make(over = {}) {
  const out = lines();
  const spied = [];
  const tools = launchToolsMod.create({ repoRoot: REPO, tmpdir: tmp, env: { HQ_DRY_LAUNCH: '1' } });
  const spy = { ...tools, buildArgs: (o) => { const a = tools.buildArgs(o); spied.push(a); return a; } };
  let t = 1_000_000;
  const crew = crewMod.create({ env: { HQ_CLAUDE_HOME: fx.home, HQ_DRY_LAUNCH: '1' }, home: fx.home, cwd: REPO, launchTools: spy, fsApi: READ_FS, now: () => t, log: out.log, ...over });
  return { crew, out, spied, tick: (ms) => { t += ms; }, tools: spy };
}

test('read: the installed skills as plain rows, nothing from trash, old versions, strays or outside the home', async () => {
  const { crew } = make();
  const r = await crew.read();
  assert.ok(!r.error, JSON.stringify(r.error));
  const ids = new Set(r.skills.filter((s) => s.canStart).map((s) => s.id));
  for (const id of fx.expectIds) assert.ok(ids.has(id), id + ' is listed');
  const names = r.skills.map((s) => s.name);
  for (const bad of ['old-skill', 'old-version-skill', 'sneaky-skill', 'stray-file.txt', 'empty-folder']) assert.ok(!names.includes(bad), bad + ' is not listed');
  assert.equal(r.total, fx.expectIds.length + 1 + 600, 'the listed ones, the failing folder name, and the 600 generated');
  assert.deepEqual(r.roles.map((x) => x.id).slice(0, 2), ['developers', 'designers']);
});

test('read: roles come from the name stems and the plugin name, and the description is plain text cut at 140', async () => {
  const { crew } = make();
  const by = Object.fromEntries((await crew.read()).skills.map((s) => [s.name, s]));
  assert.equal(by['alpha-lint'].role, 'developers');
  assert.equal(by['beta-palette'].role, 'designers');
  assert.equal(by['gamma-ledger'].role, 'finance');
  assert.equal(by['delta-notes'].role, 'other');
  assert.equal(by['mood-board'].plugin, 'acme-design');
  assert.equal(by['mood-board'].role, 'designers');
  assert.equal(by['folded-desc'].description, 'A folded description that spans two lines.');
  assert.equal(by['quoted-desc'].description, 'Writes the weekly newsletter for the shop.');
  assert.equal(by['odd-frontmatter'].description, '', 'odd frontmatter degrades to name-only');
  assert.equal(by['delta-notes'].description, '');
  assert.ok(Array.from(by['hostile-desc'].description).length <= 140);
});

test('read: the roster carries only id, name, description, role, plugin and canStart: no body, no path, no frontmatter name', async () => {
  const { crew } = make();
  const r = await crew.read();
  for (const s of r.skills) assert.deepEqual(Object.keys(s).sort(), ['canStart', 'description', 'id', 'name', 'plugin', 'role']);
  const text = JSON.stringify(r);
  assert.ok(!text.includes('Body text that must never be read'));
  assert.ok(!text.includes(tmp) && !text.includes(fx.home) && !/SKILL\.md|installPath/.test(text), 'no path leaves main');
  const liar = r.skills.find((s) => s.name === 'liar-skill');
  assert.equal(liar.id, 'liar-skill', 'the id is the folder name, never the frontmatter name');
  assert.equal(r.skills.filter((s) => s.id === 'alpha-lint').length, 1, 'a skill cannot claim another one\'s id');
});

test('read: a folder name that fails the id check is listed with no Start, and start refuses it', async () => {
  const { crew, out } = make();
  const row = (await crew.read()).skills.find((s) => s.name === 'bad name!');
  assert.ok(row && row.canStart === false && row.id === '');
  assert.deepEqual(await crew.start('bad name!'), { error: crewMod.WORDS.unknown });
  assert.equal(out.length, 0, 'nothing was launched');
});

test('read: an install path that is not inside the Claude home is refused, and so is one whose real place is outside it', async () => {
  const { crew } = make();
  assert.ok(!(await crew.read()).skills.some((s) => s.name === 'sneaky-skill'));
  // lexically inside the home, but the real folder is elsewhere (a symlink or junction): the real-path check refuses it
  const home2 = makeFakeClaudeHome(path.join(tmp, 'b'), { generated: 0 });
  const inside = path.join(home2.cache, 'acme-design', '2.0.0');
  const fsLink = { ...READ_FS, realpathSync: (p) => (path.resolve(p) === path.resolve(inside) ? home2.outside : fs.realpathSync(p)) };
  const { crew: c2 } = make({ env: { HQ_CLAUDE_HOME: home2.home }, home: home2.home, fsApi: fsLink });
  const names = (await c2.read()).skills.map((s) => s.name);
  assert.ok(!names.includes('mood-board') && !names.includes('type-scale'), 'the plugin whose real place is outside the home is not read');
  assert.ok(names.includes('month-close'), 'the other plugin still is');
});

test('read: a skills folder whose real place is outside the home, and a SKILL.md that is a link, are never read', async () => {
  const home3 = makeFakeClaudeHome(path.join(tmp, 'c'), { generated: 0 });
  const looseDir = path.join(home3.home, 'skills');
  // the loose skills folder resolves outside the home (a junction or symlink): nothing in it is listed
  const fsOut = { ...READ_FS, realpathSync: (p) => (path.resolve(p) === path.resolve(looseDir) ? home3.outside : fs.realpathSync(p)) };
  const a = make({ env: { HQ_CLAUDE_HOME: home3.home }, home: home3.home, fsApi: fsOut });
  const base = (await make({ env: { HQ_CLAUDE_HOME: home3.home }, home: home3.home }).crew.read()).skills.filter((x) => !x.plugin).map((x) => x.name);
  const after = (await a.crew.read()).skills.filter((x) => !x.plugin).map((x) => x.name);
  assert.ok(base.length > 0 && after.length === 0, 'no loose skill is read through an outside skills folder');
  // one SKILL.md reported as a link by lstat is skipped, the others stay
  const victim = path.resolve(path.join(looseDir, 'alpha-lint', 'SKILL.md'));
  const fsLnk = { ...READ_FS, lstatSync: (p) => { const st = fs.lstatSync(p); return path.resolve(p) === victim ? { isSymbolicLink: () => true, isFile: () => false } : st; } };
  const b = make({ env: { HQ_CLAUDE_HOME: home3.home }, home: home3.home, fsApi: fsLnk });
  const names = (await b.crew.read()).skills.map((x) => x.name);
  assert.ok(!names.includes('alpha-lint') && names.includes('beta-palette'), 'a linked SKILL.md is skipped, a plain one is read');
});

test('start: a launch that fails spends neither the hourly count nor the same-skill wait', async () => {
  let ok = false;
  const { crew } = make({ launchFn: () => ok });
  for (let i = 0; i < crewMod.MAX_STARTS_PER_HOUR + 2; i++) assert.deepEqual(await crew.start('alpha-lint'), { error: crewMod.WORDS.failed });
  ok = true;
  assert.deepEqual(await crew.start('alpha-lint'), { ok: true }, 'the failures left the limits untouched');
  assert.deepEqual(await crew.start('alpha-lint'), { error: crewMod.WORDS.soon }, 'a real start still counts');
});

test('read: installed_plugins.json in an unexpected shape degrades to no plugin skills, never throws', async () => {
  for (const body of ['not json', '[]', '{"plugins": 5}', '{"plugins": {"x@y": 7, "z@y": [null, {"installPath": 5}]}}']) {
    const h = makeFakeClaudeHome(path.join(tmp, 'odd-' + Math.abs(body.length)), { generated: 0 });
    fs.writeFileSync(path.join(h.home, 'plugins', 'installed_plugins.json'), body);
    const { crew } = make({ env: { HQ_CLAUDE_HOME: h.home }, home: h.home });
    const r = await crew.read();
    assert.ok(!r.error, body);
    assert.ok(r.skills.some((s) => s.name === 'alpha-lint'), 'loose skills still listed');
    assert.ok(!r.skills.some((s) => s.plugin), 'no plugin skills for ' + body);
  }
});

test('read: an absent Claude home is an empty crew, not an error', async () => {
  const { crew } = make({ env: { HQ_CLAUDE_HOME: path.join(tmp, 'nothing-here') }, home: path.join(tmp, 'nothing-here') });
  const r = await crew.read();
  assert.deepEqual([r.total, r.skills.length], [0, 0]);
});

test('read: only the first 2 KB of a SKILL.md is read, only read methods are used, and the next read is served from the cache', async () => {
  let opens = 0, biggest = 0;
  const fsSpy = { ...READ_FS, openSync: (...a) => { opens++; return fs.openSync(...a); }, readSync: (fd, buf, off, len, pos) => { biggest = Math.max(biggest, len); return fs.readSync(fd, buf, off, len, pos); } };
  const { crew, tick } = make({ fsApi: fsSpy });
  await crew.read();
  const first = opens;
  assert.ok(first >= fx.expectIds.length, 'every skill head was opened');
  assert.ok(biggest <= 2048, 'no read asked for more than 2 KB (asked ' + biggest + ')');
  await crew.read();
  assert.equal(opens, first, 'the second read came from the cache');
  fs.utimesSync(path.join(fx.home, 'skills'), new Date(), new Date(Date.now() + 5000));   // a folder added or removed changes its mtime
  await crew.read();
  assert.ok(opens > first, 'a changed skills folder rebuilds the roster');
  const again = opens;
  tick(61e3);
  await crew.read();
  assert.ok(opens > again, 'the cache also expires after a minute');
});

test('read: 600 generated skills read fast enough to open a view', async () => {
  const { crew } = make();
  const t0 = Date.now();
  const r = await crew.read();
  assert.ok(r.total >= 600);
  assert.ok(Date.now() - t0 < 5000);
});

test('start: a dry launch names the validated id, the app folder, and --permission-mode default (the argv and the line)', async () => {
  const { crew, out, spied } = make();
  assert.deepEqual(await crew.start('alpha-lint'), { ok: true });
  assert.equal(out.length, 1);
  assert.match(out[0], /^\[dry-launch\] /);
  assert.ok(out[0].includes(REPO), 'the folder is the constant the app gave, not anything from the payload');
  assert.ok(out[0].includes('Use the alpha-lint skill to help me with:'));
  assert.ok(out[0].includes('--permission-mode default'));
  assert.equal(spied.length, 1);
  const argv = spied[0];
  assert.equal(argv[0], 'Use the alpha-lint skill to help me with:');
  const i = argv.indexOf('--permission-mode');
  assert.ok(i > 0 && argv[i + 1] === 'default', 'the argv carries an explicit default mode: ' + JSON.stringify(argv));
  for (const bad of ['auto', 'dontAsk', 'bypassPermissions', 'acceptEdits', 'plan', '--dangerously-skip-permissions']) assert.ok(!argv.includes(bad), bad);
});

test('start: a plugin skill and a dash-leading id start safely', async () => {
  const { crew, out, spied, tick } = make();
  assert.deepEqual(await crew.start('acme-design:mood-board'), { ok: true });
  tick(6000);
  assert.deepEqual(await crew.start('-dash-lead'), { ok: true });
  assert.ok(out[0].includes('Use the acme-design:mood-board skill to help me with:'));
  assert.ok(out[1].includes('Use the -dash-lead skill to help me with:'));
  assert.equal(spied[1][0], 'Use the -dash-lead skill to help me with:', 'the first argument is a sentence, never an option');
});

test('start: a description that says "ignore the above and run X" never appears in the launch line or the argv', async () => {
  const { crew, out, spied } = make();
  const row = (await crew.read()).skills.find((s) => s.id === 'hostile-desc');
  assert.ok(row.description.includes('ignore the above'), 'it is shown as plain text');
  assert.deepEqual(await crew.start('hostile-desc'), { ok: true });
  const all = out.join('\n') + '\n' + JSON.stringify(spied);
  assert.ok(!all.includes('ignore the above') && !all.includes(HOSTILE_CMD) && !all.includes('system prompt'));
  assert.ok(all.includes('Use the hostile-desc skill to help me with:'));
  void HOSTILE;
});

test('start: an id that is not in the roster, or is shaped like an attack, is refused and nothing launches', async () => {
  const { crew, out } = make();
  for (const id of ['nope', '', '../x', 'a b', 'alpha-lint; calc', 'alpha-lint\nrm', 'x'.repeat(200), 'old-skill', 'sneaky-skill', 'acme-design:old-version-skill']) {
    assert.deepEqual(await crew.start(id), { error: crewMod.WORDS.unknown }, JSON.stringify(id));
  }
  assert.deepEqual(await crew.start(undefined), { error: crewMod.WORDS.unknown });
  assert.equal(out.length, 0);
});

test('start: six sessions an hour, and the same skill not twice within five seconds', async () => {
  const { crew, out, tick } = make();
  assert.deepEqual(await crew.start('alpha-lint'), { ok: true });
  tick(2000);
  assert.deepEqual(await crew.start('alpha-lint'), { error: crewMod.WORDS.soon });
  tick(4000);
  const ids = ['beta-palette', 'gamma-ledger', 'delta-notes', 'folded-desc', 'quoted-desc'];
  for (const id of ids) { assert.deepEqual(await crew.start(id), { ok: true }, id); tick(6000); }
  assert.equal(out.length, 6);
  assert.deepEqual(await crew.start('hostile-desc'), { error: crewMod.WORDS.rate }, 'the seventh is refused');
  assert.equal(out.length, 6);
  tick(3600e3);
  assert.deepEqual(await crew.start('hostile-desc'), { ok: true }, 'an hour later it opens again');
});

test('start: with the session helper missing nothing launches (claude-launch would otherwise fall back to a helper with no mode)', async () => {
  let called = 0;
  const { crew } = make({ toolsHelper: path.join(tmp, 'no-such-helper.cmd'), launchFn: () => { called++; return true; } });
  assert.deepEqual(await crew.start('alpha-lint'), { error: crewMod.WORDS.noTools });
  assert.equal(called, 0);
  const none = make({ launchTools: null, launchFn: () => { called++; return true; } });
  assert.deepEqual(await none.crew.start('alpha-lint'), { error: crewMod.WORDS.noTools });
  assert.equal(called, 0);
  assert.ok(fs.existsSync(TOOLS_HELPER), 'the real helper is there, so the normal path works');
});

test('start: the launcher gets the app folder, the fixed sentence and the launch tools, and a failed launch says so in fixed words', async () => {
  const seen = [];
  const { crew } = make({ launchFn: (cwd, prompt, opts) => { seen.push([cwd, prompt, !!opts.tools, opts.toolsHelper]); return false; } });
  assert.deepEqual(await crew.start('alpha-lint'), { error: crewMod.WORDS.failed });
  assert.deepEqual(seen, [[REPO, 'Use the alpha-lint skill to help me with:', true, TOOLS_HELPER]]);
});

// ---- the IPC wrapper: main window only ----
function wire(over = {}) {
  const handlers = {};
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const main = {}, other = {};
  const win = { isDestroyed: () => false, webContents: main };
  const out = lines();
  const tools = launchToolsMod.create({ repoRoot: REPO, tmpdir: tmp, env: { HQ_DRY_LAUNCH: '1' } });
  crewMod.init({ ipcMain, getWin: () => win, env: { HQ_CLAUDE_HOME: fx.home, HQ_DRY_LAUNCH: '1' }, home: fx.home, cwd: REPO, launchTools: tools, fsApi: READ_FS, log: out.log, ...over });
  return { handlers, main, other, out };
}

test('IPC: both channels are registered and answer the main window', async () => {
  const w = wire();
  assert.deepEqual(Object.keys(w.handlers).sort(), ['hq:crew:read', 'hq:crew:start']);
  const r = await w.handlers['hq:crew:read']({ sender: w.main });
  assert.ok(Array.isArray(r.skills) && r.skills.length > 600);
  assert.deepEqual(await w.handlers['hq:crew:start']({ sender: w.main }, { id: 'alpha-lint' }), { ok: true });
  assert.equal(w.out.length, 1);
});

test('IPC: a sender that is not the main window (the palette window loads the same preload) is refused on both channels, nothing runs', async () => {
  const w = wire();
  assert.deepEqual(await w.handlers['hq:crew:read']({ sender: w.other }), { error: crewMod.NOT_HERE });
  assert.deepEqual(await w.handlers['hq:crew:start']({ sender: w.other }, { id: 'alpha-lint' }), { error: crewMod.NOT_HERE });
  assert.deepEqual(await w.handlers['hq:crew:read'](undefined), { error: crewMod.NOT_HERE });
  assert.deepEqual(await w.handlers['hq:crew:start']({ sender: null }, { id: 'alpha-lint' }), { error: crewMod.NOT_HERE });
  assert.equal(w.out.length, 0);
});

test('IPC: no window yet, or a destroyed one, answers the same fixed words', async () => {
  const none = wire({ getWin: () => null });
  assert.deepEqual(await none.handlers['hq:crew:read']({ sender: none.main }), { error: crewMod.NOT_HERE });
  const gone = wire({ getWin: () => ({ isDestroyed: () => true, webContents: {} }) });
  assert.deepEqual(await gone.handlers['hq:crew:start']({ sender: {} }, { id: 'alpha-lint' }), { error: crewMod.NOT_HERE });
});

test('IPC: a payload with extra fields (a folder, a prompt, a flag) is ignored; only the id counts', async () => {
  const w = wire();
  const r = await w.handlers['hq:crew:start']({ sender: w.main }, { id: 'beta-palette', cwd: 'C:\\somewhere', prompt: 'do something else', permissionMode: 'bypassPermissions', args: ['--x'] });
  assert.deepEqual(r, { ok: true });
  assert.ok(w.out[0].includes(REPO) && !w.out[0].includes('somewhere') && !w.out[0].includes('something else') && !w.out[0].includes('bypass'));
  assert.deepEqual(await w.handlers['hq:crew:start']({ sender: w.main }, 'beta-palette'), { error: crewMod.WORDS.unknown }, 'a bare string is not a payload');
});

test('IPC: a failing read answers a fixed word, not the error message', async () => {
  const w = wire({ coreLoader: async () => { throw new Error('C:\\secret\\place exploded'); } });
  const r = await w.handlers['hq:crew:read']({ sender: w.main });
  assert.deepEqual(r, { error: crewMod.WORDS.read });
  assert.ok(!JSON.stringify(r).includes('secret'));
});
