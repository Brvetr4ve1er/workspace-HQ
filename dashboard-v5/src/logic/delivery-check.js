// Client delivery check, renderer side (batch 2, dish "delivery-check"). Main owns the work (dashboard/delivery-check.js →
// hq:delivery-check:detect|run|read|forget through the preload group hq.deliveryCheck); this mixin only sends the owner's
// intents. The owner confirms the URL: a different app on port 3000 is never checked by accident, and main checks the
// address again (only a dev server on this PC). Nothing is read at boot: the project page asks on arrival, one project at a time.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State: dck = { pid, url, detect, report, phase, err }
//   pid      the project the rest belongs to (a stale answer for another project is dropped)
//   url      the address field's text (prefilled from detect, always editable)
//   detect   null (not looked yet) | { state: 'ready'|'nothing-answering', startedHere, candidates, hasCommand }
//   report   the last stored report for this project, or null
//   phase    'idle' | 'detecting' | 'running' | 'forgetting' (one thing at a time: a double click is one call)
//   err      the last honest error line, shown under the field
// The use log gets one 'act' mark on surface 'delivery-check' per Check; nothing is sent anywhere.

export const DCK_OFF = 'Needs the live app — the phone and language check is unavailable in this preview';
const BLANK = (pid) => ({ pid, url: '', detect: null, report: null, phase: 'idle', err: '' });

export const deliveryCheckLogic = {
  dckPid() { return (this.state.route && this.state.route.id) || null; },
  dckState() { const d = this.state.dck; return d && d.pid === this.dckPid() ? d : BLANK(this.dckPid()); },
  dckCan() { return !!(this.hq && this.hq.deliveryCheck) && this.ps() !== 'nobridge'; },
  dckSet(pid, patch) {
    // a late answer for a project the owner has already left is dropped, never written over the new page
    if (this.dckPid() !== pid) return;
    this.setState((s) => ({ dck: Object.assign({}, s.dck && s.dck.pid === pid ? s.dck : BLANK(pid), patch) }));
  },
  dckUseMark(action) { try { if (typeof this.useMark === 'function') this.useMark('delivery-check', action); } catch { /* a mark never blocks the check */ } },

  // arriving on a project page (dlvArrive's paths also call this): start from a clean slate for this project and read the last
  // report (a file read in main). The dev-server probe is for client jobs only, so it waits for the delivery card to say so.
  // `after` (optional): the promise of the delivery card's read (dlvArrive returns it); the card's answer says whether this is a client job
  dckArrive(id, after) {
    if (!id) return Promise.resolve(null);
    this.setState({ dck: BLANK(id) });
    if (!this.dckCan()) return Promise.resolve(null);
    const read = this.dckRead(id);
    const ensure = () => (this.dckPid() === id ? this.dckEnsure() : null);
    return Promise.all([read, after && typeof after.then === 'function' ? after.then(ensure, ensure) : ensure()]);
  },
  // idempotent: once the delivery card says this is a client job, look for the dev server once
  dckEnsure() {
    const d = this.dckState();
    const view = typeof this.dlvView === 'function' ? this.dlvView() : null;
    if (!this.dckCan() || !view || !view.client || d.detect || d.phase !== 'idle') return Promise.resolve(null);
    return this.dckDetect();
  },

  async dckRead(pid) {
    try {
      const r = await this.hq.deliveryCheck.read(pid);
      this.dckSet(pid, { report: r && !r.error && r.v === 1 ? r : null });
      return r || null;
    } catch { return null; }   // no stored report is an honest "not checked yet", not an error
  },

  // one thing at a time: a second click while one is in flight returns without a second call
  async dckGuard(phase, fn) {
    const pid = this.dckPid();
    if (!pid) return null;
    if (this._dckBusy) return null;
    if (!this.dckCan()) { this.denied(DCK_OFF); return null; }
    this._dckBusy = true;
    this.dckSet(pid, { phase, err: '' });
    try { return await fn(pid); }
    catch (e) { this.dckSet(pid, { err: String((e && e.message) || e).slice(0, 200) }); return null; }
    finally { this._dckBusy = false; this.dckSet(pid, { phase: 'idle' }); }
  },

  dckField(value) { const pid = this.dckPid(); if (pid) this.dckSet(pid, { url: String(value == null ? '' : value).slice(0, 200), err: '' }); },

  // look for the dev server: probes the usual local ports in main; prefills the field when one answers and the owner has typed nothing
  dckDetect() {
    return this.dckGuard('detecting', async (pid) => {
      const r = await this.hq.deliveryCheck.detect(pid);
      if (!r || r.error) { this.dckSet(pid, { err: (r && r.error) || 'Could not look for the dev server' }); return null; }
      const typed = this.dckState().url;
      this.dckSet(pid, { detect: r, url: typed || (r.state === 'ready' && r.candidates[0] ? r.candidates[0].origin : '') });
      return r;
    });
  },

  // Check: the field's address goes to main as typed (main refuses anything but a loopback dev server)
  dckRun() {
    const url = String(this.dckState().url || '').trim();
    if (!url) { this.toast('error', 'Type the address of the dev server first'); return Promise.resolve(null); }
    return this.dckGuard('running', async (pid) => {
      this.dckUseMark('act');
      const r = await this.hq.deliveryCheck.run(pid, url);
      if (!r || r.error) { this.dckSet(pid, { err: (r && r.error) || 'The check did not finish' }); return null; }
      this.dckSet(pid, { report: r });
      return r;
    });
  },

  dckForget() {
    return this.dckGuard('forgetting', async (pid) => {
      const r = await this.hq.deliveryCheck.forget(pid);
      if (r && r.error) { this.dckSet(pid, { err: r.error }); return null; }
      this.dckSet(pid, { report: null });
      this.toast('info', 'Check results forgotten');
      return r;
    });
  },
};
