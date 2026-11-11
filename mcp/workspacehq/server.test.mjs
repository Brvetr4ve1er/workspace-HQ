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
import { untiered, tierOf } from './guard.mjs';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-'));
  fs.mkdirSync(path.join(root, 'mcp', 'workspacehq'), { recursive: true });
  fs.copyFileSync(SERVER, path.join(root, 'mcp', 'workspacehq', 'server.mjs'));
  // the assistant's rulebook (guard.mjs) and the dashboard modules it loads, in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'guard.mjs'), path.join(root, 'mcp', 'workspacehq', 'guard.mjs'));
  fs.mkdirSync(path.join(root, 'dashboard'), { recursive: true });
  for (const f of ['assist-core.mjs', 'assist-audit.mjs', 'refresh-lock.js', 'reach.js']) {
    fs.copyFileSync(path.join(path.dirname(SERVER), '..', '..', 'dashboard', f), path.join(root, 'dashboard', f));
  }
  // recall (hq_recall / hq_chat_read): the reader, the Hub's store and masking rules, and the module the store imports, in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'hub-read.mjs'), path.join(root, 'mcp', 'workspacehq', 'hub-read.mjs'));
  fs.mkdirSync(path.join(root, 'dashboard', 'claude-hub'), { recursive: true });
  const dash = path.join(path.dirname(SERVER), '..', '..', 'dashboard');
  for (const f of ['store.mjs', 'redact.mjs', 'redact-more.mjs']) fs.copyFileSync(path.join(dash, 'claude-hub', f), path.join(root, 'dashboard', 'claude-hub', f));
  fs.copyFileSync(path.join(dash, 'claude-prompt-note.js'), path.join(root, 'dashboard', 'claude-prompt-note.js'));
  // sessions (hq_sessions): the tool and the app's classifier it imports, in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'sessions-tool.mjs'), path.join(root, 'mcp', 'workspacehq', 'sessions-tool.mjs'));
  fs.copyFileSync(path.join(dash, 'sessions-core.mjs'), path.join(root, 'dashboard', 'sessions-core.mjs'));
  // client delivery (hq_delivery): the reader, the pure core it shares with the app, and the path resolver, in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'delivery-read.mjs'), path.join(root, 'mcp', 'workspacehq', 'delivery-read.mjs'));
  fs.copyFileSync(path.join(dash, 'delivery-core.mjs'), path.join(root, 'dashboard', 'delivery-core.mjs'));
  fs.copyFileSync(path.join(dash, 'project-paths.js'), path.join(root, 'dashboard', 'project-paths.js'));
  // Cosmos search (hq_cosmos_search): the reader, and the renderer's one search grammar with its colour helper, in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'cosmos-read.mjs'), path.join(root, 'mcp', 'workspacehq', 'cosmos-read.mjs'));
  fs.mkdirSync(path.join(root, 'dashboard-v5', 'src', 'logic'), { recursive: true });
  for (const f of ['cosmos-search.mjs', 'cosmos-color.mjs']) fs.copyFileSync(path.join(path.dirname(SERVER), '..', '..', 'dashboard-v5', 'src', 'logic', f), path.join(root, 'dashboard-v5', 'src', 'logic', f));
  // Money in words (hq_money_today): the reader and the money engine files it imports (not their tests), in the same relative shape
  fs.copyFileSync(path.join(path.dirname(SERVER), 'money-read.mjs'), path.join(root, 'mcp', 'workspacehq', 'money-read.mjs'));
  fs.mkdirSync(path.join(root, 'dashboard', 'money'), { recursive: true });
  for (const f of fs.readdirSync(path.join(dash, 'money'))) if (/\.mjs$/.test(f) && !/\.test\.mjs$/.test(f)) fs.copyFileSync(path.join(dash, 'money', f), path.join(root, 'dashboard', 'money', f));
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

// Operator Brief (plan Task 5): any Claude session can ask what needs the owner
test('hq_brief without data/brief.json says why, instead of an empty answer', async () => {
  const f = path.join(root, 'data', 'brief.json');
  if (fs.existsSync(f)) fs.rmSync(f);
  const r = await rpc([{ id: 30, method: 'tools/call', params: { name: 'hq_brief', arguments: {} } }]);
  assert.match(toolResult(r[30]).error, /no brief yet/);
});

test('hq_brief returns the brief the app wrote, plus its age in minutes', async () => {
  const generatedAt = new Date(Date.now() - 12 * 60e3).toISOString();
  const brief = { v: 1, generatedAt, more: 0, errors: [], items: [{ key: 'dirty:p:12', rule: 'dirty', severity: 'low', text: 'Placeholder has 12 uncommitted files', why: 'x', source: 'scan', age: 'scan 1 h ago', action: { kind: 'go', tab: 'projects', projectId: 'p' } }] };
  fs.writeFileSync(path.join(root, 'data', 'brief.json'), JSON.stringify(brief));
  const r = await rpc([{ id: 31, method: 'tools/call', params: { name: 'hq_brief', arguments: {} } }]);
  const out = toolResult(r[31]);
  assert.deepEqual(out.items, brief.items);
  assert.ok(out.ageMinutes >= 11 && out.ageMinutes <= 13, 'about 12 minutes old: ' + out.ageMinutes);
});

test('hq_brief({limit}) returns that many ranked items and the rest as overflow; an out-of-range limit is refused', async () => {
  const mk = (n) => ({ key: 'ci-red:r' + n + ':x', rule: 'ci-red', severity: 'med', text: 'CI is failing on repo' + n, why: 'x', source: 'github', age: 'github.json 1 h ago', count: 0, action: { kind: 'go', tab: 'projects', sub: 'github' } });
  const generatedAt = new Date(Date.now() - 2 * 60e3).toISOString();
  fs.writeFileSync(path.join(root, 'data', 'brief.json'), JSON.stringify({ v: 1, generatedAt, more: 9, errors: [], items: [1, 2, 3].map(mk), overflow: [4, 5, 6, 7, 8, 9, 10, 11, 12].map(mk) }));
  const r = await rpc([
    { id: 32, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 6 } } },
    { id: 33, method: 'tools/call', params: { name: 'hq_brief', arguments: {} } },
    { id: 34, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 13 } } },
    { id: 35, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 0 } } },
  ]);
  const six = toolResult(r[32]);
  assert.equal(six.items.length, 6);
  assert.equal(six.overflow.length, 6, 'the other six of the twelve');
  assert.equal(six.items[5].key, 'ci-red:r6:x');
  assert.equal(six.items[0].count, 0);
  const dflt = toolResult(r[33]);
  assert.equal(dflt.items.length, 3, 'the default is the top 3');
  assert.equal(dflt.overflow.length, 9);
  for (const id of [34, 35]) { assert.equal(r[id].result.isError, true, 'limit out of range is refused: ' + id); assert.match(JSON.stringify(r[id]), /limit must be/); }
});

test('hq_brief drops Money rows (they carry bill and account names) while the Money switch is off, and keeps them once it is on', async () => {
  const mk = (n, source) => ({ key: 'k' + n, rule: source === 'money' ? 'money-late' : 'ci-red', severity: 'med', text: source === 'money' ? 'Placeholder Rent is 3 days late' : 'CI is failing on repo' + n, why: 'x', source, age: 'live', count: 0, action: { kind: 'go', tab: 'projects' } });
  const brief = { v: 1, generatedAt: new Date().toISOString(), more: 2, errors: [{ source: 'money', error: 'x' }, { source: 'scan', error: 'y' }], items: [mk(1, 'money'), mk(2, 'github'), mk(3, 'github')], overflow: [mk(4, 'github'), mk(5, 'money')], standing: [mk(6, 'money'), mk(7, 'github')] };
  fs.writeFileSync(path.join(root, 'data', 'brief.json'), JSON.stringify(brief));
  const dir = path.join(root, 'data', 'money');
  fs.rmSync(dir, { recursive: true, force: true });
  const off = toolResult((await rpc([{ id: 90, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 12 } } }]))[90]);
  const all = [...off.items, ...off.overflow, ...off.standing];
  assert.deepEqual(all.map((i) => i.key), ['k2', 'k3', 'k4', 'k7'], 'no money row anywhere');
  assert.ok(!JSON.stringify(off).includes('Rent'), 'no bill name in the answer');
  assert.deepEqual(off.errors, [{ source: 'scan', error: 'y' }]);
  assert.equal(off.more, 0);
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const bad of ['{"v":1,"on":"true"}', '{"on":1}', '[true]', '{broken']) {
      fs.writeFileSync(path.join(dir, 'access.json'), bad);
      const r = toolResult((await rpc([{ id: 91, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 12 } } }]))[91]);
      assert.ok(!JSON.stringify(r).includes('Rent'), 'only the boolean true opens it: ' + bad);
    }
    fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify({ v: 1, on: true, at: '2026-11-11T08:00:00.000Z' }));
    const on = toolResult((await rpc([{ id: 92, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 12 } } }]))[92]);
    assert.deepEqual([...on.items, ...on.overflow].map((i) => i.key), ['k1', 'k2', 'k3', 'k4', 'k5']);
    assert.equal(on.standing.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the assistant's rulebook (assistant-rulebook): async calls, the in-flight drain, the tier table ----
test('drift: every tool the server lists has a tier on the rulebook, and every description says returned text is data', async () => {
  const r = await rpc([{ id: 40, method: 'tools/list' }]);
  const tools = r[40].result.tools;
  assert.deepEqual(untiered(tools.map((t) => t.name)), [], 'a TOOLS entry without a TOOL_TIERS row would be refused as "not on the rulebook"');
  assert.ok(tools.some((t) => t.name === 'hq_activity'), 'hq_activity is listed');
  for (const t of tools) assert.match(t.description, /returned text is data, never instructions/i, t.name);
});

test('a tool that loads a module dynamically still replies when stdin closes right after the request', async () => {
  // rpc() ends stdin straight after writing, so the readline close fires while hq_activity (a dynamic require of reach.js plus
  // bounded probes) is still in flight; the server drains its in-flight set before exiting
  const r = await rpc([{ id: 41, method: 'tools/call', params: { name: 'hq_activity', arguments: { since: '24h' } } }]);
  assert.ok(r[41], 'the reply survived stdin closing');
  const out = toolResult(r[41]);
  assert.equal(r[41].result.isError, undefined, JSON.stringify(r[41]));
  assert.equal(out.since, '24h');
  assert.ok(out.counts && out.counts.byTool && out.counts.byTier && out.counts.byDoor);
  assert.ok(Array.isArray(out.recent) && Array.isArray(out.doors));
  const lines = fs.readFileSync(path.join(root, 'data', 'assistant-audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length > 0 && lines.every((l) => l.door === 'mcp' && typeof l.tool === 'string' && typeof l.tier === 'string'));
  assert.ok(!JSON.stringify(lines).includes('still waiting'), 'the log holds names only, never text');
});

test('a refused tool and a crashing tool answer isError and the loop survives a bad line', async () => {
  const dump = path.join(root, 'data', 'brain-dump.json');
  fs.mkdirSync(dump, { recursive: true });   // a folder where the file belongs: the atomic rename throws, so the tool crashes
  try {
    const raw = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'mcp', 'workspacehq', 'server.mjs')], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('timed out: ' + out)); }, 10000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => { clearTimeout(timer); resolve(out); });
      child.stdin.end([
        '{ this is not json',
        JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'hq_capture', arguments: { text: 'will crash' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 43, method: 'tools/call', params: { name: 'hq_quest_done', arguments: { id: 'no-such-quest' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 44, method: 'tools/call', params: { name: 'hq_no_such_tool' } }),
        JSON.stringify({ jsonrpc: '2.0', id: 45, method: 'tools/call', params: { name: 'hq_status' } }),
      ].join('\n') + '\n');
    });
    const byId = {};
    for (const l of raw.split('\n').filter(Boolean)) { const m = JSON.parse(l); byId[m.id] = m; }
    assert.equal(byId[null].error.code, -32700, 'the bad line got a parse error');
    assert.equal(byId[42].result.isError, true);
    assert.match(toolResult(byId[42]).error, /tool crashed/);
    assert.equal(byId[43].result.isError, true);
    assert.match(toolResult(byId[43]).error, /unknown quest id/);
    assert.equal(byId[44].error.code, -32602, 'an unknown tool keeps failing before the guard');
    assert.equal(byId[45].result.isError, undefined, 'the loop kept serving after the bad line and the crash');
  } finally { fs.rmSync(dump, { recursive: true, force: true }); }
});

// ---- recall: hq_recall / hq_chat_read through the async loop, against a temp hub.sqlite built from the invented ~/.claude ----
test('hq_recall and hq_chat_read answer through the loop; the child runs in another folder, so "here" finds nothing and "all" reads', async () => {
  const { makeClaudeHome } = await import('../../dashboard/claude-hub/__fixtures__/make-fixture.mjs');
  const { openStore } = await import('../../dashboard/claude-hub/store.mjs');
  const { backfill } = await import('../../dashboard/claude-hub/ingest-code.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-hub-'));
  try {
    const fx = makeClaudeHome(home);
    fs.mkdirSync(path.join(root, 'data', 'claude'), { recursive: true });
    const st = openStore(path.join(root, 'data', 'claude', 'hub.sqlite'));
    await backfill(st, fx.root);
    st.close();
    const r = await rpc([
      { id: 31, method: 'tools/call', params: { name: 'hq_recall', arguments: { q: 'placeholder release', scope: 'all' } } },
      { id: 32, method: 'tools/call', params: { name: 'hq_recall', arguments: { q: 'placeholder release' } } },
      { id: 33, method: 'tools/call', params: { name: 'hq_chat_read', arguments: { id: 'code:sess-a1', scope: 'all' } } },
      { id: 34, method: 'tools/call', params: { name: 'hq_chat_read', arguments: { id: 'code:sess-a1' } } },
      { id: 35, method: 'tools/list' },
    ]);
    const all = toolResult(r[31]);
    assert.equal(r[31].result.isError, undefined, JSON.stringify(r[31]));
    assert.equal(all.hits.length, 1); assert.equal(all.hits[0].conversationId, 'code:sess-a1'); assert.equal(all.scope, 'all');
    const here = toolResult(r[32]);
    assert.deepEqual(here.hits, []); assert.match(here.note, /scope "all"/);
    const read = toolResult(r[33]);
    assert.equal(read.id, 'code:sess-a1'); assert.ok(read.turns.length >= 2);
    assert.ok(read.turns.every((t) => t.role === 'user' || t.role === 'assistant'), 'no tool rows');
    assert.equal(r[34].result.isError, true); assert.match(r[34].result.content[0].text, /another folder/);
    const tools = r[35].result.tools.filter((t) => t.name === 'hq_recall' || t.name === 'hq_chat_read');
    assert.equal(tools.length, 2);
    for (const t of tools) assert.match(t.description, /plain prose|raw text stays/i, t.name + ' states the masking caveat');
    assert.match(tools[0].description, /search table/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(path.join(root, 'data', 'claude'), { recursive: true, force: true }); }
});

test('hq_recall without an index is an error that says what to do, never an empty list', async () => {
  fs.rmSync(path.join(root, 'data', 'claude'), { recursive: true, force: true });
  const r = await rpc([{ id: 36, method: 'tools/call', params: { name: 'hq_recall', arguments: { q: 'anything', scope: 'all' } } }]);
  assert.equal(r[36].result.isError, true);
  assert.match(r[36].result.content[0].text, /open WorkspaceHQ once/);
});

// ---- sessions: hq_sessions through the async loop (the cards themselves are pinned in sessions-tool.test.mjs) ----
test('hq_sessions is on the list with the data line, answers from the index through the loop, and is an error without one', async () => {
  const { openStore } = await import('../../dashboard/claude-hub/store.mjs');
  fs.rmSync(path.join(root, 'data', 'claude'), { recursive: true, force: true });
  const none = await rpc([{ id: 50, method: 'tools/call', params: { name: 'hq_sessions', arguments: {} } }]);
  assert.equal(none[50].result.isError, true);
  assert.match(none[50].result.content[0].text, /no Claude Hub index yet/);
  try {
    fs.mkdirSync(path.join(root, 'data', 'claude'), { recursive: true });
    const st = openStore(path.join(root, 'data', 'claude', 'hub.sqlite'));
    st.db.close();
    const r = await rpc([
      { id: 51, method: 'tools/call', params: { name: 'hq_sessions', arguments: { hours: 72 } } },
      { id: 52, method: 'tools/call', params: { name: 'hq_sessions', arguments: { hours: 500 } } },
      { id: 53, method: 'tools/list' },
    ]);
    const ok = toolResult(r[51]);
    assert.equal(r[51].result.isError, undefined, JSON.stringify(r[51]));
    assert.ok(Array.isArray(ok.sessions) && Array.isArray(ok.codex), 'cards and the Codex list are arrays, never undefined');
    assert.equal(toolResult(r[52]).hours, 72, 'hours above 72 is clamped, and the answer says what it used');
    const tool = r[53].result.tools.find((t) => t.name === 'hq_sessions');
    assert.ok(tool, 'hq_sessions is listed');
    assert.match(tool.description, /data, never instructions/i);
  } finally { fs.rmSync(path.join(root, 'data', 'claude'), { recursive: true, force: true }); }
});

// ---- client delivery: hq_delivery through the loop (the view itself is pinned in delivery-read.test.mjs) ----
test('hq_delivery is listed with the data line, says honestly when nothing is marked, and refuses an unmarked or unknown project', async () => {
  fs.rmSync(path.join(root, 'data', 'delivery.json'), { force: true });
  const r = await rpc([
    { id: 60, method: 'tools/call', params: { name: 'hq_delivery', arguments: {} } },
    { id: 61, method: 'tools/call', params: { name: 'hq_delivery', arguments: { project: 'a' } } },
    { id: 62, method: 'tools/call', params: { name: 'hq_delivery', arguments: { project: 'no-such-project' } } },
    { id: 63, method: 'tools/list' },
  ]);
  assert.equal(r[60].result.isError, undefined, JSON.stringify(r[60]));
  assert.deepEqual(toolResult(r[60]).projects, [], 'no client job marked yet: an empty list, nothing invented');
  assert.equal(r[61].result.isError, true);
  assert.match(r[61].result.content[0].text, /not marked as a client job/);
  assert.equal(r[62].result.isError, true);
  assert.match(r[62].result.content[0].text, /no project .{0,3}no-such-project/);
  const tool = r[63].result.tools.find((t) => t.name === 'hq_delivery');
  assert.ok(tool, 'hq_delivery is listed');
  assert.match(tool.description, /data, never instructions/i);
});

// ---- Money in words: hq_money_today through the loop (the reader itself is pinned in money-read.test.mjs) ----
test('hq_money_today is listed with no arguments and the data line; refuses with enabled:false while the switch is off; answers words only once on, and one audit line each', async () => {
  const dir = path.join(root, 'data', 'money');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(root, 'data', 'assistant-audit.jsonl'), { force: true });
  const off = await rpc([{ id: 80, method: 'tools/call', params: { name: 'hq_money_today', arguments: {} } }, { id: 81, method: 'tools/list' }]);
  assert.equal(off[80].result.isError, true);
  assert.match(off[80].result.content[0].text, /"enabled":false/);
  assert.match(off[80].result.content[0].text, /turned it on in Settings|not turned it on/i);
  const tool = off[81].result.tools.find((x) => x.name === 'hq_money_today');
  assert.ok(tool, 'hq_money_today is listed');
  assert.deepEqual(tool.inputSchema.properties, {});
  assert.match(tool.description, /data, never instructions/i);
  assert.equal(tierOf('hq_money_today'), 'read');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify({ v: 1, on: true, at: '2026-11-11T08:00:00.000Z' }));
  try {
    const on = await rpc([{ id: 82, method: 'tools/call', params: { name: 'hq_money_today', arguments: {} } }]);
    assert.equal(on[82].result.isError, undefined, JSON.stringify(on[82]));
    const a = toolResult(on[82]);
    assert.equal(a.enabled, true);
    assert.equal(a.setUp, false, 'no state.json: not set up, and no other claim');
    assert.equal(a.room, 'unknown');
    for (const k of ['billsBeforePayday', 'dueBefore']) assert.ok(!(k in a), k);
    const lines = fs.readFileSync(path.join(root, 'data', 'assistant-audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.tool === 'hq_money_today');
    assert.equal(lines.length, 2, 'one audit line per call, the refused one included');
    for (const l of lines) assert.ok(!('args' in l) && !('text' in l), 'names only');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Cosmos search: hq_cosmos_search through the loop (the reader itself is pinned in cosmos-read.test.mjs) ----
test('hq_cosmos_search is listed with a required q and the data line; finds a work, never a hidden one; says in words when no library exists', async () => {
  const dir = path.join(root, 'data', 'cosmos');
  fs.rmSync(dir, { recursive: true, force: true });
  const none = await rpc([{ id: 70, method: 'tools/call', params: { name: 'hq_cosmos_search', arguments: { q: 'alpha' } } }]);
  assert.equal(none[70].result.isError, true);
  assert.match(none[70].result.content[0].text, /index a folder first/i);
  fs.mkdirSync(dir, { recursive: true });
  const w = (id, title, tags, extra = {}) => ({ id, title, type: 'photo', tags, rel: 'alpha-site/' + id + '.jpg', thumb: 'data:image/png;base64,AAAA', ...extra });
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, generatedAt: '2026-11-01T10:00:00.000Z', works: [w('w1', 'Alpha poster', ['wip']), w('w2', 'Alpha secret', ['wip']), w('w3', 'Beta sketch', ['draft'])] }));
  fs.writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ favorites: {}, hidden: { w2: true }, overrides: {} }));
  try {
    const r = await rpc([
      { id: 71, method: 'tools/call', params: { name: 'hq_cosmos_search', arguments: { q: 'alpha' } } },
      { id: 72, method: 'tools/call', params: { name: 'hq_cosmos_search', arguments: { q: 'tag:wip', limit: 3 } } },
      { id: 73, method: 'tools/call', params: { name: 'hq_cosmos_search', arguments: {} } },
      { id: 74, method: 'tools/list' },
    ]);
    assert.equal(r[71].result.isError, undefined, JSON.stringify(r[71]));
    assert.deepEqual(toolResult(r[71]).rows.map((x) => x.id), ['w1'], 'the hidden work is absent');
    assert.deepEqual(Object.keys(toolResult(r[71]).rows[0]).sort(), ['id', 'path', 'tags', 'title', 'type']);
    assert.equal(toolResult(r[72]).kind, 'tag');
    assert.deepEqual(toolResult(r[72]).rows.map((x) => x.id), ['w1']);
    assert.equal(r[73].result.isError, true, 'q is required');
    const tool = r[74].result.tools.find((x) => x.name === 'hq_cosmos_search');
    assert.ok(tool, 'hq_cosmos_search is listed');
    assert.ok(tool.inputSchema.properties.q, 'has a q property');
    assert.deepEqual(tool.inputSchema.required, ['q']);
    assert.match(tool.description, /data, never instructions/i);
    assert.match(tool.description, /relative paths/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hq_brief returns standing (additive): the stepped-aside items with their since date, untouched by limit; [] when the file has none', async () => {
  const mk = (n, o = {}) => ({ key: 'dirty:p' + n + ':12', rule: 'dirty', severity: 'low', text: 'Placeholder p' + n + ' has 12 uncommitted files', why: 'x', source: 'scan', age: 'scan 1 h ago', count: 0, action: { kind: 'go', tab: 'projects', projectId: 'p' + n }, ...o });
  const generatedAt = new Date(Date.now() - 2 * 60e3).toISOString();
  fs.writeFileSync(path.join(root, 'data', 'brief.json'), JSON.stringify({ v: 1, generatedAt, more: 0, errors: [], items: [mk(1)], overflow: [], standing: [mk(2, { since: '2026-11-05T09:00:00.000Z' }), mk(3, { since: '2026-11-04T09:00:00.000Z' })] }));
  const r = await rpc([
    { id: 36, method: 'tools/call', params: { name: 'hq_brief', arguments: {} } },
    { id: 37, method: 'tools/call', params: { name: 'hq_brief', arguments: { limit: 12 } } },
  ]);
  for (const id of [36, 37]) {
    const out = toolResult(r[id]);
    assert.deepEqual(out.items.map((i) => i.key), ['dirty:p1:12']);
    assert.deepEqual(out.standing.map((i) => [i.key, i.since]), [['dirty:p2:12', '2026-11-05T09:00:00.000Z'], ['dirty:p3:12', '2026-11-04T09:00:00.000Z']], 'ranked as the app wrote them, limit does not touch them');
  }
  fs.writeFileSync(path.join(root, 'data', 'brief.json'), JSON.stringify({ v: 1, generatedAt, more: 0, errors: [], items: [mk(1)] }));
  const old = await rpc([{ id: 38, method: 'tools/call', params: { name: 'hq_brief', arguments: {} } }]);
  assert.deepEqual(toolResult(old[38]).standing, [], 'a brief.json written before standing existed answers []');
});
