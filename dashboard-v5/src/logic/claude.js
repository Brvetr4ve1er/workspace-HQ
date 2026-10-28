// Claude sessions: draft one from a task, start it in a project.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';
import { TERM_SKIPPED } from './project.js';

export const claudeLogic = {
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
    const txt = (this.state.composer || '').trim(); if (!txt) { this.toast('info', 'Write what Claude should do first'); return; }   // an empty Run said nothing (button sweep 2026-10-27)
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
