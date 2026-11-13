// dashboard-v5/tools/vals-fold-check.mjs — prove a renderVals "fold" moved values and changed nothing else.
//   node dashboard-v5/tools/vals-fold-check.mjs <beforeDir> <afterDir> --prefix tdy [--prefix dck …]
//        [--keep <name>]… [--tpl <dir>] [--max-keys <n>]
// <beforeDir> and <afterDir> are two GOLDEN_DUMP runs of src/vals.golden.test.mjs (one <scenario>.json each, outside the repo).
// A fold moves every top-level renderVals key that starts with <prefix> into ONE nested key <prefix>v, keeping the old name
// inside it (tdyRows -> tdyv.tdyRows). For every scenario this checks:
//   - each before key with a moved prefix is gone from the top level after, and present at <prefix>v.<key>, deep-equal
//     (the dump canonicalises a function to "[fn]", so functions are compared as that marker: the arity is not in the dump);
//   - <prefix>v holds exactly the moved keys and nothing else; a prefix with no keys in a scenario must not gain a group;
//   - no key outside the moved prefixes changed, was added or was removed;
//   - the top-level count dropped by exactly (moved keys - groups that received keys);
//   - optionally, every after scenario has at most --max-keys top-level keys;
//   - optionally, no template under --tpl still binds a moved name flat (outside a sc-for alias).
// Exit 0 only when every check holds; 1 on any failure; 2 on bad usage. Pure functions with injected IO; the CLI is the thin wrapper.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

export const groupKey = (prefix) => prefix + 'v';
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function assertPrefixes(prefixes) {
  if (!Array.isArray(prefixes) || !prefixes.length) throw new Error('at least one prefix is needed');
  for (const p of prefixes) if (typeof p !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(p)) throw new Error('bad prefix: ' + String(p));
  for (const a of prefixes) for (const b of prefixes) if (a !== b && b.startsWith(a)) throw new Error('prefixes overlap: ' + a + ' and ' + b);
}

// ---- one scenario ------------------------------------------------------------------------------
// before/after are the parsed dump objects. Returns [{ kind, key, detail }] (empty = the fold is clean for this scenario).
export function checkScenario(before, after, prefixes, opts = {}) {
  const keep = new Set(opts.keep || []);
  const fails = [];
  const add = (kind, key, detail) => fails.push({ kind, key, detail });
  if (!isObj(before) || !isObj(after)) { add('not-object', '(root)', 'a dump root is not a plain object'); return fails; }
  assertPrefixes(prefixes);
  const groups = new Set(prefixes.map(groupKey));
  const prefixOf = (k) => (keep.has(k) || groups.has(k) ? null : (prefixes.find((p) => k.startsWith(p)) ?? null));

  const moved = new Map(prefixes.map((p) => [p, []]));
  const outsideBefore = [];
  for (const k of Object.keys(before)) {
    if (groups.has(k)) { add('group-preexisting', k, 'the before dump already has the group key'); continue; }
    const p = prefixOf(k);
    if (p) moved.get(p).push(k); else outsideBefore.push(k);
  }
  const movedCount = [...moved.values()].reduce((n, a) => n + a.length, 0);
  let groupCount = 0;

  for (const [p, keys] of moved) {
    const g = groupKey(p);
    const inner = after[g];
    if (!keys.length) { if (g in after) add('group-unexpected', g, 'no ' + p + '* keys before, but the after dump has a group'); continue; }
    groupCount++;
    if (!isObj(inner)) {
      add('group-invalid', g, 'the group is missing or not an object');
      for (const k of keys) if (k in after) add('still-flat', k, 'still a top-level key after the fold');
      continue;
    }
    for (const k of keys) {
      if (k in after) add('still-flat', k, 'still a top-level key after the fold');
      if (!(k in inner)) add('missing-in-group', g + '.' + k, 'not present inside the group');
      else if (!isDeepStrictEqual(before[k], inner[k])) add('value-differs', g + '.' + k, 'value differs from the before top-level ' + k);
    }
    const want = new Set(keys);
    for (const k of Object.keys(inner)) if (!want.has(k)) add('group-extra', g + '.' + k, 'not a moved key');
  }

  const outsideSet = new Set(outsideBefore);
  for (const k of outsideBefore) {
    if (!(k in after)) add('outside-removed', k, 'a key outside the moved prefixes disappeared');
    else if (!isDeepStrictEqual(before[k], after[k])) add('outside-changed', k, 'a key outside the moved prefixes changed');
  }
  for (const k of Object.keys(after)) {
    if (outsideSet.has(k) || groups.has(k)) continue;
    if (k in before) continue;   // a moved key that is still flat: already reported as still-flat
    add('outside-added', k, 'a top-level key that was not in the before dump');
  }

  const bn = Object.keys(before).length, an = Object.keys(after).length, wantN = bn - movedCount + groupCount;
  if (an !== wantN) add('count-off', '(count)', 'top-level keys: ' + bn + ' before, ' + an + ' after, expected ' + wantN + ' (' + movedCount + ' moved into ' + groupCount + ' group(s))');
  if (opts.maxKeys != null && an > opts.maxKeys) add('over-max', '(count)', 'after has ' + an + ' top-level keys, the limit is ' + opts.maxKeys);
  return fails;
}

// ---- two directories ---------------------------------------------------------------------------
export const fsIo = {
  list: (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(),
  read: (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')),
};

// io = { list(dir) -> scenario names, read(dir, name) -> parsed JSON }. Unreadable data becomes a failure, never a throw.
export function checkDirs(beforeDir, afterDir, prefixes, opts = {}, io = fsIo) {
  assertPrefixes(prefixes);
  const keep = new Set(opts.keep || []);
  const failures = [];
  const moved = Object.fromEntries(prefixes.map((p) => [p, new Set()]));   // the census: true top-level keys per prefix
  let b, a;
  try { b = io.list(beforeDir); a = io.list(afterDir); }
  catch (e) { return { ok: false, scenarios: 0, moved: {}, maxKeysAfter: 0, failures: [{ scenario: '(dirs)', kind: 'unreadable', key: '', detail: String((e && e.message) || e) }] }; }
  const bs = new Set(b), as = new Set(a);
  for (const n of b) if (!as.has(n)) failures.push({ scenario: n, kind: 'scenario-missing', key: '', detail: 'in the before dump, not in the after dump' });
  for (const n of a) if (!bs.has(n)) failures.push({ scenario: n, kind: 'scenario-added', key: '', detail: 'in the after dump, not in the before dump' });
  let scenarios = 0, maxKeysAfter = 0;
  for (const n of b.filter((x) => as.has(x))) {
    let before, after;
    try { before = io.read(beforeDir, n); after = io.read(afterDir, n); }
    catch (e) { failures.push({ scenario: n, kind: 'unreadable', key: '', detail: String((e && e.message) || e) }); continue; }
    scenarios++;
    for (const f of checkScenario(before, after, prefixes, opts)) failures.push({ scenario: n, ...f });
    if (isObj(before)) {
      for (const k of Object.keys(before)) {
        if (keep.has(k)) continue;
        const p = prefixes.find((q) => k.startsWith(q) && k !== groupKey(q));
        if (p) moved[p].add(k);
      }
    }
    if (isObj(after)) maxKeysAfter = Math.max(maxKeysAfter, Object.keys(after).length);
  }
  const out = {};
  for (const p of prefixes) out[p] = [...moved[p]].sort();
  return { ok: !failures.length, scenarios, moved: out, maxKeysAfter, failures };
}

// ---- templates ---------------------------------------------------------------------------------
// files = [{ path, text }]; names = iterable of moved flat names. A flat binding is a {{ … }} expression whose ROOT identifier
// (an identifier not preceded by a dot) is a moved name and is not a sc-for alias. String literals and HTML comments are ignored.
export function scanTemplates(files, names) {
  const moved = new Set(names);
  const hits = [];
  for (const f of files) {
    const text = String(f.text || '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    const aliases = new Set();
    for (const m of text.matchAll(/<sc-for\b[^>]*?\bas="([A-Za-z_$][\w$]*)"/g)) aliases.add(m[1]);
    for (const m of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const expr = m[1].replace(/'[^']*'|"[^"]*"/g, (s) => ' '.repeat(s.length));
      for (const t of expr.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)/g)) {
        const id = t[2];
        if (!moved.has(id) || aliases.has(id)) continue;
        hits.push({ file: f.path, line: text.slice(0, m.index).split('\n').length, name: id });
      }
    }
  }
  return hits;
}

export const fsTplIo = {
  files: (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => ({ path: path.join(dir, f), text: fs.readFileSync(path.join(dir, f), 'utf8') })),
};

// ---- CLI ---------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const o = { dirs: [], prefixes: [], keep: [], tpl: null, maxKeys: null };
  const val = (i) => { if (i >= argv.length || String(argv[i]).startsWith('--')) throw new Error(argv[i - 1] + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prefix') o.prefixes.push(val(++i));
    else if (a === '--keep') o.keep.push(val(++i));
    else if (a === '--tpl') o.tpl = val(++i);
    else if (a === '--max-keys') o.maxKeys = Number(val(++i));
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o.dirs.push(a);
  }
  if (o.dirs.length !== 2) throw new Error('need <beforeDir> and <afterDir>');
  if (o.maxKeys !== null && !(Number.isInteger(o.maxKeys) && o.maxKeys > 0)) throw new Error('--max-keys needs a positive integer');
  assertPrefixes(o.prefixes);
  return o;
}

export function run(argv, io = fsIo, tplIo = fsTplIo) {
  const lines = [];
  let o;
  try { o = parseArgs(argv); }
  catch (e) {
    return { code: 2, lines: ['vals-fold-check: ' + e.message, 'usage: vals-fold-check.mjs <beforeDir> <afterDir> --prefix <p> [--prefix <p>…] [--keep <name>…] [--tpl <dir>] [--max-keys <n>]'] };
  }
  const r = checkDirs(o.dirs[0], o.dirs[1], o.prefixes, { keep: o.keep, maxKeys: o.maxKeys }, io);
  let tplHits = [];
  if (o.tpl) {
    try { tplHits = scanTemplates(tplIo.files(o.tpl), o.prefixes.flatMap((p) => r.moved[p] || [])); }
    catch (e) { r.failures.push({ scenario: '(templates)', kind: 'unreadable', key: '', detail: String((e && e.message) || e) }); r.ok = false; }
  }
  for (const f of r.failures.slice(0, 40)) lines.push('FAIL ' + f.scenario + ' · ' + f.kind + (f.key ? ' · ' + f.key : '') + ' · ' + f.detail);
  if (r.failures.length > 40) lines.push('…(+' + (r.failures.length - 40) + ' more failures)');
  for (const h of tplHits.slice(0, 40)) lines.push('FAIL template ' + h.file + ':' + h.line + ' still binds ' + h.name + ' flat');
  if (tplHits.length > 40) lines.push('…(+' + (tplHits.length - 40) + ' more template bindings)');
  for (const p of o.prefixes) lines.push(p + '*: ' + (r.moved[p] || []).length + ' keys moved into ' + groupKey(p));
  const ok = r.ok && !tplHits.length;
  lines.push(ok ? 'vals-fold-check: ' + r.scenarios + ' scenario(s) clean, max ' + r.maxKeysAfter + ' top-level keys after' : 'vals-fold-check: the fold is NOT clean — do not re-record the goldens');
  return { code: ok ? 0 : 1, lines };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, lines } = run(process.argv.slice(2));
  for (const l of lines) console.log(l);
  process.exit(code);
}
