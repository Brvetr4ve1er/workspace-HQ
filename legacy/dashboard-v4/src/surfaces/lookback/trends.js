// trends.js — LOOKBACK's TRENDS section: "what have the numbers been doing".
//
// Content ported from TWO v3 realms, merged into one grid:
//   realms/legacy/view.js  — personal records + the six trend-sidecar charts
//   realms/atlas/view.js   — XP-over-time, momentum forecast, runs-by-outcome,
//                            follow-through, scan streak
//
// TIME TRAVEL IS THE RULE. Every card clips its data to `cd` (the SELECTED
// scan's day), so scrubbing the time machine rewinds the records, the charts
// and the forecast together. Nothing here reads Date.now(): `now` is threaded
// in from the caller, which is what keeps intel/*.mjs pure and this section
// honest under the scrubber.
//
// Every source is feature-detected: an absent/empty series renders a calm
// empty-note card, never a throw and never a fabricated zero.
import { el, esc, fmt, DAY_MS } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, attachLineTip, attachBarTip } from './charts.js';

// CHART PALETTE — v4.3 beautify pass. ui/util.js's COL is v2's neon set
// (#3aff6e, #b14aff, #ff4757 …): ten cards drawn in it read as ten alarms, and
// its purple sat a third violet accent next to the hero's two. These are the
// same hues at the volume home.css uses for its status seams, and severity
// still owns the warm end — a failed run and a critical task are the only
// things drawn in red here, which is the point of the rule.
const C = {
  blue:   '#74a8dc',   // neutral series: XP, channeled runs, per-project lines
  green:  '#86b986',   // the "good" pole: health, low risk, resolved runs
  amber:  '#d98a3a',   // mild warning / activity
  yellow: '#c9b04e',   // housekeeping tier
  red:    '#cf6b70',   // something is actually wrong: fizzled, critical
  dim:    '#9b93c4',
  teal:   '#7fc4c4',
  mauve:  '#c08fb4',
};
// Categorical ramp for completion-by-project — one hue per product, no repeats
// until nine, and nothing in it shouts.
const SERIES_RAMP = [C.blue, C.green, C.amber, C.mauve, C.teal, C.dim, '#b0a86e', '#8f9ad6', '#c9857f'];

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const day = (iso) => String(iso || '').slice(0, 10);

// Keeps the grid even when a source is missing — same box, honest content.
function emptyCard(title, msg) {
  return chartCard(title, null, `<div class="empty">${esc(msg)}</div>`);
}

// ------------------------------------------------------------ personal records
// All derived from the SELECTED scan's trend arrays (filtered p.d <= cd), so the
// records time-travel with everything else. Deterministic — no Date.now().
const peak = (points) => { let b = null; for (const p of points) if (b === null || p.v > b.v) b = p; return b; };

const longestDailyRun = (points) => {
  if (!points.length) return null;
  const dayIdx = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY_MS);
  let best = 1, cur = 1, endI = 0;
  for (let i = 1; i < points.length; i++) {
    if (dayIdx(points[i].d) - dayIdx(points[i - 1].d) === 1) { cur++; if (cur > best) { best = cur; endI = i; } }
    else cur = 1;
  }
  return { len: best, end: points[endI].d };
};

function renderRecords(parent, S, cd) {
  const tr = S.trends || {};
  const f = (arr) => (Array.isArray(arr) ? arr : []).filter((p) => p && p.d <= cd && typeof p.v === 'number');
  const nameOf = {}; (S.projects || []).forEach((p) => { if (p && p.id) nameOf[p.id] = p.name; });
  const recs = [];

  const h = peak(f(tr.health_index));
  if (h) recs.push({ c: C.green, ic: '❤', k: 'Peak health', v: fmt(h.v), sub: h.d });
  const x = peak(f(tr.xp));
  if (x) recs.push({ c: C.blue, ic: '✦', k: 'Peak account XP', v: fmt(x.v), sub: x.d });

  // Longest streak: the canonical account field when present, else the longest
  // consecutive-scan-day run derived from the health series.
  const stk = S.account?.streak;
  let len = stk && Number.isFinite(stk.longest_scan_days) ? stk.longest_scan_days : null;
  let stkSub = 'consecutive scan-days';
  if (len == null) { const r = longestDailyRun(f(tr.health_index)); if (r) { len = r.len; stkSub = `through ${r.end}`; } }
  if (len != null) recs.push({ c: C.amber, ic: '🔥', k: 'Longest streak', v: fmt(len), sub: stkSub });

  const cpk = peak(f(tr.casts_per_day));
  if (cpk && cpk.v > 0) recs.push({ c: C.yellow, ic: '⚡', k: 'Most runs / day', v: fmt(cpk.v), sub: cpk.d });

  let bc = null; const cbp = tr.completion_by_project || {};
  for (const id of Object.keys(cbp)) for (const p of f(cbp[id])) if (bc === null || p.v > bc.v) bc = { v: p.v, id, d: p.d };
  if (bc) recs.push({ c: C.teal, ic: '◆', k: 'Best completion', v: bc.v + '%', sub: `${nameOf[bc.id] || bc.id} · ${bc.d}` });

  if (!recs.length) return 0;
  parent.appendChild(el('h2', 'lb-sec', 'Personal records'));
  // A QUIET KEY-VALUE LIST, not five tiles. Five outlined boxes across one row
  // was both the "max 3 tiles in a row" failure and the single densest thing on
  // the old screen; the constitution's own remedy for "more stats" is a list.
  // Same five records, same five numbers — read as rows instead of as chrome.
  const list = el('div', 'lb-records');
  recs.forEach((r) => {
    const item = el('div', 'lb-rec');
    item.style.setProperty('--pc', r.c);
    // r.ic is one of five hard-coded glyphs above (not scan data); everything
    // else is esc()'d.
    item.innerHTML = `
      <span class="lb-rec-ic">${r.ic}</span>
      <span class="lb-rec-k">${esc(r.k)}</span>
      <span class="lb-rec-v">${esc(r.v)}</span>
      <span class="lb-rec-sub">${esc(r.sub)}</span>`;
    list.appendChild(item);
  });
  parent.appendChild(list);
  return recs.length;
}

// ---- Account XP over time ----------------------------------------------------
// MERGED CARD (v3 drew this twice): atlas built the series from the raw scan
// list, legacy from the trends sidecar. They plot the same quantity, so this is
// ONE card that prefers the scan-derived series (it stands even on a snapshot
// whose trends block is thin) and falls back to trends.xp when the scan list
// carries no XP. The level / XP-to-next caption is atlas's, kept.
function xpCard(scans, cd, S) {
  let points = (scans || [])
    .filter((s) => s && s.scan && typeof s.account?.xp === 'number')
    .map((s) => ({ d: s.scan.id, v: s.account.xp }));
  let src = 'scan history';
  if (!points.length) {
    points = (S.trends?.xp || []).filter((p) => p && typeof p.v === 'number');
    src = 'trend sidecar';
  }
  if (!points.length) return { card: emptyCard('Account XP over time', 'No XP history recorded yet.'), series: null };
  const series = [{ color: C.blue, area: true, points, label: '' }];
  const card = chartCard('Account XP over time', fmt(num(S.account?.xp)), lineChart(series, cd));
  const lvl = num(S.account?.level), toNext = num(S.account?.xp_to_next);
  card.insertAdjacentHTML('beforeend',
    `<div class="lb-cap">Level ${esc(fmt(lvl))}${toNext ? ` · ${esc(fmt(toNext))} XP to next level` : ''} · from ${esc(src)}</div>`);
  return { card, series };
}

// ---- Momentum forecast ------------------------------------------------------
// PROMOTED, NOT REMOVED. The forecast used to be the third tile in this grid,
// where it was visually indistinguishable from "Automation runs / day". It is
// now the surface's single focal element and lives in hero.js, rendered above
// the section tabs by view.js — same two pure functions, same units, same
// sample-size honesty line. Nothing about it was dropped; it was made the
// answer to "what is the ONE thing this screen wants me to see?".

// ---- Scan streak -------------------------------------------------------------
// Off the selected scan's account.streak (present per-scan, so it time-travels).
function streakCard(S, scans, cd) {
  const st = S.account?.streak;
  if (!st || typeof st.scan_days !== 'number') return emptyCard('Scan streak', 'No streak data for this snapshot.');
  const cur = num(st.scan_days);
  const longest = Math.max(num(st.longest_scan_days), cur);
  const rate = pct(cur, longest);
  const taken = (scans || []).filter((s) => s && s.scan && s.scan.id <= cd).length;
  return chartCard('Scan streak', `${fmt(cur)}d`, `
    <div class="lb-streak">
      <div class="meter"><i style="width:${rate}%"></i></div>
      <div class="lb-tiles">
        <div class="lb-tile"><b class="figure">${esc(fmt(cur))}</b><span class="figure-label">current</span></div>
        <div class="lb-tile"><b class="figure">${esc(fmt(longest))}</b><span class="figure-label">longest</span></div>
        <div class="lb-tile"><b class="figure">${esc(fmt(taken))}</b><span class="figure-label">snapshots</span></div>
      </div>
    </div>`);
}

// ---- Automation runs by outcome ---------------------------------------------
// telemetry.casts → one bar per day, stacked by the outcome strings actually
// present in the data (never an assumed set). Unknown outcomes get a palette
// colour so a new outcome still renders.
const OC_COL = { resolved: C.green, fizzled: C.red, channeled: C.blue };
const OC_LABEL = { resolved: 'Resolved', fizzled: 'Fizzled', channeled: 'Channeled' };
const OC_FALLBACK = [C.amber, C.teal, C.yellow, C.mauve];

function castsCard(bundle, cd) {
  const casts = bundle?.telemetry?.casts || [];
  if (!casts.length) return { card: emptyCard('Automation runs by outcome', 'No automation runs recorded yet.'), rows: null };
  const byDay = {}, outcomes = [];
  casts.forEach((c) => {
    const d = day(c?.started_at);
    if (!d) return;
    const oc = String(c?.outcome || 'other');
    if (!outcomes.includes(oc)) outcomes.push(oc);
    if (!byDay[d]) byDay[d] = { d };
    byDay[d][oc] = num(byDay[d][oc]) + 1;
  });
  const rows = Object.values(byDay).sort((a, b) => (a.d < b.d ? -1 : 1));
  const inView = rows.filter((r) => r.d <= cd);
  if (!inView.length) return { card: emptyCard('Automation runs by outcome', 'No runs on or before this snapshot.'), rows: null };
  const colors = {}; let fi = 0;
  outcomes.forEach((k) => { colors[k] = OC_COL[k] || OC_FALLBACK[fi++ % OC_FALLBACK.length]; });
  const total = inView.reduce((s, r) => s + outcomes.reduce((t, k) => t + num(r[k]), 0), 0);
  const card = chartCard('Automation runs by outcome', fmt(total), stackedBar(rows, outcomes, colors, cd));
  card.insertAdjacentHTML('beforeend', legend(outcomes.map((k) => ({ c: colors[k], l: OC_LABEL[k] || k }))));
  return { card, rows, keys: outcomes, colors, labels: OC_LABEL };
}

// ---- Follow-through ----------------------------------------------------------
// actedOn.entries clipped to cd. resolved := resolved || marked_done (the ledger
// grew marked_done mid-life; older rows only carry resolved).
function followCard(bundle, cd) {
  const entries = bundle?.actedOn?.entries || [];
  const seen = entries.filter((e) => day(e?.at) <= cd);
  if (!seen.length) return emptyCard('Follow-through', 'No prompted actions taken yet.');
  const total = seen.length;
  const resolved = seen.filter((e) => e.resolved === true || e.marked_done === true).length;
  const rate = pct(resolved, total);
  return chartCard('Follow-through', rate + '%', `
    <div class="lb-ft">
      <div class="meter"><i style="width:${rate}%"></i></div>
      <div class="lb-ft-row"><span>${esc(fmt(resolved))} resolved</span><span>${esc(fmt(total))} acted on</span></div>
    </div>`);
}

// ---- the trend-sidecar charts (v3 legacy) -----------------------------------
function lineTrendCard(title, points, color, cd) {
  const series = [{ color, area: true, points, label: '' }];
  const seen = (points || []).filter((p) => p && p.d <= cd && typeof p.v === 'number');
  const now = seen.length ? seen[seen.length - 1].v : null;
  const card = chartCard(title, now == null ? null : fmt(now), lineChart(series, cd));
  attachLineTip(card, series, cd);
  return card;
}

// ------------------------------------------------------------------- section
// Returns a small fact object the view logs — the harness asserts on it.
export function renderTrends(parent, ctx, now) {
  const S = ctx.data.selected;
  const cd = S.scan?.id || '';
  const scans = ctx.data.scans || [];
  const bundle = ctx.data.bundle || {};
  const tr = S.trends || {};

  const records = renderRecords(parent, S, cd);

  const head = el('h2', 'lb-sec', 'Analytics');
  head.appendChild(el('span', 'lb-sec-note', `${fmt(scans.length)} snapshots`));
  parent.appendChild(head);

  const grid = el('div', 'lb-grid');
  parent.appendChild(grid);
  let cards = 0;
  const add = (card) => { grid.appendChild(card); cards++; return card; };

  // 1. XP over time (merged) + 2. streak. The momentum forecast that used to
  // sit between them is now the surface hero above the tabs (hero.js).
  const xp = xpCard(scans, cd, S);
  add(xp.card);
  if (xp.series) attachLineTip(xp.card, xp.series, cd);
  add(streakCard(S, scans, cd));

  // 4. health index — the headline trend from the sidecar.
  if (tr.health_index) add(lineTrendCard('Health index', tr.health_index, C.green, cd));
  else add(emptyCard('Health index', 'No health history in this snapshot.'));

  // 5. automation runs / day + 6. runs by outcome.
  if (tr.casts_per_day && tr.casts_per_day.length) add(lineTrendCard('Automation runs / day', tr.casts_per_day, C.yellow, cd));
  const runs = castsCard(bundle, cd);
  add(runs.card);
  if (runs.rows) attachBarTip(runs.card, runs.rows, runs.keys, runs.colors, cd, runs.labels);

  // 7. follow-through.
  add(followCard(bundle, cd));

  // 8. completion % by project — one line per product, legend by name.
  if (tr.completion_by_project && Object.keys(tr.completion_by_project).length) {
    const palette = SERIES_RAMP;
    const ids = Object.keys(tr.completion_by_project);
    const nameOf = {}; (S.projects || []).forEach((p) => { if (p && p.id) nameOf[p.id] = p.name; });
    const series = ids.map((id, i) => ({ color: palette[i % palette.length], points: tr.completion_by_project[id], label: nameOf[id] || id }));
    const card = add(chartCard('Completion % by project', null, lineChart(series, cd)));
    card.insertAdjacentHTML('beforeend', legend(ids.map((id, i) => ({ c: palette[i % palette.length], l: nameOf[id] || id }))));
    attachLineTip(card, series, cd);
  }

  // 9. open tasks by priority (stacked).
  if (tr.open_quests_by_tier) {
    const colors = { red: C.red, orange: C.amber, yellow: C.yellow };
    const labels = { red: 'critical', orange: 'important', yellow: 'housekeeping' };
    const card = add(chartCard('Open tasks by priority', null, stackedBar(tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd)));
    card.insertAdjacentHTML('beforeend', legend([{ c: C.red, l: 'critical' }, { c: C.amber, l: 'important' }, { c: C.yellow, l: 'housekeeping' }]));
    attachBarTip(card, tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd, labels);
  }

  // 10. git-safety risk (stacked).
  if (tr.git_risk) {
    const colors = { high: C.red, medium: C.amber, low: C.green };
    const card = add(chartCard('Git-safety risk', null, stackedBar(tr.git_risk, ['high', 'medium', 'low'], colors, cd)));
    card.insertAdjacentHTML('beforeend', legend([{ c: C.red, l: 'high' }, { c: C.amber, l: 'medium' }, { c: C.green, l: 'low' }]));
    attachBarTip(card, tr.git_risk, ['high', 'medium', 'low'], colors, cd);
  }

  return { records, cards };
}
