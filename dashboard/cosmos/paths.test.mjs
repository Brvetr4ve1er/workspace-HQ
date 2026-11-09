// Cosmos space — the path rules (dashboard/cosmos/paths.mjs). Placeholder names only.
// The rules under test: a rel is checked as text, then joined, then BOTH sides go through realpath and
// containment is decided by path.relative (never a bare startsWith); `imports:` resolves only into the
// imports folder; a `retired:<id>` reservation can never resolve; nothing here decodes a URL.
//   node --test dashboard/cosmos/paths.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRel, resolveWork, isInside, importDestination, sanitizeFileName, fileUrl, IMPORTS_PREFIX } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-paths-'));
}

describe('checkRel — text rules', () => {
  const refused = [
    ['empty', ''], ['a number', 42], ['null', null], ['undefined', undefined], ['an object', {}],
    ['parent', '..'], ['parent file', '../x.png'], ['deep parent', 'a/../../x.png'], ['backslash parent', 'a\\..\\..\\x.png'],
    ['absolute posix', '/etc/x.png'], ['absolute windows', '\\x.png'], ['drive', 'C:/x.png'], ['drive relative', 'C:x.png'],
    ['UNC', '\\\\server\\share\\x.png'], ['UNC slashes', '//server/share/x.png'], ['NUL', 'a\0b.png'],
    ['retired reservation', 'retired:abc'], ['stream name', 'a.png:hidden'], ['empty segment', 'a//b.png'],
    ['trailing dot', 'a./b.png'], ['trailing space segment', 'a /b.png'], ['device name', 'alpha/CON'], ['device with extension', 'alpha/nul.png'],
    ['wildcard', 'a/*.png'], ['question mark', 'a/b?.png'], ['too long', 'a/' + 'b'.repeat(1100)],
    ['imports with separator', 'imports:a/b.png'], ['imports with backslash', 'imports:a\\b.png'], ['imports parent', 'imports:..\\x'],
    ['imports bare parent', 'imports:..'], ['imports empty', 'imports:'], ['imports colon', 'imports:a:b.png'], ['imports device', 'imports:aux.png'],
  ];
  for (const [label, rel] of refused) {
    it(`refuses ${label}`, () => {
      assert.ok(checkRel(rel).error, label);
    });
  }

  it('accepts ordinary paths and the imports prefix', () => {
    assert.deepEqual(checkRel('alpha-site/Hero Shot.png'), { imp: false, segs: ['alpha-site', 'Hero Shot.png'] });
    assert.deepEqual(checkRel('alpha\\beta\\x.png'), { imp: false, segs: ['alpha', 'beta', 'x.png'] });
    assert.deepEqual(checkRel('imports:drop (2).png'), { imp: true, name: 'drop (2).png' });
    assert.equal(IMPORTS_PREFIX, 'imports:');
  });

  it('a file named like a parent segment with extra characters is fine', () => {
    assert.deepEqual(checkRel('alpha/..hidden.png'), { imp: false, segs: ['alpha', '..hidden.png'] });
  });
});

describe('isInside', () => {
  it('uses path.relative, so a sibling with a longer name is not inside', () => {
    assert.equal(isInside('C:\\root', 'C:\\root-evil\\x.png', 'win32'), false);
    assert.equal(isInside('C:\\root', 'C:\\root\\a\\x.png', 'win32'), true);
    assert.equal(isInside('/root', '/root-evil/x.png', 'linux'), false);
    assert.equal(isInside('/root', '/root/a/x.png', 'linux'), true);
  });
  it('the folder itself, its parent and another drive are not inside', () => {
    assert.equal(isInside('C:\\root', 'C:\\root', 'win32'), false);
    assert.equal(isInside('C:\\root', 'C:\\', 'win32'), false);
    assert.equal(isInside('C:\\root', 'D:\\root\\x.png', 'win32'), false);
  });
  it('compares case-insensitively on win32 only', () => {
    assert.equal(isInside('C:\\Root', 'c:\\ROOT\\A\\x.png', 'win32'), true);
    assert.equal(isInside('/Root', '/root/a/x.png', 'linux'), false);
  });
});

describe('resolveWork — with a fake realpath', () => {
  const identity = (p) => p;
  it('resolves a library file inside the root', () => {
    const r = resolveWork({ root: 'C:\\lib', importsDir: 'C:\\data\\imports', rel: 'alpha/x.png', realpath: identity, platform: 'win32' });
    assert.equal(r.abs, 'C:\\lib\\alpha\\x.png');
  });
  it('resolves imports: only into the imports folder', () => {
    const r = resolveWork({ root: 'C:\\lib', importsDir: 'C:\\data\\imports', rel: 'imports:drop.png', realpath: identity, platform: 'win32' });
    assert.equal(r.abs, 'C:\\data\\imports\\drop.png');
  });
  it('a case difference on win32 still counts as inside (the real path wins)', () => {
    const real = (p) => p.replace(/^C:\\lib/i, 'c:\\LIB');
    const r = resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: real, platform: 'win32' });
    assert.ok(r.abs, JSON.stringify(r));
  });
  it('a link that resolves outside the root is refused', () => {
    const real = (p) => (p.endsWith('x.png') ? 'C:\\elsewhere\\x.png' : p);
    const r = resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: real, platform: 'win32' });
    assert.ok(r.error);
    assert.equal(r.abs, undefined);
  });
  it('a root whose real path is a longer-named sibling prefix is refused', () => {
    const real = (p) => (p.endsWith('x.png') ? 'C:\\lib-evil\\x.png' : p);
    assert.ok(resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: real, platform: 'win32' }).error);
  });
  it('a missing file, a missing root and a throwing realpath give sentences, never throw', () => {
    const missing = () => { throw new Error('ENOENT'); };
    assert.ok(resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: missing, platform: 'win32' }).error);
    assert.ok(resolveWork({ root: null, importsDir: 'C:\\i', rel: 'a/x.png', realpath: identity, platform: 'win32' }).error);
    assert.ok(resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: null, platform: 'win32' }).error);
    assert.ok(resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel: 'a/x.png', realpath: () => 5, platform: 'win32' }).error);
  });
  it('imports: ignores the root (a root-less library can still resolve an import)', () => {
    const r = resolveWork({ root: null, importsDir: 'C:\\data\\imports', rel: 'imports:drop.png', realpath: identity, platform: 'win32' });
    assert.equal(r.abs, 'C:\\data\\imports\\drop.png');
  });
  it('refuses every hostile rel before touching realpath', () => {
    let calls = 0;
    const spy = (p) => { calls += 1; return p; };
    for (const rel of ['..', '../x', 'a/../../x', '/abs', 'C:/x', '\\\\server\\share', 'a\0b', '', 7, 'retired:abc', 'imports:..\\x', 'imports:a/b']) {
      assert.ok(resolveWork({ root: 'C:\\lib', importsDir: 'C:\\i', rel, realpath: spy, platform: 'win32' }).error);
    }
    assert.equal(calls, 0);
  });
});

describe('resolveWork — real folders', () => {
  it('resolves a real file and refuses a missing one', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'root', 'alpha'), { recursive: true });
      fs.mkdirSync(path.join(d, 'imports'));
      fs.writeFileSync(path.join(d, 'root', 'alpha', 'x.png'), 'x');
      fs.writeFileSync(path.join(d, 'imports', 'drop.png'), 'x');
      const ok = resolveWork({ root: path.join(d, 'root'), importsDir: path.join(d, 'imports'), rel: 'alpha/x.png', realpath: fs.realpathSync });
      assert.equal(path.basename(ok.abs), 'x.png');
      const imp = resolveWork({ root: path.join(d, 'root'), importsDir: path.join(d, 'imports'), rel: 'imports:drop.png', realpath: fs.realpathSync });
      assert.equal(path.basename(imp.abs), 'drop.png');
      assert.ok(resolveWork({ root: path.join(d, 'root'), importsDir: path.join(d, 'imports'), rel: 'alpha/none.png', realpath: fs.realpathSync }).error);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('a sibling folder named like the root plus a suffix is not the root', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'root'));
      fs.mkdirSync(path.join(d, 'root-evil'));
      fs.writeFileSync(path.join(d, 'root-evil', 'x.png'), 'x');
      const r = resolveWork({ root: path.join(d, 'root'), importsDir: path.join(d, 'imports'), rel: '..\\root-evil\\x.png', realpath: fs.realpathSync });
      assert.ok(r.error);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('a link inside the root that points outside is refused after realpath', (t) => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'root'));
      fs.mkdirSync(path.join(d, 'outside'));
      fs.writeFileSync(path.join(d, 'outside', 'secret.png'), 'x');
      try {
        fs.symlinkSync(path.join(d, 'outside'), path.join(d, 'root', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e) {
        t.skip('SKIPPED LOUDLY: this OS refused to create a link/junction (' + e.code + '); the fake-realpath tests above cover the same rule');
        return;
      }
      const r = resolveWork({ root: path.join(d, 'root'), importsDir: path.join(d, 'imports'), rel: 'link/secret.png', realpath: fs.realpathSync });
      assert.ok(r.error, JSON.stringify(r));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});

describe('importDestination / sanitizeFileName', () => {
  it('strips path parts and reserved or unsafe characters', () => {
    assert.equal(sanitizeFileName('C:\\Users\\alpha\\drop?.png'), 'drop_.png');
    assert.equal(sanitizeFileName('../../etc/passwd.png'), 'passwd.png');
    assert.equal(sanitizeFileName('a<b>c:d.png'), 'a_b_c_d.png');
    assert.equal(sanitizeFileName('photo.png...'), 'photo.png');
    assert.equal(sanitizeFileName('  .. '), 'file');
    assert.equal(sanitizeFileName(''), 'file');
    assert.equal(sanitizeFileName(null), 'file');
  });
  it('renames Windows device names', () => {
    assert.equal(sanitizeFileName('CON.png'), '_CON.png');
    assert.equal(sanitizeFileName('nul'), '_nul');
    assert.equal(sanitizeFileName('com1.mp4'), '_com1.mp4');
    assert.equal(sanitizeFileName('console.png'), 'console.png');
  });
  it('limits the name to 120 characters and keeps the extension', () => {
    const n = sanitizeFileName('a'.repeat(300) + '.webp');
    assert.equal(n.length, 120);
    assert.ok(n.endsWith('.webp'));
  });
  it('de-duplicates as "name (2).ext"', () => {
    const taken = new Set([path.win32.join('C:\\i', 'drop.png'), path.win32.join('C:\\i', 'drop (2).png')]);
    const r = importDestination('C:\\i', 'drop.png', (p) => taken.has(p), 'win32');
    assert.equal(r.name, 'drop (3).png');
    assert.equal(r.abs, 'C:\\i\\drop (3).png');
  });
  it('a destination never leaves the imports folder, whatever the source name', () => {
    for (const name of ['..\\..\\x.png', '/abs/x.png', 'C:\\x.png', 'CON', 'a\0b.png']) {
      const r = importDestination('C:\\i', name, () => false, 'win32');
      assert.ok(isInside('C:\\i', r.abs, 'win32'), r.abs);
      assert.ok(!checkRel(IMPORTS_PREFIX + r.name).error, r.name);
    }
  });
});

describe('fileUrl', () => {
  it('encodes #, % and spaces exactly once', () => {
    const u = fileUrl(path.join(os.tmpdir(), 'alpha site', '100% #1.png'));
    assert.ok(u.startsWith('file:///'));
    assert.ok(u.includes('alpha%20site'));
    assert.ok(u.includes('100%25%20%231.png'));
    assert.ok(!u.includes('%2520'));
  });
});

describe('source scan', () => {
  it('no decode call appears in the path, curation, store or import helpers (ids.mjs owns the one decode)', () => {
    for (const f of ['paths.mjs', 'curation.mjs', 'store.mjs', 'importlocal.mjs', '../cosmos.js']) {
      const src = fs.readFileSync(path.join(here, f), 'utf8');
      assert.ok(!/decodeURI/.test(src), f);
      assert.ok(!/\bunescape\b/.test(src), f);
    }
    const ids = fs.readFileSync(path.join(here, 'ids.mjs'), 'utf8');
    assert.ok(/decodeURIComponent/.test(ids));
  });
});
