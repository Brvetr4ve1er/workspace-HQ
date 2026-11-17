// The signing key the Launcher's list and the dev server's allows share (data/launcher/key.json): 32 random bytes, sealed by the OS (safeStorage).
//
//   makeKeyStore({ dir, fsApi?, crypto?, randomBytes? }) -> getKey()
//   getKey() -> 64 hex chars, or null = "locked": the OS cannot seal a key, or the stored one no longer opens. A key that no longer opens is
//   never replaced silently: everything signed with it would fail, and a new key would hide that.
// `crypto` is { encrypt(text) -> sealed text | null, decrypt(sealed) -> text | null }; none given = locked.
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function makeKeyStore({ dir, fsApi = fs, crypto, randomBytes = nodeCrypto.randomBytes } = {}) {
  const keyFile = path.join(dir, 'key.json');
  const enc = crypto && typeof crypto.encrypt === 'function' ? crypto.encrypt : () => null;
  const dec = crypto && typeof crypto.decrypt === 'function' ? crypto.decrypt : () => null;
  // 'missing' only when lstat says ENOENT; anything else that is not a valid enc: record (garbage, oversized, a link, unreadable) is 'bad' = locked
  function readKeyFile() {
    let st;
    try { st = fsApi.lstatSync(keyFile); } catch (e) { return e && e.code === 'ENOENT' ? { missing: true } : { bad: true }; }
    try {
      if (!st.isFile() || st.size > 256 * 1024) return { bad: true };
      const v = JSON.parse(fsApi.readFileSync(keyFile, 'utf8'));
      return isObj(v) && typeof v.key === 'string' && v.key.startsWith('enc:') ? { rec: v } : { bad: true };
    } catch { return { bad: true }; }
  }
  function writeJson(file, obj) {
    fsApi.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.' + nodeCrypto.randomBytes(4).toString('hex') + '.tmp';
    fsApi.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fsApi.renameSync(tmp, file);
  }
  return function getKey() {
    const r = readKeyFile();
    if (r.bad) return null;
    if (r.rec) {
      let hex = null;
      try { hex = dec(r.rec.key.slice(4)); } catch { hex = null; }
      return typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex) ? hex : null;
    }
    let sealed = null;
    const hex = randomBytes(32).toString('hex');
    try { sealed = enc(hex); } catch { sealed = null; }
    if (typeof sealed !== 'string' || !sealed) return null;
    try { writeJson(keyFile, { v: 1, key: 'enc:' + sealed }); } catch { return null; }
    return hex;
  };
}

// safeStorage (Electron) as the { encrypt, decrypt } pair above; none = null
function sealerFrom(safeStorage) {
  if (!safeStorage) return null;
  return {
    encrypt: (s) => { try { return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(s)).toString('base64') : null; } catch { return null; } },
    decrypt: (b) => { try { return safeStorage.decryptString(Buffer.from(String(b), 'base64')); } catch { return null; } },
  };
}

module.exports = { makeKeyStore, sealerFrom };
