// Client delivery check render values (project page, under the delivery card). Keys are dck-prefixed (onDck for handlers) —
// one shared namespace with every other surface. The block shows only on a client job (the delivery card's own view says so).
// Honest states, exclusive where they should be: offline · not looked yet · looking · ready (a server answered) · nothing
// answering · running · a report (findings / clean / no language switch). A held report is never blanked by a later error.
// The address field is always present; the owner confirms the URL, so a different app on port 3000 is never checked by accident.
const pad = (s) => String(s == null ? '' : s);
const ago = (iso) => {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'at an unknown time';
  const d = Math.max(0, Date.now() - t), H = 3600e3;
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < 24 * H ? Math.round(d / H) + ' h ago' : Math.floor(d / (24 * H)) + ' d ago';
};
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const LEVEL = {
  problem: { tag: 'to fix', color: 'var(--red)' },
  'heads-up': { tag: 'to look at', color: 'var(--orange)' },
  heuristic: { tag: 'heuristic · may be wrong', color: 'var(--muted)' },
};
const FINDINGS_MAX = 40;

export function deliveryCheckVals(ctx) {
  const { S, LIVE } = ctx;
  const id = S.route && S.route.id;
  const D = LIVE.delivery || {};
  const view = id && D.byProject ? D.byProject[id] || null : null;
  const show = !!(view && view.client);
  const can = !!(this.hq && this.hq.deliveryCheck);
  const st = S.dck && S.dck.pid === id ? S.dck : { url: '', detect: null, report: null, phase: 'idle', err: '' };
  const phase = st.phase, busy = phase !== 'idle';
  const det = st.detect, rep = st.report;
  const looked = !!det;
  const ready = can && looked && det.state === 'ready';
  const nothing = can && looked && det.state !== 'ready';

  const all = rep && Array.isArray(rep.findings) ? rep.findings : [];
  const notes = rep && Array.isArray(rep.notes) ? rep.notes : [];
  const findings = all.slice(0, FINDINGS_MAX).map((f, i) => {
    const lv = LEVEL[f.level] || LEVEL.heuristic;
    return {
      key: i + ':' + f.id + ':' + f.route, tag: lv.tag, tagStyle: { color: lv.color, fontFamily: 'var(--term)', fontSize: 11, whiteSpace: 'nowrap', flex: '0 0 auto' },
      route: pad(f.route), text: pad(f.text), hasSamples: Array.isArray(f.samples) && f.samples.length > 0,
      samplesText: Array.isArray(f.samples) ? f.samples.join(' · ') : '',
    };
  });
  const clean = !!rep && all.length === 0;
  const routes = rep && Array.isArray(rep.routes) ? rep.routes.map((r, i) => ({ key: i + ':' + r.path, path: r.path, meta: r.loaded ? (r.locale ? r.locale + ' · ' : '') + (r.title ? '“' + r.title + '”' : 'no title') : 'did not load' })) : [];
  const shots = rep && Array.isArray(rep.shots) ? rep.shots.length : 0;

  return {
    dckShow: show,
    dckOffline: show && !can,
    dckOfflineText: 'Needs the desktop app’s check module (hq.deliveryCheck) — nothing is checked without it.',
    dckOnly: 'Only a dev server on this PC can be checked. Nothing is sent anywhere.',

    dckBusy: busy, dckDetecting: phase === 'detecting', dckRunning: phase === 'running',
    dckNotLooked: show && can && !looked && phase === 'idle',
    dckLooking: phase === 'detecting',
    dckReady: show && ready,
    dckReadyText: ready ? 'Answering at ' + det.candidates[0].origin + (det.candidates[0].title ? ' · “' + det.candidates[0].title + '”' : '') + ' · ' + (det.startedHere ? 'started from this app' : 'started elsewhere (your own terminal)') + '. Confirm it is the right app, then Check.' : '',
    dckNothing: show && nothing,
    dckNothingText: 'Nothing answered on the usual local ports. Start the dev server (from this page when the project has a dev command) or type its address.',
    dckNoCommand: show && looked && !det.hasCommand,
    dckNoCommandText: 'No dev command saved for this project, so only the usual framework ports were tried. Typing an address on this PC still works.',

    dckUrl: pad(st.url), onDckUrl: (e) => this.dckField(e.target.value),
    dckUrlKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.dckField(e.target.value); this.dckRun(); } },
    dckLookGo: () => this.dckDetect(), dckLookOff: busy,
    dckRunGo: () => this.dckRun(), dckRunOff: busy || !pad(st.url).trim(),
    dckRunLabel: phase === 'running' ? 'Checking…' : 'Check',
    dckErr: pad(st.err), dckHasErr: !!st.err,

    // the report
    dckHasReport: !!rep,
    dckSummary: rep ? rep.summary : '',
    dckCheckedLine: rep ? 'checked ' + ago(rep.at) + ' against ' + rep.origin + ' at ' + ((rep.phone && rep.phone.width) || 390) + ' px' : '',
    dckClean: clean,
    dckFindings: findings, dckHasFindings: findings.length > 0,
    dckFindingsMore: all.length > FINDINGS_MAX ? '+' + (all.length - FINDINGS_MAX) + ' more not shown' : '', dckHasFindingsMore: all.length > FINDINGS_MAX,
    dckRoutes: routes, dckHasRoutes: routes.length > 1,
    dckBlockedLine: rep ? rep.blockedLine : '',
    dckNotes: notes.map((n, i) => ({ key: i + ':' + String(n).slice(0, 12), text: pad(n) })), dckHasNotes: notes.length > 0,
    dckShotsLine: shots ? plural(shots, 'phone-size screenshot') + ' saved in data/delivery/shots on this PC' : '',
    dckHasShots: shots > 0,
    dckForgetGo: () => this.dckForget(), dckForgetOff: busy,
  };
}
