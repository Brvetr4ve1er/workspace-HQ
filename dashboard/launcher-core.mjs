// The Launcher's pure rules (plan batch 9, dish "launcher core and IO"). No file system, no process, no clock: launcher.js does the IO.
//
//   checkPath(p)                        -> { ok:true } | { ok:false, why }       an absolute, already-normalised drive-letter path and nothing else
//   validateEntry({ kind, path|url }, { fixedDrive? }) -> { ok:true, kind, target, name, host? } | { ok:false, why }
//   checkUrl(text)                      -> { ok:true, url, host } | { ok:false, why }
//   parseShortcut(text)                 -> the value of the first URL= line of an internet shortcut file (4 KB are read at most) or null
//   folderArg(folder, { terminal })     -> { ok:true } | { ok:false, why }       the folder as an argument to an editor or a terminal
//   signEntry / verifyEntry             HMAC of the fields that decide what a launch does
//   buildLine(steps)                    -> the ONE inline sentence line an Open workspace click answers with
// Every refusal is a fixed sentence from WHY. Nothing here builds a command line.
import path from 'node:path';
import crypto from 'node:crypto';

export const KINDS = Object.freeze(['folder', 'file', 'app', 'url']);
export const MAX_ENTRIES = 40;
export const ID_RE = /^[a-z0-9]{8,16}$/;
export const PROJECT_ID_RE = /^[a-z0-9._-]{1,64}$/;
export const MAX_PATH = 259;
export const SHORTCUT_BYTES = 4096;
export const MAX_URL = 2000;

// programs that run other programs: never launchable as an App entry or as the editor
export const DENY_EXE = Object.freeze(['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec', 'bash', 'wsl', 'msbuild']);
// a File entry opens through the system's own handler, so only documents and media qualify
export const DOC_EXT = Object.freeze(['txt', 'md', 'rtf', 'pdf', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mkv', 'mov', 'webm', 'avi']);
export const REFUSED_EXT = Object.freeze(['exe', 'bat', 'cmd', 'ps1', 'lnk', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'msi', 'scr', 'reg', 'jar', 'url', 'com', 'cpl', 'msc', 'inf']);
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'clock$', ...Array.from({ length: 9 }, (_, i) => 'com' + (i + 1)), ...Array.from({ length: 9 }, (_, i) => 'lpt' + (i + 1))]);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export const WHY = Object.freeze({
  notPath: 'that is not a full path on a drive',
  network: 'network and device paths are not allowed',
  odd: 'the path is not written in its plain form',
  stream: 'a path with a hidden stream is not allowed',
  shortName: 'a short 8.3 name is not allowed',
  trailing: 'a name that ends in a dot or a space is not allowed',
  reserved: 'a reserved Windows name is not allowed',
  root: 'pick a folder, not a whole drive',
  drive: 'only a drive built into this computer is allowed',
  kind: 'that kind of entry does not exist',
  notExe: 'an app must be an .exe file',
  denied: 'that program runs other programs, so it cannot be added',
  program: 'that is a program or script, add programs under App',
  notDoc: 'only documents, pictures, audio and video can be opened this way',
  url: 'a link must be https, or http to this computer, without a login in it',
  shortcut: 'that internet shortcut has no usable address',
});

const isStr = (x) => typeof x === 'string';
const lower = (s) => s.toLowerCase();
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? lower(name.slice(i + 1)) : ''; };

export function checkPath(p) {
  if (!isStr(p) || !p || p.length > MAX_PATH) return { ok: false, why: WHY.notPath };
  if (/[\u0000-\u001f\u007f]/.test(p)) return { ok: false, why: WHY.odd };
  if (p.startsWith('\\\\') || p.startsWith('//')) return { ok: false, why: WHY.network };
  if (!/^[A-Za-z]:\\/.test(p)) return { ok: false, why: WHY.notPath };
  if (/[<>"|?*]/.test(p)) return { ok: false, why: WHY.odd };
  if (p.indexOf(':', 2) !== -1) return { ok: false, why: WHY.stream };
  if (p !== path.win32.normalize(p)) return { ok: false, why: WHY.odd };
  const segs = p.slice(3).split('\\');
  if (segs.length === 1 && segs[0] === '') return { ok: false, why: WHY.root };
  for (const s of segs) {
    if (!s) return { ok: false, why: WHY.odd };
    if (/[. ]$/.test(s)) return { ok: false, why: WHY.trailing };
    if (/~\d/.test(s)) return { ok: false, why: WHY.shortName };
    const stem = lower(s.split('.')[0].replace(/ +$/, ''));
    if (RESERVED.has(stem)) return { ok: false, why: WHY.reserved };
  }
  return { ok: true };
}

export const baseName = (p) => path.win32.basename(p);
export const driveOf = (p) => (isStr(p) && /^[A-Za-z]:/.test(p) ? p[0].toUpperCase() : '');

export function checkUrl(text) {
  if (!isStr(text) || !text || text.length > MAX_URL || /[\u0000-\u001f\u007f\s]/.test(text)) return { ok: false, why: WHY.url };
  let u;
  try { u = new URL(text); } catch { return { ok: false, why: WHY.url }; }
  if (u.username || u.password) return { ok: false, why: WHY.url };
  const host = u.hostname;
  if (u.protocol === 'https:') { /* any host */ } else if (u.protocol === 'http:' && LOOPBACK.has(host)) { /* this computer only */ } else return { ok: false, why: WHY.url };
  if (!host) return { ok: false, why: WHY.url };
  return { ok: true, url: u.href, host: u.host };
}

export function parseShortcut(text) {
  if (!isStr(text)) return null;
  const m = /^URL=(.*)$/im.exec(text.slice(0, SHORTCUT_BYTES));
  const v = m ? m[1].trim() : '';
  return v || null;
}

// An entry as stored or as just picked. `fixedDrive(letter)` is how the caller says which drives are built in (the IO asks the system);
// without it every drive passes, which is only for pure tests.
export function validateEntry(entry, { fixedDrive = () => true } = {}) {
  if (!entry || typeof entry !== 'object' || !KINDS.includes(entry.kind)) return { ok: false, why: WHY.kind };
  const kind = entry.kind;
  if (kind === 'url') {
    const r = checkUrl(entry.url);
    return r.ok ? { ok: true, kind, target: r.url, name: r.host, host: r.host } : r;
  }
  const c = checkPath(entry.path);
  if (!c.ok) return c;
  if (!fixedDrive(driveOf(entry.path))) return { ok: false, why: WHY.drive };
  const name = baseName(entry.path);
  const ext = extOf(name);
  if (kind === 'app') {
    if (ext !== 'exe') return { ok: false, why: WHY.notExe };
    if (DENY_EXE.includes(lower(name.slice(0, -4)))) return { ok: false, why: WHY.denied };
    return { ok: true, kind, target: entry.path, name: name.slice(0, -4) || name };
  }
  if (kind === 'file') {
    if (REFUSED_EXT.includes(ext)) return { ok: false, why: WHY.program };
    if (!DOC_EXT.includes(ext)) return { ok: false, why: WHY.notDoc };
  }
  return { ok: true, kind, target: entry.path, name };
}

// An editor must pass the app rules.
export const isEditorOk = (entry, opts) => !!entry && entry.kind === 'app' && validateEntry(entry, opts).ok;

// The folder as ONE argument. Windows Terminal reads ';' as a command separator and '%' can expand, so the terminal is stricter.
export function folderArg(folder, { terminal = false } = {}) {
  const c = checkPath(folder);
  if (!c.ok) return { ok: false, why: 'path' };
  if (folder.startsWith('-')) return { ok: false, why: 'path' };
  if (terminal && /[;%]/.test(folder)) return { ok: false, why: 'symbol' };
  return { ok: true };
}

export const newId = (randomBytes = crypto.randomBytes) => randomBytes(6).toString('hex');
const canonical = (e) => JSON.stringify([e.id, e.kind, e.kind === 'url' ? e.url : e.path, e.name, e.addedAt]);
export const signEntry = (key, e) => crypto.createHmac('sha256', key).update(canonical(e)).digest('hex');
export function verifyEntry(key, e) {
  if (!key || !e || !isStr(e.sig) || !/^[0-9a-f]{64}$/.test(e.sig)) return false;
  const want = Buffer.from(signEntry(key, e), 'hex'), got = Buffer.from(e.sig, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---- the answer of an Open workspace click: steps run dev, editor, terminal; each is one fixed (step, state) pair ----------------
export const STEPS = Object.freeze(['dev', 'editor', 'terminal']);
export const STATES = Object.freeze({
  dev: ['started', 'running', 'unconfirmed', 'refused', 'busy', 'none', 'skipped'],
  editor: ['opened', 'none', 'failed', 'skipped'],
  terminal: ['opened', 'skipped', 'failed'],
});
export const SENTENCES = Object.freeze({
  dev: { started: 'Dev server: started', running: 'Dev server: already running', unconfirmed: 'Dev server: not allowed yet. Press Allow and run', refused: "Dev server: can't run this command. Start it in the terminal", busy: 'Dev server: too many starts this hour', none: 'Dev server: no command scanned for this project', skipped: '' },
  editor: { opened: 'Editor: opened', none: 'Editor: none chosen. Pick one in Settings > Launcher', failed: "Editor: didn't open. Check the editor in Settings > Launcher", skipped: '' },
  terminal: { opened: 'Terminal: opened', skipped: "Terminal: skipped, the folder name has a symbol Windows Terminal can't take", failed: "Terminal: didn't open. Open one yourself at the folder" },
});
export const FOLDER_MISSING = 'Folder not found. Scan again from Home, or check the folder is still there.';
export const FOLDER_LINK = 'This folder is reached through a link, so Open workspace will not use it. Open the folder directly.';
export const FOLDER_ODD = 'This folder has a name Open workspace cannot pass on safely. Rename it, then scan again.';

export function stepsOk(steps) {
  return Array.isArray(steps) && steps.some((s) => s && ((s.step === 'dev' && (s.state === 'started' || s.state === 'running')) || (s.step === 'editor' && s.state === 'opened') || (s.step === 'terminal' && s.state === 'opened')));
}
// the fixed words of a step list, only names from the tables above (this is what the audit line and the screen both use)
export function stepWords(steps) {
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) if (s && STATES[s.step] && STATES[s.step].includes(s.state)) out.push(s.step + ':' + s.state);
  return out.join(' ');
}
export function buildLine(steps, folderMissing = false) {
  if (folderMissing) return FOLDER_MISSING;
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    const t = s && SENTENCES[s.step] ? SENTENCES[s.step][s.state] : '';
    if (t) out.push(t + '.');
  }
  return out.join(' ');
}
// the dev step reads dev-command's fixed answer words
export const DEV_WORDS = Object.freeze({ started: 'started', running: 'running', unconfirmed: 'unconfirmed', refused: 'refused', busy: 'busy' });
