// The Lantern look's render values (batch 11). ONE top-level key, lntv (renderVals has a hard ceiling of 1015 top-level keys):
//   lntv = { lntOn, cleared, skills, notes, needyou, projects, project }
//     lntOn    the look is on (the Console layer is on AND Lantern is the chosen look)
//     cleared / skills / notes / needyou / projects
//              the five Workbench hosts' cards, each { show, sealed, face, aria, viewBox, shapes, title, label, roman } (logic/lantern-art.mjs).
//              The numbers are the SAME ones the Workbench look reads (workbenchNumbers, imported, not copied). While a number has not been
//              read yet the card is the face-down back (sealed: true, no number, so never a false 0); once it is read the card is face up.
//     project  the current project page's own card, from the id of the project the page really shows; empty when no project page is open
//
// renderVals runs every surface on every machine push, so with the look off this returns ONE frozen constant and reads nothing. With it on the
// cards are rebuilt only when their inputs change (one memo keyed by the numbers, the capped flag and the project id).
import { consoleEffective, LANTERN_LOOK } from '../logic/console-layer.mjs';
import { WBN_KINDS } from '../logic/workbench-art.mjs';
import { bindCard, bindProject, LNT_EMPTY_ART, LNT_SEALED } from '../logic/lantern-art.mjs';
import { workbenchNumbers } from './workbench.js';

export const LNT_OFF = Object.freeze({
  lntv: Object.freeze({ lntOn: false, cleared: LNT_EMPTY_ART, skills: LNT_EMPTY_ART, notes: LNT_EMPTY_ART, needyou: LNT_EMPTY_ART, projects: LNT_EMPTY_ART, project: LNT_EMPTY_ART }),
});

/** the id of the project the page shows right now (the same rule the project page uses: the route's project, else the first one), or '' with no page open */
function pageProjectId(S, ctx, self) {
  if (!ctx || !ctx.onPage || !S.route) return '';
  const all = self && typeof self.projectsAt === 'function' ? self.projectsAt(ctx.off, true) : [];
  const p = (Array.isArray(all) ? all : []).find((x) => x && x.id === S.route.id) || (Array.isArray(ctx.projects) ? ctx.projects[0] : null) || null;
  return p && typeof p.id === 'string' ? p.id : '';
}

let memo = { key: '', out: null };
export function lanternVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const cl = consoleEffective(S.consoleLayer);
  if (!cl.on || cl.look !== LANTERN_LOOK) return LNT_OFF;
  const n = workbenchNumbers(S, ctx);
  const capped = !!(S.vdk && S.vdk.data && S.vdk.data.noteCountCapped === true);
  const pid = pageProjectId(S, ctx, this);
  const key = WBN_KINDS.map((k) => String(n[k])).join('|') + (capped ? '|+' : '') + '|' + pid;
  if (memo.out && memo.key === key) return memo.out;
  const g = { lntOn: true };
  for (const k of WBN_KINDS) g[k] = n[k] === null ? LNT_SEALED : bindCard(k, n[k], k === 'notes' && capped);
  g.project = bindProject(pid);
  memo = { key, out: { lntv: g } };
  return memo.out;
}
