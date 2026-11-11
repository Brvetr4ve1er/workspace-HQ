// System › Machine › "How the PC changed" — the renderer side. Main owns the data (dashboard/machine-history.js → hq:machine-history:read:
// a copy of the collector's rolling check history plus what-grew lines from dashboard/disk-history.js); this mixin only asks, holds
// the last answer and runs the opt-in disk estimate. It never writes anything.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State is ONE object, `dft` (so the shared edit in src/app.js is a single line: `dft: dftInit()`; a missing `dft` reads as the initial one):
//   { rows: null | [row], disk: null | { lines, note }, counts: null | { rows, dropped, diskDays },
//     loaded: main has answered once, busy: a read is in flight, error: main's own words for the last failed read (the last rows stay), est: null | estimateDisk() answer }
//
// Reads happen when System › Machine OPENS (dftEnsure: once per opening, deferred so no state is set while rendering) and again after a
// Re-examine finishes (dftWatch sees sysExamining fall) — never at boot, never while another screen is open. A read that fails keeps the
// previous rows on screen and says why; the estimate is opt-in (a button) and is dropped whenever fresh rows arrive.
import { estimateDisk } from '../live/machine-history.mjs';

export const DFT_SURFACE = 'machine-drift';
export const DFT_OFFLINE = 'The machine history needs the desktop app';

export const dftInit = () => ({ rows: null, disk: null, counts: null, loaded: false, busy: false, error: '', est: null });

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 200);
const int = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

/** main's disk part made safe: lines of { label, deltaGB, days } only, and a note. */
export function cleanDisk(d) {
  const src = isObj(d) ? d : {};
  const lines = (Array.isArray(src.lines) ? src.lines : [])
    .filter((l) => isObj(l) && typeof l.label === 'string' && l.label && typeof l.deltaGB === 'number' && Number.isFinite(l.deltaGB))
    .slice(0, 5)
    .map((l) => ({ label: l.label.slice(0, 80), deltaGB: l.deltaGB, days: Math.max(1, int(l.days)) }));
  return { lines, note: typeof src.note === 'string' ? src.note.slice(0, 300) : '' };
}

export const driftLogic = {
  dftCan() {
    const api = this.hq && this.hq.machineHistory;
    return !!(api && typeof api.read === 'function');
  },
  dftState() { return (this.state && this.state.dft) || dftInit(); },
  _dftPatch(p) { this.setState({ dft: { ...this.dftState(), ...p } }); },

  /** Called from the panel's render values while System › Machine is open: one read per opening. */
  dftEnsure() {
    if (this._dftAsked) return;
    this._dftAsked = true;
    setTimeout(() => this.dftLoad(), 0);   // never set state while rendering
  },
  /** System › Machine closed: the next opening reads fresh. */
  dftRearm() { this._dftAsked = false; this._dftExam = false; },
  /** Called every render with whether Re-examine is running: when it finishes, the history is read again. */
  dftWatch(examining) {
    const was = this._dftExam === true;
    this._dftExam = !!examining;
    if (was && !examining) { this._dftAsked = false; this.dftEnsure(); }
  },

  async dftLoad() {
    if (!this.dftCan()) return false;
    if (this._dftReading) { this._dftAgain = true; return false; }   // a read is in flight: one more follows it, never two at once
    this._dftReading = true;
    this._dftPatch({ busy: true });
    let r;
    try { r = await this.hq.machineHistory.read(); }
    catch (e) { r = { error: msg(e) }; }
    finally { this._dftReading = false; }
    let ok = false;
    if (r && r.ok === true && Array.isArray(r.rows)) {
      const c = isObj(r.counts) ? r.counts : {};
      this._dftPatch({ rows: r.rows, disk: cleanDisk(r.disk), counts: { rows: int(c.rows), dropped: int(c.dropped), diskDays: int(c.diskDays) }, loaded: true, busy: false, error: '', est: null });
      ok = true;
    } else {
      this._dftPatch({ busy: false, error: (r && typeof r.error === 'string' && r.error) ? r.error.slice(0, 200) : 'no answer' });
    }
    if (this._dftAgain) { this._dftAgain = false; await this.dftLoad(); }
    return ok;
  },

  /** The opt-in "Estimate" button on the disk chart: shows the answer (or the refusal, in words); pressed again it hides it. */
  dftEstimate() {
    const d = this.dftState();
    if (d.est) { this._dftPatch({ est: null }); return null; }
    if (!Array.isArray(d.rows)) return null;
    const est = estimateDisk(d.rows);
    this._dftPatch({ est });
    try { if (typeof this.useMark === 'function') this.useMark(DFT_SURFACE, 'act'); } catch { /* a usage mark is a bonus, never a failure */ }
    return est;
  },
};
