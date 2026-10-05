// Commit dialog render values.

export function commitVals(ctx) {
  const { S } = ctx;
  // ----- commit -----
  let commit = {};
  if (S.commit) {
    const c = S.commit, p = this.proj(c.pid) || {}, n = c.files.length;
    const selF = c.files[Math.min(S.commitSel, n - 1)];
    const envHit = c.files.some((f) => /(^|\/)\.env(\.|$)/.test(f.name));
    const statLines = String(c.stat || '').split('\n');
    const selStat = selF ? statLines.filter((l) => l.includes(selF.name.split('/').pop())) : [];
    commit = { selName: selF ? selF.name : (c.loading ? 'reading changes…' : 'no changes'), diff: c.loading ? 'Reading git status…' : (selStat.length ? selStat.join('\n') : (selF && selF.st === 'new' ? '+ new file (untracked)' : (c.stat || 'No line counts for this file')) ) + '\n\n(line counts from git diff --stat · open the file in your editor for the full diff)',
      title: 'Commit to ' + (p.branch || 'main') + ' · ' + (p.name || ''), files: c.files.map((f, i) => ({ name: f.name, st: f.st === 'new' ? 'A' : f.st === 'del' ? 'D' : 'M', stColor: f.st === 'new' ? 'var(--green)' : f.st === 'del' ? 'var(--red)' : 'var(--orange)', on: '■', warn: /(^|\/)\.env(\.|$)/.test(f.name), isSel: i === S.commitSel, rowBg: i === S.commitSel ? 'var(--card-hi)' : 'transparent', toggle: () => { this.setState({ commitSel: i }); if (!this._toggleNoted) { this._toggleNoted = true; this.toast('info', 'This commits every changed file (git add -A) · per-file staging isn’t wired yet'); } } })),
      more: 0, hasMore: false, msg: c.msg, onMsg: (e) => { const val = e.target.value; this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: val }) })); }, drafted: envHit ? '⚠ a .env file is in the change set · add it to .gitignore before committing' : c.drafted, okLabel: c.loading ? 'Reading…' : 'Commit ' + n + ' file' + (n === 1 ? '' : 's'), none: c.loading || n === 0 || envHit || !(c.msg || '').trim(), cmd: 'git add -A && git commit' };
  }
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    hasCommit: !!S.commit, commit, cancelCommit: () => this.setState({ commit: null }), doCommit: () => this.doCommit(),
  };
}
