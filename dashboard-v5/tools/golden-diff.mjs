// dashboard-v5/tools/golden-diff.mjs — attribute a golden change before re-recording it (Claude Hub H5).
//   node dashboard-v5/tools/golden-diff.mjs <beforeDir> <afterDir> [--allow <regex>]…
// The dirs are two GOLDEN_DUMP runs of src/vals.golden.test.mjs (one <scenario>.json each, outside the repo).
// Prints every changed value path per scenario, plus added and removed scenarios. Exit 0 only when every changed
// path matches an --allow regex and no scenario was removed; 1 otherwise; 2 on bad usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
export function diffPaths(a, b, at = '', out = []) {
  const ka = kind(a), kb = kind(b);
  if (ka !== kb || (ka !== 'object' && ka !== 'array')) { if (a !== b) out.push(at || '(root)'); return out; }
  if (ka === 'array') {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = at + '[' + i + ']';
      if (i >= a.length || i >= b.length) out.push(p); else diffPaths(a[i], b[i], p, out);
    }
    return out;
  }
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const p = at ? at + '.' + k : k;
    if (!(k in a) || !(k in b)) out.push(p); else diffPaths(a[k], b[k], p, out);
  }
  return out;
}
const names = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const load = (dir, n) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
export function compareDirs(before, after, allow = []) {
  const b = names(before), a = names(after);
  const changed = {}, unexplained = {};
  for (const n of b.filter((x) => a.includes(x))) {
    const ps = diffPaths(load(before, n), load(after, n));
    if (!ps.length) continue;
    changed[n] = ps;
    const bad = ps.filter((p) => !allow.some((re) => re.test(p)));
    if (bad.length) unexplained[n] = bad;
  }
  return { changed, unexplained, added: a.filter((x) => !b.includes(x)), removed: b.filter((x) => !a.includes(x)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), allow = [], dirs = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--allow') allow.push(new RegExp(args[++i])); else dirs.push(args[i]); }
  if (dirs.length !== 2) { console.error('usage: golden-diff.mjs <beforeDir> <afterDir> [--allow <regex>]…'); process.exit(2); }
  const r = compareDirs(dirs[0], dirs[1], allow);
  for (const [n, ps] of Object.entries(r.changed)) console.log((r.unexplained[n] ? 'UNEXPLAINED ' : 'changed     ') + n + ': ' + ps.slice(0, 12).join(', ') + (ps.length > 12 ? ' …(+' + (ps.length - 12) + ')' : ''));
  for (const n of r.added) console.log('added       ' + n);
  for (const n of r.removed) console.log('REMOVED     ' + n);
  const ok = !Object.keys(r.unexplained).length && !r.removed.length;
  console.log(ok ? 'golden-diff: every change is attributed' : 'golden-diff: unattributed changes — do NOT re-record');
  process.exit(ok ? 0 : 1);
}
