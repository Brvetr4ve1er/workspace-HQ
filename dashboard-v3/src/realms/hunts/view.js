// TASKS — priority board. Open tasks split into tier columns (labels come from
// the lexicon: Critical / Important / Housekeeping), a side-proposal feed, and a
// slim strip of what was completed this snapshot. Ported from v2 renderQuests;
// only copy, spacing and hierarchy were cleaned up — the data + action wiring is
// unchanged.
import { el, esc } from '../../ui/util.js';
import { aos, aosRefresh, sfx, sideQuestRow, deriveScanContext } from '../../ui/components.js';

function render(root, ctx) {
  root.innerHTML = '';
  if (!ctx.data.selected) return;
  const { S, projById, isLatest } = deriveScanContext(ctx.data);
  const { LX, hq } = ctx;
  const open = S.quests.filter((x) => x.status === 'open' || x.status === 'in_progress');
  const done = S.quests.filter((x) => x.completed === S.scan.id || (x.status === 'done' && x.completed === S.scan.id));
  const board = el('div', 'qboard'); root.appendChild(board);
  const tierName = { red: LX('tier_red'), orange: LX('tier_orange'), yellow: LX('tier_yellow') };
  ['red', 'orange', 'yellow'].forEach((tier) => {
    const qs = open.filter((x) => x.tier === tier);
    const col = el('div', 'qcol ' + tier);
    col.appendChild(el('h3', null, `<span class="dot"></span>${tierName[tier]}<span class="n">${qs.length}</span>`));
    if (!qs.length) col.appendChild(el('div', 'empty-note', 'All clear.'));
    qs.forEach((x, i) => {
      const proj = x.project_id && projById[x.project_id] ? projById[x.project_id] : null;
      const ageCls = x.age_days >= 7 ? 'old' : '';
      const qd = aos(el('div', 'quest'), 'fade-up', i, 40);
      // Older tasks quietly fill an ambient age indicator — 0 fresh → full at 30
      // days. Only the nightfall theme paints it (via CSS); a no-op elsewhere.
      qd.style.setProperty('--tide', Math.min((x.age_days || 0) / 30, 1).toFixed(2));
      qd.innerHTML = `<div class="coin">+${x.xp}</div><div class="body">
        <div class="t">${esc(x.title)}${x.age_days > 0 ? `<span class="age ${ageCls}">${x.age_days}d</span>` : ''}</div>
        ${x.insight ? `<div class="i">${esc(x.insight)}</div>` : ''}
        ${proj ? `<div class="proj">↳ ${esc(proj.name)}</div>` : ''}
        <div class="qactions"></div></div>`;
      // live actions only on the latest snapshot inside Electron (hq absent = dev harness)
      if (hq && isLatest) {
        const acts = qd.querySelector('.qactions');
        if (proj) { const b = el('button', 'qbtn', 'Open'); b.onclick = (e) => { e.stopPropagation(); hq.openRepo?.(proj.path); }; acts.appendChild(b); }
        if (proj) { const cb = el('button', 'qbtn claude', '⚡'); cb.title = 'Send to a Claude session'; cb.onclick = (e) => { e.stopPropagation(); hq.claudeQuest?.(proj.path, `${x.title} — ${x.insight || ''}`); }; acts.appendChild(cb); }
        const dn = el('button', 'qbtn done-btn', '✓ Done');
        dn.onclick = (e) => {
          e.stopPropagation(); dn.disabled = true; sfx('coin');
          hq.markQuestDone?.(x.id);
          // acted-on ledger entry, same shape as the focus flow; there is no timer
          // on the board, so minutes is 0 and via is 'board'.
          hq.actedOn?.({ at: new Date().toISOString(), kind: 'quest', action_id: x.id, project_id: x.project_id || null, minutes: 0, resolved: true, via: 'board' });
        };
        acts.appendChild(dn);
      }
      col.appendChild(qd);
    });
    board.appendChild(col);
  });
  // Side proposals: per-project ideas & risks, on the same board so browsing them
  // is a deliberate choice rather than ambient noise.
  const feed = (S.side_quests || []);
  if (feed.length) {
    const urgent = feed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length;
    const col = el('div', 'qcol side');
    col.appendChild(el('h3', null, `<span class="dot"></span>${LX('side_col')}<span class="n">${feed.length}</span>`));
    feed.slice(0, 12).forEach((sq) => col.appendChild(sideQuestRow(sq, true, ctx.data)));
    if (urgent) col.firstChild.insertAdjacentHTML('beforeend', ` <span class="sec-n">${urgent} urgent</span>`);
    board.appendChild(col);
  }
  // Completed this snapshot: a slim receipt strip, not a fourth column stealing
  // board width.
  if (done.length) {
    const strip = el('div', 'qdone-strip');
    strip.innerHTML = `<span class="qds-lbl">✓ ${done.length} ${LX('done_strip')}</span>` +
      done.map((x) => `<span class="qds-item">${esc(x.title)} <b>+${x.xp}</b></span>`).join('');
    root.appendChild(strip);
  }
  aosRefresh();
}

let off = null;

export const view = {
  mount(root, ctx) {
    const wrap = el('div', 'hunts');
    root.appendChild(wrap);
    render(wrap, ctx);
    off = ctx.bus.on('data:select', () => render(wrap, ctx));
  },
  unmount() {
    if (off) { off(); off = null; }
  },
};
