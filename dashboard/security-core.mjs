// security-core.mjs - the Security engine (PURE: no fs, no network, no Electron).
//
// A KeePassXC plaintext XML export goes in, names and flags come out, and every
// secret is dropped on the way. The only import is node:crypto.
//
//   parseKeepassXml(xml)               -> { entries, error? }   (the ONE place passwords are in hand)
//   reduceEntries(entries, keys)       -> { accounts, identities, hashes }   (never a secret)
//   estimateStrength(password)         -> { bits, label }
//   breachMatch(sha1, rangeBody)       -> boolean
//   buildGraph({accounts, identities, owner, breached}) -> { nodes, edges }
//   snapshotOf(map, owner, now)        -> numbers only
//   assertNoSecrets(value, secrets)    -> throws if a secret appears anywhere
//
// Honest failure beats fake data: anything that is not a readable plaintext
// export comes back as { entries: [], error: 'unreadable export' }.

import { createHash, createHmac } from 'node:crypto';

export const UNREADABLE = 'unreadable export';
const DAY_MS = 86400000;
const OLD_DAYS = 365;

// ------------------------------------------------------------------ xml

const MAX_DEPTH = 200;

function unescapeXml(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
        return String.fromCodePoint(cp);
      }
    }
  });
}

const TAG_NAME = /^[A-Za-z_][\w.:-]*/;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Tiny tolerant tree builder. Throws on anything that is not well formed
// (unclosed tag, mismatched close, no root, more than one root, absurd depth).
// Flags `sawProtected` when any <Value Protected="True"> exists.
function buildTree(text) {
  const state = { sawProtected: false };
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const root = { name: '#doc', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = s.length;
  let roots = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      if (stack.length > 1 && s.slice(i).trim()) top.text += unescapeXml(s.slice(i));
      i = n;
      break;
    }
    if (lt > i && stack.length > 1) top.text += unescapeXml(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('bad comment');
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      if (end === -1 || stack.length < 2) throw new Error('bad cdata');
      top.text += s.slice(lt + 9, end);
      i = end + 3;
    } else if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      if (end === -1) throw new Error('bad pi');
      i = end + 2;
    } else if (s.startsWith('<!', lt)) {
      // DOCTYPE and friends: skipped, never expanded (no custom entities).
      const end = s.indexOf('>', lt + 2);
      if (end === -1) throw new Error('bad decl');
      i = end + 1;
    } else if (s[lt + 1] === '/') {
      const end = s.indexOf('>', lt + 2);
      if (end === -1) throw new Error('bad close');
      const name = s.slice(lt + 2, end).trim();
      if (stack.length < 2 || stack[stack.length - 1].name !== name) throw new Error('mismatched close');
      stack.pop();
      i = end + 1;
    } else {
      // open or self-closing tag; attribute values may contain '>' only when
      // escaped by a conforming writer, but scan quote-aware to be safe.
      let j = lt + 1;
      let quote = '';
      while (j < n) {
        const c = s[j];
        if (quote) { if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= n) throw new Error('unterminated tag');
      let inner = s.slice(lt + 1, j);
      const selfClose = inner.endsWith('/');
      if (selfClose) inner = inner.slice(0, -1);
      const m = TAG_NAME.exec(inner);
      if (!m) throw new Error('bad tag name');
      const name = m[0];
      const attrs = {};
      const attrText = inner.slice(name.length);
      ATTR_RE.lastIndex = 0;
      let am;
      while ((am = ATTR_RE.exec(attrText))) attrs[am[1]] = unescapeXml(am[2] !== undefined ? am[2] : am[3]);
      if (name === 'Value' && typeof attrs.Protected === 'string' && attrs.Protected.trim().toLowerCase() === 'true') {
        state.sawProtected = true;
      }
      const node = { name, attrs, children: [], text: '' };
      top.children.push(node);
      if (stack.length === 1) {
        roots++;
        if (roots > 1) throw new Error('more than one root');
      }
      if (!selfClose) {
        if (stack.length >= MAX_DEPTH) throw new Error('too deep');
        stack.push(node);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1 || roots !== 1) throw new Error('incomplete document');
  return { doc: root.children[0], state };
}

const childOf = (node, name) => node.children.find((c) => c.name === name) || null;
const childrenOf = (node, name) => node.children.filter((c) => c.name === name);
const textOf = (node) => (node ? node.text : '');

// ISO 8601 only (date, or date + time with optional fraction and zone).
// Anything else is null: KeePass 2 base64 times are not guessed at.
const ISO_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
function parseIso(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const m = ISO_RE.exec(t);
  if (!m) return null;
  let full = t;
  if (m[2] && !m[5]) full += 'Z';
  const ms = Date.parse(full);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

const STANDARD_KEYS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);

function readEntry(node, groupPath) {
  const e = {
    uuid: textOf(childOf(node, 'UUID')).trim(),
    group: groupPath,
    title: '', username: '', password: '', url: '', notes: '', otp: '',
    attrKeys: [], created: null, modified: null,
  };
  const seen = new Set();
  for (const st of childrenOf(node, 'String')) {
    const key = textOf(childOf(st, 'Key'));
    if (seen.has(key)) continue;
    seen.add(key);
    const val = textOf(childOf(st, 'Value'));
    if (key === 'Title') e.title = val;
    else if (key === 'UserName') e.username = val;
    else if (key === 'Password') e.password = val;
    else if (key === 'URL') e.url = val;
    else if (key === 'Notes') e.notes = val;
    else if (key.toLowerCase() === 'otp') e.otp = val;
    else if (!STANDARD_KEYS.has(key)) e.attrKeys.push(key);
  }
  const times = childOf(node, 'Times');
  if (times) {
    e.created = parseIso(textOf(childOf(times, 'CreationTime')));
    e.modified = parseIso(textOf(childOf(times, 'LastModificationTime')));
  }
  return e;
}

const NULL_UUID = /^A+=*$/;

export function parseKeepassXml(xmlText) {
  const fail = () => ({ entries: [], error: UNREADABLE });
  try {
    if (typeof xmlText !== 'string' || !xmlText.trim()) return fail();
    const { doc, state } = buildTree(xmlText);
    if (!doc || doc.name !== 'KeePassFile') return fail();
    if (state.sawProtected) return fail();
    const meta = childOf(doc, 'Meta'); // only the recycle bin id is read; Binaries and the rest are never looked at
    let bin = meta ? textOf(childOf(meta, 'RecycleBinUUID')).trim() : '';
    if (NULL_UUID.test(bin)) bin = '';
    const root = childOf(doc, 'Root');
    if (!root) return fail();
    const entries = [];
    const walk = (group, path) => {
      const name = textOf(childOf(group, 'Name'));
      const here = path ? path + '/' + name : name;
      const uuid = textOf(childOf(group, 'UUID')).trim();
      if (bin && uuid === bin) return; // by id, never by the (possibly localised) name
      for (const c of group.children) {
        if (c.name === 'Entry') entries.push(readEntry(c, here)); // History is never entered
        else if (c.name === 'Group') walk(c, here);
      }
    };
    for (const g of childrenOf(root, 'Group')) walk(g, '');
    return { entries };
  } catch {
    return fail();
  }
}

// ------------------------------------------------------------------ strength

// 200 distinct common words (lower-case, 4+ letters) - a deliberately small list.
export const COMMON_WORDS = [
  'password', 'passwort', 'welcome', 'letmein', 'monkey', 'dragon', 'master', 'shadow',
  'sunshine', 'princess', 'football', 'baseball', 'iloveyou', 'trustno', 'admin', 'administrator',
  'login', 'hello', 'freedom', 'whatever', 'starwars', 'secret', 'computer', 'internet',
  'killer', 'soccer', 'hockey', 'batman', 'superman', 'cookie', 'cheese', 'banana',
  'orange', 'purple', 'yellow', 'silver', 'golden', 'flower', 'summer', 'winter',
  'spring', 'autumn', 'january', 'february', 'march', 'april', 'june', 'july',
  'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'qwerty', 'qwertz', 'azerty', 'asdfgh',
  'zxcvbn', 'abcdef', 'access', 'action', 'alpha', 'angel', 'apple', 'arsenal',
  'bailey', 'basket', 'beach', 'beauty', 'bigdog', 'black', 'blue', 'bonjour',
  'brave', 'buster', 'butter', 'camera', 'canada', 'captain', 'carlos', 'casper',
  'change', 'charlie', 'chelsea', 'cherry', 'chicken', 'china', 'cowboy', 'crazy',
  'daniel', 'diamond', 'doctor', 'dolphin', 'eagle', 'engine', 'family', 'fender',
  'fire', 'forever', 'friend', 'ginger', 'green', 'guitar', 'hammer', 'happy',
  'harley', 'heaven', 'hunter', 'jordan', 'junior', 'justin', 'kitten',
  'knight', 'ladies', 'lemon', 'lover', 'magic', 'maggie', 'marine', 'matrix',
  'maverick', 'merlin', 'michael', 'midnight', 'miller', 'mother', 'mustang', 'ninja',
  'nothing', 'oliver', 'panther', 'peanut', 'pepper', 'phoenix', 'pizza', 'player',
  'please', 'pookie', 'prince', 'rabbit', 'rainbow', 'redsox', 'robert',
  'rocket', 'rockstar', 'sample', 'samsung', 'scooter', 'server', 'skywalker', 'smokey',
  'snoopy', 'spider', 'sparky', 'steelers', 'sticky', 'success', 'sweet', 'tennis',
  'thomas', 'tiger', 'tigger', 'toyota', 'trouble', 'turtle', 'unicorn', 'victory',
  'viking', 'william', 'wizard', 'yankees', 'zombie', 'cheers', 'minecraft', 'cricket', 'falcon', 'garden', 'iceman', 'jasmine', 'lakers', 'liverpool', 'mexico',
  'nicole', 'pirate', 'rangers', 'school', 'secure', 'sierra', 'sports', 'sunset', 'thunder', 'warrior', 'winner',
].filter((w, i, a) => a.indexOf(w) === i);

const WORD_SET = new Set(COMMON_WORDS);
const MAX_WORD = COMMON_WORDS.reduce((m, w) => Math.max(m, w.length), 0);
const WORD_BITS = Math.log2(WORD_SET.size);
const YEAR_BITS = Math.log2(200);
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'azertyuiop', 'qsdfghjklm', 'wxcvbn', '1234567890', '0987654321'];
const LEET_A = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '+': 't' };
const LEET_B = { ...LEET_A, 1: 'l' };
const MAX_SCAN = 256;

function charsetSize(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 26;
  if (/[A-Z]/.test(pw)) n += 26;
  if (/[0-9]/.test(pw)) n += 10;
  if (/[ -/:-@[-`{-~]/.test(pw)) n += 33;
  if (/[^\x00-\x7f]/.test(pw)) n += 64;
  return n || 1;
}

function leetNorm(lower, map) {
  let out = '';
  for (const ch of lower) out += map[ch] || ch;
  return out;
}

// Longest run starting at i where each char steps +1 or -1 (same class), or a keyboard-row slice.
function sequenceAt(lower, i) {
  let best = 0;
  const n = lower.length;
  const alnum = (c) => /[a-z0-9]/.test(c);
  for (const step of [1, -1]) {
    let j = i;
    while (j + 1 < n && alnum(lower[j]) && alnum(lower[j + 1])
      && lower.charCodeAt(j + 1) - lower.charCodeAt(j) === step
      && /[a-z]/.test(lower[j]) === /[a-z]/.test(lower[j + 1])) j++;
    best = Math.max(best, j - i + 1);
  }
  for (const row of KEY_ROWS) {
    const at = row.indexOf(lower[i]);
    if (at === -1) continue;
    let j = 0;
    while (i + j < n && at + j < row.length && lower[i + j] === row[at + j]) j++;
    best = Math.max(best, j);
  }
  return best >= 3 ? best : 0;
}

function bitsOf(pw) {
  const n = pw.length;
  if (!n) return 0;
  // a whole-password repetition ('abcabcabc') costs the unit once plus the count
  for (let p = 1; p <= n / 2; p++) {
    if (n % p === 0 && pw.slice(0, p).repeat(n / p) === pw) return bitsOf(pw.slice(0, p)) + Math.log2(n / p);
  }
  const cs = Math.log2(charsetSize(pw));
  const lower = pw.toLowerCase();
  const normA = leetNorm(lower, LEET_A);
  const normB = leetNorm(lower, LEET_B);
  let bits = 0;
  let i = 0;
  while (i < n) {
    // a year 1900-2099
    if (/^(19|20)\d\d/.test(pw.slice(i, i + 4))) { bits += YEAR_BITS; i += 4; continue; }
    // a common word (leet-spelled or not)
    let hit = 0;
    let norm = normA;
    for (let len = Math.min(MAX_WORD, n - i); len >= 4 && !hit; len--) {
      if (WORD_SET.has(normA.slice(i, i + len))) { hit = len; norm = normA; }
      else if (WORD_SET.has(normB.slice(i, i + len))) { hit = len; norm = normB; }
    }
    if (hit) {
      let subs = 0;
      for (let k = i; k < i + hit; k++) if (norm[k] !== lower[k]) subs++;
      const caps = /[A-Z]/.test(pw.slice(i, i + hit)) ? 1 : 0;
      bits += WORD_BITS + caps + subs;
      i += hit;
      continue;
    }
    // a keyboard or alphabet/digit sequence
    const seq = sequenceAt(lower, i);
    if (seq) { bits += 5 + Math.log2(seq); i += seq; continue; }
    // the same character repeated
    let run = 1;
    while (i + run < n && pw[i + run] === pw[i]) run++;
    if (run >= 3) { bits += cs + Math.log2(run); i += run; continue; }
    bits += cs;
    i += 1;
  }
  return bits;
}

export function estimateStrength(password) {
  const pw = typeof password === 'string' ? password.slice(0, MAX_SCAN) : '';
  if (pw === '') return { bits: 0, label: 'empty' };
  const bits = Math.round(bitsOf(pw) * 10) / 10;
  return { bits, label: bits < 50 ? 'weak' : bits < 80 ? 'fair' : 'strong' };
}

// ------------------------------------------------------------------ helpers

const hex = (alg, v) => createHash(alg).update(v, 'utf8').digest('hex');

function toMs(now) {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (now instanceof Date && Number.isFinite(now.getTime())) return now.getTime();
  if (typeof now === 'string') { const t = Date.parse(now); if (Number.isFinite(t)) return t; }
  return Date.now();
}

function hostOf(url) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;
  const tryParse = (v) => { try { return new URL(v).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; } };
  let h = '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) h = tryParse(raw);
  else h = tryParse('https://' + raw);
  return h || null;
}

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

function identityOf(username) {
  const u = typeof username === 'string' ? username.trim() : '';
  if (!u) return null;
  if (EMAIL_RE.test(u)) return { kind: 'email', value: u.toLowerCase() };
  const stripped = u.replace(/[\s\-()]/g, '');
  if (/^\+?\d{8,15}$/.test(stripped)) return { kind: 'phone', value: stripped };
  return null;
}

const hasKey = (k) => (typeof k === 'string' || Buffer.isBuffer(k)) && k.length > 0;

// ------------------------------------------------------------------ reduce

export function reduceEntries(entries, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const nowMs = toMs(opts.now);
  const reuseKey = hasKey(opts.reuseKey) ? opts.reuseKey : null;
  const refKey = hasKey(opts.refKey) ? opts.refKey : null;
  const accounts = [];
  const identities = [];
  const hashes = new Map();
  const identSeen = new Set();
  const seenIds = new Set();
  const byMac = new Map(); // reuse mac -> account indexes

  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const uuid = typeof e.uuid === 'string' ? e.uuid : '';
    const title = typeof e.title === 'string' ? e.title : '';
    const group = typeof e.group === 'string' ? e.group : '';
    // an entry with no UUID gets a placeholder identity from where it sits (not sticky across a rename)
    const id = 'k-' + hex('sha256', uuid || 'noid:' + group + '|' + title).slice(0, 12);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const password = typeof e.password === 'string' ? e.password : '';
    const attrKeys = Array.isArray(e.attrKeys) ? e.attrKeys.filter((k) => typeof k === 'string') : [];
    const modified = typeof e.modified === 'string' ? parseIso(e.modified) : null;
    const created = typeof e.created === 'string' ? parseIso(e.created) : null;
    const otpField = typeof e.otp === 'string' && e.otp.trim() !== '';
    const totp = otpField || attrKeys.some((k) => k === 'otp' || k === 'TOTP Seed');
    const passkey = attrKeys.some((k) => k.startsWith('KPEX_PASSKEY_')) || /\(passkey\)\s*$/i.test(title);
    const strength = estimateStrength(password).label;
    const old = modified != null && nowMs - Date.parse(modified) > OLD_DAYS * DAY_MS;
    let identityRef = null;
    if (refKey) {
      const ident = identityOf(e.username);
      if (ident) {
        identityRef = 'i-' + createHmac('sha256', refKey).update(ident.value, 'utf8').digest('hex').slice(0, 12);
        if (!identSeen.has(identityRef)) {
          identSeen.add(identityRef);
          identities.push({ ref: identityRef, kind: ident.kind, value: ident.value });
        }
      }
    }
    const idx = accounts.length;
    accounts.push({
      id, title, host: hostOf(e.url), group, created, modified,
      totp, passkey, strength, reuseGroup: null, old, identityRef,
    });
    if (password !== '') {
      hashes.set(id, hex('sha1', password).toUpperCase());
      if (reuseKey) {
        const mac = createHmac('sha256', reuseKey).update(password, 'utf8').digest('hex');
        if (!byMac.has(mac)) byMac.set(mac, []);
        byMac.get(mac).push(idx);
      }
    }
  }
  let n = 0;
  for (const idxs of byMac.values()) {
    if (idxs.length < 2) continue;
    n++;
    for (const i of idxs) accounts[i].reuseGroup = n;
  }
  // numbering follows the order of the first account of each group, not Map order
  const order = new Map();
  let next = 0;
  for (const a of accounts) {
    if (a.reuseGroup != null && !order.has(a.reuseGroup)) order.set(a.reuseGroup, ++next);
  }
  for (const a of accounts) if (a.reuseGroup != null) a.reuseGroup = order.get(a.reuseGroup);
  return { accounts, identities, hashes };
}

// ------------------------------------------------------------------ breach

export function breachMatch(sha1Upper, rangeBody) {
  const full = typeof sha1Upper === 'string' ? sha1Upper.trim().toUpperCase() : '';
  if (!/^[0-9A-F]{40}$/.test(full)) return false;
  if (typeof rangeBody !== 'string' || !rangeBody) return false;
  const suffix = full.slice(5);
  for (const line of rangeBody.split(/\r?\n/)) {
    const c = line.indexOf(':');
    if (c === -1) continue;
    if (line.slice(0, c).trim().toUpperCase() !== suffix) continue;
    const count = parseInt(line.slice(c + 1).trim(), 10);
    if (Number.isFinite(count) && count > 0) return true; // count 0 is padding
  }
  return false;
}

// the 5-char prefix the range request sends (the rest never leaves the machine)
export function breachPrefix(sha1Upper) {
  const full = typeof sha1Upper === 'string' ? sha1Upper.trim().toUpperCase() : '';
  return /^[0-9A-F]{40}$/.test(full) ? full.slice(0, 5) : '';
}

// ------------------------------------------------------------------ graph

const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// Edge directions: `uses` a=account b=identity; `signs-in-with` a=account b=provider node;
// `recovers` a=the recovery node b=the account it recovers.
export function buildGraph({ accounts, identities, owner, breached } = {}) {
  const accs = Array.isArray(accounts) ? accounts : [];
  const idents = Array.isArray(identities) ? identities : [];
  const own_ = owner && typeof owner === 'object' ? owner : {};
  const ownerAccounts = own_.accounts && typeof own_.accounts === 'object' ? own_.accounts : {};
  const manual = Array.isArray(own_.manual) ? own_.manual : [];
  const breachedSet = breached instanceof Set ? breached : new Set(Array.isArray(breached) ? breached : []);

  const nodes = [];
  const byId = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const addNode = (n) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n); } return byId.get(n.id); };
  const addEdge = (a, b, kind) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const k = a + '\u0000' + b + '\u0000' + kind;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push({ a, b, kind });
  };

  for (const i of idents) {
    if (!i || typeof i.ref !== 'string') continue;
    addNode({ id: i.ref, kind: 'identity', label: typeof i.value === 'string' ? i.value : '', degree: 0, flags: [] });
  }

  const pending = []; // [nodeId, ownerEdit] applied once every node exists
  const accountIds = new Set();
  for (const a of accs) {
    if (!a || typeof a.id !== 'string') continue;
    accountIds.add(a.id);
    const edit = own(ownerAccounts, a.id) ? ownerAccounts[a.id] : null;
    if (edit && edit.archived === true) continue;
    const flags = [];
    if (a.strength === 'weak') flags.push('weak');
    if (a.reuseGroup != null) flags.push('reused');
    if (a.breached === true || breachedSet.has(a.id)) flags.push('breached');
    const twofa = edit && typeof edit.twofa === 'string' ? edit.twofa : null;
    // 'unknown' (the owner's "not recorded" chip) is the same as nothing said: parity with the renderer's flagsOf and footprint-read's twofaOf
    if (twofa === 'none' || ((twofa == null || twofa === 'unknown') && !a.totp && !a.passkey)) flags.push('no2fa');
    if (a.old === true) flags.push('old');
    addNode({ id: a.id, kind: 'account', label: typeof a.title === 'string' ? a.title : '', degree: 0, flags });
    if (typeof a.identityRef === 'string') pending.push([a.id, { uses: a.identityRef }]);
    if (edit) pending.push([a.id, edit]);
  }

  // owner edits whose account is not in the latest refresh are kept, never dropped
  // (a manual account's own edits live in owner.accounts too: the manual loop below owns those ids)
  const manualIds = new Set(manual.filter((m) => m && typeof m === 'object' && typeof m.id === 'string').map((m) => m.id));
  for (const id of Object.keys(ownerAccounts)) {
    if (accountIds.has(id) || manualIds.has(id)) continue;
    const edit = ownerAccounts[id];
    if (!edit || typeof edit !== 'object' || edit.archived === true) continue;
    const flags = ['not-in-vault'];
    if (edit.twofa === 'none') flags.push('no2fa');
    addNode({ id, kind: 'account', label: typeof edit.label === 'string' ? edit.label : '', degree: 0, flags });
    pending.push([id, edit]);
  }

  for (const m of manual) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id) continue;
    // the owner's twofa for a manual account lives in owner.accounts[id] (the store's editAccount); the record's own field is the older shape
    const mEdit = own(ownerAccounts, m.id) && ownerAccounts[m.id] && typeof ownerAccounts[m.id] === 'object' ? ownerAccounts[m.id] : null;
    if (mEdit && mEdit.archived === true) continue;   // archived accounts leave the graph and every count, manual ones too
    const flags = ['not-in-vault'];
    const mTwofa = mEdit && typeof mEdit.twofa === 'string' ? mEdit.twofa : (typeof m.twofa === 'string' ? m.twofa : null);
    if (mTwofa == null || mTwofa === 'none' || mTwofa === 'unknown') flags.push('no2fa');
    addNode({ id: m.id, kind: 'manual', label: typeof m.label === 'string' ? m.label : '', degree: 0, flags });
    pending.push([m.id, m]);
    if (mEdit) pending.push([m.id, mEdit]);
  }

  for (const [id, edit] of pending) {
    if (typeof edit.uses === 'string') addEdge(id, edit.uses, 'uses');
    if (typeof edit.signInWith === 'string' && edit.signInWith) addEdge(id, edit.signInWith, 'signs-in-with');
    if (typeof edit.recoveryRef === 'string' && edit.recoveryRef) addEdge(edit.recoveryRef, id, 'recovers');
  }
  for (const e of edges) { byId.get(e.a).degree++; byId.get(e.b).degree++; }
  return { nodes, edges };
}

// ------------------------------------------------------------------ snapshot

// map: the stored map ({ accounts, identities, breached? }) or an already built graph ({ nodes }).
export function snapshotOf(map, owner, now) {
  const m = map && typeof map === 'object' ? map : {};
  const g = Array.isArray(m.nodes)
    ? m
    : buildGraph({ accounts: m.accounts, identities: m.identities, owner, breached: m.breached });
  const flags = { weak: 0, reused: 0, breached: 0, no2fa: 0, old: 0, notInVault: 0 };
  let accounts = 0;
  let identities = 0;
  for (const n of g.nodes) {
    if (n.kind === 'identity') { identities++; continue; }
    accounts++;
    if (n.flags.includes('weak')) flags.weak++;
    if (n.flags.includes('reused')) flags.reused++;
    if (n.flags.includes('breached')) flags.breached++;
    if (n.flags.includes('no2fa')) flags.no2fa++;
    if (n.flags.includes('old')) flags.old++;
    if (n.flags.includes('not-in-vault')) flags.notInVault++;
  }
  return { at: new Date(toMs(now)).toISOString(), accounts, identities, flags };
}

// ------------------------------------------------------------------ guard

// Throws if any secret (length >= 4) appears in the JSON form of `value`.
// The message never contains the secret.
export function assertNoSecrets(value, secrets) {
  const json = JSON.stringify(value, (k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v)) || '';
  const list = Array.isArray(secrets) ? secrets : [];
  list.forEach((s, i) => {
    if (typeof s !== 'string' || s.length < 4) return;
    const escaped = JSON.stringify(s).slice(1, -1);
    if (json.includes(s) || json.includes(escaped)) {
      throw new Error('assertNoSecrets: secret #' + i + ' (' + s.length + ' chars) appears in the value');
    }
  });
}
