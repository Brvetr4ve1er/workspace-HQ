// Bridge pairing — main side (spec: WorkspaceHQ Bridge 0.7.0, stage 1; CONTRACT "Local bridge routes — pairing and the Brief").
//
// The extension proposes a token; the owner approves it in a native dialog; only then does the app write it. The app
// never invents or sends a token back, so a lost answer or a closed popup cannot leave the two sides disagreeing:
// the extension adopts its pending token only once GET /health?nonce proves the app holds it.
//
//   createTokenStore({ dataDir, now?, fsApi? }) → { get(), pairing(), isPairedOrigin(o), proof(nonce), invalidate() }
//     get() re-reads data/.bridge-token when its mtime/size/inode moved, checking the disk at most once a second.
//   forDataDir(dataDir) → the shared store for that folder (the pairing writer invalidates it, so a fresh pairing is
//     required on the very next request instead of up to a second later).
//   create({ dataDir, dialog, now?, setTimer?, clearTimer?, log?, store?, pid? }) → { handlePair({ origin, body }) }
//     handlePair resolves { status, body } — 200 {ok} after Allow | 403 denied, timed out, malformed or not an
//     extension | 429 a dialog is already open or 3 tries per 10 min used | 500 could not save.
//   allowCors(origin, pairing, urlPath) → boolean: which origins browser-bridge.js may reflect.
//
// The token and the code are never logged, never put in a response, and the dialog shows only the code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_RE = /^[0-9a-f]{64}$/;
const CODE_RE = /^\d{4}$/;
const ORIGIN_RE = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]{1,64}$/i;
const NONCE_RE = /^[0-9a-f]{32}$/;
const DIALOG_MS = 60e3;
const PAIR_CAP = 3;
const PAIR_WINDOW_MS = 10 * 60e3;
const CHECK_MS = 1000;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isExtOrigin = (o) => typeof o === 'string' && ORIGIN_RE.test(o);

function sameSecret(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

function parsePairing(text) {
  if (text == null) return null;
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!isObj(j) || j.v !== 1 || !isExtOrigin(j.origin)) return null;
  return { v: 1, origin: j.origin, pairedAt: typeof j.pairedAt === 'string' ? j.pairedAt : null };
}

function createTokenStore({ dataDir, now = Date.now, fsApi = fs }) {
  const tokenFile = path.join(dataDir, '.bridge-token');
  const pairFile = path.join(dataDir, '.bridge-pairing.json');
  const slot = () => ({ checkedAt: null, sig: null, val: null });
  const slots = { token: slot(), pairing: slot() };

  function cached(s, file, parse) {
    const t = now();
    if (s.checkedAt !== null && t - s.checkedAt < CHECK_MS) return s.val;
    s.checkedAt = t;
    let st;
    try { st = fsApi.statSync(file); } catch { s.sig = null; s.val = parse(null); return s.val; }
    const sig = `${st.mtimeMs}:${st.size}:${st.ino}`;
    if (sig !== s.sig) {
      let text = null;
      try { text = fsApi.readFileSync(file, 'utf8'); } catch { /* vanished between stat and read */ }
      s.val = parse(text);
      s.sig = sig;
    }
    return s.val;
  }
  const parseToken = (text) => (text == null ? '' : String(text).trim());

  return {
    get: () => cached(slots.token, tokenFile, parseToken),
    pairing: () => cached(slots.pairing, pairFile, parsePairing),
    isPairedOrigin(origin) {
      const p = this.pairing();
      return !!p && typeof origin === 'string' && p.origin === origin;
    },
    // HMAC-SHA256(token, nonce) as hex; null when unpaired or the nonce is not 32 hex.
    proof(nonce) {
      const token = this.get();
      if (!token || typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return null;
      return crypto.createHmac('sha256', token).update(nonce).digest('hex');
    },
    invalidate() { slots.token = slot(); slots.pairing = slot(); },
  };
}

const shared = new Map();
function forDataDir(dataDir) {
  const key = path.resolve(dataDir);
  if (!shared.has(key)) shared.set(key, createTokenStore({ dataDir }));
  return shared.get(key);
}

// CORS: with no pairing yet any extension origin may be reflected (it has to be able to propose one); once paired only
// that origin, plus /pair for any extension (a different browser profile re-pairing goes through the same dialog).
function allowCors(origin, pairing, urlPath) {
  if (!isExtOrigin(origin)) return false;
  if (!pairing) return true;
  if (pairing.origin === origin) return true;
  return urlPath === '/pair';
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function writeAtomic(file, text, pid) {
  const tmp = `${file}.${pid}.tmp`;   // data/.bridge-token*.tmp — the pattern .gitignore pins
  await fs.promises.writeFile(tmp, text, { mode: 0o600 });
  for (let attempt = 1; ; attempt++) {
    try { await fs.promises.rename(tmp, file); return; }
    catch (e) {
      if (e.code === 'EPERM' && attempt < 3) { await delay(50); continue; }
      try { await fs.promises.unlink(tmp); } catch { /* already gone */ }
      throw e;
    }
  }
}

function create({ dataDir, dialog, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {}, store = null, pid = process.pid }) {
  const tokenFile = path.join(dataDir, '.bridge-token');
  const pairFile = path.join(dataDir, '.bridge-pairing.json');
  const tokens = store || forDataDir(dataDir);
  let open = false;
  let tries = [];

  const reply = (status, body) => ({ status, body });
  const refuse = (error) => reply(403, { ok: false, error });

  async function save(origin, token) {
    let before = null;
    try { before = await fs.promises.readFile(pairFile, 'utf8'); } catch { /* first pairing */ }
    const doc = { v: 1, origin, pairedAt: new Date(now()).toISOString() };
    // pairing file first: with the token still absent every route fails closed, and CORS already names the new origin.
    await writeAtomic(pairFile, JSON.stringify(doc) + '\n', pid);
    try { await writeAtomic(tokenFile, token + '\n', pid); }
    catch (e) {
      try { if (before == null) await fs.promises.unlink(pairFile); else await writeAtomic(pairFile, before, pid); } catch { /* best effort */ }
      throw e;
    }
    tokens.invalidate();
  }

  async function handlePair({ origin, body } = {}) {
    if (!isExtOrigin(origin)) return refuse('pairing is for the browser extension only');
    if (!isObj(body) || typeof body.code !== 'string' || !CODE_RE.test(body.code) || typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) {
      return refuse('malformed pairing request');
    }
    if (open) return reply(429, { ok: false, error: 'a pairing prompt is already open' });
    const t = now();
    tries = tries.filter((x) => t - x < PAIR_WINDOW_MS);
    if (tries.length >= PAIR_CAP) return reply(429, { ok: false, error: 'too many pairing tries — wait a few minutes' });
    tries.push(t);

    open = true;
    const replaces = !!tokens.pairing();
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    try {
      const asked = Promise.resolve()
        .then(() => dialog.showMessageBox({
          type: 'question',
          title: 'Pair the browser extension?',
          message: `Pair the browser extension ${origin.replace(/^[a-z-]+:\/\//i, '')}? Code ${body.code}.`,
          detail: 'Allow only if you just clicked Pair in the WorkspaceHQ Bridge popup and see this same code. It can then read your Brief here and open the app.'
            + (replaces ? '\n\nThis replaces the existing pairing: the browser extension paired before stops working.' : ''),
          buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0, noLink: true,
          ...(ac ? { signal: ac.signal } : {}),
        }))
        .then((r) => (r && r.response === 1 ? 'allow' : 'deny'), () => 'deny');
      const timeout = new Promise((resolve) => { timer = setTimer(() => resolve('timeout'), DIALOG_MS); });
      const verdict = await Promise.race([asked, timeout]);
      if (verdict !== 'allow') {
        if (verdict === 'timeout' && ac) { try { ac.abort(); } catch { /* dialog API without abort */ } }
        log(`[bridge] pairing ${verdict === 'timeout' ? 'timed out' : 'denied'}`);
        return refuse(verdict === 'timeout' ? 'timed out' : 'denied');
      }
      try { await save(origin, body.token); }
      catch (e) { log('[bridge] pairing could not be saved: ' + String((e && e.code) || 'error')); return reply(500, { ok: false, error: 'could not save the pairing' }); }
      log('[bridge] pairing allowed' + (replaces ? ' (replaced the previous one)' : ''));
      return reply(200, { ok: true });
    } finally {
      if (timer != null) clearTimer(timer);
      open = false;
    }
  }

  return { handlePair, _state: () => ({ open, tries: tries.length }) };
}

module.exports = { create, createTokenStore, forDataDir, allowCors, sameSecret, isExtOrigin, TOKEN_RE, CODE_RE, NONCE_RE, DIALOG_MS, PAIR_CAP, PAIR_WINDOW_MS };
