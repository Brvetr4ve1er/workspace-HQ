// Claude sessions: draft one from a task, start it in a project. Canvas "＋ Note".
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';
import { TERM_SKIPPED } from './project.js';

// main's hq:canvas-add accepts only these board names (no dots, no separators)
export const CANVAS_NAME_RE = /^[\w][\w -]{0,63}$/;
export const CANVAS_NOTE_MAX = 600;   // v3's input limit (main cuts at 2000)
const NO_BRIDGE = 'Unavailable — the bridge is offline';

// Boards a note can go to: the raw board list (store live.canvasBoards, contract K-2:
// [{name, nodes}], from DATA.canvas / hq.getCanvas / hq.onCanvas), else the boards the
// canvas widgets came from. Unique, in order, only names main would accept.
export function canvasBoardNames(boards, widgets) {
  const names = Array.isArray(boards) ? boards.map((b) => b && b.name) : (Array.isArray(widgets) ? widgets : []).map((w) => w && w.board);
  const out = [];
  for (const n of names) { const s = typeof n === 'string' ? n : ''; if (CANVAS_NAME_RE.test(s) && !out.includes(s)) out.push(s); }
  return out;
}

export const claudeLogic = {
  // ---- Claude › Canvas "＋ Note" (Phase 3 P5, v3 summoning/canvas-board.js) ----
  // hq.canvasAdd(board, {type:'text', text, x:40, y:40}) → true / false. No reload:
  // main's board watcher pushes hq:canvas about 300 ms later and the store re-renders.
  canvasBoardNames() { return canvasBoardNames(this.LIVE.canvasBoards, this.M.CANVAS); },
  // the picked board, else the first one; null when there is none
  canvasBoardPick() { const names = this.canvasBoardNames(), want = this.state.canvasBoard; return names.includes(want) ? want : (names[0] || null); },
  // why a note can't be added right now ('' = it can)
  canvasNoteReason() {
    if (!this.hq || !this.hq.canvasAdd) return NO_BRIDGE;
    if (!this.canWrite()) return this.writeReason() || NO_BRIDGE;
    if (!this.canvasBoardPick()) return 'No canvas boards yet — add a .canvas file in data\\canvas\\ and it appears here';
    return '';
  },
  toggleCanvasNote() {
    if (this.state.canvasNoteOpen) { this.setState({ canvasNoteOpen: false }); return; }
    const why = this.canvasNoteReason(); if (why) return this.denied(why);
    this.setState({ canvasNoteOpen: true }); FX().sfx('open');
  },
  canvasDraftKey(e) { if (e.key === 'Enter' && !e.isComposing && !e.repeat) { e.preventDefault(); this.addCanvasNote(); } },
  async addCanvasNote() {
    const why = this.canvasNoteReason(); if (why) return this.denied(why);
    const text = String(this.state.canvasDraft || '').trim().slice(0, CANVAS_NOTE_MAX); if (!text) return;
    if (this._canvasBusy) return;
    const board = this.canvasBoardPick();
    this._canvasBusy = true; this.setState({ canvasSaving: true });
    let ok = false, err = '';
    try { ok = (await this.hq.canvasAdd(board, { type: 'text', text, x: 40, y: 40 })) === true; }
    catch (e) { err = ' · ' + ((e && e.message) || e); }
    this._canvasBusy = false;
    if (!ok) { this.setState({ canvasSaving: false }); this.toast('error', 'Not added' + err); FX().sfx('error'); return; }
    // keep anything typed while the call was out
    this.setState((s) => ({ canvasSaving: false, canvasDraft: String(s.canvasDraft || '').trim().slice(0, CANVAS_NOTE_MAX) === text ? '' : s.canvasDraft }));
    this.toast('success', 'Added to ' + board + ' · it appears in a moment'); FX().sfx('done');
  },

  // ---- sessions ----
  // A task without a project (workspace-level) doesn't pick one silently: the
  // composer's project is cleared and Run stays disabled until one is chosen.
  sendClaude(title, proj) {
    if (!this.canWrite()) return this.denied();
    const p = proj ? this.proj(proj) : null;
    this.setState((s) => ({ tab: 'claude', route: null, sub: Object.assign({}, s.sub, { claude: 'sessions' }), composer: title, composerProj: p ? p.id : null, focus: null }));
    if (!p) { this.toast('info', 'Pick a project for this task first'); return; }
    this.toast('info', 'Session drafted · review it, then Run (uses Claude quota)');
  },
  async startSession() {
    if (!this.canWrite()) return this.denied();
    const txt = (this.state.composer || '').trim(); if (!txt) return;
    const p = this.proj(this.state.composerProj);
    if (!p || !this.hq.sessionStart) return this.denied('Pick a project first');
    const r = await this.call(() => this.hq.sessionStart({ cwd: p.path, task: txt, label: txt.slice(0, 60) }), 'Session didn’t start');
    if (!r || !r.jobId) return;
    this.setState({ sessionSel: r.jobId, composer: '' });
    FX().sfx('run'); FX().event('look', 'Claude is on it.');
    this.toast('info', 'Session started in ' + p.name + ' · output streams here');
  },
  // "Open in terminal" on a session: interactive Claude in THAT session's project
  // (the store maps the session's cwd to a project), not the composer's.
  async sessionTerminal(id) {
    if (!this.canWrite()) return this.denied();
    const s = this.LIVE.sessions.find((x) => x.id === id);
    const p = s && s.proj ? this.proj(s.proj) : null;
    if (!p) return this.denied('This session has no project folder');
    if (!this.hq.claudeQuest) return this.denied('This window can’t open a terminal');
    let ok;
    // through claudeTerminal (logic/project.js): a double-click opens one terminal, not two
    try { ok = await this.claudeTerminal(p.path, s.title); }
    catch (e) { this.toast('error', 'Couldn’t open a terminal · ' + ((e && e.message) || e)); FX().sfx('error'); return; }
    if (ok === TERM_SKIPPED) return;
    if (ok === false) { this.toast('error', 'Couldn’t open a terminal · ' + p.name + '’s folder wasn’t accepted'); FX().sfx('error'); return; }
    this.toast('info', 'Opened interactive Claude in a terminal · ' + p.name);
  },
};
