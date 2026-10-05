// The commit dialog: real changed files, a drafted message, then commit.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
//
// The change set comes from main (hq.commitPreview → commit-guard.js): the same
// file-by-file list `git add -A` will stage, with main's own `env` flag per file.
// There is no renderer-side .env check — main's flag is the only source, and
// hq:do-commit refuses an .env change set again on its side.
import { FX } from './shared.js';

// commit-guard.js GIT_ERROR_HIT: do-commit's envHits when git itself failed (fails closed)
const GIT_ERROR_HIT = '<git error>';

// porcelain XY (or the old 'new'/'del'/'mod') → the dialog's coarse kind
export function commitKind(status) {
  const s = String(status || '');
  if (s === 'new' || s === 'del' || s === 'mod') return s;
  if (s === '??' || (/A/.test(s) && !/D/.test(s))) return 'new';
  if (/D/.test(s)) return 'del';
  if (/[MRCTU]/.test(s)) return 'mod';
  return 'other';   // e.g. 'staged' (cached-only name) or anything git adds later
}

export const commitLogic = {
  // ---- commit: real changed files + a local-model draft --------------------
  // "Preview decides": any live git project can open the dialog; an empty change
  // set shows "no changes" with Commit disabled.
  async openCommit(pid) {
    if (!this.canWrite()) return this.denied();
    const p = this.projectsAt(0).find((x) => x.id === pid); if (!p) return;
    if (!p.hasGit) return this.denied(p.name + ' has no git repository');
    this.setState({ commit: { pid, files: [], stat: '', envHits: [], branch: p.branch || '', error: '', busy: false, loading: true, msg: '', drafted: 'Drafting with the local model…' }, commitSel: 0, paletteOpen: false }); FX().sfx('open');
    let pv;
    try { pv = this.hq && this.hq.commitPreview ? await this.hq.commitPreview(p.path) : { error: 'this version of the app can’t list the change set' }; }
    catch (e) { pv = { error: String((e && e.message) || e) }; }
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    if (!pv || typeof pv !== 'object') pv = { error: 'no answer from the app' };
    const files = (Array.isArray(pv.files) ? pv.files : []).filter((f) => f && f.path)
      .map((f) => ({ name: String(f.path), status: String(f.status || ''), st: commitKind(f.status), env: !!f.env, on: true }));
    const envHits = Array.isArray(pv.envHits) ? pv.envHits.map(String) : files.filter((f) => f.env).map((f) => f.name);
    const error = pv.error ? String(pv.error) : '';
    // no draft when nothing can be committed: drafting may fall back to Claude and use quota
    const why = error ? 'No draft · the change set couldn’t be read' : !files.length ? 'No draft · nothing to commit' : envHits.length ? 'No draft · the commit is blocked until the .env file is out of the change set' : '';
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { files, stat: String(pv.stat || ''), envHits, branch: String(pv.branch || '') || s.commit.branch, error, loading: false }, why ? { drafted: why } : null) }));
    if (why) return;
    const d = await this.call(() => this.hq.draftCommit(p.path), 'No draft');
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: s.commit.msg || (d && d.message) || '', drafted: d && d.message ? (String(d.via || '').startsWith('local') ? 'Drafted by the local model · edit before committing' : 'Drafted by Claude (used quota) · edit before committing') : 'No draft · write the message yourself' }) }));
  },
  async doCommit() {
    const c = this.state.commit; if (!c || c.loading || c.busy || this._committing) return;
    const p = this.proj(c.pid), msg = (c.msg || '').trim();
    const hits = Array.isArray(c.envHits) ? c.envHits : [];
    if (!p) return this.denied('That project isn’t in the scan any more');
    if (c.error) return this.denied('Couldn’t read the change set · ' + c.error);
    if (!(c.files || []).length) return this.denied('Nothing to commit');
    if (hits.length) return this.denied('A .env file is in this change set — add it to .gitignore before committing');
    if (!msg) return this.denied('Write a commit message first');
    if (!this.hq || !this.hq.doCommit) return this.denied();
    const n = c.files.length, branch = c.branch || p.branch || '';
    const mine = () => this.state.commit && this.state.commit.pid === c.pid;
    const settle = (patch) => { if (mine()) this.setState((s) => ({ commit: Object.assign({}, s.commit, { busy: false }, patch || null) })); };
    this._committing = true;
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { busy: true }) }));
    let r;
    try { r = await this.hq.doCommit(p.path, msg); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    finally { this._committing = false; }
    if (r === false) { settle(); this.toast('error', 'Couldn’t commit — the project path wasn’t accepted'); FX().sfx('error'); return; }
    if (!r || r.error) {
      const hits = r && Array.isArray(r.envHits) ? r.envHits.map(String) : [];
      // the guard fails closed: envHits ['<git error>'] means git couldn't list the change set, not that an .env is in it
      if (hits.includes(GIT_ERROR_HIT)) {
        settle({ error: 'git couldn’t list the change set' });
        this.toast('error', 'Couldn’t commit · git couldn’t list the change set (nothing was staged)');
      } else if (hits.length) {   // main refused (.env in the change set): keep the dialog, now blocked, naming the files
        settle({ envHits: hits });
        this.toast('error', 'Commit refused · .env in the change set: ' + hits.join(', '));
      } else {
        settle();
        this.toast('error', 'Couldn’t commit · ' + ((r && r.error) || 'no answer from the app'));
      }
      FX().sfx('error');
      return;
    }
    this.setState((s) => ({ commit: mine() ? null : s.commit, committed: Object.assign({}, s.committed, { [c.pid]: true }) }));
    this.toast('success', 'Committed ' + n + ' file' + (n === 1 ? '' : 's') + (branch ? ' to ' + branch : '') + ' · ' + p.name + ' · re-scanning');
    FX().sfx('done'); FX().event('cheer', 'Saved!'); FX().asciiBurst && FX().asciiBurst(innerWidth / 2, innerHeight / 2, p.name.toLowerCase() + ' · clean');
  },
};
