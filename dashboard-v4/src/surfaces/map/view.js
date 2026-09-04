// MAP — the isometric project city, restored for v4.3.
//
// This is the screen the user missed: every project is a BUILDING on a 2:1
// isometric grid, and the storage warehouse sits beneath it. The drawing
// geometry is a near-verbatim port of dashboard-v3/src/realms/lands/view.js
// (the thing being restored is the picture itself, so the maths must not be
// "improved") — what changed is the module plumbing and the palette:
//
//   PLUMBING  $('basemap') -> the mount root; SCANS/cur/D closure globals ->
//             ctx.data; SFX/aos idle motion -> removed; LX() lexicon lookups ->
//             literal English (v4 ships one register, there is no lexicon).
//   PALETTE   v3's neon COL.* ramp -> the exemplar's muted seams, so the city
//             sits in the same colour world as HOME.
//
// CONSTITUTION COMPLIANCE, stated so a later editor knows what not to break
// (the reference is dashboard-v4/styles/home.css + surfaces/home/view.js):
// - ONE focal element: THE MAP. It is the only large object on the screen and
//   the only thing carrying an edge glow. There is deliberately NO display-
//   weight text here — a --fs-2xl headline would compete with the picture.
// - VIOLET BUDGET: exactly ONE violet accent, the map holder's edge glow.
//   (Focus rings use --hud-violet-hi, as they do on every v4 surface; a focus
//   ring is not a decorative accent and is not counted, same as home.css.)
// - BORDER DIET: map.css contains ZERO `border: 1px solid` declarations. The
//   city plinth and the storage cards separate from the ground by a background
//   step plus --space-6/7 of air. Severity is carried by COLOUR, not outline.
// - MIXED CASE: every sentence and every title is prose. ALL-CAPS + mono is a
//   label register only — the two section eyebrows and the tiny legend/meta
//   captions. Project names come from the scan and are printed as given; a
//   name the user typed in capitals is DATA, not a shouted heading.
//
// LIFECYCLE CONTRACT (reference implementation: work/view.js and home/view.js):
// everything created in mount() is released in unmount() AND before every
// re-render. `gen` is bumped by BOTH mount and unmount so any continuation that
// resolves after teardown touches nothing. Element handlers are property
// assignments on nodes this surface created, so a re-render drops the handler
// with the node. The one document-level listener (Escape closes the drawer) is
// registered with addEventListener and removed through `teardown`.
import { el, esc, fmt } from '../../ui/util.js';
// Cross-surface imports, NOT edits: the project drawer, its dev-toggle repaint
// and the prev-scan index already exist and are already the audited way to show
// a project's detail. Forking them here would give the app two drawers that
// would eventually disagree about what a project is.
import { openDrawer } from '../projects/drawer.js';
import { paintDevToggle } from '../projects/dev-toggle.js';
import { prevProjectMap } from '../projects/core.mjs';

// STYLESHEET. index.html is not in this agent's ownership, so the surface links
// its own sheet on first mount (same pattern as home/, system/ and lookback/).
// Resolved from import.meta.url — not the document URL — so it is correct under
// the verify harness too. Idempotent, tolerates a later static <link>, and
// never torn down: it is one <head> node, and removing it per surface switch
// would flash the surface unstyled.
const CSS_HREF = new URL('../../../styles/map.css', import.meta.url).href;
function ensureStyles() {
  if (document.querySelector('link[data-map-css], link[href$="map.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.setAttribute('data-map-css', '');
  document.head.appendChild(link);
}

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

// Dev-server run state, fed ONLY by hq:dev-status pushes — the same shape and
// the same repaint path PROJECTS uses, so a drawer opened from the map can
// never show "▶ Dev" for a server that is actually running. Module-level so it
// survives re-renders and surface switches.
const devRunning = Object.create(null);

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[map] teardown', err); }
  }
}

// ---------------------------------------------------------------- constants
// Module constants, never scan data, so inlining them into an SVG attribute is
// safe. The four standing bands replace v3's neon COL.green/yellow/orange/red
// with muted tones in the exemplar's register (home.css's --seam-win /
// --seam-rescue are two of them verbatim). At-risk keeps the loudest value on
// the screen because SEVERITY OWNS COLOUR — and on the live scan most towers
// are genuinely at risk, so the red is reporting, not decorating. The decay
// tint below then darkens every dormant tower, which is what stops a city of
// red buildings reading as an alarm.
const BAND = {
  ok:    '#86b986',   // on track   — 75%+ and no risk flag
  going: '#c8b45e',   // in progress— 40–74%
  early: '#d98a3a',   // early      — under 40%
  risk:  '#cf5b62',   // at risk    — high git risk or a red build
};
const GROUND_FILL = '#12102a';   // the tile, one step under --hud-ink
const GROUND_EDGE = '#241d44';   // tile seam, near --hud-line
const HALO        = '#0d0b16';   // --hud-ink: label halo + roof edge
const WARN        = '#e6c34a';   // --hud-yellow: the ⚠ secrets mark
const STAFF       = '#cfc9ea';   // pennant staff, near --hud-text
// Floor-lines lit by activity — the "someone is home" signal, at 0.5 opacity.
const LIT = { active: '#f0e6b0', stale: '#8a8550', dormant: '#3a385a' };

// Grid geometry. v3 used 150×74 tiles and towers up to 101 units tall — a row
// pitch of 37 under buildings three times that height, which put every front
// label deep inside the body of the tower behind it. The halo pass kept the
// text READABLE, but you could not tell which label belonged to which building,
// and "cannot tell what I am looking at" is the crowding the constitution
// exists to kill. So the tiles are opened up (176×150, row pitch 75) and the
// towers shortened (max 69 instead of 101): the picture, the projection and the
// meaning are v3's — only the air between the buildings changed.
//
// TILE_W is deliberately much larger than TILE_H (240 vs 150, where v3 was
// roughly 2:1). The rendered scale of this map is bound by its HEIGHT — the
// plinth is wide and short — so widening the tiles does not shrink the
// buildings, it only spreads them across width the layout already has. Half a
// tile of x-pitch (120) is wider than half a 20-character label (~60), which is
// what stops two labels in the same row from ever running into each other.
const TILE_W = 240, TILE_H = 150, FX = 36, FY = 18;
const HEAD = 38;          // headroom above the tallest roof for its label
const H_BASE = 14, H_SCALE = 0.55;
const H_MAX = H_BASE + 100 * H_SCALE;
// The three things stacked above a roof apex, in units above it. They are ONE
// budget: the name sits highest, the completion line under it, and the pennant
// flies in the clear band between the completion line's baseline and the roof.
// Tightening any of these without moving the others is what makes a red flag
// draw straight through "73%" — the band must stay wider than the pennant.
// PENNANT_Y 4 (v3 used 7) plants the staff's foot just inside the roof face and
// puts its top at 11 units above the apex — clear of the completion line, whose
// glyph box reaches 12 units up. v3's 7 left the staff crossing the descender
// band of that text, which is why its flags looked like strikethroughs.
const LBL_NAME = 26, LBL_META = 15, PENNANT_Y = 4;

// ------------------------------------------------------------- geometry (v3)
function shade(hex, amt) {            // amt<0 darkens, amt>0 lightens
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f + add))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(gg) + c(b);
}
const f1 = (v) => Number(v).toFixed(1);
const pctOf = (p) => Math.max(0, Math.min(100, Number(p?.completion?.pct) || 0));
function bHeight(p) { return H_BASE + pctOf(p) * H_SCALE; }

// Standing colour incl. the decay tint — shared by the building and its label
// so the % reads in the same colour as its tower.
function standing(p) {
  const g = p?.metrics?.git_safety || {}, ch = p?.metrics?.code_health || {};
  const comp = pctOf(p);
  const riskHigh = g.risk === 'high' || ch.build === 'red';
  let base = riskHigh ? BAND.risk : comp < 40 ? BAND.early : comp < 75 ? BAND.going : BAND.ok;
  const dsc = Number(p?.activity?.days_since_commit) || 0;
  const decayK = Math.min(1, dsc / 90) * 0.65;
  if (decayK > 0) base = shade(base, -decayK * 0.5);
  return base;
}
function idleStr(dsc) { return dsc >= 60 ? Math.round(dsc / 30) + 'mo' : dsc + 'd'; }

function isoGround(cx, cy) {
  const pts = [[cx, cy - FY], [cx + FX, cy], [cx, cy + FY], [cx - FX, cy]]
    .map((p) => p.map(f1).join(',')).join(' ');
  return `<polygon points="${pts}" fill="${GROUND_FILL}" stroke="${GROUND_EDGE}" stroke-width="0.7"/>`;
}

function isoBuilding(p, cx, cy, openQ) {
  const h = bHeight(p);
  const rs = p?.metrics?.risk_security || {};
  const base = standing(p);
  const top = base, left = shade(base, -0.40), right = shade(base, -0.20);
  const N = [cx, cy - FY - h], E = [cx + FX, cy - h], Sp = [cx, cy + FY - h], W = [cx - FX, cy - h];
  const Sg = [cx, cy + FY], Eg = [cx + FX, cy], Wg = [cx - FX, cy];
  const poly = (pp, fill, extra = '') => `<polygon points="${pp.map((q) => q.map(f1).join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
  const name = String(p?.name || p?.id || 'project');
  let s = `<g class="bld" data-pid="${esc(p?.id ?? '')}" role="button" tabindex="0"`
        + ` aria-label="${esc(name)} — ${pctOf(p)} percent, open its panel">`;
  s += `<title>${esc(name)}</title>`;
  s += `<ellipse cx="${f1(cx)}" cy="${f1(cy + FY + 3)}" rx="${FX}" ry="${f1(FY * 0.55)}" fill="#000" opacity="0.4"/>`;
  s += poly([W, Wg, Sg, Sp], left);
  s += poly([Sp, Sg, Eg, E], right);
  const lit = p?.activity?.state === 'active' ? LIT.active : p?.activity?.state === 'stale' ? LIT.stale : LIT.dormant;
  const up = [Sp[0] - Sg[0], Sp[1] - Sg[1]];
  for (let v = 0.2; v < 0.95; v += 0.22) {
    const a = [Sg[0] + up[0] * v, Sg[1] + up[1] * v], b = [Eg[0] + up[0] * v, Eg[1] + up[1] * v];
    s += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${lit}" stroke-width="0.8" opacity="0.5"/>`;
  }
  s += poly([N, E, Sp, W], top, `stroke="${HALO}" stroke-width="0.7"`);
  // One red pennant per building, carrying its open-task count.
  if (openQ) {
    s += `<g class="pennant" transform="translate(${f1(cx)},${f1(cy - FY - h - PENNANT_Y)})">`
      + `<line x1="0" y1="-7" x2="0" y2="6" stroke="${STAFF}" stroke-width="1"/>`
      + `<polygon points="0,-7 12,-4 0,-1" fill="${BAND.risk}"/>`
      + `<text x="3.5" y="-2.6" font-size="6" fill="#fff" font-family="monospace">${esc(String(openQ))}</text></g>`;
  }
  if ((Number(rs.secrets_found) || 0) > 0) {
    s += `<text x="${f1(cx + FX - 6)}" y="${f1(cy - h + 2)}" font-size="10" fill="${WARN}">⚠</text>`;
  }
  return s + '</g>';
}

// Labels draw in a SEPARATE pass ON TOP of every building (see cityStage) so a
// front tower can never occlude a back tower's label. Anchored above each roof
// apex, with a dark halo (paint-order:stroke) so the text reads over anything
// behind it. Name on line 1, completion % · idle on line 2.
function isoLabel(p, cx, cy) {
  const comp = pctOf(p);
  const apexY = cy - FY - bHeight(p);
  const base = standing(p);
  const dsc = Number(p?.activity?.days_since_commit) || 0;
  const raw = String(p?.name || p?.id || 'project');
  // v3 truncated at 20 because its tiles were 150 wide. At TILE_W 240 half the
  // x-pitch is 120 units and a 26-character name is ~85 half-wide, so the cap
  // can be relaxed without two names in a row ever meeting.
  const name = raw.length > 26 ? raw.slice(0, 25) + '…' : raw;
  const meta = comp + '%' + (dsc >= 14 ? '  ' + idleStr(dsc) : '');
  const halo = `stroke="${HALO}" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round"`;
  let s = '<g class="blabel" pointer-events="none">';
  s += `<text x="${f1(cx)}" y="${f1(apexY - LBL_NAME)}" text-anchor="middle" font-size="12" font-weight="700" fill="#f2f0ff" ${halo}>${esc(name)}</text>`;
  s += `<text x="${f1(cx)}" y="${f1(apexY - LBL_META)}" text-anchor="middle" font-size="11" font-weight="700" fill="${base}" ${halo} font-family="monospace">${esc(meta)}</text>`;
  return s + '</g>';
}

// The whole city as one SVG string. Painter's algorithm: ground tiles, then
// buildings back-to-front, then EVERY label on top.
function cityStage(projs, scan) {
  const openByProj = Object.create(null);
  for (const q of (scan.quests || [])) {
    if (q?.status === 'open' || q?.status === 'in_progress') {
      openByProj[q.project_id] = (openByProj[q.project_id] || 0) + 1;
    }
  }
  const n = projs.length, cols = Math.ceil(Math.sqrt(n));
  const cells = projs.map((p, i) => {
    const gx = i % cols, gy = Math.floor(i / cols);
    return { p, gx, gy, cx: (gx - gy) * TILE_W / 2, cy: (gx + gy) * TILE_H / 2 };
  });
  const xs = cells.map((c) => c.cx), ys = cells.map((c) => c.cy);
  const minX = Math.min(...xs) - FX - 16, maxX = Math.max(...xs) + FX + 16;
  const minY = Math.min(...ys) - FY - H_MAX - HEAD, maxY = Math.max(...ys) + FY + 16;
  cells.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.cx - b.cx);   // back-to-front
  let svg = `<svg class="isomap" viewBox="${f1(minX)} ${f1(minY)} ${f1(maxX - minX)} ${f1(maxY - minY)}" preserveAspectRatio="xMidYMid meet">`;
  for (const c of cells) svg += isoGround(c.cx, c.cy);
  for (const c of cells) svg += isoBuilding(c.p, c.cx, c.cy, openByProj[c.p?.id] || 0);
  for (const c of cells) svg += isoLabel(c.p, c.cx, c.cy);
  return svg + '</svg>';
}

// The key. Mixed-case words with a colour dot each — the swatch colours are the
// BAND constants above, never data.
function legendHtml() {
  const dot = (c, label) => `<span class="lg-item"><i class="lg-dot" style="background:${c}"></i>${esc(label)}</span>`;
  return dot(BAND.ok, 'on track')
    + dot(BAND.going, 'in progress')
    + dot(BAND.early, 'early')
    + dot(BAND.risk, 'at risk')
    + `<span class="lg-item"><i class="lg-flag" style="background:${BAND.risk}"></i>open tasks</span>`
    + `<span class="lg-item"><i class="lg-mark" style="color:${WARN}">⚠</i>secrets seen</span>`
    + '<span class="lg-item lg-note">Faded towers have not been touched in months.</span>';
}

// ------------------------------------------------------------------ the city
function buildCity(scan, onOpen) {
  const projs = (scan.projects || []).filter(Boolean);
  const sec = el('section', 'map-city');
  sec.innerHTML = `
    <div class="map-key">The project city</div>
    <h1 class="city-title">Every project is a building.</h1>
    <p class="city-note">Height is how far along it is, colour is how it is standing, and a pennant flies
      for each open task. Pick a building to open its panel.</p>`;

  if (!projs.length) {
    sec.appendChild(el('p', 'map-quiet', 'This snapshot holds no projects, so there is no city to draw yet.'));
    return { el: sec, count: 0 };
  }

  sec.appendChild(el('div', 'map-legend', legendHtml()));
  const holder = el('div', 'map-holder');
  holder.innerHTML = cityStage(projs, scan);
  sec.appendChild(holder);
  sec.appendChild(el('p', 'map-caption',
    `${fmt(projs.length)} building${projs.length === 1 ? '' : 's'} standing in this snapshot.`));

  // A building is a real control: click, Enter and Space all open its panel.
  for (const g of holder.querySelectorAll('[data-pid]')) {
    const id = g.getAttribute('data-pid');
    g.onclick = () => onOpen(id);
    g.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); onOpen(id); }
    };
  }
  return { el: sec, count: projs.length };
}

// ----------------------------------------------------------------- warehouse
// Storage lives inside MAP — knowledge bases, reference clones, anomalies,
// duplicates, dead folders, the archive and the learning log are the city's
// inventory. Every list v3 rendered is rendered here; an empty list is omitted
// rather than shown as an empty card (v3 parity).
function storeCard(grid, title, count) {
  const c = el('article', 'store-card');
  c.innerHTML = `<div class="store-head"><h3 class="store-name">${esc(title)}</h3>`
              + `<span class="store-n">${esc(String(count))}</span></div>`;
  grid.appendChild(c);
  return c;
}
// name + optional meta + optional tag. `tone` selects a colour-only severity
// register — there is no outlined pill anywhere in this surface.
function storeRow(card, name, meta, tag, tone) {
  const row = el('div', 'store-row');
  row.innerHTML = `<span class="row-name">${esc(name)}</span>`
    + (meta ? `<span class="row-meta">${esc(meta)}</span>` : '')
    + (tag ? `<span class="row-tag${tone ? ' row-tag--' + tone : ''}">${esc(tag)}</span>` : '');
  card.appendChild(row);
  return row;
}

function buildStorage(scan, ctx) {
  const inv = scan.inventory || {};
  const sec = el('section', 'map-store');
  sec.innerHTML = `
    <div class="map-key">Storage</div>
    <h2 class="store-title">What else is on disk.</h2>`;
  const grid = el('div', 'store-grid');

  if (inv.vaults?.length) {
    const c = storeCard(grid, 'Knowledge bases', inv.vaults.length);
    for (const v of inv.vaults) storeRow(c, String(v?.name ?? 'unnamed'), `${fmt(Number(v?.notes) || 0)} notes`, String(v?.role ?? ''), null);
  }
  if (inv.clones?.length) {
    const c = storeCard(grid, 'Reference clones', inv.clones.length);
    for (const cl of inv.clones) {
      const short = String(cl?.name ?? '').split('/').pop() || String(cl?.name ?? 'clone');
      const row = storeRow(c, short, '', cl?.diverged ? `${fmt(Number(cl.dirty) || 0)} diverged` : 'clean', cl?.diverged ? 'warn' : null);
      // The origin is scan text, and a title attribute is never parsed as markup.
      if (cl?.origin) row.title = String(cl.origin);
    }
  }
  if (inv.anomalies?.length) {
    const c = storeCard(grid, 'Anomalies', inv.anomalies.length);
    for (const an of inv.anomalies) {
      const sev = an?.severity === 'danger' ? 'bad' : an?.severity === 'warning' ? 'warn' : null;
      storeRow(c, String(an?.detail ?? 'anomaly'), '', String(an?.severity ?? ''), sev);
    }
  }
  if (inv.duplicates?.length) {
    const c = storeCard(grid, 'Duplicates', inv.duplicates.length);
    for (const dp of inv.duplicates) storeRow(c, String(dp?.detail ?? 'duplicate'), '', String(dp?.type ?? ''), 'warn');
  }
  const trivial = inv.trivial || [], empty = inv.empty || [];
  if (trivial.length || empty.length) {
    const c = storeCard(grid, 'Trivial and empty', trivial.length + empty.length);
    if (empty.length) storeRow(c, 'Empty folders', empty.map(String).join(', '), '', null);
    for (const t of trivial) storeRow(c, String(t?.name ?? 'folder'), String(t?.note ?? ''), '', null);
  }

  // Archive — archived projects with one-click restore.
  const archived = scan.archived_projects || [];
  if (archived.length) {
    const c = storeCard(grid, 'Archived projects', archived.length);
    const canRevive = typeof ctx.hq?.reviveProject === 'function';
    for (const ap of archived) {
      const row = storeRow(c, String(ap?.name ?? ap?.id ?? 'project'), ap?.archived_on ? `archived ${ap.archived_on}` : '', '', null);
      const b = el('button', 'btn btn--sm', '↺ Restore');
      b.type = 'button';
      if (!canRevive) {
        b.disabled = true;
        b.title = 'Needs the live app — restoring an archived project has no bridge to the main process here (window.hq is absent).';
      } else {
        b.title = 'Put this project back on the map — asynchronous: the main process rewrites the scan and the window reloads when it is done.';
        b.onclick = () => {
          b.disabled = true;                       // before the call: this is a write
          b.textContent = 'Restoring…';
          Promise.resolve(ctx.hq.reviveProject(ap?.id)).catch((err) => {
            console.warn('[map] reviveProject failed', err);
            b.textContent = 'Not restored';
            b.title = `Not restored — ${String(err?.message || err)}`;
          });
        };
      }
      row.appendChild(b);
    }
  }

  // The learning log.
  const learnings = scan.recent_learnings || [];
  if (learnings.length) {
    const total = Number(scan.account?.totals?.learnings) || learnings.length;
    const c = storeCard(grid, 'What I learned', total);
    for (const l of learnings) storeRow(c, String(l?.text ?? ''), String(l?.ts ?? '').slice(0, 10), '', null);
  }

  if (!grid.children.length) {
    sec.appendChild(el('p', 'map-quiet',
      'Nothing in storage for this snapshot — no vaults, clones, anomalies or archived projects were recorded.'));
    return { el: sec, count: 0 };
  }
  sec.appendChild(grid);
  return { el: sec, count: grid.children.length };
}

// ---------------------------------------------------------------------- view
export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // a mount without a prior unmount still starts clean
    ensureStyles();

    const root = el('div', 'map');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    let drawer = null;
    const closeDrawer = () => { if (drawer) { try { drawer.close(); } catch { /* already gone */ } drawer = null; } };

    const render = () => {
      closeDrawer();                    // an open drawer closes over the OLD scan
      root.innerHTML = '';
      const scan = ctx.data.selected;   // re-read EVERY render — scrub-safe
      if (!scan) {
        // No photograph, no city. One calm sentence, no controls.
        root.appendChild(el('p', 'map-quiet map-quiet--only',
          'No scan data in this build yet. Run a scan and the city will build itself from your projects.'));
        return { buildings: 0, cards: 0 };
      }
      const prevScan = ctx.data.selectedIndex > 0 ? ctx.data.scans[ctx.data.selectedIndex - 1] : null;
      const prevMap = prevProjectMap(prevScan);

      const city = buildCity(scan, (id) => {
        const p = (scan.projects || []).find((x) => x?.id === id);
        if (!p) return;
        closeDrawer();
        drawer = openDrawer(root, { project: p, prev: prevMap[p.id] || null, scan, hq: ctx.hq, devRunning }, () => { drawer = null; });
      });
      root.appendChild(city.el);

      const store = buildStorage(scan, ctx);
      root.appendChild(store.el);
      return { buildings: city.count, cards: store.count };
    };

    const stats = render();

    // Scrubbing the time machine re-renders from the newly selected snapshot.
    // (The v4.1 shell additionally full-re-mounts on data:select per the
    // recorded b1d4d9c boundary — this handler keeps the surface honest even
    // where only the bus event arrives.) Idempotent.
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) render(); }));

    // Dev-server truth for a drawer opened from a building: the hq:dev-status
    // push repaints the toggle, exactly as it does on PROJECTS. Without this the
    // drawer's ▶ Dev would be a lying control for an already-running server.
    if (typeof ctx.hq?.onDevStatus === 'function') {
      teardown.push(ctx.hq.onDevStatus((d) => {
        if (!alive() || !d || d.id == null) return;
        devRunning[d.id] = !!d.running;
        for (const b of root.querySelectorAll('.dev-toggle')) {
          if (b.dataset.devId === String(d.id) && !b.disabled) paintDevToggle(b, !!d.running);
        }
      }));
    }

    // The one document-level listener, released with the mount.
    const onKey = (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); };
    document.addEventListener('keydown', onKey);
    teardown.push(() => document.removeEventListener('keydown', onKey));
    teardown.push(closeDrawer);

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d —
    // console text, not DOM; the payload is two integers and a flag.
    console.log(`MAP mounted buildings=${stats.buildings} storage=${stats.cards} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();                       // closes the drawer and drops the listeners
  },
};
