// The confirm sheet (archive / safe-listed fix / delete a capture).
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const sheetLogic = {
  sheet(o) { this.setState({ sheet: o }); FX().sfx('open'); },
  async sheetOk() {
    const s = this.state.sheet; if (!s) return; this.setState({ sheet: null });
    if (s.act === 'archive') { this.toast('success', 'Archiving ' + this.pname(s.id) + ' · restore it from Projects › Archived'); this.defer('archive:' + s.id, () => this.call(() => this.hq.archiveProject(s.id), 'Archive failed')); }
    if (s.act === 'fix') {
      const r = await this.call(() => this.hq.healthFix(s.cmd), 'Fix failed');
      if (r) { this.toast(r.ok ? 'success' : 'error', (r.ok ? 'Ran · ' : 'Didn’t run · ') + (String(r.output || '').split('\n').filter(Boolean).slice(-1)[0] || s.fixTitle), { ms: 6000 }); if (r.ok) FX().event('cheer', 'Fixed!'); }
    }
    if (s.act === 'delete') {
      // main answers true only when the file reached the Recycle Bin; false/null = refused or failed
      // (not this.call(): it returns null both for a throw and for a plain null answer)
      let r = null, why = '';
      try { r = await this.hq.studio.libraryDelete(s.path); } catch (e) { why = ' · ' + ((e && e.message) || e); }
      if (r !== true) { this.toast('error', 'Couldn’t delete ' + s.name + (why || (r && r.error ? ' · ' + r.error : ''))); FX().sfx('error'); return; }
      this.setState({ lightbox: null }); this.toast('success', 'Moved to the Recycle Bin · ' + s.name); this.store.refreshCaptures();
    }
  },
};
