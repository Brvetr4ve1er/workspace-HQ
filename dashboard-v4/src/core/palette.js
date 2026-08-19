// Command palette — global Ctrl/Cmd+K quick-switcher + search. Ported from
// dashboard-v3/src/core/palette.js: the MECHANICS are the same (subsequence
// ranking, CAP-8 rows, lazy overlay, delegated row handlers, recency
// quick-switch, full ARIA combobox); the INDEX is rebuilt on v4's own seams.
//
// v3 -> v4 index mapping:
//   realms  -> SURFACES, sourced from `all(ctx)`'s `go:*` actions so nav goes
//              through core/actions.mjs, the one audited effect path
//   verbs   -> the remaining enabled actions (scan:now today)
//   quests/
//   projects-> QUEUE items from intel/queue.mjs buildQueue(), which seed the
//              WORK dispatch form via the `work:seed` bus event
//   spells  -> data.bundle.spellbook.spells, navigating to AUTOMATE
//
// LIFECYCLE: this is core chrome, not a surface. initPalette() runs once at
// boot and owns ONE window keydown listener for the app's lifetime — never
// torn down (teardownPalette exists for completeness only). The overlay DOM is
// built LAZILY on first open and reused; the index is rebuilt on every open so
// it tracks the live scan selection — scrub to an older snapshot and the queue
// rows describe THAT photograph.
import { data } from './data.js';
import { bus } from './bus.js';
import { all, dispatch } from './actions.mjs';
import { switchSurface, surfaces } from './shell.js';
import { buildQueue } from '../intel/queue.mjs';
import { el, esc } from '../ui/util.js';

const CAP = 8;   // rows shown at once — keep the list glanceable and fast
// Tie-break order when two rows score equally. Spells sit last: ~977 of them,
// so they must never crowd out a surface / verb / queue match.
const KIND_RANK = { surface: 0, verb: 1, queue: 2, spell: 3 };
const KIND_ICON = { verb: '▸', queue: '◆', spell: '✦' };
// Queue rows label themselves by SOURCE (THREAT/TASK/GAP/IDEA) — the same four
// words the WORK rail uses, so the palette and the rail never disagree.
const QUEUE_LABEL = { threat: 'THREAT', task: 'TASK', gap: 'GAP', idea: 'IDEA' };

// Verbs from actions.mjs whose registered enabled() is more permissive than
// their real seam. actions.mjs is not S6's file to change, so the honesty gate
// lives here:
//  - capture:idea runs `hq?.capture?.()`, and actions.mjs's own header note
//    records that no such preload method exists — offering it would be a dead
//    control, so it never enters the index.
//  - scan:now is real (hq.runScan) but only when a bridge is present; under the
//    dev preload there is none, and a row that silently no-ops is a lie.
const VERB_GATE = {
  'capture:idea': () => false,
  'scan:now': (hq) => typeof hq?.runScan === 'function',
};
// Extra copy for verbs whose effect is asynchronous or destructive-looking.
const VERB_HINT = { 'scan:now': 'runs the pipeline in the background' };

let inited = false;
let isOpen = false;
let paletteEl = null, inputEl = null, listEl = null;   // lazy overlay refs
let allItems = [];      // full searchable index for the current open
let results = [];       // current filtered slice (what the rows show)
let selIndex = 0;
// surface ids in most-recently-visited order — floats the empty-query
// quick-switch toward where you just were, so Ctrl+K ↵ becomes "jump back".
const recent = [];
let offSwitch = null;   // surface:switched disposer (removed in teardown)
// recently-activated NON-surface items, keyed by {kind,label} so the empty
// query can offer "reopen what I just did".
const recentItems = [];

function ctx() { return { data, bus, hq: window.hq }; }

function rememberItem(it) {
  if (it.kind === 'surface') return;   // surfaces are tracked via surface:switched
  const key = it.kind + ' ' + it.label;
  const i = recentItems.findIndex((r) => r.key === key);
  if (i !== -1) recentItems.splice(i, 1);
  recentItems.unshift({ key, kind: it.kind, label: it.label });
  if (recentItems.length > 5) recentItems.length = 5;
}

// Wrap activation so a malformed record can never throw out of a keystroke.
function activate(it) {
  rememberItem(it);
  close();
  try { it.run(); } catch (err) { console.warn('[palette] activate', it.kind, err); }
}

// Build the index fresh from the live data view. Surfaces are always present;
// scan-scoped kinds are feature-detected so a null/old scan yields a calm,
// nav-only palette instead of a throw.
function buildIndex() {
  const items = [];
  const c = ctx();
  const push = (kind, label, hint, run, alias, extra) => {
    const l = String(label ?? '').trim();
    if (!l) return null;
    // `key` is the searchable haystack (never rendered); `alias` folds in hidden
    // synonyms (a surface's stable id, a queue item's project) so a match
    // survives the visible label not containing the query.
    const it = {
      kind, label: l, hint: hint || '', icon: KIND_ICON[kind] || '', run,
      labelLc: l.toLowerCase(),
      key: (l + ' ' + (hint || '') + ' ' + (alias || '')).toLowerCase(),
      ...extra,
    };
    items.push(it);
    return it;
  };

  // ---- surfaces + verbs, both through the audited action registry --------
  const byId = new Map(surfaces().map((s) => [s.id, s]));
  for (const a of all(c)) {
    if (a.id.startsWith('go:')) {
      const s = byId.get(a.id.slice(3));
      if (!s) continue;                            // registry drift: no phantom rows
      const it = push('surface', s.label, null, () => dispatch(a.id, ctx()), s.id);
      if (it) { it.icon = s.glyph; it.surfaceId = s.id; }
      continue;
    }
    const gate = VERB_GATE[a.id];
    if (gate && !gate(c.hq)) continue;             // no dead verbs (see VERB_GATE)
    push('verb', a.label, VERB_HINT[a.id] || '', () => dispatch(a.id, ctx()), a.id);
  }

  // ---- queue items: the same model the WORK rail renders -----------------
  // Activating one switches to WORK and seeds its dispatch form. switchSurface
  // mounts synchronously, so the surface's `work:seed` subscriber exists by the
  // time we emit.
  let queue = { items: [] };
  try { queue = buildQueue(data.selected); } catch (err) { console.warn('[palette] buildQueue', err); }
  for (const item of queue.items) {
    push('queue', item.title, [item.projectName, item.detail].filter(Boolean).join(' · '),
      () => { switchSurface('work'); bus.emit('work:seed', item); },
      `${item.source} ${item.projectName || ''} ${item.projectPath || ''}`,
      { source: item.source, severity: item.severity });
  }

  // ---- spells: search-only nav into the AUTOMATE arsenal -----------------
  // v3 parity (its spell rows switched to `grimoire`): the palette FINDS the
  // spell, the arsenal casts it behind its confirm gate. The row says so in its
  // title rather than pretending Enter runs anything.
  const spells = data.bundle?.spellbook?.spells;
  if (Array.isArray(spells)) {
    for (const s of spells) {
      push('spell', s?.name, s?.school || '', () => switchSurface('automate'), s?.id,
        { note: 'Opens the AUTOMATE arsenal — casting happens there, behind its confirm gate.' });
    }
  }

  return items;
}

// Greedy subsequence match of q within s (chars in order, gaps allowed).
// Returns the SPAN of the match (last-first+1), or -1 if q isn't a subsequence.
// Span is the quality signal that stops a short query from matching every long
// title equally: "lkb" is tight in "lookback" but sprawls across a 60-char
// queue line, so the tight match ranks first.
function subseqSpan(q, s) {
  let i = 0, first = -1, last = -1;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) { if (i === 0) first = j; last = j; i++; }
  }
  return i === q.length ? (last - first + 1) : -1;
}

// Ranking: label-prefix (0) > label-substring (1) > key-substring (2) > fuzzy
// label (3) > fuzzy key (4), tie-broken by kind. Empty query = recency quick-
// switcher. Fuzzy needs q.length >= 2 (1-char fuzzy is all noise).
function refilter() {
  const q = (inputEl.value || '').trim().toLowerCase();
  if (!q) {
    // empty query = quick-switch: up to 3 recently-activated items first
    // (matched back to the live index so a vanished item just drops out), then
    // surfaces ordered by recent visit. Stable sort keeps rail order otherwise.
    const recents = recentItems
      .map((r) => allItems.find((it) => it.kind === r.kind && it.label === r.label))
      .filter(Boolean).slice(0, 3);
    const rank = (it) => { const i = recent.indexOf(it.surfaceId); return i === -1 ? 999 : i; };
    const navs = allItems.filter((it) => it.kind === 'surface').sort((a, b) => rank(a) - rank(b));
    const seen = new Set();
    results = [...recents, ...navs].filter((it) => {
      const k = it.kind + ' ' + it.label;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, CAP);
  } else {
    const fuzzy = q.length >= 2;   // 1-char fuzzy matches nearly everything — skip
    const scored = [];
    for (const it of allItems) {
      let s;
      if (it.labelLc.startsWith(q)) s = 0;
      else if (it.labelLc.includes(q)) s = 1;
      else if (it.key.includes(q)) s = 2;
      else if (fuzzy) {
        // fuzzy fallback, sub-ranked by tightness: prefer the label match, and a
        // compact span over a sprawling one, so short queries surface short
        // items rather than noise.
        let span = subseqSpan(q, it.labelLc);
        if (span < 0) span = subseqSpan(q, it.key);
        if (span < 0) continue;
        s = 3 + Math.min(0.999, (span - q.length) / 60);
      } else continue;
      scored.push({ it, s });
    }
    scored.sort((a, b) => a.s - b.s || KIND_RANK[a.it.kind] - KIND_RANK[b.it.kind]);
    results = scored.slice(0, CAP).map((x) => x.it);
  }
  selIndex = 0;
  paint();
}

function kindLabel(it) {
  if (it.kind === 'queue') return QUEUE_LABEL[it.source] || 'QUEUE';
  if (it.kind === 'surface') return 'GO';
  return it.kind === 'verb' ? 'DO' : 'SPELL';
}

function paint() {
  if (!results.length) {
    listEl.innerHTML = `<div class="pal-empty">No matches</div>`;
    if (inputEl) inputEl.removeAttribute('aria-activedescendant');
    return;
  }
  // Everything interpolated is esc()'d: labels, hints and titles trace back to
  // scan data (queue titles, spell names, project names).
  listEl.innerHTML = results.map((it, i) => `
    <div class="pal-row${i === selIndex ? ' sel' : ''}" role="option" id="pal-opt-${i}"
         aria-selected="${i === selIndex}" data-i="${i}"${it.note ? ` title="${esc(it.note)}"` : ''}>
      <span class="pal-ico">${esc(it.icon)}</span>
      <span class="pal-label">${esc(it.label)}</span>
      ${it.hint ? `<span class="pal-hint">${esc(it.hint)}</span>` : ''}
      <span class="pal-kind" data-kind="${esc(it.kind)}"${it.severity ? ` data-sev="${esc(it.severity)}"` : ''}>${esc(kindLabel(it))}</span>
    </div>`).join('');
  // point the combobox at the active option so screen readers announce it
  if (inputEl) inputEl.setAttribute('aria-activedescendant', 'pal-opt-' + selIndex);
}

function highlight(scroll) {
  const rows = listEl.querySelectorAll('.pal-row');
  rows.forEach((r, i) => { const sel = i === selIndex; r.classList.toggle('sel', sel); r.setAttribute('aria-selected', sel); });
  if (inputEl) inputEl.setAttribute('aria-activedescendant', rows[selIndex] ? 'pal-opt-' + selIndex : '');
  const cur = rows[selIndex];
  if (cur && scroll) cur.scrollIntoView({ block: 'nearest' });   // keyboard nav only — never fight the mouse
}

function move(d) {
  if (!results.length) return;
  selIndex = (selIndex + d + results.length) % results.length;
  highlight(true);
}

// Build the overlay once, under #overlays (index.html pre-seeds that layer).
// It lives OUTSIDE #stage, so a surface re-mount — including the scrubber's —
// never disturbs an open palette.
function ensureDom() {
  if (paletteEl) return;
  paletteEl = el('div', 'pal-wrap');
  paletteEl.id = 'palette';
  paletteEl.setAttribute('role', 'dialog');
  paletteEl.setAttribute('aria-modal', 'true');
  paletteEl.hidden = true;
  paletteEl.innerHTML = `
    <div class="pal-panel" role="document">
      <input class="pal-input" type="text" spellcheck="false" autocomplete="off"
             role="combobox" aria-expanded="true" aria-controls="pal-listbox" aria-autocomplete="list"
             aria-label="Search surfaces, actions, queue items and spells"
             placeholder="Jump to anything — type to search…" />
      <div class="pal-list" role="listbox" id="pal-listbox" aria-label="Results"></div>
      <div class="pal-foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
    </div>`;
  (document.getElementById('overlays') || document.body).appendChild(paletteEl);
  inputEl = paletteEl.querySelector('.pal-input');
  listEl = paletteEl.querySelector('.pal-list');

  inputEl.oninput = refilter;
  // backdrop click closes; clicks inside the panel don't bubble a close
  paletteEl.onclick = (e) => { if (e.target === paletteEl) close(); };
  // row click / hover via delegation — innerHTML is rebuilt each keystroke, so
  // per-row handlers would be churn; one delegated pair survives every repaint.
  listEl.onclick = (e) => {
    const row = e.target.closest('.pal-row');
    if (row) { const it = results[+row.dataset.i]; if (it) activate(it); }
  };
  listEl.onmousemove = (e) => {
    const row = e.target.closest('.pal-row');
    if (row) { const i = +row.dataset.i; if (i !== selIndex) { selIndex = i; highlight(false); } }
  };
}

function open() {
  ensureDom();
  allItems = buildIndex();
  isOpen = true;
  paletteEl.hidden = false;
  paletteEl.classList.add('open');
  inputEl.value = '';
  refilter();
  inputEl.focus();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  if (paletteEl) {
    paletteEl.classList.remove('open');
    paletteEl.hidden = true;
    if (inputEl) inputEl.value = '';
  }
  allItems = [];
  results = [];
}

// Single window listener: the open combo (prevents the browser default), plus
// nav keys while open. Stored so teardown can remove it.
function onKey(e) {
  const combo = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K');
  if (combo) { e.preventDefault(); isOpen ? close() : open(); return; }
  // "/" is the other advertised search key. Open only when NOT typing into a
  // field, so "/" stays usable in the palette input, the arsenal search and
  // every dispatch form.
  if (!isOpen && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (!typing) { e.preventDefault(); open(); return; }
  }
  if (!isOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); const it = results[selIndex]; if (it) activate(it); }
}

export function initPalette() {
  if (inited) return;   // idempotent: safe to call once at boot
  inited = true;
  window.addEventListener('keydown', onKey);
  // track surface visits for the recency-ordered quick-switch (dedup, cap 6)
  offSwitch = bus.on('surface:switched', ({ id }) => {
    const i = recent.indexOf(id);
    if (i !== -1) recent.splice(i, 1);
    recent.unshift(id);
    if (recent.length > 6) recent.length = 6;
  });
}

// Exported for completeness — boot never calls it, but a full teardown keeps
// the module leak-free if it is ever hot-swapped.
export function teardownPalette() {
  if (!inited) return;
  inited = false;
  window.removeEventListener('keydown', onKey);
  if (offSwitch) { offSwitch(); offSwitch = null; }
  if (paletteEl) { paletteEl.remove(); }
  paletteEl = inputEl = listEl = null;
  allItems = []; results = []; selIndex = 0; isOpen = false;
}
