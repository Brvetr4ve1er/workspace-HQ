// Claude › Prompts › Candidates actions (spec 2026-10-15 §6.3, phase P2). Promote always passes ONE confirm (single or
// multi); a clash in a single Promote asks once more for the offered -2 name; a batch never invents a name. Hide = tombstone.
import { candidateRow } from '../live/adapter.mjs';

export const NOT_WRITTEN = (next) => `not written — a note with that name is there; promote it alone to save it as ${next || 'another name'}`;
const TITLE_MAX = 200;
let seq = 0;

export const candidatesLogic = {
  hcView(view) {
    if (view !== 'library' && view !== 'candidates') return;
    this.setState({ prView: view });
    if (view === 'candidates' && !this.store.live.candidates.loaded) this.hcLoad();
  },
  hcLoad() { if (this.store.refreshCandidates) return this.store.refreshCandidates(); return undefined; },
  hcToggle(key) {
    this.setState((s) => ({ hcSel: s.hcSel.includes(key) ? s.hcSel.filter((k) => k !== key) : s.hcSel.concat([key]) }));
  },
  hcAsk(key) {
    const keys = key ? [key] : this.state.hcSel.slice();
    if (!keys.length) { this.toast('info', 'Tick one or more candidates first.'); return; }
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const rows = (this.store.live.candidates.rows || []).filter((r) => keys.includes(r.key)).map((r) => candidateRow(r));
    const items = rows.map((r) => ({ key: r.key, title: r.title, text: r.text, source: r.source }));
    if (!items.length) { this.toast('info', 'Those candidates are no longer listed — refresh the list.'); return; }
    this.setState({ promote: { seq: ++seq, keys, items, phase: 'ask', clash: null, results: [], error: null } });
  },
  hcTitle(e) {
    const P = this.state.promote;
    if (!P || P.items.length !== 1 || P.phase !== 'ask') return;
    // not trimmed here: the runtime fires onChange per keystroke ('input'); hcGo / hcSaveAs trim what they send
    const title = String((e && e.target && e.target.value) || '').slice(0, TITLE_MAX);
    this.setState({ promote: { ...P, items: [{ ...P.items[0], title }] } });
  },
  async hcGo() {
    const P = this.state.promote;
    if (!P || P.phase !== 'ask' || !this.hq || !this.hq.claudePrompts || !this.hq.claudePrompts.promote) return;
    this.setState({ promote: { ...P, phase: 'saving' } });
    const results = [];
    for (const it of P.items) {
      const title = String(it.title || '').trim();   // empty → main defaults to the text's first line
      let r;
      try { r = await this.hq.claudePrompts.promote({ text: it.text, title, tags: ['harvested'], source: it.source }); }
      catch (e) { r = { error: String((e && e.message) || e) }; }
      if (!this.state.promote || this.state.promote.seq !== P.seq) return;   // closed meanwhile: say nothing more
      if (r && r.exists && P.items.length === 1) { this.setState({ promote: { ...this.state.promote, phase: 'clash', clash: { next: r.next || null } } }); return; }
      if (r && r.exists) results.push({ title, ok: false, error: NOT_WRITTEN(r.next) });
      else if (!r || r.error) results.push({ title, ok: false, error: String((r && r.error) || 'no answer') });
      else results.push({ title, ok: true, name: r.name });
    }
    this.hcDone(P, results);
  },
  async hcSaveAs() {
    const P = this.state.promote;
    if (!P || P.phase !== 'clash' || !P.clash || !P.clash.next) return;
    const it = P.items[0], title = String(it.title || '').trim();
    this.setState({ promote: { ...P, phase: 'saving' } });
    let r;
    try { r = await this.hq.claudePrompts.promote({ text: it.text, title, tags: ['harvested'], source: it.source, name: P.clash.next }); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!this.state.promote || this.state.promote.seq !== P.seq) return;
    if (r && r.exists) { this.setState({ promote: { ...this.state.promote, phase: 'clash', clash: { next: r.next || null } } }); return; }
    this.hcDone(P, [r && !r.error ? { title, ok: true, name: r.name } : { title, ok: false, error: String((r && r.error) || 'no answer') }]);
  },
  hcDone(P, results) {
    const ok = results.filter((x) => x.ok).length;
    this.setState({ promote: { ...this.state.promote, phase: 'done', results }, hcSel: [] });
    if (ok === results.length) this.toast('success', ok === 1 ? `Promoted to ${results[0].name}.` : `Promoted ${ok} prompts.`);
    else this.toast(ok ? 'info' : 'error', `Promoted ${ok} of ${results.length} — see the list for the one${results.length - ok === 1 ? '' : 's'} not written.`);
    if (this.store.refreshPrompts) this.store.refreshPrompts();
    if (this.store.refreshCandidates) this.store.refreshCandidates();
  },
  hcCancel() { this.setState({ promote: null }); },
  async hcHide(key) {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    if (!this.hq || !this.hq.claudeHub || !this.hq.claudeHub.hideCandidate) return;
    const r = await this.call(() => this.hq.claudeHub.hideCandidate(key), 'Hide');
    if (r === null) return;
    const C = this.store.live.candidates;
    if (Array.isArray(C.rows)) C.rows = C.rows.filter((x) => x.key !== key);
    C.hidden = (Number(C.hidden) || 0) + 1;
    this.setState((s) => ({ hcSel: s.hcSel.filter((k) => k !== key) }));
    this.toast('info', 'Hidden — this prompt will not be offered again.');
    this.forceUpdate();
  },
};
