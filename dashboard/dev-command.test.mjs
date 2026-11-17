// node --test dashboard/dev-command.test.mjs
// The dev server's main side (dev-command.js) with a FAKE spawn and temp folders: no real process is started, no window opens.
// What these prove is the argument list and the checks; they cannot prove cmd.exe or a real runner (dev-command.native.check.js does that part).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as core from './dev-command-core.mjs';
import { hashShown } from './dev-command-core.mjs';

const require = createRequire(import.meta.url);
const { create, init, MAX_STARTS, MAX_ALLOWS } = require('./dev-command.js');
const { fromMain } = require('./main-gate.js');

const SYS = 'C:\\Windows';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-devcmd-'));
const cleanup = (t, d) => t.after(() => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } });

// a rig: data dir, a project folder, a PATH folder holding fake runners, a scan, and a fake spawn
function rig(t, o = {}) {
  const root = tmp(); cleanup(t, root);
  const data = path.join(root, 'data'), proj = path.join(root, 'proj'), bin = path.join(root, 'bin');
  fs.mkdirSync(data); fs.mkdirSync(proj); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', predev: 'node check.js', start: 'node server.js', ...(o.scripts || {}) } }));
  fs.writeFileSync(path.join(proj, 'server.js'), '// placeholder');
  for (const f of o.binFiles || ['npm.cmd', 'node.exe', 'pnpm.cmd', 'yarn.cmd', 'bun.exe']) fs.writeFileSync(path.join(bin, f), '');
  if (o.cli) { fs.mkdirSync(path.join(bin, 'node_modules', 'npm', 'bin'), { recursive: true }); fs.writeFileSync(path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), ''); }
  const scan = { projects: [{ id: 'proj-a', name: 'Project A', path: proj, dev_cmd: o.dev ?? 'npm run dev' }] };
  const calls = [], sync = [], status = [];
  const servers = new Map();
  let clock = 1_800_000_000_000;
  const spawn = (file, args, options) => {
    const p = new EventEmitter(); p.pid = 4000 + calls.length; calls.push({ file, args, options, proc: p });
    if (o.spawnThrows) throw new Error('spawn failed at ' + proc_path());
    return p;
  };
  const proc_path = () => proj;
  const dev = create({
    dataDir: data, resolveProjectPath: (p) => (path.resolve(p) === path.resolve(proj) ? proj : null), latest: () => scan, servers, sendStatus: (s) => status.push(s),
    spawn, spawnSync: (file, args, opts) => { sync.push({ file, args, opts }); return { status: 0, stdout: '' }; }, env: { PATH: o.path ?? bin, SystemRoot: SYS, GITHUB_TOKEN: 'placeholder', npm_config_x: 'y', TEMP: os.tmpdir() },
    platform: 'win32', now: () => clock, isAlive: o.isAlive, procStart: o.procStart, core,
  });
  const allowNow = async (text = scan.projects[0].dev_cmd) => dev.allow('proj-a', hashShown(text));
  return { root, data, proj, bin, scan, calls, sync, status, servers, dev, allowNow, tick: (ms) => { clock += ms; } };
}

test('an unconfirmed command spawns nothing, and the answer is a fixed word', async (t) => {
  const r = rig(t);
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed');
  assert.equal(r.calls.length, 0);
  assert.equal(r.servers.size, 0);
});

test('Allow then Start: shell false, an argument list, no stdio, hidden, the allowlisted environment, a start time', async (t) => {
  const r = rig(t, { cli: true });
  assert.equal(await r.allowNow(), 'allowed');
  assert.equal(await r.dev.start('proj-a'), 'started');
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.options.shell, false);
  assert.equal(c.options.stdio, 'ignore');
  assert.equal(c.options.windowsHide, true);
  assert.equal(c.options.cwd, fs.realpathSync(r.proj));
  assert.equal(c.options.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(c.options.env.GITHUB_TOKEN, undefined, 'tokens are not inherited');
  assert.equal(c.options.env.npm_config_x, undefined);
  assert.equal(c.options.env.SystemRoot, SYS);
  assert.ok(Array.isArray(c.args));
  assert.equal(c.file, path.join(r.bin, 'node.exe'), 'npm runs as node.exe <npm-cli.js>');
  assert.deepEqual(c.args, [path.join(r.bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'run', 'dev']);
  assert.ok(Number.isFinite(c.proc.__hqStartedAt), '__hqStartedAt is set (live-state reads it)');
  assert.equal(r.servers.get('proj-a'), c.proc);
  assert.deepEqual(r.status, [{ id: 'proj-a', running: true }]);
  assert.equal(await r.dev.start('proj-a'), 'running', 'a second start while it runs');
  assert.equal(r.calls.length, 1);
});

test('no spawn ever receives the scan text or a shell flag', async (t) => {
  const r = rig(t, { dev: 'npm run dev -- --port 5173', cli: true });
  await r.allowNow(); await r.dev.start('proj-a');
  for (const c of r.calls) {
    assert.ok(Array.isArray(c.args));
    assert.notEqual(c.options.shell, true);
    assert.ok(!String(c.file).includes('npm run dev'), 'the command text is never the program');
    assert.ok(!c.args.some((a) => /npm run dev/.test(a) && a.includes(' ')) || c.options.windowsVerbatimArguments === true);
  }
  assert.deepEqual(r.calls[0].args.slice(-3), ['--', '--port', '5173']);
});

test('without npm-cli.js the npm shim goes through the System32 cmd.exe with a verbatim line of allowed words only', async (t) => {
  const r = rig(t, { dev: 'npm run dev --port 3000' });
  await r.allowNow(); assert.equal(await r.dev.start('proj-a'), 'started');
  const c = r.calls[0];
  assert.equal(c.file, path.join(SYS, 'System32', 'cmd.exe'));
  assert.deepEqual(c.args, ['/d', '/s', '/c', '""' + path.join(r.bin, 'npm.cmd') + '" run dev --port 3000"']);
  assert.equal(c.options.windowsVerbatimArguments, true);
  assert.equal(c.options.shell, false);
});

test('pnpm, yarn, bun and node each resolve to a program found on the app’s own PATH', async (t) => {
  for (const [dev, file, tail] of [['pnpm dev', 'cmd.exe', null], ['yarn dev', 'cmd.exe', null], ['bun run dev', 'bun.exe', ['run', 'dev']], ['node server.js', 'node.exe', ['server.js']]]) {
    const r = rig(t, { dev, scripts: { dev: 'x' } });
    await r.allowNow(dev);
    assert.equal(await r.dev.start('proj-a'), 'started', dev);
    assert.equal(path.basename(r.calls[0].file), file, dev);
    if (tail) assert.deepEqual(r.calls[0].args, tail, dev);
    else assert.match(r.calls[0].args[3], /^"".*(pnpm|yarn)\.cmd" dev"$/, dev);
  }
});

test('a changed scan text, package.json script, pre script or .npmrc each forces a new Allow', async (t) => {
  const r = rig(t);
  await r.allowNow();
  assert.equal(await r.dev.start('proj-a'), 'started'); r.servers.clear();
  r.scan.projects[0].dev_cmd = 'npm run dev --port 1234';
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed', 'the scan text changed');
  r.scan.projects[0].dev_cmd = 'npm run dev';
  assert.equal(await r.dev.start('proj-a'), 'started', 'back to what was allowed'); r.servers.clear();
  const pkg = path.join(r.proj, 'package.json');
  const orig = fs.readFileSync(pkg, 'utf8');
  fs.writeFileSync(pkg, JSON.stringify({ scripts: { dev: 'vite --host', predev: 'node check.js' } }));
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed', 'the script changed');
  fs.writeFileSync(pkg, orig);
  assert.equal(await r.dev.start('proj-a'), 'started', 'restored'); r.servers.clear();
  fs.writeFileSync(pkg, JSON.stringify({ scripts: { dev: 'vite', predev: 'node evil.js' } }));
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed', 'the pre script changed');
  fs.writeFileSync(pkg, orig);
  fs.writeFileSync(path.join(r.proj, '.npmrc'), 'script-shell=placeholder');
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed', 'a .npmrc appeared');
  assert.equal(r.calls.length, 3);
});

test('Allow stores only when the text the owner saw is the text the scan holds now', async (t) => {
  const r = rig(t);
  assert.equal(await r.dev.allow('proj-a', hashShown('npm run something-else')), 'changed');
  assert.equal(fs.existsSync(path.join(r.data, 'launcher', 'dev-commands.json')), false, 'nothing stored');
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed');
  assert.equal(await r.dev.allow('proj-a', 'not-hex!'), 'refused');
  assert.equal(await r.dev.allow('proj-a', undefined), 'refused');
  assert.equal(await r.dev.allow('proj-a', hashShown('npm run dev')), 'allowed');
  const stored = JSON.parse(fs.readFileSync(path.join(r.data, 'launcher', 'dev-commands.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored), ['proj-a']);
  assert.deepEqual(stored['proj-a'].words, ['npm', 'run', 'dev']);
  assert.match(stored['proj-a'].key, /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(stored['proj-a'].confirmedAt) > 0);
});

test('a refused command is never stored and never started', async (t) => {
  for (const dev of ['npx vite', 'npm run dev && calc', 'node -e x', 'python -m http.server 1', '']) {
    const r = rig(t, { dev });
    assert.equal(await r.dev.allow('proj-a', hashShown(dev)), 'refused', dev);
    assert.equal(await r.dev.start('proj-a'), 'refused', dev);
    assert.equal(r.calls.length, 0);
  }
});

test('a script that is not in package.json, a node file that is not there, an unknown project and a bad id are refused', async (t) => {
  const a = rig(t, { dev: 'npm run absent' });
  assert.equal(await a.allowNow(), 'refused');
  const b = rig(t, { dev: 'node nope.js' });
  assert.equal(await b.allowNow(), 'refused');
  const c = rig(t);
  for (const id of ['unknown', '../x', 'A', '', null, 42, { id: 'x' }, 'x'.repeat(65)]) { assert.equal(await c.dev.start(id), 'refused'); assert.equal(await c.dev.allow(id, '00000000'), 'refused'); }
});

test('a node file that points outside the folder through a link is refused', async (t) => {
  const r = rig(t, { dev: 'node linked.js' });
  const outside = path.join(r.root, 'outside.js'); fs.writeFileSync(outside, '//');
  try { fs.symlinkSync(outside, path.join(r.proj, 'linked.js'), 'file'); } catch { return t.skip('no symlink right on this machine'); }
  assert.equal(await r.allowNow(), 'refused');
});

test('a runner found only inside the project folder is not used; a relative PATH entry is never searched', async (t) => {
  const r = rig(t, { binFiles: [] });
  fs.writeFileSync(path.join(r.proj, 'npm.cmd'), '');
  const inside = create({ dataDir: r.data, resolveProjectPath: () => r.proj, latest: () => r.scan, servers: new Map(), spawn: () => { throw new Error('must not spawn'); }, env: { PATH: r.proj + ';.;;..;relative\\dir', SystemRoot: SYS }, platform: 'win32', core });
  assert.equal(await inside.allow('proj-a', hashShown('npm run dev')), 'allowed');
  assert.equal(await inside.start('proj-a'), 'refused');
  const none = rig(t, { binFiles: [] });
  await none.allowNow(); assert.equal(await none.dev.start('proj-a'), 'refused', 'no runner on the PATH at all');
  assert.equal(none.calls.length, 0);
});

test('a runner path with a character cmd.exe would read is refused', async (t) => {
  const r = rig(t, { binFiles: [] });
  const odd = path.join(r.root, 'b&d'); fs.mkdirSync(odd); fs.writeFileSync(path.join(odd, 'npm.cmd'), '');
  const dev = create({ dataDir: r.data, resolveProjectPath: () => r.proj, latest: () => r.scan, servers: new Map(), spawn: () => { throw new Error('must not spawn'); }, env: { PATH: odd, SystemRoot: SYS }, platform: 'win32', core });
  assert.equal(await dev.allow('proj-a', hashShown('npm run dev')), 'allowed');
  assert.equal(await dev.start('proj-a'), 'refused');
});

test('10 starts an hour, then busy; the hour rolls', async (t) => {
  const r = rig(t, { cli: true });
  await r.allowNow();
  for (let i = 0; i < MAX_STARTS; i++) { assert.equal(await r.dev.start('proj-a'), 'started', 'start ' + i); r.servers.clear(); }
  assert.equal(await r.dev.start('proj-a'), 'busy');
  r.tick(3600e3 + 1);
  assert.equal(await r.dev.start('proj-a'), 'started');
});

test('20 allows an hour, then busy', async (t) => {
  const r = rig(t);
  for (let i = 0; i < MAX_ALLOWS; i++) assert.equal(await r.allowNow(), 'allowed');
  assert.equal(await r.allowNow(), 'busy');
});

test('a spawn that throws answers refused with no path in it; an error event clears the server and says so in fixed words', async (t) => {
  const bad = rig(t, { spawnThrows: true }); await bad.allowNow();
  assert.equal(await bad.dev.start('proj-a'), 'refused');
  assert.equal(bad.servers.size, 0);
  const r = rig(t); await r.allowNow(); await r.dev.start('proj-a');
  r.calls[0].proc.emit('error', new Error('ENOENT at ' + r.proj));
  assert.equal(r.servers.size, 0);
  assert.deepEqual(r.status.at(-1), { id: 'proj-a', running: false, error: 'could not start' });
  assert.ok(!JSON.stringify(r.status).includes(r.proj));
});

test('the close event clears the server and the leftover record, and reports the exit code', async (t) => {
  const r = rig(t); await r.allowNow(); await r.dev.start('proj-a');
  const running = path.join(r.data, 'launcher', 'running.json');
  assert.ok(fs.existsSync(running));
  assert.ok(JSON.parse(fs.readFileSync(running, 'utf8'))['proj-a'].pid > 0);
  r.calls[0].proc.emit('close', 1);
  assert.equal(r.servers.size, 0);
  assert.deepEqual(r.status.at(-1), { id: 'proj-a', running: false, code: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(running, 'utf8')), {});
});

test('Stop kills the tree of the live child with the System32 taskkill and says it stopped', async (t) => {
  const r = rig(t); await r.allowNow(); await r.dev.start('proj-a');
  assert.equal(r.dev.stop('proj-a'), true);
  assert.equal(r.sync.length, 1);
  assert.equal(r.sync[0].file, path.join(SYS, 'System32', 'taskkill.exe'));
  assert.deepEqual(r.sync[0].args, ['/pid', String(r.calls[0].proc.pid), '/f', '/t']);
  assert.equal(r.sync[0].opts.windowsHide, true);
  assert.equal(r.servers.size, 0);
  assert.deepEqual(r.status.at(-1), { id: 'proj-a', running: false });
  assert.equal(r.dev.stop('proj-a'), false, 'nothing left to stop');
  assert.equal(r.dev.stop(7), false);
});

test('killAll stops every tree and counts them', async (t) => {
  const r = rig(t); await r.allowNow(); await r.dev.start('proj-a');
  r.servers.set('other', { pid: 9001 });
  assert.equal(r.dev.killAll(), 2);
  assert.equal(r.servers.size, 0);
  assert.equal(r.sync.length, 2);
});

test('a leftover child: seen as running, killed only when pid and real start time both match, never on its own', async (t) => {
  const startedAt = 1_799_999_990_000;
  let real = startedAt + 2000, alive = true;
  const r = rig(t, { isAlive: () => alive, procStart: () => real });
  await r.allowNow();
  fs.mkdirSync(path.join(r.data, 'launcher'), { recursive: true });
  fs.writeFileSync(path.join(r.data, 'launcher', 'running.json'), JSON.stringify({ 'proj-a': { pid: 777, startedAt } }));
  assert.equal(await r.dev.start('proj-a'), 'running', 'the leftover is alive');
  assert.equal(r.calls.length, 0);
  assert.equal(r.sync.length, 0, 'nothing is killed by a start');
  assert.equal(r.dev.stop('proj-a'), true);
  assert.deepEqual(r.sync[0].args, ['/pid', '777', '/f', '/t']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.data, 'launcher', 'running.json'), 'utf8')), {});
  // a reused pid: alive, but its start time is another process's
  fs.writeFileSync(path.join(r.data, 'launcher', 'running.json'), JSON.stringify({ 'proj-a': { pid: 777, startedAt } }));
  real = startedAt + 10 * 60e3;
  r.sync.length = 0;
  assert.equal(r.dev.stop('proj-a'), false, 'a different start time is not ours');
  assert.equal(r.sync.length, 0);
  assert.equal(await r.dev.start('proj-a'), 'started', 'the stale record was dropped');
  // dead
  fs.writeFileSync(path.join(r.data, 'launcher', 'running.json'), JSON.stringify({ 'proj-a': { pid: 778, startedAt } }));
  alive = false; r.servers.clear();
  assert.equal(r.dev.stop('proj-a'), false);
});

test('a damaged store file is ignored; a store entry is a plain well-formed record', async (t) => {
  const r = rig(t);
  fs.mkdirSync(path.join(r.data, 'launcher'));
  fs.writeFileSync(path.join(r.data, 'launcher', 'dev-commands.json'), '{ not json');
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed');
  fs.writeFileSync(path.join(r.data, 'launcher', 'dev-commands.json'), JSON.stringify({ '__proto__': { words: ['npm'] }, 'proj-a': { words: ['npm', 'run', 'dev'], key: 'nope', confirmedAt: 'x' } }));
  assert.equal(await r.dev.start('proj-a'), 'unconfirmed');
  assert.equal(({}).words, undefined, 'nothing leaked onto Object.prototype');
});

// ---- the IPC wiring ---------------------------------------------------------------------------
function ipcRig(t) {
  const r = rig(t, { cli: true });
  const handlers = new Map();
  const wc = { isDestroyed: () => false, mainFrame: { url: 'file:///app/index.html' } };
  const win = { isDestroyed: () => false, webContents: wc };
  let killed = 0;
  const api = init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, getWin: () => win, dataDir: r.data, resolveProjectPath: () => r.proj, latest: () => r.scan, servers: r.servers, sendStatus: (s) => r.status.push(s), spawn: (f, a, o) => { const p = new EventEmitter(); p.pid = 1; r.calls.push({ file: f, args: a, options: o, proc: p }); return p; }, spawnSync: (f, a) => { r.sync.push({ file: f, args: a }); return { status: 0 }; }, env: { PATH: r.bin, SystemRoot: SYS }, platform: 'win32', core, afterKill: () => { killed += 1; } });
  const main = { sender: wc, senderFrame: wc.mainFrame };
  return { r, handlers, wc, main, api, killed: () => killed };
}

test('the four channels exist, and a call from another window, a subframe or a gone frame is refused with a fixed word and does nothing', async (t) => {
  const { r, handlers, wc, main } = ipcRig(t);
  assert.deepEqual([...handlers.keys()].sort(), ['hq:dev-allow', 'hq:dev-start', 'hq:dev-stop', 'hq:kill-servers']);
  const cast = { sender: { mainFrame: {} }, senderFrame: {} };
  const sub = { sender: wc, senderFrame: { url: 'file:///app/index.html' } };
  const gone = { sender: wc, senderFrame: null };
  const web = { sender: wc, senderFrame: wc.mainFrame }; const orig = wc.mainFrame.url;
  for (const ev of [cast, sub, gone, undefined]) {
    assert.equal(await handlers.get('hq:dev-start')(ev, { id: 'proj-a' }), 'refused');
    assert.equal(await handlers.get('hq:dev-allow')(ev, { id: 'proj-a', shownHash: hashShown('npm run dev') }), 'refused');
    assert.equal(await handlers.get('hq:dev-stop')(ev, 'proj-a'), false);
    assert.equal(await handlers.get('hq:kill-servers')(ev), 0);
  }
  wc.mainFrame.url = 'https://example.test/page';
  assert.equal(await handlers.get('hq:dev-start')(web, { id: 'proj-a' }), 'refused', 'an outside address');
  wc.mainFrame.url = orig;
  assert.equal(await handlers.get('hq:dev-allow')(main, { id: 'proj-a', shownHash: hashShown('npm run dev') }), 'allowed');
  assert.equal(r.calls.length, 0);
  assert.equal(fromMain(main, () => ({ isDestroyed: () => true })), false);
  assert.equal(fromMain(main, null), false);
});

test('from the main window: start takes { id } (a bare id too), allow takes { id, shownHash }, stop and kill answer, kill runs the refresh hook', async (t) => {
  const { r, handlers, main, killed } = ipcRig(t);
  assert.equal(await handlers.get('hq:dev-start')(main, { id: 'proj-a' }), 'unconfirmed');
  assert.equal(await handlers.get('hq:dev-start')(main, 'proj-a'), 'unconfirmed');
  assert.equal(await handlers.get('hq:dev-start')(main, { id: 5 }), 'refused');
  assert.equal(await handlers.get('hq:dev-start')(main, null), 'refused');
  assert.equal(await handlers.get('hq:dev-allow')(main, { id: 'proj-a' }), 'refused', 'no hash');
  assert.equal(await handlers.get('hq:dev-allow')(main, { id: 'proj-a', shownHash: hashShown('npm run dev') }), 'allowed');
  assert.equal(await handlers.get('hq:dev-start')(main, { id: 'proj-a' }), 'started');
  assert.equal(await handlers.get('hq:kill-servers')(main), 1);
  assert.equal(killed(), 1);
  assert.equal(r.servers.size, 0);
});

// ---- no module hands scanned text to a shell ----------------------------------------------------
test('no source file spawns dev_cmd text: main.js has no shell spawn of it and no error box naming the command', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => /\.(js|mjs)$/.test(f) && !/\.test\.|\.check\.|^data\.js$|^_data-cache\.js$/.test(f));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/dev_cmd/.test(src)) continue;
    assert.ok(!/spawn(Sync)?\(\s*(prod|p|project)\.dev_cmd/.test(src), f + ' spawns dev_cmd text');
    assert.ok(!/shell:\s*true/.test(src), f + ' uses shell: true next to dev_cmd');
  }
  const main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  assert.ok(!/prod\.dev_cmd/.test(main), 'main.js no longer reads a dev command');
  assert.ok(!/showErrorBox\(\s*'Dev server/.test(main), 'no error box with a path in it');
  assert.ok(/require\('\.\/dev-command'\)\.init\(/.test(main), 'main.js delegates to dev-command.js');
  const dc = fs.readFileSync(path.join(dir, 'dev-command.js'), 'utf8');
  assert.ok(!/shell:\s*true/.test(dc));
  assert.ok(/shell: false/.test(dc));
});

test('a shim in a folder with a space keeps the outer quote pair that cmd /s strips (the line is ""path" words")', async (t) => {
  const r = rig(t, { binFiles: [] });
  const spaced = path.join(r.root, 'a folder with spaces'); fs.mkdirSync(spaced); fs.writeFileSync(path.join(spaced, 'yarn.cmd'), '');
  const calls = [];
  const dev = create({ dataDir: r.data, resolveProjectPath: () => r.proj, latest: () => ({ projects: [{ id: 'proj-a', path: r.proj, dev_cmd: 'yarn dev --port 4000' }] }), servers: new Map(), spawn: (f, a, o) => { const p = new EventEmitter(); p.pid = 1; calls.push({ f, a, o }); return p; }, env: { PATH: spaced, SystemRoot: SYS }, platform: 'win32', core });
  assert.equal(await dev.allow('proj-a', hashShown('yarn dev --port 4000')), 'allowed');
  assert.equal(await dev.start('proj-a'), 'started');
  assert.deepEqual(calls[0].a, ['/d', '/s', '/c', '""' + path.join(spaced, 'yarn.cmd') + '" dev --port 4000"']);
  assert.equal(calls[0].o.windowsVerbatimArguments, true);
});

test('fromMain accepts the main frame by identity or by its ids, and refuses another frame with other ids', () => {
  const mainFrame = { url: 'file:///app/index.html', processId: 3, routingId: 1 };
  const wc = { isDestroyed: () => false, mainFrame };
  const win = { isDestroyed: () => false, webContents: wc };
  assert.equal(fromMain({ sender: wc, senderFrame: mainFrame }, () => win), true);
  assert.equal(fromMain({ sender: wc, senderFrame: { url: 'file:///app/index.html', processId: 3, routingId: 1 } }, () => win), true, 'another wrapper of the same frame');
  assert.equal(fromMain({ sender: wc, senderFrame: { url: 'file:///app/index.html', processId: 3, routingId: 2 } }, () => win), false, 'a subframe');
  assert.equal(fromMain({ sender: wc, senderFrame: { url: 'file:///app/index.html' } }, () => win), false, 'no ids, not the same object');
  assert.equal(fromMain({ sender: {}, senderFrame: mainFrame }, () => win), false, 'another webContents');
});

test('state: none without a command, unconfirmed before an allow, allowed after, unconfirmed again once the script changes; it spawns nothing', async (t) => {
  const r = rig(t);
  assert.equal(await r.dev.state('nope'), 'none');
  assert.equal(await r.dev.state('../x'), 'none');
  assert.equal(await r.dev.state('proj-a'), 'unconfirmed');
  assert.equal(await r.allowNow(), 'allowed');
  assert.equal(await r.dev.state('proj-a'), 'allowed');
  fs.writeFileSync(path.join(r.proj, 'package.json'), JSON.stringify({ scripts: { dev: 'vite --other' } }));
  assert.equal(await r.dev.state('proj-a'), 'unconfirmed');
  r.scan.projects[0].dev_cmd = 'npx something';
  assert.equal(await r.dev.state('proj-a'), 'refused');
  assert.equal(r.calls.length, 0);
});
