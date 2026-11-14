// dashboard/claude-hub/snapshot.mjs
// A daily read-only snapshot of the chat index (batch 6, "protect the memory").
// data/claude/hub.sqlite is the only copy of every chat whose transcript Claude Code has deleted (index-guard.mjs counts
// them), and it sits inside the repo tree with no backup. This module makes one consistent, verified copy elsewhere.
//
//   snapshotTo(db, destFile)  VACUUM INTO a tmp file next to dest on an OPEN connection (a read-only one works too, so a
//                             reader Hub can snapshot), verify the tmp (integrity_check + table counts), rename it to
//                             dest only when it passes, delete it on any failure. A raw copy of a live WAL db is never taken.
//   verifySnapshot(file)      the restore dry run: opens the file read-only, never writes. -> { ok, counts, bytes, reason? }
//   planRetention(names, n)   which hub-YYYY-MM-DD.sqlite names to keep / remove (nothing else is ever named)
//   refuseDestination(...)    a destination inside the repo, or on a synced-folder path, is refused
//   node dashboard/claude-hub/snapshot.mjs --verify <file>     exit 0 when the file is a good index, 1 when not
//
// node:sqlite is loaded LAZILY (only verify needs it): hub-snapshot.js loads this module in Electron 32 (Node 20, no
// node:sqlite) just for refuseDestination and planRetention, which are pure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(HERE, '..', '..');   // dashboard/claude-hub -> the repo
const require_ = createRequire(import.meta.url);
const loadSqlite = () => require_('node:sqlite');

export const KEEP_DEFAULT = 7;
export const NAME_RE = /^hub-(\d{4})-(\d{2})-(\d{2})\.sqlite$/;

// folder names that mean "this path is synced somewhere else"; a snapshot is a FULL copy including masked chat text
export const SYNC_NAMES = [/^onedrive/i, /^dropbox/i, /^google ?drive/i, /^icloud/i, /^syncthing/i, /^sync$/i, /^box$/i, /^mega$/i, /^pcloud/i];

const msg = (e) => String((e && e.message) || e);

// ---------------------------------------------------------------- retention

const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// names: any directory listing. Only hub-YYYY-MM-DD.sqlite (a real date) takes part; every other name is ignored, so it
// can never be selected for removal. Newest `keep` by the date in the name stay; the rest are `remove`.
export function planRetention(names, keep = KEEP_DEFAULT) {
  const n = Number.isInteger(keep) && keep >= 1 ? keep : KEEP_DEFAULT;
  const dated = [];
  for (const name of Array.isArray(names) ? names : []) {
    const m = typeof name === 'string' ? NAME_RE.exec(name) : null;
    if (m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))) dated.push({ name, key: m[1] + m[2] + m[3] });
  }
  dated.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return { keep: dated.slice(0, n).map((x) => x.name), remove: dated.slice(n).map((x) => x.name) };
}

// ---------------------------------------------------------------- destination rules (reasons carry no path)

// the real path of the nearest existing ancestor, the missing tail appended: a dest that does not exist yet still resolves
function realish(p, realpath) {
  let cur = path.resolve(p); const tail = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(realpath(cur), ...tail.reverse()); } catch { /* not there (yet) */ }
    const up = path.dirname(cur);
    if (up === cur) break;
    tail.push(path.basename(cur)); cur = up;
  }
  return path.resolve(p);
}

const matches = (seg, names) => names.some((n) => (n instanceof RegExp ? n.test(seg) : String(n).toLowerCase() === seg.toLowerCase()));
const segmentsOf = (p) => path.resolve(p).split(/[\\/]+/).filter(Boolean);

// -> null when the destination is acceptable, else a short reason (never contains the path)
export function refuseDestination(dest, { repoRoot = DEFAULT_REPO_ROOT, syncNames = SYNC_NAMES, platform = process.platform, realpath = fs.realpathSync } = {}) {
  if (typeof dest !== 'string' || !dest.trim()) return 'no destination';
  if (!path.isAbsolute(dest)) return 'destination must be an absolute path';
  const fold = (s) => (platform === 'win32' ? s.toLowerCase() : s);
  const inside = (parent, child) => {
    const rel = path.relative(fold(parent), fold(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const lexical = path.resolve(dest);
  const real = realish(dest, realpath);
  for (const root of [repoRoot && path.resolve(repoRoot), repoRoot && realish(repoRoot, realpath)]) {
    if (!root) continue;
    if (inside(root, lexical) || inside(root, real)) return 'destination is inside the repo';
  }
  for (const p of [lexical, real]) if (segmentsOf(p).some((s) => matches(s, syncNames))) return 'destination is in a synced folder';
  return null;
}

// ---------------------------------------------------------------- counts, verify

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// row counts of the real tables: fts virtual tables and their shadow tables are left out (their content tables are counted)
export function tableCounts(db) {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const virtual = rows.filter((r) => /^\s*CREATE\s+VIRTUAL/i.test(r.sql || '')).map((r) => r.name);
  const out = {};
  for (const r of rows) {
    if (virtual.includes(r.name) || virtual.some((v) => r.name.startsWith(v + '_'))) continue;
    out[r.name] = db.prepare('SELECT COUNT(*) AS n FROM ' + q(r.name)).get().n;
  }
  return out;
}

// Opens read-only and never writes. ok needs: a readable sqlite file, integrity_check 'ok', and the Hub's own meta table
// with a schema_version (a zero-byte or foreign file opens as a valid empty database, so integrity alone proves nothing).
export function verifySnapshot(file, { sqlite } = {}) {
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch (e) { return { ok: false, counts: {}, bytes: 0, reason: 'file not readable' }; }
  if (!bytes) return { ok: false, counts: {}, bytes, reason: 'file is empty' };
  let db = null;
  try {
    const { DatabaseSync } = sqlite || loadSqlite();
    db = new DatabaseSync(file, { readOnly: true });
    const ic = db.prepare('PRAGMA integrity_check').all().map((r) => String(r.integrity_check));
    if (ic.length !== 1 || ic[0] !== 'ok') return { ok: false, counts: {}, bytes, reason: 'integrity check failed: ' + ic.slice(0, 3).join('; ').slice(0, 200) };
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) return { ok: false, counts: {}, bytes, reason: 'not a chat index (no meta table)' };
    const ver = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (!ver) return { ok: false, counts: {}, bytes, reason: 'not a chat index (no schema version)' };
    return { ok: true, counts: tableCounts(db), bytes, schemaVersion: String(ver.value) };
  } catch (e) {
    return { ok: false, counts: {}, bytes, reason: 'file is not a readable database: ' + msg(e).slice(0, 200) };
  } finally { try { db && db.close(); } catch { /* closing */ } }
}

// ---------------------------------------------------------------- the snapshot

// db: an OPEN DatabaseSync (writer or read-only). Returns { ok:true, bytes, ms, counts }; THROWS (after removing the tmp
// file, with dest untouched) when the destination is refused, the copy or the disk write fails, or the copy does not verify.
export function snapshotTo(db, destFile, opts = {}) {
  const { repoRoot = DEFAULT_REPO_ROOT, syncNames = SYNC_NAMES, platform = process.platform, fsImpl = fs, now = Date.now, verify = verifySnapshot } = opts;
  const refused = refuseDestination(destFile, { repoRoot, syncNames, platform });
  if (refused) throw new Error('snapshot refused: ' + refused);
  const dest = path.resolve(destFile);
  const tmp = dest + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  const cleanup = () => { try { fsImpl.rmSync(tmp, { force: true }); } catch { /* best effort */ } };
  const t0 = now();
  try {
    fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
    cleanup();   // VACUUM INTO refuses an existing file
    db.prepare('VACUUM INTO ?').run(tmp);
    const v = verify(tmp);
    if (!v.ok) throw new Error('snapshot did not verify: ' + v.reason);
    fsImpl.renameSync(tmp, dest);
    return { ok: true, bytes: v.bytes, ms: now() - t0, counts: v.counts };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ---------------------------------------------------------------- the restore dry run

export function main(argv, { out = (s) => process.stdout.write(s + '\n'), err = (s) => process.stderr.write(s + '\n') } = {}) {
  const i = argv.indexOf('--verify');
  const file = i >= 0 ? argv[i + 1] : null;
  if (!file) { err('usage: node dashboard/claude-hub/snapshot.mjs --verify <file>'); return 2; }
  const r = verifySnapshot(file);
  if (!r.ok) { err('NOT a good snapshot: ' + r.reason); return 1; }
  out('ok: a readable chat index, schema ' + r.schemaVersion + ', ' + r.bytes + ' bytes');
  for (const [k, n] of Object.entries(r.counts)) out('  ' + k + ': ' + n);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
