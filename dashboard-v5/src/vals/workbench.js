// The Workbench look's render values. ONE top-level key, wbnv (renderVals has a hard ceiling of 1015 top-level keys):
//   wbnv = { wbnLook, wbnOn, cleared, skills, notes, needyou, projects }
//     wbnLook  what the root's data-hq-look attribute carries: 'workbench' only while the Console layer is on AND that look is chosen, '' otherwise
//              (an EMPTY attribute, never a missing one, never a node: tpl/shell.tpl.js binds data-hq-look="{{ wbnv.wbnLook }}")
//     wbnOn    the look is on. Each picture also carries `show`: true only while the look is on AND its number was really read (no false 0)
//     cleared / skills / notes / needyou / projects
//              each the bound art of logic/workbench-art.mjs bindArt: the shapes, the readout label and the screen box. The numbers are real ones the
//              app already holds: cleared this week (the Brief history read), the skills the Crew read, the notes the Vault desk read, 0 for the empty
//              Brief, the projects in the list. While the look is off every one of the five is the same frozen empty picture.
//
// renderVals runs every surface on every machine push, so with the look off this returns ONE frozen constant and reads nothing. With it on the five
// pictures are rebuilt only when their numbers change (one memo keyed by the numbers).
import { consoleEffective, WORKBENCH_LOOK } from '../logic/console-layer.mjs';
import { bindArt, WBN_EMPTY_ART, WBN_KINDS } from '../logic/workbench-art.mjs';

export const WBN_OFF = Object.freeze({
  wbnv: Object.freeze({ wbnLook: '', wbnOn: false, cleared: WBN_EMPTY_ART, skills: WBN_EMPTY_ART, notes: WBN_EMPTY_ART, needyou: WBN_EMPTY_ART, projects: WBN_EMPTY_ART }),
});

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const len = (x) => (Array.isArray(x) ? x.length : null);   // null = not read yet: no picture is drawn, so no false 0 is shown

/** The five numbers, read from state the surfaces already keep (nothing is fetched here). */
export function workbenchNumbers(S, ctx) {
  const D = S && S.bhsData && typeof S.bhsData === 'object' ? S.bhsData : null;
  return {
    cleared: D && !D.error ? num(D.clearedThisWeek) : null,
    skills: len(S && S.crw && S.crw.rows),
    notes: S && S.vdk && S.vdk.data ? len(S.vdk.data.recent) : null,   // a held answer lists its recent notes even when today's note is missing
    needyou: 0,
    projects: len(ctx && ctx.rows),
  };
}

let memo = { key: '', out: null };
export function workbenchVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const cl = consoleEffective(S.consoleLayer);
  if (!cl.on || cl.look !== WORKBENCH_LOOK) return WBN_OFF;
  const n = workbenchNumbers(S, ctx);
  const key = WBN_KINDS.map((k) => String(n[k])).join('|');
  if (memo.out && memo.key === key) return memo.out;
  const g = { wbnLook: WORKBENCH_LOOK, wbnOn: true };
  for (const k of WBN_KINDS) g[k] = n[k] === null ? WBN_EMPTY_ART : bindArt(k, n[k]);
  memo = { key, out: { wbnv: g } };
  return memo.out;
}
