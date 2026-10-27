// Project journal entries and ideas & risks.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const journalLogic = {
  async addJournal() {
    if (!this.canWrite()) return this.denied();
    const txt = this.state.journalDraft.trim(); const pid = this.state.route && this.state.route.id; if (!pid) return;
    if (!txt) { this.toast('info', 'Write something first'); return; }   // an empty Add said nothing (button sweep, 2026-10-27)
    const kind = this.state.journalKind;
    const fn = kind === 'learning' ? () => this.hq.learn(pid, txt) : kind === 'decision' ? () => this.hq.logDecision(pid, txt) : () => this.hq.saveNote(pid, txt);
    // main answers true once written and false when it couldn't (project not in the latest scan,
    // empty text); anything but true is reported, never a silent no-op
    let ok = null, why = '';
    try { ok = await fn(); } catch (e) { why = (e && e.message) || String(e); }
    if (ok !== true) { this.toast('error', 'Not saved · ' + (why || (ok && ok.error) || (kind === 'decision' ? 'the decision' : kind === 'learning' ? 'the learning' : 'the note') + ' wasn’t written')); return; }
    this.setState((s) => ({ journalAdds: Object.assign({}, s.journalAdds, { [pid]: [{ k: kind, t: txt, d: 'Today' }].concat(s.journalAdds[pid] || []) }), journalDraft: '' }));
    this.toast('success', kind === 'decision' ? 'Decision logged in the project’s vault note' : kind === 'learning' ? 'Learning saved · +knowledge xp' : 'Note saved · mirrored to the vault');
    FX().event('cheer', 'Noted.');
  },
  doIdea(i, e) {
    if (!this.canWrite()) return this.denied();
    if (i.purge) {
      const p = this.proj(i.proj);
      if (!p || !i.fatDirs.length) return this.denied('Nothing purgeable listed for this project');
      return this.call(() => this.hq.reclaim(p.path, i.fatDirs), 'Purge failed');   // main asks to confirm, deletes, then re-scans
    }
    const pt = this.pt(e); FX().floatText(pt.x, pt.y - 10, 'done');
    this.setState((s) => ({ completed: s.completed.concat([i.id]) })); this.toast('success', 'Marked done · ' + i.title, { ms: 3000, undo: i.id }); FX().sfx('done');
    this.defer('done:' + i.id, () => this.call(() => this.hq.markQuestDone(i.id), 'Couldn’t save'));
  },
};
