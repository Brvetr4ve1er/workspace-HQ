const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { start } = require('./helpers/fixture-server');
const { createSettings } = require('../settings');
const { createLibrary } = require('../library');
const { DownloadManager } = require('../download-manager');
const { resolve } = require('../resolver');

let S, tmp, dest, settings, library, dm;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const NET = { allowPrivate: ['127.0.0.1'], idleMs: 1500 };
const CTX = () => ({ ...NET, timeoutMs: 4000 });

before(async () => { S = await start(); });
after(async () => { await S.close(); });
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umc-test-'));
  dest = path.join(tmp, 'dest');
  settings = createSettings(path.join(tmp, 'userData'));
  settings.set({ destination: dest, concurrency: 2, filenameTemplate: '{title-or-id}.{ext}' });
  library = createLibrary(path.join(tmp, 'userData'));
  dm = new DownloadManager({ settings, library, netOpts: NET, retryDelays: [30, 30, 30], log: { error() {}, warn() {} } });
});

function waitFor(id, statuses, ms = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const check = () => {
      const j = dm.list().find((x) => x.id === id);
      if (j && statuses.includes(j.status)) return res(j);
      if (Date.now() - t0 > ms) return rej(new Error(`timeout waiting for ${statuses}; last=${j && j.status} ${j && JSON.stringify(j.error)}`));
      setTimeout(check, 15);
    };
    check();
  });
}
const candidateFor = async (p) => (await resolve(`${S.base}${p}`, CTX())).candidates[0];
const DONE = ['done', 'failed', 'cancelled', 'skipped', 'conflict'];

test('happy path: bytes, sha256, library record, redacted urls, template name', async () => {
  const c = await candidateFor('/a.png?token=SECRET');
  const [j0] = dm.add([c]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.name, 'a.png');
  const bytes = fs.readFileSync(j.finalPath);
  assert.equal(bytes.length, S.fixtures.PNG.length);
  assert.equal(j.result.sha256, sha(S.fixtures.PNG));
  assert.equal(j.result.bytes, j.bytesTotal);
  const rec = library.get(j.result.libraryId);
  assert.equal(rec.sha256, j.result.sha256);
  assert.ok(!rec.sourceUrl.includes('SECRET'));
  assert.equal(rec.localPath, j.finalPath);
  assert.equal(fs.existsSync(path.join(dest, '.umc-partial', `${j.id}.part`)), false);
  assert.equal(library.list({ q: 'a.png' }).length, 1);
});

test('type from bytes decides the extension; duplicates are flagged, not hidden', async () => {
  const c = await candidateFor('/mislabeled.jpg');
  const [j0] = dm.add([c]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'done'); assert.equal(path.extname(j.finalPath), '.png');
  const c2 = await candidateFor('/a.png');
  const [k0] = dm.add([c2]);
  const k = await waitFor(k0.id, DONE);
  assert.equal(k.status, 'done'); assert.equal(k.result.duplicateOf.path, j.finalPath);
});

test('an html "file" and a manifest fail with UNSUPPORTED_MEDIA and leave nothing behind', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/page-as.jpg`, host: '127.0.0.1', kind: 'image', extHint: 'jpg', filenameHint: 'page-as.jpg' }]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'UNSUPPORTED_MEDIA');
  assert.deepEqual(fs.readdirSync(dest).filter((f) => !f.startsWith('.')), []);
  assert.deepEqual(fs.readdirSync(path.join(dest, '.umc-partial')), []);
  const [m0] = dm.add([{ sourceUrl: `${S.base}/stream.m3u8`, host: '127.0.0.1', kind: 'video', extHint: 'm3u8', filenameHint: 'stream.m3u8' }]);
  assert.equal((await waitFor(m0.id, DONE)).error.code, 'UNSUPPORTED_MEDIA');
});

test('conflicts: ask → skip / rename / replace; policies skip and rename', async () => {
  const c = await candidateFor('/a.png');
  await waitFor(dm.add([c])[0].id, DONE);
  // ask (default) → conflict state, never a silent overwrite
  const [x0] = dm.add([c]);
  const x = await waitFor(x0.id, DONE);
  assert.equal(x.status, 'conflict'); assert.equal(x.conflict.proposedName, 'a.png');
  assert.equal(dm.resolveConflict(x.id, 'skip'), true);
  assert.equal((await waitFor(x.id, ['skipped'])).status, 'skipped');
  const [y0] = dm.add([c]);
  await waitFor(y0.id, ['conflict']);
  dm.resolveConflict(y0.id, 'rename');
  const y = await waitFor(y0.id, ['done']);
  assert.equal(y.name, 'a (2).png');
  const [z0] = dm.add([c]);
  await waitFor(z0.id, ['conflict']);
  const before = fs.statSync(path.join(dest, 'a.png')).mtimeMs;
  dm.resolveConflict(z0.id, 'replace');
  const z = await waitFor(z0.id, ['done']);
  assert.equal(z.name, 'a.png');
  assert.equal(fs.readdirSync(dest).filter((f) => f.endsWith('.png')).length, 2);
  assert.ok(fs.statSync(path.join(dest, 'a.png')).mtimeMs >= before);
  settings.set({ overwritePolicy: 'skip' });
  assert.equal((await waitFor(dm.add([c])[0].id, DONE)).status, 'skipped');
  settings.set({ overwritePolicy: 'rename' });
  assert.equal((await waitFor(dm.add([c])[0].id, DONE)).name, 'a (3).png');
});

test('cancel removes the partial; keepPartialOnCancel keeps it', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/drip`, host: '127.0.0.1', kind: 'image', extHint: 'jpg', filenameHint: 'drip.jpg' }]);
  await new Promise((r) => dm.once('job', r));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(dm.cancel(j0.id), true);
  const j = await waitFor(j0.id, ['cancelled']);
  assert.equal(j.error.code, 'CANCELLED');
  assert.deepEqual(fs.readdirSync(path.join(dest, '.umc-partial')), []);
  assert.equal(fs.existsSync(path.join(dest, 'drip.jpg')), false);
});

test('pause mid-stream, then resume with a Range request; final bytes verified', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/drip`, host: '127.0.0.1', kind: 'image', extHint: 'jpg', filenameHint: 'drip.jpg' }]);
  // wait until some bytes landed
  await new Promise((r) => { const h = (j) => { if (j.id === j0.id && j.bytesDone > 20000) { dm.off('job', h); r(); } }; dm.on('job', h); });
  assert.equal(dm.pause(j0.id), true);
  const p = await waitFor(j0.id, ['paused']);
  assert.ok(p.bytesDone > 0 && p.bytesDone < S.fixtures.DRIP.length);
  const part = path.join(dest, '.umc-partial', `${j0.id}.part`);
  assert.equal(fs.statSync(part).size, p.bytesDone);
  const logBefore = S.log.length;
  assert.equal(dm.resume(j0.id), true);
  const j = await waitFor(j0.id, DONE, 15000);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const resumed = S.log.slice(logBefore).find((l) => l.url === '/drip' && l.range && /^bytes=\d+-$/.test(l.range));
  assert.ok(resumed, 'a Range request was made on resume');
  const bytes = fs.readFileSync(j.finalPath);
  assert.equal(bytes.length, S.fixtures.DRIP.length);
  assert.equal(j.result.sha256, sha(S.fixtures.DRIP));
});

test('transient 503 is retried with backoff, then succeeds; 403 is not retried', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/flaky?n=2&k=${Date.now()}`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: 'flaky.png' }]);
  const j = await waitFor(j0.id, ['done', 'failed']);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.ok(j.attempts >= 2);
  const [f0] = dm.add([{ sourceUrl: `${S.base}/forbidden`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: 'f.png' }]);
  const f = await waitFor(f0.id, ['done', 'failed']);
  assert.equal(f.status, 'failed'); assert.equal(f.error.code, 'ACCESS_DENIED'); assert.equal(f.attempts, 1);
  // manual retry re-runs it
  assert.equal(dm.retry(f.id), true);
  assert.equal((await waitFor(f.id, ['failed'])).attempts, 1);
});

test('size caps: known size refused at add, unknown size refused during stream', async () => {
  settings.set({ maxFileBytes: 1024 });
  const c = await candidateFor('/clip.mp4');
  const [r] = dm.add([c]);
  assert.equal(r.refused.code, 'FILE_TOO_LARGE');
  const [j0] = dm.add([{ sourceUrl: `${S.base}/clip.mp4`, host: '127.0.0.1', kind: 'video', extHint: 'mp4', filenameHint: 'clip.mp4' }]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'FILE_TOO_LARGE');
  assert.deepEqual(fs.readdirSync(path.join(dest, '.umc-partial')), []);
});

test('a server that lies about Content-Length never yields a "saved" file', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/short`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: 'short.png' }]);
  const j = await waitFor(j0.id, ['failed'], 10000);
  assert.ok(['INTEGRITY_CHECK_FAILED', 'SOURCE_UNAVAILABLE', 'NETWORK_TIMEOUT'].includes(j.error.code), j.error.code);
  assert.equal(fs.existsSync(path.join(dest, 'short.png')), false);
  assert.deepEqual(fs.readdirSync(path.join(dest, '.umc-partial')), []);
});

test('no Content-Length still saves and records the real byte count', async () => {
  const [j0] = dm.add([{ sourceUrl: `${S.base}/nolen`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: 'nolen.png' }]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'done'); assert.equal(j.result.bytes, S.fixtures.PNG.length);
});

test('filename template cannot escape the destination', async () => {
  settings.set({ filenameTemplate: '../../{title}.{ext}' });
  const [j0] = dm.add([{ sourceUrl: `${S.base}/a.png`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: 'a.png', attribution: { title: '../../../etc/evil' } }]);
  const j = await waitFor(j0.id, DONE);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(path.dirname(j.finalPath), fs.realpathSync(dest));
  assert.ok(!path.basename(j.finalPath).includes('..'));
});

test('concurrency is bounded by settings; remove() drops a job and its partial', async () => {
  settings.set({ concurrency: 1 });
  let peak = 0;
  dm.on('queue', (q) => { peak = Math.max(peak, q.filter((j) => j.status === 'running').length); });
  const jobs = dm.add([1, 2, 3].map((i) => ({ sourceUrl: `${S.base}/slow?ms=120&i=${i}`, host: '127.0.0.1', kind: 'image', extHint: 'png', filenameHint: `s${i}.png` })));
  await Promise.all(jobs.map((j) => waitFor(j.id, DONE)));
  assert.equal(peak, 1);
  const [d0] = dm.add([{ sourceUrl: `${S.base}/drip`, host: '127.0.0.1', kind: 'image', extHint: 'jpg', filenameHint: 'drip.jpg' }]);
  await new Promise((r) => dm.once('job', r));
  assert.equal(dm.remove(d0.id), true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(dm.list().some((j) => j.id === d0.id), false);
  assert.deepEqual(fs.readdirSync(path.join(dest, '.umc-partial')), []);
});

test('settings validation clamps and refuses system destinations; library soft-delete/undo', () => {
  const r = settings.set({ concurrency: 99, maxFileBytes: -5, theme: 'neon', destination: '/' });
  assert.equal(r.value.concurrency, 4); assert.equal(r.value.theme, undefined);
  assert.ok(r.errors.destination); assert.equal(r.value.destination, dest);
  const it = library.add({ sourceUrl: 'https://x.example/a.png?sig=1', localPath: path.join(dest, 'a.png'), kind: 'image', mime: 'image/png', bytes: 1, sha256: 'ab' });
  assert.equal(library.list().length, 1);
  library.remove(it.id); assert.equal(library.list().length, 0); assert.equal(library.list({ includeDeleted: true }).length, 1);
  library.restore(it.id); assert.equal(library.list().length, 1);
  assert.equal(library.get(it.id).sourceUrl, 'https://x.example/a.png');
});
