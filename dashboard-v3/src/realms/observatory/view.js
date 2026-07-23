// OBSERVATORY — the knowledge realm (charter PART II §9, M4). Four surfaces:
// the vault constellation (S.inventory.vaults, real today), quest-board sync
// (feature-detected — today's latest.json carries no obsidian/quest-sync
// block), the NotebookLM shelf (DATA.notebooklm, null until the M4 tendril
// captures notebooklm.google.com), and the cross-vault scry launcher.
// Canon framing: notes = Insight; the header counter totals it across vaults.
import { el, esc, fmt } from '../../ui/util.js';
import { aosKids, aosRefresh, fmtDur, sfx } from '../../ui/components.js';

// Scry state at module scope, like grimoire's filter globals: survives both
// re-renders (data:select) and realm switches.
let scryVault = '', scryQuery = '';

let root = null, ctx = null, offSelect = null, copyTimer = 0;

const vaultSize = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');
// numeric gate for innerHTML interpolation: fmt() passes non-numbers through
// as raw strings, so anything counted from scan data funnels through num() first
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

// ------------------------------------------------- vault constellation
// Card fields beyond {name, notes, role} (recent7 / stale90 / kb) are present
// in today's inventory but treated as optional — older scans may predate them.
function vaultCard(v, maxNotes) {
  const primary = v.role === 'primary';
  const c = el('div', 'invcard obs-vault' + (primary ? ' primary' : ''));
  const share = maxNotes ? Math.max(3, Math.round((num(v.notes) / maxNotes) * 100)) : 0;
  const facts = [];
  if (typeof v.recent7 === 'number') facts.push(`<span class="obs-fact ${v.recent7 ? 'live' : ''}">${v.recent7 ? `✦ ${v.recent7} touched this week` : 'quiet this week'}</span>`);
  if (typeof v.stale90 === 'number' && v.stale90 > 0) facts.push(`<span class="obs-fact stale">${v.stale90} gathering dust (90d+)</span>`);
  if (typeof v.kb === 'number') facts.push(`<span class="obs-fact">${vaultSize(v.kb)}</span>`);
  c.innerHTML = `
    <div class="obs-vtop">
      <span class="obs-vname">${primary ? '◈ ' : ''}${esc(v.name)}</span>
      <span class="pill${primary ? ' obs-prime' : ''}">${esc(v.role)}</span>
    </div>
    <div class="obs-vnum"><b>${fmt(num(v.notes))}</b> notes</div>
    <div class="obs-vbar"><i style="width:${share}%"></i></div>
    ${facts.length ? `<div class="obs-vfacts">${facts.join('')}</div>` : ''}`;
  return c;
}

function renderVaults(parent, S) {
  const vaults = S.inventory?.vaults || [];
  const insight = vaults.reduce((n, v) => n + num(v.notes), 0);
  const head = el('h2', 'sec', `🔭 Vault constellation · ${vaults.length} charted`);
  const eye = el('span', 'obs-insight', `👁 ${fmt(insight)} INSIGHT`);
  eye.title = '1 note = 1 Insight — totalled across every charted vault';
  head.appendChild(eye);
  parent.appendChild(head);
  if (!vaults.length) {
    parent.appendChild(el('div', 'empty-note', 'no vaults charted — the collector hasn&#8217;t sighted an Obsidian sky yet. next scan, the stars come out.'));
    return;
  }
  const maxNotes = Math.max(...vaults.map((v) => num(v.notes)), 1);
  const grid = el('div', 'obs-vaults');
  // primary first — the emphasized card leads the constellation
  [...vaults].sort((a, b) => (b.role === 'primary') - (a.role === 'primary'))
    .forEach((v) => grid.appendChild(vaultCard(v, maxNotes)));
  parent.appendChild(grid);
  aosKids(grid, 'zoom-in', 60);
}

// ------------------------------------------------- quest-board sync
// Verified against data/latest.json (scan 2026-07-20): NO obsidian/quest-sync
// block exists yet — this section renders nothing today. The detector covers
// the struct-lane landing spot (S.obsidian.quest_sync or S.obsidian flat) and
// surfaces only fields that actually arrive; unknown fields stay unrendered.
function renderQuestSync(parent, S) {
  const qs = S.obsidian?.quest_sync || S.obsidian || null;
  if (!qs) return;
  const bits = [];
  if (qs.last_sync) bits.push(`last sync ${esc(String(qs.last_sync).slice(0, 16).replace('T', ' '))}`);
  const n = typeof qs.synced_quests === 'number' ? qs.synced_quests : typeof qs.synced === 'number' ? qs.synced : null;
  if (n != null) bits.push(`${fmt(n)} quest${n === 1 ? '' : 's'} mirrored to the board`);
  if (!bits.length) return;
  parent.appendChild(el('h2', 'sec', 'Quest-board sync'));
  parent.appendChild(el('div', 'obs-sync', `⟳ ${bits.join(' · ')}`));
}

// ------------------------------------------------- NotebookLM shelf
// DATA.notebooklm is null until the M4 tendril ships. Proposed sidecar shape
// (listed as an ask — struct lane owns the CONTRACT.md entry):
//   { captured_at: ISO string,
//     notebooks: [{ title, last_opened: ISO, dwell_ms: number, url: string }] }
function renderShelf(parent, bundle) {
  parent.appendChild(el('h2', 'sec', '📚 NotebookLM shelf'));
  const nb = bundle.notebooklm;
  if (!nb || !nb.notebooks?.length) {
    parent.appendChild(el('div', 'obs-dormant', 'shelf dormant — the NotebookLM tendril ships with M4. nothing captured yet, nothing missed.'));
    return;
  }
  const shelf = el('div', 'obs-shelf');
  nb.notebooks.forEach((n) => {
    shelf.appendChild(el('div', 'obs-book', `
      <span class="obs-bt" title="${esc(n.url || '')}">${esc(n.title)}</span>
      ${n.last_opened ? `<span class="obs-bm">opened ${esc(String(n.last_opened).slice(0, 10))}</span>` : ''}
      ${typeof n.dwell_ms === 'number' ? `<span class="obs-bm">${fmtDur(n.dwell_ms)} dwelled</span>` : ''}`));
  });
  parent.appendChild(shelf);
  if (nb.captured_at) parent.appendChild(el('div', 'obs-cap', `charted ${esc(String(nb.captured_at).slice(0, 16).replace('T', ' '))}`));
}

// ------------------------------------------------- cross-vault scry
// Builds an obsidian://search URI as a COPYABLE string: this window can't
// follow custom-protocol links (CSP default-src 'self' + no handler), so the
// launcher hands the user the URI instead of pretending navigation works.
// Clipboard path: navigator.clipboard first, select-the-field fallback
// (writeText can be denied over file://).
function renderScry(parent, S) {
  const vaults = S.inventory?.vaults || [];
  if (!vaults.length) return;   // the constellation empty-note already covers no-data
  if (!vaults.some((v) => v.name === scryVault)) {
    scryVault = (vaults.find((v) => v.role === 'primary') || vaults[0]).name;
  }
  parent.appendChild(el('h2', 'sec', 'Cross-vault scry'));
  const box = el('div', 'obs-scry');
  box.innerHTML = `
    <div class="obs-scry-row">
      <select class="obs-scry-vault" title="target vault">
        ${vaults.map((v) => `<option value="${esc(v.name)}"${v.name === scryVault ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}
      </select>
      <input class="obs-scry-q" placeholder="scry every note for…" />
      <button class="qbtn obs-scry-copy">⧉ COPY URI</button>
    </div>
    <input class="obs-scry-out" readonly spellcheck="false" title="obsidian:// search URI" />
    <div class="obs-scry-note">this window can&#8217;t follow obsidian:// links (CSP, no protocol handler) — copy the URI and paste it into Win+R or a browser bar. scenic route, same destination.</div>`;
  parent.appendChild(box);

  const sel = box.querySelector('.obs-scry-vault');
  const q = box.querySelector('.obs-scry-q');
  const out = box.querySelector('.obs-scry-out');
  const copy = box.querySelector('.obs-scry-copy');
  q.value = scryQuery;   // .value assignment, never innerHTML — user text stays inert
  const uriOf = () => `obsidian://search?vault=${encodeURIComponent(scryVault)}&query=${encodeURIComponent(scryQuery)}`;
  const paint = () => { out.value = uriOf(); };
  sel.onchange = () => { scryVault = sel.value; paint(); };
  q.oninput = () => { scryQuery = q.value; paint(); };
  q.onkeydown = (e) => { if (e.key === 'Enter') copy.click(); };
  copy.onclick = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(uriOf()); ok = true; } catch { /* denied — fall through */ }
    if (!ok) {
      out.focus(); out.select();
      try { ok = document.execCommand('copy'); } catch { /* leave it selected for a manual Ctrl+C */ }
    }
    copy.textContent = ok ? '✓ COPIED' : '⧉ SELECTED — Ctrl+C';
    sfx(ok ? 'coin' : 'blip');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copy.textContent = '⧉ COPY URI'; }, 1600);
  };
  paint();
}

function render() {
  if (!root || !ctx) return;
  root.innerHTML = '';
  const S = ctx.data.selected;
  if (!S) return;
  renderVaults(root, S);
  renderQuestSync(root, S);
  renderShelf(root, ctx.data.bundle);
  renderScry(root, S);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    root = el('div', 'realm-observatory');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    clearTimeout(copyTimer); copyTimer = 0;
    root = null; ctx = null;
  },
};
