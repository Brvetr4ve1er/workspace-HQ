'use strict';
// URL + address safety. Treats every URL as untrusted input.
//  - parseUrl(): http(s) only, no embedded credentials, no local hostnames.
//  - isPublicIp(): IPv4/IPv6 range check (loopback, private, link-local,
//    multicast, reserved, cloud-metadata, NAT64/6to4-embedded v4 all blocked).
//  - makeLookup(): a `lookup` option for http/https.request that resolves the
//    hostname, validates EVERY returned address, and pins the socket to a
//    validated one — so DNS rebinding between "check" and "connect" cannot
//    happen (the same resolution result is what the socket uses).
//  - redactUrl(): origin+path only, for logs and library records.
const dns = require('node:dns');
const net = require('node:net');
const { UmcError } = require('./errors');

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp', '.private', '.onion'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'kubernetes.default', '0.0.0.0']);

function parseUrl(input, opts) {
  const s = String(input == null ? '' : input).trim();
  if (!s) throw new UmcError('INVALID_URL', 'empty');
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new UmcError('INVALID_URL', 'control characters');
  let u;
  try { u = new URL(s); } catch { throw new UmcError('INVALID_URL', 'unparseable'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UmcError('UNSUPPORTED_SCHEME', u.protocol.replace(':', ''));
  if (u.username || u.password) throw new UmcError('INVALID_URL', 'embedded credentials');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UmcError('INVALID_URL', 'missing host');
  if (!/^[a-z0-9.\-\[\]:_]+$/.test(host)) throw new UmcError('INVALID_URL', 'malformed host');
  assertHostAllowed(host, opts);
  u.hash = '';
  return u;
}

function assertHostAllowed(hostRaw, opts) {
  const host = hostRaw.toLowerCase().replace(/^\[|\]$/g, '');
  // allowPrivate exists for the test fixture server on 127.0.0.1 ONLY; it is
  // a code-level option, never reachable from settings or the renderer.
  // `true` lifts the guard entirely; an array lifts it for those hosts only.
  if (privateAllowed(opts, host)) return;
  if (BLOCKED_HOSTS.has(host)) throw new UmcError('INVALID_URL', 'local hostname');
  for (const suf of BLOCKED_HOST_SUFFIXES) if (host.endsWith(suf)) throw new UmcError('INVALID_URL', 'local hostname');
  if (!host.includes('.') && !net.isIP(host)) throw new UmcError('INVALID_URL', 'bare hostname');
  const ipv = net.isIP(host);
  if (ipv && !isPublicIp(host)) throw new UmcError('INVALID_URL', 'private network address');
  // decimal / octal / hex single-number "IPs" (e.g. http://2130706433/) are
  // normalized by WHATWG URL into dotted form, so they reach isPublicIp above.
}

function privateAllowed(opts, host) {
  const a = opts && opts.allowPrivate;
  if (a === true) return true;
  if (Array.isArray(a)) return a.includes(String(host).toLowerCase().replace(/^\[|\]$/g, ''));
  return false;
}

// ---- address classification -----------------------------------------------
function v4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4ToInt(base), bits]);

function isPublicV4(ip) {
  const n = v4ToInt(ip);
  if (n === 0xffffffff) return false;
  for (const [base, bits] of V4_BLOCKED) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if (((n & mask) >>> 0) === base) return false;
  }
  return true;
}

// Expand an IPv6 textual address to 8 16-bit groups. Returns null if invalid.
function v6Groups(ip) {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%'); if (zone !== -1) s = s.slice(0, zone);
  // embedded dotted-quad tail (::ffff:1.2.3.4) → two hex groups
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    if (!net.isIPv4(m[2])) return null;
    const n = v4ToInt(m[2]);
    s = m[1] + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g || '0', 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isFinite(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isPublicV6(ip) {
  const g = v6Groups(ip);
  if (!g) return false;
  const allZero = g.every((x) => x === 0);
  if (allZero) return false;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false;   // ::1
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(embeddedV4());   // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return isPublicV4(embeddedV4());                        // ::a.b.c.d (deprecated compat)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(embeddedV4()); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return isPublicV4(`${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`);  // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false;              // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false;              // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false;              // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false;              // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;      // documentation
  if (g[0] === 0x2001 && g[1] === 0) return false;           // teredo (tunnels to arbitrary v4)
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false;   // 100::/64 discard
  return true;
}

function isPublicIp(ip) {
  const v = net.isIP(String(ip));
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

// Resolve + validate every address. Returns the list of {address, family}
// that are all public; throws if any one is not (an attacker-controlled name
// that mixes public and private records must not be reachable at all).
async function resolvePublic(hostname, opts) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const allowPrivate = privateAllowed(opts, host);
  if (net.isIP(host)) {
    if (!allowPrivate && !isPublicIp(host)) throw new UmcError('INVALID_URL', 'private network address');
    return [{ address: host, family: net.isIP(host) }];
  }
  let addrs;
  try { addrs = await dns.promises.lookup(host, { all: true, verbatim: true }); }
  catch (err) { throw new UmcError('SOURCE_UNAVAILABLE', err && err.code ? err.code : 'dns'); }
  if (!addrs.length) throw new UmcError('SOURCE_UNAVAILABLE', 'dns: no address');
  if (!allowPrivate) for (const a of addrs) if (!isPublicIp(a.address)) throw new UmcError('INVALID_URL', 'resolves to a private network address');
  return addrs;
}

// A `lookup` for http.request/https.request. The socket connects to the
// address we validated; the TLS SNI/Host header still carry the hostname.
function makeLookup(opts) {
  return function lookup(hostname, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    resolvePublic(hostname, opts).then((addrs) => {
      const want = options && options.family;
      const pick = (want ? addrs.filter((a) => a.family === want) : addrs)[0] || addrs[0];
      if (options && options.all) cb(null, addrs);
      else cb(null, pick.address, pick.family);
    }).catch((err) => cb(err));
  };
}

// origin + path, no query, no fragment, no credentials — safe for logs/records.
function redactUrl(u) {
  try { const x = u instanceof URL ? u : new URL(String(u)); return `${x.protocol}//${x.host}${x.pathname}`; }
  catch { return '[invalid url]'; }
}

module.exports = { parseUrl, assertHostAllowed, isPublicIp, resolvePublic, makeLookup, redactUrl };
