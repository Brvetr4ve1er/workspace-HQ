// Cheat codes: render values (batch 7). Every value is cht-prefixed and nested under ONE top-level key, chtv (the renderVals key ceiling).
//   - chtAccent        '' | 'ember' | 'tide' | 'signal' (the warm red chosen in Settings; the only one the Workbench look carries): the root's data-hq-accent attribute (an attribute, not a node; empty = no palette)
//   - the timing overlay (chtDebug and the numbers): only while consoleLayer.on && consoleLayer.debug; otherwise the frozen OFF constant,
//     so a render with the layer off allocates and reads nothing
//   - the found list for Settings › Memory card: a count and the NAMES of found codes ('–' for the rest). Never a sequence, never an id.
// The numbers come from the host (logic/cheats-host.js cheatsDebugStats): this module only formats them and never sets state.
import { foundSummary } from '../logic/cheats.mjs';
import { consoleEffective } from '../logic/console-layer.mjs';
import { fmtMs, fmtAge } from '../logic/debug-ring.mjs';

export const CHT_KEY_CEILING = 1015;   // renderVals' top-level key ceiling, said next to the live count in the overlay

const NO_ROWS = Object.freeze([]);
export const CHT_OFF = Object.freeze({
  chtAccent: '', chtDebug: false, chtClose: () => false,
  chtLast: '–', chtP50: '–', chtP95: '–', chtSamples: '', chtPerMin: '–', chtKeys: '–', chtEmit: 'none yet',
  chtShowFound: false, chtFoundTitle: '', chtFound: NO_ROWS, chtFoundSr: '',
});

// the found part is rebuilt only when the saved list or the accent changes (same inputs, same frozen answer)
let memo = { found: undefined, accent: null, out: null };
function stable(found, accent) {
  if (memo.out && memo.found === found && memo.accent === accent) return memo.out;
  const f = foundSummary(found);
  const out = Object.freeze({
    ...CHT_OFF, chtAccent: accent, chtShowFound: true, chtFoundTitle: f.title, chtFoundSr: f.sr,
    chtFound: Object.freeze(f.rows.map((r) => Object.freeze({ label: r.label, found: r.found, color: r.found ? 'var(--text)' : 'var(--faint)' }))),
  });
  memo = { found, accent, out };
  return out;
}

function cheatsGroup() {
  const S = this.state || {};
  const L = S.consoleLayer && typeof S.consoleLayer === 'object' ? S.consoleLayer : null;
  if (!L || !L.on) return CHT_OFF;
  const accent = consoleEffective(L).palette;   // the layer's own rule: a stored palette is inert where the look does not carry it
  const base = stable(S.cheatsFound, accent);
  if (!L.debug) return base;
  const st = typeof this.cheatsDebugStats === 'function' ? this.cheatsDebugStats() : null;
  if (!this._chtCloseFn) this._chtCloseFn = () => this.cheatsCloseOverlay();
  return {
    ...base,
    chtDebug: true, chtClose: this._chtCloseFn,
    chtLast: fmtMs(st && st.last), chtP50: fmtMs(st && st.p50), chtP95: fmtMs(st && st.p95),
    chtSamples: st && st.count ? 'over the last ' + st.count + (st.count === 1 ? ' render' : ' renders') : 'no renders measured yet',
    chtPerMin: st ? String(st.perMin) : '–',
    chtKeys: st && st.keys != null ? st.keys + ' of ' + CHT_KEY_CEILING : '–',
    chtEmit: st ? fmtAge(st.emitAt, st.now) : 'none yet',
  };
}

export function cheatsVals() { return { chtv: cheatsGroup.call(this) }; }
