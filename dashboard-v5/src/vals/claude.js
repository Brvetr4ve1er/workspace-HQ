// Claude render values: sessions, session detail, composer, canvas.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function claudeVals(ctx) {
  const { S, H, LIVE, projects, sub, tabStyle, ro } = ctx;
  // ---- claude ----
  const SST = { running: ['Running', 'var(--gold)'], done: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'] };
  const sessions = LIVE.sessions.map((x) => ({ title: x.title, proj: this.pname(x.proj), started: x.started, status: SST[x.status][0], color: SST[x.status][1], sel: S.sessionSel === x.id, go: () => this.setState({ sessionSel: x.id }),
    style: { textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', cursor: 'pointer', fontFamily: 'var(--term)', color: 'var(--text)', background: S.sessionSel === x.id ? 'var(--card-hi)' : 'var(--card)', border: '1px solid var(--frame)', borderRadius: 10, boxShadow: '0 0 0 1px ' + (S.sessionSel === x.id ? 'var(--purple)' : 'var(--frame)') } }));
  const selS = LIVE.sessions.find((x) => x.id === S.sessionSel) || LIVE.sessions[0];
  const sessionDetail = selS ? { title: selS.title, proj: this.pname(selS.proj) || 'session', tail: (LIVE.sessionOut[selS.id] || selS.tail.join('\n') || 'No output reached this window yet.').split('\n').slice(-60).join('\n'), running: selS.status === 'running',
    stop: () => { if (this.hq && this.hq.sessionKill) { this.hq.sessionKill(selS.id); this.toast('info', 'Stopping the session'); } },
    term: () => { const p = this.proj(S.composerProj); if (!p || ro()) return; this.hq.claudeQuest(p.path, selS.title); this.toast('info', 'Opened interactive Claude in a terminal · ' + p.name); } } : null;
  const composerProjs = projects.map((p) => ({ label: p.name, go: () => this.setState({ composerProj: p.id }), style: Object.assign(tabStyle(S.composerProj === p.id), { height: 28, padding: '0 8px', fontSize: 12 }) }));
  const TONE = { orange: 'var(--orange)', gold: 'var(--gold)', blue: 'var(--blue)', green: 'var(--green)' };
  const canvas = H.CANVAS.map((w) => ({ title: w.title, isStat: w.type === 'stat', isList: w.type === 'list', isNote: w.type === 'note', value: w.value, note: w.note || 'board · ' + w.board, items: w.items || [], body: w.body, color: TONE[w.tone], span: w.wide ? 'span 2' : 'span 1', pin: () => this.notWired('Pinning canvas cards to Home'), remove: () => this.notWired('Removing canvas cards (boards are append-only for now)') }));
  return {
    isSessions: sub === 'sessions', isCanvas: sub === 'canvas', sessions, hasSessions: sessions.length > 0, sessionDetail: sessionDetail || {}, hasDetail: !!sessionDetail, composer: S.composer, onComposer: (e) => this.setState({ composer: e.target.value }), startSession: () => this.startSession(), composerProjs, canvas, hasCanvas: canvas.length > 0, noCanvas: canvas.length === 0,
  };
}
