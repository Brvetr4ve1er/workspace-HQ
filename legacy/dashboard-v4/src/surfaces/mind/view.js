// MIND surface (rail name NOTES) — the second brain, in one column:
//
//   VAULT HEALTH (focal)   how much you know and how fresh it is — the total
//                          note count across your Obsidian vaults plus a
//                          one-sentence freshness reading, then the per-vault
//                          cards beneath it
//   CANVAS (beneath)       the shared JSON-canvas boards Claude and the user
//                          both draw on — live widget feed via hq.getCanvas /
//                          hq.onCanvas, plus the one write path: canvasAdd
//   SOURCES (the tail)     the supporting apparatus, quiet and last:
//                          quest-board sync status, the NotebookLM shelf and
//                          the cross-vault search launcher
//
// Feature truth ported from dashboard-v3 observatory/view.js (vaults, sync,
// NotebookLM, search) + conjure/view.js + widget.js (canvas boards as a widget
// feed). One deliberate upgrade over conjure: the feed renders EVERY node
// (widgetEl falls back to a markdown note card), not just spec widgets —
// otherwise the "Add note" button would write nodes the feed never shows,
// which is a lying control.
//
// v4.3 PRESENTATION PASS — what changed, so a later editor does not undo it.
// This screen used to be two outlined `.panel` columns with the CANVAS on the
// right carrying the scanline and the edge glow, and a 1px box around every
// vault card, notebook row, widget and chip. That is the "too crowded / messy"
// the user rejected. It is now held to the home.css exemplar:
// - ONE focal element: `.vault-health`. It is the only display-weight line and
//   the only element with the hexagon cut, the scanline and the glow. The
//   canvas count below it is a dim mono caption, not a `.figure`.
// - VIOLET BUDGET 2: the hero's edge glow, and the canvas pulse dot when a
//   live push has landed. Nothing else. Widget accents default to --hud-dim.
// - BORDER DIET: nothing here composes `.panel`, `.chip` or `.empty` — all
//   three draw outlines. Cards are a background step plus a 2px seam; sections
//   separate by --space-6/7 of air.
// - MIXED CASE: vault names, roles, board names, widget titles and every
//   sentence are content and stay in the sans register. ALL-CAPS + mono is
//   reserved for the hero eyebrow and the tiny section keys.
// No feature was dropped: the chips became a dim fact line, the drawn
// checkboxes became tick glyphs, the outlined board buttons became underlined
// words, and every control still does exactly what it did.
//
// LIFECYCLE (work/view.js idiom): everything created in mount() is released in
// unmount() — the bus subscription, the onCanvas disposer, both timers. `gen`
// is bumped by BOTH mount and unmount and every async continuation (getCanvas
// reply, canvasAdd reply, clipboard write) checks alive() AFTER its await.
// Handlers are property assignments on nodes this module creates, so a repaint
// drops them with the nodes. Every window.hq method is feature-detected — the
// dev harness has no bridge and must render fully, powered down.
import { el, esc, fmt, dur } from '../../ui/util.js';
import { widgetEl } from './widget.js';

const DEFAULT_BOARD = 'conjure';   // the canonical board Claude conjures onto

// Sticky UI state at module scope — deliberately NOT torn down, so a re-mount
// (surface switch, data:select re-mount, live repaint) restores what the user
// was doing (v3 observatory/conjure kept the same state the same way).
let searchVault = '', searchQuery = '';   // cross-vault search
let activeBoard = null;                   // which board the feed shows
let noteDraft = '';                       // unsent "Add note" text

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[mind] teardown', err); }
  }
}

// ---------------------------------------------------------------- helpers
// numeric gate for innerHTML interpolation: anything counted from scan data
// funnels through num() first, so a drifted string field can't reach the DOM
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const int = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const vaultSize = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');
// boards/nodes are user- & Obsidian-editable files — never trust the shape
const objArr = (v) => (Array.isArray(v) ? v.filter((n) => n && typeof n === 'object') : []);
const liveBoards = (payload) => (Array.isArray(payload) ? payload : payload && payload.boards);
const plural = (n, one, many) => (n === 1 ? one : many);

// ------------------------------------------------- vault health (the focal)
// The ONE thing this screen wants you to see: how much you know, and whether
// it is going stale. Everything is summed from fields the inventory already
// carries (notes / recent7 / stale90) — no invented "health score", and the
// freshness clause simply disappears on a scan that predates those fields.
//
// The display line is near-white like home.css's `.oracle-label`; the only
// colour up here is an amber stale count, which is a real mild-warning and so
// is severity earning its colour rather than decoration.
function healthHero(vaults, hasScan) {
  const hero = el('section', 'vault-health');

  if (!hasScan) {
    hero.className = 'vault-health vault-health--rest';
    hero.innerHTML = `<div class="mind-eyebrow">NO SCAN YET</div>
      <h1 class="health-line">No scan data in this build yet. Run a scan and this screen will show what your vaults hold.</h1>`;
    return hero;
  }
  if (!vaults.length) {
    hero.className = 'vault-health vault-health--rest';
    hero.innerHTML = `<div class="mind-eyebrow">NO VAULTS FOUND</div>
      <h1 class="health-line">This scan found no Obsidian vaults. Run a scan once a vault exists and it will be inventoried here.</h1>`;
    return hero;
  }

  const notes = vaults.reduce((n, v) => n + num(v.notes), 0);
  const recent = vaults.reduce((n, v) => n + (int(v.recent7) ?? 0), 0);
  const stale = vaults.reduce((n, v) => n + (int(v.stale90) ?? 0), 0);
  const hasRecent = vaults.some((v) => int(v.recent7) !== null);
  const hasStale = vaults.some((v) => int(v.stale90) !== null);

  const bits = [];
  if (hasRecent) {
    bits.push(recent
      ? `${fmt(recent)} ${plural(recent, 'note', 'notes')} changed in the last week.`
      : 'Nothing has changed in the last week.');
  }
  if (hasStale) {
    bits.push(stale
      ? `<span class="health-warn">${fmt(stale)}</span> ${plural(stale, 'has', 'have')} gone untouched for 90 days or more.`
      : 'None of them have been left untouched for 90 days.');
  }

  hero.innerHTML = `<div class="mind-eyebrow">VAULT HEALTH</div>
    <h1 class="health-line"><b class="health-num">${fmt(notes)}</b> ${plural(notes, 'note', 'notes')} across ${fmt(vaults.length)} ${plural(vaults.length, 'vault', 'vaults')}</h1>
    ${bits.length ? `<p class="health-reason">${bits.join(' ')}</p>` : ''}`;
  return hero;
}

// ------------------------------------------------- vault cards (observatory)
// Card fields beyond {name, notes, role} (recent7 / stale90 / kb) are present
// in today's inventory but treated as optional — older scans may predate them.
//
// The card RECEDES: a flat background step and a 2px seam, no outline. The
// facts that used to be four outlined `.chip`s are one dim mixed-case line —
// same information, none of the boxes.
function vaultCard(v, maxNotes) {
  const primary = v.role === 'primary';
  const c = el('div', 'vault-card');
  c.style.setProperty('--seam', primary ? 'var(--seam-lead)' : 'var(--seam-rest)');
  const share = maxNotes ? Math.max(3, Math.round((num(v.notes) / maxNotes) * 100)) : 0;

  const facts = [];
  const recent = int(v.recent7);
  const stale = int(v.stale90);
  if (recent !== null) facts.push(recent ? `${fmt(recent)} updated this week` : 'no updates this week');
  if (stale !== null && stale > 0) facts.push(`<span class="warn">${fmt(stale)}</span> untouched 90+ days`);
  if (int(v.kb) !== null) facts.push(esc(vaultSize(num(v.kb))));

  c.innerHTML = `
    <div class="vault-top">
      <span class="vault-name" title="${esc(v.name)}">${esc(v.name)}</span>
      ${v.role ? `<span class="vault-role">${esc(v.role)}</span>` : ''}
    </div>
    <div class="vault-notes"><b>${fmt(num(v.notes))}</b> notes</div>
    <div class="vault-bar"><i style="width:${share}%"></i></div>
    ${facts.length ? `<p class="vault-facts">${facts.join(' · ')}</p>` : ''}`;
  return c;
}

// ------------------------------------------------- Obsidian quest-board sync
// Feature-detected: today's latest.json carries no obsidian block, so this
// renders nothing yet. The detector covers the struct-lane landing spot
// (S.obsidian.quest_sync or S.obsidian flat) and surfaces only fields that
// actually arrive; unknown fields stay unrendered.
function renderQuestSync(parent, S) {
  const qs = S.obsidian?.quest_sync || S.obsidian || null;
  if (!qs) return;
  const bits = [];
  if (qs.last_sync) bits.push(`Last sync ${esc(String(qs.last_sync).slice(0, 16).replace('T', ' '))}`);
  const n = int(qs.synced_quests) ?? int(qs.synced);
  if (n != null) bits.push(`${fmt(n)} ${plural(n, 'task', 'tasks')} synced`);
  if (!bits.length) return;
  const block = el('div', 'mind-block');
  block.appendChild(el('h2', 'mind-key', 'QUEST-BOARD SYNC'));
  block.appendChild(el('p', 'mind-line', bits.join(' · ')));
  parent.appendChild(block);
}

// ------------------------------------------------- NotebookLM shelf
// bundle.notebooklm is null until that capture ships — honest empty state, as
// a calm sentence rather than a dashed `.empty` box.
function renderShelf(parent, bundle) {
  const block = el('div', 'mind-block');
  block.appendChild(el('h2', 'mind-key', 'NOTEBOOKLM'));
  const nb = bundle?.notebooklm;
  if (!nb || !nb.notebooks?.length) {
    block.appendChild(el('p', 'mind-quiet', 'No notebooks captured yet.'));
    parent.appendChild(block);
    return;
  }
  const shelf = el('div', 'mind-shelf');
  nb.notebooks.forEach((n) => {
    const meta = [];
    if (n.last_opened) meta.push(`opened ${esc(String(n.last_opened).slice(0, 10))}`);
    if (int(n.dwell_ms) !== null) meta.push(`${esc(dur(num(n.dwell_ms)))} active`);
    shelf.appendChild(el('div', 'mind-book', `
      <span class="mind-book-t" title="${esc(n.url || '')}">${esc(n.title)}</span>
      ${meta.length ? `<span class="mind-book-m">${meta.join(' · ')}</span>` : ''}`));
  });
  block.appendChild(shelf);
  if (nb.captured_at) {
    block.appendChild(el('p', 'mind-line', `Captured ${esc(String(nb.captured_at).slice(0, 16).replace('T', ' '))}.`));
  }
  parent.appendChild(block);
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // belt-and-braces: a mount without a prior unmount still starts clean

    const root = el('div', 'mind');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    // THREE sections, in the exemplar's rhythm (hero / second thing / third
    // thing peeking at the fold): the vault summary and its cards, then the
    // canvas beneath them, then the supporting apparatus — sync status, the
    // NotebookLM shelf and the search launcher — in a quiet tail.
    //
    // They are also the repaint roots, and the split is load-bearing: the two
    // scan-derived sections repaint on data:select, the canvas repaints on a
    // live push, and neither may wipe the other (a canvas push landing
    // mid-keystroke must not blank the search field). They are plain sections
    // now rather than `.panel`s — that component draws a full 1px outline.
    const vaultPanel = el('section', 'mind-vaults');
    const canvasPanel = el('section', 'mind-canvas');
    const sourcePanel = el('section', 'mind-sources');
    root.appendChild(vaultPanel);
    root.appendChild(canvasPanel);
    root.appendChild(sourcePanel);

    const hq = ctx.hq;
    let copyTimer = 0, noteTimer = 0;
    teardown.push(() => { clearTimeout(copyTimer); clearTimeout(noteTimer); copyTimer = 0; noteTimer = 0; });

    // ---- canvas state: build-time snapshot, replaced by live seams --------
    let boards = objArr(ctx.data.bundle?.canvas);
    let canvasLive = false;   // has a LIVE payload reached this mount? (what the dot reports)

    // pick the board to show: the sticky one, else 'conjure', else the fullest
    function chooseBoard() {
      const named = (n) => boards.find((b) => b.name === n);
      return named(activeBoard)
        || named(DEFAULT_BOARD)
        || [...boards].sort((a, b) => objArr(b.nodes).length - objArr(a.nodes).length)[0]
        || null;
    }

    // ================================================= VAULTS (hero + cards)
    // Repainted on data:select — the vault list belongs to the SELECTED scan.
    function renderVaultPanel() {
      const S = ctx.data.selected;
      const vaults = S ? (S.inventory?.vaults || []) : [];

      vaultPanel.innerHTML = '';
      vaultPanel.appendChild(healthHero(vaults, !!S));
      if (!S || !vaults.length) return;   // the hero's rest state already said it

      const block = el('div', 'mind-block');
      block.appendChild(el('h2', 'mind-key', 'VAULTS'));
      const maxNotes = Math.max(...vaults.map((v) => num(v.notes)), 1);
      const grid = el('div', 'vault-grid');
      // primary vault first — the lead card opens the list
      [...vaults].sort((a, b) => (b.role === 'primary') - (a.role === 'primary'))
        .forEach((v) => grid.appendChild(vaultCard(v, maxNotes)));
      block.appendChild(grid);
      vaultPanel.appendChild(block);
    }

    // ============================================ SOURCES (the quiet tail)
    // Also scan-derived, so it repaints with the vault section on data:select.
    // Everything here is supporting apparatus rather than a headline: where the
    // quest board last synced, which notebooks were captured, and the launcher
    // that hands you an obsidian:// search link.
    function renderSourcePanel() {
      const S = ctx.data.selected;
      sourcePanel.innerHTML = '';
      if (!S) return;                     // no photograph, nothing to report
      renderQuestSync(sourcePanel, S);
      renderShelf(sourcePanel, ctx.data.bundle);
      renderSearch(sourcePanel, S);
    }

    // ------------------------------------------------- cross-vault search
    // Builds an obsidian://search URI as a COPYABLE string: this window can't
    // follow custom-protocol links (CSP default-src 'self' + no handler), so
    // the launcher hands the user the URI to paste instead of pretending
    // navigation works. Clipboard path: navigator.clipboard first,
    // select-the-field fallback (writeText can be denied over file://).
    function renderSearch(parent, S) {
      const vaults = S.inventory?.vaults || [];
      if (!vaults.length) return;   // the hero's rest state already covers no-data
      if (!vaults.some((v) => v.name === searchVault)) {
        searchVault = (vaults.find((v) => v.role === 'primary') || vaults[0]).name;
      }
      const block = el('div', 'mind-block');
      block.appendChild(el('h2', 'mind-key', 'SEARCH VAULTS'));
      const box = el('div', 'mind-search');
      box.innerHTML = `
        <div class="mind-search-row">
          <div class="field"><select data-vault title="Target vault">
            ${vaults.map((v) => `<option value="${esc(v.name)}"${v.name === searchVault ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}
          </select></div>
          <div class="field"><input data-q placeholder="Search all notes for…" /></div>
          <button class="btn" type="button" data-copy>Copy link</button>
        </div>
        <div class="field"><input data-out readonly spellcheck="false" title="obsidian:// search link" /></div>
        <p class="mind-line">This window can’t open obsidian:// links directly — copy the link and paste it into Win+R or your browser’s address bar.</p>`;
      block.appendChild(box);
      parent.appendChild(block);

      const sel = box.querySelector('[data-vault]');
      const q = box.querySelector('[data-q]');
      const out = box.querySelector('[data-out]');
      const copy = box.querySelector('[data-copy]');
      q.value = searchQuery;   // .value assignment, never innerHTML — user text stays inert
      const uriOf = () => `obsidian://search?vault=${encodeURIComponent(searchVault)}&query=${encodeURIComponent(searchQuery)}`;
      const paint = () => { out.value = uriOf(); };
      sel.onchange = () => { searchVault = sel.value; paint(); };
      q.oninput = () => { searchQuery = q.value; paint(); };
      q.onkeydown = (e) => { if (e.key === 'Enter') copy.click(); };
      copy.onclick = async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(uriOf()); ok = true; } catch { /* denied — fall through */ }
        if (!alive()) return;
        if (!ok) {
          out.focus(); out.select();
          try { ok = document.execCommand('copy'); } catch { /* leave it selected for a manual Ctrl+C */ }
        }
        copy.textContent = ok ? 'Copied' : 'Selected — press Ctrl+C';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { if (alive()) copy.textContent = 'Copy link'; }, 1600);
      };
      paint();
    }

    // ================================================= CANVAS (lower half)
    // Repainted on canvas pushes and board-tab clicks; independent of the
    // vault half so a live push never wipes the search field mid-keystroke.
    // Everything here is deliberately quieter than the hero above it.
    function renderCanvasPanel() {
      const board = chooseBoard();
      if (board) activeBoard = board.name;
      // newest-first: both writers push() to nodes[], so file order is chronological
      const nodes = board ? [...objArr(board.nodes)].reverse() : [];
      const bridged = !!(hq?.onCanvas || hq?.getCanvas);

      canvasPanel.innerHTML = '';
      const head = el('div', 'mind-head');
      head.innerHTML = `
        <h2 class="mind-key">CANVAS</h2>
        <span class="pulse-dot" data-live="${bridged ? (canvasLive ? 'yes' : 'no') : 'none'}"
              title="${canvasLive ? 'Live: this mount has received a canvas push from the app.'
                                  : (bridged ? 'No live canvas payload yet — showing the build-time snapshot.'
                                             : 'No bridge in this preview — showing the build-time snapshot.')}"></span>
        <span class="mind-state">${canvasLive ? 'Live' : 'Build snapshot'}</span>
        <span class="mind-count">${nodes.length} ${plural(nodes.length, 'element', 'elements')}</span>`;
      canvasPanel.appendChild(head);
      canvasPanel.appendChild(el('p', 'mind-teach',
        'Live UI Claude builds while you chat — newest first. Boards are JSON-canvas files in data/canvas/, Obsidian-compatible.'));

      // board switcher (only when there's a real choice). Underlined words, not
      // outlined buttons: board names are data and the canvas half recedes.
      if (boards.length > 1) {
        const bar = el('div', 'mind-tabs');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Canvas boards');
        boards.forEach((b) => {
          const on = b === board;
          const t = el('button', 'mind-tab' + (on ? ' on' : ''), esc(b.name));
          t.type = 'button';
          t.setAttribute('aria-pressed', on ? 'true' : 'false');
          t.title = `Show the "${b.name}" board (${objArr(b.nodes).length} elements)`;
          t.onclick = () => { activeBoard = b.name; renderCanvasPanel(); };
          bar.appendChild(t);
        });
        canvasPanel.appendChild(bar);
      }

      renderAddNote(canvasPanel, board);

      if (!nodes.length) {
        const teach = el('div', 'mind-canvas-empty', `
          <p>Nothing on the canvas yet. Ask Claude to build something while you chat —
             a stat tile, a checklist, a chart — and it appears here live. Claude draws by
             appending a node to the <b>${esc(DEFAULT_BOARD)}</b> board:</p>
          <pre class="mind-spec">hq_canvas_add(name:"${esc(DEFAULT_BOARD)}", text:
\`\`\`hq
{ "type": "stat", "label": "Red quests", "value": 3, "delta": -2, "tone": "danger" }
\`\`\`
)</pre>
          <p>Types: <b>stat</b> · <b>progress</b> · <b>checklist</b> · <b>callout</b> ·
             <b>table</b> · <b>chips</b> · <b>spark</b> · <b>bars</b> · <b>note</b></p>`);
        canvasPanel.appendChild(teach);
        return;
      }

      const feed = el('div', 'mind-feed');
      nodes.forEach((n) => { try { feed.appendChild(widgetEl(n)); } catch { /* one bad node never blanks the feed */ } });
      canvasPanel.appendChild(feed);
    }

    // ------------------------------------------------- the one write path
    // canvasAdd is additive and CONFIRMABLE (main appends to the .canvas file
    // atomically and the fs-watcher pushes the new board back — no reload), so
    // this button gets the full honest-async treatment: Adding… → the pushed
    // repaint showing the note IS the confirmation. Failure is visible on the
    // control, never console-only.
    function renderAddNote(parent, board) {
      const target = (board && board.name) || DEFAULT_BOARD;
      const row = el('div', 'mind-add');
      row.innerHTML = `
        <div class="field"><input data-note maxlength="2000" placeholder="Add a text note to this board…" /></div>
        <button class="btn" type="button" data-add>Add note</button>`;
      const input = row.querySelector('[data-note]');
      const btn = row.querySelector('[data-add]');
      input.value = noteDraft;   // .value assignment — user text stays inert
      input.oninput = () => { noteDraft = input.value; };

      if (typeof hq?.canvasAdd !== 'function') {
        btn.disabled = true;
        input.disabled = true;
        btn.title = 'Adding a note needs the live app — this preview has no bridge to the main process (window.hq.canvasAdd is absent).';
        input.title = btn.title;
      } else {
        btn.title = board
          ? `Append a text note to the "${target}" board. Main writes data/canvas/${target}.canvas and the watcher pushes it back here.`
          : `No boards yet — this creates the "${target}" board with your note as its first node.`;
        const submit = async () => {
          const text = input.value.trim();
          if (!text) { input.focus(); return; }
          btn.disabled = true;
          btn.textContent = 'Adding…';
          try {
            const ok = await Promise.resolve(hq.canvasAdd(target, { type: 'text', text }));
            if (!alive()) return;
            if (ok === false) throw new Error('main refused the write (bad board name or node)');
            noteDraft = '';
            input.value = '';
            btn.disabled = false;
            btn.textContent = 'Added';   // the watcher push repaints the feed with the note
            clearTimeout(noteTimer);
            noteTimer = setTimeout(() => { if (alive() && btn.isConnected) btn.textContent = 'Add note'; }, 1600);
          } catch (err) {
            if (!alive()) return;
            console.warn('[mind] canvasAdd failed', err);
            btn.disabled = false;
            btn.classList.add('btn--bad');
            btn.textContent = '✗ Not added';
            btn.title = `Not added — ${String(err?.message || err)}. Click to retry.`;
          }
        };
        btn.onclick = submit;
        input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      }
      parent.appendChild(row);
    }

    // ---- first paint ------------------------------------------------------
    renderVaultPanel();
    renderCanvasPanel();
    renderSourcePanel();

    // ---- live wiring (all feature-detected, all torn down) ---------------
    teardown.push(ctx.bus.on('data:select', () => {
      if (!alive()) return;
      // both scan-derived sections; the canvas half is untouched, so a scrub
      // never disturbs the feed and a push never disturbs the search field
      renderVaultPanel();
      renderSourcePanel();
    }));

    // live canvas beats the build-time snapshot — both seams optional
    if (typeof hq?.getCanvas === 'function') {
      Promise.resolve(hq.getCanvas()).then((payload) => {
        if (!alive()) return;
        const arr = liveBoards(payload);
        if (Array.isArray(arr)) { boards = objArr(arr); canvasLive = true; renderCanvasPanel(); }
      }).catch(() => { /* seed is best-effort; the snapshot stays up */ });
    }
    if (typeof hq?.onCanvas === 'function') {
      const offCanvas = hq.onCanvas((payload) => {
        if (!alive()) return;
        const arr = liveBoards(payload);
        if (Array.isArray(arr)) { boards = objArr(arr); canvasLive = true; renderCanvasPanel(); }
      });
      if (typeof offCanvas === 'function') teardown.push(offCanvas);   // the disposer — MUST be released
    }

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d:
    // console text, not DOM.
    const S = ctx.data.selected;
    const vaults = S ? (S.inventory?.vaults || []) : [];
    const shown = chooseBoard();
    console.log(`MIND mounted vaults=${vaults.length} notes=${vaults.reduce((n, v) => n + num(v.notes), 0)} boards=${boards.length} nodes=${shown ? objArr(shown.nodes).length : 0} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();
  },
};
