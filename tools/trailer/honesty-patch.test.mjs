// node --test tools/trailer/honesty-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, checkOutro, denylistHits, patchList, DEFAULT_OUTRO, FILES, CONTENT_FILES } from './honesty-patch.mjs';
import { resolveInside } from './serve.mjs';
import path from 'node:path';

test('a string patch applies only when it matches exactly once', () => {
  const p = { id: 'x', file: 'f', find: 'hq scan', replace: 'Scan now' };
  assert.equal(applyPatch("h: 'hq scan'", p), "h: 'Scan now'");
  assert.throws(() => applyPatch('nothing here', p), /matched 0 times/);
  assert.throws(() => applyPatch('hq scan / hq scan', p), /matched 2 times/);
});

test('a regex patch replaces only its capture group', () => {
  const p = { id: 'row0', file: 'f', find: /const ROWS = \[\s*\{ n: '([^']+)'/, replace: 'project-a' };
  assert.equal(applyPatch("const ROWS = [\n  { n: 'example-one', b: 'main' }", p), "const ROWS = [\n  { n: 'project-a', b: 'main' }");
  assert.throws(() => applyPatch('const ROWS = [];', p), /matched 0 times/);
});

test('replacement text is literal (no $& / $1 expansion)', () => {
  const p = { id: 'lit', file: 'f', find: 'A', replace: '$& $1' };
  assert.equal(applyPatch('xAy', p), 'x$& $1y');
});

test('by default the design outro labels are kept (owner decision); --outro replaces both', () => {
  assert.equal(DEFAULT_OUTRO, null);
  assert.equal(patchList().filter((p) => p.id.endsWith('.outro')).length, 0, 'no outro patch by default');
  for (const outro of ['WorkspaceHQ · v5', 'v3 out now', 'Example · v9']) {
    const outs = patchList({ outro }).filter((p) => p.id.endsWith('.outro'));
    assert.deepEqual(outs.map((p) => p.file).sort(), ['hq-trailer.jsx', 'hq-trailer2.jsx']);
    for (const p of outs) assert.equal(p.replace, outro + '<Cursor T={T} />');
  }
});

test('outro labels must be short plain text', () => {
  assert.equal(checkOutro('WorkspaceHQ · v5'), 'WorkspaceHQ · v5');
  for (const bad of ['', '   ', '{x}', '<b>', 'a`b', 'x'.repeat(33), 'a\nb']) assert.throws(() => checkOutro(bad), /--outro/);
});

test('patch ids are unique and every patch targets a work-copy file', () => {
  const list = patchList();
  const ids = list.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const names = new Set(Object.values(FILES));
  for (const p of list) assert.ok(names.has(p.file), p.id + ' → ' + p.file);
  for (const f of CONTENT_FILES) assert.ok(names.has(f), f);
});

test('the patch list covers every honesty rule from the plan', () => {
  const list = patchList();
  const finds = list.map((p) => String(p.find)).join('\n');
  const repl = list.map((p) => p.replace).join('\n');
  for (const s of ['sk_live_', 'vault://', 'history scrubbed', 'rotated → vault', 'Claude answers from your actual repos', 'const DIFF', "'hq scan'", "'hq ask'", "'tagged v1.0.0'"]) {
    assert.ok(finds.includes(s), 'no patch for ' + s);
  }
  assert.ok(repl.includes('flagged · you rotate it'));
  assert.ok(repl.includes('A local model answers from your scan data.'));
  assert.ok(repl.includes('3 files changed'));
  assert.ok(!/sk_live_|vault:\/\/|history scrubbed/.test(repl), 'a replacement reintroduces secret/vault wording');
  // the commit guard refuses .env paths; it does not scan file contents for keys
  assert.ok(!/no keys/.test(repl), 'a replacement claims the commit sheet checks for keys');
  assert.ok(!/tagged v\d/.test(repl), 'a replacement claims the scan reads git tags');
});

test('denylist: whole-token names hit without echoing them; quoted abbreviations hit by design token', () => {
  const names = ['example-project', 'sample'];
  assert.deepEqual(denylistHits("{ n: 'example-project' }", names), ['(a local project name)', 'example-project']);
  assert.deepEqual(denylistHits("{ n: 'exampl' }", names), ['exampl']); // abbreviation of a local name
  assert.deepEqual(denylistHits('a sampler and samples', names), []); // not a whole token
  assert.deepEqual(denylistHits("{ n: 'project-a' }", names), []);
});

test('serve keeps every request inside its root', () => {
  const root = path.resolve('/tmp/site-root');
  assert.equal(resolveInside(root, '/trailer-1.html'), path.join(root, 'trailer-1.html'));
  assert.equal(resolveInside(root, '/a/../b.js?x=1#y'), path.join(root, 'b.js'));
  for (const bad of ['/../secret.txt', '/..%2f..%2fsecret', '/%2e%2e/%2e%2e/x', '/a/%00b', '/%E0%A4%A']) {
    const r = resolveInside(root, bad);
    assert.ok(r === null || r === root || r.startsWith(root + path.sep), bad + ' → ' + r);
  }
  assert.equal(resolveInside(root, '/a/%00b'), null);
  assert.equal(resolveInside(root, '/%E0%A4%A'), null);
});
