// node --test tools/trailer/honesty-patch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, checkOutro, denylistHits, loadDenylist, patchAll, patchList, DEFAULT_OUTRO, FILES, CONTENT_FILES, FORBIDDEN, SINCE_ROWS } from './honesty-patch.mjs';
import { resolveInside } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  for (const s of ['sk_live_', 'vault://', 'history scrubbed', 'rotated → vault', 'Claude answers from your actual repos', 'const DIFF', "'hq scan'", "'hq ask'",
    'const SINCE', 'you were gone 14h 22m', 'while you were away', 'health 86 → 91']) {
    assert.ok(finds.includes(s), 'no patch for ' + s);
  }
  assert.ok(repl.includes('flagged · you rotate it'));
  assert.ok(repl.includes('A local model answers from your scan data.'));
  assert.ok(repl.includes('3 files changed'));
  assert.ok(repl.includes('since the last scan'));
  assert.ok(!FORBIDDEN.test(repl), 'a replacement reintroduces wording WorkspaceHQ cannot back: ' + (FORBIDDEN.exec(repl) || [])[0]);
  // the commit guard refuses .env paths; it does not scan file contents for keys
  assert.ok(!/no keys/.test(repl), 'a replacement claims the commit sheet checks for keys');
  // nothing tracks time away, and projects have no health score of their own
  assert.ok(!/welcome back|you were gone|while you were away|last visit/.test(repl), 'a replacement claims HQ tracks time away');
  assert.ok(!/health/.test(repl), 'a replacement shows a per-project health score');
});

test('FORBIDDEN catches every claim the design made that HQ cannot back', () => {
  for (const s of ["STRIPE_KEY=sk_live_51Hx", 'vault://stripe/live', '✓ moved to vault · history scrubbed', "t = 'rotated → vault';",
    'you were gone 14h 22m', 'moved while you were away', "'health dropped 91 → 78'", '+214 −38 · health 86 → 91', "'back to clean'",
    "'tests back to green'", "'build failed on main'", "'tagged v1.0.0'"]) {
    assert.ok(FORBIDDEN.test(s), 'FORBIDDEN misses ' + s);
  }
  // the scan-level health readout in the Scan scene is real (account-wide health_index)
  assert.ok(!FORBIDDEN.test('health <span>{health}</span>'));
});

// Parse the SINCE replacement: "const SINCE = [['ok', 'x', 'y', ''], …];" → rows.
const sinceRows = () => JSON.parse(SINCE_ROWS.replace(/^const SINCE = /, '').replace(/;$/, '').replace(/'/g, '"'));

test('Since-scan rows are changes the scan really emits, with the design row count', () => {
  const rows = sinceRows();
  assert.equal(rows.length, 5, 'one pop cue per row: the row count must stay 5');
  assert.equal(new Set(rows.map((r) => r[1])).size, rows.length, 'project names are React keys: they must be unique');
  // collector/assemble.mjs changes_since_prev details (minus the leading project name):
  // git_pushed "pushed (was N ahead).", build_flip "build recovered.", first_remote "gained a remote.",
  // new_project "added.", quest_completed = the quest title (collector quest templates).
  const REAL = [/^pushed \(was \d+ ahead\)$/, /^build recovered$/, /^gained a remote$/, /^added$/,
    /^Commit \S+ working tree \(\d+ files\)$/, /^Push \S+ \(\d+ ahead\)$/, /^Add a remote \+ push \S+$/, /^Fix \S+ build$/];
  for (const [s, name, change, ago] of rows) {
    assert.equal(s, 'ok', name + ': every since-scan change is positive or neutral');
    assert.ok(REAL.some((re) => re.test(change)), name + ': "' + change + '" is not a change type the scan emits');
    assert.equal(ago, '', name + ': changes carry no time of their own');
  }
});

test('the change types the Since rows use still exist in the scan', () => {
  const assemble = fs.readFileSync(path.join(HERE, '..', '..', 'collector', 'assemble.mjs'), 'utf8');
  for (const [type, detail] of [['git_pushed', 'pushed (was ${cg.ahead} ahead).'], ['build_flip', 'build recovered.'], ['first_remote', 'gained a remote.'], ['new_project', 'added.'], ['quest_completed', 'detail: q.title']]) {
    assert.ok(assemble.includes(`type: '${type}'`), 'assemble.mjs no longer emits ' + type);
    assert.ok(assemble.includes(detail), 'assemble.mjs changed the ' + type + ' wording; re-check t2.since-rows');
  }
});

// Needs the Claude Design export (HQ_TRAILER_SRC); skipped without it. Applies the whole
// patch list in memory (no .work/site write) so a patch that no longer matches exactly once,
// or a forbidden claim that survives, fails here instead of aborting a render.
const SRC = process.env.HQ_TRAILER_SRC;
test('the patch list applies exactly once to the design export and leaves nothing forbidden', { skip: !SRC || !fs.existsSync(SRC) ? 'set HQ_TRAILER_SRC to the design export' : false }, () => {
  const text = {};
  for (const [from, to] of Object.entries(FILES)) text[to] = fs.readFileSync(path.join(SRC, from), 'utf8');
  const { applied } = patchAll(text, { names: loadDenylist() });
  assert.equal(applied.length, patchList().length);
  const t2 = text['hq-trailer2.jsx'];
  assert.ok(t2.includes(SINCE_ROWS));
  assert.ok(t2.includes('since the last scan · '));
  assert.equal((t2.match(/SINCE\.forEach\(/g) || []).length, 1, 'the per-row pop cue is still driven by SINCE');
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
