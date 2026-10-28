// The confirm sheet (archive / safe-listed fix / delete a capture). The only sheetOk:
// the fix branch hides a fixed System issue itself (markFixed, logic/system.js).
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const sheetLogic = {
  sheet(o) { this.setState({ sheet: o }); FX().sfx('open'); },
  async sheetOk() {
    const s = this.state.sheet; if (!s) return; this.setState({ sheet: null });
    if (s.act === 'archive') { this.toast('success', 'Archiving ' + this.pname(s.id) + ' · restore it from Projects › Archived'); this.defer('archive:' + s.id, () => this.call(() => this.hq.archiveProject(s.id), 'Archive failed')); }
    if (s.act === 'fix') {
      // a fix opened from System carries its issue id (vals/system.js): an ok:true answer hides
      // that issue until Re-examine (logic/system.js markFixed; no id = nothing to hide)
      const r = await this.call(() => this.hq.healthFix(s.cmd), 'Fix failed');
      if (r) {
        this.toast(r.ok ? 'success' : 'error', (r.ok ? 'Ran · ' : 'Didn’t run · ') + (String(r.output || '').split('\n').filter(Boolean).slice(-1)[0] || s.fixTitle), { ms: 6000 });
        if (r.ok === true) { this.markFixed(s.issueId); FX().event('cheer', 'Fixed!'); }
      }
    }
  },
};
