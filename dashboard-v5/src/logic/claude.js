// Claude sessions: draft one from a task, start it in a project.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const claudeLogic = {
  sendClaude(title, proj) {
    if (!this.canWrite()) return this.denied();
    this.setState((s) => ({ tab: 'claude', route: null, sub: Object.assign({}, s.sub, { claude: 'sessions' }), composer: title, composerProj: proj || s.composerProj, focus: null }));
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
};
