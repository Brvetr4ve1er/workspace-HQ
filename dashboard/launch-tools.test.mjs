// The tools a quest / project launch carries: the per-launch MCP config, the explicit permission mode, the helper .cmd.
// Fakes and temp folders only; the one cmd.exe test runs a fake claude on a PATH that cannot reach the real one.
// Placeholder data (the repo is public).
//   node --test dashboard/launch-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require('./launch-tools.js');
const { FORBIDDEN_ARGS } = require('./claude-chat.js');
const { sanitizePrompt, promptEnvValue } = require('./claude-launch.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-launchtools-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const repo = path.join(ROOT, 'repo');
const work = path.join(ROOT, 'work', 'alpha-site');
fs.mkdirSync(path.join(repo, 'mcp', 'workspacehq'), { recursive: true });
fs.mkdirSync(path.join(repo, 'dashboard'), { recursive: true });
fs.mkdirSync(work, { recursive: true });
const SERVER = path.join(repo, 'mcp', 'workspacehq', 'server.mjs');
fs.writeFileSync(SERVER, '// placeholder server');

function rig(o = {}) {
  const tmp = path.join(ROOT, 'tmp-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(tmp);
  const logs = [];
  const t = L.create({ repoRoot: o.repoRoot === undefined ? repo : o.repoRoot, tmpdir: o.tmpdir || tmp, env: o.env || {}, log: (l) => logs.push(l), ...(o.now ? { now: o.now } : {}), ...(o.platform ? { platform: o.platform } : {}), ...(o.fsApi ? { fsApi: o.fsApi } : {}) });
  return { t, tmp, logs };
}
const folders = (tmp) => fs.readdirSync(tmp);

// ---------------------------------------------------------------- prepare
test('outside the repo: one folder per call, a parsable mcp.json naming the absolute server path', () => {
  const f = rig();
  const a = f.t.prepare(work), b = f.t.prepare(work);
  assert.ok(a.mcpConfig && b.mcpConfig);
  assert.notEqual(a.mcpConfig, b.mcpConfig);
  assert.notEqual(path.dirname(a.mcpConfig), path.dirname(b.mcpConfig));
  assert.equal(folders(f.tmp).length, 2);
  for (const d of folders(f.tmp)) assert.ok(d.startsWith('hq-launch-mcp-'), d);
  const cfg = JSON.parse(fs.readFileSync(a.mcpConfig, 'utf8'));
  assert.deepEqual(cfg, { mcpServers: { workspacehq: { command: 'node', args: [SERVER] } } });
  assert.ok(path.isAbsolute(cfg.mcpServers.workspacehq.args[0]));
  assert.deepEqual(f.t._files(), [a.mcpConfig, b.mcpConfig]);
});

test('inside the repo (the folder itself, a subfolder, a trailing slash) there is no config', () => {
  const f = rig();
  for (const cwd of [repo, path.join(repo, 'dashboard'), repo + path.sep, path.join(repo, 'dashboard') + path.sep, path.join(repo, 'dashboard', '..')]) {
    assert.deepEqual(f.t.prepare(cwd), { mcpConfig: null }, cwd);
  }
  assert.equal(folders(f.tmp).length, 0);
  // a sibling whose name only starts like the repo's is outside it
  const sibling = repo + '-other';
  fs.mkdirSync(sibling, { recursive: true });
  assert.ok(f.t.prepare(sibling).mcpConfig);
});

test('Windows compares case-insensitively; a case-sensitive platform does not', () => {
  const w = L.create({ repoRoot: 'C:\\Work\\Repo', tmpdir: path.join(ROOT, 'nowhere'), platform: 'win32', fsApi: { existsSync: () => true, mkdtempSync: () => { throw new Error('must not write inside the repo'); } } });
  for (const cwd of ['c:\\work\\repo', 'C:\\WORK\\REPO\\Dashboard', 'C:/Work/Repo/', 'c:\\work\\repo\\']) assert.deepEqual(w.prepare(cwd), { mcpConfig: null }, cwd);
  const p = L.create({ repoRoot: '/work/Repo', tmpdir: '/tmp', platform: 'linux', fsApi: { existsSync: () => true, mkdtempSync: (x) => x + 'abc', writeFileSync: () => {}, rmSync: () => {} } });
  assert.deepEqual(p.prepare('/work/Repo/sub'), { mcpConfig: null });
  assert.ok(p.prepare('/work/repo/sub').mcpConfig, 'a different case is another folder on a case-sensitive platform');
});

test('no server file, no repoRoot, a bad cwd: no config and nothing written', () => {
  const noServer = path.join(ROOT, 'norepo');
  fs.mkdirSync(noServer);
  const a = rig({ repoRoot: noServer });
  assert.deepEqual(a.t.prepare(work), { mcpConfig: null });
  const b = rig({ repoRoot: null });
  assert.deepEqual(b.t.prepare(work), { mcpConfig: null });
  const c = rig();
  for (const bad of ['', null, undefined, 7, {}]) assert.deepEqual(c.t.prepare(bad), { mcpConfig: null });
  for (const x of [a, b, c]) assert.equal(folders(x.tmp).length, 0);
});

test('a quote or control character in the temp path yields null and writes nothing', () => {
  const tmp = path.join(ROOT, 'quoted');
  fs.mkdirSync(tmp);
  for (const bad of [tmp + '"x', tmp + '\nx', tmp + '\tx']) {
    const calls = [];
    const f = rig({ tmpdir: bad, fsApi: { existsSync: () => true, mkdtempSync: (...a) => { calls.push(a); return 'x'; }, writeFileSync: () => {} } });
    assert.deepEqual(f.t.prepare(work), { mcpConfig: null }, JSON.stringify(bad));
    assert.equal(calls.length, 0);
  }
  assert.equal(folders(tmp).length, 0);
});

test('a write that fails gives null, logs once, and removes the half-made folder', () => {
  const f = rig({ fsApi: { ...fs, writeFileSync: () => { throw new Error('disk full'); } } });
  assert.deepEqual(f.t.prepare(work), { mcpConfig: null });
  assert.equal(folders(f.tmp).length, 0);
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /could not write an MCP config · disk full/);
});

test('dry prepare answers the same question and writes no folder', () => {
  const f = rig({ env: { HQ_DRY_LAUNCH: '1' } });
  const r = f.t.prepare(work);
  assert.ok(r.mcpConfig && r.mcpConfig.startsWith(f.tmp));
  assert.deepEqual(f.t.prepare(repo), { mcpConfig: null });
  const g = rig();
  assert.ok(g.t.prepare(work, { dry: true }).mcpConfig);
  assert.equal(folders(f.tmp).length + folders(g.tmp).length, 0);
  assert.deepEqual(f.t._files(), []);
});

// ---------------------------------------------------------------- cleanup / sweepStale
test('cleanup and sweepStale remove only hq-launch-mcp-* folders older than 24 h', () => {
  const tmp = path.join(ROOT, 'sweep');
  fs.mkdirSync(tmp);
  const mk = (name, ageMs) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'mcp.json'), '{}');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(d, t, t);
    return d;
  };
  const H = 3600e3;
  const old1 = mk('hq-launch-mcp-AAAA', 25 * H), old2 = mk('hq-launch-mcp-BBBB', 72 * H);
  const fresh = mk('hq-launch-mcp-CCCC', 2 * H), edge = mk('hq-launch-mcp-DDDD', 23 * H);
  const other = mk('hq-resume-mcp-EEEE', 100 * H), plain = mk('some-folder', 100 * H), near = mk('hq-launch-mcp-', 100 * H);
  const strayFile = path.join(tmp, 'hq-launch-mcp-FFFF');
  fs.writeFileSync(strayFile, 'a file, not a folder');
  fs.utimesSync(strayFile, new Date(Date.now() - 100 * H), new Date(Date.now() - 100 * H));
  const t = L.create({ repoRoot: repo, tmpdir: tmp });
  assert.equal(t.sweepStale(), 2);
  assert.ok(!fs.existsSync(old1) && !fs.existsSync(old2));
  for (const keep of [fresh, edge, other, plain, near, strayFile]) assert.ok(fs.existsSync(keep), keep);
  assert.equal(t.cleanup(), 0, 'a second pass finds nothing left that is old');
});

test('cleanup keeps this run\'s own folders (a launched terminal may outlive the app) until they are a day old', () => {
  const f = rig();
  const a = f.t.prepare(work).mcpConfig;
  assert.equal(f.t.cleanup(), 0);
  assert.ok(fs.existsSync(a));
  const later = L.create({ repoRoot: repo, tmpdir: f.tmp, now: () => Date.now() + 25 * 3600e3 });
  assert.equal(later.sweepStale(), 1);
  assert.ok(!fs.existsSync(path.dirname(a)));
});

test('sweepStale survives an unreadable temp folder', () => {
  const t = L.create({ repoRoot: repo, tmpdir: path.join(ROOT, 'does-not-exist') });
  assert.equal(t.sweepStale(), 0);
});

// ---------------------------------------------------------------- buildArgs
test('buildArgs: the prompt first, the mode always present, --mcp-config last', () => {
  const f = rig();
  assert.deepEqual(f.t.buildArgs({ prompt: 'fix the thing' }), ['fix the thing', '--permission-mode', 'default']);
  const cfg = path.join(ROOT, 'x y', 'mcp.json');
  const withMcp = f.t.buildArgs({ prompt: 'fix the thing', mcpConfig: cfg });
  assert.deepEqual(withMcp, ['fix the thing', '--permission-mode', 'default', '--mcp-config', cfg]);
  assert.equal(withMcp.at(-2), '--mcp-config');
  assert.ok(withMcp.indexOf('fix the thing') < withMcp.indexOf('--mcp-config'));
  for (const a of withMcp) assert.ok(!(a.includes('fix the thing') && a.includes(cfg)), 'prompt and config path are never one argument');
  assert.deepEqual(f.t.buildArgs({}), ['', '--permission-mode', 'default']);
  assert.deepEqual(f.t.buildArgs({ prompt: null, mcpConfig: null }), ['', '--permission-mode', 'default']);
});

test('buildArgs refuses bypassPermissions, the skip flags, auto, dontAsk and any unknown mode', () => {
  const f = rig();
  for (const mode of ['bypassPermissions', 'auto', 'dontAsk', 'Default', 'yolo', '', 7, {}]) {
    assert.throws(() => f.t.buildArgs({ prompt: 'p', mode }), /refused: permission mode/, JSON.stringify(mode));
  }
  for (const mode of ['default', 'acceptEdits', 'plan']) assert.equal(f.t.buildArgs({ prompt: 'p', mode })[2], mode);
  for (const flag of FORBIDDEN_ARGS.concat('--dangerously-skip-permissions')) {
    assert.throws(() => f.t.buildArgs({ prompt: 'please run ' + flag }), /refused/, flag);
    assert.throws(() => f.t.buildArgs({ prompt: 'p', mcpConfig: '/x/' + flag }), /refused/, flag);
  }
  for (const bad of ['C:\\a"b.json', 'C:\\a\nb.json', 42]) assert.throws(() => f.t.buildArgs({ prompt: 'p', mcpConfig: bad }), /bad MCP config path/);
  assert.deepEqual(L.BAD_MODES.slice().sort(), ['auto', 'bypassPermissions', 'dontAsk']);
  assert.equal(L.LAUNCH_MODE, 'default');
});

// ---------------------------------------------------------------- the helper .cmd
test('claude-launch-tools.cmd carries exactly the flags buildArgs emits, with labels, no if block, delayed expansion off', () => {
  const text = fs.readFileSync(L.HELPER, 'utf8');
  assert.equal(path.basename(L.HELPER), 'claude-launch-tools.cmd');
  assert.match(text, /\r\n/);
  assert.ok(!/[^\r]\n/.test(text), 'CRLF line ends only');
  assert.match(text, /@setlocal DisableDelayedExpansion/);
  const claudeLines = text.split(/\r?\n/).filter((l) => /^@claude /.test(l));
  assert.equal(claudeLines.length, 2);
  const f = rig();
  const plain = f.t.buildArgs({ prompt: '%HQ_LAUNCH_PROMPT%' });
  const mcp = f.t.buildArgs({ prompt: '%HQ_LAUNCH_PROMPT%', mcpConfig: '%HQ_MCP_CONFIG%' });
  const render = (argv) => '@claude ' + argv.map((a) => (/^--/.test(a) || a === 'default' ? a : '"' + a + '"')).join(' ');
  assert.deepEqual(claudeLines, [render(plain), render(mcp)]);
  assert.ok(claudeLines[1].endsWith('--mcp-config "%HQ_MCP_CONFIG%"'), '--mcp-config is last');
  for (const l of claudeLines) {
    assert.ok(l.startsWith('@claude "%HQ_LAUNCH_PROMPT%" --permission-mode default'), l);
    assert.ok(!/\b(auto|dontAsk|bypassPermissions|acceptEdits|plan)\b/.test(l), l);
    for (const x of FORBIDDEN_ARGS) assert.ok(!l.includes(x), l);
  }
  assert.ok(/goto withmcp/.test(text) && /^:withmcp/m.test(text) && /^:done/m.test(text));
  assert.ok(!/^\s*@?if .*\(/m.test(text), 'no if (...) block: a ")" in a value would close it');
  assert.ok(!/!/.test(text.replace(/^@rem .*$/gm, '')), 'no exclamation marks in the code lines');
});

// ---------------------------------------------------------------- dry line, end to end
test('a dry launch with a hostile prompt logs the sanitized text and starts nothing, no folder written', () => {
  const hostile = 'a & b | c ) %PATH% q "quoted"\r\nnext';
  const f = rig({ env: { HQ_DRY_LAUNCH: '1' } });
  const spawns = [];
  const p = sanitizePrompt(hostile);
  assert.equal(p, "a & b | c ) %PATH% q 'quoted' next");
  const { mcpConfig } = f.t.prepare(work);
  const args = f.t.buildArgs({ prompt: p, mcpConfig });
  const line = f.t.dryLine(work, p, args);
  assert.equal(line, `[dry-launch] ${work} :: ${p} :: --permission-mode default --mcp-config ${mcpConfig}`);
  assert.match(line, /^\[dry-launch\] .+ :: a & b \| c \) %PATH% q 'quoted' next :: --permission-mode default --mcp-config /);
  assert.equal(spawns.length, 0);
  assert.equal(folders(f.tmp).length, 0);
  // inside the repo the line has no config part
  const inside = f.t.prepare(repo);
  assert.equal(f.t.dryLine(repo, p, f.t.buildArgs({ prompt: p, mcpConfig: inside.mcpConfig })), `[dry-launch] ${repo} :: ${p} :: --permission-mode default`);
});

// ---------------------------------------------------------------- the real cmd parse, made harmless
// The helper runs under cmd.exe with PATH holding ONLY a temp dir with a fake claude.cmd (npm shim shape) plus System32,
// so the real claude can never run. The fake records the argv it got; it must equal buildArgs' output exactly.
test('end to end: claude receives exactly buildArgs\' argv, a hostile prompt stays inert text', { skip: process.platform !== 'win32' && 'cmd.exe only' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-launchtools-e2e-'));
  try {
    const bin = path.join(base, 'fakebin');
    fs.mkdirSync(bin);
    const out = path.join(base, 'argv.jsonl');
    fs.writeFileSync(path.join(bin, 'printer.js'),
      `require('fs').appendFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`);
    fs.writeFileSync(path.join(bin, 'claude.cmd'), ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
      'SETLOCAL', 'CALL :find_dp0', `"${process.execPath}" "%dp0%printer.js"   %*`, ''].join('\r\n'));
    const root = process.env.SystemRoot || 'C:\\Windows';
    const env = { SystemRoot: root, PATH: `${bin};${path.join(root, 'System32')}`, PATHEXT: '.COM;.EXE;.BAT;.CMD',
      NoDefaultCurrentDirectoryInExePath: '1', TEMP: os.tmpdir(), TMP: os.tmpdir(), OS: 'Windows_NT' };
    const marker = path.join(base, 'INJECTED.txt');
    const cwd = path.join(base, 'proj dir');
    fs.mkdirSync(cwd);
    const cfg = path.join(base, 'cfg dir', 'mcp.json');
    fs.mkdirSync(path.dirname(cfg));
    const t = L.create({ repoRoot: repo, tmpdir: base });
    const prompts = ['plain prompt', 'a & b | c ) %PATH% q', `a & type nul > ${marker} & rem`, 'x < y > z', 'caret ^ here ^', 'pct %OS% and %PATH%',
      'bang !OS! lone ! end', 'paren ( ) @ amp &', 'say "hi" now', 'trailing \\', 'two \\\\', 'café ✓', ''];
    for (const withMcp of [false, true]) {
      for (const raw of prompts) {
        const p = sanitizePrompt(raw);
        const extra = { HQ_LAUNCH_PROMPT: promptEnvValue(p) };
        if (withMcp) extra.HQ_MCP_CONFIG = cfg;
        fs.rmSync(out, { force: true });
        const r = childProcess.spawnSync('cmd.exe', [`/d /v:off /c "${L.HELPER}"`], {
          cwd, env: { ...env, ...extra }, encoding: 'utf8', input: '', timeout: 30000, windowsVerbatimArguments: true,
        });
        assert.equal(r.status, 0, `${withMcp} :: ${raw} :: ${r.stderr}`);
        const lines = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n') : [];
        assert.equal(lines.length, 1, `claude ran exactly once for ${JSON.stringify([withMcp, raw])}`);
        assert.deepEqual(JSON.parse(lines[0]), { argv: t.buildArgs({ prompt: p, mcpConfig: withMcp ? cfg : null }), cwd }, JSON.stringify([withMcp, raw]));
      }
    }
    assert.equal(fs.existsSync(marker), false, 'no prompt text ever ran as a command');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
