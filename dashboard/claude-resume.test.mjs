// The one Resume helper: refusals, the explicit permission mode, the env-only id, the per-run MCP config.
// Fakes only: a recording spawn, a fake hub, temp folders. Nothing opens a terminal. Placeholder data (the repo is public).
//   node --test dashboard/claude-resume.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const R = require('./claude-resume.js');
const { FORBIDDEN_ARGS } = require('./claude-chat.js');

const ID = '11111111-1111-4111-8111-111111111111';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-resume-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const work = path.join(ROOT, 'work', 'alpha-site');                 // the session's folder
const repo = path.join(ROOT, 'repo');                               // stands in for this repo
const home = path.join(ROOT, 'claude-home');
const FOLDER = 'C--work-alpha-site';
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.join(repo, 'mcp', 'workspacehq'), { recursive: true });
fs.writeFileSync(path.join(repo, 'mcp', 'workspacehq', 'server.mjs'), '// placeholder server');
fs.mkdirSync(path.join(home, 'projects', FOLDER), { recursive: true });
fs.writeFileSync(path.join(home, 'projects', FOLDER, ID + '.jsonl'), '{}\n');

function rig(o = {}) {
  const spawns = [], logs = [];
  const conv = { id: 'code:' + ID, source: 'code', project_id: 'code:' + FOLDER, cwd: work, ...(o.conv || {}) };
  const hubCalls = [];
  const hub = o.hub === undefined ? { request: async (op, a) => { hubCalls.push([op, a]); return o.noConv ? null : { conversation: conv, messages: [] }; } } : o.hub;
  const spawn = (cmd, args, opts) => {
    spawns.push({ cmd, args, opts });
    const ee = new EventEmitter();
    ee.unref = () => {};
    process.nextTick(() => (o.spawnError ? ee.emit('error', new Error('no cmd')) : ee.emit('spawn')));
    return ee;
  };
  const tmp = path.join(ROOT, 'tmp-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(tmp);
  const env = { HQ_CLAUDE_HOME: home, SystemRoot: 'C:\\Windows', USERPROFILE: path.join(ROOT, 'userhome'), ProgramFiles: 'C:\\Program Files', ...(o.env || {}) };
  const r = R.create({ hub, repoRoot: o.repoRoot === undefined ? repo : o.repoRoot, env, spawn, log: (l) => logs.push(l), tmpdir: tmp });
  return { r, spawns, logs, hubCalls, tmp, conv };
}

test('HQ_DRY_LAUNCH logs the argv and spawns nothing', async () => {
  const f = rig({ env: { HQ_DRY_LAUNCH: '1' } });
  assert.deepEqual(await f.r.resume(ID), { ok: true, dry: true });
  assert.equal(f.spawns.length, 0);
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /^\[dry-resume\] .*alpha-site :: claude --resume 1{8}-1{4}-4111-8111-1{12} --permission-mode default --mcp-config /);
  f.r.cleanup();
});

test('a non-UUID id is refused before the hub is asked', async () => {
  const f = rig();
  for (const bad of ['', 'nope', '../../etc/passwd', ID + ' --dangerously-skip-permissions', 42, null, undefined, { id: ID }]) {
    const out = await f.r.resume(bad);
    assert.match(out.error, /^refused: not a Claude Code session id$/, String(bad));
  }
  assert.equal(f.hubCalls.length, 0);
  assert.equal(f.spawns.length, 0);
});

test('both the bare UUID and the Hub id code:<uuid> are accepted', async () => {
  const f = rig();
  assert.deepEqual(await f.r.resume('code:' + ID), { ok: true });
  assert.deepEqual(f.hubCalls[0], ['getConversation', { id: 'code:' + ID, limit: 1 }]);
  f.r.cleanup();
});

test('cwdRefusal cases: drive root, Windows folder, Program Files, the user folder, a network path', async () => {
  const cases = [
    ['C:\\', /a drive root/],
    ['C:\\Windows\\System32', /the Windows folder/],
    ['C:\\Program Files\\Alpha', /Program Files/],
    [path.join(ROOT, 'userhome'), /your user folder itself/],
    ['\\\\server\\share\\alpha', /a network or device path/],
  ];
  for (const [cwd, re] of cases) {
    const f = rig({ conv: { cwd } });
    const out = await f.r.resume(ID);
    assert.match(out.error, re, cwd);
    assert.equal(f.spawns.length, 0);
  }
});

test('a relative cwd, a quoted cwd, a missing folder and a file are refused', async () => {
  for (const [cwd, re] of [['alpha-site', /^refused: the folder is not an absolute folder/], [work + '"&calc', /quote or control|no longer exists|not a folder/], [path.join(ROOT, 'gone'), /no longer exists/], [path.join(repo, 'mcp', 'workspacehq', 'server.mjs'), /not a folder/], [null, /not an absolute folder/]]) {
    const f = rig({ conv: { cwd } });
    const out = await f.r.resume(ID);
    assert.match(out.error, re, String(cwd));
    assert.equal(f.spawns.length, 0);
  }
  const f = rig({ conv: { cwd: 'C:/work/"alpha"' } });
  assert.match((await f.r.resume(ID)).error, /quote or control/);
});

test('a chat that is not an indexed Code chat, or no longer in the Hub, is refused', async () => {
  assert.match((await rig({ conv: { source: 'web' } }).r.resume(ID)).error, /not an indexed Claude Code chat/);
  assert.match((await rig({ noConv: true }).r.resume(ID)).error, /not an indexed Claude Code chat/);
  assert.match((await rig({ hub: null }).r.resume(ID)).error, /Claude Hub isn’t running/);
  assert.match((await rig({ hub: { request: async () => { throw new Error('boom'); } } }).r.resume(ID)).error, /couldn’t answer · boom/);
});

test('a missing transcript is refused with the 30-day reason; a hostile project folder is too', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const f = rig();
  const out = await f.r.resume(other);   // the fake hub answers every id with the same conversation row, whose transcript is ID's
  assert.equal(out.error, R.TRANSCRIPT_GONE);
  assert.match(out.error, /older than 30 days/);
  assert.match(out.error, /Claude › Chats/);
  for (const folder of ['code:..', 'code:a/b', 'code:a\\b', 'code:', 'code:.']) {
    const g = rig({ conv: { project_id: folder } });
    assert.equal((await g.r.resume(ID)).error, R.TRANSCRIPT_GONE, folder);
  }
  assert.equal(R.transcriptPath(home, 'code:' + FOLDER, ID), path.join(home, 'projects', FOLDER, ID + '.jsonl'));
  assert.equal(R.transcriptPath(home, 'code:' + FOLDER, 'not-an-id'), null);
});

test('the spawn: static helper, the session folder as cwd, the id ONLY in env, default permission mode', async () => {
  const f = rig({ env: { HQ_RESUME_PROMPT: 'inherited text', HQ_MCP_CONFIG: 'inherited' } });
  assert.deepEqual(await f.r.resume(ID), { ok: true });
  assert.equal(f.spawns.length, 1);
  const { cmd, args, opts } = f.spawns[0];
  assert.equal(cmd, 'cmd.exe');
  assert.equal(args.length, 1);
  assert.ok(args[0].startsWith('/d /v:off /c start "" cmd /d /v:off /k "'));
  assert.ok(args[0].endsWith('claude-resume.cmd"'));
  assert.ok(!args[0].includes(ID), 'no id on the command line');
  assert.ok(!args[0].includes(work), 'no path on the command line');
  assert.equal(opts.cwd, work);
  assert.equal(opts.env.HQ_RESUME_ID, ID);
  assert.equal(opts.env.HQ_RESUME_PROMPT, undefined, 'an inherited prompt never leaks through');
  f.r.cleanup();
});

test('buildArgs: always --permission-mode default, never auto / dontAsk / bypassPermissions / a forbidden flag', () => {
  const a = R.buildArgs({ id: ID });
  assert.deepEqual(a, ['--resume', ID, '--permission-mode', 'default']);
  assert.deepEqual(R.buildArgs({ id: ID, say: 'continue', mcpConfig: '/x/mcp.json' }), ['--resume', ID, '--permission-mode', 'default', 'continue', '--mcp-config', '/x/mcp.json']);
  for (const bad of ['auto', 'dontAsk', 'bypassPermissions', ...FORBIDDEN_ARGS]) {
    assert.throws(() => R.buildArgs({ id: ID, mcpConfig: bad }), /refused/, bad);
  }
  assert.throws(() => R.buildArgs({ id: 'x' }), /bad session id/);
  for (const opt of [{}, { say: 'continue' }, { mcpConfig: '/x/mcp.json' }]) {
    const argv = R.buildArgs({ id: ID, ...opt });
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'default');
    for (const m of ['auto', 'dontAsk', 'bypassPermissions']) assert.ok(!argv.includes(m));
  }
});

test('claude-resume.cmd carries exactly the flags buildArgs builds, and branches with labels', () => {
  const text = fs.readFileSync(R.HELPER, 'utf8');
  assert.match(text, /\r\n/);
  assert.match(text, /@setlocal DisableDelayedExpansion/);
  const claudeLines = text.split(/\r?\n/).filter((l) => /^@claude /.test(l));
  assert.equal(claudeLines.length, 4);
  for (const l of claudeLines) {
    assert.ok(l.includes('--resume "%HQ_RESUME_ID%" --permission-mode default'), l);
    assert.ok(!/\b(auto|dontAsk|bypassPermissions)\b/.test(l), l);
    for (const f of FORBIDDEN_ARGS) assert.ok(!l.includes(f), l);
  }
  assert.equal(claudeLines.filter((l) => l.includes('--mcp-config "%HQ_MCP_CONFIG%"')).length, 2);
  assert.equal(claudeLines.filter((l) => l.includes('"%HQ_RESUME_PROMPT%"')).length, 2);
  assert.ok(/goto withmcp/.test(text) && /^:withmcp/m.test(text));
  assert.ok(!/^\s*@?if .*\(/m.test(text), 'no if (...) block: a ")" in a value would close it');
});

test('HQ_RESUME_PROMPT is only ever the word continue', async () => {
  const f = rig();
  await f.r.resume(ID, { say: 'continue' });
  assert.equal(f.spawns[0].opts.env.HQ_RESUME_PROMPT, 'continue');
  for (const bad of ['rm -rf /', 'Continue', 'continue now', 7, {}, '']) {
    const g = rig();
    const out = await g.r.resume(ID, { say: bad });
    assert.match(out.error, /only the word "continue"/, JSON.stringify(bad));
    assert.equal(g.spawns.length, 0);
  }
  f.r.cleanup();
});

test('--mcp-config is present outside the repo and absent inside it', async () => {
  const out = rig();
  await out.r.resume(ID);
  const cfg = out.spawns[0].opts.env.HQ_MCP_CONFIG;
  assert.ok(cfg && cfg.endsWith('mcp.json'));
  const json = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.equal(json.mcpServers.workspacehq.args[0], path.join(repo, 'mcp', 'workspacehq', 'server.mjs'));
  out.r.cleanup();

  const inside = rig({ conv: { cwd: path.join(repo, 'dashboard') } });
  fs.mkdirSync(path.join(repo, 'dashboard'), { recursive: true });
  assert.deepEqual(await inside.r.resume(ID), { ok: true });
  assert.equal(inside.spawns[0].opts.env.HQ_MCP_CONFIG, undefined);
  assert.equal(fs.readdirSync(inside.tmp).length, 0, 'no config folder is made for a session inside the repo');

  const noServer = rig({ repoRoot: path.join(ROOT, 'elsewhere') });
  await noServer.r.resume(ID);
  assert.equal(noServer.spawns[0].opts.env.HQ_MCP_CONFIG, undefined, 'no server file, no config');
});

test('one config folder per run, made by mkdtemp, and the quit hook removes it', async () => {
  const f = rig();
  await f.r.resume(ID);
  await f.r.resume(ID);
  await f.r.resume(ID, { say: 'continue' });
  const dirs = fs.readdirSync(f.tmp);
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /^hq-resume-mcp-/);
  assert.equal(f.spawns[0].opts.env.HQ_MCP_CONFIG, f.spawns[2].opts.env.HQ_MCP_CONFIG);
  assert.ok(fs.existsSync(f.spawns[0].opts.env.HQ_MCP_CONFIG), 'still there right after the spawn');

  const handlers = {};
  const app = { on: (ev, fn) => { handlers[ev] = fn; } };
  const g = R.init({ hub: { request: async () => ({ conversation: f.conv }) }, app, repoRoot: repo, env: { HQ_CLAUDE_HOME: home }, spawn: () => { const e = new EventEmitter(); process.nextTick(() => e.emit('spawn')); return e; }, tmpdir: f.tmp, log() {} });
  await g.resume(ID);
  assert.equal(fs.readdirSync(f.tmp).length, 2);
  assert.equal(typeof handlers['before-quit'], 'function');
  handlers['before-quit']();
  assert.equal(fs.readdirSync(f.tmp).length, 1);
  f.r.cleanup();
  assert.equal(fs.readdirSync(f.tmp).length, 0);
  handlers['will-quit']();   // a second cleanup is harmless
});

test('a double click starts one terminal; a spawn failure is an honest error', async () => {
  const f = rig();
  const [a, b] = await Promise.all([f.r.resume(ID), f.r.resume(ID)]);
  assert.equal(f.spawns.length, 1);
  assert.deepEqual([a, b].filter((x) => x.ok).length, 1);
  assert.match([a, b].find((x) => x.error).error, /already starting/);
  assert.equal(f.r._inflight.size, 0);
  f.r.cleanup();
  const g = rig({ spawnError: true });
  assert.match((await g.r.resume(ID)).error, /Couldn’t open a terminal · no cmd/);
  g.r.cleanup();
});
