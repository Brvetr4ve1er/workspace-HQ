// node --test mcp/workspacehq/server.test.mjs
// The server resolves the repo root as <its folder>/../.. (mcp/workspacehq → repo), so the
// test copies it into the same shape under a temp root with fixture data and talks
// JSON-RPC to it over stdio. Pins: ROOT resolution from mcp/workspacehq/, and that
// hq_social_outbox surfaces the additive sent_after_cancel / canceled_at fields.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-'));
  fs.mkdirSync(path.join(root, 'mcp', 'workspacehq'), { recursive: true });
  fs.copyFileSync(SERVER, path.join(root, 'mcp', 'workspacehq', 'server.mjs'));
  fs.mkdirSync(path.join(root, 'data', 'social'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'latest.json'), JSON.stringify({
    scan: { id: '2026-10-06', date: '2026-10-06' },
    account: { level: 7, xp: 1234, health_index: 81, totals: { open_quests: 3, red_quests: 1 }, streak: { scan_days: 4 } },
    projects: [{ id: 'a' }, { id: 'b' }],
  }));
  const base = { platform: 'bluesky', op: 'post', reply_to: null, target: null, title: null, staged_at: '2026-10-06T10:00:00.000Z', error: null, by: 'mcp' };
  fs.writeFileSync(path.join(root, 'data', 'social', 'outbox.json'), JSON.stringify({
    updated: '2026-10-06T10:05:00.000Z',
    actions: [
      { ...base, id: 'ob-staged', text: 'still waiting', status: 'staged', sent_at: null, result: null },
      { ...base, id: 'ob-raced', text: 'went out anyway', status: 'canceled', canceled_at: '2026-10-06T10:01:00.000Z',
        sent_after_cancel: true, sent_at: '2026-10-06T10:01:02.000Z', result: { url: 'https://example.org/p/1', uri: 'at://example/post/1' } },
      { ...base, id: 'ob-mcp-cancel', text: 'never sent', status: 'canceled', sent_at: null, result: null },
    ],
  }));
});
after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ } });

// Send newline-delimited JSON-RPC requests, collect one reply per request id.
function rpc(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'mcp', 'workspacehq', 'server.mjs')], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server timed out: ' + out)); }, 10000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      const byId = {};
      for (const line of out.split('\n').filter(Boolean)) { const m = JSON.parse(line); byId[m.id] = m; }
      resolve(byId);
    });
    child.stdin.end(requests.map((r) => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n');
  });
}
const toolResult = (m) => JSON.parse(m.result.content[0].text);

test('resolves the repo root from mcp/workspacehq/ (hq_status reads <root>/data/latest.json)', async () => {
  const r = await rpc([
    { id: 1, method: 'initialize', params: {} },
    { id: 2, method: 'tools/call', params: { name: 'hq_status' } },
  ]);
  assert.equal(r[1].result.serverInfo.name, 'workspacehq');
  assert.equal(r[2].result.isError, undefined, JSON.stringify(r[2]));
  assert.deepEqual(toolResult(r[2]), { date: '2026-10-06', level: 7, xp: 1234, health: 81, open_quests: 3, red_quests: 1, streak: 4, projects: 2 });
});

test('hq_social_outbox surfaces sent_after_cancel (boolean) and canceled_at (or null)', async () => {
  const r = await rpc([{ id: 3, method: 'tools/call', params: { name: 'hq_social_outbox', arguments: { status: 'canceled' } } }]);
  const out = toolResult(r[3]);
  assert.equal(out.count, 2);
  const raced = out.actions.find((a) => a.id === 'ob-raced');
  assert.equal(raced.status, 'canceled', 'still canceled — never re-labelled sent');
  assert.equal(raced.sent_after_cancel, true);
  assert.equal(raced.canceled_at, '2026-10-06T10:01:00.000Z');
  assert.equal(raced.sent_at, '2026-10-06T10:01:02.000Z');
  assert.deepEqual(raced.result, { url: 'https://example.org/p/1', uri: 'at://example/post/1' });
  const plain = out.actions.find((a) => a.id === 'ob-mcp-cancel');
  assert.equal(plain.sent_after_cancel, false);
  assert.equal(plain.canceled_at, null, 'the MCP cancel leaves canceled_at absent');
});

test('hq_social_outbox without a filter lists every action, staged ones with sent_after_cancel:false', async () => {
  const r = await rpc([{ id: 4, method: 'tools/call', params: { name: 'hq_social_outbox' } }]);
  const out = toolResult(r[4]);
  assert.equal(out.count, 3);
  assert.equal(out.actions.find((a) => a.id === 'ob-staged').sent_after_cancel, false);
});

test('tools/list describes sent_after_cancel on hq_social_outbox', async () => {
  const r = await rpc([{ id: 5, method: 'tools/list' }]);
  const t = r[5].result.tools.find((x) => x.name === 'hq_social_outbox');
  assert.match(t.description, /sent_after_cancel/);
});

test('hq_canvas_remove drops one node and its edges, logs it to removed.jsonl, and matches the app rule', async () => {
  const dir = path.join(root, 'data', 'canvas');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Ideas.canvas'), JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'text', text: 'B' }], edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }] }));
  const r = await rpc([
    { id: 6, method: 'tools/call', params: { name: 'hq_canvas_remove', arguments: { name: 'Ideas', id: 'a' } } },
    { id: 7, method: 'tools/call', params: { name: 'hq_canvas_remove', arguments: { name: 'Ideas', id: 'zz' } } },
  ]);
  assert.deepEqual(toolResult(r[6]), { ok: true, board: 'Ideas', id: 'a', edges: 1 });
  assert.equal(r[7].result.isError, true);
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'Ideas.canvas'), 'utf8'));
  assert.deepEqual(b, { nodes: [{ id: 'b', type: 'text', text: 'B' }], edges: [] });
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'removed.jsonl'), 'utf8').trim());
  assert.deepEqual([log.board, log.node.id, log.edges.length], ['Ideas', 'a', 1]);
});
