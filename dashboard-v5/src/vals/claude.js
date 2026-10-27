// Claude render values: sessions, session detail, composer, canvas.
import { pinKey } from '../logic/canvas-pins.mjs';
import { CANVAS_NAME_RE } from '../logic/claude.js';
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function claudeVals(ctx) {
  const { S, H, LIVE, projects, sub, tabStyle, cantWrite } = ctx;
  // ---- claude ----
  const SST = { running: ['Running', 'var(--gold)'], done: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'] };
  // a session's project comes from its cwd (store); one outside every project says so
  const projOf = (x) => (x.proj ? this.pname(x.proj) || x.proj : 'No project folder');
  const sessions = LIVE.sessions.map((x) => ({ title: x.title, proj: projOf(x), started: x.started, status: SST[x.status][0], color: SST[x.status][1], sel: S.sessionSel === x.id, go: () => this.setState({ sessionSel: x.id }),
    style: { textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', cursor: 'pointer', fontFamily: 'var(--term)', color: 'var(--text)', background: S.sessionSel === x.id ? 'var(--card-hi)' : 'var(--card)', border: '1px solid var(--frame)', borderRadius: 10, boxShadow: '0 0 0 1px ' + (S.sessionSel === x.id ? 'var(--purple)' : 'var(--frame)') } }));
  const selS = LIVE.sessions.find((x) => x.id === S.sessionSel) || LIVE.sessions[0];
  const sessionDetail = selS ? { title: selS.title, proj: projOf(selS), tail: (LIVE.sessionOut[selS.id] || selS.tail.join('\n') || 'No output reached this window yet.').split('\n').slice(-60).join('\n'), running: selS.status === 'running',
    stop: () => { if (this.hq && this.hq.sessionKill) { this.hq.sessionKill(selS.id); this.toast('info', 'Stopping the session'); } },
    term: () => this.sessionTerminal(selS.id) } : null;
  const composerProjs = projects.map((p) => ({ label: p.name, go: () => this.setState({ composerProj: p.id }), style: Object.assign(tabStyle(S.composerProj === p.id), { height: 28, padding: '0 8px', fontSize: 12 }) }));
  const TONE = { orange: 'var(--orange)', gold: 'var(--gold)', blue: 'var(--blue)', green: 'var(--green)' };
  // board: which board the card is on (a note added with ＋ Note and one Claude pinned look the same on disk)
  // Pin to Home (per-PC prefs) and Remove (two clicks → hq.canvasRemove): logic/canvas.js
  const removeWhy = !this.hq || !this.hq.canvasRemove ? 'Unavailable — the bridge is offline' : cantWrite ? (this.writeReason() || 'Read-only right now') : '';
  const canvasActs = (w) => { const key = pinKey(w), pinned = !!key && (S.canvasPins || []).includes(key), ask = !!key && S.canvasRemoveAsk === key, busy = !!key && S.canvasRemoving === key;
    return { pin: () => this.canvasPinToggle(w), pinLabel: pinned ? 'Pinned ✓' : 'Pin to Home', pinPressed: pinned ? 'true' : 'false', pinTip: !key ? 'This card has no id' : pinned ? 'Unpin it from Home (this PC only)' : 'Show this card on Home (this PC only)',
      remove: () => this.canvasRemove(w), removeLabel: busy ? 'Removing…' : ask ? 'Remove for good?' : 'Remove', removeOff: !key || !!removeWhy || !!S.canvasRemoving,
      removeTip: !key ? 'This card has no id' : removeWhy || (ask ? 'Click again to remove it from ' + w.board + ' (a copy is kept in removed.jsonl)' : 'Remove this card from ' + w.board) }; };
  // ＋ Board and the board list with Clear (two clicks): logic/canvas.js
  const boardWhy = this.canvasBoardWhy(), boardDraft = typeof S.canvasBoardDraft === 'string' ? S.canvasBoardDraft : '', boardNameWhy = this.canvasBoardNameWhy(boardDraft);
  const boardOpen = !!S.canvasBoardOpen && !boardWhy;
  const boardRows = (Array.isArray(LIVE.canvasBoards) ? LIVE.canvasBoards : []).filter((b) => CANVAS_NAME_RE.test(b.name)).map((b) => {
    const n = b.nodes.length, ask = S.canvasClearAsk === b.name, busy = S.canvasClearing === b.name;
    return { name: b.name, count: n + ' card' + (n === 1 ? '' : 's'), clear: () => this.canvasClear(b.name, n),
      clearLabel: busy ? 'Clearing…' : ask ? 'Clear ' + n + ' card' + (n === 1 ? '' : 's') + '?' : 'Clear', clearOff: !n || !!boardWhy || !!S.canvasClearing,
      clearTip: boardWhy || (!n ? 'Already empty' : ask ? 'Click again to empty ' + b.name + ' (a copy of every card is kept in removed.jsonl)' : 'Empty this board') };
  });
  const canvas = H.CANVAS.map((w) => ({ title: w.title, board: w.board, isStat: w.type === 'stat', isList: w.type === 'list', isNote: w.type === 'note', value: w.value, note: w.note || 'board · ' + w.board, items: w.items || [], body: w.body, color: TONE[w.tone], span: w.wide ? 'span 2' : 'span 1', ...canvasActs(w) }));
  // ＋ Note (Phase 3 P5): board picker + text → hq.canvasAdd (logic/claude.js)
  const boardNames = this.canvasBoardNames(), board = this.canvasBoardPick(), noteWhy = this.canvasNoteReason();
  const draft = typeof S.canvasDraft === 'string' ? S.canvasDraft : '';
  const canvasBoardChips = boardNames.map((name) => ({ label: name, pressed: name === board ? 'true' : 'false', go: () => this.setState({ canvasBoard: name }), style: Object.assign(tabStyle(name === board), { height: 28, padding: '0 8px', fontSize: 12 }) }));
  const noteOpen = !!S.canvasNoteOpen && !noteWhy;
  return {
    isSessions: sub === 'sessions', isCanvas: sub === 'canvas', sessions, hasSessions: sessions.length > 0, sessionDetail: sessionDetail || {}, hasDetail: !!sessionDetail, composer: S.composer, onComposer: (e) => this.setState({ composer: e.target.value }), startSession: () => this.startSession(), composerProjs, canvas, hasCanvas: canvas.length > 0, noCanvas: canvas.length === 0,
    // Run needs a project picked (sendClaude clears it for a task without one)
    cantStartSession: cantWrite || !this.proj(S.composerProj),
    toggleCanvasBoard: () => this.toggleCanvasBoard(), cantCanvasBoard: !!boardWhy, canvasBoardTip: boardWhy || 'Make a new, empty canvas board', canvasBoardOpen: boardOpen, canvasBoardExpanded: boardOpen ? 'true' : 'false',
    canvasBoardDraft: boardDraft, onCanvasBoardDraft: (e) => this.setState({ canvasBoardDraft: e.target.value }), canvasBoardKey: (e) => this.canvasBoardKey(e), createCanvasBoard: () => this.createCanvasBoard(),
    cantCreateBoard: !!boardNameWhy || !!S.canvasCreating, createBoardLabel: S.canvasCreating ? 'Creating…' : 'Create', boardNameHint: boardDraft.trim() ? boardNameWhy : '', hasBoardNameHint: !!(boardDraft.trim() && boardNameWhy),
    boardRows, hasBoardRows: boardRows.length > 0,
    toggleCanvasNote: () => this.toggleCanvasNote(), cantCanvasNote: !!noteWhy, canvasNoteTip: noteWhy || 'Add a text note to one of your canvas boards',
    canvasNoteOpen: noteOpen, canvasNoteExpanded: noteOpen ? 'true' : 'false', canvasBoardChips,
    canvasDraft: draft, onCanvasDraft: (e) => this.setState({ canvasDraft: e.target.value }), canvasDraftKey: (e) => this.canvasDraftKey(e), addCanvasNote: () => this.addCanvasNote(),
    cantAddNote: !!noteWhy || !!S.canvasSaving || !draft.trim(), canvasAddLabel: S.canvasSaving ? 'Adding…' : 'Add',
    canvasEmptyText: boardNames.length ? 'Canvas is empty. Add a note with ＋ Note, or ask Claude to “add this to my canvas” during a session.' : 'Canvas is empty. Ask Claude to “add this to my canvas” during a session; ＋ Note works once a board exists.',
  };
}
