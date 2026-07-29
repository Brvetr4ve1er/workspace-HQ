// MAP — the project map: an isometric base map (app.js renderBaseMap) + the
// storage inventory (renderInventory) below it, in v2's render order. Drawing
// code is verbatim; only module plumbing changed ($('basemap') → mount root,
// SCANS/cur/D closure globals → ctx.data, SFX.x() → sfx('x'), LX arrives via ctx).
import { el, esc, COL } from '../../ui/util.js';
import { aosKids, aosRefresh, deriveScanContext, openDrawer, sfx } from '../../ui/components.js';

// ============================================================ isometric base map
// Each project is a building on a 2:1 iso grid. Height ∝ completion, colour ∝ standing
// (green→yellow→orange→red by completion / git-risk / build), floor-lines lit by
// activity, a red pennant per open task, a ⚠ if secrets were seen. Click → drawer.
function shade(hex, amt) {            // amt<0 darkens, amt>0 lightens
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f + add))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(gg) + c(b);
}
function bHeight(p) { return 16 + (p.completion?.pct ?? 0) * 0.85; }
// Standing colour incl. decay tint — shared by the building and its label so
// the % reads in the same colour as its tower.
function standing(p) {
  const g = p.metrics.git_safety, ch = p.metrics.code_health;
  const comp = p.completion?.pct ?? 0;
  const riskHigh = g.risk === 'high' || ch.build === 'red';
  let base = riskHigh ? COL.red : comp < 40 ? COL.orange : comp < 75 ? COL.yellow : COL.green;
  const dsc = p.activity?.days_since_commit ?? 0;
  const decayK = Math.min(1, dsc / 90) * 0.65;
  if (decayK > 0) base = shade(base, -decayK * 0.5);
  return base;
}
function idleStr(dsc) { return dsc >= 60 ? Math.round(dsc / 30) + 'mo' : dsc + 'd'; }
function isoGround(cx, cy, fx, fy) {
  const pts = [[cx, cy - fy], [cx + fx, cy], [cx, cy + fy], [cx - fx, cy]].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  return `<polygon points="${pts}" fill="#0e0b22" stroke="#241d44" stroke-width="0.7"/>`;
}
function isoBuilding(p, cx, cy, fx, fy, openQ, sqN) {
  const h = bHeight(p);
  const rs = p.metrics.risk_security;
  const base = standing(p);
  const top = base, left = shade(base, -0.40), right = shade(base, -0.20);
  const N = [cx, cy - fy - h], E = [cx + fx, cy - h], Sp = [cx, cy + fy - h], W = [cx - fx, cy - h];
  const Sg = [cx, cy + fy], Eg = [cx + fx, cy], Wg = [cx - fx, cy];
  const f1 = (v) => v.toFixed(1);
  const poly = (pp, fill, extra = '') => `<polygon points="${pp.map((q) => q.map(f1).join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
  let s = `<g class="bld" data-pid="${esc(p.id)}">`;
  s += `<ellipse cx="${f1(cx)}" cy="${f1(cy + fy + 3)}" rx="${fx}" ry="${f1(fy * 0.55)}" fill="#000" opacity="0.4"/>`;
  s += poly([W, Wg, Sg, Sp], left);
  s += poly([Sp, Sg, Eg, E], right);
  const lit = p.activity.state === 'active' ? '#fff3a0' : p.activity.state === 'stale' ? '#8a8550' : '#3a385a';
  const up = [Sp[0] - Sg[0], Sp[1] - Sg[1]];
  for (let v = 0.2; v < 0.95; v += 0.22) {
    const a = [Sg[0] + up[0] * v, Sg[1] + up[1] * v], b = [Eg[0] + up[0] * v, Eg[1] + up[1] * v];
    s += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${lit}" stroke-width="0.8" opacity="0.5"/>`;
  }
  s += poly([N, E, Sp, W], top, 'stroke="#0c0a1e" stroke-width="0.7"');
  if (openQ) s += `<g transform="translate(${f1(cx)},${f1(cy - fy - h - 7)})"><line x1="0" y1="-7" x2="0" y2="6" stroke="#d9d6ff" stroke-width="1"/><polygon points="0,-7 12,-4 0,-1" fill="${COL.red}"/><text x="3.5" y="-2.6" font-size="6" fill="#fff" font-family="monospace">${openQ}</text></g>`;
  if ((rs.secrets_found || 0) > 0) s += `<text x="${f1(cx + fx - 6)}" y="${f1(cy - h + 2)}" font-size="10" fill="${COL.gold}">⚠</text>`;
  return s + '</g>';
}
// Labels draw in a SEPARATE pass ON TOP of every building (see renderBaseMap) so a
// front tower can never occlude a back tower's label. Anchored above each roof apex,
// with a dark halo (paint-order:stroke) so the text reads over anything behind it.
// name (line 1) + completion% · idle (line 2); truncation relaxed to 20 chars.
function isoLabel(p, cx, cy, fx, fy) {
  const comp = p.completion?.pct ?? 0;
  const apexY = cy - fy - bHeight(p);
  const base = standing(p);
  const dsc = p.activity?.days_since_commit ?? 0;
  const name = p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name;
  const meta = comp + '%' + (dsc >= 14 ? '  ' + idleStr(dsc) : '');
  const f1 = (v) => v.toFixed(1);
  const halo = 'stroke="#0c0a1e" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round"';
  let s = `<g class="blabel" pointer-events="none">`;
  s += `<text x="${f1(cx)}" y="${f1(apexY - 27)}" text-anchor="middle" font-size="11" font-weight="700" fill="#f2f0ff" ${halo}>${esc(name)}</text>`;
  s += `<text x="${f1(cx)}" y="${f1(apexY - 15)}" text-anchor="middle" font-size="10" font-weight="700" fill="${base}" ${halo} font-family="monospace">${meta}</text>`;
  return s + '</g>';
}
function mapLegend() {
  const it = (c, l) => `<span><i style="background:${c}"></i>${l}</span>`;
  return it(COL.green, 'on track') + it(COL.yellow, 'in progress') + it(COL.orange, 'early') + it(COL.red, 'at risk')
    + `<span><i class="penn" style="background:${COL.red}"></i>open tasks</span><span><i style="background:${COL.gold}"></i>⚠ secrets</span>`
    + `<span>idle time per project · faded = dormant</span>`;
}
function renderBaseMap(bm, S, prevProj, data, LX) {
  bm.innerHTML = '';
  const projs = [...S.projects];
  if (!projs.length) { bm.appendChild(el('div', 'empty-note', 'No products to map.')); return; }
  const openByProj = {}, sqByProj = {};
  (S.quests || []).filter((q) => q.status === 'open' || q.status === 'in_progress').forEach((q) => { openByProj[q.project_id] = (openByProj[q.project_id] || 0) + 1; });
  (S.side_quests || []).forEach((sq) => { sqByProj[sq.project_id] = (sqByProj[sq.project_id] || 0) + 1; });
  const n = projs.length, cols = Math.ceil(Math.sqrt(n));
  const tileW = 150, tileH = 74, fx = 32, fy = 16;   // roomier grid so towers + their labels don't crowd
  const cells = projs.map((p, i) => { const gx = i % cols, gy = Math.floor(i / cols); return { p, gx, gy, cx: (gx - gy) * tileW / 2, cy: (gx + gy) * tileH / 2 }; });
  const hMax = 16 + 100 * 0.85;
  const xs = cells.map((c) => c.cx), ys = cells.map((c) => c.cy);
  const minX = Math.min(...xs) - fx - 16, maxX = Math.max(...xs) + fx + 16;
  const minY = Math.min(...ys) - fy - hMax - 48, maxY = Math.max(...ys) + fy + 16;
  cells.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.cx - b.cx);   // painter's: back-to-front
  let svg = `<svg class="isomap" viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" preserveAspectRatio="xMidYMid meet">`;
  function f(v) { return Number(v).toFixed(1); }
  cells.forEach((c) => { svg += isoGround(c.cx, c.cy, fx, fy); });
  cells.forEach((c) => { svg += isoBuilding(c.p, c.cx, c.cy, fx, fy, openByProj[c.p.id] || 0, sqByProj[c.p.id] || 0); });
  cells.forEach((c) => { svg += isoLabel(c.p, c.cx, c.cy, fx, fy); });   // labels on top of ALL buildings
  svg += '</svg>';
  const wrap = el('div', 'mapwrap');
  wrap.appendChild(el('div', 'maphead', `<h2 class="sec">${LX('basemap_head')} · ${n} ${LX('buildings')}</h2><div class="maplegend">${mapLegend()}</div>`));
  const holder = el('div', 'mapholder'); holder.innerHTML = svg; wrap.appendChild(holder);
  bm.appendChild(wrap);
  holder.querySelectorAll('[data-pid]').forEach((grp) => {
    grp.onclick = () => { const p = S.projects.find((x) => x.id === grp.getAttribute('data-pid')); if (p) { sfx('open'); openDrawer(p, prevProj[p.id], data); } };
  });
}

// -------------------------------------------------------------- inventory
// Storage lives inside MAP — knowledge bases / clones / archive are the
// project's inventory. Must run AFTER renderBaseMap (which clears the container).
function renderInventory(iv, S, LX, hq) {
  const inv = S.inventory || {};
  iv.appendChild(el('h2', 'sec', LX('warehouse')));
  const wrap = el('div', 'invwrap'); iv.appendChild(wrap);
  const card = (title) => { const c = el('div', 'invcard'); c.appendChild(el('h3', null, title)); wrap.appendChild(c); return c; };

  if (inv.vaults?.length) {
    const c = card(`Knowledge bases · ${inv.vaults.length}`);
    inv.vaults.forEach((v) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(v.name)}</span><span class="meta">${v.notes} notes</span><span class="pill">${esc(v.role)}</span>`)));
  }
  if (inv.clones?.length) {
    const c = card(`Reference clones · ${inv.clones.length}`);
    inv.clones.forEach((cl) => {
      const tag = cl.diverged ? `<span class="pill warn">${cl.dirty} diverged</span>` : `<span class="pill">clean</span>`;
      c.appendChild(el('div', 'invrow', `<span class="nm" title="${esc(cl.origin)}">${esc(cl.name.split('/').pop())}</span>${tag}`));
    });
  }
  if (inv.anomalies?.length) {
    const c = card(`Anomalies · ${inv.anomalies.length}`);
    inv.anomalies.forEach((an) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(an.detail)}</span><span class="pill ${an.severity === 'danger' ? 'dang' : an.severity === 'warning' ? 'warn' : ''}">${esc(an.severity)}</span>`)));
  }
  if (inv.duplicates?.length) {
    const c = card(`Duplicates · ${inv.duplicates.length}`);
    inv.duplicates.forEach((dp) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(dp.detail)}</span><span class="pill warn">${esc(dp.type)}</span>`)));
  }
  const misc = [];
  if (inv.empty?.length) misc.push(`<div class="invrow"><span class="nm">Empty folders</span><span class="meta">${inv.empty.map(esc).join(', ')}</span></div>`);
  if (inv.trivial?.length) inv.trivial.forEach((t) => misc.push(`<div class="invrow"><span class="nm">${esc(t.name)}</span><span class="meta">${esc(t.note)}</span></div>`));
  if (misc.length) { const c = card('Trivial / empty'); c.insertAdjacentHTML('beforeend', misc.join('')); }

  // Archive (Wave 5) — archived projects with one-click restore
  if (S.archived_projects?.length) {
    const c = card(`Archived projects · ${S.archived_projects.length}`);
    S.archived_projects.forEach((ap) => {
      const row = el('div', 'invrow');
      row.innerHTML = `<span class="nm">${esc(ap.name)}</span><span class="meta">archived ${esc(ap.archived_on || '')}</span>`;
      if (hq) {                                    // v2's isElectron gate — button absent in the dev harness
        const b = el('button', 'qbtn', '↺ Restore');
        b.onclick = () => { hq.reviveProject?.(ap.id); };
        row.appendChild(b);
      }
      c.appendChild(row);
    });
  }

  // Recent learnings (Wave 5)
  if (S.recent_learnings?.length) {
    const c = card(`What I learned · ${S.account?.totals?.learnings || 0} total · +${S.account?.totals?.knowledge_xp || 0} XP`);
    S.recent_learnings.forEach((l) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(l.text)}</span><span class="meta">${esc((l.ts || '').slice(0, 10))}</span>`)));
  }
  aosKids(wrap, 'fade-up', 60);
}

let unsub = null;
let rootEl = null;

export const view = {
  mount(root, ctx) {
    rootEl = root;
    root.classList.add('realm-lands');          // scope realm-local CSS (map + storage)
    const paint = () => {
      if (!ctx.data.selected) { root.innerHTML = ''; return; }   // empty/first-run bundle: render nothing rather than crash
      const { S, prevProj } = deriveScanContext(ctx.data);
      renderBaseMap(root, S, prevProj, ctx.data, ctx.LX);
      renderInventory(root, S, ctx.LX, ctx.hq);
      aosRefresh();
    };
    unsub = ctx.bus.on('data:select', paint);
    paint();
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    if (rootEl) { rootEl.classList.remove('realm-lands'); rootEl = null; }
  },
};
