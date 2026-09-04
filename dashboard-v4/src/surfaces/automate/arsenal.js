// arsenal.js — the search-first automation catalog (v4.1 S4, re-presented v4.3).
// Ports the CONTENT of v3's grimoire realm (category/source/kind/usage/
// scheduled/sort cuts, coverage meter, usage pips, deep-scan/rescan, the
// connected-agents shelf). The structural rule: ~970 automations is an INPUT +
// a capped filtered list with honest counts — never a card wall.
//
// v4.3 PRESENTATION PASS (the surface was rejected as "too crowded and messy",
// and the fix is in the markup as much as in the sheet):
//   - the SEARCH FIELD is the surface's one focal element. It sits alone in the
//     `.au-find` block with the catalog's size sentence and a hairline coverage
//     bar; the two catalog-maintenance verbs moved OUT of it and onto the
//     results header, because two action buttons in the hero compete with it.
//   - the filter bank (three always-open rows of 24 outlined segments) is now
//     ONE disclosure that states its own cut in the summary. Every filter is
//     still here; the screen just stops shouting them all at once. It opens
//     itself whenever a cut is active, so applied state is never hidden.
//   - the eight per-category coverage meters (eight tiles in one row, five more
//     than the constitution allows) are a folded key-value list.
//   - `.panel` is gone: that component carries a full 1px outline and an
//     outlined box around an already-outlined list is the "everything is a box"
//     look this pass exists to remove.
// No feature was dropped. Filters, counts, coverage, pips, stars, per-row run,
// deep scan, rescan and the agents shelf are all still rendered.
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

const KIND_WORD = { run: 'runnable', interactive: 'interactive', plugin: 'plugins' };
const SORT_WORD = { used: 'most used', recent: 'recent', name: 'by name' };

// The summary line on the folded filter bank. It names the CURRENT cut in
// prose, so the disclosure never hides state the list is applying.
function filterSummary(f) {
  const bits = [
    f.category === 'all' ? 'all categories' : catLabel(f.category).toLowerCase(),
    f.source === 'all' ? 'all sources' : srcLabel(f.source).toLowerCase(),
  ];
  if (f.kind !== 'all') bits.push(KIND_WORD[f.kind] || f.kind);
  if (f.usage !== 'all') bits.push(f.usage === 'used' ? 'used' : 'never run');
  if (f.scheduled) bits.push('scheduled');
  if (f.favOnly) bits.push('favorites');
  bits.push(SORT_WORD[f.sort] || String(f.sort));
  return bits.join(' · ');
}

export function createArsenal(api) {
  // api: { data, hq, alive, state {filters, limit, filtersOpen}, getFavorites(),
  //        getRollup(), onSelect(spell), onCast(spell), onToggleFav(spell), log(stream, text) }
  const { data, hq, alive, state } = api;
  const canCast = typeof hq?.castSpell === 'function';
  let selectedId = null;

  // The left column: the focal find block (+ its coverage footnote) and the
  // results section under it.
  const root = el('div', 'au-col', `
    <div class="au-find-group">
      <section class="au-find" data-panel="1">
        <p class="au-eyebrow au-find-eyebrow">THE CATALOG</p>
        <input class="au-search" type="search" data-search />
        <p class="au-truth" data-truth></p>
        <div class="au-meter" data-cover hidden><i data-cover-fill style="width:0%"></i></div>
      </section>
      <details class="au-cov" data-cov hidden>
        <summary><span class="au-caret" aria-hidden="true">▸</span> Coverage by category</summary>
        <div class="au-cov-list" data-cov-list></div>
      </details>
    </div>
    <section class="au-results" data-panel="1">
      <div class="au-res-head">
        <span class="au-count" data-count></span>
        <span class="au-grow"></span>
        <button class="au-verb" type="button" data-deep>Deep scan</button>
        <button class="au-verb" type="button" data-rescan>Rescan</button>
      </div>
      <details class="au-filters" data-filters>
        <summary><span class="au-caret" aria-hidden="true">▸</span> Filters <span class="au-fsum" data-fsum></span></summary>
        <div class="au-filter-body" data-filter-body></div>
      </details>
      <div class="au-scroll" data-scroll></div>
    </section>`);

  const searchEl = root.querySelector('[data-search]');
  const truthEl = root.querySelector('[data-truth]');
  const coverEl = root.querySelector('[data-cover]');
  const coverFill = root.querySelector('[data-cover-fill]');
  const covEl = root.querySelector('[data-cov]');
  const covListEl = root.querySelector('[data-cov-list]');
  const countEl = root.querySelector('[data-count]');
  const deepBtn = root.querySelector('[data-deep]');
  const rescanBtn = root.querySelector('[data-rescan]');
  const filtersEl = root.querySelector('[data-filters]');
  const filterBody = root.querySelector('[data-filter-body]');
  const fsumEl = root.querySelector('[data-fsum]');
  const scrollEl = root.querySelector('[data-scroll]');

  // The disclosure's open state lives in the surface-lifetime `state` object,
  // never recomputed from filtersDirty() on every render: "Clear filters" calls
  // render(), and a bank that slammed shut the instant you cleared it would
  // fight the hand that is using it.
  filtersEl.ontoggle = () => { state.filtersOpen = filtersEl.open; };

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
        rescanBtn.textContent = 'Rescanning…'; rescanBtn.disabled = true;
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
        <div class="ars-name"><span class="ars-icon" aria-hidden="true">${esc(s.icon || '◆')}</span>${esc(s.name)}${m.pips ? pips(m.pips) : ''}</div>
        <div class="meta ars-meta">${esc(catLabel(s.school))} · ${esc(srcLabel(s.source))} · ${esc(kindLabel(s.kind))}${Number.isFinite(cd) ? ` · <span data-cd="${cd}">${esc(fmtCd(cd - Date.now()))}</span>` : ''}</div>
      </div>`;
    row.title = s.tooltip || s.description || '';   // property assignment, not markup
    row.onclick = () => {
      selectedId = s.id;
      for (const r of scrollEl.querySelectorAll('.ars-row')) r.classList.toggle('is-selected', r.dataset.id === s.id);
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
      // A quiet text verb, not a 24th outlined box on a 24-row list.
      const run = el('button', 'au-verb ars-run', 'Run');
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
  let listEl = null, moreEl = null, agentsEl = null;

  // A filter option is a word you switch on (the exemplar's `.mo-tab`), not an
  // outlined segment. `set` mutates the shared filter state; `draw` repaints.
  function seg(name, current, opts, set) {
    const wrap = el('div', 'au-seg');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', name);
    for (const [v, label, count] of opts) {
      const b = el('button', 'au-opt', `${esc(label)}${count != null ? ` <b>${Number(count) || 0}</b>` : ''}`);
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
    // The summary is repainted HERE, not in render(): switching a cut calls
    // draw(), and a summary that still described the previous cut would lie.
    fsumEl.textContent = `· ${filterSummary(f)}`;
    for (const s of hits.slice(0, state.limit)) listEl.appendChild(rowFor(s));
    if (!hits.length) listEl.appendChild(el('div', 'empty', 'Nothing matches these cuts. Clear the filters or search differently.'));
    if (hits.length > state.limit) {
      const b = el('button', 'au-verb', `Show ${Math.min(PAGE_MORE, hits.length - state.limit)} more (${hits.length - state.limit} hidden)`);
      b.type = 'button';
      b.title = 'Reveal the next slice of matches.';
      b.onclick = () => { state.limit += PAGE_MORE; draw(); };
      moreEl.appendChild(b);
    }
  }

  function render() {
    const book = data.bundle.spellbook;
    scrollEl.innerHTML = '';
    filterBody.innerHTML = '';
    listEl = moreEl = agentsEl = null;
    const total = Number(book?.counts?.total) || (book?.spells?.length ?? 0);
    wireHeader(book);

    if (!book || !book.spells?.length) {
      searchEl.placeholder = 'Search automations…';
      searchEl.disabled = true;
      searchEl.title = 'There is no catalog to search yet.';
      truthEl.textContent = 'No automations indexed yet.';
      coverEl.hidden = true;
      covEl.hidden = true;
      filtersEl.hidden = true;
      countEl.textContent = '';
      scrollEl.appendChild(el('div', 'empty',
        'No automations indexed yet — run `node collector/spellbook.mjs` (or the full pipeline) to build the catalog.'));
      return;
    }
    const f = state.filters;
    filtersEl.hidden = false;
    searchEl.disabled = false;
    searchEl.title = '';

    // ---- the focal field -------------------------------------------------
    searchEl.placeholder = `Search ${total} automations…`;
    searchEl.value = f.search;
    searchEl.setAttribute('aria-label', 'Search automations');
    searchEl.oninput = () => { f.search = searchEl.value; state.limit = PAGE; draw(); };

    // Coverage: how much of the catalog you have actually run. Reads .selected
    // (not .latest) so the snapshot scrubber time-travels; absent on snapshots
    // that predate the economy — then the bar simply isn't shown.
    const sc = data.selected?.account?.spellcraft;
    if (sc) {
      const used = Number(sc.ever_cast) || 0;
      const known = Number(sc.spells_known) || 0;
      const runs = Number(sc.lifetime_casts) || 0;
      truthEl.textContent = used
        ? `${total} automations indexed. You have run ${used} of them — ${pct(sc.ever_cast_pct)}% of the catalog, ${runs} run${runs === 1 ? '' : 's'} in all.`
        : `${total} automations indexed. You have not run any of them yet.`;
      coverEl.hidden = false;
      coverFill.style.width = `${pct(sc.ever_cast_pct)}%`;
      coverEl.title = `${used}/${known} automations run at least once.`;

      const cats = Object.entries(sc.per_school || {}).filter(([k]) => CATEGORY[k]);
      covEl.hidden = !cats.length;
      covListEl.innerHTML = cats.map(([k, v]) => `
        <div class="au-cov-row" title="${esc(catLabel(k))}: ${Number(v.cast) || 0} of ${Number(v.known) || 0} run">
          <span class="au-cov-name">${esc(catLabel(k))}</span>
          <div class="au-meter"><i style="width:${pct(v.pct)}%"></i></div>
          <span class="au-cov-num">${Number(v.cast) || 0}/${Number(v.known) || 0}</span>
        </div>`).join('');
    } else {
      truthEl.textContent = `${total} automations indexed. This snapshot predates the usage record, so there is no coverage to show.`;
      coverEl.hidden = true;
      covEl.hidden = true;
    }

    // ---- the folded filter bank -----------------------------------------
    // Default: open only when a cut is already applied. After that the user's
    // own toggle wins for the life of the surface.
    filtersEl.open = state.filtersOpen === undefined ? filtersDirty(f) : !!state.filtersOpen;

    const rowOf = (label, node) => {
      const r = el('div', 'au-frow');
      r.appendChild(el('span', 'au-flabel', esc(label)));
      r.appendChild(node);
      return r;
    };
    filterBody.appendChild(rowOf('Category', seg('Category', f.category,
      [['all', 'All', null], ...Object.keys(CATEGORY).map((k) => [k, catLabel(k), book.counts?.by_school?.[k] ?? 0])],
      (v) => { f.category = v; })));
    filterBody.appendChild(rowOf('Source', seg('Source', f.source,
      SOURCES.map((s) => [s, srcLabel(s), s === 'all' ? null : (book.counts?.by_source?.[s] ?? 0)]),
      (v) => { f.source = v; })));
    const advanced = el('div', 'au-frow');
    advanced.appendChild(el('span', 'au-flabel', 'Cut'));
    advanced.appendChild(seg('Kind', f.kind,
      [['all', 'All', null], ['run', 'Runnable', null], ['interactive', 'Interactive', null], ['plugin', 'Plugin', null]],
      (v) => { f.kind = v; }));
    advanced.appendChild(seg('Usage', f.usage,
      [['all', 'Any use', null], ['used', 'Used', null], ['unused', 'Unused', null]],
      (v) => { f.usage = v; }));
    const toggles = el('div', 'au-seg');
    const schedBtn = el('button', 'au-opt', 'Scheduled');
    schedBtn.type = 'button';
    schedBtn.title = 'Only automations with a Task Scheduler entry.';
    schedBtn.setAttribute('aria-pressed', String(f.scheduled));
    schedBtn.onclick = () => { f.scheduled = !f.scheduled; state.limit = PAGE; schedBtn.setAttribute('aria-pressed', String(f.scheduled)); draw(); };
    toggles.appendChild(schedBtn);
    const favBtn = el('button', 'au-opt', 'Favorites');
    favBtn.type = 'button';
    favBtn.title = 'Only your favorites.';
    favBtn.setAttribute('aria-pressed', String(f.favOnly));
    favBtn.onclick = () => { f.favOnly = !f.favOnly; state.limit = PAGE; favBtn.setAttribute('aria-pressed', String(f.favOnly)); draw(); };
    toggles.appendChild(favBtn);
    advanced.appendChild(toggles);
    filterBody.appendChild(advanced);

    const sortRow = el('div', 'au-frow');
    sortRow.appendChild(el('span', 'au-flabel', 'Sort'));
    sortRow.appendChild(seg('Sort', f.sort,
      [['used', 'Most used', null], ['recent', 'Recent', null], ['name', 'Name', null]],
      (v) => { f.sort = v; }));
    const clearEl = el('button', 'au-verb', 'Clear filters');
    clearEl.type = 'button';
    clearEl.title = 'Reset every cut to its default.';
    // Always rendered, never hidden: a verb that appears and disappears under
    // the pointer is its own small mess. It states when it has nothing to do.
    if (!filtersDirty(f)) { clearEl.disabled = true; clearEl.title = 'Nothing to clear — every cut is already at its default.'; }
    else clearEl.onclick = () => { state.filters = defaultFilters(); state.limit = PAGE; render(); };
    sortRow.appendChild(el('span', 'au-grow'));
    sortRow.appendChild(clearEl);
    filterBody.appendChild(sortRow);

    // ---- the results -----------------------------------------------------
    listEl = el('div', 'ars-list');
    scrollEl.appendChild(listEl);
    moreEl = el('div', 'ars-more');
    scrollEl.appendChild(moreEl);

    // Connected agents (MCP servers) — reference only, not runnable. Inside the
    // scroller so it never eats fixed height from the list above it.
    if (book.familiars?.length) {
      agentsEl = el('div', 'ars-agents');
      agentsEl.appendChild(el('div', 'ars-agents-label', `Connected agents · ${book.familiars.length}`));
      const wrap = el('div', 'ars-agents-row');
      for (const fam of book.familiars) {
        const chip = el('span', 'chip', `${esc(fam.name)} <span class="dim">· ${esc(fam.transport)} · ${esc(fam.scope)}</span>`);
        chip.title = fam.detail || '';
        wrap.appendChild(chip);
      }
      agentsEl.appendChild(wrap);
      scrollEl.appendChild(agentsEl);
    }

    draw();
  }

  return {
    el: root, render, draw,
    visibleRows: () => (listEl ? listEl.querySelectorAll('.ars-row').length : 0),
  };
}
