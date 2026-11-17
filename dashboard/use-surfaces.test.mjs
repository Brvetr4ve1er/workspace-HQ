// Every surface any source file marks is on the use-log allowlist (dashboard/use-log.js SURFACES), so no mark is silently refused (batch 9,
// act baseline). A mark to a surface that is not listed returns an error nobody reads and the use report never sees it.
// The scan reads source text only: surface ids named in `*_SURFACE` constants and the first literal argument of the mark calls.
//   node --test dashboard/use-surfaces.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const useLog = require('./use-log.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const SKIP_DIR = new Set(['node_modules', '__fixtures__', '__golden__', 'legacy', 'data', 'logs', '.git']);
function walk(dir, out = []) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (d.isDirectory()) { if (!SKIP_DIR.has(d.name)) walk(path.join(dir, d.name), out); continue; }
    if (/\.(js|mjs)$/.test(d.name) && !/\.test\.(js|mjs)$/.test(d.name) && !/\.check\.js$/.test(d.name)) out.push(path.join(dir, d.name));
  }
  return out;
}

const CONST_RE = /\b[A-Z][A-Z_]*_SURFACE\s*=\s*'([a-z][a-z0-9-]*[a-z0-9])'/g;
const CALL_RE = /\b(?:useMark|useActOnce|dlvUseMark|_sbdMark)\(\s*'([a-z][a-z0-9-]*[a-z0-9])'/g;
const MAIN_MARK_RE = /\b(?:useMark|mark)\(\s*'([a-z][a-z0-9-]*[a-z0-9])'\s*,\s*'(?:open|act|resume|copy|log|handover)'/g;

function found() {
  const out = new Map();   // surface -> first file that marks it
  const files = [...walk(path.join(root, 'dashboard')), ...walk(path.join(root, 'dashboard-v5', 'src'))];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of [CONST_RE, CALL_RE, MAIN_MARK_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) if (!out.has(m[1])) out.set(m[1], path.relative(root, f));
    }
  }
  return out;
}

test('every surface a source file marks is in SURFACES', () => {
  const surfaces = new Set(useLog.SURFACES);
  const seen = found();
  assert.ok(seen.size >= 15, 'the scan found the marking sites (' + seen.size + ')');
  const missing = [...seen].filter(([s]) => !surfaces.has(s)).map(([s, f]) => s + ' (' + f + ')');
  assert.deepEqual(missing, [], 'surfaces marked but not allowed: ' + missing.join(', '));
});

test('the scan sees the surfaces the act baseline cares about, and the list has no duplicates', () => {
  const seen = found();
  for (const s of ['brief-act', 'tasks-board', 'cosmos', 'claude-vault', 'security-recycle', 'crew-start']) assert.ok(seen.has(s), s + ' is marked somewhere');
  assert.equal(new Set(useLog.SURFACES).size, useLog.SURFACES.length);
  for (const a of ['open', 'act', 'handover', 'copy', 'log', 'resume']) assert.ok(useLog.ACTIONS.includes(a), a);
});
