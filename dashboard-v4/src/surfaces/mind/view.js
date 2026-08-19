// MIND surface — the second brain, two panels:
//
//   VAULTS (know)              |  CANVAS (share)
//   Obsidian vault health,     |  the shared JSON-canvas boards Claude and the
//   quest-board sync status,   |  user both draw on — live widget feed via
//   NotebookLM shelf,          |  hq.getCanvas/onCanvas, plus the one write
//   cross-vault search         |  path: canvasAdd text notes
//
// Feature truth ported from dashboard-v3 observatory/view.js (vaults, sync,
// NotebookLM, search) + conjure/view.js + widget.js (canvas boards as a widget
// feed), rebuilt on the v4 component language. One deliberate upgrade over
// conjure: the feed renders EVERY node (widgetEl falls back to a markdown note
// card), not just spec widgets — otherwise the "Add note" button would write
// nodes the feed never shows, which is a lying control.
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
const vaultSize = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');
// boards/nodes are user- & Obsidian-editable files — never trust the shape
const objArr = (v) => (Array.isArray(v) ? v.filter((n) => n && typeof n === 'object') : []);
const liveBoards = (payload) => (Array.isArray(payload) ? payload : payload && payload.boards);

// ------------------------------------------------- vault cards (observatory)
// Card fields beyond {name, notes, role} (recent7 / stale90 / kb) are present
// in today's inventory but treated as optional — older scans may predate them.
function vaultCard(v, maxNotes) {
  const primary = v.role === 'primary';
  const c = el('div', 'vault-card' + (primary ? ' primary' : ''));
  const share = maxNotes ? Math.max(3, Math.round((num(v.notes) / maxNotes) * 100)) : 0;
  const facts = [];
  if (typeof v.recent7 === 'number') facts.push(`<span class="chip"${v.recent7 ? '' : ' data-sev="dim"'}>${v.recent7 ? `${v.recent7} updated this week` : 'no updates this week'}</span>`);
  if (typeof v.stale90 === 'number' && v.stale90 > 0) facts.push(`<span class="chip" data-sev="yellow">${v.stale90} untouched 90+ days</span>`);
  if (typeof v.kb === 'number') facts.push(`<span class="chip" data-sev="dim">${vaultSize(num(v.kb))}</span>`);
  c.innerHTML = `
    <div class="vault-top">
      <span class="vault-name">${esc(v.name)}</span>
      <span class="chip"${primary ? '' : ' data-sev="dim"'}>${esc(v.role)}</span>
    </div>
    <div class="vault-notes"><b>${fmt(num(v.notes))}</b> notes</div>
    <div class="meter"><i style="width:${share}%"></i></div>
    ${facts.length ? `<div class="vault-facts">${facts.join('')}</div>` : ''}`;
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
  if (qs.last_sync) bits.push(`last sync ${esc(String(qs.last_sync).slice(0, 16).replace('T', ' '))}`);
  const n = typeof qs.synced_quests === 'number' ? qs.synced_quests : typeof qs.synced === 'number' ? qs.synced : null;
  if (n != null) bits.push(`${fmt(n)} task${n === 1 ? '' : 's'} synced`);
  if (!bits.length) return;
  parent.appendChild(el('div', 'rule'));
  parent.appendChild(el('div', 'eyebrow mind-sec', 'Quest-board sync'));
  parent.appendChild(el('div', 'body', bits.join(' · ')));
}

// ------------------------------------------------- NotebookLM shelf
// bundle.notebooklm is null until that capture ships — honest empty state.
function renderShelf(parent, bundle) {
  parent.appendChild(el('div', 'rule'));
  parent.appendChild(el('div', 'eyebrow mind-sec', 'NotebookLM'));
  const nb = bundle?.notebooklm;
  if (!nb || !nb.notebooks?.length) {
    parent.appendChild(el('div', 'meta', 'No notebooks captured yet.'));
    return;
  }
  const shelf = el('div', 'mind-shelf');
  nb.notebooks.forEach((n) => {
    shelf.appendChild(el('div', 'mind-book', `
      <span class="mind-book-t" title="${esc(n.url || '')}">${esc(n.title)}</span>
      ${n.last_opened ? `<span class="meta">opened ${esc(String(n.last_opened).slice(0, 10))}</span>` : ''}
      ${typeof n.dwell_ms === 'number' ? `<span class="meta">${dur(num(n.dwell_ms))} active</span>` : ''}`));
  });
  parent.appendChild(shelf);
  if (nb.captured_at) parent.appendChild(el('div', 'meta', `captured ${esc(String(nb.captured_at).slice(0, 16).replace('T', ' '))}`));
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // belt-and-braces: a mount without a prior unmount still starts clean

    const root = el('div', 'mind');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    const vaultPanel = el('section', 'panel mind-vaults');
    const canvasPanel = el('section', 'panel panel--focal mind-canvas');
    root.appendChild(vaultPanel);
    root.appendChild(canvasPanel);

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

    // ================================================= VAULTS panel (left)
    // Repainted on data:select — the vault list belongs to the SELECTED scan.
    function renderVaultPanel() {
      const S = ctx.data.selected;
      const vaults = S ? (S.inventory?.vaults || []) : [];
      const total = vaults.reduce((n, v) => n + num(v.notes), 0);
      vaultPanel.innerHTML = `
        <div class="panel-head">
          <span class="panel-title">Vaults</span>
          <span class="panel-sub">Obsidian · ${vaults.length}</span>
          <span class="spacer"></span>
          <span class="figure"${vaults.length ? '' : ' data-sev="dim"'}>${fmt(total)}</span>
          <span class="figure-label">notes</span>
        </div>
        <div class="panel-body" data-body></div>`;
      const body = vaultPanel.querySelector('[data-body]');

      if (!S) {
        body.appendChild(el('div', 'empty', 'No scan data in this build — run a scan to see your vaults.'));
        return;
      }
      if (!vaults.length) {
        body.appendChild(el('div', 'empty', 'No vaults found yet — run a scan.'));
      } else {
        const maxNotes = Math.max(...vaults.map((v) => num(v.notes)), 1);
        const grid = el('div', 'vault-grid');
        // primary vault first — the emphasized card leads the list
        [...vaults].sort((a, b) => (b.role === 'primary') - (a.role === 'primary'))
          .forEach((v) => grid.appendChild(vaultCard(v, maxNotes)));
        body.appendChild(grid);
      }
      renderQuestSync(body, S);
      renderShelf(body, ctx.data.bundle);
      renderSearch(body, S);
    }

    // ------------------------------------------------- cross-vault search
    // Builds an obsidian://search URI as a COPYABLE string: this window can't
    // follow custom-protocol links (CSP default-src 'self' + no handler), so
    // the launcher hands the user the URI to paste instead of pretending
    // navigation works. Clipboard path: navigator.clipboard first,
    // select-the-field fallback (writeText can be denied over file://).
    function renderSearch(parent, S) {
      const vaults = S.inventory?.vaults || [];
      if (!vaults.length) return;   // the empty state above already covers no-data
      if (!vaults.some((v) => v.name === searchVault)) {
        searchVault = (vaults.find((v) => v.role === 'primary') || vaults[0]).name;
      }
      parent.appendChild(el('div', 'rule'));
      parent.appendChild(el('div', 'eyebrow mind-sec', 'Search across vaults'));
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
        <div class="meta">This window can’t open obsidian:// links directly — copy the link and paste it into Win+R or your browser’s address bar.</div>`;
      parent.appendChild(box);

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
        copy.textContent = ok ? 'Copied' : 'Selected — Ctrl+C';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { if (alive()) copy.textContent = 'Copy link'; }, 1600);
      };
      paint();
    }

    // ================================================= CANVAS panel (right)
    // Repainted on canvas pushes and board-tab clicks; independent of the
    // vault panel so a live push never wipes the search field mid-keystroke.
    function renderCanvasPanel() {
      const board = chooseBoard();
      if (board) activeBoard = board.name;
      // newest-first: both writers push() to nodes[], so file order is chronological
      const nodes = board ? [...objArr(board.nodes)].reverse() : [];

      canvasPanel.innerHTML = `
        <div class="panel-head">
          <span class="panel-title">Canvas</span>
          <span class="pulse-dot" data-live="${hq?.onCanvas || hq?.getCanvas ? (canvasLive ? 'yes' : 'no') : 'none'}"
                title="${canvasLive ? 'Live: this mount has received a canvas push from the app.'
                                    : (hq?.onCanvas || hq?.getCanvas ? 'No live canvas payload yet — showing the build-time snapshot.'
                                                                     : 'No bridge in this preview — showing the build-time snapshot.')}"></span>
          <span class="panel-sub">${canvasLive ? 'live' : 'build snapshot'}</span>
          <span class="spacer"></span>
          <span class="figure"${nodes.length ? '' : ' data-sev="dim"'}>${nodes.length}</span>
          <span class="figure-label">element${nodes.length === 1 ? '' : 's'}</span>
        </div>
        <div class="panel-body" data-body></div>`;
      const body = canvasPanel.querySelector('[data-body]');

      body.appendChild(el('div', 'meta mind-teach', 'Live UI Claude builds while you chat — newest first. Boards are JSON-canvas files in data/canvas/, Obsidian-compatible.'));

      // board switcher (only when there's a real choice)
      if (boards.length > 1) {
        const bar = el('div', 'mind-tabs');
        boards.forEach((b) => {
          const t = el('button', 'btn btn--sm' + (b === board ? ' is-on' : ''), esc(b.name));
          t.type = 'button';
          t.title = `Show the "${b.name}" board (${objArr(b.nodes).length} elements)`;
          t.onclick = () => { activeBoard = b.name; renderCanvasPanel(); };
          bar.appendChild(t);
        });
        body.appendChild(bar);
      }

      renderAddNote(body, board);

      if (!nodes.length) {
        const teach = el('div', 'empty mind-canvas-empty', `
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
        body.appendChild(teach);
        return;
      }

      const feed = el('div', 'mind-feed');
      nodes.forEach((n) => { try { feed.appendChild(widgetEl(n)); } catch { /* one bad node never blanks the feed */ } });
      body.appendChild(feed);
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

    // ---- live wiring (all feature-detected, all torn down) ---------------
    teardown.push(ctx.bus.on('data:select', () => {
      if (!alive()) return;
      renderVaultPanel();   // the vault list belongs to the selected snapshot
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
