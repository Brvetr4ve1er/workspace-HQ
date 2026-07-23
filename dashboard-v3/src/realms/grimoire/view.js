// GRIMOIRE — the spellbook realm. Port of v2 renderSpellbook (app.js 612-739)
// plus its private helpers (mastery tiers, spell cards, spell drawer, the 30s
// cooldown ticker) and the cast-stream console wiring (app.js 547-571).
// The casting flow itself (castSpell / confirm modal / castlog surface) is
// shared machinery in ui/components.js — the roundtable sotd ribbon uses it too.
import { el, esc } from '../../ui/util.js';
import {
  sfx, aosKids, aosRefresh, fmtCd, SCHOOL,
  castSpell, closeDrawer,
} from '../../ui/components.js';

const $ = (id) => document.getElementById(id);

const MASTERY_TIERS = [
  { rank: 'Novice', days: 1 }, { rank: 'Adept', days: 5 }, { rank: 'Expert', days: 15 },
  { rank: 'Master', days: 40 }, { rank: 'Grandmaster', days: 100 },
];
// Filter/search/paging state lives at module scope like v2's closure globals:
// it survives re-renders AND realm switches (v2's tab never unmounted).
let spellSchool = 'all', spellSource = 'all', spellSearch = '', spellMax = 24;

let CTX = null, sb = null;
let offSelect = null, cdTimer = 0;

const masteryOf = (id) => {
  const days = (CTX.data.bundle.telemetry?.rollup?.[id]?.distinct_days || []).length;
  let pips = 0;
  for (const t of MASTERY_TIERS) if (days >= t.days) pips++;
  return { days, pips, rank: pips ? MASTERY_TIERS[pips - 1].rank : null };
};
const pipsHtml = (n) => `<span class="pips" title="mastery">${'●'.repeat(n)}${'○'.repeat(5 - n)}</span>`;

function spellCard(s) {
  const sch = SCHOOL[s.school] || SCHOOL.evocation;
  const card = el('div', `spellcard r-${s.rarity}`);
  card.style.setProperty('--sch', sch.c);
  const m = masteryOf(s.id);
  const castable = s.kind === 'castable' || s.kind === 'chain';
  const cd = s.schedule?.next_run ? new Date(s.schedule.next_run).getTime() : null;
  card.innerHTML = `
    <div class="sp-top">
      <span class="sp-icon">${esc(s.icon || '✴️')}</span>
      <span class="sp-name">${esc(s.name)}</span>
      ${m.pips ? pipsHtml(m.pips) : ''}
    </div>
    <div class="sp-meta">
      <span class="sp-school">${sch.label}</span>
      <span class="sp-src">${esc(s.source)}</span>
      <span class="sp-rarity">${esc(s.rarity)}</span>
    </div>
    <div class="sp-desc">${esc(s.tooltip || s.description || '—')}</div>
    <div class="sp-foot">
      ${cd && !isNaN(cd) ? `<span class="sp-cd" data-cd="${cd}">⏳ ${fmtCd(cd - Date.now())}</span>` : ''}
      ${s.kind === 'channeled' ? '<span class="sp-kind">⚡ channeled</span>' : ''}
      ${s.kind === 'tome' ? '<span class="sp-kind">📦 tome</span>' : ''}
      ${s.kind === 'chain' ? '<span class="sp-kind">⛓️ chain</span>' : ''}
      ${castable || s.kind === 'channeled' ? `<button class="sp-cast" ${s.invalid ? 'disabled' : ''}>CAST</button>` : ''}
    </div>`;
  card.onclick = () => openSpellDrawer(s);
  const btn = card.querySelector('.sp-cast');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); castSpell(s); };
  return card;
}

function openSpellDrawer(s) {
  const sch = SCHOOL[s.school] || SCHOOL.evocation;
  const m = masteryOf(s.id);
  const roll = CTX.data.bundle.telemetry?.rollup?.[s.id];
  const d = $('drawer');
  d.innerHTML = `
    <div class="spdrawer" style="--sch:${sch.c}">
      <div class="spd-head r-${esc(s.rarity)}">
        <span class="spd-icon">${esc(s.icon || '✴️')}</span>
        <div>
          <div class="spd-name">${esc(s.name)}</div>
          <div class="spd-sub">${sch.label} · ${esc(s.rarity)} · ${esc(s.source)}${m.rank ? ` · ${m.rank} (${m.days}d)` : ''}</div>
        </div>
        <button class="spd-close" title="close">✕</button>
      </div>
      <div class="spd-tip">${esc(s.tooltip || s.description || 'An unidentified incantation.')}</div>
      ${s.body ? `<div class="spd-body">${esc(s.body).slice(0, 1200)}</div>` : ''}
      <div class="spd-sec">INCANTATION (exact command)</div>
      <div class="spd-cmd">${s.kind === 'chain'
        ? esc('chain: ' + (s.chain || []).join(' → '))
        : esc([s.command, ...(s.args || [])].filter(Boolean).join(' '))}</div>
      ${s.cwd ? `<div class="spd-kv">cwd: ${esc(s.cwd)}</div>` : ''}
      ${s.origin_path ? `<div class="spd-kv">origin: ${esc(s.origin_path)}</div>` : ''}
      ${s.schedule ? `<div class="spd-kv">next: ${esc(s.schedule.next_run || '—')} · last: ${esc(s.schedule.last_run || '—')} (result ${esc(String(s.schedule.last_result ?? '—'))})</div>` : ''}
      ${roll ? `<div class="spd-kv">casts: ${roll.lifetime_casts} · last: ${esc((roll.last_cast || '').slice(0, 16).replace('T', ' '))}</div>` : ''}
      <div class="spd-actions">
        ${s.kind === 'castable' || s.kind === 'chain' || s.kind === 'channeled' ? `<button class="spd-cast" ${s.invalid ? 'disabled' : ''}>⚡ CAST</button>` : ''}
        ${s.origin_path && CTX.hq ? `<button class="spd-open">📂 origin</button>` : ''}
      </div>
    </div>`;
  d.querySelector('.spd-close').onclick = closeDrawer;
  const cb = d.querySelector('.spd-cast');
  if (cb) cb.onclick = () => castSpell(s);
  const ob = d.querySelector('.spd-open');
  if (ob) ob.onclick = () => CTX.hq?.openFile?.(s.origin_path);
  d.classList.add('open'); $('scrim').classList.add('open');
  sfx('open');
}

function render() {
  const LX = CTX.LX, hq = CTX.hq;
  sb.innerHTML = '';
  const B = CTX.data.bundle.spellbook;
  if (!B || !B.spells?.length) {
    sb.appendChild(el('div', 'empty-note', 'No spellbook yet — run <b>node collector/spellbook.mjs</b> (or the full pipeline) to divine your arsenal.'));
    return;
  }

  // Header: school chips (click = filter) + collection meter slot (economy fills it in Phase 6)
  const head = el('h2', 'sec', `${LX('arsenal')} · ${B.counts.total} ${LX('spells_known')}`);
  if (hq) {
    const acts = el('span', 'sec-acts');
    const deep = el('button', 'sec-btn', '🔮 DEEP SCAN');
    deep.title = 'Cast the full pipeline (collector → enrich → assemble → render)';
    deep.onclick = (e) => { e.stopPropagation(); const ds = B.spells.find((x) => x.id === 'grimoire:deep-scan'); if (ds) castSpell(ds); };
    const relearn = el('button', 'sec-btn', '✨ RELEARN');
    relearn.title = 'Rescan skills/scripts/tasks only (fast, no pipeline)';
    relearn.onclick = async (e) => { e.stopPropagation(); relearn.textContent = '…'; await hq.rescanSpellbook?.(); };
    acts.append(deep, relearn);
    head.appendChild(acts);
  }
  sb.appendChild(head);
  const chips = el('div', 'sch-chips');
  const chip = (key, label, color, count) => {
    const c = el('button', 'sch-chip' + (spellSchool === key ? ' active' : ''), `${label} <b>${count}</b>`);
    c.style.setProperty('--sch', color);
    c.onclick = () => { spellSchool = spellSchool === key ? 'all' : key; spellMax = 24; render(); };
    return c;
  };
  for (const [k, v] of Object.entries(SCHOOL)) chips.appendChild(chip(k, v.label, v.c, B.counts.by_school[k] || 0));
  sb.appendChild(chips);

  // Collection meter: how much of the arsenal you've actually wielded.
  // .selected (not .latest) so the Memory-of-Grace scrubber time-travels; the
  // `if (sc)` guard hides it on older snapshots that predate spellcraft.
  const sc = CTX.data.selected?.account?.spellcraft;
  if (sc) {
    const cm = el('div', 'collmeter');
    const schoolBars = Object.entries(sc.per_school || {})
      .filter(([k]) => SCHOOL[k])
      .map(([k, v]) => `<div class="cm-school" title="${SCHOOL[k].label}: ${v.cast}/${v.known} cast">
          <span class="cm-dot" style="--sch:${SCHOOL[k].c}"></span>
          <div class="cm-mini"><i style="width:${v.pct}%; --sch:${SCHOOL[k].c}"></i></div>
        </div>`).join('');
    cm.innerHTML = `<div class="cm-main">
        <span class="cm-lbl">COLLECTION</span>
        <div class="cm-bar"><i style="width:${sc.ever_cast_pct}%"></i></div>
        <span class="cm-num">${sc.ever_cast}/${sc.spells_known} wielded (${sc.ever_cast_pct}%) · ${sc.lifetime_casts} lifetime casts</span>
      </div><div class="cm-schools">${schoolBars}</div>`;
    sb.appendChild(cm);
  }

  // Toolbar: search + source filter
  const tb = el('div', 'toolbar');
  const sources = ['all', 'grimoire', 'skill', 'command', 'script', 'npm', 'task', 'plugin'];
  tb.innerHTML = `<input id="spsearch" placeholder="Search spells…" value="${esc(spellSearch)}" />
    <div class="seg" id="spseg">${sources.map((s) => `<button data-f="${s}" class="${spellSource === s ? 'active' : ''}">${s === 'plugin' ? 'tomes' : s}</button>`).join('')}</div>
    <span class="count" id="spcount"></span>`;
  sb.appendChild(tb);

  const grid = el('div', 'spellgrid'); sb.appendChild(grid);
  const more = el('div', 'sp-more'); sb.appendChild(more);

  const draw = () => {
    grid.innerHTML = ''; more.innerHTML = '';
    const q = spellSearch.toLowerCase();
    const hits = B.spells.filter((s) =>
      (spellSchool === 'all' || s.school === spellSchool) &&
      (spellSource === 'all' || s.source === spellSource || (spellSource === 'plugin' && s.kind === 'tome')) &&
      (!q || `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(q)));
    // "my spells" first: mastery desc, then most-recently-cast — the first screen
    // is the arsenal you actually wield, not an alphabet of 957 strangers.
    const lastCast = (id) => Date.parse(CTX.data.bundle.telemetry?.rollup?.[id]?.last_cast || 0) || 0;
    hits.sort((x, y) => (masteryOf(y.id).pips - masteryOf(x.id).pips) || (lastCast(y.id) - lastCast(x.id)));
    tb.querySelector('#spcount').textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
    hits.slice(0, spellMax).forEach((s) => grid.appendChild(spellCard(s)));
    if (hits.length > spellMax) {
      const b = el('button', 'sp-morebtn', `SHOW MORE (${hits.length - spellMax} hidden)`);
      b.onclick = () => { spellMax += 120; draw(); };
      more.appendChild(b);
    }
  };
  draw();

  tb.querySelector('#spsearch').oninput = (e) => { spellSearch = e.target.value; spellMax = 24; draw(); };
  tb.querySelectorAll('#spseg button').forEach((b) => b.onclick = () => {
    spellSource = b.dataset.f; spellMax = 24;
    tb.querySelectorAll('#spseg button').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  });

  // Familiars shelf: summoned MCP allies — perched, not castable
  if (B.familiars?.length) {
    sb.appendChild(el('h2', 'sec', `${LX('familiars')} · ${B.familiars.length} ${LX('familiars_bound')}`));
    const shelf = el('div', 'famshelf');
    B.familiars.forEach((f) => {
      const sch = SCHOOL[f.school] || SCHOOL.divination;
      const fc = el('div', 'familiar');
      fc.style.setProperty('--sch', sch.c);
      fc.innerHTML = `<span class="fam-eye">◉</span><div><div class="fam-name">${esc(f.name)}</div>
        <div class="fam-sub">${esc(f.transport)} · ${esc(f.scope)}</div></div>`;
      fc.title = f.detail || '';
      shelf.appendChild(fc);
    });
    aosKids(shelf, 'fade-up', 40);
    sb.appendChild(shelf);
  }
  aosRefresh();
}

// v2's index.html pre-seeds #castlog/#castconfirm; v3's index.html is not
// edited by realm ports, so the overlay nodes anchor under #overlays here.
// Same ids/attrs as components.js's lazy ensureOverlay — whichever runs first
// wins and the other reuses the node.
function ensureCastOverlays() {
  const host = $('overlays') || document.body;
  if (!$('castlog')) {
    const n = el('div', 'hidden');
    n.id = 'castlog';
    n.setAttribute('aria-live', 'polite');
    host.appendChild(n);
  }
  if (!$('castconfirm')) {
    const n = el('div');
    n.id = 'castconfirm';
    n.setAttribute('aria-hidden', 'true');
    host.appendChild(n);
  }
}

export const view = {
  mount(root, ctx) {
    CTX = ctx;
    const hq = ctx.hq;
    ensureCastOverlays();
    sb = el('section', 'grimoire-realm');
    root.appendChild(sb);
    render();
    offSelect = ctx.bus.on('data:select', () => render());

    // Cooldown ticker (v2 app.js 452-457): only the countdown text nodes
    // update, never a re-render. Realm owns the interval; cleared on unmount.
    cdTimer = setInterval(() => {
      document.querySelectorAll('[data-cd]').forEach((n) => {
        const t = Number(n.dataset.cd);
        n.textContent = `⏳ ${fmtCd(t - Date.now())}`;
      });
    }, 30000);
    // NOTE: the cast-stream → castlog subscription is owned SOLELY by fx.js
    // (wireCastStream, app-lifetime) — the contract in components.js. This realm
    // must NOT also subscribe or every log line + SFX double-fires.
  },

  unmount() {
    offSelect?.(); offSelect = null;
    clearInterval(cdTimer); cdTimer = 0;
    closeDrawer();   // an open spell drawer must not outlive the realm
    CTX = null; sb = null;
  },
};
