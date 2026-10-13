// dashboard/claude-hub-host.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { create, init, nodeOk, findNode } = require('./claude-hub-host.js');

const fakeHub = (dir, body) => { const f = path.join(dir, 'fake-hub.mjs'); fs.writeFileSync(f, body); return f; };
const ECHO = `import readline from 'node:readline';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ event: 'ready', data: { role: 'writer' } });
readline.createInterface({ input: process.stdin }).on('line', (l) => { const r = JSON.parse(l);
  if (r.op === 'health') out({ id: r.id, ok: true, result: { state: 'ready', role: 'writer', counts: { projects: 1, conversations: 2, messages: 3 } } });
  else if (r.op === 'slow') {} else out({ id: r.id, ok: false, error: 'unknown op' }); });`;
const dirs = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS may still hold a file a moment */ } } });
const thisNode = () => ({ cmd: process.execPath, version: process.version, ok: true });
const until = async (cond, ms = 4000) => { for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise((r) => setTimeout(r, 25)); return cond(); };

test('nodeOk / findNode: version floor 22.13 and missing node', () => {
  assert.equal(nodeOk('v22.13.0'), true); assert.equal(nodeOk('v22.12.9'), false); assert.equal(nodeOk('v22.5.0'), false); assert.equal(nodeOk('v25.6.1'), true); assert.equal(nodeOk('garbage'), false);
  assert.deepEqual(findNode({ env: {}, run: () => ({ status: 0, stdout: 'v20.18.1\n' }) }), { cmd: 'node', version: 'v20.18.1', ok: false });
  assert.equal(findNode({ env: {}, run: () => { throw new Error('ENOENT'); } }), null);
});

test('no Node ≥ 22.13 → state no-node, health says so, requests answer honestly', async () => {
  const sent = [];
  const h = create({ hubScript: 'x', dbFile: 'y', findNodeFn: () => ({ cmd: 'node', version: 'v20.1.0', ok: false }), send: (c, d) => sent.push([c, d]) });
  h.start();
  assert.deepEqual(await h.health(), { state: 'no-node', node: 'v20.1.0', error: 'Claude Hub needs Node 22.13 or newer (found v20.1.0)' });
  assert.deepEqual(await h.request('health'), { error: 'hub not running' });
  assert.equal(sent.at(-1)[0], 'hq:claude-hub:event');
});

test('spawns the hub, routes requests, times out, forwards events, restarts after a crash', async () => {
  const dir = tmp('hub-host-');
  const script = fakeHub(dir, ECHO);
  const sent = [];
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: () => ({ cmd: process.execPath, version: process.version, ok: true }),
    send: (c, d) => sent.push([c, d]), backoff: [50, 50] });
  h.start();
  try {
    const hl = await h.health();
    assert.equal(hl.state, 'ready'); assert.equal(hl.counts.conversations, 2);
    assert.deepEqual(await h.request('slow', {}, { timeout: 100 }), { error: 'timeout' });
    assert.ok(sent.some(([c, d]) => c === 'hq:claude-hub:event' && d.event === 'ready'));
    h._child().kill();
    for (let i = 0; i < 40 && !(h.state === 'running' && h._restarts() > 0); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(h._restarts() > 0, true);
    assert.equal((await h.health()).state, 'ready');
  } finally { h.stop(); }
});

// ---- failures must come back as honest states, never as a throw or a hang in main
test('a node that cannot be spawned (ENOENT) ends in state down with the reason — no "starting" forever', async () => {
  const h = create({ hubScript: 'x', dbFile: path.join(os.tmpdir(), 'hub-host-never', 'db'),
    findNodeFn: () => ({ cmd: 'definitely-not-a-node-xyz', version: 'v25.0.0', ok: true }), backoff: [20, 20] });
  h.start();
  try {
    assert.equal(await until(() => h.state === 'down'), true, 'state: ' + h.state);
    const hl = await h.health();
    assert.equal(hl.state, 'down'); assert.equal(hl.node, 'v25.0.0'); assert.match(hl.error, /ENOENT|definitely-not-a-node-xyz/);
    assert.deepEqual(await h.request('health'), { error: 'hub not running' });
  } finally { h.stop(); }
});

test('spawnFn throwing synchronously (e.g. EINVAL on a .cmd shim) is caught: start() does not throw, state down', async () => {
  const sent = [];
  const h = create({ hubScript: 'x', dbFile: path.join(os.tmpdir(), 'hub-host-never', 'db'), findNodeFn: thisNode,
    spawnFn: () => { throw new Error('spawn EINVAL'); }, send: (c, d) => sent.push([c, d]) });
  assert.doesNotThrow(() => h.start());
  assert.deepEqual(await h.health(), { state: 'down', node: process.version, error: 'spawn EINVAL' });
  assert.deepEqual(sent.at(-1), ['hq:claude-hub:event', { event: 'health', data: { state: 'down', node: process.version, error: 'spawn EINVAL' } }]);
});

test('a hub that reports an error and exits non-zero: backoff runs out, state down, the hub’s own reason is kept', async () => {
  const dir = tmp('hub-host-');
  const script = fakeHub(dir, `process.stdout.write(JSON.stringify({ event: 'error', data: { message: 'cannot open the index: boom' } }) + '\\n'); process.exitCode = 3;`);
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: thisNode, backoff: [20, 20] });
  h.start();
  try {
    assert.equal(await until(() => h.state === 'down'), true, 'state: ' + h.state);
    assert.equal(h._restarts(), 2);
    assert.deepEqual(await h.health(), { state: 'down', node: process.version, error: 'cannot open the index: boom' });
  } finally { h.stop(); }
});

test('a request that reaches a hub that just died answers {error}, never throws or crashes main', async () => {
  const dir = tmp('hub-host-');
  const h = create({ hubScript: fakeHub(dir, ECHO), dbFile: path.join(dir, 'db'), findNodeFn: thisNode, backoff: [5000] });
  h.start();
  try {
    assert.equal((await h.health()).state, 'ready');
    h._child().kill();
    const r = await h.request('health', {}, { timeout: 3000 });
    assert.equal(typeof r.error, 'string', JSON.stringify(r));
    assert.equal(await until(() => h.state === 'starting'), true);
    assert.deepEqual(await h.request('health'), { error: 'hub not running' });
  } finally { h.stop(); }
});

test('stop() during a restart backoff cancels the restart and leaves the host idle', async () => {
  const dir = tmp('hub-host-');
  const h = create({ hubScript: fakeHub(dir, ECHO), dbFile: path.join(dir, 'db'), findNodeFn: thisNode, backoff: [150] });
  h.start();
  assert.equal((await h.health()).state, 'ready');
  h._child().kill();
  assert.equal(await until(() => h.state === 'starting'), true);
  h.stop();
  assert.equal(h.state, 'idle');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(h._restarts(), 0, 'no restart after stop');
  assert.equal(h.state, 'idle');
  assert.equal(h._child(), null);
});

test('init(): registers hq:claude-hub:health and runs the real Hub (fixture ~/.claude, own db)', async () => {
  const dir = tmp('hub-host-init-');
  const { makeClaudeHome } = await import('./claude-hub/__fixtures__/make-fixture.mjs');
  const { home } = makeClaudeHome(dir);
  const prev = { home: process.env.HQ_CLAUDE_HOME, db: process.env.HQ_CLAUDE_DB };
  process.env.HQ_CLAUDE_HOME = home; process.env.HQ_CLAUDE_DB = path.join(dir, 'data', 'hub.sqlite');
  const handlers = new Map(), sent = [];
  let host;
  try {
    host = init({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, send: (c, d) => sent.push([c, d]), dataDir: path.join(dir, 'unused'), appLog: null });
    assert.equal(typeof handlers.get('hq:claude-hub:health'), 'function');
    let hl = null;
    for (let i = 0; i < 200 && !(hl && hl.state === 'ready' && hl.counts && hl.counts.conversations === 3); i++) { hl = await handlers.get('hq:claude-hub:health')(); await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(hl.state, 'ready', JSON.stringify(hl));
    assert.equal(hl.role, 'writer');
    assert.equal(hl.counts.conversations, 3);
    assert.equal(hl.node, process.version);
    assert.ok(sent.some(([c, d]) => c === 'hq:claude-hub:event' && d.event === 'ready'));
    assert.equal(fs.existsSync(path.join(dir, 'data', 'hub.sqlite')), true, 'HQ_CLAUDE_DB decides where the index lives');
    assert.equal(fs.existsSync(path.join(dir, 'data', 'hub.sqlite.lock')), true, 'the writer holds <db>.lock while it runs');
    host.stop();   // main.js before-quit: closing stdin is the whole shutdown protocol
    assert.equal(await until(() => !host._child(), 4000), true, 'the Hub exits when its stdin closes');
    assert.equal(fs.existsSync(path.join(dir, 'data', 'hub.sqlite.lock')), false, 'and releases the lock on the way out');
  } finally {
    if (host) { host.stop(); await until(() => !host._child(), 4000); }
    for (const [k, v] of [['HQ_CLAUDE_HOME', prev.home], ['HQ_CLAUDE_DB', prev.db]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---- a Hub that keeps dying must not turn into a restart loop
test('a hub that reaches ready and dies at once is not restarted for ever: backoff runs out, state down', async () => {
  const dir = tmp('hub-host-');
  const script = fakeHub(dir, `process.stdout.write(JSON.stringify({ event: 'ready', data: { role: 'writer' } }) + '\\n'); setTimeout(() => process.exit(1), 10);`);
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: thisNode, backoff: [20, 20] });
  h.start();
  try {
    assert.equal(await until(() => h.state === 'down'), true, 'state: ' + h.state);
    assert.equal(h._restarts(), 2);
    assert.deepEqual(await h.health(), { state: 'down', node: process.version, error: 'Claude Hub exited (1)' });
  } finally { h.stop(); }
});

test('a hub that stayed up for stableMs before dying starts over from the shortest backoff (never gives up)', async () => {
  const dir = tmp('hub-host-');
  const script = fakeHub(dir, `process.stdout.write(JSON.stringify({ event: 'ready', data: { role: 'writer' } }) + '\\n'); setTimeout(() => process.exit(1), 150);`);
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: thisNode, backoff: [20, 20], stableMs: 50 });
  h.start();
  try {
    assert.equal(await until(() => h._restarts() >= 4, 8000), true, 'restarts: ' + h._restarts());
    assert.notEqual(h.state, 'down');
  } finally { h.stop(); }
});

// ---- the lifecycle log holds no personal data: hub text goes in redacted
test('hub stderr and error text reach the lifecycle log redacted (no paths, no quoted fragments)', async () => {
  const dir = tmp('hub-host-');
  const logDir = path.join(dir, 'logs');
  const log = require('./app-log.js').create({ dir: logDir, appRoot: path.join(dir, 'app') });
  const bad = 'boom "secret transcript words" at C:/Users/Someone Else/.claude/x.sqlite';
  const script = fakeHub(dir, `process.stderr.write(${JSON.stringify('hub: ' + bad + '\n')});
process.stdout.write(JSON.stringify({ event: 'error', data: { message: ${JSON.stringify(bad)} } }) + '\\n'); process.exitCode = 3;`);
  const h = create({ hubScript: script, dbFile: path.join(dir, 'db'), findNodeFn: thisNode, log, backoff: [10] });
  h.start();
  try {
    assert.equal(await until(() => h.state === 'down'), true, 'state: ' + h.state);
    await new Promise((r) => setTimeout(r, 100));   // the last stderr chunk may trail the close
    const text = fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
    const events = text.split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
    assert.ok(events.includes('claude-hub-stderr'), events.join(','));
    assert.ok(events.includes('claude-hub-down'), events.join(','));
    assert.doesNotMatch(text, /secret transcript words|Someone Else|x\.sqlite/);
    // the host itself still reports the full reason to the windows (they are the owner's own renderer)
    assert.match((await h.health()).error, /secret transcript words/);
  } finally { h.stop(); }
});
