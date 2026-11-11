// Security space, main side: the store under data/security/ (gitignored). Spec: docs/superpowers/specs/2026-11-11-security-space-design.md,
// plan docs/superpowers/plans/2026-11-11-batch4-security.md (dish "security-vault").
//
// WHAT LIVES HERE (and what never does):
//   settings.json   { v:1, vaultPath, keyFilePath, cliPath, refKey: 'enc:<b64>'|null, walkthrough: { [stepId]: { done, at } } }
//   map.json        { v:1, refreshedAt, accounts[], identities: [{ ref, kind, label: 'enc:<b64>'|null }] }
//   owner.json      { v:1, accounts: { [id]: { signInWith?, recoveryRef?, twofa?, hiddenFromClaude?, archived? } }, manual[], identities[] }
//   snapshots.jsonl one snapshotOf line per refresh, the last 400 kept
//   status.json     numbers, booleans and timestamps only; stamped `at` on EVERY write (the Brief and Reach read this, never map.json)
// A password, a note, an OTP value, a username or a URL path never reaches this module: map accounts are copied through a field
// WHITELIST, so even a misbehaving engine cannot leak one by adding a key. Labels (email / phone) and the identity-ref key go through
// crypto.encrypt ONLY; when it answers null (safeStorage unavailable) the label is stored as null and the refKey is null - never plaintext,
// and no identity ref is made ("locked").
//
// create({ dataDir, crypto: { encrypt(str)->string|null, decrypt(str)->string|null }, core?, now?, randomBytes? }) -> store
//   core is optional (the security-core module, ESM, so main attaches it after a dynamic import via store.attachCore(core)); with it the
//   status counts follow owner edits live (core.snapshotOf), without it they come from the newest snapshot line.
//   store.read() -> everything the renderer needs (decrypted labels; never the refKey). Every mutator -> { ok, ... } | { error }.
//   Writes are atomic (tmp + rename, the app's idiom) and every write re-stamps status.json.
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { readJsonStore, isPlainObj } = require('./json-store');

const KEEP_SNAPSHOTS = 400;
const MAX_MANUAL = 500;
const ID_RE = /^[km]-[0-9a-f]{12}$/;
const NODE_REF_RE = /^[kmi]-[0-9a-f]{12}$/;
const IDENT_REF_RE = /^i-[0-9a-f]{12}$/;
const STEP_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TWOFA = ['ente', 'sms', 'passkey', 'none', 'unknown'];
const ACCOUNT_KEYS = ['id', 'title', 'host', 'group', 'created', 'modified', 'totp', 'passkey', 'strength', 'reuseGroup', 'old', 'identityRef', 'breached'];
const SETTING_KEYS = ['vaultPath', 'keyFilePath', 'cliPath'];
const EMAIL_2FA_STEPS = ['email-2fa', 'email2fa'];   // the walkthrough step the Brief watches (the space dish owns the step ids)

const emptySettings = () => ({ v: 1, vaultPath: null, keyFilePath: null, cliPath: null, refKey: null, walkthrough: {} });
const emptyMap = () => ({ v: 1, refreshedAt: null, accounts: [], identities: [] });
const emptyOwner = () => ({ v: 1, accounts: {}, manual: [], identities: [] });
const emptyStatus = () => ({
  v: 1, at: null, refreshedAt: null, breachCheckedAt: null,
  counts: { accounts: 0, identities: 0, weak: 0, reused: 0, breached: 0, no2fa: 0, old: 0, notInVault: 0 },
  exportsFound: 0, conflicts: 0, email2faDone: false, walkthroughStarted: false,
});

const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

function create({ dataDir, crypto, core = null, now = () => new Date(), randomBytes = nodeCrypto.randomBytes } = {}) {
  if (!dataDir) throw new Error('security-store: dataDir required');
  const dir = path.join(dataDir, 'security');
  const file = (n) => path.join(dir, n);
  const enc = crypto && typeof crypto.encrypt === 'function' ? crypto.encrypt : () => null;
  const dec = crypto && typeof crypto.decrypt === 'function' ? crypto.decrypt : () => null;
  let engine = core;

  // ---- crypto wrappers: 'enc:' + whatever crypto.encrypt answers; null in, null out; never plaintext ----
  function encryptStr(s) {
    try { const c = enc(String(s)); return typeof c === 'string' && c ? 'enc:' + c : null; } catch { return null; }
  }
  function decryptStr(s) {
    if (typeof s !== 'string' || !s.startsWith('enc:')) return null;
    try { const p = dec(s.slice(4)); return typeof p === 'string' ? p : null; } catch { return null; }
  }
  const cryptoAvailable = () => encryptStr('probe') !== null;

  // ---- disk ----
  function writeAtomic(name, text) {
    fs.mkdirSync(dir, { recursive: true });
    const target = file(name);
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, target); }
    catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
  }
  const writeJson = (name, obj) => writeAtomic(name, JSON.stringify(obj, null, 2) + '\n');
  const readSettings = () => readJsonStore(file('settings.json'), emptySettings, (v) => isPlainObj(v) && v.v === 1);
  const readMap = () => readJsonStore(file('map.json'), emptyMap, (v) => isPlainObj(v) && Array.isArray(v.accounts));
  const readOwner = () => readJsonStore(file('owner.json'), emptyOwner, (v) => isPlainObj(v) && isPlainObj(v.accounts) && Array.isArray(v.manual));
  const readStatus = () => readJsonStore(file('status.json'), emptyStatus, (v) => isPlainObj(v) && v.v === 1);
  function readSnapshots() {
    let raw;
    try { raw = fs.readFileSync(file('snapshots.jsonl'), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of raw.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ } }
    return out.slice(-KEEP_SNAPSHOTS);
  }

  // ---- the identity-ref key: random per install, only ever at rest as 'enc:...' ----
  // Absent (null) when crypto is unavailable or the stored key can no longer be decrypted: then no identity ref is made anywhere.
  function getRefKey({ create: make = false } = {}) {
    const s = readSettings();
    if (s.refKey) {
      const hex = decryptStr(s.refKey);
      return hex && /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;   // an undecryptable key is never overwritten (that would orphan every ref)
    }
    if (!make) return null;
    const key = randomBytes(32);
    const sealed = encryptStr(key.toString('hex'));
    if (!sealed) return null;
    s.refKey = sealed;
    writeJson('settings.json', s);
    return Buffer.from(key);
  }
  // the SAME normalisation security-core.mjs applies to a username (email: trimmed + lower-cased; phone: spaces, dashes and parens stripped, a leading + kept),
  // so an identity the owner adds by hand lands on the ref a vault entry would produce
  function refOf(refKey, kind, value) {
    const raw = String(value).trim();
    const v = kind === 'phone' ? raw.replace(/[\s\-()]/g, '') : raw.toLowerCase();
    return 'i-' + nodeCrypto.createHmac('sha256', refKey).update(v).digest('hex').slice(0, 12);
  }

  // ---- status.json: counts, flags and timestamps; re-stamped on every write ----
  function computeCounts(map, owner, snaps) {
    if (engine && typeof engine.snapshotOf === 'function') {
      try {
        const s = engine.snapshotOf(map, owner, now());
        const f = (s && s.flags) || {};
        return { accounts: num(s.accounts), identities: num(s.identities), weak: num(f.weak), reused: num(f.reused), breached: num(f.breached), no2fa: num(f.no2fa), old: num(f.old), notInVault: num(f.notInVault) };
      } catch { /* fall through to the newest snapshot */ }
    }
    const last = snaps[snaps.length - 1];
    if (last && isPlainObj(last)) {
      const f = last.flags || {};
      return { accounts: num(last.accounts), identities: num(last.identities), weak: num(f.weak), reused: num(f.reused), breached: num(f.breached), no2fa: num(f.no2fa), old: num(f.old), notInVault: num(f.notInVault) };
    }
    return emptyStatus().counts;
  }
  function writeStatus(patch = {}) {
    const prev = readStatus();
    const settings = readSettings();
    const map = readMap(), owner = readOwner();
    const wt = isPlainObj(settings.walkthrough) ? settings.walkthrough : {};
    const next = {
      v: 1,
      at: now().toISOString(),
      refreshedAt: 'refreshedAt' in patch ? (isIso(patch.refreshedAt) ? patch.refreshedAt : null) : (isIso(prev.refreshedAt) ? prev.refreshedAt : null),
      breachCheckedAt: 'breachCheckedAt' in patch ? (isIso(patch.breachCheckedAt) ? patch.breachCheckedAt : null) : (isIso(prev.breachCheckedAt) ? prev.breachCheckedAt : null),
      counts: computeCounts(map, owner, readSnapshots()),
      exportsFound: 'exportsFound' in patch ? num(patch.exportsFound) : num(prev.exportsFound),
      conflicts: 'conflicts' in patch ? num(patch.conflicts) : num(prev.conflicts),
      email2faDone: EMAIL_2FA_STEPS.some((id) => wt[id] && wt[id].done === true),
      walkthroughStarted: Object.keys(wt).length > 0,
    };
    writeJson('status.json', next);
    return next;
  }
  const setScanResult = ({ exportsFound, conflicts }) => { try { return { ok: true, status: writeStatus({ exportsFound: num(exportsFound), conflicts: num(conflicts) }) }; } catch { return { error: 'could not save' }; } };

  // ---- map (written by a refresh) ----
  const cleanAccount = (a) => {
    const o = {};
    for (const k of ACCOUNT_KEYS) if (a && k in a) o[k] = a[k];
    return o;
  };
  // identities: [{ ref, kind, value }] from the engine; the value is sealed into a label here and never kept
  function writeMap({ refreshedAt, accounts, identities }) {
    const map = {
      v: 1,
      refreshedAt: isIso(refreshedAt) ? refreshedAt : now().toISOString(),
      accounts: (Array.isArray(accounts) ? accounts : []).map(cleanAccount),
      identities: (Array.isArray(identities) ? identities : [])
        .filter((i) => i && IDENT_REF_RE.test(i.ref) && (i.kind === 'email' || i.kind === 'phone'))
        .map((i) => ({ ref: i.ref, kind: i.kind, label: encryptStr(i.value) })),
    };
    writeJson('map.json', map);
    return map;
  }

  function appendSnapshot(snap) {
    const lines = readSnapshots().map((s) => JSON.stringify(s));
    lines.push(JSON.stringify(snap));
    writeAtomic('snapshots.jsonl', lines.slice(-KEEP_SNAPSHOTS).join('\n') + '\n');
  }

  // ---- settings ----
  function setSettings(patch) {
    if (!isPlainObj(patch) || !Object.keys(patch).length) return { error: 'nothing to change' };
    const s = readSettings();
    const next = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!SETTING_KEYS.includes(k)) return { error: 'unknown setting' };
      if (v === null || v === '') { next[k] = null; continue; }
      if (typeof v !== 'string' || v.length > 1024 || /[\0\r\n]/.test(v)) return { error: `${k} is not a valid path` };
      if (!path.isAbsolute(v)) return { error: `${k} must be an absolute path` };
      if (k === 'vaultPath' && !/\.kdbx$/i.test(v)) return { error: 'vaultPath must end in .kdbx' };
      if (k === 'cliPath' && !/^keepassxc-cli\.exe$/i.test(path.basename(v))) return { error: 'cliPath must be keepassxc-cli.exe (a script, .cmd or .bat cannot be run)' };
      next[k] = v;
    }
    try { writeJson('settings.json', { ...s, ...next }); writeStatus(); } catch { return { error: 'could not save' }; }
    return { ok: true };
  }

  // ---- owner edits ----
  function editAccount(id, patch) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'bad account id' };
    if (!isPlainObj(patch) || !Object.keys(patch).length) return { error: 'nothing to change' };
    const clean = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'signInWith' || k === 'recoveryRef') {
        if (v !== null && !(typeof v === 'string' && NODE_REF_RE.test(v))) return { error: `bad value for ${k}` };
      } else if (k === 'twofa') {
        if (v !== null && !TWOFA.includes(v)) return { error: 'bad value for twofa' };
      } else if (k === 'hiddenFromClaude' || k === 'archived') {
        if (v !== null && typeof v !== 'boolean') return { error: `bad value for ${k}` };
      } else return { error: 'unknown field' };
      clean[k] = v;
    }
    try {
      const owner = readOwner();
      const cur = { ...(owner.accounts[id] || {}) };
      for (const [k, v] of Object.entries(clean)) { if (v === null || (typeof v === 'boolean' && v === false && (k === 'hiddenFromClaude' || k === 'archived'))) delete cur[k]; else cur[k] = v; }
      if (Object.keys(cur).length) owner.accounts[id] = cur; else delete owner.accounts[id];
      writeJson('owner.json', owner); writeStatus();
    } catch { return { error: 'could not save' }; }
    return { ok: true };
  }

  function addManual({ title, host } = {}) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) return { error: 'a title (1-120 characters) is required' };
    let h = null;
    if (host != null && host !== '') {
      if (typeof host !== 'string' || host.length > 300) return { error: 'bad host' };
      try { h = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(host.trim()) ? host.trim() : 'https://' + host.trim()).hostname.toLowerCase(); } catch { return { error: 'bad host' }; }
      if (!/^[a-z0-9.-]{1,253}$/.test(h)) return { error: 'bad host' };
    }
    try {
      const owner = readOwner();
      if (owner.manual.length >= MAX_MANUAL) return { error: 'too many manual accounts' };
      const id = 'm-' + randomBytes(6).toString('hex');
      owner.manual.push({ id, title: title.trim(), host: h, createdAt: now().toISOString() });
      writeJson('owner.json', owner); writeStatus();
      return { ok: true, id };
    } catch { return { error: 'could not save' }; }
  }

  function addIdentity({ kind, value } = {}) {
    if (kind !== 'email' && kind !== 'phone') return { error: 'kind must be email or phone' };
    if (typeof value !== 'string' || !value.trim() || value.length > 200) return { error: 'a value is required' };
    const v = value.trim();
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+$/.test(v)) return { error: 'that does not look like an email' };
    if (kind === 'phone') { const d = v.replace(/[\s\-().]/g, '').replace(/^\+/, ''); if (!/^\d{8,15}$/.test(d)) return { error: 'that does not look like a phone number' }; }
    try {
      const key = getRefKey({ create: true });
      if (!key) return { error: 'locked: secure storage is unavailable, so identities are not recorded' };
      const ref = refOf(key, kind, v);
      const owner = readOwner();
      if (!owner.identities.some((i) => i.ref === ref)) {
        owner.identities.push({ ref, kind, label: encryptStr(v) });
        writeJson('owner.json', owner); writeStatus();
      }
      return { ok: true, ref };
    } catch { return { error: 'could not save' }; }
  }

  function setWalkthrough(stepId, done) {
    if (typeof stepId !== 'string' || !STEP_RE.test(stepId) || typeof done !== 'boolean') return { error: 'bad step' };
    try {
      const s = readSettings();
      if (!isPlainObj(s.walkthrough)) s.walkthrough = {};
      s.walkthrough[stepId] = { done, at: now().toISOString() };
      writeJson('settings.json', s); writeStatus();
    } catch { return { error: 'could not save' }; }
    return { ok: true };
  }

  // ---- everything for hq:security:read (labels decrypted here, the refKey never leaves) ----
  function read() {
    const s = readSettings();
    const map = readMap(), owner = readOwner();
    const showId = (i) => ({ ref: i.ref, kind: i.kind, label: decryptStr(i.label) });
    return {
      settings: { vaultPath: s.vaultPath || null, keyFilePath: s.keyFilePath || null, cliPath: s.cliPath || null, walkthrough: isPlainObj(s.walkthrough) ? s.walkthrough : {}, locked: !cryptoAvailable() },
      map: { v: 1, refreshedAt: map.refreshedAt || null, accounts: map.accounts, identities: (map.identities || []).map(showId) },
      owner: { v: 1, accounts: owner.accounts, manual: owner.manual, identities: (owner.identities || []).map(showId) },
      snapshots: readSnapshots(),
      status: readStatus(),
    };
  }

  return {
    dir, read, readSettings, readMap, readOwner, readStatus, readSnapshots,
    setSettings, getRefKey, cryptoAvailable, writeMap, appendSnapshot, writeStatus, setScanResult,
    editAccount, addManual, addIdentity, setWalkthrough,
    attachCore(c) { engine = c || null; },
  };
}

module.exports = { create, KEEP_SNAPSHOTS };
