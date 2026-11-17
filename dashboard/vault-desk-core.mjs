// The Vault desk, pure half (Life > Notes; plan batch 8, dish 3). No file, no process, no clock of its own: text and dates in, plain answers out.
//
//   formatDate(date, fmt)              -> a date written with the daily-note format tokens (YYYY YY MMMM MMM MM M DD D dddd ddd d, [literal])
//   parseDailySettings(raw, appRaw?)   -> { folder, format, fromSettings, ignored, source }   raw is the text (or object) of .obsidian/daily-notes.json, appRaw the same for
//                                         .obsidian/app.json, both UNTRUSTED. source: 'daily-notes' | 'vault-new-notes' | 'vault-top' (where the folder came from)
//   pathOk(rel)                        -> boolean   one relative path inside a vault: forward slashes, no .., no drive, no trailing dot or space, ends .md
//   planNotePath(settings, date)       -> { rel, folder, name } | { error: 'path' }
//   normalizeLine(raw)                 -> { line } | { error: 'empty' | 'long' }   control characters collapsed, wq: broken, %% broken, a leading marker escaped
//   planAppend(existing, line)         -> { add }   the exact text to add at the end of the note (nothing is ever rewritten)
//   sortRecent(entries, n)             -> [{ name, mtimeMs }]   newest first, at most n, names without .md
//
// Where today's note is looked for follows Obsidian's own rule. A folder named in daily-notes.json wins; a blank one means "the vault's folder for
// new notes", which is app.json newFileLocation: "folder" + newFileFolderPath, or "root" / absent = the top of the vault. "current" (next to the
// open note) is something the app cannot know, so it falls through to the top of the vault. No folder name of the app's own is ever invented.
//
// Trust. The two settings files are somebody else's text: a folder or format that is not a plain relative path made only of safe names is ignored
// and the next step is used (the card says so). A note's text is shown as plain text and used for nothing else.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { safeSegment } = require('./claude-vault.js');

export const DEFAULT_FORMAT = 'YYYY-MM-DD';
export const READ_MAX = 20480;        // bytes of today's note shown
export const LINE_MAX = 1000;         // characters one capture may have
export const NOTE_APPEND_MAX = 2e6;   // a note bigger than this is left alone
export const RECENT_MAX = 12;
const FORMAT_MAX = 60;
const FOLDER_MAX = 120;
const SETTINGS_MAX = 20000;   // characters of either settings file that are read; more is treated as unusable
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// tokens first, longest first; [text] is copied as it is
export function formatDate(date, fmt = DEFAULT_FORMAT) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(0);
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate(), w = d.getDay();
  const table = {
    YYYY: String(y).padStart(4, '0'), YY: String(y % 100).padStart(2, '0'), MMMM: MONTHS[m], MMM: MONTHS[m].slice(0, 3), MM: pad2(m + 1), M: String(m + 1),
    DD: pad2(day), D: String(day), dddd: DAYS[w], ddd: DAYS[w].slice(0, 3), d: String(w),
  };
  const re = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|d/g;
  return String(fmt).replace(re, (tok, lit) => (lit !== undefined ? lit : table[tok]));
}

// a path segment that safeSegment would leave exactly as it is (nothing illegal, no leading dot, no trailing dot or space, not a DOS name)
const segOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 100 && s === safeSegment(s, '\u0000') && !s.includes('\u0000');

export function pathOk(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 300) return false;
  if (/[\\:\u0000-\u001f]/.test(rel) || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || /[.\s]$/.test(p))) return false;
  const last = parts[parts.length - 1];
  if (!/\.md$/i.test(last)) return false;
  const stem = last.slice(0, -3);
  if (!segOk(stem)) return false;
  return parts.slice(0, -1).every(segOk);
}

const folderOk = (f) => f === '' || (typeof f === 'string' && f.length <= FOLDER_MAX && !/[\\:\u0000-\u001f]/.test(f) && !f.startsWith('/') && f.split('/').every(segOk));

// the text (or object) of one settings file -> { j, ignored }: j is a plain object, or null when there is nothing usable
function settingsObject(raw) {
  let j = raw;
  if (typeof raw === 'string') {
    if (raw.length > SETTINGS_MAX) return { j: null, ignored: true };
    try { j = JSON.parse(raw); } catch { j = null; }
  }
  if (j === null || j === undefined) return { j: null, ignored: false };
  if (!isObj(j)) return { j: null, ignored: true };
  return { j, ignored: false };
}

// a folder value from a settings file: { folder } when it is a safe relative folder (possibly blank), { bad: true } when it is not
function folderValue(v) {
  if (typeof v !== 'string') return { bad: true };
  const f = v.trim().replace(/\/+$/, '');
  return folderOk(f) ? { folder: f } : { bad: true };
}

export function parseDailySettings(raw, appRaw) {
  const d = settingsObject(raw);
  const a = settingsObject(appRaw);
  let ignored = d.ignored || a.ignored, format = DEFAULT_FORMAT, used = false;
  let folder = '', source = 'vault-top';
  const j = d.j || {};
  if (j.folder !== undefined) {
    const r = folderValue(j.folder);
    if (r.bad) ignored = true;
    else if (r.folder) { folder = r.folder; source = 'daily-notes'; used = true; }   // a blank folder is Obsidian's "use the folder for new notes"
  }
  if (typeof j.format === 'string' && j.format.trim()) {
    const f = j.format.trim();
    // a format must produce something: at least one date token outside the [literal] parts
    const bare = f.replace(/\[[^\]]*\]/g, '');
    if (f.length <= FORMAT_MAX && /YYYY|YY|MM|M|DD|D|d/.test(bare)) { format = f; used = true; } else ignored = true;
  } else if (j.format !== undefined && j.format !== '') ignored = true;
  if (source === 'vault-top' && a.j && a.j.newFileLocation === 'folder') {
    const r = folderValue(a.j.newFileFolderPath === undefined ? '' : a.j.newFileFolderPath);
    if (r.bad) ignored = true;
    else if (r.folder) { folder = r.folder; source = 'vault-new-notes'; }
  }
  return { folder, format, fromSettings: used, ignored, source };
}

export function planNotePath(settings, date) {
  const s = isObj(settings) ? settings : parseDailySettings(null);
  const name = formatDate(date, typeof s.format === 'string' ? s.format : DEFAULT_FORMAT) + '.md';
  const folder = typeof s.folder === 'string' ? s.folder : '';
  const rel = folder ? folder + '/' + name : name;
  if (!folderOk(folder) || !pathOk(rel)) return { error: 'path' };
  return { rel, folder, name };
}

// "- " plus the line. What a capture may never be: a ticked box the quest sync would read (daily-notes-watch tickedIds reads a line that
// starts with an optional - or >, an optional - or *, then [x] and has wq:<id>), a wq: id, or a %% that could swallow the block below it.
export function normalizeLine(raw) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();   // \s also takes U+2028 and U+2029
  if (!s) return { error: 'empty' };
  if ([...s].length > LINE_MAX) return { error: 'long' };
  s = s.replace(/wq\s*:/gi, 'wq :').replace(/%%/g, '% %');
  // a code fence (three or more ` or ~) and an HTML comment opener would swallow every later line of the note: break them with a backslash
  s = s.replace(/`{3,}|~{3,}/g, (m) => [...m].map((c) => String.fromCharCode(92) + c).join('')).replace(/<!--/g, '<' + String.fromCharCode(92) + '!--');
  if (/^[\[>*-]/.test(s)) s = String.fromCharCode(92) + s;   // a leading [ > - or * can never start a task marker
  return { line: '- ' + s };
}

const lastHeading = (text) => {
  let last = null;
  for (const l of String(text).split(/\r?\n/)) { const m = /^\s{0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(l); if (m) last = m[1].trim(); }
  return last;
};

// text to add at the very end of the note: a newline first if the note does not end with one, a "Captured" heading only when the last
// heading is not already Captured, then the line.
export function planAppend(existing, line) {
  const cur = typeof existing === 'string' ? existing : '';
  let add = '';
  if (cur && !/\n$/.test(cur)) add += '\n';
  if ((lastHeading(cur) || '').toLowerCase() !== 'captured') {
    if (cur && !/\n\n$/.test(cur + add)) add += '\n';
    add += '## Captured\n\n';
  }
  return { add: add + line + '\n' };
}

export function sortRecent(entries, n = RECENT_MAX) {
  const rows = (Array.isArray(entries) ? entries : []).filter((e) => isObj(e) && typeof e.name === 'string' && e.name && Number.isFinite(e.mtimeMs));
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.slice(0, Math.max(0, n)).map((e) => ({ name: e.name.replace(/\.md$/i, '').slice(0, 100), mtimeMs: e.mtimeMs }));
}
