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

test('a Reddit post without target+title is refused at stage time (never staged)', async () => {
  const before = JSON.parse(fs.readFileSync(path.join(root, 'data', 'social', 'outbox.json'), 'utf8')).actions.length;
  const r = await rpc([{ id: 6, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'reddit', text: 'no destination' } } }]);
  assert.equal(r[6].result.isError, true);
  assert.match(toolResult(r[6]).error, /target.*title/);
  const after = JSON.parse(fs.readFileSync(path.join(root, 'data', 'social', 'outbox.json'), 'utf8')).actions.length;
  assert.equal(after, before, 'the refused post never reaches the outbox');
});

test('a Reddit post WITH target+title stages, and a Reddit reply needs neither', async () => {
  const r = await rpc([
    { id: 7, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'reddit', text: 'hello', target: 'test', title: 'a title' } } },
    { id: 8, method: 'tools/call', params: { name: 'hq_social_reply', arguments: { platform: 'reddit', text: 'a comment', reply_to: 't3_abc123' } } },
  ]);
  assert.equal(r[7].result.isError, undefined, JSON.stringify(r[7]));
  assert.equal(toolResult(r[7]).status, 'staged');
  assert.equal(r[8].result.isError, undefined, JSON.stringify(r[8]));
  assert.equal(toolResult(r[8]).status, 'staged');
});

test('tool descriptions tell the truth about what the send half can publish and where captures land', async () => {
  const r = await rpc([{ id: 9, method: 'tools/list' }]);
  const tool = (n) => r[9].result.tools.find((x) => x.name === n);
  // hq_social_post/_reply name the platforms the adapter refuses (browser-bridge/social.js)
  assert.match(tool('hq_social_post').description, /youtube/i);
  assert.match(tool('hq_social_post').description, /instagram/i);
  assert.match(tool('hq_social_post').description, /threads/i);
  assert.match(tool('hq_social_reply').description, /linkedin/i);
  // hq_capture describes the live capture surface (hq:capture-save), and any
  // mention of the Ctrl+Alt+Space box says it was retired
  assert.match(tool('hq_capture').description, /hq:capture-save/);
  assert.match(tool('hq_capture').description, /retired 2026-09-15/);
});

// loop iteration 3 (2026-11-05): combos the send half refuses unconditionally are refused at stage time, like Reddit's
const outboxLen = () => JSON.parse(fs.readFileSync(path.join(root, 'data', 'social', 'outbox.json'), 'utf8')).actions.length;

test('never-sendable combos (Instagram / YouTube anything, LinkedIn replies) are refused at stage time, never staged', async () => {
  const before = outboxLen();
  const r = await rpc([
    { id: 20, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'instagram', text: 'text only' } } },
    { id: 21, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'youtube', text: 'community post' } } },
    { id: 22, method: 'tools/call', params: { name: 'hq_social_reply', arguments: { platform: 'linkedin', text: 'a comment', reply_to: 'urn:li:activity:1' } } },
    { id: 23, method: 'tools/call', params: { name: 'hq_social_reply', arguments: { platform: 'instagram', text: 'a reply', reply_to: 'abc' } } },
  ]);
  for (const id of [20, 21, 22, 23]) {
    assert.equal(r[id].result.isError, true, 'id ' + id + ' should be refused: ' + JSON.stringify(r[id]));
    assert.match(toolResult(r[id]).error, /can't be sent.*nothing staged/);
  }
  assert.equal(outboxLen(), before, 'none of them reached the owner’s approval queue');
});

test('sendable-once-configured and sendable combos still stage: Threads post (doc_id), LinkedIn post', async () => {
  const r = await rpc([
    { id: 24, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'threads', text: 'needs a doc_id at send' } } },
    { id: 25, method: 'tools/call', params: { name: 'hq_social_post', arguments: { platform: 'linkedin', text: 'a share' } } },
  ]);
  assert.equal(toolResult(r[24]).status, 'staged', JSON.stringify(r[24]));
  assert.equal(toolResult(r[25]).status, 'staged', JSON.stringify(r[25]));
});

// drift pin: the refusal list mirrors adapters that refuse with no setting to change it. If one of them gets wired up,
// this fails and points at NEVER_SENDS in server.mjs.
test('NEVER_SENDS matches browser-bridge/social.js: those senders still refuse unconditionally', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'browser-bridge', 'social.js'), 'utf8');
  assert.match(src, /async function igSendInPage\(\) \{\s*return \{ ok: false/, 'Instagram send now does something — drop instagram from NEVER_SENDS');
  assert.match(src, /async function ytSendInPage\(\) \{\s*return \{ ok: false/, 'YouTube send now does something — drop youtube from NEVER_SENDS');
  assert.match(src, /if \(action\.op === 'reply'\) return \{ ok: false, error: 'LinkedIn replies/, 'LinkedIn replies are wired now — drop linkedin from NEVER_SENDS.reply');
});
