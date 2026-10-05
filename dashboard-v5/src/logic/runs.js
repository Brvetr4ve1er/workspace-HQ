// Automations, runs, dev servers and the full scan.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const runsLogic = {
  // ---- automations (casting engine: confirm-first is enforced in main too) ----
  auto(id) { return this.M.AUTOS.find((x) => x.id === id) || null; },
  askRun(a) {
    if (!a) return;
    if (!this.canWrite()) return this.denied();
    if (this.state.trusted.includes(a.id) && !a.destructive && this.M.confirmedHashes[a.id] === a.hash) return this.startRun(a);
    this.setState({ confirm: a.id, confirmAsk: this.state.trusted.includes(a.id) ? 'never' : 'always', paletteOpen: false }); FX().sfx('open');
  },
  confirmRun() {
    const a = this.auto(this.state.confirm); if (!a) return this.setState({ confirm: null });
    this.setState((s) => ({ confirm: null, trusted: s.confirmAsk === 'never' ? (s.trusted.includes(a.id) ? s.trusted : s.trusted.concat([a.id])) : s.trusted.filter((x) => x !== a.id) }));
    this.startRun(a, a.hash);
  },
  async startRun(a, hash) {
    if (!this.hq || !this.hq.castSpell) return this.denied();
    const r = await this.call(() => this.hq.castSpell(a.id, hash), 'Run failed');
    if (!r) return;
    if (r.confirm_required) { this.setState({ confirm: a.id, confirmAsk: 'always' }); this.toast('info', 'This command changed since you last ran it · check it, then run'); return; }
    if (r.channeled) { this.setState((s) => ({ localRuns: [{ id: 't' + Date.now(), name: a.name, status: 'opened', meta: 'Terminal opened · ' + a.cmd, started: this.hhmm(), out: ['Opened in an external terminal; output stays there.'] }].concat(s.localRuns) })); this.toast('info', 'Terminal opened · ' + a.name); return; }
    this.toast('progress', 'Running · ' + a.name, { runSpell: a.id });
    FX().sfx('run'); FX().event('look', 'Watching ' + a.name.toLowerCase() + '…');
  },
  announceRuns() {
    for (const c of Object.values(this.LIVE.casts)) {
      if (!c.done || c.announced) continue;
      c.announced = true;
      this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== c.spellId) }));
      if (c.status === 'ok') { this.toast('success', c.name + ' finished'); FX().sfx('done'); FX().event('cheer', 'Run finished.'); }
      else { this.toast('error', c.name + ' failed · ' + (c.meta || '')); FX().sfx('error'); }
    }
  },
  cancelRun(spellId) {
    if (!spellId || !this.hq || !this.hq.cancelCast) return;
    this.hq.cancelCast(spellId);
    this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== spellId) }));
    this.toast('info', 'Cancelling…');
  },
  stopDev(id) { if (this.hq && this.hq.devStop) { this.hq.devStop(id); this.toast('info', 'Dev server stopped · ' + this.pname(id)); } },
  scanNow() {
    if (!this.canWrite()) return this.denied();
    this.setState((s) => ({ paletteOpen: false, localRuns: [{ id: 'scan', kind: 'scan', name: 'Full scan', status: 'running', meta: 'run-pipeline.ps1 · the window reloads when it finishes', started: this.hhmm(), out: [] }].concat(s.localRuns.filter((r) => r.id !== 'scan')) }));
    this.hq.runScan();
    this.toast('progress', 'Scanning every project · the window reloads when it’s done', { scan: true });
    FX().sfx('run'); FX().event('look', 'Scanning…');
  },
};
