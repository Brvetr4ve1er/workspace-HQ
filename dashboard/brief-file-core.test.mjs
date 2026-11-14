// node --test dashboard/brief-file-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileText, bodyOf, refuseFolder, folderNameOf, normalizeState, briefFileRow, MAX_CHARS, FILE_NAME, HEADER } from './brief-file-core.mjs';

const require = createRequire(import.meta.url);
const NOW = new Date(2026, 10, 14, 9, 30);                       // local 09:30
const GEN = new Date(2026, 10, 14, 9, 25).toISOString();         // 5 min old: fresh
const item = (key, rule, severity, extra) => ({ key, rule, severity, text: 'RAW ' + key, why: 'raw why for ' + key, source: 'scan', age: 'scan 1 h ago', action: { kind: 'go', tab: 'projects', sub: 'grid', projectId: 'proj-' + key }, count: 0, ...extra });
const brief3 = () => ({
  v: 1, generatedAt: GEN, errors: [],
  items: [
    item('secrets:placeholder-a:1', 'secrets', 'high', { count: 2 }),
    item('unpushed:placeholder-b:1', 'unpushed', 'med'),
    item('dirty:placeholder-c:1', 'dirty', 'low'),
  ],
  overflow: [item('ci-red:placeholder-d:1', 'ci-red', 'med', { count: 3 }), item('review-waiting:placeholder-e:1', 'review-waiting', 'low')],
  more: 2, standing: [{ ...item('money-late:placeholder-f:1', 'money-late', 'high'), since: new Date(2026, 10, 5, 8).toISOString() }],
});
const body = (t) => t.split('\n').slice(1, -1);

test('the first line is the time, the file ends with a newline and stays under 600 characters', () => {
  const t = fileText(brief3(), { now: NOW });
  assert.equal(t.split('\n')[0], HEADER + '09:30');
  assert.ok(t.endsWith('\n'));
  assert.ok(t.length <= MAX_CHARS, 'length ' + t.length);
  assert.equal(FILE_NAME, 'workspacehq-brief.txt');
});

test('parity: the lines equal the tray view line for line (" - " where the tray has " · ")', async () => {
  const tray = require('./tray-brief.js').create({ now: () => NOW });
  await tray.ready;
  const b = brief3();
  const firstSeen = { [b.items[0].key]: { first: new Date(2026, 10, 14, 8).toISOString(), last: GEN } };   // item 1 is new, the rest are not
  tray.set(b, firstSeen);
  const v = tray.view();
  assert.equal(v.status, 'ok');
  const want = [v.statusLine].concat(v.noteLine ? [v.noteLine] : [], v.rows.map((r) => r.label), v.overflow ? [v.overflow.label] : [], v.standingLine ? [v.standingLine] : []).map((s) => s.replace(/ · /g, ' - '));
  assert.deepEqual(body(fileText(b, { now: NOW, firstSeen })), want);
  assert.equal(v.rows.length, 3);
  assert.ok(want[0].includes('1 new'), want[0]);
  assert.ok(want[1].startsWith('urgent - new - '), want[1]);
  assert.ok(want[2].startsWith('soon - '), want[2]);
  assert.ok(want[3].startsWith('when you can - '), want[3]);
  assert.ok(want[4].startsWith('+'), want[4]);
  assert.match(want[5], /^1 standing since 5 Nov$/);
});

test('parity: an empty brief, an incomplete brief and a standing-only brief say what the tray says', async () => {
  const cases = [
    { v: 1, generatedAt: GEN, items: [], overflow: [], standing: [], more: 0, errors: [] },
    { v: 1, generatedAt: GEN, items: [], overflow: [], standing: [], more: 0, errors: [{ source: 'github', error: 'x' }, { source: 'accounts', error: 'y' }, { source: 'scan', error: 'z' }] },
    { ...brief3(), items: [], overflow: [], more: 0 },
    { ...brief3(), errors: [{ source: 'pc', error: 'q' }] },
  ];
  for (const b of cases) {
    const tray = require('./tray-brief.js').create({ now: () => NOW });
    await tray.ready; tray.set(b, {});
    const v = tray.view();
    const want = [v.statusLine].concat(v.noteLine ? [v.noteLine] : [], v.rows.map((r) => r.label), v.overflow ? [v.overflow.label] : [], v.standingLine ? [v.standingLine] : []).map((s) => s.replace(/ · /g, ' - '));
    assert.deepEqual(body(fileText(b, { now: NOW, firstSeen: {} })), want, v.statusLine);
  }
});

test('privacy: a hostile brief puts no name, path, amount, id, ref, rule id or why text in the file', () => {
  const hostile = {
    v: 1, generatedAt: GEN, errors: [{ source: 'scan', error: 'C:\\Users\\someone\\Zebra-Project\\secret.txt could not be read' }],
    items: [
      item('secrets:Zebra-Project:C:/Users/someone/zebra/.env', 'secrets', 'high', { text: 'Zebra-Project has 3 secrets, invoice 1,200 DA', why: 'because C:\\Users\\someone\\zebra holds 1,200 DA', count: 1 }),
      item('zz-new-rule:Zebra:1', 'zz-secret-rule', 'med', { text: 'Pay Acme-Client 4,500 DA' }),
      item('money-late:Acme-Client:bill-77', 'money-late', 'low', { text: 'Acme-Client bill 4,500 DA is late' }),
    ],
    overflow: [item('ci-red:Zebra-Repo:run-9', 'ci-red', 'med', { text: 'Zebra-Repo CI failed' })],
    standing: [{ ...item('quest-red:Zebra-quest:1', 'quest-red', 'high', { text: 'Finish Zebra' }), since: new Date(2026, 10, 1).toISOString() }],
    more: 1, quiet: { key: 'quiet:x', rule: 'quiet-x', text: 'C:\\Users\\someone\\Zebra', why: 'Zebra' },
  };
  const t = fileText(hostile, { now: NOW, firstSeen: {} });
  for (const bad of ['Zebra', 'Acme', 'someone', 'C:', '1,200', '4,500', 'DA', 'because', 'secret.txt', 'zz-secret-rule', 'zz-new-rule', 'quest-red', 'ci-red', 'money-late', 'bill-77', 'run-9', 'grid', 'proj-']) assert.ok(!t.includes(bad), 'leaked ' + bad + ' in:\n' + t);
  assert.doesNotMatch(t, /[0-9a-f]{12}/, 'a ref-shaped string got in');
  assert.doesNotMatch(t, /[\\/]/, 'a path separator got in');
  assert.ok(t.length <= MAX_CHARS);
  assert.ok(t.includes('A project has secrets in plain sight') || t.includes('2 projects have secrets in plain sight'), t);
});

test('a quiet line appears only from the projection and only as plain words; absent is fine', () => {
  const b = brief3();
  assert.ok(!fileText(b, { now: NOW }).includes('quiet'));
  // brief-unclog may add p.quiet in the projection; simulate by a projection-shaped value through a brief that has none: still nothing
  assert.ok(!fileText({ ...b, quiet: { text: 'The browser extension is not paired' } }, { now: NOW }).includes('quiet'), 'the raw brief.quiet is not read: only the projection is');
});

test('a stale brief says so and lists no items', () => {
  const old = { ...brief3(), generatedAt: new Date(2026, 10, 14, 8, 50).toISOString() };   // 40 min old
  const t = fileText(old, { now: NOW });
  assert.equal(body(t).length, 1);
  assert.match(body(t)[0], /^Brief out of date - last updated 40 min ago \(the app may be closed\)$/);
  assert.ok(!/urgent|soon|when you can|Needs you/.test(t));
  const day = { ...brief3(), generatedAt: new Date(2026, 10, 12, 9, 30).toISOString() };
  assert.match(fileText(day, { now: NOW }), /last updated 2 days ago/);
  assert.match(fileText({ ...brief3(), generatedAt: 'nonsense' }, { now: NOW }), /time unknown/);
});

test('29 minutes is fresh, 31 minutes is stale', () => {
  const at = (min) => ({ ...brief3(), generatedAt: new Date(NOW.getTime() - min * 60e3).toISOString() });
  assert.ok(fileText(at(29), { now: NOW }).includes('Needs you'));
  assert.ok(fileText(at(31), { now: NOW }).includes('out of date'));
});

test('not a brief at all reads "not ready yet", and never throws', () => {
  for (const x of [null, undefined, 5, 'x', [], {}]) {
    const t = fileText(x, { now: NOW });
    assert.ok(t.startsWith(HEADER), String(x));
    assert.ok(/not ready yet|out of date/.test(t), String(x) + ': ' + t);
  }
  assert.doesNotThrow(() => fileText(brief3(), {}));
});

test('bodyOf drops only the time line, so the same brief at another minute is the same body', () => {
  const a = fileText(brief3(), { now: NOW }), b = fileText(brief3(), { now: new Date(NOW.getTime() + 60e3) });
  assert.notEqual(a, b);
  assert.equal(bodyOf(a), bodyOf(b));
  assert.equal(bodyOf('only one line'), '');
});

test('many items never push the file past 600 characters, and the status line survives', () => {
  const many = { ...brief3(), errors: [{ source: 'scan', error: 'x' }, { source: 'github', error: 'y' }, { source: 'accounts', error: 'z' }] };
  const t = fileText(many, { now: NOW });
  assert.ok(t.length <= MAX_CHARS);
  assert.ok(body(t)[0].startsWith('Needs you'));
});

// ---- refuseFolder ----
function tmp() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brief-file-core-'))); }

test('refuseFolder: a normal folder outside the repo is accepted and answers its real path', () => {
  const repo = tmp(), ok = tmp();
  try {
    const r = refuseFolder(ok, { repoRoot: repo });
    assert.deepEqual(r, { ok: true, folder: ok });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(ok, { recursive: true, force: true }); }
});

test('refuseFolder: the repo, a folder inside it, and a ".." trick into it are refused', () => {
  const repo = tmp();
  try {
    fs.mkdirSync(path.join(repo, 'data', 'x'), { recursive: true });
    const elsewhere = tmp();
    try {
      assert.equal(refuseFolder(repo, { repoRoot: repo }).ok, false);
      assert.equal(refuseFolder(path.join(repo, 'data'), { repoRoot: repo }).ok, false);
      assert.equal(refuseFolder(path.join(repo, 'data', 'x'), { repoRoot: repo }).ok, false);
      const trick = path.join(elsewhere, '..', path.basename(repo), 'data');
      assert.equal(refuseFolder(trick, { repoRoot: repo }).ok, false, trick);
      assert.match(refuseFolder(repo, { repoRoot: repo }).reason, /outside the WorkspaceHQ project/);
    } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('refuseFolder: the repo path in another letter case is refused on Windows, a sibling with the same prefix is not', () => {
  const repo = tmp();
  const sib = repo + '-sibling'; fs.mkdirSync(sib);
  try {
    assert.equal(refuseFolder(sib, { repoRoot: repo }).ok, true, 'a folder that merely starts with the repo name is outside it');
    // an injected fsApi stands in for a case-insensitive disk: realpath keeps the typed case
    const fake = { statSync: () => ({ isDirectory: () => true }), realpathSync: (p) => p };
    assert.equal(refuseFolder('C:\\Repo\\Data', { repoRoot: 'c:\\repo', fsApi: fake, platform: 'win32' }).ok, false);
    assert.equal(refuseFolder('C:\\Other', { repoRoot: 'c:\\repo', fsApi: fake, platform: 'win32' }).ok, true);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(sib, { recursive: true, force: true }); }
});

test('refuseFolder: a drive root, a relative path, a missing folder, a file and junk are refused', () => {
  const repo = tmp(), dir = tmp();
  try {
    const root = path.parse(dir).root;
    assert.match(refuseFolder(root, { repoRoot: repo }).reason, /drive root/);
    assert.match(refuseFolder('some/relative/folder', { repoRoot: repo }).reason, /full path/);
    assert.match(refuseFolder(path.join(dir, 'nope'), { repoRoot: repo }).reason, /does not exist/);
    const file = path.join(dir, 'a.txt'); fs.writeFileSync(file, 'x');
    assert.match(refuseFolder(file, { repoRoot: repo }).reason, /not a folder/);
    for (const junk of [null, undefined, 5, '', '   ', {}]) assert.equal(refuseFolder(junk, { repoRoot: repo }).ok, false, String(junk));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('refuseFolder: a link that leads into the repo is refused by its real path', (t) => {
  const repo = tmp(), dir = tmp();
  try {
    const link = path.join(dir, 'link');
    try { fs.symlinkSync(repo, link, 'junction'); } catch { t.skip('cannot create a link here'); return; }
    assert.equal(refuseFolder(link, { repoRoot: repo }).ok, false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- folder name and the Reach row ----
test('folderNameOf is the last segment only', () => {
  assert.equal(folderNameOf('C:\\Users\\someone\\Sync\\Phone Notes'), 'Phone Notes');
  assert.equal(folderNameOf('/home/someone/sync/phone/'), 'phone');
  assert.equal(folderNameOf(''), '');
  assert.equal(folderNameOf(null), '');
});

test('normalizeState: junk reads as off; a good state keeps its fields', () => {
  assert.deepEqual(normalizeState(null), { v: 1, folder: null, lastWriteAt: null, lastError: null });
  assert.deepEqual(normalizeState({ folder: 'relative', lastWriteAt: 'x', lastError: 5 }), { v: 1, folder: null, lastWriteAt: null, lastError: null });
  const dir = tmp();
  try {
    const s = normalizeState({ v: 1, folder: dir, lastWriteAt: NOW.toISOString(), lastError: 'could not write the file (EBUSY)' });
    assert.equal(s.folder, dir); assert.equal(s.lastWriteAt, NOW.toISOString()); assert.equal(s.lastError, 'could not write the file (EBUSY)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Reach row: off, on with the last write, on but quiet for a day, written never, unreadable; never a full path', () => {
  const dir = path.join(tmp(), 'Phone Sync');
  const nowMs = NOW.getTime();
  const off = briefFileRow({ state: null }, nowMs);
  assert.equal(off.id, 'brief-file'); assert.equal(off.ok, false); assert.equal(off.step, 'Pick a folder you already sync to your phone'); assert.equal(off.who, 'owner');
  assert.deepEqual(off.actions.map((a) => a.id), ['brief-file-pick', 'brief-file-clear']);
  assert.deepEqual(off.actions.map((a) => a.label), ['Pick folder', 'Turn off']);
  const on = briefFileRow({ state: { v: 1, folder: dir, lastWriteAt: new Date(2026, 10, 14, 9, 5).toISOString(), lastError: null } }, nowMs);
  assert.equal(on.ok, true);
  assert.ok(on.detail.includes('"Phone Sync"') && on.detail.includes('last written 09:05'), on.detail);
  assert.ok(!on.detail.includes(path.dirname(dir)), 'the parent path leaked');
  const old = briefFileRow({ state: { v: 1, folder: dir, lastWriteAt: new Date(2026, 10, 12, 9, 5).toISOString(), lastError: null } }, nowMs);
  assert.equal(old.ok, false); assert.ok(old.step);
  assert.ok(old.detail.includes('"Phone Sync"') && !old.detail.includes(path.dirname(dir)));
  const never = briefFileRow({ state: { v: 1, folder: dir, lastWriteAt: null, lastError: 'could not write the file (EBUSY)' } }, nowMs);
  assert.equal(never.ok, false); assert.ok(never.detail.includes('nothing written yet') && never.detail.includes('EBUSY'));
  const failed = briefFileRow({ state: { v: 1, folder: dir, lastWriteAt: new Date(2026, 10, 14, 9, 5).toISOString(), lastError: 'could not write the file (EBUSY)' } }, nowMs);
  assert.equal(failed.ok, true); assert.ok(failed.detail.includes('latest write failed'));
  const bad = briefFileRow({ unreadable: true }, nowMs);
  assert.equal(bad.ok, null); assert.ok(!('step' in bad));
  for (const r of [off, on, old, never, failed, bad]) assert.ok(!/[A-Za-z]:[\\/]|\\\\/.test(r.detail), 'a path in: ' + r.detail);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test('a write from another day names the day', () => {
  const dir = path.join(os.tmpdir(), 'Phone Sync');
  const r = briefFileRow({ state: { v: 1, folder: dir, lastWriteAt: new Date(2026, 10, 13, 23, 40).toISOString(), lastError: null } }, NOW.getTime());
  assert.equal(r.ok, true);
  assert.ok(r.detail.includes('last written 13/11 23:40'), r.detail);
});
