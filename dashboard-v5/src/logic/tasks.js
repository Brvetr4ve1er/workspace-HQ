// Task actions: complete / undo (the write is deferred so Undo can cancel it), XP and
// level-ups, focus mode.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX, loadPrefs, savePrefs } from './shared.js';

export const tasksLogic = {
  completeTask(id, e) {
    if (!this.canWrite()) return this.denied();
    const t = this.M.T0.find((x) => x.id === id); if (!t || this.state.completed.includes(id)) return;
    const p = this.pt(e);
    this.setState((s) => ({ completed: s.completed.concat([id]), recentDone: s.recentDone.concat([id]), focus: s.focus && s.focus.taskId === id ? null : s.focus }));
    setTimeout(() => this.setState((s) => ({ recentDone: s.recentDone.filter((x) => x !== id) })), 1500);
    FX().sfx('done'); FX().floatText(p.x, p.y - 10, '+' + t.xp + ' xp'); FX().asciiBurst && FX().asciiBurst(p.x, p.y, '✓');
    FX().event('cheer', 'Nice. +' + t.xp + ' xp');
    this.toast('success', 'Done · ' + t.title, { undo: id });
    FX().coinFly(p.x, p.y, this._xpEl).then(() => this.gainXp(t.xp));
    this.defer('done:' + id, () => {
      this.hq.actedOn && this.hq.actedOn({ kind: 'quest', action_id: id, project_id: t.proj, resolved: true, marked_done: true, via: 'board' });
      this.call(() => this.hq.markQuestDone(id), 'Couldn’t save');   // main re-assembles today and reloads
    });
  },
  undoTask(id) {
    const p = this._pending['done:' + id];
    const t = this.M.T0.find((x) => x.id === id) || this.M.IDEAS.find((x) => x.id === id);
    if (!p) { this.toast('info', 'Already saved · it can’t be undone from here'); return; }
    clearTimeout(p.timer); delete this._pending['done:' + id];
    const xp = (t && t.xp) || 0;
    this.setState((s) => ({ completed: s.completed.filter((x) => x !== id), xp: s.xp - xp, displayXp: s.xp - xp, toasts: s.toasts.filter((k) => k.undo !== id) }));
    this.toast('info', 'Restored · ' + (t ? t.title : 'task'));
  },
  gainXp(n) {
    const from = this.state.xp, to = from + n, L0 = this.M.levelOf(from), L1 = this.M.levelOf(to);
    this.setState({ xp: to });
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 650); this.setState({ displayXp: Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))) }); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    if (this._xpEl && !this.state.reduceMotion) this._xpEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.22,1.6,.36,1)' });
    if (L1.l > L0.l) setTimeout(() => this.showLevelUp(L1), 450);
  },
  showLevelUp(L) { this.setState({ levelUp: { l: L.l, t: L.t } }); FX().sfx('level'); FX().asciiBurst && FX().asciiBurst(innerWidth / 2, innerHeight * 0.35, 'level ' + L.l); FX().event('cheer', 'Level ' + L.l + '!', 2600); },
  // the scan that just landed carries a level_up the user hasn't seen → celebrate once
  maybeLevelUp() {
    const s = this.M.at(0), ch = s.changes.find((c) => c.type === 'level_up');
    if (!ch || this.ps() !== 'live') return;
    const P = loadPrefs(); if (P.levelSeen === s.id) return;
    savePrefs(Object.assign(P, { levelSeen: s.id }));
    setTimeout(() => this.showLevelUp(this.M.levelOf(s.account.xp)), 1200);
  },
  startFocus(id) { this.setState({ focus: { taskId: id, start: Date.now() }, now: Date.now(), paletteOpen: false }); FX().sfx('open'); FX().event('look', 'Focus mode. Shh.'); },
  endFocus(note) {
    const f = this.state.focus; if (!f) return;
    const secs = Math.round((Date.now() - f.start) / 1000), t = this.M.T0.find((x) => x.id === f.taskId);
    if (t && this.hq && this.hq.actedOn && secs >= 5) this.hq.actedOn({ kind: 'quest', action_id: t.id, project_id: t.proj, seconds: secs, resolved: false, via: 'focus' });
    this.setState({ focus: null });
    if (note) this.toast('info', 'Focus stopped · ' + Math.max(1, Math.round(secs / 60)) + ' min');
  },
  toggleFocus() {
    if (this.state.focus) return this.endFocus(false);
    const t = this.openTasks(this.state.snapOffset)[0]; this.startFocus(t ? t.id : null);
  },
};
