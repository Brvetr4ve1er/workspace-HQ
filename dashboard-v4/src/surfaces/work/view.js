// WORK surface — Phase A placeholder for the Phase C workbench (queue rail ·
// agent pane · truth rail). This module owns the final mount point so Phase C
// replaces its body, not its wiring.
//
// Honesty rules applied now, not later:
// - real scan facts only, esc()'d (they are scan-derived);
// - the snapshot date is labeled "snapshot" — it is a nightly photograph;
// - ZERO controls: the dispatch form lands in Phase C, so no button exists
//   yet that could be dead or lying.
import { el, esc } from '../../ui/util.js';

export const view = {
  mount(stage, ctx) {
    const s = ctx.data.selected;
    if (!s) {
      stage.appendChild(el('section', 'hud-frame', `
        <div class="hud-eyebrow">WORK</div>
        <div class="hud-title">No scan data</div>
        <div class="hud-line hud-dim">Run a scan to populate the workbench.</div>`));
      return;
    }
    const open = (s.quests || []).filter((q) => q.status === 'open' || q.status === 'in_progress').length;
    const frame = el('section', 'hud-frame', `
      <div class="hud-eyebrow">WORK — workbench arrives in Phase C</div>
      <div class="hud-title">${s.projects.length} projects · ${open} open quests</div>
      <div class="hud-line hud-dim">From snapshot ${esc(s.scan?.id ?? '—')} — a nightly photograph, not live truth.</div>
      <div class="hud-line">Coming here: the unified queue, in-app agent dispatch with streaming output, and the live truth rail.</div>`);
    stage.appendChild(frame);
  },
  unmount() {},
};
