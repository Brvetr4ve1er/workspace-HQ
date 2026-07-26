// Command palette — global Ctrl/Cmd+K quick-switcher + search. This is chrome,
// not a realm: initPalette() runs once at boot and owns a single window keydown
// listener for its lifetime. The overlay DOM is built lazily on first open and
// reused; the index is rebuilt on every open so it tracks the live scan
// selection (past scans carry different quests/projects/vaults).
import { data } from './data.js';
import { ordered } from './registry.js';
import { switchRealm } from './shell.js';
import { bus } from './bus.js';
import { LX } from './lexicon.js';
import { el, esc } from '../ui/util.js';
import { openDrawer, sfx } from '../ui/components.js';

const CAP = 8;   // rows shown at once — keep the list glanceable and fast
// Tie-break order when two rows score equally. Spells sit last: ~900 of them,
// so they must never crowd out a realm/project/quest match.
const KIND_RANK = { realm: 0, project: 1, quest: 2, task: 3, vault: 4, spell: 5 };
const KIND_LABEL = { realm: 'GO', project: 'PROJECT', quest: 'QUEST', task: 'IDEA', vault: 'VAULT', spell: 'SPELL' };
const KIND_ICON = { project: '◧', quest: '◆', task: '▸', vault: '❖', spell: '✦' };

let inited = false;
let isOpen = false;
let paletteEl = null, inputEl = null, listEl = null;   // lazy overlay refs
let allItems = [];      // full searchable index for the current open
let results = [];       // current filtered slice (what the rows show)
let selIndex = 0;
// realm ids in most-recently-visited order — floats the empty-query quick-switch
// toward where you just were, so ⌘K↵ becomes "jump back". Capped; fed by bus.
const recent = [];
let offSwitch = null;   // realm:switched disposer (removed in teardown)

// Wrap an item's action so a malformed record (e.g. an old project missing
// metrics that openDrawer reads) can never throw out of a keystroke.
function activate(it) {
  close();
  try { it.run(); } catch (err) { console.warn('[palette] activate', it.kind, err); }
}

// Build the index fresh from the live data view. Realms are always present;
// scan-scoped kinds are feature-detected so a null/old scan yields a calm,
// realm-only palette instead of a throw.
function buildIndex() {
  const items = [];
  const push = (kind, label, hint, run, alias) => {
    const l = String(label ?? '').trim();
    if (!l) return;
    // `key` is the searchable haystack (never rendered); `alias` folds in hidden
    // synonyms (e.g. a realm's stable id) so matches survive theme relabeling.
    items.push({ kind, label: l, hint: hint || '', icon: KIND_ICON[kind] || '',
      labelLc: l.toLowerCase(), key: (l + ' ' + (hint || '') + ' ' + (alias || '')).toLowerCase(), run });
  };

  for (const { manifest: m } of ordered()) {
    if (!m.enabled(data)) continue;
    // alias = the realm's stable id, so "grimoire"/"hunts" find it even when the
    // active theme renames the visible label (plain theme: hunts -> "TASKS").
    push('realm', LX(m.lexKey), null, () => switchRealm(m.id), m.id);
    const rit = items[items.length - 1];
    rit.icon = m.sigil;      // realms lead with their sigil
    rit.realmId = m.id;      // recency key for the empty-query quick-switch
  }

  const S = data.selected;
  if (S) {
    (S.projects || []).forEach((p) => {
      const pct = p.completion && typeof p.completion.pct === 'number' ? p.completion.pct + '%' : '';
      const stack = Array.isArray(p.stack) ? p.stack.slice(0, 2).join(' · ') : '';
      push('project', p.name, [pct, stack].filter(Boolean).join(' · '), () => openDrawer(p, null, data));
    });
    (S.quests || []).forEach((q) => push('quest', q.title, q.tier ? String(q.tier) : '', () => switchRealm('hunts')));
    (S.side_quests || []).forEach((sq) => push('task', sq.title, sq.project_name || sq.kind || '', () => switchRealm('hunts')));
    (S.inventory?.vaults || []).forEach((v) => {
      const n = typeof v.notes === 'number' ? v.notes + ' notes' : '';
      push('vault', v.name, n, () => switchRealm('observatory'));
    });
  }

  const spells = data.bundle?.spellbook?.spells;
  if (Array.isArray(spells)) spells.forEach((s) => push('spell', s.name, s.school || '', () => switchRealm('grimoire')));

  return items;
}

// Case-insensitive substring across label+hint; label-prefix ranks first, then
// label-substring, then hint-only matches, tie-broken by kind. Empty query is
// the quick-switcher: realms only, in their rail order.
function refilter() {
  const q = (inputEl.value || '').trim().toLowerCase();
  if (!q) {
    // empty query = quick-switcher: realms only, most-recently-visited first.
    // Array.sort is stable in V8, so never-visited realms keep their rail order.
    const realms = allItems.filter((it) => it.kind === 'realm');
    const rank = (it) => { const i = recent.indexOf(it.realmId); return i === -1 ? 999 : i; };
    results = realms.slice().sort((a, b) => rank(a) - rank(b)).slice(0, CAP);
  } else {
    const scored = [];
    for (const it of allItems) {
      if (!it.key.includes(q)) continue;
      const s = it.labelLc.startsWith(q) ? 0 : it.labelLc.includes(q) ? 1 : 2;
      scored.push({ it, s });
    }
    scored.sort((a, b) => a.s - b.s || KIND_RANK[a.it.kind] - KIND_RANK[b.it.kind]);
    results = scored.slice(0, CAP).map((x) => x.it);
  }
  selIndex = 0;
  paint();
}

function paint() {
  if (!results.length) {
    listEl.innerHTML = `<div class="pal-empty">No matches</div>`;
    return;
  }
  // Everything interpolated is escaped: labels/hints trace back to scan data.
  listEl.innerHTML = results.map((it, i) => `
    <div class="pal-row${i === selIndex ? ' sel' : ''}" data-i="${i}">
      <span class="pal-ico">${esc(it.icon)}</span>
      <span class="pal-label">${esc(it.label)}</span>
      ${it.hint ? `<span class="pal-hint">${esc(it.hint)}</span>` : ''}
      <span class="pal-kind ${it.kind}">${KIND_LABEL[it.kind]}</span>
    </div>`).join('');
}

function highlight(scroll) {
  const rows = listEl.querySelectorAll('.pal-row');
  rows.forEach((r, i) => r.classList.toggle('sel', i === selIndex));
  const cur = rows[selIndex];
  if (cur && scroll) cur.scrollIntoView({ block: 'nearest' });   // keyboard nav only — never fight the mouse
}

function move(d) {
  if (!results.length) return;
  selIndex = (selIndex + d + results.length) % results.length;
  highlight(true);
  sfx('blip');
}

// Build the overlay once, under #overlays (index.html pre-seeds that layer).
// We use our OWN backdrop, not #scrim, so the drawer's scrim state is untouched.
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
             aria-label="Search realms, projects, quests, spells and vaults"
             placeholder="Jump to anything — type to search…" />
      <div class="pal-list" role="listbox"></div>
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
  sfx('open');
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
  // "/" is the other advertised search key (statusbar hint). Open only when NOT
  // typing into a field, so "/" stays usable in the palette input and any form.
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
  // track realm visits for the recency-ordered quick-switch (dedup, cap 6)
  offSwitch = bus.on('realm:switched', ({ id }) => {
    const i = recent.indexOf(id);
    if (i !== -1) recent.splice(i, 1);
    recent.unshift(id);
    if (recent.length > 6) recent.length = 6;
  });
}

// Exported for completeness — boot never calls it, but a full teardown keeps
// the module leak-free if it's ever hot-swapped.
export function teardownPalette() {
  if (!inited) return;
  inited = false;
  window.removeEventListener('keydown', onKey);
  if (offSwitch) { offSwitch(); offSwitch = null; }
  if (paletteEl) { paletteEl.remove(); }
  paletteEl = inputEl = listEl = null;
  allItems = []; results = []; selIndex = 0; isOpen = false;
}
