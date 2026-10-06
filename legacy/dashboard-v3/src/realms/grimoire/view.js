// AUTOMATIONS — the automation catalog realm. Renders the discovered command
// catalog (skills, scripts, npm targets, tasks, plugins, built-ins) as a dense,
// filterable grid, plus the run-confirm / run-log wiring and the 30s cooldown
// ticker. The run flow itself (castSpell / confirm modal / run-log surface) is
// shared machinery in ui/components.js — the overview run-of-the-day strip uses
// it too, so it stays under its original function names.
import { el, esc } from '../../ui/util.js';
import { icon } from '../../ui/icons.js';
import {
  sfx, aosKids, aosRefresh, fmtCd, SCHOOL,
  castSpell, closeDrawer,
} from '../../ui/components.js';

const $ = (id) => document.getElementById(id);

// setLbl(btn, text) preserves the leading verb icon; use it in place of
// btn.textContent = 'X' for buttons whose label changes during a state
// transition (RESCAN → '…' → RESCAN). Mirrors forge/view.js's helper.
function setLbl(btn, text, cls) {
  const lbl = btn.querySelector('.' + cls);
  if (lbl) lbl.textContent = text;
  else btn.textContent = text;
}

// Plain category labels for the internal "school" ids the data still carries —
// we keep SCHOOL's colour but drop the RPG naming (school -> category).
const CATEGORY = {
  divination: 'Analyze', conjuration: 'Generate', transmutation: 'Build',
  abjuration: 'Secure', evocation: 'Execute', illusion: 'Design',
  enchantment: 'Notify', restoration: 'Fix',
};
const catLabel = (k) => CATEGORY[k] || SCHOOL[k]?.label || 'Other';

// Friendly labels for the internal source ids (used by the filter + card meta).
const SOURCE_LABEL = {
  all: 'All', grimoire: 'Built-in', skill: 'Skills', command: 'Commands',
  script: 'Scripts', npm: 'npm', task: 'Tasks', plugin: 'Plugins',
};
const srcLabel = (k) => SOURCE_LABEL[k] || k;

// Kind buckets for the advanced filter: collapse the internal kind ids into the
// four plain groups the cards already label (Runnable / Interactive / Plugin).
// `run` = one-shot scripts/tasks/chains you fire directly; `interactive` = skills
// that open a session; `plugin` = reference-only tomes.
const kindMatch = (s, k) =>
  k === 'all' ||
  (k === 'run' && (s.kind === 'castable' || s.kind === 'chain')) ||
  (k === 'interactive' && s.kind === 'channeled') ||
  (k === 'plugin' && s.kind === 'tome');

// Usage tiers: how many distinct days an automation has been run (real signal
// from telemetry, shown as filled/empty dots — not decoration).
const USAGE_TIERS = [
  { rank: 'Novice', days: 1 }, { rank: 'Adept', days: 5 }, { rank: 'Expert', days: 15 },
  { rank: 'Master', days: 40 }, { rank: 'Grandmaster', days: 100 },
];
// Filter/search/paging state lives at module scope like v2's closure globals:
// it survives re-renders AND realm switches (v2's tab never unmounted).
let spellSchool = 'all', spellSource = 'all', spellSearch = '', spellMax = 24;
// Advanced filters (same module-scope lifetime as the above). kind bucket,
// usage (all/used/unused), a "scheduled only" toggle, and the result sort.
let spellKind = 'all', spellUsage = 'all', spellScheduled = false, spellSort = 'used';
// True when any filter is off its default — drives the "Clear" reset affordance.
const filtersDirty = () =>
  spellSchool !== 'all' || spellSource !== 'all' || spellSearch !== '' ||
  spellKind !== 'all' || spellUsage !== 'all' || spellScheduled || spellSort !== 'used';
function resetFilters() {
  spellSchool = 'all'; spellSource = 'all'; spellSearch = '';
  spellKind = 'all'; spellUsage = 'all'; spellScheduled = false; spellSort = 'used';
  spellMax = 24;
}

let CTX = null, sb = null;
let offSelect = null, cdTimer = 0;

const usageOf = (id) => {
  const days = (CTX.data.bundle.telemetry?.rollup?.[id]?.distinct_days || []).length;
  let pips = 0;
  for (const t of USAGE_TIERS) if (days >= t.days) pips++;
  return { days, pips, rank: pips ? USAGE_TIERS[pips - 1].rank : null };
};
const pipsHtml = (n) => `<span class="pips" title="usage">${'●'.repeat(n)}${'○'.repeat(5 - n)}</span>`;

function spellCard(s) {
  const sch = SCHOOL[s.school] || SCHOOL.evocation;
  const card = el('div', `spellcard r-${s.rarity}`);
  card.style.setProperty('--sch', sch.c);
  const m = usageOf(s.id);
  const runnable = s.kind === 'castable' || s.kind === 'chain';
  const cd = s.schedule?.next_run ? new Date(s.schedule.next_run).getTime() : null;
  card.innerHTML = `
    <div class="sp-top">
      <span class="sp-icon">${esc(s.icon || '◆')}</span>
      <span class="sp-name">${esc(s.name)}</span>
      ${m.pips ? pipsHtml(m.pips) : ''}
    </div>
    <div class="sp-meta">
      <span class="sp-school">${esc(catLabel(s.school))}</span>
      <span class="sp-src">${esc(srcLabel(s.source))}</span>
    </div>
    <div class="sp-desc">${esc(s.tooltip || s.description || '—')}</div>
    <div class="sp-foot">
      ${cd && !isNaN(cd) ? `<span class="sp-cd" data-cd="${cd}">⏳ ${fmtCd(cd - Date.now())}</span>` : ''}
      ${s.kind === 'channeled' ? '<span class="sp-kind">Interactive</span>' : ''}
      ${s.kind === 'tome' ? '<span class="sp-kind">Plugin</span>' : ''}
      ${s.kind === 'chain' ? '<span class="sp-kind">Chain</span>' : ''}
      ${runnable || s.kind === 'channeled' ? `<button class="sp-cast" ${s.invalid ? 'disabled' : ''}>${icon('verb-run', { size: 14 })}<span class="sp-cast-lbl">RUN</span></button>` : ''}
    </div>`;
  card.onclick = () => openSpellDrawer(s);
  const btn = card.querySelector('.sp-cast');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); castSpell(s); };
  return card;
}

function openSpellDrawer(s) {
  const sch = SCHOOL[s.school] || SCHOOL.evocation;
  const m = usageOf(s.id);
  const roll = CTX.data.bundle.telemetry?.rollup?.[s.id];
  const d = $('drawer');
  d.innerHTML = `
    <div class="spdrawer" style="--sch:${sch.c}">
      <div class="spd-head r-${esc(s.rarity)}">
        <span class="spd-icon">${esc(s.icon || '◆')}</span>
        <div>
          <div class="spd-name">${esc(s.name)}</div>
          <div class="spd-sub">${esc(catLabel(s.school))} · ${esc(srcLabel(s.source))}${m.rank ? ` · ${esc(m.rank)} (${m.days}d used)` : ''}</div>
        </div>
        <button class="spd-close" title="Close">✕</button>
      </div>
      <div class="spd-tip">${esc(s.tooltip || s.description || 'No description available.')}</div>
      ${s.body ? `<div class="spd-body">${esc(s.body).slice(0, 1200)}</div>` : ''}
      <div class="spd-sec">COMMAND</div>
      <div class="spd-cmd">${s.kind === 'chain'
        ? esc('steps: ' + (s.chain || []).join(' → '))
        : esc([s.command, ...(s.args || [])].filter(Boolean).join(' '))}</div>
      ${s.cwd ? `<div class="spd-kv">dir: ${esc(s.cwd)}</div>` : ''}
      ${s.origin_path ? `<div class="spd-kv">source: ${esc(s.origin_path)}</div>` : ''}
      ${s.schedule ? `<div class="spd-kv">next: ${esc(s.schedule.next_run || '—')} · last: ${esc(s.schedule.last_run || '—')} (result ${esc(String(s.schedule.last_result ?? '—'))})</div>` : ''}
      ${roll ? `<div class="spd-kv">runs: ${roll.lifetime_casts} · last: ${esc((roll.last_cast || '').slice(0, 16).replace('T', ' '))}</div>` : ''}
      <div class="spd-actions">
        ${s.kind === 'castable' || s.kind === 'chain' || s.kind === 'channeled' ? `<button class="spd-cast" ${s.invalid ? 'disabled' : ''}>${icon('verb-run', { size: 14 })}<span class="spd-cast-lbl">RUN</span></button>` : ''}
        ${s.origin_path && CTX.hq ? `<button class="spd-open">${icon('verb-open', { size: 14 })}<span class="spd-open-lbl">Open file</span></button>` : ''}
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
    sb.appendChild(el('div', 'empty-note', 'No automations indexed yet — run <b>node collector/spellbook.mjs</b> (or the full pipeline) to build the catalog.'));
    return;
  }

  // Header: category chips (click = filter) + rescan actions. The coverage meter
  // (below) is filled in by the economy pass in Phase 6.
  const head = el('h2', 'sec', `${LX('arsenal')} · ${B.counts.total} ${LX('spells_known')}`);
  if (hq) {
    const acts = el('span', 'sec-acts');
    const deep = el('button', 'sec-btn', `${icon('verb-focus', { size: 14 })}<span class="sec-btn-lbl">DEEP SCAN</span>`);
    deep.title = 'Run the full pipeline (collect → enrich → assemble → build)';
    deep.onclick = (e) => { e.stopPropagation(); const ds = B.spells.find((x) => x.id === 'grimoire:deep-scan'); if (ds) castSpell(ds); };
    const relearn = el('button', 'sec-btn', `${icon('verb-run', { size: 14 })}<span class="sec-btn-lbl">RESCAN</span>`);
    relearn.title = 'Rescan skills, scripts and tasks only (fast, no pipeline)';
    relearn.onclick = async (e) => {
      e.stopPropagation();
      if (!hq.rescanSpellbook) return;   // no bridge → don't strand the label at '…'
      setLbl(relearn, '…', 'sec-btn-lbl'); relearn.disabled = true;
      try { await hq.rescanSpellbook(); }
      finally { setLbl(relearn, 'RESCAN', 'sec-btn-lbl'); relearn.disabled = false; }   // restore even if the reload doesn't re-render us
    };
    acts.append(deep, relearn);
    head.appendChild(acts);
  }
  sb.appendChild(head);
  const chips = el('div', 'sch-chips');
  const chip = (key, label, color, count) => {
    const c = el('button', 'sch-chip' + (spellSchool === key ? ' active' : ''), `${esc(label)} <b>${count}</b>`);
    c.style.setProperty('--sch', color);
    c.onclick = () => { spellSchool = spellSchool === key ? 'all' : key; spellMax = 24; render(); };
    return c;
  };
  for (const [k, v] of Object.entries(SCHOOL)) chips.appendChild(chip(k, catLabel(k), v.c, B.counts.by_school[k] || 0));
  sb.appendChild(chips);

  // Coverage meter: how much of the catalog you've actually run.
  // .selected (not .latest) so the snapshot scrubber time-travels; the
  // `if (sc)` guard hides it on older snapshots that predate the economy.
  const sc = CTX.data.selected?.account?.spellcraft;
  if (sc) {
    const cm = el('div', 'collmeter');
    const schoolBars = Object.entries(sc.per_school || {})
      .filter(([k]) => SCHOOL[k])
      .map(([k, v]) => `<div class="cm-school" title="${esc(catLabel(k))}: ${v.cast}/${v.known} run">
          <span class="cm-dot" style="--sch:${SCHOOL[k].c}"></span>
          <div class="cm-mini"><i style="width:${v.pct}%; --sch:${SCHOOL[k].c}"></i></div>
        </div>`).join('');
    cm.innerHTML = `<div class="cm-main">
        <span class="cm-lbl">COVERAGE</span>
        <div class="cm-bar"><i style="width:${sc.ever_cast_pct}%"></i></div>
        <span class="cm-num">${sc.ever_cast}/${sc.spells_known} used (${sc.ever_cast_pct}%) · ${sc.lifetime_casts} total runs</span>
      </div><div class="cm-schools">${schoolBars}</div>`;
    sb.appendChild(cm);
  }

  // Toolbar: search + source filter
  const tb = el('div', 'toolbar');
  const sources = ['all', 'grimoire', 'skill', 'command', 'script', 'npm', 'task', 'plugin'];
  tb.innerHTML = `<input id="spsearch" placeholder="Search automations…" value="${esc(spellSearch)}" />
    <div class="seg" id="spseg">${sources.map((s) => `<button data-f="${esc(s)}" class="${spellSource === s ? 'active' : ''}">${esc(srcLabel(s))}</button>`).join('')}</div>
    <span class="count" id="spcount"></span>`;
  sb.appendChild(tb);

  // Advanced filter row: kind bucket + usage + "scheduled only" + sort, with a
  // reset. Only 34 of ~944 automations are directly runnable and 16 scheduled,
  // so these cuts are what make a catalog this size actually navigable.
  const adv = el('div', 'toolbar2');
  const seg = (id, cur, opts) =>
    `<div class="seg" id="${id}">${opts.map(([v, l]) =>
      `<button data-f="${esc(v)}" class="${cur === v ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
  adv.innerHTML =
    `<span class="tb2-lbl">Kind</span>${seg('spkind', spellKind, [['all', 'All'], ['run', 'Runnable'], ['interactive', 'Interactive'], ['plugin', 'Plugin']])}` +
    `<span class="tb2-lbl">Usage</span>${seg('spusage', spellUsage, [['all', 'All'], ['used', 'Used'], ['unused', 'Unused']])}` +
    `<button class="tb2-toggle${spellScheduled ? ' active' : ''}" id="spsched" title="Only automations with a schedule">⏳ Scheduled</button>` +
    `<span class="tb2-lbl">Sort</span>${seg('spsort', spellSort, [['used', 'Most used'], ['recent', 'Recent'], ['name', 'Name']])}` +
    `<button class="tb2-clear" id="spclear" hidden>Clear filters</button>`;
  sb.appendChild(adv);

  const grid = el('div', 'spellgrid'); sb.appendChild(grid);
  const more = el('div', 'sp-more'); sb.appendChild(more);

  const draw = () => {
    grid.innerHTML = ''; more.innerHTML = '';
    const q = spellSearch.toLowerCase();
    const hits = B.spells.filter((s) =>
      (spellSchool === 'all' || s.school === spellSchool) &&
      (spellSource === 'all' || s.source === spellSource || (spellSource === 'plugin' && s.kind === 'tome')) &&
      kindMatch(s, spellKind) &&
      (!spellScheduled || !!s.schedule) &&
      (spellUsage === 'all' || (spellUsage === 'used') === (usageOf(s.id).days > 0)) &&
      (!q || `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(q)));
    // Sort: default is most-used-first (usage tier desc, then most-recently-run —
    // the first screen is what you actually reach for). The advanced row can swap
    // to most-recent or A–Z.
    const lastCast = (id) => Date.parse(CTX.data.bundle.telemetry?.rollup?.[id]?.last_cast || 0) || 0;
    if (spellSort === 'name') hits.sort((x, y) => x.name.localeCompare(y.name));
    else if (spellSort === 'recent') hits.sort((x, y) => lastCast(y.id) - lastCast(x.id));
    else hits.sort((x, y) => (usageOf(y.id).pips - usageOf(x.id).pips) || (lastCast(y.id) - lastCast(x.id)));
    tb.querySelector('#spcount').textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
    adv.querySelector('#spclear').hidden = !filtersDirty();
    hits.slice(0, spellMax).forEach((s) => grid.appendChild(spellCard(s)));
    if (hits.length > spellMax) {
      const b = el('button', 'sp-morebtn', `Show more (${hits.length - spellMax} hidden)`);
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

  // Advanced row wiring: each segment just sets its state var + redraws (no full
  // render, so the search box keeps focus). Clear resets everything via render().
  const wireSeg = (id, set) => adv.querySelectorAll('#' + id + ' button').forEach((b) => b.onclick = () => {
    set(b.dataset.f); spellMax = 24;
    adv.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  });
  wireSeg('spkind', (v) => spellKind = v);
  wireSeg('spusage', (v) => spellUsage = v);
  wireSeg('spsort', (v) => spellSort = v);
  const schedBtn = adv.querySelector('#spsched');
  schedBtn.onclick = () => {
    spellScheduled = !spellScheduled; spellMax = 24;
    schedBtn.classList.toggle('active', spellScheduled);
    draw();
  };
  adv.querySelector('#spclear').onclick = () => { resetFilters(); render(); };

  // Connected agents (MCP servers) — reference only, not runnable.
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
    // NOTE: the run-stream → run-log subscription is owned SOLELY by fx.js
    // (wireCastStream, app-lifetime) — the contract in components.js. This realm
    // must NOT also subscribe or every log line + SFX double-fires.
  },

  unmount() {
    offSelect?.(); offSelect = null;
    clearInterval(cdTimer); cdTimer = 0;
    closeDrawer();   // an open detail drawer must not outlive the realm
    CTX = null; sb = null;
  },
};
