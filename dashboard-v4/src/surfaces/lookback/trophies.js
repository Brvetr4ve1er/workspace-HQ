// trophies.js — LOOKBACK's TROPHIES section: the game layer's receipts.
//
// Content ported from:
//   realms/legacy/view.js — the consistency card + the clickable trophy grid
//   realms/atlas/view.js  + ui/nudge.js — the "Almost there" nudge strip
//
// Three blocks, in the order a person reads them:
//   1. Consistency  — a cosmetic streak signal, OFF the XP ledger (it is derived
//      at render from completed-quest days, not stored), so it never pretends to
//      be an economy number.
//   2. Almost there — locked achievements ≥50% done, closest first. The pure
//      brain does the selecting (intel/derive.achievementNudges) and the pure
//      adapter does the shaping (intel/foresight.nudgeRows) with the label
//      lookup INJECTED — that is what keeps those modules DOM-free and testable.
//   3. Trophies     — every achievement the scan knows about; click one to
//      unfold its unlock criteria and progress.
import { el, esc, fmt } from '../../ui/util.js';
import { achMeta, achMetaOrFallback } from './ach.js';
import { achievementNudges } from '../../intel/derive.mjs';
import { nudgeRows } from '../../intel/foresight.mjs';

// Consistency levels — each threshold unlocks the next level.
const CONSISTENCY_THRESHOLDS = [1, 3, 5, 8, 12, 17, 23, 30];

// Trophy expand state, keyed by achievement id, at MODULE scope on purpose: an
// unfolded trophy stays open across a data:select re-render (and, once the v4.1
// scrubber makes that a full re-mount, across the re-mount too).
const openAch = new Set();

// ------------------------------------------------------------- consistency
// One "active day" per calendar day with ≥1 completed task, across the scans up
// to and including the selected one.
//
// DELIBERATE DIVERGENCE FROM v3: v3 counted across ALL recorded scans even when
// the scrubber was parked on an old snapshot, so the card could credit days that
// had not happened yet in the photograph you were looking at. Clipped here to
// `<= cd`. On the latest snapshot (the default) the number is identical to v3's.
function renderConsistency(parent, ctx, cd) {
  const days = new Set();
  (ctx.data.scans || []).forEach((s) => {
    const id = s?.scan?.id;
    if (!id || id > cd) return;
    if ((s.quests || []).some((q) => q && q.completed === id)) days.add(id);
  });
  const active = days.size;
  const max = CONSISTENCY_THRESHOLDS.length;
  const level = CONSISTENCY_THRESHOLDS.filter((t) => active >= t).length;
  const next = CONSISTENCY_THRESHOLDS.find((t) => t > active);
  const pct = next ? Math.round((active / next) * 100) : 100;
  const left = next ? next - active : 0;

  parent.appendChild(el('h2', 'lb-sec', `Consistency · level ${level}`));
  const card = el('section', 'panel lb-consistency');
  card.innerHTML = `
    <div class="lb-card-body">
      <div class="lb-con-row">
        <span class="lb-con-pips">${'●'.repeat(Math.min(level, max))}${'○'.repeat(Math.max(0, max - level))}</span>
        <span class="figure lb-con-n">${esc(fmt(active))}</span>
        <span class="figure-label">active day${active === 1 ? '' : 's'}</span>
        <span class="spacer"></span>
        <span class="chip">Level ${esc(String(level))} / ${esc(String(max))}</span>
      </div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <div class="meta lb-con-next">${next
        ? `${esc(String(left))} more active day${left > 1 ? 's' : ''} to reach level ${esc(String(level + 1))}`
        : 'Every level reached — great consistency.'}</div>
    </div>`;
  parent.appendChild(card);
  return { active, level };
}

// ------------------------------------------------------------- nudge strip
function renderNudges(parent, achievements) {
  // Own-key lookup (achMeta) — the id comes from scan data and a bare map index
  // would resolve inherited Object.prototype members. See ach.js.
  const rows = nudgeRows(achievementNudges(achievements), achMeta);
  if (!rows.length) return 0;
  parent.appendChild(el('h2', 'lb-sec', 'Almost there'));
  const wrap = el('div', 'lb-nudges');
  // r.icon is a trusted static string from our own catalog (pixel-art SVG markup
  // or an emoji) — NOT scan data — so it is intentionally injected raw. Do not
  // "fix" it into esc(r.icon); that would turn the SVG into visible tags.
  wrap.innerHTML = rows.map((r) => `
    <div class="lb-nudge">
      <span class="lb-nudge-ic">${r.icon || ''}</span>
      <span class="lb-nudge-l">${esc(r.label)}</span>
      <span class="meter lb-nudge-bar"><i style="width:${esc(String(r.pct))}%"></i></span>
      <span class="meta lb-nudge-n">${esc(String(r.have))}/${esc(String(r.need))}</span>
    </div>`).join('');
  parent.appendChild(wrap);
  return rows.length;
}

// --------------------------------------------------------------- trophy grid
// The unfolded panel: unlock criteria, then progress or the unlock date.
function achDetail(x, meta) {
  const rows = [`<div class="lb-kv"><span class="k">Unlock</span><span class="v">${esc(meta.desc || '—')}</span></div>`];
  if (x.unlocked) {
    rows.push(`<div class="lb-kv"><span class="k">Status</span><span class="v ok">✓ unlocked${x.unlocked_on ? ' · ' + esc(x.unlocked_on) : ''}</span></div>`);
  } else if (x.progress) {
    const have = x.progress.have, need = x.progress.need;
    if (Number.isFinite(need) && need > 0) {
      const pct = Math.min(100, Math.round((have / need) * 100));
      rows.push(`<div class="lb-kv"><span class="k">Progress</span><span class="v">${esc(fmt(have))} / ${esc(fmt(need))} · ${pct}%</span></div>`);
      rows.push(`<div class="meter"><i style="width:${pct}%"></i></div>`);
    } else {
      // "drive to zero" goals (need = 0): show what is left to clear.
      rows.push(`<div class="lb-kv"><span class="k">Remaining</span><span class="v">${esc(fmt(have))} to clear · target 0</span></div>`);
    }
  } else {
    rows.push(`<div class="lb-kv"><span class="k">Status</span><span class="v">locked · not started</span></div>`);
  }
  return `<div class="lb-ach-detail">${rows.join('')}</div>`;
}

function toggleAch(card, x, meta) {
  if (openAch.has(x.id)) {
    openAch.delete(x.id);
    card.classList.remove('open');
    card.setAttribute('aria-expanded', 'false');
    const d = card.querySelector('.lb-ach-detail');
    if (d) d.remove();
  } else {
    openAch.add(x.id);
    card.classList.add('open');
    card.setAttribute('aria-expanded', 'true');
    card.insertAdjacentHTML('beforeend', achDetail(x, meta));
  }
}

function renderGrid(parent, S) {
  const list = S.achievements || [];
  const unlocked = list.filter((x) => x && x.unlocked).length;
  parent.appendChild(el('h2', 'lb-sec', `Trophies · ${unlocked} of ${list.length} unlocked`));
  const grid = el('div', 'lb-ach-grid');
  parent.appendChild(grid);
  list.forEach((x) => {
    if (!x) return;
    const meta = achMetaOrFallback(x.id);
    const isOpen = openAch.has(x.id);
    // A real <button>: this control does something (unfold the criteria), it is
    // keyboard-reachable, and it announces its state. The surface has no other
    // controls — LOOKBACK is a read-only room, so there is nothing here that can
    // lie about an effect it does not have.
    const card = el('button', 'lb-ach' + (x.unlocked ? ' unlocked' : '') + (isOpen ? ' open' : ''));
    card.type = 'button';
    card.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    card.title = x.unlocked ? 'Unlocked — show how' : 'Locked — show what it takes';
    let foot;
    if (x.unlocked) foot = `<div class="meta lb-ach-foot">unlocked ${esc(x.unlocked_on || '')}</div>`;
    else if (x.progress) {
      const need = x.progress.need;
      // "drive to zero" goals (need = 0) are NOT a fraction: v3 printed them as
      // "2 / 0", which reads as a broken progress bar rather than "two left to
      // clear". Same words the unfolded detail uses.
      const pct = need ? Math.min(100, Math.round((x.progress.have / need) * 100)) : 0;
      const label = need ? `${esc(fmt(x.progress.have))} / ${esc(fmt(need))}` : `${esc(fmt(x.progress.have))} to clear`;
      foot = `<div class="meter"><i style="width:${pct}%"></i></div><div class="meta lb-ach-foot">${label}</div>`;
    } else foot = `<div class="meta lb-ach-foot">locked</div>`;
    // meta.icon is our own static pixel-art SVG / emoji (see ach.js) — raw on
    // purpose; the name and desc are display strings and go through esc().
    card.innerHTML =
      `<div class="lb-ach-ic">${meta.icon}</div>` +
      `<div class="lb-ach-name">${esc(meta.name)}</div>` +
      `<div class="meta lb-ach-desc">${esc(meta.desc)}</div>` +
      foot + (isOpen ? achDetail(x, meta) : '');
    card.onclick = () => toggleAch(card, x, meta);
    grid.appendChild(card);
  });
  return { total: list.length, unlocked };
}

// ------------------------------------------------------------------- section
export function renderTrophies(parent, ctx) {
  const S = ctx.data.selected;
  const cd = S.scan?.id || '';
  const con = renderConsistency(parent, ctx, cd);
  const nudges = renderNudges(parent, S.achievements);
  const grid = renderGrid(parent, S);
  return { ...grid, nudges, activeDays: con.active, level: con.level };
}
