// The Launcher, renderer side (batch 9, dish "launcher screens"): Settings > Launcher, the project page's Open workspace and the palette rows.
// Main owns everything that matters (dashboard/launcher.js -> hq:launcher:{read,add,remove,set-editor,open,open-workspace}: the signed list, the
// dialogs, every check, every launch, the act mark). This file only asks, holds the last answer, says main's fixed words in plain sentences, and
// forwards a click. It never builds a path, a command or an argument, and it sends NO usage mark (main writes the one act, 'launcher-workspace').
// Component.prototype mixin (src/app.js: launcherLogic): same `this` as the class methods.
//
// State is ONE object, `lnch` (a missing `lnch` reads as the initial one):
//   { data: null | { entries, editor, projects, terminal, locked, limit }, loaded, busy, error, notice, noticeBad, ws: { [projectId]: { busy, line } } }
//
// A read happens when Settings OPENS or the palette OPENS (lnchEnsure: once per opening, deferred so no state is set while rendering; closing both
// re-arms it) and after every change. Never at boot. Allowing and removing a permission use the dev-command channels (devAllow / devForget), which
// main checks the same way as the project page's Allow and run.
import { hashShown, REFUSED_TEXT } from './dev-allow.mjs';

export const LNCH_OFF = 'The Launcher needs the desktop app';
export const KINDS = Object.freeze(['folder', 'file', 'app', 'url']);
export const KIND_ICON = Object.freeze({ folder: '▤', file: '▥', app: '▶', url: '↗' });
export const KIND_WORD = Object.freeze({ folder: 'Folder', file: 'File', app: 'App', url: 'Link' });
export const ADD_LABEL = Object.freeze({ folder: 'Add folder', file: 'Add file', app: 'Add app', url: 'Add link' });
export const ID_RE = /^[a-z0-9]{8,16}$/;
export const PROJECT_ID_RE = /^[a-z0-9._-]{1,64}$/;
export const DEV_STATES = Object.freeze(['allowed', 'unconfirmed', 'refused', 'none']);
export const LOCKED_TEXT = 'This computer cannot keep the Launcher list safely, so nothing can be added or shown.';
export const CHANGED_TEXT = 'The scan changed this command. Look at the new one and allow it again.';
export const BUSY_TEXT = 'Too many tries this hour. Try again later.';
export const WS_BUSY_TEXT = 'Too many Open workspace clicks this hour. Try again later.';
export const WS_FAILED_TEXT = 'Open workspace did not work. Nothing was changed.';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const CTRL = /[\u0000-\u001f\u007f-\u009f]+/g;
const str = (x, n) => (typeof x === 'string' ? Array.from(x.replace(CTRL, ' ')).slice(0, n).join('').trim() : '');

export const lnchInit = () => ({ data: null, loaded: false, busy: false, error: '', notice: '', noticeBad: false, ws: {} });

/** main's answer to read, made safe: { ok:true, data } | { ok:false, error }. An entry needs a plain id and a known kind; a project a plain id. */
export function cleanRead(r) {
  if (!isObj(r)) return { ok: false, error: 'no answer' };
  if (typeof r.error === 'string' && r.error) return { ok: false, error: str(r.error, 120) || 'no answer' };
  if (!Array.isArray(r.entries) || !Array.isArray(r.projects)) return { ok: false, error: 'no answer' };
  const entries = r.entries.filter((e) => isObj(e) && typeof e.id === 'string' && ID_RE.test(e.id) && KINDS.includes(e.kind)).slice(0, 40)
    .map((e) => ({ id: e.id, kind: e.kind, name: str(e.name, 100) || KIND_WORD[e.kind], host: str(e.host, 100) }));
  const editor = typeof r.editor === 'string' && entries.some((e) => e.id === r.editor && e.kind === 'app') ? r.editor : null;
  const projects = r.projects.filter((p) => isObj(p) && typeof p.id === 'string' && PROJECT_ID_RE.test(p.id)).slice(0, 200)
    .map((p) => ({ id: p.id, name: str(p.name, 80) || p.id, dev: DEV_STATES.includes(p.dev) ? p.dev : 'none' }));
  return { ok: true, data: { entries, editor, projects, terminal: r.terminal === 'wt' ? 'wt' : 'console', locked: r.locked === true, limit: Number.isFinite(r.limit) && r.limit > 0 ? Math.min(r.limit, 200) : 40 } };
}

/** The sentence for an add answer (main's fixed words). '' = say nothing (the owner closed the dialog). */
export function addText(r, kind) {
  const s = r && typeof r.state === 'string' ? r.state : '';
  if (s === 'added') return { text: (KIND_WORD[kind] || 'Entry') + ' added', bad: false };
  if (s === 'cancelled') return { text: '', bad: false };
  if (s === 'exists') return { text: 'That one is already in the list', bad: false };
  if (s === 'full') return { text: 'The list is full. Remove one first.', bad: true };
  if (s === 'locked') return { text: LOCKED_TEXT, bad: true };
  if (s === 'busy') return { text: BUSY_TEXT, bad: true };
  if (s === 'refused') return { text: 'Not added: ' + (str(r && r.why, 160) || 'main refused it'), bad: true };
  return { text: 'Not added', bad: true };
}

/** The line under Open workspace. main's own sentence when it sent one; fixed words when the call itself was refused. */
export function workspaceLine(r) {
  if (!isObj(r)) return WS_FAILED_TEXT;
  if (r.state === 'busy') return WS_BUSY_TEXT;
  if (r.state === 'refused' || r.state === 'failed') return WS_FAILED_TEXT;
  const line = str(r.line, 400);
  return line || (r.ok === true ? 'Opened.' : WS_FAILED_TEXT);
}
/** True when the answer's dev step said the command is not allowed yet (the project page then offers Allow and run). */
export const devUnconfirmed = (r) => !!(isObj(r) && Array.isArray(r.steps) && r.steps.some((s) => isObj(s) && s.step === 'dev' && s.state === 'unconfirmed'));

export const launcherLogic = {
  lnchCan() { return !!(this.hq && this.hq.launcher && typeof this.hq.launcher.read === 'function'); },
  lnchCanWorkspace() { return !!(this.hq && this.hq.launcher && typeof this.hq.launcher.openWorkspace === 'function'); },
  lnchState() { return (this.state && this.state.lnch) || lnchInit(); },
  _lnchPatch(p) { this.setState((s) => ({ lnch: Object.assign({}, s.lnch || lnchInit(), p) })); },

  /** Called while Settings or the palette is on screen: one read per opening of either. */
  lnchEnsure() {
    if (this._lnchAsked || !this.lnchCan()) return;
    this._lnchAsked = true;
    setTimeout(() => this.lnchLoad(), 0);   // never set state while rendering
  },
  lnchRearm() { this._lnchAsked = false; },

  /** One read at a time; a failed read keeps the last answer and says why. */
  async lnchLoad() {
    if (!this.lnchCan()) return false;
    if (this._lnchReading) return false;
    this._lnchReading = true;
    this._lnchPatch({ busy: true });
    let r;
    try { r = await this.hq.launcher.read(); } catch { r = { error: 'the launcher could not be read' }; } finally { this._lnchReading = false; }
    const c = cleanRead(r);
    if (c.ok) { this._lnchPatch({ data: c.data, loaded: true, busy: false, error: '' }); return true; }
    this._lnchPatch({ loaded: true, busy: false, error: c.error });
    return false;
  },

  _lnchSay(text, bad) { this._lnchPatch({ notice: text || '', noticeBad: !!bad }); },

  // One call at a time for every change; main's answer is the only truth (nothing is shown as done before it says so).
  async _lnchDo(fn) {
    if (this._lnchWorking) return null;
    this._lnchWorking = true;
    this._lnchPatch({ busy: true });
    try { return await fn(); }
    catch { this._lnchSay('That did not work', true); return null; }
    finally { this._lnchWorking = false; this._lnchPatch({ busy: false }); }
  },

  async lnchAdd(kind) {
    if (!KINDS.includes(kind)) return false;
    const api = this.hq && this.hq.launcher;
    if (!api || typeof api.add !== 'function') { this._lnchSay(LNCH_OFF, true); return false; }
    const r = await this._lnchDo(async () => {
      const a = await api.add(kind);
      const t = addText(a, kind);
      this._lnchSay(t.text, t.bad);
      await this.lnchLoad();
      return a;
    });
    return !!(r && r.state === 'added');
  },

  async lnchRemove(id) {
    const api = this.hq && this.hq.launcher;
    if (!api || typeof api.remove !== 'function' || !ID_RE.test(String(id))) return false;
    const r = await this._lnchDo(async () => {
      const a = await api.remove(id);
      const s = a && a.state;
      this._lnchSay(s === 'removed' ? 'Removed' : s === 'busy' ? BUSY_TEXT : s === 'locked' ? LOCKED_TEXT : 'Not removed', s !== 'removed');
      await this.lnchLoad();
      return a;
    });
    return !!(r && r.state === 'removed');
  },

  async lnchSetEditor(id) {
    const api = this.hq && this.hq.launcher;
    if (!api || typeof api.setEditor !== 'function' || !ID_RE.test(String(id))) return false;
    const r = await this._lnchDo(async () => {
      const a = await api.setEditor(id);
      const s = a && a.state;
      this._lnchSay(s === 'set' ? 'Editor chosen' : s === 'refused' ? 'Not chosen: ' + (str(a.why, 160) || 'main refused it') : s === 'busy' ? BUSY_TEXT : 'Not chosen', s !== 'set');
      await this.lnchLoad();
      return a;
    });
    return !!(r && r.state === 'set');
  },

  async lnchOpen(id) {
    const api = this.hq && this.hq.launcher;
    if (!api || typeof api.open !== 'function' || !ID_RE.test(String(id))) return false;
    const r = await this._lnchDo(async () => {
      const a = await api.open(id);
      const s = a && a.state;
      this._lnchSay(s === 'opened' ? 'Opened' : s === 'missing' ? 'It is not there any more. Remove it from the list.' : s === 'busy' ? BUSY_TEXT : s === 'refused' ? 'Not opened: it is no longer what was added' : 'Not opened', s !== 'opened');
      return a;
    });
    return !!(r && r.state === 'opened');
  },

  // "Allow this command" in Settings: the same call as the project page's Allow and run, sending the hash of the text the owner is looking at.
  async lnchAllow(id, text) {
    const api = this.hq && this.hq.devAllow;
    if (typeof api !== 'function' || !PROJECT_ID_RE.test(String(id)) || typeof text !== 'string' || !text) return false;
    const r = await this._lnchDo(async () => {
      const a = await this.hq.devAllow(id, hashShown(text));
      this._lnchSay(a === 'allowed' ? 'Allowed. It runs this project’s own scripts.' : a === 'changed' ? CHANGED_TEXT : a === 'busy' ? BUSY_TEXT : REFUSED_TEXT, a !== 'allowed');
      if (a === 'allowed') this.setState((s) => ({ devAsk: Object.assign({}, s.devAsk || {}, { [id]: null }) }));
      await this.lnchLoad();
      return a;
    });
    return r === 'allowed';
  },

  async lnchForget(id) {
    const api = this.hq && this.hq.devForget;
    if (typeof api !== 'function' || !PROJECT_ID_RE.test(String(id))) return false;
    const r = await this._lnchDo(async () => {
      const a = await this.hq.devForget(id);
      this._lnchSay(a === 'removed' ? 'Permission removed. The next start asks again.' : a === 'none' ? 'There was no permission to remove' : a === 'busy' ? BUSY_TEXT : 'Not removed', a !== 'removed' && a !== 'none');
      await this.lnchLoad();
      return a;
    });
    return r === 'removed';
  },

  // Open workspace: one call per project at a time (a double click is one call). Main runs the dev server, the editor and the terminal in that order and
  // answers { ok, steps, line }; the line is shown as it is. A dev step that says "not allowed yet" leaves the project page's own button on Allow and run.
  async lnchWorkspace(projectId, devText) {
    if (!this.lnchCanWorkspace() || !PROJECT_ID_RE.test(String(projectId))) return null;
    this._lnchWs = this._lnchWs || new Set();
    if (this._lnchWs.has(projectId)) return null;
    this._lnchWs.add(projectId);
    const put = (v) => this.setState((s) => { const l = s.lnch || lnchInit(); return { lnch: Object.assign({}, l, { ws: Object.assign({}, l.ws, { [projectId]: v }) }) }; });
    put({ busy: true, line: '' });
    let r;
    try { r = await this.hq.launcher.openWorkspace(projectId); } catch { r = null; }
    this._lnchWs.delete(projectId);
    put({ busy: false, line: workspaceLine(r) });
    if (devUnconfirmed(r) && typeof devText === 'string' && devText) this.setState((s) => ({ devAsk: Object.assign({}, s.devAsk || {}, { [projectId]: { kind: 'allow', text: devText, hash: hashShown(devText) } }) }));
    return r;
  },
};
