// Render values for the since-last-scan card, notifications, onboarding, the
// confirm sheet and the level-up card. Holds the RECONSTRUCTED note (below,
// verbatim) that the other src/vals/*.js files point to.

export function overlaysVals(ctx) {
  const { S, H, live, ps, snap, unc, TK } = ctx;
  // ----- level-up stat card (measured) -----
  // the same measured stats the saved PNG shows (logic/stat-card.js)
  const lvl = S.levelUp ? { l: S.levelUp.l, t: S.levelUp.t, stats: this.statCardStats() } : {};
  // ----- since last scan / notifications -----
  const latest = H.at(0);
  const since = latest.changes.slice(0, 6).map((c) => ({ g: c.g, t: c.t, c: c.c, open: c.proj ? () => this.openProject(c.proj) : () => this.go('history', 'timeline') }));
  const notes = (S.notifLog || []).map((n) => ({ t: n.text, d: 'Today ' + n.at, c: TK[n.kind] })).concat(latest.changes.map((c) => ({ t: c.t, d: H.fmtD(latest.day) + ' scan', c: c.c })));
  return {
    showSince: live && ps === 'live' && !S.sinceDismissed && since.length > 0, dismissSince: () => this.setState({ sinceDismissed: true }), since, sinceLabel: 'since the last scan · ' + H.fmtD(latest.day) + (latest.at ? ', ' + new Date(Date.parse(latest.at)).toTimeString().slice(0, 5) : ''),
    notes,
    onboardOpen: !!S.onboard, ob: S.onboard ? Object.assign({}, S.onboard, { s1: S.onboard.step === 1, s2: S.onboard.step === 2, s3: S.onboard.step === 3, notS1: S.onboard.step > 1, notS3: S.onboard.step < 3, stepLabel: 'step ' + S.onboard.step + ' of 3', dots: [1, 2, 3].map((n) => ({ c: n <= S.onboard.step ? 'var(--gold)' : 'var(--frame)' })) }) : {},
    openOnboard: () => { if (!this.canWrite()) return this.denied(); this.setState({ onboard: { step: 1, path: '', dev: 'npm run dev', branch: 'main', name: '' } }); },
    closeOnboard: () => this.setState({ onboard: null }), obNext: () => this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { step: Math.min(3, st.onboard.step + 1) }) })), obBack: () => this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { step: Math.max(1, st.onboard.step - 1) }) })),
    // ---- RECONSTRUCTED (not from the Design export) --------------------------------
    // The Claude Design file was cut off at the 256 KiB API cap partway through the
    // prototype's renderVals(), right after `openOnboard`. Every value from here to the
    // end of `out` (onboarding steps, shell buttons, palette/ask/overlay values, the
    // palette placeholder and ask examples) and the helpers obSet / finishOnboard in
    // app.js were rebuilt from how the template uses them. If a full export arrives,
    // diff this block against the original tail and prefer the original's copy.
    obPath: (e) => this.obSet('path', e), obName: (e) => this.obSet('name', e), obDev: (e) => this.obSet('dev', e), obBranch: (e) => this.obSet('branch', e), obFinish: () => this.finishOnboard(),
    // (Since the F2 split, `out` is assembled from src/vals/*.js; the keys this note covers
    // that live in other files are marked there with a RECONSTRUCTED pointer.)
    hasSheet: !!S.sheet, sheet: S.sheet || {}, sheetDanger: !!(S.sheet && S.sheet.danger), sheetSafe: !!(S.sheet && !S.sheet.danger), cancelSheet: () => this.setState({ sheet: null }), sheetOk: () => this.sheetOk(),
    hasLevel: !!S.levelUp, lvl, closeLevel: () => this.setState({ levelUp: null }),
  };
}
