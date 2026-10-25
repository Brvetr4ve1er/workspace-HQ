// Prompt library P3 — the run modal and the pack dialog (spec 2026-10-15 §6.3). Keys: rn*. Text is bound as text.
import { runView, packView } from '../live/adapter.mjs';

const CHIP_ON = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab,var(--purple) 14%,transparent);color:var(--text);cursor:pointer;font-size:12px';
const CHIP_OFF = 'height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px';
const FIELD = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px';
const FIELD_BAD = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--tone-red);border-radius:8px;color:var(--text);font-size:13px';
const TONE = { success: 'var(--green)', info: 'var(--gold)', error: 'var(--tone-red)' };

export function runVals(ctx) {
  const S = this.state, L = this.store.live;
  const rows = (L.prompts && Array.isArray(L.prompts.rows)) ? L.prompts.rows : [];
  const R = S.run;
  const prompt = R ? rows.find((p) => p && p.id === R.id) || null : null;
  const v = runView(R, { prompt, projects: (ctx.projects || []).map((p) => ({ id: p.id, name: p.name })), hasBridge: !!this.store.bridge });
  const P = packView(S.pack), ph = S.pack ? S.pack.phase : null;
  const cant = !!ctx.cantWrite;
  return {
    rnShow: !!R, rnTitle: v.title,
    rnFields: v.fields.map((f) => ({ name: f.name, label: '{{' + f.name + '}}', value: f.value, style: f.missing ? FIELD_BAD : FIELD,
      onChange: (e) => this.rnSetVar(f.name, e && e.target ? e.target.value : '') })),
    rnHasFields: v.fields.length > 0,
    rnProjects: v.projects.map((p) => ({ name: p.name, pressed: p.selected, style: p.selected ? CHIP_ON : CHIP_OFF, pick: () => this.rnSetProject(p.id) })),
    rnHasProjects: v.projects.length > 0, rnNoProjects: v.projects.length === 0,
    rnProjectNote: v.usesProject ? 'This prompt uses {{project}} / {{cwd}} — they are filled from the project you pick'
      : v.projectNeeded ? 'Chat and Terminal start in the project folder' : 'A project is optional for a copy',
    rnTargets: v.targets.map((t) => ({ label: t.label, pressed: t.selected, style: t.selected ? CHIP_ON : CHIP_OFF, pick: () => this.rnSetTarget(t.id) })),
    rnNote: v.note, rnGoLabel: v.busy ? 'Working…' : v.goLabel, rnCantGo: !v.canGo || cant, rnDoGo: () => this.rnGo(), rnBusy: v.busy,
    rnShowMode: v.showMode, rnModeText: v.modeEdits ? 'Mode: allow edits (click for read-only)' : 'Mode: read-only (click to allow edits)',
    rnFlipMode: () => this.rnSetMode(v.modeEdits ? 'read-only' : 'edits'),
    rnHasStatus: !!v.status, rnStatusText: v.status ? v.status.text : '',
    rnStatusStyle: 'margin-top:12px;font-size:13px;color:' + (v.status ? TONE[v.status.tone] : 'var(--muted)'),
    rnDoClose: () => this.rnClose(), rnStopClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
    rnPackShow: P.phase !== 'closed', rnPackTitle: ph === 'picking' ? 'Choosing a pack…' : ph === 'error' ? 'The pack was not imported' : ph === 'done' ? 'Pack imported' : P.title,
    rnPackRows: P.rows, rnPackHasSkipped: !!P.skippedText, rnPackSkipped: P.skippedText,
    rnPackPicking: ph === 'picking', rnPackIsPlan: ph === 'plan', rnPackWriting: ph === 'writing', rnPackIsDone: ph === 'done', rnPackDoneText: P.doneText,
    rnPackHasError: !!P.error, rnPackError: P.error || '',
    rnPackCantConfirm: !P.canConfirm, rnPackConfirmLabel: P.confirmLabel || 'Nothing to copy',
    rnPackDoConfirm: () => this.rnPackConfirm(), rnPackDoCancel: () => this.rnPackCancel(),
    rnImportZip: () => this.rnPackImport('zip'), rnImportFolder: () => this.rnPackImport('folder'), rnExportPack: () => this.rnPackExport(),
    rnPackCant: cant, rnPackCantTip: cant ? ctx.writeReason : 'Asks first; copies new notes only — an existing note is never replaced',
  };
}
