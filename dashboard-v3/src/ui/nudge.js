// nudge.js — "you're one push away" strip. Renders derive.achievementNudges()
// (locked achievements >= 50% complete) as compact progress rows. The friendly
// name/icon comes from the shared ACH map; foresight.nudgeRows stays pure by
// taking that lookup as an argument.
import { el, esc } from './util.js';
import { ACH } from './components.js';
import { achievementNudges } from '../intel/derive.mjs';
import { nudgeRows } from '../intel/foresight.mjs';

export function buildNudgeStrip(achievements) {
  // Object.hasOwn, not a bare ACH[id]: the id comes from scan data, and a plain
  // object literal inherits Object.prototype, so ids like 'constructor',
  // 'toString' or '__proto__' would resolve to an inherited function/object and
  // render nonsense ("Object") as an achievement name. Own-key only; anything
  // else falls through to nudgeRows' raw-id fallback.
  const rows = nudgeRows(achievementNudges(achievements), (id) => (Object.hasOwn(ACH, id) ? ACH[id] : null));
  if (!rows.length) return null;
  const wrap = el('div', 'nudge-strip');
  // r.icon is a trusted static string from our own ACH map (PX.* SVG markup or
  // an emoji) — NOT scan data — so it is intentionally injected raw. Do not
  // "fix" it into esc(r.icon); that would turn SVG markup into visible tags.
  wrap.innerHTML = `<div class="nudge-h">Almost there</div>` + rows.map((r) => `
    <div class="nudge-row">
      <span class="nudge-ic">${r.icon || ''}</span>
      <span class="nudge-l">${esc(r.label)}</span>
      <span class="nudge-bar"><i style="width:${esc(String(r.pct))}%"></i></span>
      <span class="nudge-n">${esc(String(r.have))}/${esc(String(r.need))}</span>
    </div>`).join('');
  return wrap;
}
