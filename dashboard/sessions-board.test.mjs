// Sessions board, main side: polling, caching, hub-down, the Codex lane, push-on-change, open-folder. Fake hub, temp folders,
// fake windows. Placeholder data only (the repo is public).
//   node --test dashboard/sessions-board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'UTC';
const require = createRequire(import.meta.url);
const SB = require('./sessions-board.js');

const NOW0 = Date.parse('2026-11-05T12:00:00.000Z');
const MIN = 60e3, H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sboard-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const work = path.join(ROOT, 'work', 'alpha-site');
fs.mkdirSync(work, { recursive: true });
const FOLDER = 'C--work-alpha-site';
const home = path.join(ROOT, 'claude-home');
fs.mkdirSync(path.join(home, 'projects', FOLDER), { recursive: true });
const sid = (n) => n.repeat(8) + '-' + n.repeat(4) + '-4' + n.repeat(3) + '-8' + n.repeat(3) + '-' + n.repeat(12);

const row = (n, o = {}) => ({ id: 'code:' + sid(n), native_id: sid(n), source: 'code', project_id: 'code:' + FOLDER, title: 'Session ' + n,
  started_at: iso(NOW0 - 3 * H), last_at: iso(NOW0 - 20 * MIN), message_count: 10, cwd: work, git_branch: 'main',
  tokens_in: 1, tokens_out: 2, tokens_cache_read: 3, active_ms: 10 * MIN, project_name: 'alpha-site', hq_project_id: 'alpha', ...o });
const t = (role, msAgo, o = {}) => ({ role, at: iso(NOW0 - msAgo), text: '', tool_name: null, is_sidechain: 0, ...o });
for (const n of ['1', '2', '3']) fs.writeFileSync(path.join(home, 'projects', FOLDER, sid(n) + '.jsonl'), '{}\n');

function rig(o = {}) {
  const calls = [];
  let state = { rows: o.rows || [row('1'), row('2', { last_at: iso(NOW0 - 3 * H) })], turns: o.turns || {}, projects: o.projects || [{ id: 'code:' + FOLDER, link_state: 'auto', hq_project_id: 'alpha', name: 'alpha-site' }], fail: null };
  const hub = { request: async (op, args) => {
    calls.push([op, args]);
    if (state.fail) throw new Error(state.fail);
    if (op === 'listConversations') return state.rows;
    if (op === 'listProjects') return state.projects;
    if (op === 'getConversation') return { conversation: state.rows.find((r) => r.id === args.id), messages: state.turns[args.id] || [t('assistant', 20 * MIN, { text: 'Done.' })], hasMore: false };
    throw new Error('unexpected op ' + op);
  } };
  let now = NOW0;
  const codexHome = path.join(ROOT, 'codex-' + Math.random().toString(36).slice(2));
  const b = SB.create({ hub, now: () => now, env: { HQ_CLAUDE_HOME: home, HQ_CODEX_HOME: codexHome }, ...(o.create || {}) });
  return { b, calls, state, setNow: (n) => { now = n; }, codexHome, ops: (op) => calls.filter((c) => c[0] === op) };
}

test('poll: asks for 7 days of Code sessions, fetches turns only for changed rows, projects once per poll', async () => {
  const f = rig();
  const board = await f.b.poll();
  assert.deepEqual(f.ops('listConversations')[0][1], { source: 'code', since: iso(NOW0 - 7 * 24 * H), limit: 40 });
  assert.deepEqual(f.ops('listProjects')[0][1], { source: 'code' });
  assert.equal(f.ops('listProjects').length, 1);
  assert.equal(f.ops('getConversation').length, 2);
  assert.deepEqual(f.ops('getConversation')[0][1], { id: 'code:' + sid('1'), limit: 30 });
  assert.equal(board.state, 'ok');
  assert.equal(board.sessions.length, 2, 'the 3 h old row is still inside 24 h');

  await f.b.poll();
  assert.equal(f.ops('listProjects').length, 2, 'once per poll, not per row');
  assert.equal(f.ops('getConversation').length, 2, 'nothing changed, nothing re-fetched');

  f.state.rows = [row('1', { last_at: iso(NOW0 - 5 * MIN) }), f.state.rows[1]];
  await f.b.poll();
  assert.equal(f.ops('getConversation').length, 3, 'only the row whose last_at moved');
  assert.equal(f.ops('getConversation')[2][1].id, 'code:' + sid('1'));
});

test('the cards: project label from listProjects, whole-session tokens, a state sentence, canResume', async () => {
  const f = rig({ turns: { ['code:' + sid('1')]: [t('user', 40 * MIN), t('assistant', 20 * MIN, { tool_name: 'Bash', text: '[tool: Bash]' })] } });
  const { sessions } = await f.b.poll();
  const s1 = sessions.find((s) => s.id === sid('1'));
  assert.equal(s1.project.matched, 'auto');
  assert.equal(s1.state, 'waiting-tool');
  assert.equal(s1.canResume, false);
  assert.deepEqual(s1.tokens, { in: 1, out: 2, cacheRead: 3 });
  const s2 = sessions.find((s) => s.id === sid('2'));
  assert.equal(s2.canResume, true);
  assert.equal(s2.cwdLabel, 'alpha-site');
  assert.ok(!JSON.stringify(sessions).includes(work), 'the real folder path never reaches the renderer');
});

test('a deleted transcript turns Resume off with the 30-day reason, without a hub call', async () => {
  const f = rig({ rows: [row('4', { last_at: iso(NOW0 - 3 * H) })] });   // no transcript file for session 4
  const { sessions } = await f.b.poll();
  assert.equal(sessions[0].canResume, false);
  assert.match(sessions[0].why, /older than 30 days/);
});

test('the classification is redone each tick from cached turns: a waiting session goes stale without a hub change', async () => {
  const f = rig({ rows: [row('1', { last_at: iso(NOW0 - 119 * MIN) })], turns: { ['code:' + sid('1')]: [t('assistant', 119 * MIN, { tool_name: 'Bash' })] } });
  assert.equal((await f.b.poll()).sessions[0].state, 'waiting-tool');
  f.setNow(NOW0 + 2 * MIN);
  const b = await f.b.poll();
  assert.equal(b.sessions[0].state, 'stopped-mid-tool');
  assert.equal(f.ops('getConversation').length, 1);
});

test('the limit count covers 7 days of sessions, while cards cover 24 h', async () => {
  const notice = "You've hit your weekly limit \u00b7 resets Nov 7, 5pm";
  const f = rig({
    rows: [row('1'), row('2', { last_at: iso(NOW0 - 3 * 24 * H) }), row('3', { last_at: iso(NOW0 - 6 * 24 * H) })],
    turns: { ['code:' + sid('2')]: [t('assistant', 3 * 24 * H, { text: notice })], ['code:' + sid('3')]: [t('assistant', 6 * 24 * H, { text: notice })] },
  });
  const b = await f.b.poll();
  assert.equal(b.sessions.length, 1);
  assert.equal(b.limitStops.count, 2);
  assert.equal(b.limitStops.last.kind, 'weekly');
});

test('a hub error gives hub-down and keeps the last sessions, read-only, stamped with the good time', async () => {
  const f = rig();
  const good = await f.b.poll();
  f.state.fail = 'connect ECONNREFUSED';
  f.setNow(NOW0 + 5 * MIN);
  const down = await f.b.poll();
  assert.equal(down.state, 'hub-down');
  assert.match(down.error, /ECONNREFUSED/);
  assert.equal(down.generatedAt, good.generatedAt, 'the board is shown from the last good time');
  assert.equal(down.sessions.length, good.sessions.length);
  assert.ok(down.sessions.every((s) => s.canResume === false && /Hub/.test(s.why)));
  f.state.fail = null;
  assert.equal((await f.b.poll()).state, 'ok');
});

test('a hub that is still starting reads "starting"; one that never answered has nothing yet', async () => {
  const f = rig();
  f.state.fail = 'the index is not open yet';
  const b = await f.b.poll();
  assert.equal(b.state, 'starting');
  assert.deepEqual(b.sessions, []);
  const none = SB.create({ hub: null, now: () => NOW0, env: { HQ_CODEX_HOME: path.join(ROOT, 'nope') } });
  const d = await none.poll();
  assert.equal(d.state, 'hub-down');
  assert.match(d.error, /not running/);
});

test('read(): the cached board, or the first poll; never throws', async () => {
  const f = rig();
  const r = await f.b.read();
  assert.equal(r.board.state, 'ok');
  const calls = f.calls.length;
  await f.b.read();
  assert.equal(f.calls.length, calls, 'a read after the first poll makes no hub call');
});

test('Codex lane: read only when the index mtime changes; titles masked; a missing index is no lane', async () => {
  const f = rig();
  assert.equal((await f.b.poll()).codex, null, 'no index, no lane, no error');
  fs.mkdirSync(f.codexHome, { recursive: true });
  const file = path.join(f.codexHome, 'session_index.jsonl');
  const lines = [
    { id: 'c1', thread_name: 'Alpha refactor', updated_at: '2026-11-02T10:00:00Z' },
    { id: 'c2', thread_name: 'key sk-ant-' + 'a'.repeat(30) + ' leak', updated_at: '2026-11-03T10:00:00Z' },
    { id: 'c3', thread_name: 'Epoch seconds', updated_at: Date.parse('2026-11-01T10:00:00Z') / 1000 },
  ].map((j) => JSON.stringify(j));
  fs.writeFileSync(file, lines.join('\n') + '\nnot json\n');
  const t1 = new Date('2026-11-04T00:00:00Z');
  fs.utimesSync(file, t1, t1);
  let b = await f.b.poll();
  assert.equal(b.codex.count, 3);
  assert.equal(b.codex.lastAt, '2026-11-03T10:00:00.000Z');
  assert.equal(b.codex.recent[0].title.includes('sk-ant-'), false);
  assert.equal(f.b.stats.codexReads, 1);
  await f.b.poll();
  assert.equal(f.b.stats.codexReads, 1, 'same mtime, no re-read');
  fs.appendFileSync(file, JSON.stringify({ id: 'c4', thread_name: 'New', updated_at: '2026-11-04T09:00:00Z' }) + '\n');
  const t2 = new Date('2026-11-04T09:30:00Z');
  fs.utimesSync(file, t2, t2);
  b = await f.b.poll();
  assert.equal(f.b.stats.codexReads, 2);
  assert.equal(b.codex.count, 4);
  fs.rmSync(file);
  assert.equal((await f.b.poll()).codex, null, 'a vanished index drops the lane quietly');
});

test('openTarget: only the cwd of a session on the board, a real directory, not a link', async () => {
  const f = rig();
  assert.match(f.b.openTarget(sid('1')).error, /not on the board/, 'before the first poll nothing is open-able');
  await f.b.poll();
  assert.deepEqual(f.b.openTarget(sid('1')), { cwd: work });
  for (const bad of ['C:/work/alpha-site', sid('9'), '', null, undefined, 42, { id: sid('1') }, 'code:' + sid('1')]) {
    assert.match(f.b.openTarget(bad).error, /not on the board/, String(bad));
  }
  const gone = rig({ rows: [row('1', { cwd: path.join(ROOT, 'gone-folder') })] });
  await gone.b.poll();
  assert.match(gone.b.openTarget(sid('1')).error, /no longer exists/);
  const link = path.join(ROOT, 'link-to-work');
  let linked = true;
  try { fs.symlinkSync(work, link, 'junction'); } catch { linked = false; }
  if (linked) {
    const lk = rig({ rows: [row('1', { cwd: link })] });
    await lk.b.poll();
    assert.match(lk.b.openTarget(sid('1')).error, /link/);
  }
  const nonAbs = rig({ rows: [row('1', { cwd: 'alpha-site' })] });
  await nonAbs.b.poll();
  assert.match(nonAbs.b.openTarget(sid('1')).error, /absolute/);
});

test('init: three handlers, push only when the board changes, resume and open-folder go through', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => { assert.ok(!handlers.has(ch), ch + ' twice'); handlers.set(ch, fn); } };
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, b) => sent.push([ch, b]) } };
  const opened = [];
  let nowMs = NOW0;
  const state = { rows: [row('2', { last_at: iso(NOW0 - 3 * H) })] };
  const hub = { request: async (op, a) => (op === 'listConversations' ? state.rows : op === 'listProjects' ? [] : { conversation: state.rows[0], messages: [t('assistant', 3 * H, { text: 'Done.' })] }) };
  const api = SB.init({ ipcMain, app: { on() {} }, hub, getWins: () => [win], shell: { openPath: async (p) => { opened.push(p); return ''; } }, repoRoot: ROOT,
    intervalMs: 0, now: () => nowMs, env: { HQ_CLAUDE_HOME: home, HQ_CODEX_HOME: path.join(ROOT, 'none'), HQ_DRY_LAUNCH: '1' }, appLog() {} });
  assert.deepEqual([...handlers.keys()].sort(), ['hq:sessions-board:open-folder', 'hq:sessions-board:read', 'hq:sessions-board:resume']);

  await api.tick();
  await api.tick();
  assert.equal(sent.length, 1, 'identical board, one push');
  assert.equal(sent[0][0], 'hq:sessions-board');
  nowMs += 2 * H;                   // time moved, nothing else: the age in the sentence changed
  await api.tick();
  assert.equal(sent.length, 2, 'a changed sentence is a changed board');

  const read = await handlers.get('hq:sessions-board:read')({});
  assert.equal(read.board.sessions.length, 1);
  assert.deepEqual(await handlers.get('hq:sessions-board:open-folder')({}, sid('2')), { ok: true });
  assert.deepEqual(opened, [work]);
  assert.match((await handlers.get('hq:sessions-board:open-folder')({}, 'C:/Windows')).error, /not on the board/);
  assert.deepEqual(await handlers.get('hq:sessions-board:resume')({}, sid('2'), { say: 'continue' }), { ok: true, dry: true });
  assert.match((await handlers.get('hq:sessions-board:resume')({}, sid('2'), { say: 'rm -rf' })).error, /only the word "continue"/);
  assert.match((await handlers.get('hq:sessions-board:resume')({}, 'nope')).error, /not a Claude Code session id/);
  api.resumer.cleanup();
  api.stop();
});

test('init: an unchanged board is still pushed once a minute, so the renderer\u2019s ages never go stale', async () => {
  const ipcMain = { handle() {} };
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, b) => sent.push(b) } };
  let nowMs = NOW0;
  // a prompt nobody answered: its sentence ("your last prompt has no reply") carries no age, so the signature never changes
  const state = { rows: [row('2', { last_at: iso(NOW0 - 10 * MIN) })] };
  const hub = { request: async (op) => (op === 'listConversations' ? state.rows : op === 'listProjects' ? [] : { conversation: state.rows[0], messages: [t('user', 10 * MIN)] }) };
  const api = SB.init({ ipcMain, app: { on() {} }, hub, getWins: () => [win], shell: {}, repoRoot: ROOT, intervalMs: 0, now: () => nowMs,
    env: { HQ_CLAUDE_HOME: home, HQ_CODEX_HOME: path.join(ROOT, 'none') }, appLog() {} });
  await api.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessions[0].state, 'no-reply');
  nowMs += 30e3; await api.tick();
  assert.equal(sent.length, 1, 'half a minute later and nothing changed: no push');
  nowMs += 31e3; await api.tick();
  assert.equal(sent.length, 2, 'a minute on, the same board is pushed again');
  assert.equal(sent[1].sessions[0].state, 'no-reply');
  assert.equal(sent[1].generatedAt, iso(nowMs), 'with a fresh generatedAt');
  nowMs += 20e3; await api.tick();
  assert.equal(sent.length, 2);
  api.stop();
});
