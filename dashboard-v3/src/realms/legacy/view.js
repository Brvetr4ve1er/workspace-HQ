// LEGACY — v2's STATS tab at parity: trend charts, Completion grove blessing,
// trophy grid. Ports app.js renderTrends / renderBlessing / renderAchievements;
// v2 render order preserved (charts → blessing → memorials grid).
import { el, esc, COL } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, aosKids, aosRefresh, deriveScanContext, ACH, PX } from '../../ui/components.js';

// Scadutree Fragments (CANON P4): parallel COSMETIC progression, off the XP
// ledger. Derived at render — one fragment per calendar day with ≥1 completed
// hunt across all recorded scans. Thresholds grant Blessing levels (flavor).
const BLESSING_THRESHOLDS = [1, 3, 5, 8, 12, 17, 23, 30];

function renderTrends(tc, S) {
  tc.innerHTML = '';
  const tr = S.trends || {}; const cd = S.scan.id;
  const charts = el('div', 'charts'); tc.appendChild(charts);
  const last = (arr) => { const f = (arr || []).filter((p) => p.d <= cd); return f.length ? f[f.length - 1].v : null; };

  if (tr.health_index) charts.appendChild(chartCard('Health index', last(tr.health_index),
    lineChart([{ color: COL.green, area: true, points: tr.health_index }], cd)));
  if (tr.xp) charts.appendChild(chartCard('Account XP', last(tr.xp),
    lineChart([{ color: COL.purple, area: true, points: tr.xp }], cd)));
  if (tr.casts_per_day && tr.casts_per_day.length) charts.appendChild(chartCard('Spells cast / day', last(tr.casts_per_day),
    lineChart([{ color: COL.gold, area: true, points: tr.casts_per_day }], cd)));
  if (tr.completion_by_project) {
    const palette = [COL.blue, COL.purple, COL.green, COL.orange, COL.red, COL.cyan, COL.pink, '#a5d6ff', '#ffa657'];
    const ids = Object.keys(tr.completion_by_project);
    const series = ids.map((id, i) => ({ color: palette[i % palette.length], points: tr.completion_by_project[id] }));
    const nameOf = {}; S.projects.forEach((p) => (nameOf[p.id] = p.name));
    const cc = chartCard('Completion % by project', null, lineChart(series, cd));
    cc.insertAdjacentHTML('beforeend', legend(ids.map((id, i) => ({ c: palette[i % palette.length], l: nameOf[id] || id }))));
    charts.appendChild(cc);
  }
  if (tr.open_quests_by_tier) {
    const cc = chartCard('Open quests by tier', null, stackedBar(tr.open_quests_by_tier, ['red', 'orange', 'yellow'], { red: COL.red, orange: COL.orange, yellow: COL.yellow }, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'red' }, { c: COL.orange, l: 'orange' }, { c: COL.yellow, l: 'yellow' }]));
    charts.appendChild(cc);
  }
  if (tr.git_risk) {
    const cc = chartCard('Git-safety risk', null, stackedBar(tr.git_risk, ['high', 'medium', 'low'], { high: COL.red, medium: COL.orange, low: COL.green }, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'high' }, { c: COL.orange, l: 'medium' }, { c: COL.green, l: 'low' }]));
    charts.appendChild(cc);
  }
  aosKids(charts, 'zoom-in', 70);
}

function renderBlessing(parent, ctx) {
  const LX = ctx.LX;
  const days = new Set();
  ctx.data.scans.forEach((s) => { if ((s.quests || []).some((q) => q.completed === s.scan.id)) days.add(s.scan.id); });
  const frags = days.size;
  const level = BLESSING_THRESHOLDS.filter((t) => frags >= t).length;
  const next = BLESSING_THRESHOLDS.find((t) => t > frags);
  parent.appendChild(el('h2', 'sec', `${LX('blessing_head')} · level ${level}`));
  const card = el('div', 'blessing');
  const pct = next ? Math.round((frags / next) * 100) : 100;
  card.innerHTML = `
    <div class="bl-row">
      <span class="bl-frags">${'✦'.repeat(Math.min(level, 8))}${'✧'.repeat(Math.max(0, 8 - level))}</span>
      <span class="bl-num">${frags} ${LX('fragment_word')}</span>
      <span class="bl-buff">+${level * 5}% vigor</span>
    </div>
    <div class="bl-bar"><i style="width:${pct}%"></i></div>
    <div class="bl-next">${next ? `${next - frags} more day${next - frags > 1 ? 's' : ''} with a completed hunt until the next blessing` : 'the grove is full — every blessing earned'}</div>`;
  parent.appendChild(card);
}

// Trophies live inside STATS ("HIGH SCORES") — one review tab, not two.
// Must run AFTER renderTrends (which clears the realm root).
function renderAchievements(ac, S, ctx) {
  renderBlessing(ac, ctx);
  ac.appendChild(el('h2', 'sec', `${ctx.LX('memorials')} · ${(S.achievements || []).filter((x) => x.unlocked).length} unlocked`));
  const grid = el('div', 'ach-grid'); ac.appendChild(grid);
  (S.achievements || []).forEach((x) => {
    const meta = ACH[x.id] || { name: x.id, icon: PX.trophy, desc: '' };
    const card = el('div', 'ach' + (x.unlocked ? ' unlocked' : ''));
    let foot = '';
    if (x.unlocked) foot = `<div class="pnum">unlocked ${esc(x.unlocked_on || '')}</div>`;
    else if (x.progress) {
      const pct = x.progress.need ? Math.min(100, Math.round((x.progress.have / x.progress.need) * 100)) : 0;
      foot = `<div class="pbar"><i style="width:${pct}%"></i></div><div class="pnum">${x.progress.have} / ${x.progress.need}</div>`;
    } else foot = `<div class="pnum">locked</div>`;
    card.innerHTML = `<div class="icon">${meta.icon}</div><div class="name">${esc(meta.name)}</div><div class="desc">${esc(meta.desc)}</div>${foot}`;
    grid.appendChild(card);
  });
  aosKids(grid, 'zoom-in', 35);
}

let root = null;
let ctx = null;
let offSelect = null;

function render() {
  if (!root || !ctx) return;
  if (!ctx.data.selected) { root.innerHTML = ''; return; }
  const { S } = deriveScanContext(ctx.data);
  renderTrends(root, S);
  renderAchievements(root, S, ctx);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    root = el('div', 'realm-legacy');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    root = null; ctx = null;
  },
};
