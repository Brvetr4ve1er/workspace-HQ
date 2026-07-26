// CHRONICLE realm — a retrospective timeline. Turns the scan time series, the
// weekly recap, and achievement unlocks into a single scrollable story of
// progress: newest scan at top, each node carrying that day's notable change(s)
// plus any achievements that unlocked in its window. Re-anchors on data:select
// so scrubbing to an old snapshot rewinds the whole story to that point.
import { el, esc, fmt, mdLite } from '../../ui/util.js';
import { aosKids, aosRefresh, ACH, countUp } from '../../ui/components.js';

let root = null, ctx = null, offSelect = null;
// Header XP survives re-renders: countUp reads a fresh node each paint (data-v
// absent → 0), so we seed it with the last value to animate the delta, not 0→now
// on every scrub. Reset on mount so a fresh entry still counts up from zero once.
let lastXp = null;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// numeric gate for anything interpolated into innerHTML from scan data
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
// YYYY-MM-DD parts, tolerant of ISO timestamps (slice off any time component)
const parts = (s) => String(s || '').slice(0, 10).split('-').map(Number);
const dayLabel = (id) => { const [, m, d] = parts(id); return m ? `${MON[m - 1]} ${d}` : esc(String(id)); };
const yearOf = (id) => parts(id)[0] || '';
// whole days from plain date a (earlier) to b (later)
function daysBetween(a, b) {
  const [ay, am, ad] = parts(a), [by, bm, bd] = parts(b);
  if (!am || !bm) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}
function rangeStr(first, cur) {
  const yf = yearOf(first), yc = yearOf(cur);
  const left = yf !== yc ? `${dayLabel(first)} ${yf}` : dayLabel(first);
  return `${left} – ${dayLabel(cur)} ${yc}`;
}

// friendly labels for changes_since_prev.type (raw underscore token as fallback)
const CHG_LABEL = {
  quest_completed: 'Quest cleared',
  quest_unresolved: 'Quest still open',
  repo_initialized: 'Repo initialized',
  first_remote: 'First remote',
  git_pushed: 'Pushed to remote',
  spell_learned: 'Spell learned',
  spellcraft_xp: 'Spellcraft XP',
  new_achievement: 'Achievement',
  anomaly: 'Anomaly',
};
const chgLabel = (t) => CHG_LABEL[t] || String(t || 'change').replace(/_/g, ' ');
const impactClass = (imp) => (imp === 'positive' || imp === 'negative') ? imp : 'neutral';

// ------------------------------------------------- header stat strip
function renderHeader(parent, S, scans, selIdx) {
  const a = S.account || {};
  const first = scans[0]?.scan?.id, cur = S.scan?.id;
  const span = daysBetween(first, cur);
  const chips = [
    ['Level', 'L' + num(a.level)],
    ['Scans', fmt(selIdx + 1)],
    ['Span', span > 0 ? `${span} days` : '1 day'],
    ['Streak', `${fmt(num(a.streak?.scan_days))}d`],
  ];
  const head = el('div', 'cr-head');
  head.innerHTML = `
    <div class="cr-head-main">
      <div class="cr-xp"><b class="cr-xpn">0</b><span class="cr-xpl">XP</span></div>
      <div class="cr-range">${esc(rangeStr(first, cur))}</div>
    </div>
    <div class="cr-chips">
      ${chips.map(([k, v]) => `<div class="cr-chip"><span class="ck">${esc(k)}</span><span class="cv">${esc(v)}</span></div>`).join('')}
    </div>`;
  parent.appendChild(head);
  const xpn = head.querySelector('.cr-xpn');
  if (lastXp != null) xpn.setAttribute('data-v', lastXp);
  countUp(xpn, num(a.xp), fmt);
  lastXp = num(a.xp);
}

// ------------------------------------------------- weekly recap card
// weeklyRecap is a single bundle-level object (the most recent week), not
// per-scan — feature-detect it and render nothing when absent.
function renderRecap(parent, bundle) {
  const w = bundle && bundle.weeklyRecap;
  if (!w) return;
  const range = (w.week_start && w.week_end) ? rangeStr(w.week_start, w.week_end) : '';
  const st = w.stats || {};
  const chips = [];
  if (typeof st.xp_gain === 'number') chips.push(['XP', (st.xp_gain >= 0 ? '+' : '') + fmt(st.xp_gain), st.xp_gain >= 0 ? 'pos' : 'neg']);
  if (typeof st.achievements_unlocked === 'number' && st.achievements_unlocked) chips.push(['unlocked', fmt(st.achievements_unlocked), 'pos']);
  if (typeof st.quests_completed === 'number') chips.push(['quests', fmt(st.quests_completed), st.quests_completed ? 'pos' : '']);
  if (typeof st.health_delta === 'number' && st.health_delta) chips.push(['HP', (st.health_delta > 0 ? '+' : '') + fmt(st.health_delta), st.health_delta > 0 ? 'pos' : 'neg']);
  if (typeof st.level_start === 'number' && typeof st.level_end === 'number' && st.level_end !== st.level_start) chips.push(['level', `L${st.level_start}→L${st.level_end}`, 'pos']);

  const sc = w.spellcraft;
  let spellLine = '';
  if (sc && typeof sc.casts === 'number') {
    const bits = [`${fmt(num(sc.casts))} cast${num(sc.casts) === 1 ? '' : 's'}`];
    if (typeof sc.distinct_spells === 'number') bits.push(`${fmt(sc.distinct_spells)} distinct`);
    if (typeof sc.fizzled === 'number' && sc.fizzled) bits.push(`${fmt(sc.fizzled)} fizzled`);
    if (typeof sc.spells_known_end === 'number') bits.push(`${fmt(sc.spells_known_end)} known`);
    spellLine = bits.join(' · ');
  }

  const card = el('section', 'cr-recap');
  card.innerHTML = `
    <div class="cr-recap-top">
      <span class="cr-recap-tag">Weekly recap</span>
      ${range ? `<span class="cr-recap-range">${esc(range)}</span>` : ''}
      ${w.ai_narrative ? '<span class="cr-recap-ai">✦ AI</span>' : ''}
    </div>
    ${chips.length ? `<div class="cr-recap-chips">${chips.map(([k, v, cl]) => `<span class="cr-rchip ${cl}"><b>${esc(v)}</b> ${esc(k)}</span>`).join('')}</div>` : ''}
    ${spellLine ? `<div class="cr-recap-spell">Spellcraft — ${esc(spellLine)}</div>` : ''}
    ${w.narrative_md ? `<div class="cr-narr">${mdLite(w.narrative_md)}</div>` : ''}`;
  parent.appendChild(card);
}

// ------------------------------------------------- achievement bucketing
// Unlocked achievements from the SELECTED snapshot, bucketed to the scan whose
// window (prevDate, thisDate] contains their unlock date. Every unlock lands on
// exactly one node even if it fired between scans; anything unlocked after the
// selected snapshot finds no window and is dropped calmly (never thrown).
function achByScan(S, scans, selIdx) {
  const buckets = {};
  (S.achievements || []).filter((x) => x && x.unlocked && x.unlocked_on).forEach((a) => {
    const on = String(a.unlocked_on).slice(0, 10);
    for (let i = 0; i <= selIdx; i++) {
      const cur = scans[i].scan?.id, prev = i > 0 ? scans[i - 1].scan?.id : null;
      if (on <= cur && (prev == null || on > prev)) { (buckets[i] = buckets[i] || []).push(a.id); break; }
    }
  });
  return buckets;
}

// Derived one-liner for scans with no changes_since_prev entries: the single
// most notable account delta vs the previous scan, worst-to-best precedence
// picking the headline. Keeps every node meaningful without inventing detail.
function derivedDelta(S, prev) {
  if (!prev) return { text: 'First scan — baseline recorded', impact: 'neutral' };
  const a = S.account || {}, p = prev.account || {};
  if (num(a.level) > num(p.level)) return { text: `Reached level ${num(a.level)}`, impact: 'positive' };
  const dq = num(a.totals?.quests_done_total) - num(p.totals?.quests_done_total);
  if (dq > 0) return { text: `${dq} quest${dq === 1 ? '' : 's'} cleared`, impact: 'positive' };
  const dach = num(a.totals?.achievements_unlocked) - num(p.totals?.achievements_unlocked);
  if (dach > 0) return { text: `${dach} achievement${dach === 1 ? '' : 's'} unlocked`, impact: 'positive' };
  const dx = num(a.xp) - num(p.xp);
  if (dx > 0) return { text: `+${fmt(dx)} XP earned`, impact: 'positive' };
  if (dx < 0) return { text: `${fmt(dx)} XP`, impact: 'negative' };
  const dh = num(a.health_index) - num(p.health_index);
  if (dh) return { text: `Health ${dh > 0 ? '+' : ''}${fmt(dh)}`, impact: dh > 0 ? 'positive' : 'negative' };
  return { text: 'Quiet scan — steady state', impact: 'neutral' };
}

// ------------------------------------------------- the timeline itself
function renderTimeline(parent, S, scans, selIdx) {
  const projName = {};
  (S.projects || []).forEach((p) => { if (p && p.id) projName[p.id] = p.name || p.id; });
  const achBuckets = achByScan(S, scans, selIdx);

  const line = el('div', 'cr-timeline');
  for (let i = selIdx; i >= 0; i--) {
    const scanObj = scans[i];
    const prev = i > 0 ? scans[i - 1] : null;
    const changes = Array.isArray(scanObj.changes_since_prev) ? scanObj.changes_since_prev : [];

    let rows;
    if (changes.length) {
      rows = changes.map((c) => {
        const who = c.project_id && projName[c.project_id] ? projName[c.project_id] : '';
        return `<div class="cr-chg ${impactClass(c.impact)}">
          <span class="cr-ct">${esc(chgLabel(c.type))}</span>${who ? `<span class="cr-cp">${esc(who)}</span>` : ''}${c.detail ? `<span class="cr-cd">${esc(c.detail)}</span>` : ''}
        </div>`;
      }).join('');
    } else {
      const d = derivedDelta(scanObj, prev);
      rows = `<div class="cr-chg ${d.impact}"><span class="cr-cd solo">${esc(d.text)}</span></div>`;
    }

    const achIds = achBuckets[i] || [];
    // ACH icons are static developer-authored SVG/emoji constants — safe as HTML;
    // the achievement name/desc are user-facing strings, so those go through esc().
    const achHtml = achIds.length
      ? `<div class="cr-ach">${achIds.map((id) => {
          const meta = ACH[id];
          const icon = meta ? meta.icon : '🏅';
          const name = meta ? meta.name : String(id).replace(/_/g, ' ');
          return `<span class="cr-badge" title="${esc(meta ? meta.desc : '')}"><span class="cr-bico">${icon}</span>${esc(name)}</span>`;
        }).join('')}</div>`
      : '';

    const isTop = i === selIdx;
    const ago = isTop ? 'latest' : `${daysBetween(scanObj.scan?.id, S.scan?.id)}d earlier`;
    const node = el('div', 'cr-node' + (isTop ? ' top' : ''));
    node.innerHTML = `
      <div class="cr-rail"><span class="cr-dot"></span></div>
      <div class="cr-body">
        <div class="cr-when">${esc(dayLabel(scanObj.scan?.id))}<span class="cr-yr">${esc(String(yearOf(scanObj.scan?.id)))}</span><span class="cr-ago">${esc(ago)}</span></div>
        <div class="cr-changes">${rows}</div>
        ${achHtml}
      </div>`;
    line.appendChild(node);
  }
  parent.appendChild(line);
  aosKids(line, 'fade-up', 26);   // staggered reveal on the nodes (no-op until AOS loads)
}

function render() {
  if (!root || !ctx) return;
  root.innerHTML = '';
  const S = ctx.data.selected;
  if (!S) {
    root.appendChild(el('div', 'empty-note', 'No scans yet — run a scan to begin your chronicle.'));
    return;
  }
  const scans = ctx.data.scans || [];
  const selIdx = ctx.data.selectedIndex;

  renderHeader(root, S, scans, selIdx);
  renderRecap(root, ctx.data.bundle);
  root.appendChild(el('h2', 'sec', 'Timeline'));
  renderTimeline(root, S, scans, selIdx);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    lastXp = null;
    root = el('div', 'realm-chronicle');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    root = null; ctx = null; lastXp = null;
  },
};
