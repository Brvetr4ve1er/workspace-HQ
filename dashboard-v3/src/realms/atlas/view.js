// ATLAS realm — the data/analytics room the app lacked. Five cards, all built
// from the shared chart helpers (never hand-rolled SVG) and all reacting to
// 'data:select' (curDate = the selected scan's day, so the time-machine scrubber
// time-travels every card):
//   1. Account XP over time        — lineChart built straight from ctx.data.scans
//      (each scan's account.xp), not the trend sidecar, so it stands even on a
//      scan whose trends block is thin.
//   2. Momentum forecast           — intel/derive.momentum + intel/foresight.
//      forecastLine over S.trends.xp: a least-squares slope turned into a trend
//      word and an ETA to the next level. Calm "not enough motion" note instead
//      of a fake date when the slope doesn't clear the noise floor.
//   3. Automation runs by outcome  — stackedBar of telemetry.casts bucketed per
//      day, split resolved / fizzled / … (outcomes are read from the data, not
//      assumed), with a legend.
//   4. Follow-through              — actedOn.entries: how many prompted actions
//      were resolved vs merely acted on (a rate, so a plain bar, not an SVG).
//   5. Scan streak                 — S.account.streak: current vs longest run of
//      scan-days, plus a snapshot count.
// Every source is feature-detected: absent/empty renders a calm empty-note card,
// never a throw. Numbers interpolated into innerHTML pass through num()+fmt();
// every string goes through esc().
import { el, esc, fmt, COL } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, aosKids, aosRefresh } from '../../ui/components.js';
import { momentum } from '../../intel/derive.mjs';
import { forecastLine } from '../../intel/foresight.mjs';

let root = null, ctx = null, offSelect = null;

// numeric gate for innerHTML: fmt() passes non-numbers through as raw strings,
// so anything from scan data funnels through num() first.
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const day = (iso) => String(iso || '').slice(0, 10);

// Empty state that keeps the grid even — a chart card with an empty-note body.
function emptyCard(title, msg) {
  return chartCard(title, null, `<div class="empty-note">${esc(msg)}</div>`);
}

// ---- 1. Account XP over time ------------------------------------------------
// Series is derived from the raw scan list ({d: scan.id, v: account.xp}); the
// helper clips to curDate, so scrubbing back shrinks the climb.
function xpCard(scans, cd, S) {
  const points = scans
    .filter((s) => s.scan && typeof s.account?.xp === 'number')
    .map((s) => ({ d: s.scan.id, v: s.account.xp }));
  if (!points.length) return emptyCard('Account XP over time', 'No XP history recorded yet.');
  const series = [{ color: COL.purple, area: true, points, label: '' }];
  const card = chartCard('Account XP over time', fmt(num(S.account?.xp)), lineChart(series, cd));
  const lvl = num(S.account?.level), toNext = num(S.account?.xp_to_next);
  card.insertAdjacentHTML('beforeend',
    `<div class="atl-cap">Level ${fmt(lvl)}${toNext ? ` · ${fmt(toNext)} XP to next level` : ''}</div>`);
  return card;
}

// ---- 2. Momentum forecast ----------------------------------------------------
// derive.momentum() fits a least-squares slope over S.trends.xp, then
// foresight.forecastLine() turns that into a display-ready trend word + ETA.
// `now` is threaded in from render()'s call site (never computed in here or in
// the pure intel modules), so this card time-travels correctly under the
// time-machine scrubber same as its neighbours.
const TREND_LABEL = { rising: 'Rising', falling: 'Falling', flat: 'Flat' };

function forecastCard(S, now) {
  const m = momentum(S.trends, S.account, now);
  const f = forecastLine(m);
  const flat = f.trend === 'flat' || f.etaLabel === '—';
  const sign = f.slopePerDay > 0 ? '+' : '';
  const slopeTxt = `${sign}${f.slopePerDay} XP/scan`;
  const target = num(S.account?.level) + 1;
  const inner = `
    <div class="atl-forecast">
      <div class="atl-fc-slope">${esc(slopeTxt)}</div>
      ${flat
        ? `<div class="atl-fc-note">Not enough forward motion to project a date.</div>`
        : `<div class="atl-fc-eta">${esc(f.etaLabel)} to L${fmt(target)}</div>`}
    </div>`;
  return chartCard('Momentum forecast', esc(TREND_LABEL[f.trend] || f.trend), inner);
}

// ---- 3. Automation runs by outcome -----------------------------------------
// telemetry.casts → one bar per day, stacked by the outcome strings actually
// present (resolved / fizzled / channeled / …). Colors are assigned from a known
// map with a palette fallback so an unseen outcome still renders.
const OC_COL = { resolved: COL.green, fizzled: COL.red, channeled: COL.blue };
const OC_LABEL = { resolved: 'Resolved', fizzled: 'Fizzled', channeled: 'Channeled' };
const OC_FALLBACK = [COL.orange, COL.cyan, COL.gold, COL.pink];

function castsCard(bundle, cd) {
  const casts = bundle.telemetry?.casts || [];
  if (!casts.length) return emptyCard('Automation runs by outcome', 'No automation runs recorded yet.');
  const byDay = {}, outcomes = [];
  casts.forEach((c) => {
    const d = day(c.started_at);
    if (!d) return;
    const oc = String(c.outcome || 'other');
    if (!outcomes.includes(oc)) outcomes.push(oc);
    if (!byDay[d]) byDay[d] = { d };
    byDay[d][oc] = num(byDay[d][oc]) + 1;
  });
  const rows = Object.values(byDay).sort((a, b) => (a.d < b.d ? -1 : 1));
  const inView = rows.filter((r) => r.d <= cd);
  if (!inView.length) return emptyCard('Automation runs by outcome', 'No runs on or before this snapshot.');
  const colors = {}; let fi = 0;
  outcomes.forEach((k) => { colors[k] = OC_COL[k] || OC_FALLBACK[fi++ % OC_FALLBACK.length]; });
  const total = inView.reduce((s, r) => s + outcomes.reduce((t, k) => t + num(r[k]), 0), 0);
  const card = chartCard('Automation runs by outcome', fmt(total), stackedBar(rows, outcomes, colors, cd));
  card.insertAdjacentHTML('beforeend', legend(outcomes.map((k) => ({ c: colors[k], l: OC_LABEL[k] || k }))));
  return card;
}

// ---- 4. Follow-through ------------------------------------------------------
// actedOn.entries clipped to curDate. resolved := resolved || marked_done (the
// ledger grew a marked_done field mid-life; older rows only carry resolved).
function followCard(bundle, cd) {
  const entries = bundle.actedOn?.entries || [];
  const seen = entries.filter((e) => day(e.at) <= cd);
  if (!seen.length) return emptyCard('Follow-through', 'No prompted actions taken yet.');
  const total = seen.length;
  const resolved = seen.filter((e) => e.resolved === true || e.marked_done === true).length;
  const rate = pct(resolved, total);
  const inner = `
    <div class="atl-ft">
      <div class="atl-bar"><i style="width:${rate}%"></i></div>
      <div class="atl-ft-row"><span>${fmt(resolved)} resolved</span><span>${fmt(total)} acted on</span></div>
    </div>`;
  return chartCard('Follow-through', rate + '%', inner);
}

// ---- 5. Scan streak ---------------------------------------------------------
// Off the selected scan's account.streak (present per-scan, so it time-travels).
// The bar reads current against longest; the tiles add a snapshot count clipped
// to curDate.
function streakCard(S, scans, cd) {
  const st = S.account?.streak;
  if (!st || typeof st.scan_days !== 'number') return emptyCard('Scan streak', 'No streak data for this snapshot.');
  const cur = num(st.scan_days);
  const longest = Math.max(num(st.longest_scan_days), cur);
  const rate = pct(cur, longest);
  const taken = scans.filter((s) => s.scan && s.scan.id <= cd).length;
  const inner = `
    <div class="atl-streak">
      <div class="atl-bar"><i style="width:${rate}%"></i></div>
      <div class="atl-tiles">
        <div class="atl-tile"><b>${fmt(cur)}</b><span>current</span></div>
        <div class="atl-tile"><b>${fmt(longest)}</b><span>longest</span></div>
        <div class="atl-tile"><b>${fmt(taken)}</b><span>snapshots</span></div>
      </div>
    </div>`;
  return chartCard('Scan streak', `${fmt(cur)}d`, inner);
}

function render() {
  if (!root || !ctx) return;
  root.innerHTML = '';
  const S = ctx.data.selected;
  if (!S) return;   // calm blank when no scan is selected
  const cd = S.scan?.id || '';
  const scans = ctx.data.scans || [];
  const bundle = ctx.data.bundle || {};
  const now = new Date().toISOString();   // injected here, never inside intel/*.mjs (they stay pure)

  const head = el('h2', 'sec', 'Analytics');
  head.appendChild(el('span', 'atl-insight', `${fmt(scans.length)} snapshots`));
  root.appendChild(head);

  const grid = el('div', 'charts');
  grid.appendChild(xpCard(scans, cd, S));
  grid.appendChild(forecastCard(S, now));
  grid.appendChild(castsCard(bundle, cd));
  grid.appendChild(followCard(bundle, cd));
  grid.appendChild(streakCard(S, scans, cd));
  root.appendChild(grid);
  aosKids(grid, 'zoom-in', 60);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    root = el('div', 'realm-atlas');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    root = null; ctx = null;
  },
};
