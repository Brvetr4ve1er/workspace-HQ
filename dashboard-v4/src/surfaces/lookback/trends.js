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
import { el, esc, fmt, COL, DAY_MS } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, attachLineTip, attachBarTip } from './charts.js';
import { momentum } from '../../intel/derive.mjs';
import { forecastLine } from '../../intel/foresight.mjs';

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
  if (h) recs.push({ c: COL.green, ic: '❤', k: 'Peak health', v: fmt(h.v), sub: h.d });
  const x = peak(f(tr.xp));
  if (x) recs.push({ c: COL.purple, ic: '✦', k: 'Peak account XP', v: fmt(x.v), sub: x.d });

  // Longest streak: the canonical account field when present, else the longest
  // consecutive-scan-day run derived from the health series.
  const stk = S.account?.streak;
  let len = stk && Number.isFinite(stk.longest_scan_days) ? stk.longest_scan_days : null;
  let stkSub = 'consecutive scan-days';
  if (len == null) { const r = longestDailyRun(f(tr.health_index)); if (r) { len = r.len; stkSub = `through ${r.end}`; } }
  if (len != null) recs.push({ c: COL.gold, ic: '🔥', k: 'Longest streak', v: fmt(len), sub: stkSub });

  const cpk = peak(f(tr.casts_per_day));
  if (cpk && cpk.v > 0) recs.push({ c: COL.orange, ic: '⚡', k: 'Most runs / day', v: fmt(cpk.v), sub: cpk.d });

  let bc = null; const cbp = tr.completion_by_project || {};
  for (const id of Object.keys(cbp)) for (const p of f(cbp[id])) if (bc === null || p.v > bc.v) bc = { v: p.v, id, d: p.d };
  if (bc) recs.push({ c: COL.blue, ic: '◆', k: 'Best completion', v: bc.v + '%', sub: `${nameOf[bc.id] || bc.id} · ${bc.d}` });

  if (!recs.length) return 0;
  parent.appendChild(el('h2', 'lb-sec', 'Personal records'));
  const grid = el('div', 'lb-records');
  recs.forEach((r) => {
    const item = el('div', 'lb-rec');
    item.style.setProperty('--pc', r.c);
    // r.ic is one of five hard-coded glyphs above (not scan data); everything
    // else is esc()'d.
    item.innerHTML = `
      <span class="lb-rec-ic">${r.ic}</span>
      <span class="figure lb-rec-v">${esc(r.v)}</span>
      <span class="lb-rec-k">${esc(r.k)}</span>
      <span class="meta lb-rec-sub">${esc(r.sub)}</span>`;
    grid.appendChild(item);
  });
  parent.appendChild(grid);
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
  const series = [{ color: COL.purple, area: true, points, label: '' }];
  const card = chartCard('Account XP over time', fmt(num(S.account?.xp)), lineChart(series, cd));
  const lvl = num(S.account?.level), toNext = num(S.account?.xp_to_next);
  card.insertAdjacentHTML('beforeend',
    `<div class="lb-cap">Level ${esc(fmt(lvl))}${toNext ? ` · ${esc(fmt(toNext))} XP to next level` : ''} · from ${esc(src)}</div>`);
  return { card, series };
}

// ---- Momentum forecast -------------------------------------------------------
// derive.momentum() fits a least-squares slope over S.trends.xp; foresight.
// forecastLine() turns it into a trend word + an ETA. `now` comes from the
// caller so this card time-travels like its neighbours.
//
// UNITS (do not relabel): the fit is per trend SAMPLE — one sample per scan, and
// scans are NOT daily — so the slope is XP/scan and the ETA is counted in SCANS.
// Anything that wants calendar days must first divide by an observed scans-per-
// day rate, which nothing computes today, so nothing here may claim days.
const TREND_LABEL = { rising: 'Rising', falling: 'Falling', flat: 'Flat' };

function forecastCard(S, now) {
  const m = momentum(S.trends, S.account, now);
  const f = forecastLine(m);
  const target = num(S.account?.level) + 1;
  const sign = f.slopePerScan > 0 ? '+' : '';
  const slopeTxt = `${sign}${f.slopePerScan} XP/scan`;
  // Honesty line: the slope/ETA is a least-squares fit over the WHOLE series,
  // which reads more confident than a short run of scans supports. State the
  // sample size it is actually fit over.
  const sampleN = (S.trends?.xp || []).length;
  const basisLine = `<div class="meta lb-fc-basis">based on ${esc(String(sampleN))} scan${sampleN === 1 ? '' : 's'}</div>`;
  // Three states, three sentences. 'falling' must NOT inherit the flat copy
  // ("not enough forward motion") — that reads as "nearly there" under a badge
  // saying Falling. A negative slope has no crossing with the next level, so
  // there is no ETA to project and the card says exactly that.
  let body;
  if (f.trend === 'falling') body = `<div class="lb-fc-note">XP is trending down — no level ETA.</div>`;
  else if (f.trend === 'flat' || f.etaLabel === '—') body = `<div class="lb-fc-note">Not enough forward motion to project a date.</div>`;
  else body = `<div class="lb-fc-eta">${esc(f.etaLabel)} to L${esc(fmt(target))}</div>`;
  return chartCard('Momentum forecast', TREND_LABEL[f.trend] || f.trend, `
    <div class="lb-forecast">
      <div class="lb-fc-slope">${esc(slopeTxt)}</div>
      ${body}
      ${basisLine}
    </div>`);
}

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
const OC_COL = { resolved: COL.green, fizzled: COL.red, channeled: COL.blue };
const OC_LABEL = { resolved: 'Resolved', fizzled: 'Fizzled', channeled: 'Channeled' };
const OC_FALLBACK = [COL.orange, COL.cyan, COL.gold, COL.pink];

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
  head.appendChild(el('span', 'meta lb-sec-note', `${fmt(scans.length)} snapshots`));
  parent.appendChild(head);

  const grid = el('div', 'lb-grid');
  parent.appendChild(grid);
  let cards = 0;
  const add = (card) => { grid.appendChild(card); cards++; return card; };

  // 1. XP over time (merged) + 2. momentum + 3. streak — the identity row.
  const xp = xpCard(scans, cd, S);
  add(xp.card);
  if (xp.series) attachLineTip(xp.card, xp.series, cd);
  add(forecastCard(S, now));
  add(streakCard(S, scans, cd));

  // 4. health index — the headline trend from the sidecar.
  if (tr.health_index) add(lineTrendCard('Health index', tr.health_index, COL.green, cd));
  else add(emptyCard('Health index', 'No health history in this snapshot.'));

  // 5. automation runs / day + 6. runs by outcome.
  if (tr.casts_per_day && tr.casts_per_day.length) add(lineTrendCard('Automation runs / day', tr.casts_per_day, COL.gold, cd));
  const runs = castsCard(bundle, cd);
  add(runs.card);
  if (runs.rows) attachBarTip(runs.card, runs.rows, runs.keys, runs.colors, cd, runs.labels);

  // 7. follow-through.
  add(followCard(bundle, cd));

  // 8. completion % by project — one line per product, legend by name.
  if (tr.completion_by_project && Object.keys(tr.completion_by_project).length) {
    const palette = [COL.blue, COL.purple, COL.green, COL.orange, COL.red, COL.cyan, COL.pink, '#a5d6ff', '#ffa657'];
    const ids = Object.keys(tr.completion_by_project);
    const nameOf = {}; (S.projects || []).forEach((p) => { if (p && p.id) nameOf[p.id] = p.name; });
    const series = ids.map((id, i) => ({ color: palette[i % palette.length], points: tr.completion_by_project[id], label: nameOf[id] || id }));
    const card = add(chartCard('Completion % by project', null, lineChart(series, cd)));
    card.insertAdjacentHTML('beforeend', legend(ids.map((id, i) => ({ c: palette[i % palette.length], l: nameOf[id] || id }))));
    attachLineTip(card, series, cd);
  }

  // 9. open tasks by priority (stacked).
  if (tr.open_quests_by_tier) {
    const colors = { red: COL.red, orange: COL.orange, yellow: COL.yellow };
    const labels = { red: 'critical', orange: 'important', yellow: 'housekeeping' };
    const card = add(chartCard('Open tasks by priority', null, stackedBar(tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd)));
    card.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'critical' }, { c: COL.orange, l: 'important' }, { c: COL.yellow, l: 'housekeeping' }]));
    attachBarTip(card, tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd, labels);
  }

  // 10. git-safety risk (stacked).
  if (tr.git_risk) {
    const colors = { high: COL.red, medium: COL.orange, low: COL.green };
    const card = add(chartCard('Git-safety risk', null, stackedBar(tr.git_risk, ['high', 'medium', 'low'], colors, cd)));
    card.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'high' }, { c: COL.orange, l: 'medium' }, { c: COL.green, l: 'low' }]));
    attachBarTip(card, tr.git_risk, ['high', 'medium', 'low'], colors, cd);
  }

  return { records, cards };
}
