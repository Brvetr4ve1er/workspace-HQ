'use strict';
/* The dev server's real-process check (dashboard/dev-command.native.check.js), run by `node tools/gates.mjs --native` (step dev-native).

   dev-command.test.mjs proves the argument list and the checks with a fake spawn. Only a real process can say that the list works:

     1. `node server.js --port <free port>`: the real dev-command.js start() runs the invented server, found through the PATH search,
        as an argument list; the loopback port answers; stop() kills it and the port goes quiet.
     2. `npm run dev -- --port <free port>` (when npm is on the PATH): the child chain is npm -> node (a grandchild holds the port),
        so stopping proves `taskkill /t` takes the whole tree, not only the first process.

     3. `yarn dev` through a shim in a folder with spaces in its name: the System32 cmd.exe line keeps the outer quote pair (a path with a
        space broke without it).
     4. a leftover: a second instance with an empty server list sees the first one's child as running (real pid check, real start time
        read through the hidden System32 PowerShell) and its Stop takes it.

   What it never does: open a window, a terminal or a browser; it starts hidden, harmless children (windowsHide, stdio ignored), listens
   only on 127.0.0.1, and stops every child it started (also on a failure and on a timeout). It touches no data folder of the app:
   everything lives in one temp folder removed afterwards. It checks that programs can be FOUND and run hidden; it never opens an editor.

     node dashboard\dev-command.native.check.js

   Exit codes copy the other native checks: 0 clean, 1 a check failed, 2 timed out after 60 s. Windows only (elsewhere it prints a note and exits 0).
   HQ_DEVCMD_CHECK_PROFILE (set by the gate) only names the temp folder. */

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (process.platform !== 'win32') { console.log('[dev-native] not Windows: nothing to check here'); process.exit(0); }

const failures = [];
const note = (m) => console.log('[dev-native] ' + m);
const fail = (m) => { failures.push(m); console.log('[dev-native] FAIL ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const probe = (port) => new Promise((res) => { const c = net.connect({ port, host: '127.0.0.1' }); c.setTimeout(800); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); c.on('timeout', () => { c.destroy(); res(false); }); });
async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; }

const watchdog = setTimeout(() => { console.log('[dev-native] timed out after 60 s'); process.exit(2); }, 60000);
watchdog.unref();

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), (process.env.HQ_DEVCMD_CHECK_PROFILE || 'hq-devcmd-native') + '-'));
  const data = path.join(root, 'data'), proj = path.join(root, 'invented-project');
  fs.mkdirSync(data); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'server.js'), [
    "const http = require('http');",
    "const i = process.argv.indexOf('--port');",
    "const port = i > 0 ? Number(process.argv[i + 1]) : 0;",
    "http.createServer((q, r) => r.end('ok')).listen(port, '127.0.0.1');",
  ].join('\n'));
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'invented-project', scripts: { dev: 'node server.js' } }));

  const core = await import(pathToFileURL(path.join(__dirname, 'dev-command-core.mjs')).href);
  const { create } = require('./dev-command.js');
  const servers = new Map();
  const scan = { projects: [{ id: 'invented', name: 'Invented', path: proj, dev_cmd: '' }] };
  const dev = create({ dataDir: data, resolveProjectPath: (p) => (path.resolve(p) === path.resolve(proj) ? proj : null), latest: () => scan, servers, core });
  const started = [];

  async function round(label, cmd, port, inst = dev) {
    const dev_ = inst;
    scan.projects[0].dev_cmd = cmd;
    const a = await dev_.allow('invented', core.hashShown(cmd));
    if (a !== 'allowed') return fail(label + ': allow answered ' + a);
    const s = await dev_.start('invented');
    if (s !== 'started') return fail(label + ': start answered ' + s + ' (the program could not be found or run as a list)');
    started.push(servers.get('invented'));
    if (!await until(() => probe(port), 15000)) { fail(label + ': nothing answered on the loopback port'); dev_.stop('invented'); return; }
    note(label + ': answered on the loopback port');
    const stopped = dev_.stop('invented');
    if (!stopped) fail(label + ': stop answered false');
    if (!await until(async () => !(await probe(port)), 10000)) fail(label + ': the port still answered after stop (the tree was not taken)');
    else note(label + ': port quiet after stop');
    servers.clear();
  }

  try {
    const p1 = await pick();
    await round('node', 'node server.js --port ' + p1, p1);
    const hasNpm = String(process.env.PATH || '').split(';').some((d) => d && path.isAbsolute(d) && fs.existsSync(path.join(d, 'npm.cmd')));
    if (hasNpm) { const p2 = await pick(); await round('npm run', 'npm run dev -- --port ' + p2, p2); }
    else note('npm.cmd is not on the PATH: the npm round is skipped');

    // a runner shim in a folder whose name has a space (the case a global pnpm or yarn shim is in): goes through the System32 cmd.exe with the outer quote pair
    const p3 = await pick();
    const spaceDir = path.join(root, 'a folder with spaces'); fs.mkdirSync(spaceDir);
    fs.writeFileSync(path.join(spaceDir, 'yarn.cmd'), ['@echo off', '"' + process.execPath + '" "' + path.join(proj, 'server.js') + '" --port ' + p3, ''].join('\r\n'));
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const dev3 = create({ dataDir: data, resolveProjectPath: (p) => (path.resolve(p) === path.resolve(proj) ? proj : null), latest: () => scan, servers: new Map(), core, env: { PATH: spaceDir, SystemRoot: sysRoot } });
    await round('yarn shim in a folder with spaces', 'yarn dev', p3, dev3);

    // a leftover: a second instance (an app restarted: empty Map) sees the first one's child as running through the real pid check and
    // the real start time, and its Stop takes it; nothing happens until the owner's stop
    const p4 = await pick();
    scan.projects[0].dev_cmd = 'node server.js --port ' + p4;
    if (await dev.allow('invented', core.hashShown(scan.projects[0].dev_cmd)) !== 'allowed' || await dev.start('invented') !== 'started') fail('leftover: the first start did not run');
    else {
      started.push(servers.get('invented'));
      if (!await until(() => probe(p4), 15000)) fail('leftover: nothing answered');
      const again = create({ dataDir: data, resolveProjectPath: (p) => (path.resolve(p) === path.resolve(proj) ? proj : null), latest: () => scan, servers: new Map(), core });
      const w = await again.start('invented');
      if (w !== 'running') fail('leftover: a restarted app answered ' + w + ', want running');
      else note('leftover: seen as running by a restarted app');
      if (!await probe(p4)) fail('leftover: a start killed it');
      if (!again.stop('invented')) fail('leftover: the owner-click stop answered false');
      if (!await until(async () => !(await probe(p4)), 10000)) fail('leftover: the port still answered after the leftover stop'); else note('leftover: port quiet after the leftover stop');
      servers.clear();
    }
  } catch (e) { fail('unexpected: ' + (e && e.message)); }

  try { dev.killAll(); } catch { /* best effort */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ }
  clearTimeout(watchdog);
  if (failures.length) { console.log('[dev-native] ' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('[dev-native] all checks passed');
  process.exit(0);
})().catch((e) => { console.log('[dev-native] crashed: ' + (e && e.stack || e)); process.exit(1); });
