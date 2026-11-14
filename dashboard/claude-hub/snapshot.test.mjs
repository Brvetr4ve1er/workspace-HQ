// Daily chat-index snapshot (batch 6, memory snapshot). Real node:sqlite, temp dirs, an invented index.
//   node --test dashboard/claude-hub/snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { snapshotTo, verifySnapshot, planRetention, refuseDestination, tableCounts, main } from './snapshot.mjs';

const SNAP = fileURLToPath(new URL('./snapshot.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-snap-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// an invented index through the real schema: n conversations with 3 messages each (the FTS triggers fill message_fts)
function invent(file, n = 5, opts = {}) {
  const st = openStore(file, opts);
  const ins = st.db.prepare('INSERT INTO message(id, conversation_id, role, at, text) VALUES (?, ?, ?, ?, ?)');
  const conv = st.db.prepare("INSERT INTO conversation(id, source, project_id, native_id, title, message_count) VALUES (?, 'code', 'code:C--placeholder-site', ?, ?, 3)");
  st.db.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    conv.run('code:s' + i, 's' + i, 'placeholder chat ' + i);
    for (let j = 0; j < 3; j++) ins.run('m' + i + '-' + j, 'code:s' + i, j ? 'assistant' : 'user', '2026-01-01T00:00:0' + j + 'Z', 'placeholder text ' + i + ' ' + j);
  }
  st.db.exec('COMMIT');
  return st;
}

test('a snapshot of a live WAL db with an open writer connection has the same table counts', () => {
  const dir = tmp();
  try {
    const src = path.join(dir, 'hub.sqlite'), dest = path.join(dir, 'out', 'hub-2026-01-02.sqlite');
    const st = invent(src, 6);
    assert.match(String(st.db.prepare('PRAGMA journal_mode').get().journal_mode), /wal/i);
    const r = snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo') });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(dest));
    assert.deepEqual(r.counts, tableCounts(st.db));
    assert.equal(r.counts.conversation, 6);
    assert.equal(r.counts.message, 18);
    const v = verifySnapshot(dest);
    assert.equal(v.ok, true);
    assert.deepEqual(v.counts, tableCounts(st.db));
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), ['hub-2026-01-02.sqlite']);   // no tmp, no -wal / -shm left beside it
    st.close();
  } finally { rm(dir); }
});

test('works from a read-only connection (a reader Hub can snapshot)', () => {
  const dir = tmp();
  try {
    const src = path.join(dir, 'hub.sqlite');
    const w = invent(src, 4);
    const ro = new DatabaseSync(src, { readOnly: true });
    const dest = path.join(dir, 'out', 'hub-2026-01-03.sqlite');
    const r = snapshotTo(ro, dest, { repoRoot: path.join(dir, 'repo') });
    assert.equal(r.ok, true);
    assert.equal(verifySnapshot(dest).counts.message, 12);
    ro.close(); w.close();
  } finally { rm(dir); }
});

test('the FTS index survives the copy (a search on the snapshot finds the invented text)', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 3);
    const dest = path.join(dir, 'out', 'hub-2026-01-04.sqlite');
    snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo') });
    const s = new DatabaseSync(dest, { readOnly: true });
    assert.ok(s.prepare("SELECT COUNT(*) AS n FROM message_fts WHERE message_fts MATCH 'placeholder'").get().n >= 9);
    s.close(); st.close();
  } finally { rm(dir); }
});

test('integrity failure: tmp removed, dest absent, the call throws', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 2);
    const dest = path.join(dir, 'out', 'hub-2026-01-05.sqlite');
    const bad = () => ({ ok: false, counts: {}, bytes: 0, reason: 'integrity check failed: planted' });
    assert.throws(() => snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo'), verify: bad }), /did not verify/);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), []);
    st.close();
  } finally { rm(dir); }
});

test('a disk write that throws part way: tmp removed, dest absent', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 2);
    const dest = path.join(dir, 'out', 'hub-2026-01-06.sqlite');
    // the copy lands on disk, then the machine "runs out of space" on the step after
    const wrapped = { prepare: (sql) => { const p = st.db.prepare(sql); return { run: (...a) => { p.run(...a); throw new Error('ENOSPC: planted'); }, all: (...a) => p.all(...a), get: (...a) => p.get(...a) }; } };
    assert.throws(() => snapshotTo(wrapped, dest, { repoRoot: path.join(dir, 'repo') }), /ENOSPC/);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), []);
    // and a rename that fails after a good verify also leaves nothing behind
    const fsImpl = { ...fs, mkdirSync: fs.mkdirSync, rmSync: fs.rmSync, renameSync: () => { throw new Error('EPERM: planted'); } };
    assert.throws(() => snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo'), fsImpl }), /EPERM/);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), []);
    st.close();
  } finally { rm(dir); }
});

test('an existing good snapshot is not damaged by a later failed one', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 2);
    const dest = path.join(dir, 'out', 'hub-2026-01-07.sqlite');
    snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo') });
    const before = fs.readFileSync(dest);
    assert.throws(() => snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo'), verify: () => ({ ok: false, reason: 'planted' }) }));
    assert.ok(before.equals(fs.readFileSync(dest)));
    st.close();
  } finally { rm(dir); }
});

test('verifySnapshot rejects a truncated file, an empty file, a foreign file and a missing file', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 30);
    const good = path.join(dir, 'good.sqlite');
    snapshotTo(st.db, good, { repoRoot: path.join(dir, 'repo') });
    st.close();
    assert.equal(verifySnapshot(good).ok, true);
    const cut = path.join(dir, 'cut.sqlite');
    const buf = fs.readFileSync(good);
    fs.writeFileSync(cut, buf.subarray(0, Math.floor(buf.length / 2)));
    const rc = verifySnapshot(cut);
    assert.equal(rc.ok, false); assert.ok(rc.reason);
    const empty = path.join(dir, 'empty.sqlite'); fs.writeFileSync(empty, '');
    assert.equal(verifySnapshot(empty).ok, false);
    const text = path.join(dir, 'text.sqlite'); fs.writeFileSync(text, 'not a database at all, just placeholder words '.repeat(50));
    assert.equal(verifySnapshot(text).ok, false);
    const other = path.join(dir, 'other.sqlite'); const o = new DatabaseSync(other); o.exec('CREATE TABLE t(x)'); o.close();
    const ro = verifySnapshot(other);
    assert.equal(ro.ok, false); assert.match(ro.reason, /not a chat index/);
    assert.equal(verifySnapshot(path.join(dir, 'nope.sqlite')).ok, false);
  } finally { rm(dir); }
});

test('verifySnapshot writes nothing (no sidecar files appear beside a snapshot)', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 2);
    const good = path.join(dir, 'out', 'hub-2026-01-08.sqlite');
    snapshotTo(st.db, good, { repoRoot: path.join(dir, 'repo') });
    st.close();
    const before = fs.readdirSync(path.dirname(good)), mt = fs.statSync(good).mtimeMs;
    verifySnapshot(good);
    assert.deepEqual(fs.readdirSync(path.dirname(good)), before);
    assert.equal(fs.statSync(good).mtimeMs, mt);
  } finally { rm(dir); }
});

test('planRetention keeps the 7 newest by the date in the name and never selects another kind of name', () => {
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
  const names = [...dates.map((d) => 'hub-' + d + '.sqlite'), 'notes.txt', 'hub-latest.sqlite', 'hub-2026-13-40.sqlite', 'hub-2026-01-03.sqlite.tmp-1-a', 'other-2026-01-01.sqlite', 'hub-2026-01-02.sqlite-wal'].reverse();
  const p = planRetention(names, 7);
  assert.deepEqual(p.remove, ['hub-2026-01-02.sqlite', 'hub-2026-01-01.sqlite']);
  assert.equal(p.keep.length, 7);
  assert.equal(p.keep[0], 'hub-2026-01-09.sqlite');
  for (const n of p.keep.concat(p.remove)) assert.match(n, /^hub-\d{4}-\d{2}-\d{2}\.sqlite$/);
  assert.deepEqual(planRetention(names.slice(0, 3).filter((n) => /^hub-2026-01/.test(n)), 7).remove, []);
  assert.deepEqual(planRetention(null), { keep: [], remove: [] });
  assert.equal(planRetention(names, 0).keep.length, 7);   // a nonsense keep falls back, it never deletes everything
});

test('refuseDestination: inside the repo is refused, also via .. and a case change', () => {
  const dir = tmp();
  try {
    const repo = path.join(dir, 'Repo'); fs.mkdirSync(path.join(repo, 'data', 'claude'), { recursive: true });
    const base = { repoRoot: repo, platform: 'win32' };
    assert.match(refuseDestination(path.join(repo, 'data', 'claude', 'hub-2026-01-01.sqlite'), base), /inside the repo/);
    assert.match(refuseDestination(path.join(repo, 'not-yet', 'x', 'hub-2026-01-01.sqlite'), base), /inside the repo/);   // does not exist yet
    assert.match(refuseDestination(path.join(dir, 'elsewhere', '..', 'Repo', 'snaps', 'a.sqlite'), base), /inside the repo/);
    assert.match(refuseDestination(path.join(dir, 'REPO', 'snaps', 'a.sqlite'), base), /inside the repo/);   // case change on win32
    assert.match(refuseDestination(repo, base), /inside the repo/);
    assert.equal(refuseDestination(path.join(dir, 'Repo-sibling', 'a.sqlite'), base), null);   // a prefix match is not "inside"
    assert.equal(refuseDestination(path.join(dir, 'snaps', 'a.sqlite'), base), null);
  } finally { rm(dir); }
});

test('refuseDestination: a link into the repo is followed (realpath)', (t) => {
  const dir = tmp();
  try {
    const repo = path.join(dir, 'repo'); fs.mkdirSync(repo, { recursive: true });
    const link = path.join(dir, 'innocent');
    try { fs.symlinkSync(repo, link, 'junction'); } catch { t.skip('cannot create a link here'); return; }
    assert.match(refuseDestination(path.join(link, 'a.sqlite'), { repoRoot: repo }), /inside the repo/);
  } finally { rm(dir); }
});

test('refuseDestination: synced-folder segments are refused, a plain local path is accepted', () => {
  const root = path.resolve(os.tmpdir(), 'plain-root');
  const repoRoot = path.resolve(os.tmpdir(), 'some-repo');
  for (const seg of ['OneDrive', 'OneDrive - Placeholder Ltd', 'Dropbox', 'Dropbox (Personal)', 'Google Drive', 'GoogleDrive', 'iCloudDrive', 'iCloud Drive', 'Syncthing', 'Sync', 'Box', 'MEGA', 'pCloud', 'pCloudDrive', 'onedrive']) {
    assert.match(refuseDestination(path.join(root, seg, 'snaps', 'a.sqlite'), { repoRoot }) || '', /synced folder/, seg);
  }
  for (const seg of ['hub-snapshots', 'WorkspaceHQ', 'Boxing', 'Megawatt', 'Syncing-notes', 'Documents']) {
    assert.equal(refuseDestination(path.join(root, seg, 'a.sqlite'), { repoRoot }), null, seg);
  }
  assert.equal(refuseDestination(path.join(root, 'WorkspaceHQ', 'hub-snapshots', 'hub-2026-01-01.sqlite'), { repoRoot }), null);
  // a custom list is honoured
  assert.match(refuseDestination(path.join(root, 'Tresorit', 'a.sqlite'), { repoRoot, syncNames: ['tresorit'] }) || '', /synced folder/);
  // junk and relative destinations
  for (const bad of [undefined, null, '', '   ', 42, 'relative/path.sqlite']) assert.ok(refuseDestination(bad, { repoRoot }), String(bad));
  // reasons never carry the path
  assert.equal(String(refuseDestination(path.join(root, 'Dropbox', 'a.sqlite'), { repoRoot })).includes(root), false);
});

test('snapshotTo refuses a destination in the repo before touching anything', () => {
  const dir = tmp();
  try {
    const repo = path.join(dir, 'repo');
    const st = invent(path.join(dir, 'hub.sqlite'), 1);
    assert.throws(() => snapshotTo(st.db, path.join(repo, 'data', 'x.sqlite'), { repoRoot: repo }), /refused/);
    assert.equal(fs.existsSync(repo), false);   // not even the folder was created
    assert.throws(() => snapshotTo(st.db, path.join(dir, 'Dropbox', 'x.sqlite'), { repoRoot: repo }), /synced folder/);
    st.close();
  } finally { rm(dir); }
});

test('--verify: exit 0 and counts for a good snapshot, exit 1 for a bad one; main() agrees', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 3);
    const good = path.join(dir, 'out', 'hub-2026-01-09.sqlite');
    snapshotTo(st.db, good, { repoRoot: path.join(dir, 'repo') });
    st.close();
    const ok = spawnSync(process.execPath, [SNAP, '--verify', good], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /conversation: 3/);
    assert.match(ok.stdout, /message: 9/);
    const bad = path.join(dir, 'bad.sqlite'); fs.writeFileSync(bad, fs.readFileSync(good).subarray(0, 600));
    const no = spawnSync(process.execPath, [SNAP, '--verify', bad], { encoding: 'utf8' });
    assert.equal(no.status, 1);
    assert.match(no.stderr, /NOT a good snapshot/);
    assert.equal(spawnSync(process.execPath, [SNAP], { encoding: 'utf8' }).status, 2);
    const lines = []; assert.equal(main(['--verify', good], { out: (s) => lines.push(s), err: () => {} }), 0);
    assert.ok(lines.length > 3);
  } finally { rm(dir); }
});

test('copy time of a few-thousand-row invented index (printed, not asserted)', () => {
  const dir = tmp();
  try {
    const st = invent(path.join(dir, 'hub.sqlite'), 1500);   // 1500 conversations, 4500 messages
    const dest = path.join(dir, 'out', 'hub-2026-01-10.sqlite');
    const r = snapshotTo(st.db, dest, { repoRoot: path.join(dir, 'repo') });
    console.log('# snapshot copy: ' + r.counts.message + ' messages, ' + r.bytes + ' bytes, ' + r.ms + ' ms');
    assert.equal(r.counts.message, 4500);
    st.close();
  } finally { rm(dir); }
});
