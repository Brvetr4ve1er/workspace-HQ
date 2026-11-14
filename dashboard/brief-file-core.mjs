// The phone file's text and rules (batch 6, dish phone-file). PURE: no clock, no env; `now` is passed in. The only IO is the folder check, which
// takes an injected `fsApi` (default node:fs) so tests can run on a temp folder.
//
//   fileText(brief, { now, firstSeen }) → string       the whole file (always ends with a newline, at most MAX_CHARS characters)
//   bodyOf(text) → string                              the text minus its first (time) line: what "changed" is judged on
//   refuseFolder(folder, { repoRoot, fsApi?, platform? }) → { ok:true, folder } | { ok:false, reason }
//   folderNameOf(folder) → the last path segment only ('' when none)
//   briefFileRow({ state, unreadable }, now) → the Reach row (id 'brief-file') for dashboard/reach.js
//   normalizeState(raw) → { v:1, folder, lastWriteAt, lastError }   (a state file that cannot be used reads as OFF)
//
// Everything the file SAYS comes from the screen-safe projection (brief-project.mjs: fixed wording per rule id, counts, a date): the same words the
// tray shows, line for line, with " - " where the tray has " · ". No name, path, amount, id, ref, rule id or "why" text can get in, because none of
// them is in the projection. A brief 30 minutes old or more says so and lists no items (like tools/brief-lines.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { projectBrief } from './brief-project.mjs';
import { FRESH_MS, folderNameOf, normalizeState, ACTIONS, briefFileRow } from './brief-file-row.mjs';

// the Reach row and its helpers live in brief-file-row.mjs (no imports beyond node:path); re-exported so every caller keeps one door
export { FRESH_MS, folderNameOf, normalizeState, ACTIONS, briefFileRow };

export const FILE_NAME = 'workspacehq-brief.txt';
export const STATE_NAME = '.brief-file.json';
export const MAX_CHARS = 600;
export const ROWS_MAX = 3;
export const LABEL_MAX = 64;
export const REWRITE_MS = 10 * 60e3;    // an unchanged brief is still rewritten after this, so the time on the first line stays true
export const HEADER = 'WorkspaceHQ brief - ';

const pad = (n) => String(n).padStart(2, '0');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const nowMs = (n) => (n instanceof Date ? n.getTime() : typeof n === 'number' && Number.isFinite(n) ? n : 0);
const hhmmOf = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : null; };
const hhmmIso = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? hhmmOf(t) : null; };
const clip = (s, n) => { const c = [...String(s)]; return c.length <= n ? c.join('') : c.slice(0, n - 1).join('') + '…'; };
const plain = (s) => String(s).replace(/ · /g, ' - ');

function ageWords(min) {
  if (!Number.isFinite(min) || min < 0) return 'time unknown';
  if (min < 120) return Math.floor(min) + ' min';
  if (min < 48 * 60) return Math.floor(min / 60) + ' h';
  return Math.floor(min / 1440) + ' days';
}

// the quiet line (brief-unclog, may not have landed): only the projection's fixed wording, and only when it still looks like plain words
const QUIET_OK = /^[A-Za-z0-9 ,.'’-]{1,100}$/;
function quietText(p) {
  const q = p && isObj(p.quiet) ? p.quiet : null;
  return q && typeof q.text === 'string' && QUIET_OK.test(q.text) ? q.text : null;
}

export function fileText(brief, { now, firstSeen } = {}) {
  const t = nowMs(now);
  const head = HEADER + (hhmmOf(t) || '--:--');
  let p = null;
  try { p = projectBrief(brief, { now: t, firstSeen }); } catch { p = null; }
  if (!p) return head + '\nBrief not ready yet\n';
  if (p.stale) {
    const when = p.ageMinutes === null ? 'time unknown' : ageWords(p.ageMinutes) + ' ago';
    return head + '\nBrief out of date - last updated ' + when + ' (the app may be closed)\n';
  }
  // the same status line the tray builds (tray-brief.js view())
  const total = p.items.length + p.more;
  const newCount = p.items.concat(p.overflow).filter((x) => x.isNew).length;
  const gen = hhmmIso(p.generatedAt);
  const from = 'from the ' + (gen || 'earlier') + ' brief';
  const srcs = p.errorSources;
  const incomplete = "Brief incomplete · couldn't read " + srcs.slice(0, 2).join(', ') + (srcs.length > 2 ? ' and ' + (srcs.length - 2) + ' more' : '');
  let statusLine, noteLine = null;
  if (total > 0) {
    statusLine = ['Needs you', total].concat(newCount ? [newCount + ' new'] : [], [gen || from]).join(' · ');
    if (srcs.length) noteLine = incomplete;
  } else if (srcs.length) statusLine = incomplete;
  else statusLine = (p.standing ? 'Nothing new' : 'Nothing needs you') + ' · ' + from;
  const lines = [statusLine];
  if (noteLine) lines.push(noteLine);
  for (const x of p.items.slice(0, ROWS_MAX)) lines.push(clip([x.sevWord].concat(x.isNew ? ['new'] : [], [x.text]).join(' · '), LABEL_MAX));
  if (p.overflowLine) lines.push(clip(p.overflowLine, LABEL_MAX));
  if (p.standing) lines.push(p.standing.line);
  const q = quietText(p);
  if (q) lines.push('quiet · ' + q);
  const all = lines.map(plain);
  // at most MAX_CHARS: the status line stays, the least important lines go first
  let text = head + '\n' + all.join('\n') + '\n';
  while (text.length > MAX_CHARS && all.length > 1) { all.pop(); text = head + '\n' + all.join('\n') + '\n'; }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + '\n';
  return text;
}

export function bodyOf(text) {
  const s = String(text);
  const i = s.indexOf('\n');
  return i < 0 ? '' : s.slice(i + 1);
}

const norm = (p, platform) => (platform === 'win32' ? p.toLowerCase() : p);

export function refuseFolder(folder, { repoRoot, fsApi = fs, platform = process.platform } = {}) {
  const no = (reason) => ({ ok: false, reason });
  if (typeof folder !== 'string' || !folder.trim()) return no('No folder was given');
  if (!path.isAbsolute(folder)) return no('The folder must be a full path');
  let real;
  try {
    const st = fsApi.statSync(folder);
    if (!st.isDirectory()) return no('That is not a folder');
    real = fsApi.realpathSync(path.resolve(folder));
  } catch { return no('That folder does not exist'); }
  const parsed = path.parse(real);
  if (real === parsed.root || path.resolve(real) === parsed.root) return no('A drive root is not a good place for it - pick a folder');
  if (typeof repoRoot === 'string' && repoRoot) {
    let repo;
    try { repo = fsApi.realpathSync(path.resolve(repoRoot)); } catch { repo = path.resolve(repoRoot); }
    const rel = path.relative(norm(repo, platform), norm(real, platform));
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return no('Pick a folder outside the WorkspaceHQ project');
  }
  return { ok: true, folder: real };
}

