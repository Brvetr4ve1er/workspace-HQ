// POST /library/grab (dashboard/grab-routes.js) with the REAL clip service behind it (dashboard/cosmos/clips.mjs), over a tiny loopback
// http server that does what browser-bridge.js does before the mount (hands the request to handleRoute) — never port 47821, never
// the repo's data/. Temp folders, a fake pairing store, placeholder hosts, generated tiny images (cosmos/testimages.mjs) only.
//   node --test dashboard/grab-routes.test.mjs
// The one-line mount in browser-bridge.js is the Pass's; the end-to-end through startBridge is asserted when that line exists.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeClipService, MANIFEST_FILE, TMP_DIR, readManifest } from './cosmos/clips.mjs';
import { solidPng } from './cosmos/testimages.mjs';

const require = createRequire(import.meta.url);
const routes = require('./grab-routes.js');
const here = path.dirname(fileURLToPath(import.meta.url));

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const OTHER = 'chrome-extension://zyxwvutsrqponmlkzyxwvutsrqponmlk';
const TOKEN = 'a1'.repeat(32);
const BRIDGE = { 'x-hq-bridge': '1' };
const authed = (extra = {}) => ({ ...BRIDGE, 'x-hq-token': TOKEN, ...extra });
const png = (r, g, b) => Buffer.from(solidPng(r, g, b, 8, 8));
const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const settle = () => new Promise((r) => setTimeout(r, 30));

// ---- the server and the call helper ----------------------------------------------------------------------------------------
let server;
let port;
before(async () => {
  server = http.createServer((req, res) => {
    const url = String(req.url).split('?')[0];
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!routes.handleRoute(req, res, { url, send })) send(404, { ok: false, error: 'not mine' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

function call({ method = 'POST', path: p = '/library/grab', origin = EXT, headers = authed(), body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: `127.0.0.1:${port}`, ...(origin ? { origin } : {}), ...headers };
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
    if (payload !== null) h['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let obj = null; try { obj = JSON.parse(raw); } catch { /* none */ } resolve({ code: res.statusCode, obj, raw }); });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ---- an environment: temp tree, the real service, the route wired to it -----------------------------------------------------
function env({ maxBytes, folder = true, addClip: stub, token = TOKEN, now } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-routes-'));
  const dataDir = path.join(base, 'data');
  const cosmosDir = path.join(dataDir, 'cosmos');
  const importsDir = path.join(cosmosDir, 'imports');
  const grabRoot = path.join(base, 'Downloads', 'WorkspaceHQ', 'grabs');
  const outside = path.join(base, 'elsewhere');
  fs.mkdirSync(path.join(grabRoot, 'alpha-site.test'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(cosmosDir, { recursive: true });
  const calls = { reindex: 0 };
  const hooks = { afterOpen: null };
  const writes = [];
  const P = fs.promises;
  const wrapped = {
    ...fs,
    mkdirSync: (p, ...a) => { writes.push(String(p)); return fs.mkdirSync(p, ...a); },
    writeFileSync: (p, ...a) => { writes.push(String(p)); return fs.writeFileSync(p, ...a); },
    renameSync: (a, b) => { writes.push(String(a), String(b)); return fs.renameSync(a, b); },
    unlinkSync: (p) => { writes.push(String(p)); return fs.unlinkSync(p); },
    promises: {
      ...P,
      open: async (p, flags = 'r', ...r) => {
        if (/[wa+]/.test(String(flags))) writes.push(String(p));
        const fh = await P.open(p, flags, ...r);
        if (flags === 'r' && hooks.afterOpen) { const h = hooks.afterOpen; hooks.afterOpen = null; h(String(p)); }
        return fh;
      },
      link: async (a, b) => { writes.push(String(a), String(b)); return P.link(a, b); },
      rename: async (a, b) => { writes.push(String(a), String(b)); return P.rename(a, b); },
      unlink: async (p) => { writes.push(String(p)); return P.unlink(p); },
    },
  };
  let n = 0;
  const svc = makeClipService({
    fs: wrapped, cosmosDir, importsDir, maxBytes, newId: () => 't' + (++n),
    hasFolder: async () => folder, readWorks: async () => [], apply: async () => ({}), reindex: async () => { calls.reindex += 1; },
  });
  const audits = [];
  const clock = { t: Date.parse('2026-11-11T10:00:00Z') };
  routes.setDeps({
    dataDir, grabRoot,
    addClip: stub || ((a) => svc.addClip(a)),
    now: now || (() => clock.t),
    store: { get: () => token, isPairedOrigin: (o) => o === EXT },
    loadAudit: async () => ({ record: (dir, e) => { assert.equal(dir, dataDir); audits.push(e); } }),
  });
  const put = (host, name, bytes) => { const d = path.join(grabRoot, host); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, name); fs.writeFileSync(f, bytes); return f; };
  const grab = (abs, extra = {}) => call({ body: { path: abs, ...extra } });
  const tree = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, d.name); if (d.isDirectory()) tree(p, out); else out.push(p); }
    return out;
  };
  const imports = () => (fs.existsSync(importsDir) ? fs.readdirSync(importsDir) : []);
  const manifest = () => readManifest(fs, path.join(cosmosDir, MANIFEST_FILE)).clips;
  return { base, dataDir, cosmosDir, importsDir, grabRoot, outside, svc, calls, hooks, writes, audits, clock, put, grab, tree, imports, manifest, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe('POST /library/grab: the front door', () => {
  it('only /library/ is this route\'s: any other url is not answered by it', () => {
    env().done();
    assert.equal(routes.handleRoute({ headers: {} }, {}, { url: '/assist/brief', send() {} }), false);
    assert.equal(routes.handleRoute({ headers: {} }, {}, { url: '/pair', send() {} }), false);
  });

  it('unpaired: 401 pair first (the route fails closed); the bridge header is checked before anything else', async () => {
    const e = env({ token: '' });
    try {
      const a = await call({ headers: BRIDGE, body: { path: 'x' } });
      assert.deepEqual([a.code, a.obj.error], [401, 'pair first']);
      const b = await call({ headers: {}, body: { path: 'x' } });
      assert.equal(b.code, 403);
      assert.equal(b.obj.error, 'missing bridge header');
    } finally { e.done(); }
  });

  it('only POST /library/grab exists: a GET and another /library/ path are 404', async () => {
    const e = env();
    try {
      assert.equal((await call({ method: 'GET', headers: authed() })).code, 404);
      assert.equal((await call({ path: '/library/other', headers: authed(), body: {} })).code, 404);
      assert.equal((await call({ path: '/library/', headers: authed(), body: {} })).code, 404);
    } finally { e.done(); }
  });

  it('a web page origin, another extension, and no origin are 403 even with the right token; a wrong or missing token is 401', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'a.png', png(1, 2, 3));
      for (const origin of ['https://example.com', OTHER, '']) {
        const r = await call({ origin, body: { path: abs } });
        assert.deepEqual([r.code, r.obj.error], [403, 'wrong origin'], origin);
      }
      assert.equal((await call({ headers: authed({ 'x-hq-token': 'f'.repeat(64) }), body: { path: abs } })).code, 401);
      assert.equal((await call({ headers: BRIDGE, body: { path: abs } })).code, 401);
      assert.equal(e.imports().length, 0, 'none of these copied anything');
    } finally { e.done(); }
  });

  it('a body over 4 KB is drained, then answered 413 (never destroyed): the next request on the server is served', async () => {
    const e = env();
    try {
      const r = await call({ body: Buffer.alloc(4 * 1024 + 10, 0x20) });
      assert.deepEqual([r.code, r.obj.error], [413, 'too large']);
      const ok = await e.grab(e.put('alpha-site.test', 'a.png', png(1, 2, 3)));
      assert.equal(ok.code, 200);
    } finally { e.done(); }
  });

  it('bad JSON and malformed bodies are 400 and copy nothing', async () => {
    const e = env();
    try {
      assert.equal((await call({ body: '{nope' })).code, 400);
      for (const body of [[], 5, null, {}, { path: '' }, { path: 5 }, { path: 'x'.repeat(1025) }, { path: 'C:/x', pageUrl: 5 }, { path: 'C:/x', pageTitle: {} }]) {
        const r = await call({ body: body === null ? 'null' : body });
        assert.equal(r.code, 400, JSON.stringify(body));
      }
      assert.equal(e.imports().length, 0);
    } finally { e.done(); }
  });

  it('the 121st grab in an hour is 429; an hour later there is room again', async () => {
    const e = env({ addClip: async () => ({ ok: true, status: 200, duplicate: false, indexed: false }) });
    try {
      for (let i = 0; i < routes.CAP; i++) assert.equal((await call({ body: { path: 'C:/x/' + i } })).code, 200, 'grab ' + (i + 1));
      assert.equal((await call({ body: { path: 'C:/x/last' } })).code, 429);
      e.clock.t += 3600e3 + 1;
      assert.equal((await call({ body: { path: 'C:/x/again' } })).code, 200);
      assert.equal(routes.CAP, 120);
      assert.equal(routes.MAX_BODY, 4096);
    } finally { e.done(); }
  });
});

describe('POST /library/grab: what is copied and what is refused', () => {
  it('a real grab: 200 { ok, indexed:false } with no duplicate key, the original stays, the copy is clip-<hash12>.png, the host is the folder\'s own', async () => {
    const e = env();
    try {
      const bytes = png(200, 30, 30);
      const abs = e.put('alpha-site.test', 'poster-300.png', bytes);
      const r = await e.grab(abs, { pageUrl: 'https://alpha-site.test/blog/acme-poster-launch?utm=1#x', pageTitle: 'Acme poster launch day' });
      assert.deepEqual([r.code, r.obj], [200, { ok: true, indexed: false }]);
      assert.deepEqual(e.imports(), [`clip-${sha12(bytes)}.png`]);
      assert.ok(fs.readFileSync(abs).equals(bytes));
      assert.equal(e.manifest()[0].host, 'alpha-site.test');
      assert.equal(e.manifest()[0].page, 'alpha-site.test/blog/acme-poster-launch');
      assert.ok(!r.raw.includes(path.basename(abs)) && !r.raw.includes(e.base), 'the answer names no file or folder');
      assert.equal(e.calls.reindex, 1);
    } finally { e.done(); }
  });

  it('a duplicate answers duplicate:true and changes nothing (imports, notes, index runs)', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'a.png', png(9, 9, 9));
      await e.grab(abs);
      const snap = e.tree(e.cosmosDir).map((p) => [p, fs.statSync(p).mtimeMs, fs.statSync(p).size]);
      const manifestText = fs.readFileSync(path.join(e.cosmosDir, MANIFEST_FILE), 'utf8');
      const reindex = e.calls.reindex;
      e.writes.length = 0;
      const r = await e.grab(abs);
      assert.deepEqual([r.code, r.obj], [200, { ok: true, duplicate: true, indexed: false }]);
      assert.deepEqual(e.tree(e.cosmosDir).map((p) => [p, fs.statSync(p).mtimeMs, fs.statSync(p).size]), snap);
      assert.equal(fs.readFileSync(path.join(e.cosmosDir, MANIFEST_FILE), 'utf8'), manifestText);
      assert.equal(e.imports().length, 1);
      assert.equal(e.calls.reindex, reindex + 1, 'only the harmless "run an index" ask, which is single-flight');
    } finally { e.done(); }
  });

  it('Cosmos has no folder yet: 409 with the fixed sentence, nothing created', async () => {
    const e = env({ folder: false });
    try {
      const r = await e.grab(e.put('alpha-site.test', 'a.png', png(1, 1, 1)));
      assert.deepEqual([r.code, r.obj], [409, { ok: false, error: 'Cosmos has no folder yet' }]);
      assert.equal(fs.existsSync(e.importsDir), false);
    } finally { e.done(); }
  });

  it('a path outside the grab folder is refused 403 — also one that does not exist, so nothing can be probed — and a relative path is 400', async () => {
    const e = env();
    try {
      const real = path.join(e.outside, 'real.png');
      fs.writeFileSync(real, png(1, 2, 3));
      const sibling = path.join(path.dirname(e.grabRoot), 'grabs-evil', 'alpha-site.test');
      fs.mkdirSync(sibling, { recursive: true });
      fs.writeFileSync(path.join(sibling, 'x.png'), png(1, 2, 4));
      const tries = [
        real,
        path.join(e.outside, 'does-not-exist.png'),
        path.join(sibling, 'x.png'),                                               // grabs-evil is not grabs
        path.join(e.grabRoot, '..', 'elsewhere', 'real.png'),                      // a ../ path that ends outside
        path.join(e.grabRoot, 'alpha-site.test', '..', '..', '..', 'elsewhere', 'real.png'),
        e.grabRoot,                                                                // the folder itself
      ];
      const answers = [];
      for (const p of tries) { const r = await e.grab(p); answers.push([r.code, r.obj.error]); }
      assert.ok(answers.every(([c]) => c === 403), JSON.stringify(answers));
      assert.equal(new Set(answers.map(([, m]) => m)).size, 1, 'the same words for an existing and a missing file');
      for (const p of ['alpha-site.test/a.png', 'a.png', '..\\..\\x.png', 'file:///C:/x.png']) assert.equal((await e.grab(p)).code, 400, p);
      assert.equal(e.imports().length, 0);
    } finally { e.done(); }
  });

  it('a file straight in the grab folder, or deeper than <host>/<file>, is not a grab', async () => {
    const e = env();
    try {
      const top = path.join(e.grabRoot, 'top.png');
      fs.writeFileSync(top, png(1, 2, 3));
      const deep = e.put('alpha-site.test', 'a.png', png(1, 2, 5));
      const nested = path.join(path.dirname(deep), 'sub');
      fs.mkdirSync(nested);
      fs.writeFileSync(path.join(nested, 'b.png'), png(1, 2, 6));
      assert.equal((await e.grab(top)).code, 403);
      assert.equal((await e.grab(path.join(nested, 'b.png'))).code, 403);
      assert.equal((await e.grab(deep)).code, 200);
    } finally { e.done(); }
  });

  it('a symlink or Windows junction out of the grab folder is refused, and a missing file inside is 404', async () => {
    const e = env();
    try {
      fs.writeFileSync(path.join(e.outside, 'secret.png'), png(5, 5, 5));
      fs.symlinkSync(e.outside, path.join(e.grabRoot, 'evil.test'), 'junction');   // a directory link; a junction on Windows, no privilege needed
      const r = await e.grab(path.join(e.grabRoot, 'evil.test', 'secret.png'));
      assert.equal(r.code, 403, 'the directory link points outside');
      let fileLinkMade = true;
      try { fs.symlinkSync(path.join(e.outside, 'secret.png'), path.join(e.grabRoot, 'alpha-site.test', 'link.png'), 'file'); } catch { fileLinkMade = false; }   // Windows needs a privilege for file links
      if (fileLinkMade) assert.equal((await e.grab(path.join(e.grabRoot, 'alpha-site.test', 'link.png'))).code, 403, 'the file link points outside');
      assert.equal((await e.grab(path.join(e.grabRoot, 'alpha-site.test', 'gone.png'))).code, 404);
      assert.equal(e.imports().length, 0);
    } finally { e.done(); }
  });

  it('a file swapped between the check and the copy: what is copied is what the open handle holds', async () => {
    const e = env();
    try {
      const original = png(11, 22, 33);
      const abs = e.put('alpha-site.test', 'a.png', original);
      e.hooks.afterOpen = (p) => {
        assert.equal(path.basename(p), 'a.png');
        fs.renameSync(p, p + '.orig');                                                       // the name now points at something else
        fs.writeFileSync(p, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'));
      };
      const r = await e.grab(abs);
      assert.equal(r.code, 200);
      assert.deepEqual(e.imports(), [`clip-${sha12(original)}.png`], 'named for the bytes that were really copied');
      assert.ok(fs.readFileSync(path.join(e.importsDir, e.imports()[0])).equals(original));
      assert.ok(!fs.readFileSync(path.join(e.importsDir, e.imports()[0])).includes('<script'));
    } finally { e.done(); }
  });

  it('SVG and HTML renamed .png, a script, and a family that does not match the extension are refused 415 by the first bytes', async () => {
    const e = env();
    try {
      const rows = [
        ['evil.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
        ['page.png', Buffer.from('<!doctype html><script>alert(1)</script>')],
        ['run.png', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')],
        ['shell.jpg', Buffer.from('#!/bin/sh\nrm -rf /\n')],
        ['really-png.jpg', png(1, 2, 3)],                                                   // a PNG named .jpg: the family does not match
        ['really-gif.png', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])],
        ['vector.svg', Buffer.from('<svg/>')],
        ['tool.exe', png(1, 2, 3)],
        ['noext', png(1, 2, 3)],
        ['empty.png', Buffer.alloc(0)],
      ];
      for (const [name, bytes] of rows) {
        const r = await e.grab(e.put('alpha-site.test', name, bytes));
        assert.equal(r.code, 415, name);
        assert.equal(r.obj.ok, false);
      }
      assert.equal(e.imports().length, 0);
      assert.equal(e.manifest().length, 0);
      assert.deepEqual(fs.existsSync(path.join(e.cosmosDir, TMP_DIR)) ? fs.readdirSync(path.join(e.cosmosDir, TMP_DIR)) : [], [], 'no temp left');
    } finally { e.done(); }
  });

  it('64 MB + 1 byte is refused 413 before a byte is copied; at the limit it is accepted (a smaller limit stands in for the boundary)', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'huge.png', png(1, 2, 3));
      fs.truncateSync(abs, 64 * 1024 * 1024 + 1);                                           // sparse: a real PNG header followed by zeros
      const r = await e.grab(abs);
      assert.deepEqual([r.code, r.obj.ok], [413, false]);
      assert.deepEqual(fs.existsSync(path.join(e.cosmosDir, TMP_DIR)) ? fs.readdirSync(path.join(e.cosmosDir, TMP_DIR)) : [], []);
    } finally { e.done(); }
    const small = env({ maxBytes: 3000 });
    try {
      const pad = (n) => { const b = png(4, 4, 4); return Buffer.concat([b, Buffer.alloc(n - b.length)]); };
      assert.equal((await small.grab(small.put('alpha-site.test', 'exact.png', pad(3000)))).code, 200);
      assert.equal((await small.grab(small.put('alpha-site.test', 'over.png', pad(3001)))).code, 413);
      assert.equal(small.imports().length, 1);
    } finally { small.done(); }
  });

  it('a body field that names a host, a root, a name or a url of its own is ignored: only the folder\'s own segment counts', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'a.png', png(3, 3, 3));
      const r = await e.grab(abs, { host: 'evil.test', grabRoot: e.outside, abs: path.join(e.outside, 'x.png'), name: 'x.png', file: 'x.png' });
      assert.equal(r.code, 200);
      assert.equal(e.manifest()[0].host, 'alpha-site.test');
      // a request that tries to move the grab root cannot widen it
      const out = path.join(e.outside, 'o.png');
      fs.writeFileSync(out, png(7, 7, 7));
      assert.equal((await e.grab(out, { grabRoot: e.outside })).code, 403);
      assert.equal(e.imports().length, 1);
    } finally { e.done(); }
  });

  it('nothing is ever written outside data/cosmos, whatever the request does', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'a.png', png(3, 3, 4));
      e.writes.length = 0;
      await e.grab(abs);
      await e.grab(path.join(e.outside, 'x.png'));
      await e.grab(e.put('alpha-site.test', 'bad.png', Buffer.from('<svg/>')));
      assert.ok(e.writes.length > 0);
      for (const p of e.writes) assert.ok(!path.relative(e.cosmosDir, p).startsWith('..'), 'a write outside data/cosmos: ' + p);
    } finally { e.done(); }
  });

  it('a stub that throws is a sentence-only 500; a missing addClip or grabRoot is 503; unknown statuses become 500', async () => {
    let e = env({ addClip: async () => { throw new Error('C:/Users/someone/secret/path exploded'); } });
    try {
      const r = await call({ body: { path: 'C:/x/a.png' } });
      assert.equal(r.code, 500);
      assert.ok(!r.raw.includes('someone'), 'the exception text never leaves');
    } finally { e.done(); }
    e = env({ addClip: async () => ({ ok: false, status: 418, error: 'teapot' }) });
    try { assert.equal((await call({ body: { path: 'C:/x/a.png' } })).code, 500); } finally { e.done(); }
    e = env();
    try {
      routes.setDeps({ dataDir: e.dataDir, grabRoot: e.grabRoot, store: { get: () => TOKEN, isPairedOrigin: (o) => o === EXT }, loadAudit: async () => ({ record() {} }) });
      assert.equal((await call({ body: { path: 'C:/x/a.png' } })).code, 503);
      routes.setDeps({ dataDir: e.dataDir, addClip: async () => ({ ok: true }), store: { get: () => TOKEN, isPairedOrigin: (o) => o === EXT }, loadAudit: async () => ({ record() {} }) });
      assert.equal((await call({ body: { path: 'C:/x/a.png' } })).code, 503);
    } finally { e.done(); }
    routes.setDeps(null);
    const nodeps = await call({ body: { path: 'x' } });
    assert.equal(nodeps.code, 503);
  });
});

describe('POST /library/grab: the audit log', () => {
  it('one names-only record per call: tool library.grab (tier note, door browser) once the token checked out, and no path, name, host or url in it', async () => {
    const e = env();
    try {
      const abs = e.put('alpha-site.test', 'poster-300.png', png(8, 8, 8));
      await e.grab(abs, { pageUrl: 'https://alpha-site.test/blog/p?token=abc', pageTitle: 'Acme' });          // 200
      await e.grab(abs);                                                                                           // 200 duplicate
      await e.grab(path.join(e.outside, 'x.png'));                                                                  // 403
      await call({ body: { path: '' } });                                                                           // 400
      await settle();
      assert.equal(e.audits.length, 4);
      for (const a of e.audits) {
        assert.deepEqual(Object.keys(a).sort(), ['at', 'door', 'ms', 'ok', 'pid', 'tier', 'tool']);
        assert.deepEqual([a.door, a.tool, a.tier], ['browser', 'library.grab', 'note']);
      }
      assert.deepEqual(e.audits.map((a) => a.ok), [true, true, false, false]);
      const text = JSON.stringify(e.audits);
      for (const bit of ['alpha-site', 'poster', 'png', 'token=', 'Acme', e.base, 'elsewhere', 'Downloads']) assert.ok(!text.includes(bit), 'leaked: ' + bit);
    } finally { e.done(); }
  });

  it('refusals before the token checks out share one fixed name and a budget of 20 records an hour', async () => {
    const e = env();
    try {
      for (let i = 0; i < 30; i++) await call({ origin: 'https://example.com', body: { path: 'x' } });     // 403 wrong origin
      await call({ headers: {}, body: { path: 'x' } });                                                       // 403 no bridge header
      await call({ method: 'GET', headers: authed() });                                                       // 404
      await settle();
      assert.equal(e.audits.length, 20);
      assert.ok(e.audits.every((a) => a.tool === 'library.refused' && a.ok === false && a.tier === 'read'));
      e.clock.t += 3600e3 + 1;
      await call({ origin: 'https://example.com', body: { path: 'x' } });
      await settle();
      assert.equal(e.audits.length, 21, 'the budget refills after an hour');
    } finally { e.done(); }
  });

  it('a missing or failing audit module never breaks the route', async () => {
    const e = env();
    try {
      routes.setDeps({
        dataDir: e.dataDir, grabRoot: e.grabRoot, addClip: (a) => e.svc.addClip(a), store: { get: () => TOKEN, isPairedOrigin: (o) => o === EXT },
        loadAudit: async () => { throw new Error('audit module gone'); },
      });
      assert.equal((await e.grab(e.put('alpha-site.test', 'a.png', png(1, 2, 3)))).code, 200);
      await settle();
    } finally { e.done(); }
  });
});

describe('the mount in browser-bridge.js (asserted once the Pass has made its one line)', () => {
  const bridgeSrc = fs.readFileSync(path.join(here, 'browser-bridge.js'), 'utf8');
  const mounted = /url\.startsWith\(['"]\/library\/['"]\)/.test(bridgeSrc);
  it('is mounted before the ingest routes, and /health says 0.8.0', { skip: mounted ? false : 'PENDING the Pass: browser-bridge.js has no /library/ mount line yet' }, () => {
    assert.match(bridgeSrc, /grab-routes/);
    assert.ok(bridgeSrc.indexOf("'/library/'") < bridgeSrc.indexOf("routes.has(url)"));
    assert.match(bridgeSrc, /bridge: '0\.8\.0'/);
  });
});
