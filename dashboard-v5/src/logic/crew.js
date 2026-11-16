// Claude > Crew, renderer side (batch 8). Main owns the data (dashboard/crew.js -> hq:crew:read: installed skills as plain rows) and the
// launch (hq:crew:start: a terminal session that begins "Use the <id> skill to help me with:", always in default permission mode); this
// mixin reads on ARRIVAL at the Crew view (never at boot, never while another view is open), searches, pages, and forwards a Start click.
// It never decides what a skill is or what a session says. Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State (component state `crw`): { rows: null | [row], roles, error, loaded, busy, at, q, page, open }.
// Usage marks (dashboard/use-log.js): 'crew' open once per arrival; 'crew-start' act only for a session main reports as launched (once a
// minute per skill, useActOnce). Settings choices are never an act and this view has none.
import { CRW_OFF, crwCleanRoster, crwCleanQuery } from './crew-view.mjs';

export const CRW_SURFACE = 'crew';
export const CRW_START_SURFACE = 'crew-start';
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');

export const crewLogic = {
  crwOn() { const S = this.state || {}; return S.tab === 'claude' && !S.route && !!S.sub && S.sub.claude === 'crew'; },
  crwCan() { return !!(this.hq && this.hq.crew && typeof this.hq.crew.read === 'function') && (typeof this.ps !== 'function' || this.ps() !== 'nobridge'); },
  _crwSet(patch) { this.setState((s) => ({ crw: Object.assign({}, s.crw, patch) })); },
  _crwMark(action) { try { if (typeof this.useMark === 'function') this.useMark(CRW_SURFACE, action); } catch { /* a mark never blocks the view */ } },

  // arriving on Claude > Crew: mark it and read the roster. Anywhere else: nothing.
  crwArrive() {
    if (!this.crwOn()) return Promise.resolve(null);
    this._crwMark('open');
    return this.crwRead();
  },

  // one read at a time; a later error keeps the rows already shown (and says so)
  async crwRead() {
    if (!this.crwCan()) return { error: CRW_OFF };
    if (this._crwBusy) return null;
    this._crwBusy = true;
    this._crwSeq = (this._crwSeq || 0) + 1;
    const seq = this._crwSeq;
    this._crwSet({ busy: true });
    let r;
    try { r = await this.hq.crew.read(); } catch { r = { error: 'the crew could not be read' }; }
    this._crwBusy = false;
    if (seq !== this._crwSeq) return null;
    if (r && typeof r === 'object' && !r.error && Array.isArray(r.skills)) {
      const c = crwCleanRoster(r);
      this._crwSet({ rows: c.rows, roles: c.roles, error: '', loaded: true, busy: false, at: str(r.generatedAt, 40), page: 1 });
      return r;
    }
    const error = (r && typeof r.error === 'string' && r.error.slice(0, 120)) || 'the crew could not be read';
    this._crwSet({ error, loaded: true, busy: false });
    return { error };
  },

  crwQuery(e) { this._crwSet({ q: crwCleanQuery(e && e.target ? e.target.value : ''), page: 1 }); },
  crwClear() { this._crwSet({ q: '', page: 1 }); },
  crwMorePage() { this.setState((s) => ({ crw: Object.assign({}, s.crw, { page: ((s.crw && s.crw.page) || 1) + 1 }) })); },
  crwToggleRole(id) { this.setState((s) => { const c = s.crw || {}; return { crw: Object.assign({}, c, { open: Object.assign({}, c.open, { [id]: !(c.open && c.open[id]) }) }) }; }); },

  // One Start. A double click is one call: the id stays busy until main answers. Every refusal is main's own fixed words.
  async crwStart(row) {
    if (!row || !row.canStart || !row.id) return false;
    if (!this.crwCan() || typeof this.hq.crew.start !== 'function') { this.toast('error', CRW_OFF); return false; }
    this._crwStarting = this._crwStarting || new Set();
    if (this._crwStarting.has(row.id)) return false;
    this._crwStarting.add(row.id);
    this.setState({ crwBusy: [...this._crwStarting] });
    try {
      const r = await this.hq.crew.start(row.id);
      if (r && r.error) { this.toast('error', 'Not started · ' + str(r.error, 120)); return false; }
      if (!r || r.ok !== true) { this.toast('error', 'Not started'); return false; }
      try { this.useActOnce(CRW_START_SURFACE, row.id, 'act'); } catch { /* a mark never blocks the toast */ }
      this.toast('success', 'Opened a Claude terminal with the ' + row.name + ' skill');
      return true;
    } catch { this.toast('error', 'Not started'); return false; }
    finally { this._crwStarting.delete(row.id); this.setState({ crwBusy: [...this._crwStarting] }); }
  },
};
