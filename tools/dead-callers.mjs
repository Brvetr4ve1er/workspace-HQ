#!/usr/bin/env node
// Dead callers: for each symbol name, every NON-TEST reference across dashboard/, dashboard-v5/, mcp/, browser-bridge/ and tools/.
//   node tools/dead-callers.mjs <symbol> [<symbol> ...] [--root <repo folder>] [--json]
//
// It exists for one rule (batch 7, subtraction): a method that served a removed feature is deleted ONLY when this tool shows zero non-test
// callers, and the commit quotes its output. Read-only: it never writes, never spawns, never touches the network.
//
// What it does: scans .js .mjs .cjs .html files under the five folders (skipping node_modules, .git and files named *.test.js / *.test.mjs /
// *.test.cjs) and matches each symbol as a whole identifier (so `fooBar` does not match `fooBarNow`). Every hit is printed as
// file:line and tagged:
//   definition  the line that declares it: `name(args) {`, `name: (args) =>`, `name: function`, `function name`, `const|let|var|class name`,
//               or an object-literal key at the start of a line (`name: q(...)`)
//   comment     the match sits in a whole-line comment or after a ` //` comment
//   call        anything else (a call, a property read, a re-export, a string that names it): treated as LIVE, so a doubtful line keeps the code
// A symbol is DEAD when it has no `call` hit (its definition and comments do not count); it is LIVE otherwise. A symbol found nowhere is
// reported as NOT FOUND (also dead, but check the spelling). Test-file references are only counted, never listed as callers.
//
// Exit code: 0 every symbol is dead or not found, 1 at least one symbol has a caller, 2 usage error (no symbol, a bad symbol, an unknown flag).
// The classifier is a text heuristic, not a parser: it is deliberately biased toward LIVE, and the full hit list is printed so a human reads it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOTS = Object.freeze(['dashboard', 'dashboard-v5', 'mcp', 'browser-bridge', 'tools']);
export const EXTS = Object.freeze(['.js', '.mjs', '.cjs', '.html']);
export const SKIP_DIRS = Object.freeze(['node_modules', '.git']);
export const MAX_FILE = 4 * 1024 * 1024;
export const MAX_SYMBOLS = 50;
export const SYMBOL_RE = /^[A-Za-z_$][\w$]*$/;
export const USAGE = 'usage: node tools/dead-callers.mjs <symbol> [<symbol> ...] [--root <repo folder>] [--json]';

/** A test file by name: *.test.js, *.test.mjs, *.test.cjs. */
export const isTestFile = (name) => /\.test\.[cm]?js$/.test(name);

const esc = (s) => s.replace(/[$]/g, '\\$&');
const wordRe = (sym) => new RegExp('(?<![\\w$])' + esc(sym) + '(?![\\w$])', 'g');

// the line up to a trailing ` //` comment (a start-of-line `//` leaves nothing); urls like http:// have no space before the slashes
function codePart(line) {
  const m = /(^|\s)\/\//.exec(line);
  return m ? line.slice(0, m.index) : line;
}

function balancedTail(text) {
  // text starts at the "(" after the name: true when its parens close exactly at the last ")" before a final "{"
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return /^\s*\{\s*$/.test(text.slice(i + 1)); if (depth < 0) return false; }
  }
  return false;
}

/** What one line says about `sym`: null (no match), 'comment', 'definition' or 'call'. */
export function classifyLine(line, sym) {
  const re = wordRe(sym);
  if (!re.test(line)) return null;
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*)/.test(trimmed)) return 'comment';
  const code = codePart(line);
  if (!wordRe(sym).test(code)) return 'comment';
  const s = esc(sym);
  if (new RegExp('^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + s + '\\s*\\(').test(code)) return 'definition';
  if (new RegExp('^\\s*(?:export\\s+)?(?:const|let|var|class)\\s+' + s + '(?![\\w$])').test(code)) return 'definition';
  if (new RegExp('^\\s*(?:async\\s+)?(?:static\\s+)?(?:get\\s+|set\\s+)?' + s + '\\s*:\\s*(?:async\\s*)?(?:function\\b|\\()').test(code)) return 'definition';
  if (new RegExp('^\\s*[\'"]?' + s + '[\'"]?\\s*:').test(code)) return 'definition';   // an object-literal key at the line start
  const m = new RegExp('^\\s*(?:async\\s+)?(?:static\\s+)?(?:get\\s+|set\\s+)?' + s + '\\s*(\\(.*)$').exec(code);
  if (m && balancedTail(m[1])) return 'definition';   // method shorthand: name(args) {
  return 'call';
}

function* walk(dir, fsx, rel) {
  let entries = [];
  try { entries = fsx.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.includes(e.name)) yield* walk(full, fsx, r); }
    else if (e.isFile() && EXTS.includes(path.extname(e.name))) yield { full, rel: r, name: e.name };
  }
}

/**
 * Scan the tree. `fs` is injectable (a temp tree in the tests). -> { files, symbols: { [name]: { hits: [{ file, line, kind, text }], tests: n } } }
 * Hits come back in root order (the ROOTS list), then file, then line. A file over MAX_FILE or unreadable is skipped and counted in `skipped`.
 */
export function scan({ root, symbols, roots = ROOTS, fs: fsx = fs } = {}) {
  const out = { files: 0, skipped: 0, symbols: {} };
  for (const s of symbols) out.symbols[s] = { hits: [], tests: 0 };
  for (const top of roots) {
    for (const f of walk(path.join(root, top), fsx, top)) {
      let text;
      try { if (fsx.statSync(f.full).size > MAX_FILE) { out.skipped++; continue; } text = fsx.readFileSync(f.full, 'utf8'); } catch { out.skipped++; continue; }
      out.files++;
      const test = isTestFile(f.name);
      const lines = text.split(/\r?\n/);
      for (const sym of symbols) {
        const slot = out.symbols[sym];
        if (!text.includes(sym)) continue;
        lines.forEach((line, i) => {
          const kind = classifyLine(line, sym);
          if (!kind) return;
          if (test) { slot.tests++; return; }
          slot.hits.push({ file: f.rel, line: i + 1, kind, text: line.trim().slice(0, 160) });
        });
      }
    }
  }
  return out;
}

/** dead / live / absent per symbol: live = at least one `call` hit; absent = no non-test hit and no test hit at all. */
export function verdicts(result) {
  const v = {};
  for (const [sym, r] of Object.entries(result.symbols)) {
    const calls = r.hits.filter((h) => h.kind === 'call').length;
    v[sym] = calls ? 'live' : (r.hits.length || r.tests) ? 'dead' : 'absent';
  }
  return v;
}

export function formatReport(result) {
  const v = verdicts(result);
  const lines = [`Dead callers (${result.files} source files read${result.skipped ? ', ' + result.skipped + ' skipped' : ''}; test files are counted, not listed)`];
  for (const [sym, r] of Object.entries(result.symbols)) {
    const calls = r.hits.filter((h) => h.kind === 'call').length;
    const head = v[sym] === 'live' ? `${sym}: LIVE, ${calls} non-test caller${calls === 1 ? '' : 's'}`
      : v[sym] === 'dead' ? `${sym}: DEAD, no non-test caller`
        : `${sym}: NOT FOUND anywhere (check the spelling)`;
    lines.push('', head + (r.tests ? ` (${r.tests} test reference${r.tests === 1 ? '' : 's'})` : ''));
    for (const h of r.hits) lines.push(`  ${h.kind.padEnd(10)} ${h.file}:${h.line}  ${h.text}`);
  }
  const dead = Object.keys(v).filter((k) => v[k] !== 'live').length;
  lines.push('', `${dead} of ${Object.keys(v).length} symbol${Object.keys(v).length === 1 ? '' : 's'} with no non-test caller.`);
  return lines.join('\n') + '\n';
}

/** The whole run: argv -> { code, text }. Never throws. */
export function run({ argv = [], root, fs: fsx = fs } = {}) {
  const symbols = [];
  let json = false, dir = root;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--root') { dir = argv[++i]; if (typeof dir !== 'string' || !dir) return { code: 2, text: USAGE + '\n' }; }
    else if (a.startsWith('--')) return { code: 2, text: `dead-callers: unknown flag ${a}\n${USAGE}\n` };
    else if (!SYMBOL_RE.test(a)) return { code: 2, text: `dead-callers: "${a}" is not a symbol name\n${USAGE}\n` };
    else if (!symbols.includes(a)) symbols.push(a);
  }
  if (!symbols.length) return { code: 2, text: USAGE + '\n' };
  if (symbols.length > MAX_SYMBOLS) return { code: 2, text: `dead-callers: at most ${MAX_SYMBOLS} symbols at a time\n` };
  try {
    const result = scan({ root: path.resolve(dir), symbols, fs: fsx });
    const v = verdicts(result);
    const code = Object.values(v).some((x) => x === 'live') ? 1 : 0;
    return { code, text: json ? JSON.stringify({ files: result.files, skipped: result.skipped, symbols: result.symbols, verdicts: v }, null, 2) + '\n' : formatReport(result) };
  } catch (e) {
    return { code: 2, text: 'dead-callers: could not scan (' + (e && e.message ? e.message : 'unknown') + ')\n' };
  }
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = run({ argv: process.argv.slice(2), root: path.join(here, '..') });
  (r.code === 2 ? process.stderr : process.stdout).write(r.text);
  process.exitCode = r.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
