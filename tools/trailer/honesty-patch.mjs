// tools/trailer/honesty-patch.mjs — copy the Claude Design trailer sources into
// tools/trailer/.work/site and make their content honest before rendering.
//
// Every replacement must match EXACTLY ONCE in its file, otherwise the script
// fails loudly (the design changed; re-check the patch list). Replacements only
// change visible text / data literals — never OM_SCENES, cue tables or anything
// that moves scene timings, so the soundtrack exported from Design still lines up.
//
// Project names: two design names collide with real projects on the owner's
// machine. They are matched by POSITION (which array entry), never by literal,
// so this public script never contains them. After patching, a denylist built
// at runtime from local scan data (data/latest.json + projects/*.md, read only,
// never written anywhere) is grepped over the patched content; any hit aborts.
//
//   node tools/trailer/honesty-patch.mjs --src <design export dir> [--outro "<label>"]
//
// --outro: the outro pill label. Default: keep the design's own labels ("v3 out now" /
// "v3 · out now") — the owner's decision (2026-10-05). A label replaces both.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const WORK_SITE = path.join(HERE, '.work', 'site');
export const OUT_DIR = path.join(HERE, 'out');
export const DEFAULT_OUTRO = null;   // null = keep the design's outro labels (owner decision, 2026-10-05)

// source file in the design export → name in the work copy
export const FILES = {
  'support.js': 'support.js',
  'animations-v3.jsx': 'animations-v3.jsx',
  'tweaks-panel.jsx': 'tweaks-panel.jsx',
  'hq-audio.js': 'hq-audio.js',
  'hq-trailer.jsx': 'hq-trailer.jsx',
  'hq-trailer2.jsx': 'hq-trailer2.jsx',
  'WorkspaceHQ v3 Trailer.dc.html': 'trailer-1.html',
  'WorkspaceHQ v3 Trailer 2.dc.html': 'trailer-2.html',
};
// files whose visible content is checked against the denylist
export const CONTENT_FILES = ['hq-trailer.jsx', 'hq-trailer2.jsx', 'trailer-1.html', 'trailer-2.html', 'hq-audio.js'];

const EDITMODE_FROM = '/*EDITMODE-BEGIN*/{"motionEditor":true,"scanlines":true,"sound":true}/*EDITMODE-END*/';
// Rendering is silent and chrome-free: sound:false also hides the "click to enable sound" chip
// (the soundtrack is muxed afterwards from the WAV Design exports).
const EDITMODE_TO = '/*EDITMODE-BEGIN*/{"motionEditor":false,"scanlines":true,"sound":false}/*EDITMODE-END*/';

/** The patch list. find: exact string or a RegExp with ONE capture group (the part to replace). */
export function patchList({ outro = DEFAULT_OUTRO } = {}) {
  const P = [];
  const add = (id, file, find, replace, why) => P.push({ id, file, find, replace, why });

  // render-only settings (both entry pages)
  add('t1.html-editmode', 'trailer-1.html', EDITMODE_FROM, EDITMODE_TO, 'no sound chip / editor chrome in frame');
  add('t2.html-editmode', 'trailer-2.html', EDITMODE_FROM, EDITMODE_TO, 'no sound chip / editor chrome in frame');

  // ---- Trailer 1 (hq-trailer.jsx) ----
  add('t1.row0-name', 'hq-trailer.jsx', /const ROWS = \[\s*\{ n: '([^']+)'/, 'project-a', 'real project name → placeholder');
  add('t1.wake-key', 'hq-trailer.jsx', "typed('hq --wake', T, K.Boot + .4, 12)", "typed('Ctrl+Alt+G', T, K.Boot + .4, 12)", 'there is no hq CLI; the summon hotkey is real');
  add('t1.scan-header', 'hq-trailer.jsx', '<span style={{ color: C.acc }}>hq scan</span>', '<span style={{ color: C.acc }}>⟳ Scan now</span>', 'CLI command → the real Scan now button');
  add('t1.secret-fixed', 'hq-trailer.jsx', "t = 'rotated → vault';", "t = 'flagged · you rotate it';", 'HQ flags secrets; it does not rotate or vault them');
  add('t1.secret-bubble', 'hq-trailer.jsx', 'text="fixed ✻"', 'text="flagged ✻"', 'matches the flag-only behaviour');

  // ---- Trailer 2 (hq-trailer2.jsx) ----
  const heads = [['hq scan', 'Scan now'], ['hq since', 'Since scan'], ['hq next', 'Next action'], ['hq guard', 'Secrets'],
    ['hq diff', 'Commit sheet'], ['hq ask', 'Ask panel'], ['hq map', 'Map'], ['hq bit', 'Level']];
  for (const [from, to] of heads) {
    add('t2.head-' + from.slice(3), 'hq-trailer2.jsx', `h: '${from}'`, `h: '${to}'`, 'CLI command → real UI destination');
  }
  add('t2.rail-label', 'hq-trailer2.jsx', '{c.h.slice(3)}', '{c.h}', 'labels no longer carry the "hq " prefix');
  add('t2.intro-key', 'hq-trailer2.jsx', "typed('hq', T, .3, 6)", "typed('Ctrl+Alt+G', T, .3, 24)", 'there is no hq CLI; the summon hotkey is real');
  add('t2.repo0-name', 'hq-trailer2.jsx', /const REPOS = \[\['([^']+)'/, 'project-a', 'real project name → placeholder');
  add('t2.repo7-name', 'hq-trailer2.jsx', /const REPOS = \[(?:\['[^']*', '[^']*', '[^']*'\], ){7}\['([^']+)'/, 'project-b', 'real project name → placeholder');
  add('t2.city0-name', 'hq-trailer2.jsx', /const CITY = \[\['([^']+)'/, 'project-a', 'real project name → placeholder');
  add('t2.city6-name', 'hq-trailer2.jsx', /const CITY = \[(?:\[[^\]]*\], ){6}\['([^']+)'/, 'project-b', 'real project name → placeholder');
  add('t2.since-build', 'hq-trailer2.jsx', "'build failed on main'", "'health dropped 91 → 78'", 'the scan does not read CI builds');
  add('t2.since-tests', 'hq-trailer2.jsx', "'tests back to green'", "'back to clean'", 'the scan does not run tests');
  add('t2.since-tag', 'hq-trailer2.jsx', "'tagged v1.0.0'", "'gained a remote'", 'the scan does not read git tags; "gained a remote" is a real since-scan change (first_remote)');
  add('t2.secret-line', 'hq-trailer2.jsx',
    "fixed ? 'STRIPE_KEY=vault://stripe/live' : 'STRIPE_KEY=sk_live_51Hx••••••••••••••••'",
    "fixed ? 'PAYMENT_KEY=•••••••••••••••• # flagged' : 'PAYMENT_KEY=live-key-in-plain-text'",
    'no key-shaped strings, no vault HQ does not have');
  add('t2.secret-status', 'hq-trailer2.jsx', "'✓ moved to vault · history scrubbed'", "'✓ flagged · you rotate it'", 'HQ flags secrets; it does not rotate or scrub history');
  add('t2.diff-caption', 'hq-trailer2.jsx',
    "t: 'Read every commit.', d: 'Inline diffs for each project, without leaving the console.'",
    "t: 'See what you commit.', d: 'Changed files and the stat for each project, before anything is committed.'",
    'the commit sheet shows changed files + stat');
  add('t2.diff-body', 'hq-trailer2.jsx', /(const DIFF = \[.*\];)/,
    "const DIFF = [['M', 'src/tiles/fetch.js   |  5 ++++-'], ['A', 'src/tiles/retry.js   | 18 ++++++++++++++++++'], ['M', 'test/fetch.test.js   |  9 +++++++++'], [' ', ''], [' ', '3 files changed, 31 insertions(+), 1 deletion(-)'], [' ', ''], [' ', 'no .env file in the change set'], [' ', ''], [' ', '']];",
    'line-by-line diff → changed files + --stat (same 9 rows, same timing); the commit guard checks for .env files, not key contents');
  add('t2.diff-head', 'hq-trailer2.jsx',
    '<span style={{ color: C.gold }}>a41f9c2</span>  fix: retry on 429</span><span style={{ color: C.faint }}>pixel-forge · 2m ago</span>',
    '<span style={{ color: C.gold }}>commit</span>  fix: retry on 429</span><span style={{ color: C.faint }}>pixel-forge · main</span>',
    'a commit sheet before committing has no hash yet');
  add('t2.diff-foot', 'hq-trailer2.jsx',
    '<span style={{ color: C.ok }}>+4</span>  <span style={{ color: C.bad }}>−1</span>  <span style={{ color: C.faint }}>· 1 file · build green again</span>',
    '<span style={{ color: C.ok }}>+31</span>  <span style={{ color: C.bad }}>−1</span>  <span style={{ color: C.faint }}>· 3 files · ready to commit</span>',
    'matches the stat; HQ does not know CI state');
  add('t2.ask-desc', 'hq-trailer2.jsx', 'Claude answers from your actual repos.', 'A local model answers from your scan data.', 'Ask runs on a local model over the scan data');
  add('t2.ask-question', 'hq-trailer2.jsx', "const q = 'what broke today?'", "const q = 'what needs me today?'", 'a question the scan data can answer');
  add('t2.ask-answer', 'hq-trailer2.jsx', /(const ANSWER = \[.*\];)/,
    "const ANSWER = [['✻', 'Two projects need you today:'], ['', ''], ['1', 'pixel-forge  3 files uncommitted for 2 days'], ['', '   → commit them from the project page'], ['2', 'orbit-ui     no commits for 9 days'], ['', ''], ['', 'Start with pixel-forge?']];",
    'answer built from scan facts (no CI env claims); same 7 rows so the cues line up');

  // ---- outro label: only with --outro (default keeps the design's labels); the find strings are the design's literals ----
  if (outro != null) add('t1.outro', 'hq-trailer.jsx', 'v3 out now<Cursor T={T} />', outro + '<Cursor T={T} />', 'outro label (--outro)');
  if (outro != null) add('t2.outro', 'hq-trailer2.jsx', 'v3 · out now<Cursor T={T} />', outro + '<Cursor T={T} />', 'outro label (--outro)');
  return P;
}

/** Validate an --outro label: plain text that is safe inside JSX. */
export function checkOutro(label) {
  const s = String(label);
  if (!s.trim() || s.length > 32 || /[{}<>`\\\n\r]/.test(s)) throw new Error('--outro must be 1-32 chars of plain text (no braces, angle brackets, backticks): ' + JSON.stringify(s));
  return s;
}

function countOf(text, find) {
  if (typeof find === 'string') return find ? text.split(find).length - 1 : 0;
  const g = new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g');
  return [...text.matchAll(g)].length;
}

/** Apply one patch; throws unless `find` matches exactly once. Returns the new text. */
export function applyPatch(text, p) {
  const n = countOf(text, p.find);
  if (n !== 1) throw new Error(`honesty-patch: "${p.id}" matched ${n} times in ${p.file} (expected exactly 1) — the design changed, re-check the patch list`);
  if (typeof p.find === 'string') return text.replace(p.find, () => p.replace);
  const m = new RegExp(p.find.source, p.find.flags.replace(/[gd]/g, '') + 'd').exec(text);
  if (!m.indices[1]) throw new Error(`honesty-patch: "${p.id}" regex needs one capture group`);
  const [a, b] = m.indices[1];
  return text.slice(0, a) + p.replace + text.slice(b);
}

/** Names that must never appear in the rendered content (read from local data, never written). */
export function loadDenylist(repo = REPO) {
  const names = new Set();
  const addName = (s) => { if (typeof s === 'string' && s.trim().length >= 3) names.add(s.trim().toLowerCase()); };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'latest.json'), 'utf8'));
    for (const p of [...(j.projects || []), ...(j.archived_projects || [])]) {
      addName(p && p.name); addName(p && p.id);
      if (p && typeof p.path === 'string') addName(path.basename(p.path.replace(/[\\/]+$/, '')));
    }
  } catch { /* no scan data on this machine: the list just gets shorter */ }
  try {
    for (const f of fs.readdirSync(path.join(repo, 'projects'))) if (f.endsWith('.md')) addName(f.slice(0, -3));
  } catch { /* no projects folder */ }
  return [...names];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Denylist hits in text. Two rules:
 *  - a local name occurs as a whole token  → reported as '(a local project name)' (never echoed)
 *  - a quoted slug literal ('xxxxx', 5+ chars) is part of a local name (the design abbreviated
 *    a real name) → reported by the DESIGN token, which is already in the design file.
 */
export function denylistHits(text, names) {
  const hits = [];
  if (names.some((n) => new RegExp('(^|[^a-z0-9_-])' + esc(n) + '($|[^a-z0-9_-])', 'i').test(text))) hits.push('(a local project name)');
  const toks = new Set([...String(text).matchAll(/'([a-z0-9][a-z0-9_.-]{4,})'/gi)].map((m) => m[1].toLowerCase()));
  for (const t of toks) if (names.some((n) => n.includes(t))) hits.push(t);
  return hits;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Copy + patch + check. Returns the manifest (also written to out/honesty-manifest.json). */
export function run({ src, outro = DEFAULT_OUTRO, site = WORK_SITE, outDir = OUT_DIR, repo = REPO, log = console.log } = {}) {
  if (!src) throw new Error('honesty-patch: --src <design export dir> is required');
  if (outro != null) outro = checkOutro(outro);
  const srcDir = path.resolve(src);
  const missing = Object.keys(FILES).filter((f) => !fs.existsSync(path.join(srcDir, f)));
  if (missing.length) throw new Error('honesty-patch: missing in ' + srcDir + ': ' + missing.join(', '));

  const text = {}, sources = {};
  for (const [from, to] of Object.entries(FILES)) {
    const buf = fs.readFileSync(path.join(srcDir, from));
    sources[from] = sha256(buf);
    text[to] = buf.toString('utf8');
  }
  const names = loadDenylist(repo);
  const before = new Set(CONTENT_FILES.flatMap((f) => denylistHits(text[f], names)));

  const patches = patchList({ outro });
  const applied = [];
  for (const p of patches) {
    text[p.file] = applyPatch(text[p.file], p);
    applied.push({ id: p.id, file: p.file, matches: 1, why: p.why });
  }
  const after = CONTENT_FILES.flatMap((f) => denylistHits(text[f], names).map((h) => f + ': ' + h));
  if (after.length) throw new Error('honesty-patch: content still matches local project names → ' + after.join('; ') + ' — add a positional patch for it');
  for (const f of ['hq-trailer.jsx', 'hq-trailer2.jsx']) {
    if (/sk_live_|vault:\/\/|history scrubbed|rotated → vault/.test(text[f])) throw new Error('honesty-patch: secret/vault wording survived in ' + f);
  }

  // fresh work copy (only ever our own .work/site folder)
  if (path.basename(site) !== 'site' || !site.includes(path.join('trailer', '.work'))) throw new Error('honesty-patch: refusing to clear unexpected dir ' + site);
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  for (const [name, t] of Object.entries(text)) fs.writeFileSync(path.join(site, name), t);

  const manifest = {
    at: new Date().toISOString(),
    sources,
    outro,
    patches: applied,
    denylist: { names: names.length, hitsBeforePatch: before.size, hitsAfterPatch: 0 },
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'honesty-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`[honesty-patch] ${applied.length} patches applied exactly once → ${site}`);
  log(`[honesty-patch] denylist: ${names.length} local names, ${before.size} hit(s) before patching, 0 after`);
  return manifest;
}

function argOf(argv, key) {
  const i = argv.indexOf(key);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(key + '='));
  return eq ? eq.slice(key.length + 1) : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    run({ src: argOf(argv, '--src') || process.env.HQ_TRAILER_SRC, outro: argOf(argv, '--outro') ?? DEFAULT_OUTRO });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
