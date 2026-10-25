// Prompt library P1 — Claude › Prompts › Library (spec 2026-10-15 §6.3) and the project-page "Run a prompt" button.
// Keys start with pr (ppRunPrompt on the project page). Text is bound as text; nothing here invents a number.
import { promptsView } from '../live/adapter.mjs';

export function promptsVals(ctx) {
  const { S, LIVE, sub, projects, onPage } = ctx;
  const P = LIVE.prompts || {};
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.documents);
  const forProj = S.prFor ? (projects.find((p) => p.id === S.prFor) || { id: S.prFor, name: S.prFor }) : null;
  const pageProj = onPage && S.route ? projects.find((p) => p.id === S.route.id) || null : null;
  const v = promptsView(P, { hasBridge, forProject: forProj && forProj.id });
  const obsidian = !!(P.status && P.status.obsidian);
  const isErr = v.state === 'error' || v.state === 'folder-error';
  const prRows = v.rows.map((r) => ({ ...r, hasLast: !!r.lastUsed, forHere: !!forProj && r.usesProject, canObsidian: obsidian,
    openObsidian: () => this.prOpen(r.id, 'obsidian'), openFile: () => this.prOpen(r.id, 'file'), run: () => this.prRun(r.id) }));
  const where = ((P.status && P.status.vault) || 'vault') + '/40_Resources/Prompts';
  return {
    isPrompts: S.tab === 'claude' && sub === 'prompts',
    prState: v.state, prRows, prHasRows: prRows.length > 0,
    prEmpty: v.state === 'list' ? '' : v.text,
    prEmptyStyle: { fontSize: '13px', padding: '12px 4px', color: isErr ? 'var(--orange)' : 'var(--muted)' },
    prQuery: S.prQuery || '', prOnQuery: (e) => this.onPrQuery(e), prSearchKey: (e) => { if (e && e.key === 'Enter') this.prSearch(); },
    prDoSearch: () => this.prSearch(), prDoClear: () => this.prClear(), prSearched: !!S.prSearched,
    prCount: v.state === 'list' ? `${v.count} prompt note${v.count === 1 ? '' : 's'} · ${where}` : '',
    prStatsNote: v.statsNote, prHasStatsNote: !!v.statsNote,
    prNoObsidian: !!P.status && !obsidian, prNoObsidianNote: 'Obsidian is not installed on this PC — notes open as files.',
    prHasFor: !!forProj,
    prForText: forProj ? `For ${forProj.name} — prompts that use {{project}} or {{cwd}} come first; the run step fills them from this project.` : '',
    prClearFor: () => this.prClearProject(),
    ppRunPrompt: () => this.prForProject(pageProj),
  };
}
