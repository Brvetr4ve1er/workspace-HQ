// Projects › Clients, renderer side (batch 2 rest, dish "delivery-clients"). Main owns the data (dashboard/delivery-clients.js →
// hq:delivery:clients: one row per project marked as a client job, counts and words only); this mixin reads the list when the
// sub-view is opened, sorts it, and sends the owner to a project's page. It never writes anything.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// Reads happen ON ARRIVAL at the Clients sub-view (clsArrive), never at boot and never while another sub-view is open — the
// Cosmos slice rule. The list lives in component state (`cls`), not in the live store: no store edit is needed.
// State: cls = { rows: null | [row], omitted, error, loaded, busy, at }.  Usage marks ('clients-list': 'open' on arrival, 'act' on
// Open card) go through useMark, which counts once per arrival and does nothing where hq.use is absent.
// Rows from main are re-checked here (clsClean): an unknown linkState or a non-number count never reaches the screen as junk.
export const CLS_OFF = 'The Clients list needs the desktop app';
export const CLS_SURFACE = 'clients-list';
export const LINK_STATES = ['ready-production', 'ready-preview', 'not-ready', 'none'];

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
const ms = (iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };

// one row from main, made safe. null when it has no id.
export function clsCleanRow(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const total = num(r.total), done = Math.min(num(r.done), total);
  return {
    id: r.id.slice(0, 200), name: str(r.name, 200) || r.id.slice(0, 200), mode: str(r.mode, 20) || 'client', done, total,
    linkState: LINK_STATES.includes(r.linkState) ? r.linkState : 'none',
    lastCopyAt: ms(r.lastCopyAt) === null ? null : r.lastCopyAt,
    fileState: typeof r.fileState === 'string' && r.fileState ? r.fileState.slice(0, 20) : null,
    inScan: r.inScan !== false,
  };
}
export function clsCleanRows(rows) { return (Array.isArray(rows) ? rows : []).map(clsCleanRow).filter(Boolean); }

// what is left to do: a scope with items has total - done; no scope and a file problem have nothing to count
export const clsLeft = (r) => (r.inScan && r.total > 0 ? r.total - r.done : 0);

// most left to do first, then the oldest update (never copied is the oldest), then name; a client gone from the scan sorts last
export function sortClients(rows) {
  return rows.slice().sort((a, b) => {
    if (a.inScan !== b.inScan) return a.inScan ? -1 : 1;
    const l = clsLeft(b) - clsLeft(a);
    if (l) return l;
    const ta = ms(a.lastCopyAt) === null ? -Infinity : ms(a.lastCopyAt), tb = ms(b.lastCopyAt) === null ? -Infinity : ms(b.lastCopyAt);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const n = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    return n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export const clientsListLogic = {
  clsOn() { const S = this.state || {}; return S.tab === 'projects' && !!S.sub && S.sub.projects === 'clients'; },
  clsCan() { return !!(this.hq && this.hq.delivery && typeof this.hq.delivery.clients === 'function') && (typeof this.ps !== 'function' || this.ps() !== 'nobridge'); },
  _clsSet(patch) { this.setState((s) => ({ cls: Object.assign({}, s.cls, patch) })); },
  _clsMark(action) { try { if (typeof this.useMark === 'function') this.useMark(CLS_SURFACE, action); } catch { /* a mark never blocks the list */ } },

  // arriving on Projects › Clients (a click on the sub-tab, a route, a restored session): mark it and read the list. Anywhere else: nothing.
  clsArrive() {
    if (!this.clsOn()) return Promise.resolve(null);
    this._clsMark('open');
    return this.clsRead();
  },

  // one read at a time: a double click on Retry is one call. A later error keeps the rows already shown (and says so).
  async clsRead() {
    if (!this.clsCan()) return { error: CLS_OFF };
    if (this._clsBusy) return null;
    this._clsBusy = true;
    this._clsSeq = (this._clsSeq || 0) + 1;
    const seq = this._clsSeq;
    this._clsSet({ busy: true });
    let r;
    try { r = await this.hq.delivery.clients(); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    this._clsBusy = false;
    if (seq !== this._clsSeq) return null;
    if (r && typeof r === 'object' && !r.error && Array.isArray(r.clients)) {
      this._clsSet({ rows: clsCleanRows(r.clients), omitted: num(r.omitted), error: '', loaded: true, busy: false, at: str(r.generatedAt, 40) });
      return r;
    }
    const error = (r && typeof r.error === 'string' && r.error.slice(0, 200)) || 'The client list could not be read';
    this._clsSet({ error, loaded: true, busy: false });
    return { error };
  },

  // Open card: the project's own page (the existing openProject route), then the delivery card is scrolled into view. A row that is
  // not in the latest scan has no button; if the snapshot the screen shows does not know the project either, say so instead of a blank page.
  clsOpen(id) {
    if (!id || typeof this.openProject !== 'function') return false;
    if (typeof this.proj === 'function' && !this.proj(id)) { if (typeof this.toast === 'function') this.toast('error', 'That project is not in the current scan'); return false; }
    this._clsMark('act');
    this.openProject(id);
    this._clsScrollToCard();
    return true;
  },
  // the card renders after the route change; wait a beat. Without a document (a test rig) there is nothing to scroll.
  _clsScrollToCard() {
    try {
      if (typeof document === 'undefined' || typeof setTimeout !== 'function') return;
      setTimeout(() => {
        try { const el = document.querySelector('[data-dlv="card"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); } catch { /* the page is already open */ }
      }, 180);
    } catch { /* a scroll is a nicety */ }
  },
};
