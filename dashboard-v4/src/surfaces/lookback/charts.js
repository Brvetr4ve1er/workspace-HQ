// charts.js — the LOOKBACK surface's chart primitives, ported from v3
// ui/components.js (lineChart / stackedBar / legend / chartCard) plus the
// hover-tooltip rig from v3 realms/legacy/view.js.
//
// Why they live HERE and not in a shared v4 ui/ module: LOOKBACK is the only
// surface that draws time series. A shared home would be a second component
// language competing with styles/components.css for no consumer.
//
// Three invariants carried over from v3, each guarding a real bug:
//
// 1. BAR-WIDTH FLOOR. `bw = Math.max(1, Math.min(30, slot - 7))`. Past ~39 rows
//    the slot drops under 7px and `slot - 7` goes negative — a negative <rect>
//    width is an SVG error on EVERY bar in the chart. The floor is not cosmetic.
// 2. EMPTY IS AN EMPTY SVG, NEVER A THROW. No points / no rows returns a valid
//    empty <svg> so the card keeps its box in the grid.
// 3. GEOMETRY IS EXPORTED, NOT RESTATED. v3 re-declared CW/CH/CPAD inside the
//    tooltip code under a "MUST mirror components.js" comment — two copies that
//    could skew. Here the tip code imports the same constants the SVG is drawn
//    with, so they cannot.
//
// XSS: every scan-derived string interpolated below goes through esc(); every
// number goes through a finite-number gate (`pts()` / `n()`), so a drifted scan
// carrying a string where a value belongs cannot poison a path or an axis label.
// Colors are our own palette constants (ui/util.js COL), never scan data.
import { el, esc, fmt } from '../../ui/util.js';

// Chart geometry — the SVG viewBox the builders draw into AND the frame the
// tooltip snaps to. Change here, both move together.
export const CW = 320, CH = 130, CPAD = 26;

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// A drawable point list: on/before curDate, with a finite value. Anything else
// would put NaN into a path `d` (an invisible chart) or into the axis label.
const pts = (points, curDate) =>
  (Array.isArray(points) ? points : []).filter((p) => p && p.d <= curDate && typeof p.v === 'number' && Number.isFinite(p.v));

const EMPTY_SVG = `<svg viewBox="0 0 ${CW} ${CH}"></svg>`;

// series: [{ color, label?, area?, points: [{d:'YYYY-MM-DD', v:number}] }]
export function lineChart(series, curDate) {
  const sliced = (series || []).map((s) => ({ ...s, points: pts(s.points, curDate) }));
  const all = sliced.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return EMPTY_SVG;
  const max = Math.max(1, ...all), min = Math.min(...all, 0);
  const count = Math.max(...sliced.map((s) => s.points.length), 2);
  const sx = (i) => CPAD + (i * (CW - CPAD * 2)) / (count - 1);
  const sy = (v) => CH - CPAD - ((v - min) / (max - min || 1)) * (CH - CPAD * 2);
  let svg = `<svg viewBox="0 0 ${CW} ${CH}">`;
  [0.25, 0.5, 0.75].forEach((f) => {
    const y = CPAD + f * (CH - CPAD * 2);
    svg += `<line x1="${CPAD}" y1="${y}" x2="${CW - CPAD}" y2="${y}" stroke="#241f3d"/>`;
  });
  svg += `<line x1="${CPAD}" y1="${CH - CPAD}" x2="${CW - CPAD}" y2="${CH - CPAD}" stroke="#3a2f6b"/>`;
  svg += `<text x="${CPAD}" y="13" fill="#9b93c4" font-size="9" font-family="monospace">${esc(fmt(max))}</text>`;
  sliced.forEach((s) => {
    if (!s.points.length) return;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
    if (s.points.length === 1) svg += `<circle cx="${sx(0)}" cy="${sy(s.points[0].v)}" r="3" fill="${s.color}"/>`;
    else {
      if (s.area) svg += `<path d="${d} L${sx(s.points.length - 1).toFixed(1)},${CH - CPAD} L${sx(0).toFixed(1)},${CH - CPAD} Z" fill="${s.color}" opacity="0.08"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    const last = s.points.length - 1;
    svg += `<circle cx="${sx(last).toFixed(1)}" cy="${sy(s.points[last].v).toFixed(1)}" r="3" fill="${s.color}"/>`;
  });
  return svg + '</svg>';
}

// rows0: [{ d:'YYYY-MM-DD', <key>: number, … }] — one stacked bar per row.
export function stackedBar(rows0, keys, colors, curDate) {
  const rows = (Array.isArray(rows0) ? rows0 : []).filter((r) => r && r.d <= curDate);
  if (!rows.length) return EMPTY_SVG;
  const slot = (CW - CPAD * 2) / rows.length;
  const bw = Math.max(1, Math.min(30, slot - 7));      // invariant 1 — see header
  const totals = rows.map((r) => keys.reduce((s, k) => s + n(r[k]), 0));
  const max = Math.max(1, ...totals);
  const sx = (i) => CPAD + i * slot + (slot - bw) / 2;
  let svg = `<svg viewBox="0 0 ${CW} ${CH}">`;
  svg += `<line x1="${CPAD}" y1="${CH - CPAD}" x2="${CW - CPAD}" y2="${CH - CPAD}" stroke="#3a2f6b"/>`;
  rows.forEach((r, i) => {
    let y = CH - CPAD;
    keys.forEach((k) => {
      const h = (n(r[k]) / max) * (CH - CPAD * 2);
      y -= h;
      if (h > 0) svg += `<rect x="${sx(i).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[k]}"/>`;
    });
    // one date tick per bar; at 58 rows they overlap into a texture, which is
    // exactly what v3 shipped — the tooltip is how you read a single day.
    svg += `<text x="${(sx(i) + bw / 2).toFixed(1)}" y="${CH - CPAD + 12}" fill="#9b93c4" font-size="8" font-family="monospace" text-anchor="middle">${esc(String(r.d || '').slice(5))}</text>`;
  });
  return svg + '</svg>';
}

// items: [{ c: color, l: label }] — label is scan-derived (project names), esc'd.
export function legend(items) {
  return '<div class="lb-legend">' + items.map((i) => `<span><i style="background:${i.c}"></i>${esc(i.l)}</span>`).join('') + '</div>';
}

// The tile every chart sits in.
//
// v4.3 BEAUTIFY: this used to be a `.panel` + `.panel-head` + `.figure` from
// styles/components.css. Those three components carry, respectively, a full 1px
// outline, a 1px head rule, and violet-with-glow display type — so ten charts
// meant ten outlined boxes, ten hairlines and ten glowing violet numerals, which
// is precisely the "too crowded / messy" the design constitution's border diet
// and violet budget exist to prevent. (home.css, the approved exemplar, refuses
// to compose `.panel` for exactly this reason and says so in its header.)
//
// The card now wears its own quiet language: a background step over the page
// ground, no outline, a mixed-case title and a neutral mono readout. No feature
// changed — same title, same optional headline number, same body.
//
// CONTRACT: `title` and `now` are RAW values (this function escapes them).
// `inner` is builder-generated markup — an SVG from above or a small block
// assembled in a section module, where every interpolation is already esc()'d.
export function chartCard(title, now, inner) {
  const c = el('section', 'lb-card');
  c.appendChild(el('div', 'lb-card-head',
    `<span class="lb-card-title">${esc(title)}</span><span class="lb-card-gap"></span>` +
    (now != null ? `<span class="lb-now">${esc(String(now))}</span>` : '')));
  const body = el('div', 'lb-card-body');
  body.innerHTML = inner;
  c.appendChild(body);
  return c;
}

// ------------------------------------------------------------------ tooltips
// The guide/dot/tip trio is appended INSIDE the card element and its two
// listeners are attached to the card's own <svg>. Both die with the node when
// the section re-renders or the surface unmounts — no disposer needed, which is
// why this is the only "event listener" in a surface whose teardown is one bus
// unsubscribe.
function chartTip(cardEl) {
  const guide = el('div', 'lb-tip-guide'), dot = el('div', 'lb-tip-dot'), tip = el('div', 'lb-tip');
  cardEl.append(guide, dot, tip);
  const hide = () => { cardEl.classList.remove('tip-on'); dot.style.display = 'none'; };
  return { guide, dot, tip, hide };
}

const clampTip = (tip, gx, cardW) => {
  const half = tip.offsetWidth / 2;
  tip.style.left = Math.max(half + 4, Math.min(cardW - half - 4, gx)) + 'px';
};

export function attachLineTip(cardEl, series, cd) {
  const svg = cardEl.querySelector('svg'); if (!svg) return;
  const sl = (series || []).map((s) => ({ color: s.color, label: s.label, pts: pts(s.points, cd) }));
  const all = sl.flatMap((s) => s.pts.map((p) => p.v)); if (!all.length) return;
  const count = Math.max(...sl.map((s) => s.pts.length), 2);
  const max = Math.max(1, ...all), min = Math.min(...all, 0), range = (max - min) || 1;
  const sx = (i) => CPAD + (i * (CW - CPAD * 2)) / (count - 1);
  const sy = (v) => CH - CPAD - ((v - min) / range) * (CH - CPAD * 2);
  const ref = sl.reduce((a, b) => (b.pts.length > a.pts.length ? b : a), sl[0]);
  const t = chartTip(cardEl); let lastI = -1;
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), cr = cardEl.getBoundingClientRect(); if (!r.width) return;
    let i = Math.round(((e.clientX - r.left) / r.width * CW - CPAD) / ((CW - CPAD * 2) / (count - 1)));
    i = Math.max(0, Math.min(count - 1, i));
    const rows = sl.filter((s) => s.pts[i]).map((s) => ({ c: s.color, l: s.label, v: s.pts[i].v, d: s.pts[i].d }));
    if (!rows.length) { lastI = -1; t.hide(); return; }
    cardEl.classList.add('tip-on');
    const gx = r.left - cr.left + (sx(i) / CW) * r.width;
    t.guide.style.cssText = `left:${gx}px;top:${r.top - cr.top}px;height:${r.height}px`;
    const rp = ref.pts[i];
    if (rp) {
      t.dot.style.display = 'block';
      t.dot.style.left = gx + 'px';
      t.dot.style.top = (r.top - cr.top + (sy(rp.v) / CH) * r.height) + 'px';
      t.dot.style.background = ref.color;
      t.dot.style.boxShadow = '0 0 8px ' + ref.color;
    } else t.dot.style.display = 'none';
    if (i !== lastI) {
      lastI = i;
      const body = rows.map((row) => `<span class="lb-tp-row"><i style="background:${row.c}"></i>${row.l ? esc(row.l) + ' ' : ''}<b>${esc(fmt(row.v))}</b></span>`).join('');
      t.tip.innerHTML = `<span class="lb-tp-d">${esc(rows[0].d)}</span>${body}`;
    }
    clampTip(t.tip, gx, cr.width);
    t.tip.style.top = (r.top - cr.top + 4) + 'px';
  };
  svg.onmouseleave = () => { lastI = -1; t.hide(); };
}

export function attachBarTip(cardEl, rows0, keys, colors, cd, labels = {}) {
  const svg = cardEl.querySelector('svg'); if (!svg) return;
  const rows = (Array.isArray(rows0) ? rows0 : []).filter((r) => r && r.d <= cd); if (!rows.length) return;
  const slot = (CW - CPAD * 2) / rows.length;
  const t = chartTip(cardEl); let lastI = -1;
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), cr = cardEl.getBoundingClientRect(); if (!r.width) return;
    let i = Math.floor(((e.clientX - r.left) / r.width * CW - CPAD) / slot);
    i = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[i];
    cardEl.classList.add('tip-on');
    t.dot.style.display = 'none';
    const gx = r.left - cr.left + ((CPAD + i * slot + slot / 2) / CW) * r.width;
    t.guide.style.cssText = `left:${gx}px;top:${r.top - cr.top}px;height:${r.height}px`;
    if (i !== lastI) {
      lastI = i;
      const total = keys.reduce((s, k) => s + n(row[k]), 0);
      const body = keys.map((k) => `<span class="lb-tp-row"><i style="background:${colors[k]}"></i>${esc(labels[k] || k)} <b>${esc(fmt(n(row[k])))}</b></span>`).join('');
      t.tip.innerHTML = `<span class="lb-tp-d">${esc(row.d)} · ${esc(fmt(total))} total</span>${body}`;
    }
    clampTip(t.tip, gx, cr.width);
    t.tip.style.top = (r.top - cr.top + 4) + 'px';
  };
  svg.onmouseleave = () => { lastI = -1; t.hide(); };
}
