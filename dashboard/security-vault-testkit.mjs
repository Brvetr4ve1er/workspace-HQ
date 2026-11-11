// Shared test kit for security-store / security-vault / security tests (an extra file of the security-vault dish, test-only).
// Invented data only: nothing here is the owner's vault, a real account or a real password. The stub core below implements just the
// shape of dashboard/security-core.mjs (parseKeepassXml, reduceEntries, snapshotOf, breachMatch, assertNoSecrets) so these tests do not
// depend on the other dish landing first; one test per file also runs against the real core when it exists.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_CLI = path.join(HERE, '__fixtures__', 'fake-keepassxc-cli.mjs');
export const PASSPHRASE = 'correct horse example';

export const tmp = (p = 'hq-sec-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ---- invented vault entries ----
export const ENTRIES = [
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Shop A', username: 'owner@example.test', password: 'Alpha-Bravo-9921-xq&1', url: 'https://shop-a.example.test/login?token=abc', notes: 'invented note one', otp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' },
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Forum B', username: 'owner@example.test', password: 'Alpha-Bravo-9921-xq&1', url: 'https://forum-b.example.test/', notes: '' },
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000003', title: 'Bank C', username: '+1 (555) 010-0199', password: 'zZ-Unique-Pass-7731!', url: '', notes: 'invented note three' },
  { uuid: 'aaaaaaaa-0000-4000-8000-000000000004', title: 'Empty D', username: 'plainname', password: '', url: 'https://d.example.test/a/b', notes: '' },
];
export const HISTORY_SECRET = 'old-history-secret-1';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function buildXml(entries = ENTRIES) {
  const one = (e) => `<Entry><UUID>${e.uuid}</UUID>`
    + [['Title', e.title], ['UserName', e.username], ['Password', e.password], ['URL', e.url], ['Notes', e.notes]].map(([k, v]) => `<String><Key>${k}</Key><Value>${esc(v || '')}</Value></String>`).join('')
    + (e.otp ? `<String><Key>otp</Key><Value>${esc(e.otp)}</Value></String>` : '')
    + `<Times><CreationTime>2024-01-02T03:04:05Z</CreationTime><LastModificationTime>2026-06-01T00:00:00Z</LastModificationTime></Times>`
    + `<History><Entry><UUID>${e.uuid}</UUID><String><Key>Password</Key><Value>${HISTORY_SECRET}</Value></String></Entry></History></Entry>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<KeePassFile><Meta><Generator>fake</Generator></Meta><Root><Group><UUID>root</UUID><Name>Root</Name>${entries.map(one).join('')}</Group></Root></KeePassFile>\n`;
}
// every string that must never survive on disk
export const secretsOf = (entries = ENTRIES) => [
  ...entries.flatMap((e) => [e.password, e.notes, e.otp, e.username].filter((s) => s && s.length >= 4)),
  HISTORY_SECRET, PASSPHRASE,
];

// ---- a stub of the security-core API (shape only) ----
const sha1Upper = (s) => crypto.createHash('sha1').update(s).digest('hex').toUpperCase();
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export const stubCore = {
  parseKeepassXml(xml) {
    if (typeof xml !== 'string' || !/<\/KeePassFile>\s*$/.test(xml) || /Protected="True"/.test(xml)) return { entries: [], error: 'unreadable export' };
    const body = xml.replace(/<History>[\s\S]*?<\/History>/g, '');
    const entries = [];
    for (const m of body.matchAll(/<Entry>([\s\S]*?)<\/Entry>/g)) {
      const f = {}; const keys = [];
      for (const s of m[1].matchAll(/<String><Key>([\s\S]*?)<\/Key><Value>([\s\S]*?)<\/Value><\/String>/g)) { f[s[1]] = unesc(s[2]); keys.push(s[1]); }
      const uuid = (m[1].match(/<UUID>([^<]*)<\/UUID>/) || [])[1];
      const mod = (m[1].match(/<LastModificationTime>([^<]*)<\/LastModificationTime>/) || [])[1];
      entries.push({ uuid, group: 'Root', title: f.Title || '', username: f.UserName || '', password: f.Password || '', url: f.URL || '', notes: f.Notes || '', otp: f.otp || '', attrKeys: keys, created: null, modified: mod || null });
    }
    return { entries };
  },
  reduceEntries(entries, { now, reuseKey, refKey }) {
    const hmac = (k, v) => crypto.createHmac('sha256', k).update(v).digest('hex');
    const groups = new Map();
    const accounts = entries.map((e) => {
      const id = 'k-' + crypto.createHash('sha256').update(e.uuid).digest('hex').slice(0, 12);
      let host = null; try { host = e.url ? new URL(e.url).hostname.toLowerCase() : null; } catch { host = null; }
      const rk = e.password ? hmac(reuseKey, e.password) : null;
      if (rk) groups.set(rk, (groups.get(rk) || 0) + 1);
      const email = /^[^\s@]+@[^\s@]+$/.test(e.username);
      const identityRef = refKey && email ? 'i-' + hmac(refKey, e.username.toLowerCase()).slice(0, 12) : null;
      return { id, title: e.title, host, group: e.group, created: e.created, modified: e.modified, totp: !!e.otp, passkey: false, strength: !e.password ? 'empty' : e.password.length >= 14 ? 'strong' : 'weak', reuseGroup: rk, old: false, identityRef, _rk: rk, _email: email ? e.username : null };
    });
    const nums = new Map(); let n = 0;
    for (const a of accounts) { if (a._rk && groups.get(a._rk) > 1) { if (!nums.has(a._rk)) nums.set(a._rk, ++n); a.reuseGroup = nums.get(a._rk); } else a.reuseGroup = null; }
    const identities = [];
    if (refKey) for (const a of accounts) if (a._email && !identities.some((i) => i.ref === a.identityRef)) identities.push({ ref: a.identityRef, kind: 'email', value: a._email });
    const hashes = new Map();
    entries.forEach((e, i) => { if (e.password) hashes.set(accounts[i].id, sha1Upper(e.password)); });
    for (const a of accounts) { delete a._rk; delete a._email; }
    return { accounts, identities, hashes };
  },
  snapshotOf(map, owner, now) {
    const a = map.accounts || [];
    return { at: new Date(now).toISOString(), accounts: a.length, identities: (map.identities || []).length, flags: { weak: a.filter((x) => x.strength === 'weak').length, reused: a.filter((x) => x.reuseGroup).length, breached: a.filter((x) => x.breached === true).length, no2fa: a.filter((x) => !x.totp).length, old: a.filter((x) => x.old).length, notInVault: (owner.manual || []).length } };
  },
  breachMatch(sha, body) {
    const suffix = String(sha).toUpperCase().slice(5);
    return String(body).split(/\r?\n/).some((l) => { const [s, c] = l.trim().split(':'); return s === suffix && Number(c) > 0; });
  },
  assertNoSecrets(value, secrets) {
    const text = JSON.stringify(value);
    for (const s of secrets) if (s && s.length >= 4 && text.includes(s)) throw new Error('a secret appears in the value');
  },
};

// the real core, when the other dish has landed (tests that use it skip otherwise)
export async function loadRealCore() {
  try { return await import('./security-core.mjs'); } catch { return null; }
}

// HQ_SEC_TEST_CORE=real runs the whole suite against the real core (default: the stub, so the tests stand alone)
export const coreUnderTest = process.env.HQ_SEC_TEST_CORE === 'real' ? ((await loadRealCore()) || stubCore) : stubCore;

// ---- fake crypto: reversible, opaque, and clearly not plaintext ----
export const fakeCrypto = {
  encrypt: (s) => Buffer.from(Buffer.from(String(s), 'utf8').map((b) => b ^ 0x5a)).toString('base64'),
  decrypt: (c) => { try { return Buffer.from(Buffer.from(String(c), 'base64').map((b) => b ^ 0x5a)).toString('utf8'); } catch { return null; } },
};
export const nullCrypto = { encrypt: () => null, decrypt: () => null };

// ---- every file under a directory as text (for the no-secret-on-disk sweep) ----
export function allFiles(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
export const sweepText = (dir) => allFiles(dir).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// ---- a fake timer set (security.js takes it through deps.timers) ----
export function fakeTimers() {
  let t = 0, id = 0; const jobs = new Map();
  return {
    setTimeout(fn, ms) { const k = ++id; jobs.set(k, { fn, at: t + ms, every: 0 }); return k; },
    clearTimeout(k) { jobs.delete(k); },
    setInterval(fn, ms) { const k = ++id; jobs.set(k, { fn, at: t + ms, every: ms }); return k; },
    clearInterval(k) { jobs.delete(k); },
    pending: () => jobs.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [k, j] = due; t = j.at;
        if (j.every) j.at += j.every; else jobs.delete(k);
        j.fn();
      }
      t = end;
    },
  };
}

// a stand-in for the Electron webContents / BrowserWindow / ipcMain / clipboard
export function fakeIpc() {
  const handlers = new Map();
  return { handle: (ch, fn) => handlers.set(ch, fn), handlers, call: (ch, sender, arg) => handlers.get(ch)({ sender }, arg) };
}
export const fakeWin = (wc) => ({ isDestroyed: () => false, webContents: wc });
export function fakeClipboard(initial = '') {
  const c = { text: initial, writes: 0, clears: 0, writeText(t) { c.text = t; c.writes++; }, readText() { return c.text; }, clear() { c.text = ''; c.clears++; } };
  return c;
}
