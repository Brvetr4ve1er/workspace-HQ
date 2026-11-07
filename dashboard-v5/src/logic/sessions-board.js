// Claude › Sessions board and the Home strip: the actions (Resume, Resume and say continue, Copy resume command, Open folder)
// and the Chats button's Resume. The board itself is computed main-side (dashboard/sessions-board.js + sessions-core.mjs); this
// mixin never decides a state, it only forwards a click and tells the owner what main said. Every refusal is main's own words.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// Needs from the store (live/store.js): resumeSession(id, { say? }) → main's { ok } | { error }, refreshBoard(); openFolder goes
// straight to hq.sessionsBoard. Usage marks (dashboard/use-log.js allowlist: 'sessions-board' open on arrival, 'sessions-board' resume on a
// Resume that opened a terminal, 'sessions-strip' open from vals/sessions-board.js while the strip is actually shown) go through useMark.
const NO_BRIDGE = 'The sessions board needs the desktop app';
// Refusals that will not change by clicking again (the transcript or the folder is gone or not allowed, the chat is not a Code chat):
// remembered per chat, so the Chats button says why and falls back to a fresh session. Transient ones (the Hub down, a resume already
// starting, a chat active a moment ago, a terminal that would not open) are not remembered: the next click may work.
const STANDING_REFUSAL = /deleted this transcript|^refused: the folder|^refused: that is not an indexed|quote or control character|folder no longer exists|not a folder any more/;

export const sessionsBoardLogic = {
  _sbdMark(surface, action) { try { if (typeof this.useMark === 'function') this.useMark(surface, action || 'open'); } catch { /* a mark never blocks a click */ } },

  // arriving on Claude › Sessions or Home: read the board (main pushes changes after that)
  sbdArrive(where) {
    if (where !== 'strip') this._sbdMark('sessions-board');   // the strip is marked where it renders (vals), only while there is something to show
    try { const p = this.store && this.store.refreshBoard && this.store.refreshBoard(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* the board shows its own error */ }
  },

  // One Resume. A double click is one call: the id stays busy until main answers. say is undefined or 'continue'.
  async sbdResume(id, say) {
    if (!id) return false;
    if (!this.hq || !this.hq.sessionsBoard || !this.store || !this.store.resumeSession) { this.toast('error', NO_BRIDGE); return false; }
    this._sbdBusy = this._sbdBusy || new Set();
    if (this._sbdBusy.has(id)) return false;
    this._sbdBusy.add(id);
    this.setState({ sbdBusy: [...this._sbdBusy] });
    try {
      const r = await this.store.resumeSession(id, say === 'continue' ? { say: 'continue' } : {});
      if (r && r.error) {
        if (STANDING_REFUSAL.test(r.error)) { this._sbdGone = Object.assign({}, this._sbdGone, { ['code:' + String(id).replace(/^code:/, '')]: r.error }); this.setState({ sbdGoneAt: Date.now() }); }
        this.toast('error', 'Not resumed · ' + r.error);
        return false;
      }
      this._sbdMark('sessions-board', 'resume');
      this.toast('success', say === 'continue' ? 'Opened a terminal that continues this chat — it says “continue”' : 'Opened a terminal that continues this chat');
      return true;
    } catch (e) {
      this.toast('error', 'Not resumed · ' + ((e && e.message) || e));
      return false;
    } finally { this._sbdBusy.delete(id); this.setState({ sbdBusy: [...this._sbdBusy] }); }
  },

  // The command to run by hand, in the session's folder. Nothing is run here.
  sbdCopyCommand(id, folder) {
    if (!id) return;
    this.copy('claude --resume ' + id + ' --permission-mode default', 'Resume command copied' + (folder ? ' · run it in the ' + folder + ' folder' : ''));
  },

  async sbdOpenFolder(id) {
    if (!id) return false;
    if (!this.hq || !this.hq.sessionsBoard || !this.hq.sessionsBoard.openFolder) { this.toast('error', NO_BRIDGE); return false; }
    try {
      const r = await this.hq.sessionsBoard.openFolder(id);
      if (r && r.error) { this.toast('error', 'Couldn’t open the folder · ' + r.error); return false; }
      return true;
    } catch (e) { this.toast('error', 'Couldn’t open the folder · ' + ((e && e.message) || e)); return false; }
  },

  // ---- Claude › Chats: a Code chat's terminal button becomes Resume. Hub conversation ids are 'code:<uuid>'; main reads the
  // folder from the Hub and refuses a transcript Claude Code already deleted (then the reason is remembered, so the button
  // says why and the fresh-session path stays).
  sbdChatCan(conv) { return !!(conv && conv.source === 'code' && typeof conv.id === 'string' && /^code:[0-9a-f-]{36}$/i.test(conv.id) && this.hq && this.hq.sessionsBoard); },
  sbdChatGone(conv) { return conv && this._sbdGone ? this._sbdGone[conv.id] || '' : ''; },
  async sbdChatResume(conv) {
    if (!this.sbdChatCan(conv) || this.sbdChatGone(conv)) return null;   // null: not resumable, the caller opens a fresh session as before
    return this.sbdResume(conv.id);
  },
};
