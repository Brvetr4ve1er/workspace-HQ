// Client delivery card on the project page, renderer side (the 2026-11-07 client-delivery item). Main owns the data
// (dashboard/delivery.js → hq:delivery:*); this mixin only sends the owner's intents and copies text. Nothing is sent
// to anyone: "Copy update" puts text on the owner's clipboard, then records that it was copied.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// Store contract (live/store.js, the integrator's edit): store.applyDelivery(intent) → the view | { error } and
//   store.refreshDelivery(projectId); the slice is LIVE.delivery = { byProject, error, loaded }.
// State: dlv = { draft, ms } (the add-item form; dlvAdd(over) lets an Enter key pass the field value it just saw), dlvBusy mirrors the in-flight guard so buttons grey out.
// Intents carry only the owner's form fields and a project id: ids, timestamps and hashes are minted in main.

export const DLV_OFF = 'Needs the live app — client delivery is unavailable in this preview';

export const deliveryLogic = {
  dlvPid() { return (this.state.route && this.state.route.id) || null; },
  dlvView() { const D = (this.LIVE && this.LIVE.delivery) || {}; const id = this.dlvPid(); return id && D.byProject ? D.byProject[id] || null : null; },
  dlvCan() { return !!(this.hq && this.hq.delivery) && this.ps() !== 'nobridge'; },
  dlvField(key, value) { this.setState((s) => ({ dlv: Object.assign({}, s.dlv, { [key]: value }) })); },

  // arriving on a project page: read its card, and count the open (useMark(surface, action): the allowlisted surface 'delivery-card', action 'open' on arrival and 'copy' on Copy update)
  dlvArrive(id) {
    const refreshed = this.store && this.store.refreshDelivery ? this.store.refreshDelivery(id) : null;
    this.dlvUseMark('delivery-card', 'open');
    return refreshed;   // (batch 2) the phone-and-language check waits for the card's answer before it looks for a dev server
  },
  dlvUseMark(surface, action) { try { if (typeof this.useMark === 'function') this.useMark(surface, action); } catch { /* a mark never blocks the card */ } },

  // one write at a time: a double click is one intent, not two
  async dlvGuard(fn) {
    if (this._dlvBusy) return null;
    if (!this.dlvCan()) { this.denied(DLV_OFF); return null; }
    this._dlvBusy = true;
    this.setState({ dlvBusy: true });
    try { return await fn(); }
    catch (e) { this.toast('error', 'Not saved · ' + ((e && e.message) || e)); return null; }
    finally { this._dlvBusy = false; this.setState({ dlvBusy: false }); }
  },
  async dlvSend(intent, fail) {
    const pid = this.dlvPid();
    if (!pid) return null;
    const r = await this.store.applyDelivery(Object.assign({ projectId: pid }, intent));
    if (r && r.error) { this.toast('error', (fail || 'Not saved') + ' · ' + r.error); return null; }
    return r;
  },

  dlvMark(on) { return this.dlvGuard(() => this.dlvSend({ type: 'mark-client', on: !!on }, 'Not changed')); },
  dlvPick(rel) { return this.dlvGuard(() => this.dlvSend({ type: 'set-scope-file', rel: rel || null }, 'Not picked')); },
  dlvToggle(id) { return this.dlvGuard(() => this.dlvSend({ type: 'item-toggle', id }, 'Not changed')); },
  dlvRemove(id) { return this.dlvGuard(() => this.dlvSend({ type: 'item-remove', id }, 'Not removed')); },
  dlvAdd(over) {
    const d = Object.assign({}, this.state.dlv, over), text = String(d.draft || '').trim();
    if (!text) { this.toast('error', 'Write what is in scope first'); return Promise.resolve(null); }
    return this.dlvGuard(async () => {
      const r = await this.dlvSend({ type: 'item-add', text, milestone: String(d.ms || '').trim() || undefined }, 'Not added');
      if (r) this.dlvField('draft', '');   // the milestone stays: the next item usually belongs to it
      return r;
    });
  },

  // copy() first, then ONE 'copied' intent so the next update lists only what was finished since. If a later copy()
  // reports a failed clipboard (a promise resolving false), nothing is recorded.
  dlvCopyUpdate() {
    const v = this.dlvView();
    if (!v || !v.update) return Promise.resolve(null);
    return this.dlvGuard(async () => {
      const done = this.copy(v.update, 'Update copied · nothing was sent');
      if (done && typeof done.then === 'function' && (await done) === false) return null;
      this.dlvUseMark('delivery-card', 'copy');
      // the hashes of the card that was copied from: an item finished after the card loaded is not in the copied text, so it is not recorded as told
      return this.dlvSend(Array.isArray(v.doneHashes) ? { type: 'copied', doneHashes: v.doneHashes } : { type: 'copied' }, 'Copied, but not recorded');
    });
  },
  dlvCopyLink(url) { if (url) this.copy(url, 'Link copied'); },
  // main opens only a Vercel / Supabase link listed in the current accounts snapshot (hq:accounts-open)
  async dlvOpenLink(url) {
    if (!(this.hq && this.hq.accountsOpen) || this.ps() === 'nobridge') return this.denied('Needs the live app — opening a Vercel link is unavailable in this preview');
    await this.call(() => this.hq.accountsOpen(url), 'Couldn’t open that link');
  },
};
