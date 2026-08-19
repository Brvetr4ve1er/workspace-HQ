// arsenal.js — the search-first automation catalog (v4.1 S4).
// Ports the CONTENT of v3's grimoire realm (category/source/kind/usage/
// scheduled/sort cuts, coverage meter, usage pips, deep-scan/rescan, the
// connected-agents shelf) rebuilt on the v4 component language. The structural
// rule: ~970 automations is an INPUT + a capped filtered list with honest
// counts — never a card wall.
//
// Pure filter/sort logic lives in catalog.mjs (node-tested); this module is
// DOM only. Handlers are property assignments on nodes this module creates, so
// re-renders drop them with the nodes. No timers here — the view owns the one
// interval and updates [data-cd] nodes itself.
//
// XSS: every catalog-derived string goes through esc() into innerHTML.
import { el, esc } from '../../ui/util.js';
import {
  CATEGORY, catLabel, srcLabel, SOURCES, kindLabel,
  isCastable, usageOf, filterSpells, filtersDirty, defaultFilters, fmtCd,
} from './catalog.mjs';

const PAGE = 24;             // first screen (v3's spellMax seed)
const PAGE_MORE = 120;       // "Show more" step

const NO_BRIDGE = 'Needs the live app — this preview has no bridge to the main process (window.hq is absent).';

const pips = (n) => `<span class="pips" title="used on ${n ? 'several' : 'no'} distinct days">${'●'.repeat(n)}${'○'.repeat(5 - n)}</span>`;
const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

export function createArsenal(api) {
  // api: { data, hq, alive, state {filters, limit}, getFavorites(), getRollup(),
  //        onSelect(spell), onCast(spell), onToggleFav(spell), log(stream, text) }
  const { data, hq, alive, state } = api;
  const canCast = typeof hq?.castSpell === 'function';
  let selectedId = null;

  const root = el('section', 'panel panel--focal automate-arsenal', `
    <div class="panel-head">
      <span class="panel-title">Arsenal</span>
      <span class="panel-sub" data-total></span>
      <span class="spacer"></span>
      <button class="btn btn--sm" type="button" data-deep>Deep scan</button>
      <button class="btn btn--sm" type="button" data-rescan>Rescan</button>
    </div>
    <div class="panel-body ars-body" data-body></div>`);
  const bodyEl = root.querySelector('[data-body]');
  const totalEl = root.querySelector('[data-total]');
  const deepBtn = root.querySelector('[data-deep]');
  const rescanBtn = root.querySelector('[data-rescan]');

  // ------------------------------------------------------- header verbs
  function wireHeader(book) {
    const deepSpell = book?.spells?.find((x) => x.id === 'grimoire:deep-scan');
    if (!canCast) {
      deepBtn.disabled = true; deepBtn.title = NO_BRIDGE;
    } else if (!deepSpell) {
      deepBtn.disabled = true; deepBtn.title = 'grimoire:deep-scan is not in the catalog — rebuild it with the pipeline.';
    } else {
      deepBtn.disabled = false;
      deepBtn.title = 'Run the full pipeline (collect -> enrich -> assemble -> build) through the run confirm gate.';
      deepBtn.onclick = () => api.onCast(deepSpell);
    }
    if (typeof hq?.rescanSpellbook !== 'function') {
      rescanBtn.disabled = true; rescanBtn.title = NO_BRIDGE;
    } else {
      rescanBtn.disabled = false;
      rescanBtn.title = 'Rescan skills, scripts and tasks (fast, no pipeline). On success the app rebuilds its data and RELOADS this window.';
      rescanBtn.onclick = async () => {
        rescanBtn.textContent = '…'; rescanBtn.disabled = true;
        try {
          const r = await hq.rescanSpellbook();
          if (alive() && r?.error) api.log('err', `x rescan: ${r.error}`);
          // success path: main reloads the window — nothing more to say here
        } catch (e) {
          if (alive()) api.log('err', `x rescan: ${String(e?.message || e)}`);
        } finally {
          if (alive()) { rescanBtn.textContent = 'Rescan'; rescanBtn.disabled = false; }
        }
      };
    }
  }

  // ------------------------------------------------------------- one row
  function rowFor(s) {
    const m = usageOf(api.getRollup(), s.id);
    const isFav = api.getFavorites().includes(s.id);
    const row = el('div', 'ars-row');
    row.dataset.id = s.id;
    row.classList.toggle('is-selected', s.id === selectedId);
    const cd = s.schedule?.next_run ? Date.parse(s.schedule.next_run) : NaN;
    row.innerHTML = `
      <button class="ars-star${isFav ? ' is-fav' : ''}" type="button" aria-pressed="${isFav}">${isFav ? '★' : '☆'}</button>
      <div class="ars-main">
        <div class="ars-name"><span class="ars-icon" aria-hidden="true">${esc(s.icon || '◆')}</span>${esc(s.name)}${m.pips ? ' ' + pips(m.pips) : ''}</div>
        <div class="meta ars-meta">${esc(catLabel(s.school))} · ${esc(srcLabel(s.source))} · ${esc(kindLabel(s.kind))}${Number.isFinite(cd) ? ` · <span data-cd="${cd}">${esc(fmtCd(cd - Date.now()))}</span>` : ''}</div>
      </div>`;
    row.title = s.tooltip || s.description || '';   // property assignment, not markup
    row.onclick = () => {
      selectedId = s.id;
      for (const r of bodyEl.querySelectorAll('.ars-row')) r.classList.toggle('is-selected', r.dataset.id === s.id);
      api.onSelect(s);
    };
    const star = row.querySelector('.ars-star');
    if (typeof hq?.favoriteSpell !== 'function') {
      star.disabled = true; star.title = NO_BRIDGE;
    } else {
      star.title = isFav ? 'Remove from favorites.' : 'Pin to favorites — favorites sort first.';
      star.onclick = (e) => { e.stopPropagation(); api.onToggleFav(s); };
    }
    if (isCastable(s)) {
      const run = el('button', 'btn btn--sm ars-run', 'Run');
      run.type = 'button';
      if (s.invalid) { run.disabled = true; run.title = 'Invalid — broken chain references.'; }
      else if (!canCast) { run.disabled = true; run.title = NO_BRIDGE; }
      else {
        run.title = s.kind === 'channeled' ? 'Interactive — opens a terminal window.' : 'Run (dry-run confirm first).';
        run.onclick = (e) => { e.stopPropagation(); api.onCast(s); };
      }
      row.appendChild(run);
    }
    return row;
  }

  // ------------------------------------------------- filter chrome + list
  let listEl = null, moreEl = null, countEl = null, clearEl = null;

  function seg(name, current, opts, set) {
    const wrap = el('div', 'ars-seg');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', name);
    for (const [v, label, count] of opts) {
      const b = el('button', 'seg-btn', `${esc(label)}${count != null ? ` <b>${Number(count) || 0}</b>` : ''}`);
      b.type = 'button';
      b.dataset.v = v;
      b.setAttribute('aria-pressed', String(current === v));
      b.onclick = () => {
        set(v);
        state.limit = PAGE;
        for (const x of wrap.children) x.setAttribute('aria-pressed', String(x === b));
        draw();
      };
      wrap.appendChild(b);
    }
    return wrap;
  }

  function draw() {
    const book = data.bundle.spellbook;
    if (!listEl || !book) return;
    const f = state.filters;
    const hits = filterSpells(book.spells, f, { rollup: api.getRollup(), favorites: api.getFavorites() });
    listEl.innerHTML = ''; moreEl.innerHTML = '';
    countEl.textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'} · showing ${Math.min(hits.length, state.limit)}`;
    clearEl.hidden = !filtersDirty(f);
    for (const s of hits.slice(0, state.limit)) listEl.appendChild(rowFor(s));
    if (!hits.length) listEl.appendChild(el('div', 'empty', 'Nothing matches these cuts. Clear the filters or search differently.'));
    if (hits.length > state.limit) {
      const b = el('button', 'btn ars-more-btn', `Show more (${hits.length - state.limit} hidden)`);
      b.type = 'button';
      b.title = 'Reveal the next slice of matches.';
      b.onclick = () => { state.limit += PAGE_MORE; draw(); };
      moreEl.appendChild(b);
    }
  }

  function render() {
    const book = data.bundle.spellbook;
    bodyEl.innerHTML = '';
    listEl = moreEl = countEl = clearEl = null;
    const total = Number(book?.counts?.total) || (book?.spells?.length ?? 0);
    totalEl.textContent = book ? `${total} automations` : 'no catalog';
    wireHeader(book);
    if (!book || !book.spells?.length) {
      bodyEl.appendChild(el('div', 'empty',
        'No automations indexed yet — run `node collector/spellbook.mjs` (or the full pipeline) to build the catalog.'));
      return;
    }
    const f = state.filters;

    // Coverage: how much of the catalog you have actually run. Reads .selected
    // (not .latest) so the snapshot scrubber time-travels; absent on snapshots
    // that predate the economy — then the meter simply isn't shown.
    const sc = data.selected?.account?.spellcraft;
    if (sc) {
      const perCat = Object.entries(sc.per_school || {})
        .filter(([k]) => CATEGORY[k])
        .map(([k, v]) => `<div class="ac-cat" title="${esc(catLabel(k))}: ${Number(v.cast) || 0}/${Number(v.known) || 0} run">
            <span class="ac-lbl">${esc(catLabel(k))}</span>
            <div class="ars-meter"><i style="width:${pct(v.pct)}%"></i></div>
          </div>`).join('');
      bodyEl.appendChild(el('div', 'ars-cover', `
        <div class="ac-main">
          <span class="eyebrow">Coverage</span>
          <div class="ars-meter ac-bar"><i style="width:${pct(sc.ever_cast_pct)}%"></i></div>
          <span class="meta">${Number(sc.ever_cast) || 0}/${Number(sc.spells_known) || 0} used (${pct(sc.ever_cast_pct)}%) · ${Number(sc.lifetime_casts) || 0} total runs</span>
        </div>
        <div class="ac-cats">${perCat}</div>`));
    }

    // Search first — the input is the front door to ~970 entries.
    const tools = el('div', 'ars-tools');
    const search = el('input', 'ars-search');
    search.type = 'search';
    search.placeholder = `Search ${total} automations…`;
    search.value = f.search;
    search.setAttribute('aria-label', 'Search automations');
    search.oninput = () => { f.search = search.value; state.limit = PAGE; draw(); };
    tools.appendChild(search);
    countEl = el('span', 'meta ars-count');
    tools.appendChild(countEl);
    bodyEl.appendChild(tools);

    const filters = el('div', 'ars-filters');
    const rowOf = (label, node) => {
      const r = el('div', 'ars-filter-row');
      r.appendChild(el('span', 'eyebrow ars-flabel', esc(label)));
      r.appendChild(node);
      return r;
    };
    filters.appendChild(rowOf('Category', seg('Category', f.category,
      [['all', 'All', null], ...Object.keys(CATEGORY).map((k) => [k, catLabel(k), book.counts?.by_school?.[k] ?? 0])],
      (v) => { f.category = v; })));
    filters.appendChild(rowOf('Source', seg('Source', f.source,
      SOURCES.map((s) => [s, srcLabel(s), s === 'all' ? null : (book.counts?.by_source?.[s] ?? 0)]),
      (v) => { f.source = v; })));
    const advanced = el('div', 'ars-filter-row ars-adv');
    advanced.appendChild(el('span', 'eyebrow ars-flabel', 'Cut'));
    advanced.appendChild(seg('Kind', f.kind,
      [['all', 'All', null], ['run', 'Runnable', null], ['interactive', 'Interactive', null], ['plugin', 'Plugin', null]],
      (v) => { f.kind = v; }));
    advanced.appendChild(seg('Usage', f.usage,
      [['all', 'Any use', null], ['used', 'Used', null], ['unused', 'Unused', null]],
      (v) => { f.usage = v; }));
    const toggles = el('div', 'ars-seg');
    const schedBtn = el('button', 'seg-btn', 'Scheduled');
    schedBtn.type = 'button';
    schedBtn.title = 'Only automations with a Task Scheduler entry.';
    schedBtn.setAttribute('aria-pressed', String(f.scheduled));
    schedBtn.onclick = () => { f.scheduled = !f.scheduled; state.limit = PAGE; schedBtn.setAttribute('aria-pressed', String(f.scheduled)); draw(); };
    toggles.appendChild(schedBtn);
    const favBtn = el('button', 'seg-btn', 'Favorites');
    favBtn.type = 'button';
    favBtn.title = 'Only your favorites.';
    favBtn.setAttribute('aria-pressed', String(f.favOnly));
    favBtn.onclick = () => { f.favOnly = !f.favOnly; state.limit = PAGE; favBtn.setAttribute('aria-pressed', String(f.favOnly)); draw(); };
    toggles.appendChild(favBtn);
    advanced.appendChild(toggles);
    advanced.appendChild(seg('Sort', f.sort,
      [['used', 'Most used', null], ['recent', 'Recent', null], ['name', 'Name', null]],
      (v) => { f.sort = v; }));
    clearEl = el('button', 'seg-btn ars-clear', 'Clear filters');
    clearEl.type = 'button';
    clearEl.hidden = true;
    clearEl.title = 'Reset every cut to its default.';
    clearEl.onclick = () => { state.filters = defaultFilters(); state.limit = PAGE; render(); };
    advanced.appendChild(clearEl);
    filters.appendChild(advanced);
    bodyEl.appendChild(filters);

    listEl = el('div', 'ars-list');
    bodyEl.appendChild(listEl);
    moreEl = el('div', 'ars-more');
    bodyEl.appendChild(moreEl);

    // Connected agents (MCP servers) — reference only, not runnable.
    if (book.familiars?.length) {
      const shelf = el('div', 'ars-agents');
      shelf.appendChild(el('div', 'eyebrow', `Connected agents · ${book.familiars.length}`));
      const wrap = el('div', 'ars-agents-row');
      for (const fam of book.familiars) {
        const chip = el('span', 'chip', `${esc(fam.name)} <span class="dim">· ${esc(fam.transport)} · ${esc(fam.scope)}</span>`);
        chip.title = fam.detail || '';
        wrap.appendChild(chip);
      }
      shelf.appendChild(wrap);
      bodyEl.appendChild(shelf);
    }

    draw();
  }

  return {
    el: root, render, draw,
    visibleRows: () => (listEl ? listEl.querySelectorAll('.ars-row').length : 0),
  };
}
