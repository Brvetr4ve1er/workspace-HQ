import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { handleRoute, setHub, getHub, checkItems, MAX_SYNC_BODY } = require('./claude-bridge-routes.js');

const H = { 'x-hq-bridge': '1' };
async function call(method, url, { headers = H, body = null, token = '' } = {}) {
  let done; const p = new Promise((r) => { done = r; });
  const chunks = body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(chunks); req.method = method; req.headers = headers;
  const handled = handleRoute(req, {}, { url, token, send: (code, obj) => done({ code, obj }) });
  if (!handled) done({ code: null, obj: null });
  return { handled, ...(await p) };
}
function fakeHub(answers) { const calls = []; return { calls, request(op, args, o) { calls.push([op, args, o]); return Promise.resolve(typeof answers[op] === 'function' ? answers[op](args) : answers[op]); } }; }
const conv = (uuid, extra = {}) => ({ kind: 'conversation', data: { uuid, chat_messages: [], ...extra } });

test('other urls fall through; unknown /claude/ urls are 404', async () => {
  assert.equal((await call('GET', '/social/outbox')).handled, false);
  setHub(fakeHub({}));
  assert.equal((await call('GET', '/claude/nope')).code, 404);
});

test('auth: header required, token enforced when set', async () => {
  setHub(fakeHub({ syncState: { conversations: {}, projects: {}, forgotten: [] } }));
  assert.equal((await call('GET', '/claude/sync-state', { headers: {} })).code, 403);
  assert.equal((await call('GET', '/claude/sync-state', { headers: { ...H, 'x-hq-token': 'wrong' }, token: 'tok' })).code, 403);
  const ok = await call('GET', '/claude/sync-state', { headers: { ...H, 'x-hq-token': 'tok' }, token: 'tok' });
  assert.equal(ok.code, 200); assert.deepEqual(ok.obj, { ok: true, conversations: {}, projects: {}, forgotten: [] });
  assert.equal((await call('POST', '/claude/sync', { headers: {}, body: { v: 1, items: [conv('a')] } })).code, 403);
});

test('no Hub yet / Hub errors map to 503 and 409', async () => {
  setHub(null);
  assert.equal(getHub(), null);
  assert.equal((await call('GET', '/claude/sync-state')).code, 503);
  setHub(fakeHub({ syncState: { error: 'hub not running' }, syncPush: { error: 'read-only hub (another WorkspaceHQ owns the index)' } }));
  assert.equal((await call('GET', '/claude/sync-state')).code, 503);
  assert.equal((await call('POST', '/claude/sync', { body: { v: 1, items: [conv('a')] } })).code, 409);
  setHub(fakeHub({ syncPush: { error: 'timeout' } }));
  assert.equal((await call('POST', '/claude/sync', { body: { v: 1, items: [conv('a')] } })).code, 503);
});

test('size cap: Content-Length and streamed bytes over 4 MB are 413; bad JSON is 400', async () => {
  setHub(fakeHub({ syncPush: {} }));
  assert.equal(MAX_SYNC_BODY, 4 * 1024 * 1024);
  assert.equal((await call('POST', '/claude/sync', { headers: { ...H, 'content-length': String(MAX_SYNC_BODY + 1) }, body: '{}' })).code, 413);
  const big = Buffer.alloc(MAX_SYNC_BODY + 10, 0x20);
  assert.equal((await call('POST', '/claude/sync', { body: big })).code, 413);
  const bad = await call('POST', '/claude/sync', { body: '{nope' });
  assert.equal(bad.code, 400); assert.equal(bad.obj.error, 'bad json');
});

test('schema checks', () => {
  assert.match(checkItems([]).error, /object/);
  assert.match(checkItems({ items: [conv('a')] }).error, /version/);
  assert.match(checkItems({ v: 1, items: [] }).error, /1–50/);
  assert.match(checkItems({ v: 1, items: Array.from({ length: 51 }, (_, i) => conv('c' + i)) }).error, /1–50/);
  assert.match(checkItems({ v: 1, items: [{ kind: 'user', data: { uuid: 'a' } }] }).error, /item 0: kind/);
  assert.match(checkItems({ v: 1, items: [conv('../x')] }).error, /item 0: data\.uuid/);
  assert.match(checkItems({ v: 1, items: [{ kind: 'conversation', data: { uuid: 'a' } }] }).error, /chat_messages/);
  assert.deepEqual(checkItems({ v: 1, items: [{ kind: 'project', data: { uuid: 'p' }, extra: 1 }] }), { items: [{ kind: 'project', data: { uuid: 'p' } }] });
});

test('a good push reaches syncPush with the items unchanged and answers the report', async () => {
  const hub = fakeHub({ syncPush: { conversations: { seen: 1, imported: 1, unchanged: 0, forgotten: 0, skipped: 0 } } });
  setHub(hub);
  const items = [conv('web-chat-1', { name: 'Placeholder', updated_at: '2026-10-05T09:00:00Z' })];
  const r = await call('POST', '/claude/sync', { body: { v: 1, items } });
  assert.equal(r.code, 200); assert.equal(r.obj.ok, true); assert.equal(r.obj.report.conversations.imported, 1);
  assert.deepEqual(hub.calls[0], ['syncPush', { items }, { timeout: 30000 }]);
});

test('browser-bridge.js routes /claude/ through handleRoute', () => {
  const src = fs.readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
  assert.match(src, /require\('\.\/claude-bridge-routes'\)/);
  assert.match(src, /url\.startsWith\('\/claude\/'\) && claudeRoutes\.handleRoute\(req, res, \{ url, send, token \}\)/);
});
