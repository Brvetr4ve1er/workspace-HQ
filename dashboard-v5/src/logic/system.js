// System › Machine / Workspace clutter actions (v3 Med-Bay parity), plus the
// "add to ideas" capture both System and the project page use.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State keys (K-4: app.js declares initial state; an undefined key is its default here):
//   sysExamining  true while hq.healthScan() runs (Re-examine → "Scanning…")
//   sysSaves      { [capture text]: 'saving' | 'noted' | 'failed' } per "Note for cleanup" /
//                 "Add to ideas" button; the window usually reloads before 'noted' shows
//   fixed         issue ids a safe fix ran ok:true on this session (hidden until Re-examine)
import { FX, normText } from './shared.js';

export const CAPTURE_OFF = 'Needs the live app — capture is unavailable in this preview';
export const ALREADY_IDEA = 'Already in your ideas';
export const SCAN_TIP = 'Run a fresh health scan of this machine (~3s)';
export const SCAN_OFF = 'Needs the live app — the health scan is unavailable in this preview';
const errText = (e) => { try { return String((e && e.message) || e); } catch { return 'unknown error'; } };

// Every issue System › Machine lists: the pc-health organs (model ISSUES) plus the local
// model when the probe says it is down or has no chat model. One list for the verdict
// (vals/system.js) and the Re-examine toast, so the two can't disagree.
export function machineIssues(issues, llm) {
  const down = !!llm && (!llm.available || !llm.chatModel);
  const llmIssue = down ? [{ id: 'llm', title: llm.available ? 'No local chat model installed' : 'Local model runtime is not running', why: 'Commit drafts fall back to Claude, which uses quota; Ask can’t answer.', fix: llm.available ? 'Pull a chat model with Ollama' : 'Start Ollama', cmd: llm.available ? 'ollama pull qwen2.5:7b-instruct-q4_K_M' : 'ollama serve', safe: false }] : [];
  return (Array.isArray(issues) ? issues : []).concat(llmIssue);
}

// The verdict over machineIssues(), in System's order: open issues, then fixes that ran
// this session but weren't re-checked, then no machine check at all (no pc-health data
// and no Re-examine), else OK. The status rail's Machine card (vals/shell.js) shows this,
// so it can't say "Machine OK" while System says otherwise. vals/system.js states the
// same rule inline; sysproj.test.mjs checks the two agree.
//   all: machineIssues(…) · fixed: state.fixed · scannedAt: model pcScannedAt · fresh: a Re-examine report is loaded
// label = System's verdict text; short = the rail card's ("2 issues"), the same verdict in fewer words
export function machineVerdict(all, fixed, { scannedAt, fresh } = {}) {
  const list = Array.isArray(all) ? all : [], done = Array.isArray(fixed) ? fixed : [];
  const open = list.filter((i) => !done.includes(i.id)).length, fixedN = list.length - open;
  const v = (state, label, color, short) => ({ state, n: open, label, short: short || label, color });
  if (open) { const n = open + ' issue' + (open > 1 ? 's' : ''); return v('issues', n + ' to look at', 'var(--orange)', n); }
  if (fixedN) return v('unconfirmed', 'Fixes ran · not re-checked yet', 'var(--blue)');
  if (!scannedAt && !fresh) return v('unchecked', 'Not checked yet', 'var(--muted)');
  return v('ok', 'Machine OK', 'var(--green)');
}

export const systemLogic = {
  // the live bridge can run a health scan (the selftest's preview states have none)
  canHealthScan() { return !!(this.hq && this.hq.healthScan) && this.ps() !== 'nobridge'; },
  canCapture() { return !!(this.hq && this.hq.captureSave) && this.ps() !== 'nobridge'; },

  // Re-examine (v3 medbay scanButton): hq.healthScan() answers the fresh
  // pc-health.json, {error} or null, and does NOT reload the window — so the store
  // is refreshed here, and the fixed set is cleared (the new report is the truth).
  async reexamine() {
    if (this.state.sysExamining) return;
    if (!this.canHealthScan()) return this.denied(SCAN_OFF);
    this.setState({ sysExamining: true });
    let r = null, why = '';
    try { r = await this.hq.healthScan(); } catch (e) { why = errText(e); }
    this.setState({ sysExamining: false });
    if (r && typeof r === 'object' && !r.error && Array.isArray(r.organs)) {
      this.store.refreshMachine(r);
      this.setState({ fixed: [] });
      // the same count the verdict shows (organs + the local model), not the organs alone
      const n = machineIssues(this.M.ISSUES, this.LIVE.llm).length;
      this.toast('success', 'Re-examined · ' + (n ? n + ' issue' + (n === 1 ? '' : 's') + ' to look at' : 'nothing flagged'));
      return;
    }
    // {error}: the scan script failed · null / no organs: no report came back · throw: the call failed
    const reason = why || (r && r.error ? String(r.error) : 'the scan returned no report');
    this.toast('error', 'Re-examine failed · ' + reason, { ms: 6000 });
    FX().sfx('error');
  },

  // a safe-listed fix ran ok: hide its issue until the next Re-examine. The fix confirm
  // (logic/sheet.js sheetOk) calls this with the sheet's issueId when main answers ok:true;
  // a fix sheet without one (not opened from System) passes undefined, which is a no-op.
  markFixed(id) {
    if (!id) return;
    this.setState((s) => { const f = s.fixed || []; return f.includes(id) ? null : { fixed: f.concat([id]) }; });
  },

  // A capture text that is already one of your ideas (an open captured side quest in the
  // latest scan, same text up to case / spacing / trailing punctuation). sysSaves is
  // in-memory and the reload captureSave forces wipes it, so "noted" has to come from the
  // data: without this, the clutter row's button was live again after the reload and each
  // click appended another copy to the brain dump (main doesn't dedupe).
  capturedIdea(text) {
    const k = normText(text);
    if (!k) return false;
    const ideas = (this.M && this.M.IDEAS) || [];
    if (this._capKeysOf !== ideas) { this._capKeysOf = ideas; this._capKeys = new Set(ideas.filter((i) => i && i.capture).map((i) => normText(i.title))); }
    return this._capKeys.has(k);
  },

  // "Note for cleanup" / "Add to ideas" (v3 capture:note): hq.captureSave(text)
  // appends to the brain dump, re-assembles and RELOADS this window, and the note
  // becomes an idea after that. So the toast goes out before the call, and nothing
  // after the await is relied on: it only shows when main said no (false / throw)
  // or the window didn't reload (the fake bridge). Answers true when saved.
  async saveIdea(text, what) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (!this.canWrite()) { this.denied(); return false; }
    if (!this.canCapture()) { this.denied(CAPTURE_OFF); return false; }
    if (this.capturedIdea(t)) { this.toast('info', ALREADY_IDEA + ' · “' + t + '”'); return false; }
    const cur = (this.state.sysSaves || {})[t];
    if (cur === 'saving' || cur === 'noted') return false;
    const mark = (st) => this.setState((s) => ({ sysSaves: Object.assign({}, s.sysSaves, { [t]: st }) }));
    mark('saving');
    this.toast('info', (what || 'Adding to your ideas') + ' · “' + t + '” · the window will refresh', { ms: 6000 });
    let ok = null, why = '';
    try { ok = await this.hq.captureSave(t); } catch (e) { why = errText(e); }
    if (ok === true) { mark('noted'); return true; }
    mark('failed');
    this.toast('error', 'Not saved · ' + (why || 'the note was refused') + ' — retry', { ms: 6000 });
    FX().sfx('error');
    return false;
  },
  // the button state for one capture text: label, disabled, tooltip
  saveButton(text, idle, tip) {
    const st = (this.state.sysSaves || {})[String(text || '').trim()];
    if (!this.canCapture()) return { btn: idle, off: true, tip: CAPTURE_OFF };
    if (!this.canWrite()) return { btn: idle, off: true, tip: this.writeReason() };
    if (st === 'saving') return { btn: 'Saving…', off: true, tip: '' };
    if (st === 'noted') return { btn: 'Noted', off: true, tip: 'Saved · it shows in your ideas after the refresh' };
    if (this.capturedIdea(text)) return { btn: 'Noted', off: true, tip: ALREADY_IDEA };
    if (st === 'failed') return { btn: '✗ Not saved — retry', off: false, tip: 'Not saved. Click to retry.' };
    return { btn: idle, off: false, tip };
  },
};
