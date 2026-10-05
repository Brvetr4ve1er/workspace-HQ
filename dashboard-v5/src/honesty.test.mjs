// Honesty guard for the v5 renderer: the Claude Design prototype shipped sample
// copy (a fixed 5-day streak, a fake JSON error, invented stack chips, "90 days"
// of bars that are really scans…). Each was replaced by a real value or an
// honest sentence; this test keeps them from coming back.
//
//   node --test dashboard-v5/src/honesty.test.mjs
//
// Scans every source file under src/tpl, src/vals, src/logic and src/elements.
// Test files (*.test.*) are skipped: they may name a denylisted string in order
// to assert it's gone, and they never render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const DIRS = ['tpl', 'vals', 'logic', 'elements'];

// Sample copy from the prototype that the real app must never show.
const DENY = [
  '5-day',                       // fixed streak on the header ember
  '980 things',                  // invented library size
  'Only 29',                     // invented library count
  'Unexpected end of JSON',      // sample error in the error state
  'col 48213',                   // same sample error
  'Only the ticked',             // per-file staging claim (commit stages everything)
  'pod.042',                     // invented hostnames in the ascii backdrop
  'git.mon',
  'node.a · stable',
  '90 days',                     // the snapshot bars are scans, not days
  'Detected Next.js',            // invented stack chips in onboarding
  'Ctrl Alt R to record',        // Ctrl Alt R opens the recorder, it doesn't record
  'Ctrl Alt R</kbd> to record',
  'Nothing is uploaded anywhere', // the default scan's enrichment step sends findings to Claude
  '✓ Start tracking',            // onboarding only copies the config entry
  'Since level',                 // the level-up stats are not deltas since the previous level
];

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(m?js|html|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const read = (dirs) => dirs.flatMap((d) => filesUnder(join(SRC, d))).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
// JS comments never render, and they may name removed copy to say what replaced it.
// Block comments are blanked character for character so reported line numbers stay right.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('the scanned folders exist and hold source files', () => {
  for (const d of DIRS) assert.ok(filesUnder(join(SRC, d)).length > 0, 'src/' + d + ' has no source files');
});

test('no prototype sample copy in tpl / vals / logic / elements', () => {
  const hits = [];
  for (const f of read(DIRS)) {
    const code = stripComments(f.text);
    for (const s of DENY) {
      let i = code.indexOf(s);
      while (i !== -1) { hits.push(f.rel + ':' + lineOf(code, i) + '  “' + s + '”'); i = code.indexOf(s, i + 1); }
    }
  }
  assert.deepEqual(hits, [], 'denylisted sample copy found:\n  ' + hits.join('\n  '));
});

// The .env guard lives in main (dashboard/commit-guard.js: hq:commit-preview flags
// env files, hq:do-commit refuses them). A second, renderer-side regex drifts from
// it (it missed `.env - Copy`, `<name>.env`…), so logic/ and vals/ must not carry one.
// Comments are stripped first so prose may still mention `\.env`.
test('no renderer-side .env path regex in logic / vals', () => {
  const hits = [];
  for (const f of read(['logic', 'vals'])) {
    const code = stripComments(f.text);
    const re = /\\\.env/g;
    let m;
    while ((m = re.exec(code))) hits.push(f.rel + '  …' + code.slice(Math.max(0, m.index - 24), m.index + 16).replace(/\s+/g, ' ') + '…');
  }
  assert.deepEqual(hits, [], 'renderer-side .env regex found (main is the only guard):\n  ' + hits.join('\n  '));
});

test('comments are skipped, copy in templates and strings is not', () => {
  const hit = (src) => stripComments(src).includes('90 days');
  assert.equal(hit('// was "90 days" in the design\nconst a = 1;'), false);
  assert.equal(hit('/* was\n "90 days" */ const a = 1;'), false);
  assert.equal(hit('export default String.raw`<span>90 days · bars</span>`;'), true);
  assert.equal(hit("const label = '90 days';"), true);
  assert.equal(hit('String.raw`<a href="https://x.test/90 days">`'), true);
  assert.equal(lineOf(stripComments('/* a\n b */\nconst s = "90 days";'), stripComments('/* a\n b */\nconst s = "90 days";').indexOf('90 days')), 3);
});

test('the .env regex check sees regex literals and RegExp strings, not comments', () => {
  const found = (src) => /\\\.env/.test(stripComments(src));
  assert.equal(found('const bad = /(^|\\/)\\.env(\\.|$)/.test(name);'), true);
  assert.equal(found("const bad = new RegExp('(^|/)\\\\.env');"), true);
  assert.equal(found('// main refuses /\\.env/ paths now\nconst ok = 1;'), false);
  assert.equal(found('/* old: /\\.env/ */ const ok = 1;'), false);
  assert.equal(found("const url = 'https://example.test'; const ok = 2;"), false);
});
