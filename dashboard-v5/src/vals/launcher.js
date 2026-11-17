// Settings > Launcher render values, and the project page's Open workspace button (pg.workspace). EVERY Settings value rides under ONE top-level key,
// lnchv (renderVals stays one key higher, not a block of lnch* keys); the template reads {{ lnchv.show }} and friends. The list arrives finished from
// main (dashboard/launcher.js -> hq:launcher:read, held by logic/launcher.js in state.lnch); this module only words it.
//
// renderVals runs every surface on every machine push, so while Settings is closed this returns a frozen constant: nothing is read, nothing is built.
// The key set of lnchv is the same in every state, so the template never meets an undefined. Honest states: no bridge - loading - error with no list held
// (Retry) - locked (the list cannot be kept) - empty list - ready - ready with a later error or notice (the last list stays).
//
// The command text beside an allowed-command row is the scan's own text for that project (the renderer already holds it); the state beside it is main's.
import { LNCH_OFF, KINDS, KIND_ICON, KIND_WORD, ADD_LABEL, LOCKED_TEXT } from '../logic/launcher.js';
import { REFUSED_TEXT, ALLOW_NOTE } from '../logic/dev-allow.mjs';

export const LNCH_TITLE = 'Launcher · your folders, files, apps and links';
export const LNCH_NOTE = 'Every add opens the system dialog; nothing is guessed. A file opens only if it is a document, picture, audio or video, an app only if you picked its .exe, a link only if it is https. Open workspace on a project page starts its dev server (if you allowed the command), opens your editor and a terminal at the project folder.';
export const CMDS_NOTE = 'A command runs only after you allow it, and only the project’s own scripts. Changing the command, a script it runs or the runner’s settings asks again.';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

const BLANK = Object.freeze({
  show: false, offline: false, offlineText: LNCH_OFF, hasBody: false, title: LNCH_TITLE, note: LNCH_NOTE,
  refresh: () => false, refreshOff: true, refreshLabel: 'Refresh',
  loading: false, loadingText: 'Reading the Launcher…', hasErr: false, errText: '', locked: false, lockedText: LOCKED_TEXT,
  hasNotice: false, notice: '', noticeColor: 'var(--muted)',
  ready: false, summary: '', entries: [], hasEntries: false, emptyText: 'Nothing added yet. Use a button below; the system dialog opens and you pick.',
  adds: [], addsOff: true,
  editorTitle: 'My editor', editorText: '', hasEditor: false, editorHint: '',
  terminalTitle: 'My terminal', terminalText: '',
  cmdsTitle: 'Allowed commands', cmdsNote: CMDS_NOTE, cmds: [], hasCmds: false, cmdsEmpty: 'No project has a scanned dev command.',
});
const OFF_V = Object.freeze({ lnchv: BLANK });

const KIND_NOTE = { folder: 'Folder', file: 'File', app: 'App', url: 'Link' };

export function launcherVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!S.settingsOpen) {
    if (!S.paletteOpen && typeof this.lnchRearm === 'function') this.lnchRearm();   // both closed: the next opening reads fresh
    return OFF_V;
  }
  const can = typeof this.lnchCan === 'function' ? this.lnchCan() : false;
  if (!can) return { lnchv: { ...BLANK, show: true, offline: true } };
  if (typeof this.lnchEnsure === 'function') this.lnchEnsure();
  const L = S.lnch || {};
  const data = L.data || null;
  const err = typeof L.error === 'string' ? L.error : '';
  const busy = !!L.busy;
  const refresh = () => this.lnchLoad();
  const base = { ...BLANK, show: true, hasBody: true, refresh, refreshOff: busy, refreshLabel: busy ? 'Reading…' : err && !data ? 'Retry' : 'Refresh' };
  const notice = typeof L.notice === 'string' ? L.notice : '';
  const noticeBits = { hasNotice: !!notice, notice, noticeColor: L.noticeBad ? 'var(--orange)' : 'var(--muted)' };
  if (!data) return { lnchv: { ...base, loading: !err, hasErr: !!err, errText: err ? 'Couldn’t read the Launcher · ' + err : '', ...noticeBits } };

  const entries = data.entries.map((e) => ({
    key: e.id, id: e.id, icon: KIND_ICON[e.kind], kindText: KIND_NOTE[e.kind], name: e.name, host: e.host, hasHost: !!e.host && e.kind === 'url',
    isApp: e.kind === 'app', isEditor: e.id === data.editor, off: busy, editorOff: busy || e.id === data.editor,
    open: () => this.lnchOpen(e.id), remove: () => this.lnchRemove(e.id), setEditor: () => this.lnchSetEditor(e.id),
    openLabel: 'Open', removeLabel: 'Remove', editorLabel: e.id === data.editor ? 'My editor' : 'Use as my editor',
    openAria: 'Open ' + e.name, removeAria: 'Remove ' + e.name + ' from the Launcher', editorAria: (e.id === data.editor ? 'My editor: ' : 'Use as my editor: ') + e.name,
  }));
  const ed = data.entries.find((e) => e.id === data.editor) || null;
  const byId = new Map((typeof this.projectsAt === 'function' ? this.projectsAt(0) : []).map((p) => [p.id, p]));
  const cmds = data.projects.filter((p) => p.dev !== 'none').map((p) => {
    const text = (byId.get(p.id) && byId.get(p.id).dev) || '';
    const allowed = p.dev === 'allowed', refused = p.dev === 'refused';
    return {
      key: p.id, id: p.id, name: p.name, text: text || '(the scan has no text for this command)', allowed, refused, canAllow: p.dev === 'unconfirmed' && !!text,
      stateText: allowed ? 'Allowed' : refused ? REFUSED_TEXT : 'Not allowed yet', stateColor: allowed ? 'var(--green)' : refused ? 'var(--orange)' : 'var(--muted)',
      allowLabel: 'Allow this command', forgetLabel: 'Remove permission', off: busy,
      allowAria: 'Allow this command: ' + p.name, forgetAria: 'Remove permission: ' + p.name,
      allow: () => this.lnchAllow(p.id, text), forget: () => this.lnchForget(p.id), note: ALLOW_NOTE,
    };
  });
  const adds = KINDS.map((k) => ({ key: k, kind: k, label: ADD_LABEL[k], off: busy || data.locked || data.entries.length >= data.limit, go: () => this.lnchAdd(k), aria: ADD_LABEL[k] + ' (opens a system dialog)' }));
  return {
    lnchv: {
      ...base, ...noticeBits,
      hasErr: !!err, errText: err ? 'Couldn’t refresh the Launcher · ' + err + ' · the last list stays on screen' : '',
      locked: data.locked, ready: !data.locked,
      summary: data.locked ? '' : plural(data.entries.length, 'entry', 'entries') + ' of ' + data.limit,
      entries, hasEntries: entries.length > 0, adds, addsOff: busy || data.locked,
      hasEditor: !!ed, editorText: ed ? ed.name : 'No editor chosen. Add your editor with Add app, then press Use as my editor beside it.', editorHint: 'Open workspace opens your editor at the project folder.',
      terminalText: data.terminal === 'wt' ? 'Windows Terminal (found)' : 'The Windows console (Windows Terminal was not found)',
      cmds, hasCmds: cmds.length > 0,
    },
  };
}

// The project page's Open workspace button: { on, label, busy, line } and nothing else (the dev step's own Allow and run is the page's existing dev button).
export function workspaceVals(p) {
  const L = (this.state && this.state.lnch) || {};
  const w = (L.ws && L.ws[p.id]) || {};
  const can = typeof this.lnchCanWorkspace === 'function' && this.lnchCanWorkspace();
  const busy = !!w.busy;
  return {
    on: can, // stays enabled while busy: a button that turns disabled under focus drops keyboard focus; lnchWorkspace ignores a second click
    label: busy ? 'Opening…' : '⌂ Open workspace',
    busy,
    line: typeof w.line === 'string' && w.line ? w.line : !can ? 'Open workspace needs the desktop app' : '',
  };
}
