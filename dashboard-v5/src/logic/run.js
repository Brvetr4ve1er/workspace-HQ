// dashboard-v5/src/logic/run.js — Prompt library P3: run modal + packs (spec 2026-10-15 §6.3).
// Main reads and fills the note; this sends only ids, the target, the owner's values and (chat) the mode.
export const RUN_TARGET_IDS = ['chat', 'terminal', 'claude.ai', 'chatgpt'];
const MODES = ['read-only', 'edits'];
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const fresh = (id, projectId) => ({ id, projectId: projectId || null, vars: {}, target: 'chat', mode: 'read-only', phase: 'edit', error: null, missing: [], result: null });

export const runLogic = {
  rnOpen(id, projectId = null) {
    if (typeof id !== 'string' || !id) return;
    this.setState({ run: fresh(id, projectId || this.state.prFor || null) });
  },
  rnPatch(p) { const R = this.state.run; if (R && R.phase !== 'running') this.setState({ run: { ...R, ...p, phase: R.phase === 'done' ? 'edit' : R.phase, result: null } }); },
  rnClose() { const R = this.state.run; if (R && R.phase === 'running') return; this.setState({ run: null }); },
  rnSetProject(id) { this.rnPatch({ projectId: typeof id === 'string' && id ? id : null }); },
  rnSetVar(name, value) {
    const R = this.state.run;
    if (!R || !NAME_RE.test(String(name)) || ['__proto__', 'constructor', 'prototype'].includes(name)) return;   // NAME_RE alone admits __proto__
    this.rnPatch({ vars: { ...R.vars, [name]: String(value == null ? '' : value).slice(0, 4000) }, missing: R.missing.filter((m) => m !== name) });
  },
  rnSetTarget(t) { if (RUN_TARGET_IDS.includes(t)) this.rnPatch({ target: t }); },
  rnSetMode(m) { if (MODES.includes(m)) this.rnPatch({ mode: m }); },
  async rnGo() {
    const R = this.state.run;
    if (!R || R.phase === 'running') return;
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const req = { promptId: R.id, target: R.target, ...(R.projectId ? { projectId: R.projectId } : {}), vars: { ...R.vars }, ...(R.target === 'chat' ? { mode: R.mode } : {}) };
    this.setState({ run: { ...R, phase: 'running', error: null, missing: [], result: null } });
    const r = await this.store.runPrompt(req);
    const cur = this.state.run;
    if (!cur || cur.id !== R.id) return;
    if (!r || r.error) { this.setState({ run: { ...cur, phase: 'error', error: String((r && r.error) || 'no answer from the app'), missing: Array.isArray(r && r.missing) ? r.missing : [] } }); return; }
    if (r.target === 'chat' && r.turnId) {
      this.setState({ run: null });
      this.go('claude', 'chats');   // the composer (data-cc="bar") lives in the Chats sub-tab; the run streams there
      this.ccNew(R.projectId || '');
      this.setState({ ccTurn: r.turnId, ccMode: R.mode });
      this.toast('success', 'Prompt started in Claude › Chats — uses your Claude quota');
      return;
    }
    this.setState({ run: { ...cur, phase: 'done', result: r } });
  },
  async rnPackImport(from = 'zip') {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    this.setState({ pack: { phase: 'picking', plan: null, result: null, error: null } });
    const r = await this.store.packImport({ from: from === 'folder' ? 'folder' : 'zip' });
    if (!this.state.pack) return;
    if (r && r.canceled) { this.setState({ pack: null }); return; }
    if (!r || r.error) { this.setState({ pack: { phase: 'error', plan: null, result: null, error: String((r && r.error) || 'no answer from the app') } }); return; }
    this.setState({ pack: { phase: 'plan', plan: r, result: null, error: null } });
  },
  async rnPackConfirm() {
    const P = this.state.pack;
    if (!P || P.phase !== 'plan' || !P.plan || !P.plan.planId) return;
    this.setState({ pack: { ...P, phase: 'writing' } });
    const r = await this.store.packImport({ planId: P.plan.planId });
    if (!r || r.error) { this.setState({ pack: { ...P, phase: 'error', error: String((r && r.error) || 'no answer from the app') } }); return; }
    this.setState({ pack: { ...P, phase: 'done', result: r } });
  },
  rnPackCancel() { const P = this.state.pack; if (P && (P.phase === 'writing' || P.phase === 'picking')) return; this.setState({ pack: null }); },
  async rnPackExport() {
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    const r = await this.store.packExport();
    if (!r || r.canceled) return;
    if (r.error) { this.toast('error', 'Export pack · ' + r.error); return; }
    this.toast('success', `Exported ${r.notes} prompt note${r.notes === 1 ? '' : 's'} to ${r.file}`);
  },
};
