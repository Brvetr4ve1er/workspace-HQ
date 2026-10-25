// Prompt library P1 (spec 2026-10-15 §6.3) — Claude › Prompts › Library actions. Main opens notes (contained, §2);
// the renderer only ever sends a document id and 'obsidian' | 'file'. Run is wired by the run step (P3).

export const promptsLogic = {
  prLoad() { return this.store.refreshPrompts && this.store.refreshPrompts(); },
  onPrQuery(e) { this.setState({ prQuery: e && e.target ? e.target.value : '' }); },
  prSearch() { this.setState({ prSearched: true }); return this.store.searchPrompts && this.store.searchPrompts(this.state.prQuery); },
  prClear() { this.setState({ prQuery: '', prSearched: false }); return this.store.searchPrompts && this.store.searchPrompts(''); },
  async prOpen(id, how, fellBack = false) {
    const r = this.store.openPrompt ? await this.store.openPrompt(id, how) : { error: 'Opening a prompt note needs the WorkspaceHQ app' };
    if (r && r.ok) { this.toast('info', fellBack ? 'Obsidian is not installed — opened the note file instead' : how === 'obsidian' ? 'Opened in Obsidian' : 'Opened the note file'); return r; }
    if (r && r.fallback === 'file' && !fellBack) return this.prOpen(id, 'file', true);
    this.toast('error', 'Open failed · ' + ((r && r.error) || 'no answer'));
    return r;
  },
  prRun(id) { this.rnOpen(id); },
  prForProject(project) {
    this.setState({ prFor: project && project.id ? String(project.id) : null, prQuery: '', prSearched: false });
    if (this.store.searchPrompts) this.store.searchPrompts('');
    this.go('claude', 'prompts');
    return this.prLoad();
  },
  prClearProject() { this.setState({ prFor: null }); },
};
