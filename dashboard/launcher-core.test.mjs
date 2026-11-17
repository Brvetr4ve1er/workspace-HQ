// node --test dashboard/launcher-core.test.mjs - the Launcher's pure rules. Invented names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as c from './launcher-core.mjs';

const ok = (r) => r.ok === true;

test('checkPath accepts a plain absolute drive path', () => {
  assert.ok(ok(c.checkPath('C:\\Work\\Project A')));
  assert.ok(ok(c.checkPath('D:\\notes\\a.txt')));
});

test('checkPath refuses every odd shape with a fixed sentence', () => {
  const bad = {
    'relative': 'Work\\a', 'unc': '\\\\host\\share\\a', 'device': '\\\\?\\C:\\a', 'dot device': '\\\\.\\pipe\\a', 'forward': 'C:/Work/a',
    'dotdot': 'C:\\Work\\..\\a', 'dot': 'C:\\Work\\.\\a', 'double': 'C:\\Work\\\\a', 'stream': 'C:\\Work\\a.txt:hidden', 'short': 'C:\\PROGRA~1\\a',
    'trailing dot': 'C:\\Work\\a.', 'trailing space': 'C:\\Work\\a ', 'reserved': 'C:\\Work\\NUL', 'reserved ext': 'C:\\Work\\con.txt', 'com1': 'C:\\Work\\COM1',
    'root': 'C:\\', 'star': 'C:\\Work\\a*', 'newline': 'C:\\Work\\a\nb', 'drive only': 'C:', 'empty': '', 'long': 'C:\\' + 'a'.repeat(300), 'not a string': 5,
    'trailing slash': 'C:\\Work\\',
  };
  const whys = new Set(Object.values(c.WHY));
  for (const [name, p] of Object.entries(bad)) {
    const r = c.checkPath(p);
    assert.equal(r.ok, false, name + ' is refused');
    assert.ok(whys.has(r.why), name + ' answers a fixed sentence');
  }
});

test('an app is a .exe that does not run other programs', () => {
  assert.ok(ok(c.validateEntry({ kind: 'app', path: 'C:\\Tools\\Editor Name\\edit.exe' })));
  assert.equal(c.validateEntry({ kind: 'app', path: 'C:\\Tools\\Editor Name\\edit.exe' }).name, 'edit');
  for (const n of c.DENY_EXE) assert.equal(c.validateEntry({ kind: 'app', path: `C:\\Windows\\System32\\${n.toUpperCase()}.EXE` }).ok, false, n + ' is on the deny list');
  for (const n of ['run.bat', 'run.cmd', 'run.ps1', 'run.lnk', 'run.msi', 'run', 'run.exe.txt']) assert.equal(c.validateEntry({ kind: 'app', path: 'C:\\Tools\\' + n }).ok, false, n);
  assert.equal(c.isEditorOk({ kind: 'app', path: 'C:\\Windows\\System32\\cmd.exe' }), false);
  assert.equal(c.isEditorOk({ kind: 'file', path: 'C:\\Tools\\a.exe' }), false);
  assert.equal(c.isEditorOk({ kind: 'app', path: 'C:\\Tools\\edit.exe' }), true);
});

test('a file opens only when it is a document or media; a program or script is refused with a short why', () => {
  for (const n of ['a.pdf', 'b.TXT', 'c.docx', 'd.png', 'e.mp4']) assert.ok(ok(c.validateEntry({ kind: 'file', path: 'C:\\Docs\\' + n })), n);
  for (const e of c.REFUSED_EXT) {
    const r = c.validateEntry({ kind: 'file', path: `C:\\Docs\\a.${e}` });
    assert.equal(r.ok, false, e);
    assert.equal(r.why, c.WHY.program, e);
  }
  assert.equal(c.validateEntry({ kind: 'file', path: 'C:\\Docs\\a.xyz' }).why, c.WHY.notDoc);
  assert.equal(c.validateEntry({ kind: 'file', path: 'C:\\Docs\\noext' }).why, c.WHY.notDoc);
  assert.ok(ok(c.validateEntry({ kind: 'folder', path: 'C:\\Docs\\Folder.exe' })), 'a folder has no extension rule');
});

test('a drive that is not built in is refused when the caller says so', () => {
  const only = (l) => l === 'C';
  assert.ok(ok(c.validateEntry({ kind: 'folder', path: 'C:\\a' }, { fixedDrive: only })));
  assert.equal(c.validateEntry({ kind: 'folder', path: 'E:\\a' }, { fixedDrive: only }).why, c.WHY.drive);
});

test('a link is https, or http to this computer, with no login in it', () => {
  assert.deepEqual(c.checkUrl('https://example.org/a?b=1'), { ok: true, url: 'https://example.org/a?b=1', host: 'example.org' });
  assert.equal(c.checkUrl('http://localhost:3000/x').host, 'localhost:3000');
  assert.equal(c.checkUrl('http://127.0.0.1:5173').ok, true);
  assert.equal(c.checkUrl('http://[::1]:8080/').ok, true);
  const bad = ['http://example.org', 'ftp://example.org', 'file:///C:/a', 'javascript:alert(1)', 'https://user:pw@example.org', 'https://user@example.org', 'data:text/html,x',
    'https://', 'not a url', 'https://a b.org', 'https://example.org/\u0001', '', 'https://' + 'a'.repeat(2100) + '.org'];
  for (const u of bad) assert.equal(c.checkUrl(u).ok, false, JSON.stringify(u).slice(0, 40));
  const e = c.validateEntry({ kind: 'url', url: 'https://example.org/secret/path?q=1' });
  assert.equal(e.name, 'example.org');
  assert.equal(e.host, 'example.org');
});

test('a shortcut file gives only its first URL= line, within 4 KB', () => {
  assert.equal(c.parseShortcut('[InternetShortcut]\r\nURL=https://example.org/a\r\nIconFile=C:\\x.ico\r\n'), 'https://example.org/a');
  assert.equal(c.parseShortcut('[InternetShortcut]\nIconFile=x\n'), null);
  assert.equal(c.parseShortcut('URL=\n'), null);
  assert.equal(c.parseShortcut('x'.repeat(5000) + '\nURL=https://example.org'), null, 'a line past 4 KB is not read');
  assert.equal(c.parseShortcut('URL=https://a.example\nURL=https://b.example'), 'https://a.example');
  assert.equal(c.parseShortcut(null), null);
});

test('folderArg: a plain folder passes; the terminal also refuses ; and %', () => {
  assert.ok(ok(c.folderArg('C:\\Work\\Project A')));
  assert.ok(ok(c.folderArg('C:\\Work\\a;b')), 'an editor takes a semicolon');
  assert.equal(c.folderArg('C:\\Work\\a;b', { terminal: true }).why, 'symbol');
  assert.equal(c.folderArg('C:\\Work\\100%', { terminal: true }).why, 'symbol');
  assert.equal(c.folderArg('-d', { terminal: true }).ok, false);
  assert.equal(c.folderArg('C:\\Work\\..\\x').ok, false);
  assert.equal(c.folderArg('C:\\Work\\a\nb').ok, false);
});

test('ids are random 12-hex words that pass the id check; entries are signed and a changed field fails', () => {
  const id = c.newId();
  assert.match(id, c.ID_RE);
  assert.notEqual(c.newId(), c.newId());
  const key = 'ab'.repeat(32);
  const e = { id, kind: 'folder', path: 'C:\\Work\\a', name: 'a', addedAt: '2026-11-17T00:00:00.000Z' };
  e.sig = c.signEntry(key, e);
  assert.ok(c.verifyEntry(key, e));
  assert.equal(c.verifyEntry(key, { ...e, path: 'C:\\Work\\b' }), false);
  assert.equal(c.verifyEntry(key, { ...e, kind: 'app' }), false);
  assert.equal(c.verifyEntry('cd'.repeat(32), e), false);
  assert.equal(c.verifyEntry(key, { ...e, sig: 'zz' }), false);
  assert.equal(c.verifyEntry(null, e), false);
});

test('the inline line uses the fixed sentences, in step order, and the folder-missing sentence stands alone', () => {
  const steps = [{ step: 'dev', state: 'unconfirmed' }, { step: 'editor', state: 'none' }, { step: 'terminal', state: 'opened' }];
  assert.equal(c.buildLine(steps), 'Dev server: not allowed yet. Press Allow and run. Editor: none chosen. Pick one in Settings > Launcher. Terminal: opened.');
  assert.equal(c.buildLine([{ step: 'dev', state: 'started' }, { step: 'editor', state: 'failed' }, { step: 'terminal', state: 'skipped' }]),
    "Dev server: started. Editor: didn't open. Check the editor in Settings > Launcher. Terminal: skipped, the folder name has a symbol Windows Terminal can't take.");
  assert.equal(c.buildLine([], true), c.FOLDER_MISSING);
  assert.match(c.FOLDER_MISSING, /^Folder not found\. Scan again/);
  assert.match(c.FOLDER_LINK, /reached through a link/);
  assert.match(c.FOLDER_ODD, /Rename it/);
  assert.equal(c.buildLine([{ step: 'x', state: 'y' }, { step: 'dev', state: 'bogus' }]), '');
  assert.equal(c.stepWords(steps), 'dev:unconfirmed editor:none terminal:opened');
  assert.equal(c.stepWords([{ step: 'dev', state: 'C:\\secret' }]), '', 'a word outside the tables never reaches the audit reason');
  assert.equal(c.stepsOk(steps), true);
  assert.equal(c.stepsOk([{ step: 'dev', state: 'refused' }, { step: 'editor', state: 'none' }, { step: 'terminal', state: 'skipped' }]), false);
});
