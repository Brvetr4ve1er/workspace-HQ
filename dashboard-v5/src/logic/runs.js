// Automations, runs, dev servers and the full scan.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX, hhmm } from './shared.js';

// "HH:MM" from an ISO string or ms epoch; '' when it doesn't parse
const clock = (t) => { const ms = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(ms) ? hhmm(new Date(ms)) : ''; };

export const runsLogic = {
  // ---- automations (casting engine: confirm-first is enforced in main too) ----
  // background automations first, then the interactive ones (Claude skills/commands, npm dev…):
  // both go through the same confirm-first castSpell; main opens a terminal for the latter
  auto(id) { const M = this.M; return M.AUTOS.find((x) => x.id === id) || (M.INTERACTIVE || []).find((x) => x.id === id) || null; },
  askRun(a) {
    if (!a) return;
    if (!this.canWrite()) return this.denied();
    if (this.state.trusted.includes(a.id) && !a.destructive && this.M.confirmedHashes[a.id] === a.hash) return this.startRun(a);
    // a fresh dialog never carries an earlier answer's hash or command
    this.setState({ confirm: a.id, confirmHash: null, confirmPreview: null, confirmAsk: this.state.trusted.includes(a.id) ? 'never' : 'always', paletteOpen: false }); FX().sfx('open');
  },
  // the hash main sent with its last "confirm first" answer wins over data.js's: the
  // spellbook can change after data.js was built, and re-sending the old hash made
  // main ask again forever
  confirmRun() {
    const S = this.state, a = this.auto(S.confirm);
    if (!a) return this.setState({ confirm: null, confirmHash: null, confirmPreview: null });
    const hash = S.confirmHash || a.hash;   // askRun clears it, so it is always this dialog's
    this.setState((s) => ({ confirm: null, confirmHash: null, confirmPreview: null, trusted: s.confirmAsk === 'never' ? (s.trusted.includes(a.id) ? s.trusted : s.trusted.concat([a.id])) : s.trusted.filter((x) => x !== a.id) }));
    return this.startRun(a, hash);
  },
  // Enter in the run-confirm dialog (app.js onKey, outside text fields). On a focused
  // button the button's own click decides (Enter on Cancel must not run anything).
  // An auto-repeat (Enter held down) is swallowed and never confirms: the press that
  // opened this dialog (palette Enter) or confirmed the one before it (main answered
  // "this command changed", the dialog reopened with focus) must not confirm it unseen.
  confirmKey(e) {
    if (e && e.repeat) { if (typeof e.preventDefault === 'function') e.preventDefault(); return true; }
    const t = e && e.target;
    const onButton = !!t && (String(t.tagName || '').toLowerCase() === 'button' || (typeof t.closest === 'function' && !!t.closest('button')));
    if (onButton) return false;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    this.confirmRun();
    return true;
  },
  async startRun(a, hash) {
    if (!this.hq || !this.hq.castSpell) return this.denied();
    const r = await this.call(() => this.hq.castSpell(a.id, hash), 'Run failed');
    if (!r) return;
    if (r.confirm_required) {
      const pv = r.preview && typeof r.preview === 'object' ? r.preview : {};
      const h = pv.content_hash ? String(pv.content_hash) : null;
      const cmd = [pv.command].concat(Array.isArray(pv.args) ? pv.args : []).filter(Boolean).join(' ');
      this.setState({ confirm: a.id, confirmAsk: 'always', confirmHash: h, confirmPreview: h ? { id: a.id, cmd, dir: pv.cwd ? String(pv.cwd) : '' } : null });
      this.toast('info', 'This command changed since you last ran it · check it, then run');
      return;
    }
    if (r.channeled) { this.setState((s) => ({ localRuns: [{ id: 't' + Date.now(), name: a.name, status: 'opened', meta: 'Terminal opened · ' + a.cmd, started: this.hhmm(), out: ['Opened in an external terminal; output stays there.'] }].concat(s.localRuns) })); this.toast('info', 'Opened in a terminal — output stays there'); return; }
    this.toast('progress', 'Running · ' + a.name, { runSpell: a.id });
    FX().sfx('run'); FX().event('look', 'Watching ' + a.name.toLowerCase() + '…');
  },
  // called on every store change (app.js): one toast per finished cast, and the
  // scan's progress toast is replaced when a scan this window watched ends
  announceRuns() {
    for (const c of Object.values(this.LIVE.casts)) {
      if (!c.done || c.announced) continue;
      c.announced = true;
      this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== c.spellId) }));
      if (c.status === 'ok') { this.toast('success', c.name + ' finished'); FX().sfx('done'); FX().event('cheer', 'Run finished.'); }
      else { this.toast('error', c.name + ' failed · ' + (c.meta || '')); FX().sfx('error'); }
    }
    const sc = this.scanStatus();
    if (sc.running) this._scanWatch = true;
    else if (this._scanWatch) {   // a scan that was running in this window has ended
      this._scanWatch = false;
      this.setState((s) => ({ toasts: s.toasts.filter((t) => !t.scan) }));
      if (sc.failed) { this.toast('error', sc.label + ' · see workspace hq/logs', { ms: 8000 }); FX().sfx('error'); }
    }
  },
  cancelRun(spellId) {
    if (!spellId || !this.hq || !this.hq.cancelCast) return;
    this.hq.cancelCast(spellId);
    this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== spellId) }));
    this.toast('info', 'Cancelling…');
  },
  async stopDev(id) {
    if (!this.hq || !this.hq.devStop) return this.denied();
    let r;
    try { r = await this.hq.devStop(id); }
    catch (e) { this.toast('error', 'Couldn’t stop the dev server · ' + ((e && e.message) || e)); return; }
    if (r === false) this.toast('info', 'That dev server wasn’t running');
    else this.toast('info', 'Dev server stopped · ' + this.pname(id));
  },
  // C-2: the full scan's state, from LIVE.scan (hq.liveState() at boot, then
  // hq:scan-status pushes) — so it survives the reload and a failure is visible.
  scanStatus() {
    const s = this.LIVE && this.LIVE.scan && typeof this.LIVE.scan === 'object' ? this.LIVE.scan : null;
    const st = s ? s.state : null;
    const running = st === 'running', failed = st === 'failed', done = st === 'done';
    const code = s && s.code != null ? s.code : null;
    const startedAt = (s && s.startedAt) || null, endedAt = (s && s.endedAt) || null;
    const why = code != null && code >= 0 ? ' (exit ' + code + ')' : code === -1 ? ' (it didn’t start)' : '';
    const since = clock(startedAt);
    const label = running ? (since ? 'Scanning since ' + since : 'Scanning…') : failed ? 'Last scan failed' + why : '';
    return { running, failed, done, code, startedAt, endedAt, label, error: (s && s.error) ? String(s.error) : '' };
  },
  // LIVE.scan only says "running" once main's hq:scan-status push arrives, so a second click
  // before that is held off by _scanStarting until hq.runScan() answers. A refusal removes
  // only this click's progress toast, and says why from main's scan state: main also
  // answers false when the spawn itself failed (state 'failed'), which is not "already running".
  scanNow() {
    if (!this.canWrite()) return this.denied();
    if (this.scanStatus().running) { this.toast('info', 'A scan is already running'); return; }
    if (this._scanStarting) return;   // this window's own start is in flight: its toast is already up
    if (!this.hq.runScan) return this.denied('This window can’t start a scan');
    this.setState({ paletteOpen: false });
    const tid = this.toast('progress', 'Scanning every project · the window reloads when it’s done', { scan: true });
    FX().sfx('run'); FX().event('look', 'Scanning…');
    this._scanStarting = true;
    const refused = () => { const sc = this.scanStatus(); return sc.running ? 'A scan is already running' : 'The scan didn’t start' + (sc.error ? ' · ' + sc.error : ''); };
    return Promise.resolve().then(() => this.hq.runScan()).then(
      (r) => { if (r === false) { this.dismissToast(tid); this.toast(this.scanStatus().running ? 'info' : 'error', refused()); } },
      (e) => { this.dismissToast(tid); this.toast('error', 'The scan didn’t start · ' + ((e && e.message) || e)); })
      .finally(() => { this._scanStarting = false; });
  },
};
