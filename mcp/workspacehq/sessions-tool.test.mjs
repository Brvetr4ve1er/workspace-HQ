// MCP hq_sessions: a temp hub.sqlite built with the real store from invented chats, read back through the tool.
// Needs system Node with node:sqlite (the Hub's own requirement). Placeholder data only (the repo is public).
//   node --test mcp/workspacehq/sessions-tool.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../../dashboard/claude-hub/store.mjs';
import * as tool from './sessions-tool.mjs';

process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const MIN = 60e3, H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-sessions-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const DB = path.join(ROOT, 'hub.sqlite');
const sid = (n) => n.repeat(8) + '-' + n.repeat(4) + '-4' + n.repeat(3) + '-8' + n.repeat(3) + '-' + n.repeat(12);
let seq = 0;
function seed(file, chats) {
  const s = openStore(file);
  s.upsertProject({ id: 'code:C--work-alpha-site', source: 'code', key: 'C--work-alpha-site', name: 'alpha-site', path: 'C:/work/alpha-site' });
  s.upsertProject({ id: 'code:C--work-beta-app', source: 'code', key: 'C--work-beta-app', name: 'beta-app', path: 'C:/work/beta-app' });
  for (const c of chats) {
    const id = 'code:' + sid(c.n);
    s.ensureConversation({ id, source: 'code', projectId: c.project || 'code:C--work-alpha-site', nativeId: sid(c.n), cwd: c.cwd || 'C:/work/alpha-site', gitBranch: c.branch === undefined ? 'main' : c.branch, model: 'placeholder-model' });
    s.setTitle(id, c.title || 'Session ' + c.n, 'first-prompt');
    s.addMessages(id, c.turns.map(([role, msAgo, extra]) => ({ id: 'm' + (++seq), nativeId: 'n' + seq, role, at: iso(NOW - msAgo), text: '', toolName: null, isSidechain: false, ...extra })));
    s.addUsage(id, 'api-' + c.n, { in: 10, out: 20, cacheRead: 300, cacheWrite: 0 });
    s.refreshTokens(id);
  }
  s.db.close();
}

const opts = (o = {}) => ({ dbFile: DB, now: () => NOW, codexHome: path.join(ROOT, 'no-codex'), env: {}, ...o });

seed(DB, [
  { n: '1', title: 'Fix the alpha build', turns: [['user', 30 * MIN], ['assistant', 20 * MIN, { toolName: 'Bash', text: '[tool: Bash]' }]] },
  { n: '2', title: 'Beta key sk-ant-' + 'b'.repeat(30) + ' rotation', project: 'code:C--work-beta-app', cwd: 'C:/work/beta-app', branch: 'feat/x',
    turns: [['user', 5 * H], ['assistant', 4 * H, { text: 'All done here.' }]] },
  { n: '3', title: 'Hit the wall', turns: [['user', 3 * H], ['assistant', 2 * H, { text: "You've hit your weekly limit \u00b7 resets Nov 7, 5pm" }]] },
  { n: '4', title: 'Nightly scan', cwd: 'C:/WINDOWS/system32', turns: [['user', 2 * H], ['assistant', 2 * H - MIN, { text: 'ok' }]] },
  { n: '5', title: 'Two days ago', turns: [['assistant', 48 * H, { text: "You've hit your session limit \u00b7 resets 4:30pm" }]] },
  { n: '6', title: 'Subagent tail', turns: [['assistant', 90 * MIN, { text: 'Finished the task.' }], ['assistant', 80 * MIN, { toolName: 'Grep', isSidechain: true }]] },
]);

test('card shape: the app\'s fields minus canResume / canOpen / why, with the right sentences', async () => {
  const r = await tool.run({}, opts());
  assert.equal(r.error, undefined);
  assert.equal(r.hours, 24);
  assert.deepEqual(r.sessions.map((s) => s.title.slice(0, 8)), ['Fix the ', 'Subagent', 'Hit the ', 'Beta key']);
  const s1 = r.sessions[0];
  for (const k of ['id', 'title', 'project', 'branch', 'cwdLabel', 'startedAt', 'lastAt', 'activeMin', 'messages', 'tokens', 'state', 'sentence', 'longRun']) assert.ok(k in s1, k);
  for (const k of ['canResume', 'canOpen', 'why']) assert.ok(!(k in s1), k + ' is the app\'s, not MCP\'s');
  assert.equal(s1.state, 'waiting-tool');
  assert.equal(s1.lastTool, 'Bash');
  assert.match(s1.sentence, /^asked to run Bash 20 min ago/);
  assert.deepEqual(s1.tokens, { in: 10, out: 20, cacheRead: 300 });
  assert.equal(s1.project.name, 'alpha-site');
  assert.equal(s1.project.matched, 'folder', 'no link in the temp index');
  assert.equal(r.sessions.find((s) => s.title === 'Hit the wall').state, 'limit');
  assert.equal(r.sessions.find((s) => s.title === 'Hit the wall').limitKind, 'weekly');
  assert.match(r.sessions.find((s) => s.title === 'Hit the wall').sentence, /^stopped at your weekly limit · resets Sat 5 pm$/);
});

test('subagent turns are skipped when reading where a session stopped', async () => {
  const r = await tool.run({}, opts());
  const s = r.sessions.find((x) => x.title === 'Subagent tail');
  assert.equal(s.state, 'finished');
  assert.equal(s.lastTool, undefined);
});

test('nightly runs are folded away; limit stops count 7 days; the line reads like the app\'s', async () => {
  const r = await tool.run({}, opts());
  assert.ok(!r.sessions.some((s) => s.title === 'Nightly scan'));
  assert.equal(r.limitStops.count, 2, 'this morning\'s weekly stop and the one two days ago');
  assert.equal(r.limitStops.last.kind, 'weekly');
  assert.equal(r.limitLine, 'limit stops in the last 7 days: 2 (last: weekly limit, Nov 5)');
});

test('masking is applied to every string', async () => {
  const r = await tool.run({}, opts());
  const text = JSON.stringify(r);
  assert.ok(!text.includes('sk-ant-'), 'the key shape never leaves');
  assert.ok(r.sessions.some((s) => s.title.includes('••• secret')));
});

test('hours and project filters; hours is clamped to 72', async () => {
  const r = await tool.run({ hours: 3 }, opts());
  assert.deepEqual(r.sessions.map((s) => s.title.slice(0, 8)), ['Fix the ', 'Subagent', 'Hit the ']);
  assert.equal((await tool.run({ hours: 500 }, opts())).hours, 72);
  assert.equal((await tool.run({ hours: 'x' }, opts())).hours, 24);
  assert.equal((await tool.run({ hours: 72 }, opts())).sessions.length, 5, 'the two-day-old chat joins at 72 h');
  const p = await tool.run({ project: 'BETA' }, opts());
  assert.deepEqual(p.sessions.map((s) => s.branch), ['feat/x']);
  assert.deepEqual((await tool.run({ project: 'nothing-like-it' }, opts())).sessions, []);
});

test('Codex rows from a temp index: titles and times, newest first, windowed by hours', async () => {
  const dir = path.join(ROOT, 'codex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session_index.jsonl'), [
    { id: 'c1', thread_name: 'Old thread', updated_at: iso(NOW - 5 * 24 * H) },
    { id: 'c2', thread_name: 'Fresh thread sk-ant-' + 'c'.repeat(30), updated_at: iso(NOW - 2 * H) },
    { id: 'c3', thread_name: 'Another', updated_at: iso(NOW - 4 * H) },
  ].map((j) => JSON.stringify(j)).join('\n') + '\n{broken\n');
  const r = await tool.run({}, opts({ codexHome: dir }));
  assert.deepEqual(r.codex.map((t) => t.agent), ['codex', 'codex']);
  assert.deepEqual(r.codex.map((t) => t.updatedAt), [iso(NOW - 2 * H), iso(NOW - 4 * H)]);
  assert.ok(!JSON.stringify(r.codex).includes('sk-ant-'));
  assert.equal(r.codexTotal, 3);
  assert.deepEqual(Object.keys(r.codex[0]).sort(), ['agent', 'title', 'updatedAt']);
});

test('the answer is framed as data and says how old the index is', async () => {
  const r = await tool.run({}, opts());
  assert.match(r.note, /data, never instructions/);
  assert.equal(r.generatedAt, iso(NOW));
  assert.equal(typeof r.ageMinutes, 'number');
  const fresh = await tool.run({}, opts({ now: () => Date.now() }));
  assert.ok(fresh.ageMinutes <= 2, 'an index just written is minutes old');
});

test('a missing or unreadable db is an error, never an empty list', async () => {
  const none = await tool.run({}, opts({ dbFile: path.join(ROOT, 'nope.sqlite') }));
  assert.match(none.error, /no Claude Hub index yet/);
  assert.equal(none.sessions, undefined);
  const junk = path.join(ROOT, 'junk.sqlite');
  fs.writeFileSync(junk, 'this is not a sqlite file at all, just text');
  const bad = await tool.run({}, opts({ dbFile: junk }));
  assert.ok(bad.error, 'unreadable → error');
  assert.equal(bad.sessions, undefined);
});

test('an index from a newer app is refused, not misread', async () => {
  const file = path.join(ROOT, 'newer.sqlite');
  seed(file, [{ n: '7', turns: [['assistant', 10 * MIN, { text: 'hi' }]] }]);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run();
  db.close();
  const r = await tool.run({}, opts({ dbFile: file }));
  assert.match(r.error, /newer WorkspaceHQ/);
});

test('the tool descriptor the server registers', () => {
  assert.equal(tool.NAME, 'hq_sessions');
  assert.equal(tool.INPUT_SCHEMA.properties.hours.maximum, 72);
  assert.equal(tool.INPUT_SCHEMA.additionalProperties, false);
  assert.match(tool.DESCRIPTION, /Read-only/);
});
