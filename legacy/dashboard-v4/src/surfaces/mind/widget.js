// MIND — the canvas widget renderer. Turns one JSON-canvas node into a card.
// Ported from legacy/dashboard-v3/src/realms/conjure/widget.js (the feature truth),
// re-toned for the v4 System-HUD palette; the spec vocabulary is unchanged so
// every node Claude has ever conjured renders identically here.
//
// v4.3 presentation pass: the canvas feed sits BENEATH the vault-health hero
// and must recede, so the accent palette below was muted and the checklist's
// drawn checkbox became a tick glyph. No spec field changed meaning, and no
// widget type was removed — see the TONE block and styles/mind.css.
//
// Claude "conjures" by appending a node to a canvas board (MCP hq_canvas_add).
// The node's TEXT carries a fenced spec the app fs-watches and renders live:
//
//     ```hq
//     { "type": "stat", "label": "Red quests", "value": 3, "delta": -2, "tone": "danger" }
//     ```
//
// The fence is optional — a node whose text is bare JSON with a known `type`
// also renders as a widget. Anything else falls back to a plain markdown note,
// so human-written Obsidian cards and canvasAdd notes still read fine.
//
// SAFETY: this is display-only. Every string flows through esc(); prose bodies
// flow through mdLite (which escapes first). No spec field ever reaches the DOM
// as raw HTML, and there is no interactivity/IPC — a conjured node can only draw.
//
// SPEC VOCABULARY (v1 — essentials + charts):
//   stat      {label, value, unit?, delta?, tone?}                 big number tile
//   progress  {label?, value:0-100, tone?}                         labelled bar
//   checklist {title?, items:[{text,done}|"[x] text"|"text"]}      ticked list
//   callout   {title?, body(md), tone?}                            tinted panel
//   table     {title?, columns?:[..], rows:[[..]|{..}]}            small table
//   chips     {title?, items:[{text,tone?}|"text"]}                tag row
//   spark     {label?, value?, points:[n..], tone?}                inline trend line
//   bars      {label?, data:[{label,value}|n..], tone?}            mini bar chart
//   note      {title?, body(md)}                                   titled markdown
// Common: every widget accepts `wide:true` to span the full feed width.
import { el, esc, mdLite } from '../../ui/util.js';

// tone -> accent colour, in the v4.3 muted register.
//
// Two changes from the v3 port, both made to hold this surface's accent budget
// (see the header of styles/mind.css):
//   1. `neutral` no longer rides --hud-violet. An untoned widget is the common
//      case, so violet-by-default meant a feed of twenty violet-accented cards
//      on a screen whose budget is TWO violet accents — both already spent on
//      the vault-health hero and the live dot. Untoned now means chrome grey.
//   2. good/info drop the neon (#3aff6e / #4d9fff) for the same muted seam
//      values home.css uses for its daily-3 cards. warn/danger keep the HUD
//      tokens: severity owns the loud end of the palette, and a spec that
//      declares itself dangerous has earned it.
// The vocabulary is unchanged — every tone a conjured node has ever used still
// resolves, and still means the same thing.
const TONE = {
  good: '#86b986', success: '#86b986',
  warn: 'var(--hud-amber)', warning: 'var(--hud-amber)',
  danger: 'var(--hud-red)', bad: 'var(--hud-red)',
  info: '#74a8dc', note: '#74a8dc',
  neutral: 'var(--hud-dim)',
};
const tone = (t) => TONE[String(t || '').toLowerCase()] || TONE.neutral;
// Did the spec declare a REAL judgement? Only then may the accent colour the
// stat numeral (mind.css `.w[data-toned] .w-stat-val`) — an untoned reading
// stays near-white, because a number is a fact, not an alarm.
const semantic = (t) => {
  const k = String(t || '').toLowerCase();
  return k !== 'neutral' && Object.prototype.hasOwnProperty.call(TONE, k);
};

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(+v) ? +v : d));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const arr = (v) => (Array.isArray(v) ? v : []);
const fmtNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : esc(v));
const WIDE = new Set(['table']);   // types that default to full width

// ---------------------------------------------------------------- spec parse
// Pull a spec out of node text: prefer a ```hq fenced block, else try the whole
// trimmed text as JSON. Returns a plain object with a string `type`, or null.
export function parseSpec(text) {
  const s = String(text ?? '');
  const fence = s.match(/```\s*hq\s*\n([\s\S]*?)```/i);
  const body = fence ? fence[1] : (s.trim().startsWith('{') ? s.trim() : null);
  if (!body) return null;
  try {
    const spec = JSON.parse(body);
    return (spec && typeof spec === 'object' && typeof spec.type === 'string') ? spec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- builders
function statW(s) {
  const v = fmtNum(s.value);
  const unit = s.unit ? `<span class="w-unit">${esc(s.unit)}</span>` : '';
  let delta = '';
  if (s.delta != null && s.delta !== '') {
    const d = num(s.delta, NaN);
    if (Number.isFinite(d) && d !== 0) {
      const up = d > 0;
      delta = `<div class="w-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fmtNum(Math.abs(d))}</div>`;
    } else {
      delta = `<div class="w-delta flat">${esc(s.delta)}</div>`;
    }
  }
  return `<div class="w-stat-val">${v}${unit}</div>
    <div class="w-stat-lbl">${esc(s.label || '')}</div>${delta}`;
}

function progressW(s) {
  const p = clamp(num(s.value), 0, 100);
  return `<div class="w-head"><span class="w-title">${esc(s.label || '')}</span><span class="w-pct">${Math.round(p)}%</span></div>
    <div class="w-bar"><i style="width:${p}%"></i></div>`;
}

function checklistW(s) {
  const items = arr(s.items).map((it) => {
    if (typeof it === 'string') {
      const m = it.match(/^\s*\[([ xX])\]\s*(.*)$/);
      return m ? { done: m[1].toLowerCase() === 'x', text: m[2] } : { done: false, text: it };
    }
    return { done: !!(it && it.done), text: it && it.text != null ? String(it.text) : '' };
  });
  const done = items.filter((i) => i.done).length;
  // A tick glyph, not a drawn checkbox: an outlined 14px square per row was a
  // dozen more borders per card, and the mark alone reads the state.
  const rows = items.map((i) =>
    `<li class="${i.done ? 'done' : ''}"><span class="box">${i.done ? '✓' : '·'}</span><span>${esc(i.text)}</span></li>`).join('');
  const title = s.title ? `<div class="w-title">${esc(s.title)}</div>` : '';
  const meta = items.length ? `<div class="w-meta">${done}/${items.length} done</div>` : '';
  return `${title}<ul class="w-list">${rows}</ul>${meta}`;
}

function calloutW(s) {
  const title = s.title ? `<div class="w-title">${esc(s.title)}</div>` : '';
  return `${title}<div class="w-body">${mdLite(String(s.body ?? ''))}</div>`;
}

function noteW(s) {
  const title = s.title ? `<div class="w-title">${esc(s.title)}</div>` : '';
  return `${title}<div class="w-body">${mdLite(String(s.body ?? s.text ?? ''))}</div>`;
}

function tableW(s) {
  const rows = arr(s.rows);
  let cols = arr(s.columns).map(String);
  // rows can be arrays or objects; derive columns from object keys if absent
  if (!cols.length && rows.length && rows[0] && !Array.isArray(rows[0]) && typeof rows[0] === 'object') {
    cols = Object.keys(rows[0]);
  }
  const cellsOf = (r) => (Array.isArray(r) ? r : (r && typeof r === 'object' ? cols.map((c) => r[c]) : [r]));
  const head = cols.length ? `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
  const body = rows.map((r) => `<tr>${cellsOf(r).map((c) => `<td>${fmtNum(c)}</td>`).join('')}</tr>`).join('');
  const title = s.title ? `<div class="w-title">${esc(s.title)}</div>` : '';
  return `${title}<div class="w-tbl-scroll"><table class="w-tbl">${head}<tbody>${body}</tbody></table></div>`;
}

function chipsW(s) {
  const chips = arr(s.items).map((it) => {
    const text = typeof it === 'string' ? it : (it && it.text != null ? String(it.text) : '');
    const t = typeof it === 'object' && it ? it.tone : null;
    // Only a semantic tone recolours the chip text — "neutral" resolves to the
    // chrome grey, which is a legal seam and an illegal text colour.
    const st = semantic(t) ? ` style="--wac:${tone(t)}"` : '';
    const cls = semantic(t) ? ' toned' : '';
    return `<span class="w-chip${cls}"${st}>${esc(text)}</span>`;
  }).join('');
  const title = s.title ? `<div class="w-title">${esc(s.title)}</div>` : '';
  return `${title}<div class="w-chip-row">${chips}</div>`;
}

// ---- charts (hand-rolled SVG, currentColor = --wac, so they recolour) -------
function sparkW(s) {
  const pts = arr(s.points).map((p) => num(p, 0));
  const head = (s.label || s.value != null)
    ? `<div class="w-head"><span class="w-title">${esc(s.label || '')}</span><span class="w-spark-val">${s.value != null ? fmtNum(s.value) : ''}</span></div>` : '';
  if (pts.length < 2) return `${head}<div class="w-empty">not enough points</div>`;
  const W = 240, H = 44, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const step = W / (pts.length - 1);
  const xy = pts.map((v, i) => [i * step, H - 4 - ((v - lo) / span) * (H - 8)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M${xy[0][0]},${H} ${xy.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${W},${H} Z`;
  const [lx, ly] = xy[xy.length - 1];
  return `${head}<svg class="w-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="w-spark-area" d="${area}"/><path class="w-spark-line" d="${line}"/>
    <circle class="w-spark-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/></svg>`;
}

function barsW(s) {
  const raw = arr(s.data);
  const items = raw.map((d) => (typeof d === 'object' && d
    ? { label: d.label != null ? String(d.label) : '', value: num(d.value, 0) }
    : { label: '', value: num(d, 0) }));
  const title = s.label ? `<div class="w-title">${esc(s.label)}</div>` : '';
  if (!items.length) return `${title}<div class="w-empty">no data</div>`;
  const hi = Math.max(...items.map((i) => i.value), 0) || 1;
  const cols = items.map((i) => {
    const h = clamp(Math.round((i.value / hi) * 100), 2, 100);
    return `<div class="w-bcol" title="${esc(i.label)}: ${fmtNum(i.value)}">
      <span class="w-bval">${fmtNum(i.value)}</span>
      <i style="height:${h}%"></i>
      <span class="w-blbl">${esc(i.label)}</span></div>`;
  }).join('');
  return `${title}<div class="w-brow">${cols}</div>`;
}

const BUILDERS = {
  stat: statW, progress: progressW, checklist: checklistW, callout: calloutW,
  table: tableW, chips: chipsW, spark: sparkW, bars: barsW, note: noteW,
};

// ---------------------------------------------------------------- public
// Render one canvas node -> a widget element (or a fallback note / file-link
// chip). Never throws: a bad spec degrades to a note showing its own text.
export function widgetEl(node) {
  // canvas file/link nodes: show a chip, not a widget
  if (node && node.type === 'file') {
    const base = String(node.file || '').split(/[\\/]/).pop() || 'file';
    return el('div', 'w w-chip-node', `<span class="w-chip">📄 ${esc(base)}</span>`);
  }
  if (node && node.type === 'link') {
    const short = String(node.url || '').replace(/^https?:\/\//, '') || 'link';
    return el('div', 'w w-chip-node', `<span class="w-chip">🔗 ${esc(short)}</span>`);
  }

  const spec = parseSpec(node && node.text);
  const type = spec && BUILDERS[spec.type] ? spec.type : null;
  const build = type ? BUILDERS[type] : null;

  let cls = `w w-${type || 'note'}`;
  let html;
  if (build) {
    if ((spec.wide === true || WIDE.has(type))) cls += ' w-wide';
    try { html = build(spec); }
    catch { html = noteW({ body: '```json\n' + JSON.stringify(spec, null, 2) + '\n```' }); cls = 'w w-note'; }
    const card = el('div', cls, html);
    card.style.setProperty('--wac', tone(spec.tone));
    if (semantic(spec.tone)) card.dataset.toned = '';
    return card;
  }
  // fallback: plain markdown note from the raw node text
  return el('div', 'w w-note', noteW({ body: String((node && node.text) || '') }));
}
