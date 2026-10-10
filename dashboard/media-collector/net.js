'use strict';
// Safe network layer. Every outbound request in the app goes through here.
//  - http/https only, honest User-Agent, no cookies, no platform spoofing.
//  - DNS pinned: the socket connects to an address validated by url-safety.
//  - Redirects followed manually (max N), each hop re-validated (scheme,
//    host, resolved address), bodies of redirect responses discarded.
//  - Header timeout + idle body timeout; AbortSignal cancels everything.
//  - readBounded() never buffers more than the cap.
//  - hostSlot(): polite per-host concurrency (default 2).
const http = require('node:http');
const https = require('node:https');
const { parseUrl, makeLookup, redactUrl } = require('./url-safety');
const { UmcError, fromNative } = require('./errors');

const VERSION = '0.1.0';   // the collector's own version, not WorkspaceHQ's
const USER_AGENT = `WorkspaceHQ-MediaCollector/${VERSION} (local desktop app)`;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

const DEFAULTS = { timeoutMs: 15000, idleMs: 20000, maxRedirects: 5, allowPrivate: false };

// Perform one request, following redirects. Resolves with the final
// IncomingMessage (headers read, body NOT consumed) plus hop metadata.
// The caller MUST consume or destroy `res`.
async function request(urlInput, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const po = { allowPrivate: o.allowPrivate };
  let url = parseUrl(urlInput, po);
  let method = (o.method || 'GET').toUpperCase();
  const hops = [];
  const lookup = makeLookup({ allowPrivate: o.allowPrivate });
  for (let i = 0; i <= o.maxRedirects; i++) {
    if (o.signal && o.signal.aborted) throw new UmcError('CANCELLED');
    const res = await once(url, method, o, lookup);
    if (REDIRECT_CODES.has(res.statusCode) && res.headers.location) {
      res.resume();   // discard redirect body
      let next;
      try { next = parseUrl(new URL(res.headers.location, url).href, po); }
      catch (err) { throw err instanceof UmcError ? new UmcError(err.code, `redirect: ${err.detail}`) : err; }
      // https → http downgrade is refused; a redirect never upgrades privileges either
      if (url.protocol === 'https:' && next.protocol === 'http:') throw new UmcError('ACCESS_DENIED', 'redirect downgraded to http');
      hops.push(redactUrl(url));
      if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) method = 'GET';
      url = next;
      continue;
    }
    return { res, finalUrl: url.href, hops, status: res.statusCode, headers: res.headers };
  }
  throw new UmcError('SOURCE_UNAVAILABLE', 'too many redirects');
}

function once(url, method, o, lookup) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const headers = { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'identity', ...(o.headers || {}) };
    const req = mod.request(url, { method, headers, lookup, timeout: o.timeoutMs });
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; req.destroy(); reject(err instanceof UmcError ? err : fromNative(err)); };
    const onAbort = () => fail(new UmcError('CANCELLED'));
    if (o.signal) { if (o.signal.aborted) return fail(new UmcError('CANCELLED')); o.signal.addEventListener('abort', onAbort, { once: true }); }
    req.on('timeout', () => fail(new UmcError('NETWORK_TIMEOUT', 'headers')));
    req.on('error', fail);
    req.on('response', (res) => {
      if (settled) { res.resume(); return; }
      settled = true;
      if (o.signal) o.signal.removeEventListener('abort', onAbort);
      // idle-body timeout: a server that stalls mid-stream is a timeout, not a hang
      res.setTimeout(o.idleMs, () => res.destroy(new UmcError('NETWORK_TIMEOUT', 'body idle')));
      if (o.signal) o.signal.addEventListener('abort', () => res.destroy(new UmcError('CANCELLED')), { once: true });
      resolve(res);
    });
    req.end();
  });
}

// Read at most `maxBytes` from a response. Resolves { buf, truncated }.
// With `stopEarly`, the stream is destroyed once the cap is reached
// (sampling); otherwise exceeding the cap throws FILE_TOO_LARGE.
function readBounded(res, maxBytes, { stopEarly = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, done = false;
    const finish = (truncated) => { if (done) return; done = true; resolve({ buf: Buffer.concat(chunks, Math.min(n, maxBytes)), truncated }); };
    res.on('data', (c) => {
      if (done) return;
      if (n + c.length > maxBytes) {
        chunks.push(c.subarray(0, maxBytes - n)); n = maxBytes;
        if (stopEarly) { finish(true); res.destroy(); return; }
        done = true; res.destroy(); reject(new UmcError('FILE_TOO_LARGE', `over ${maxBytes} bytes`)); return;
      }
      chunks.push(c); n += c.length;
    });
    res.on('end', () => finish(false));
    res.on('error', (err) => { if (done) return; done = true; reject(err instanceof UmcError ? err : fromNative(err)); });
    res.on('close', () => { if (!done && res.complete) finish(false); });
  });
}

// GET the first `sampleBytes` of a resource (Range request; servers that
// ignore Range are cut off at the cap). Returns headers + sample + size.
async function sample(urlInput, opts = {}) {
  const sampleBytes = opts.sampleBytes || 16384;
  const r = await request(urlInput, { ...opts, method: 'GET', headers: { ...(opts.headers || {}), range: `bytes=0-${sampleBytes - 1}` } });
  const { res } = r;
  if (res.statusCode >= 400) { res.resume(); const { fromStatus } = require('./errors'); throw fromStatus(res.statusCode, res.headers); }
  const { buf } = await readBounded(res, sampleBytes, { stopEarly: true });
  const total = totalSize(res.headers);
  return { ...r, bytes: buf, size: total, acceptRanges: /bytes/i.test(String(res.headers['accept-ranges'] || '')) || res.statusCode === 206 };
}

// Full size from Content-Range (206) or Content-Length (200). null if unknown.
function totalSize(headers) {
  const cr = headers['content-range'];
  if (cr) { const m = /\/(\d+)\s*$/.exec(String(cr)); if (m) return Number(m[1]); }
  const cl = headers['content-length'];
  if (cl != null && /^\d+$/.test(String(cl))) return Number(cl);
  return null;
}

// GET a text resource bounded to maxBytes (truncates, never throws on size).
async function fetchText(urlInput, opts = {}) {
  const maxBytes = opts.maxBytes || 5 * 1024 * 1024;
  const r = await request(urlInput, { ...opts, method: 'GET', headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', ...(opts.headers || {}) } });
  const { res } = r;
  const { buf, truncated } = await readBounded(res, maxBytes, { stopEarly: true });
  const ct = String(res.headers['content-type'] || '');
  const charset = (/charset=([\w-]+)/i.exec(ct) || [])[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(charset, { fatal: false }).decode(buf); } catch { text = buf.toString('utf8'); }
  return { ...r, text, truncated, contentType: ct, bytes: buf.length };
}

// ---- polite per-host concurrency --------------------------------------------
const slots = new Map();   // host -> { active, queue: [] }
function hostSlot(host, limit = 2) {
  const key = String(host || '').toLowerCase();
  if (!slots.has(key)) slots.set(key, { active: 0, queue: [] });
  const s = slots.get(key);
  return new Promise((resolve) => {
    const grant = () => {
      s.active++;
      let released = false;
      resolve(() => {
        if (released) return; released = true;
        s.active--;
        const next = s.queue.shift();
        if (next) next(); else if (s.active === 0) slots.delete(key);
      });
    };
    if (s.active < limit) grant(); else s.queue.push(grant);
  });
}

module.exports = { request, readBounded, sample, fetchText, totalSize, hostSlot, USER_AGENT };
