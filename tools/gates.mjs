// tools/gates.mjs: the one gate command. Runs every step in order (never in parallel), one summary table, exit 0 only if all passed.
//   node tools/gates.mjs                       the full gate
//   node tools/gates.mjs --only main,tools     just those steps          --list   the step ids
//   node tools/gates.mjs --settle              the cdp button sweeps wait for the page instead of sleeping
//   node tools/gates.mjs --sweep-compare       old sweep then settled sweep, every finding compared
// The logic lives in tools/gates-core.mjs (tested with a fake io). This file is only the real io: it spawns node and electron
// children, and the ONLY processes it ever stops are children it started itself (by their own pid). It never looks at, lists or
// kills any other electron.exe, and the app's own --user-data-dir instance is never a target. No network, no installs.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCatalog, parseArgs, runGates, runSweepCompare, USAGE } from './gates-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_OUTPUT = 8 * 1024 * 1024;   // keep the last 8 MB of a step's output

function electronPath() {
  if (process.env.HQ_GATES_ELECTRON) return process.env.HQ_GATES_ELECTRON;
  return path.join(ROOT, 'dashboard', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
}

// stop a child this process started (its own pid and its own tree), nothing else
function stopOwnChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.pid === undefined) return resolve();
    const done = () => resolve();
    child.once('exit', done);
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { setTimeout(done, 300); });
    else { try { child.kill('SIGKILL'); } catch { /* already gone */ } setTimeout(done, 300); }
    setTimeout(done, 5000);
  });
}

function collect(child) {
  let out = '';
  const add = (b) => { out += b.toString('utf8'); if (out.length > MAX_OUTPUT) out = out.slice(out.length - MAX_OUTPUT); };
  if (child.stdout) child.stdout.on('data', add);
  if (child.stderr) child.stderr.on('data', add);
  return () => out;
}

function resolveSpec(spec) {
  const cmd = spec.cmd === 'node' ? process.execPath : spec.cmd === 'electron' ? electronPath() : spec.cmd;
  if (spec.cmd === 'electron' && !fs.existsSync(cmd)) throw new Error('electron not found at ' + cmd + ' (run npm install in dashboard/, or set HQ_GATES_ELECTRON)');
  return { cmd, args: spec.args || [], cwd: path.resolve(ROOT, spec.cwd || '.'), env: Object.assign({}, process.env, spec.env || {}) };
}

export function makeRealIo({ log = (l) => console.log(l) } = {}) {
  const profiles = new Set();
  return {
    now: () => Date.now(),
    log,
    run(spec, { timeoutMs }) {
      const t0 = Date.now(), r = resolveSpec(spec);
      return new Promise((resolve) => {
        const child = spawn(r.cmd, r.args, { cwd: r.cwd, env: r.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const output = collect(child);
        let timedOut = false, settled = false;
        const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, out: output(), timedOut, ms: Date.now() - t0 }); };
        const timer = setTimeout(() => { timedOut = true; stopOwnChild(child).then(() => finish(null)); }, timeoutMs);
        child.on('error', (e) => { timedOut = false; finish(1); });
        child.on('close', (code) => finish(code === null ? 1 : code));
      });
    },
    async start(spec) {
      const r = resolveSpec(spec);
      const child = spawn(r.cmd, r.args, { cwd: r.cwd, env: r.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = collect(child);
      child.on('error', () => {});
      return { pid: child.pid, stop: () => stopOwnChild(child), output };
    },
    freePort() {
      return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
      });
    },
    uniqueProfile(tag) {
      const name = 'hq-gates-' + String(tag).replace(/[^a-z0-9-]/gi, '') + '-' + process.pid + '-' + Date.now().toString(36);
      profiles.add(name);
      return name;
    },
    async cleanupProfile(name) {
      // only a folder this run named itself, only directly under the OS temp dir
      if (!profiles.has(name) || !/^hq-gates-[a-z0-9-]+$/i.test(name)) return;
      profiles.delete(name);
      try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* leftover temp data is harmless */ }
    },
    async countFiles(pattern) {
      try { return fs.globSync ? fs.globSync(pattern, { cwd: ROOT }).length : 1; } catch { return 1; }
    },
  };
}

export async function main(argv, io = makeRealIo()) {
  const parsed = parseArgs(argv);
  if (parsed.error) { console.error('[gates] ' + parsed.error + '\n' + USAGE); return 2; }
  const { opts } = parsed;
  const catalog = buildCatalog();
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.list) { for (const s of catalog) console.log(s.id.padEnd(16) + (s.native ? '(--native) ' : '') + s.title); return 0; }
  const res = opts.sweepCompare ? await runSweepCompare({ io, opts }) : await runGates({ catalog, opts, io });
  if (res.error) { console.error('[gates] ' + res.error + '\n' + USAGE); return 2; }
  console.log('\n' + res.text);
  return res.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('[gates] ' + ((e && e.stack) || e)); process.exit(2); });
}
