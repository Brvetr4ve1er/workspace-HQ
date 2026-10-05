// Commit dialog render values. The file list and the .env flags come from main
// (hq.commitPreview); nothing here decides on its own what counts as an .env file.
import { commitKind } from '../logic/commit.js';

// status badge: porcelain XY ('M', '??', 'AM', 'UU'…), the old 'new'/'del'/'mod', or
// anything else main sends (e.g. 'staged' for a cached-only name) — never an index miss
function badge(f) {
  const raw = String(f.status != null ? f.status : f.st || '');
  if (/U/.test(raw) && raw !== 'staged') return ['U', 'var(--red)'];
  const k = f.st === 'new' || f.st === 'del' || f.st === 'mod' ? f.st : commitKind(raw);
  if (k === 'new') return ['A', 'var(--green)'];
  if (k === 'del') return ['D', 'var(--red)'];
  if (k === 'mod') return ['M', 'var(--orange)'];
  return [raw === 'staged' ? 'S' : (raw.trim().charAt(0).toUpperCase() || '·'), 'var(--muted)'];
}

export function commitVals(ctx) {
  const { S } = ctx;
  // ----- commit -----
  let commit = {};
  if (S.commit) {
    const c = S.commit, p = this.proj(c.pid) || {};
    const files = (c.files || []).map((f) => ({ name: String(f.name || f.path || ''), status: f.status, st: f.st, env: !!f.env }));
    const n = files.length;
    const hits = Array.isArray(c.envHits) ? c.envHits : files.filter((f) => f.env).map((f) => f.name);
    const blocked = hits.length > 0, error = c.error ? String(c.error) : '';
    const selF = files[Math.min(S.commitSel, n - 1)];
    const statLines = String(c.stat || '').split('\n');
    const selStat = selF ? statLines.filter((l) => l.includes(selF.name.split('/').pop())) : [];
    const untracked = selF && (selF.status === '??' || selF.st === 'new');
    const branch = c.branch || p.branch || '';
    const alert = error ? 'Couldn’t read the change set · ' + error : blocked ? 'A .env file is in this change set — add it to .gitignore before committing: ' + hits.join(', ') : '';
    commit = { selName: selF ? selF.name : (c.loading ? 'reading changes…' : error ? 'change set unavailable' : 'no changes'),
      diff: c.loading ? 'Reading git status…' : error ? 'Couldn’t list the changes · ' + error : !n ? 'Nothing to commit · the working tree matches the last commit.' : (selStat.length ? selStat.join('\n') : (untracked ? '+ new file (untracked)' : (c.stat || 'No line counts for this file'))) + '\n\n(line counts from git diff --stat · open the file in your editor for the full diff)',
      title: (branch ? 'Commit to ' + branch : 'Commit') + ' · ' + (p.name || ''),
      files: files.map((f, i) => { const [st, stColor] = badge(f); return { name: f.name, st, stColor, on: '■', warn: f.env, isSel: i === S.commitSel, rowBg: i === S.commitSel ? 'var(--card-hi)' : 'transparent', toggle: () => { this.setState({ commitSel: i }); if (!this._toggleNoted) { this._toggleNoted = true; this.toast('info', 'This commits every changed file (git add -A) · per-file staging isn’t wired yet'); } } }; }),
      more: 0, hasMore: false, msg: c.msg, onMsg: (e) => { const val = e.target.value; this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: val }) })); },
      drafted: c.drafted, hasAlert: !!alert, alert,
      okLabel: c.loading ? 'Reading…' : c.busy ? 'Committing…' : 'Commit ' + n + ' file' + (n === 1 ? '' : 's'),
      none: !!c.loading || !!c.busy || n === 0 || blocked || !!error || !(c.msg || '').trim(), cmd: 'git add -A && git commit' };
  }
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    hasCommit: !!S.commit, commit, cancelCommit: () => this.setState({ commit: null }), doCommit: () => this.doCommit(),
  };
}
