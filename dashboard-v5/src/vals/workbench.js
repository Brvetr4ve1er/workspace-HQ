// The Workbench look's render values. ONE top-level key, wbnv (renderVals has a hard ceiling of 1015 top-level keys):
//   wbnv = { wbnLook, wbnOn, cleared, skills, notes, needyou, projects }
//     wbnLook  what the root's data-hq-look attribute carries: the EFFECTIVE look id ('workbench' or 'lantern') only while the Console layer is on AND that look is chosen, '' otherwise
//              (an EMPTY attribute, never a missing one, never a node: tpl/shell.tpl.js binds data-hq-look="{{ wbnv.wbnLook }}")
//     wbnOn    the look is on. Each picture also carries `show`: true only while the look is on AND its number was really read (no false 0)
//     cleared / skills / notes / needyou / projects
//              each the bound art of logic/workbench-art.mjs bindArt: the shapes, the readout label and the screen box. The numbers are real ones the
//              app already holds: cleared this week (the Brief history read), the skills the Crew read, the notes the Vault desk counted (noteCount; "N+" when its walk was capped), 0 for the empty
//              Brief, the projects in the list. While the look is off every one of the five is the same frozen empty picture.
//
// Under the Lantern look (batch 11) this key still owns the attribute (so the shell template stays as it is) and answers WBN_LANTERN: wbnLook 'lantern', wbnOn false,
// all five pictures the empty one (the Workbench art is not drawn; the Lantern cards live under lntv, vals/lantern.js).
//
// renderVals runs every surface on every machine push, so with the look off this returns ONE frozen constant and reads nothing. With it on the five
// pictures are rebuilt only when their numbers change (one memo keyed by the numbers).
import { consoleEffective, WORKBENCH_LOOK, LANTERN_LOOK } from '../logic/console-layer.mjs';
import { bindArt, WBN_EMPTY_ART, WBN_KINDS } from '../logic/workbench-art.mjs';

export const WBN_OFF = Object.freeze({
  wbnv: Object.freeze({ wbnLook: '', wbnOn: false, cleared: WBN_EMPTY_ART, skills: WBN_EMPTY_ART, notes: WBN_EMPTY_ART, needyou: WBN_EMPTY_ART, projects: WBN_EMPTY_ART }),
});

export const WBN_LANTERN = Object.freeze({
  wbnv: Object.freeze({ wbnLook: LANTERN_LOOK, wbnOn: false, cleared: WBN_EMPTY_ART, skills: WBN_EMPTY_ART, notes: WBN_EMPTY_ART, needyou: WBN_EMPTY_ART, projects: WBN_EMPTY_ART }),
});

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const len = (x) => (Array.isArray(x) ? x.length : null);   // null = not read yet: no picture is drawn, so no false 0 is shown

// the Vault desk's note count (how many notes its bounded walk saw); an answer from an older main has none, so its recent list stands in
const notesOf = (d) => (!d ? null : typeof d.noteCount === 'number' && Number.isFinite(d.noteCount) ? Math.max(0, Math.floor(d.noteCount)) : len(d.recent));

/** The five numbers, read from state the surfaces already keep (nothing is fetched here). */
export function workbenchNumbers(S, ctx) {
  const D = S && S.bhsData && typeof S.bhsData === 'object' ? S.bhsData : null;
  return {
    cleared: D && !S.bhsErr ? num(D.clearedThisWeek) : null,
    skills: len(S && S.crw && S.crw.rows),
    notes: notesOf(S && S.vdk && S.vdk.data),   // a held answer counts its notes even when today's note is missing
    needyou: 0,
    projects: len(ctx && ctx.rows),
  };
}

let memo = { key: '', out: null };
export function workbenchVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const cl = consoleEffective(S.consoleLayer);
  if (!cl.on || !cl.look) return WBN_OFF;
  if (cl.look === LANTERN_LOOK) return WBN_LANTERN;
  const n = workbenchNumbers(S, ctx);
  const capped = !!(S.vdk && S.vdk.data && S.vdk.data.noteCountCapped === true);
  const key = WBN_KINDS.map((k) => String(n[k])).join('|') + (capped ? '|+' : '');
  if (memo.out && memo.key === key) return memo.out;
  const g = { wbnLook: WORKBENCH_LOOK, wbnOn: true };
  for (const k of WBN_KINDS) g[k] = n[k] === null ? WBN_EMPTY_ART : bindArt(k, n[k], k === 'notes' && capped);
  memo = { key, out: { wbnv: g } };
  return memo.out;
}
