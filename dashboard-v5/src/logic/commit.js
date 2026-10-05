// The commit dialog: real changed files, a drafted message, then commit.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const commitLogic = {
  // ---- commit: real changed files + a local-model draft --------------------
  async openCommit(pid) {
    if (!this.canWrite()) return this.denied();
    const p = this.projectsAt(0).find((x) => x.id === pid); if (!p || !p.dirty) return;
    this.setState({ commit: { pid, files: [], stat: '', loading: true, msg: '', drafted: 'Drafting with the local model…' }, commitSel: 0, paletteOpen: false }); FX().sfx('open');
    const diff = this.hq.sessionDiff ? await this.call(() => this.hq.sessionDiff({ cwd: p.path }), 'Couldn’t read changes') : null;
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    const files = diff && Array.isArray(diff.files) ? diff.files.map((f) => ({ name: f.path, st: /\?|A/.test(f.status) ? 'new' : /D/.test(f.status) ? 'del' : 'mod', on: true })) : [];
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { files, stat: (diff && diff.stat) || '', loading: false }) }));
    const d = await this.call(() => this.hq.draftCommit(p.path), 'No draft');
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: s.commit.msg || (d && d.message) || '', drafted: d && d.message ? (String(d.via || '').startsWith('local') ? 'Drafted by the local model · edit before committing' : 'Drafted by Claude (used quota) · edit before committing') : 'No draft · write the message yourself' }) }));
  },
  async doCommit() {
    const c = this.state.commit; if (!c || c.loading) return;
    const p = this.proj(c.pid), msg = (c.msg || '').trim();
    if (!p || !msg) return this.denied('Write a commit message first');
    if (c.files.some((f) => /(^|\/)\.env(\.|$)/.test(f.name))) return this.denied('A .env file would be committed · add it to .gitignore first');
    const r = await this.call(() => this.hq.doCommit(p.path, msg), 'Commit failed');
    if (!r) return;
    this.setState((s) => ({ commit: null, committed: Object.assign({}, s.committed, { [c.pid]: true }) }));
    this.toast('success', 'Committed ' + c.files.length + ' files to ' + p.branch + ' · ' + p.name + ' · re-scanning');
    FX().sfx('done'); FX().event('cheer', 'Saved!'); FX().asciiBurst && FX().asciiBurst(innerWidth / 2, innerHeight / 2, p.name.toLowerCase() + ' · clean');
  },
};
