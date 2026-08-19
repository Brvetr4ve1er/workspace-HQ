// timeline.js — LOOKBACK's TIMELINE section: the retrospective story.
//
// Ported from v3 realms/chronicle/view.js. Turns the scan series, the weekly
// recap and the achievement unlocks into one scrollable narrative: selected
// snapshot at the top, each node carrying that day's notable change(s) plus any
// achievements that unlocked in its window. Scrubbing to an older snapshot
// rewinds the whole story to that point — every loop below runs from the
// SELECTED index down, never from the end of the array.
import { el, esc, fmt, mdLite, DAY_MS } from '../../ui/util.js';
import { achMeta } from './ach.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// numeric gate for anything interpolated into innerHTML from scan data
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
// YYYY-MM-DD parts, tolerant of ISO timestamps (slice off any time component)
const parts = (s) => String(s || '').slice(0, 10).split('-').map(Number);
const dayLabel = (id) => { const [, m, d] = parts(id); return m ? `${MON[m - 1]} ${d}` : String(id ?? ''); };
const yearOf = (id) => parts(id)[0] || '';

// whole days from plain date a (earlier) to b (later)
function daysBetween(a, b) {
  const [ay, am, ad] = parts(a), [by, bm, bd] = parts(b);
  if (!am || !bm) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}
function rangeStr(first, cur) {
  const yf = yearOf(first), yc = yearOf(cur);
  const left = yf !== yc ? `${dayLabel(first)} ${yf}` : dayLabel(first);
  return `${left} – ${dayLabel(cur)} ${yc}`;
}

// friendly labels for changes_since_prev.type (raw underscore token as fallback)
const CHG_LABEL = {
  quest_completed: 'Task cleared',
  quest_unresolved: 'Task still open',
  repo_initialized: 'Repo initialized',
  first_remote: 'First remote',
  git_pushed: 'Pushed to remote',
  spell_learned: 'Automation learned',
  spellcraft_xp: 'Automation XP',
  new_achievement: 'Achievement',
  anomaly: 'Anomaly',
};
const chgLabel = (t) => CHG_LABEL[t] || String(t || 'change').replace(/_/g, ' ');
const impactClass = (imp) => (imp === 'positive' || imp === 'negative' ? imp : 'neutral');

// ------------------------------------------------------- header stat strip
// v3 count-up-animated the XP number. v4's motion law is "motion follows a real
// state change" — a number that was always this value on mount has not changed,
// so it is set, not tweened.
function renderHeader(parent, S, scans, selIdx) {
  const a = S.account || {};
  const first = scans[0]?.scan?.id, cur = S.scan?.id;
  const span = daysBetween(first, cur);
  const chips = [
    ['Level', 'L' + num(a.level)],
    ['Snapshots', fmt(selIdx + 1)],
    ['Span', span > 0 ? `${span} days` : '1 day'],
    ['Streak', `${fmt(num(a.streak?.scan_days))}d`],
  ];
  const head = el('section', 'panel panel--focal lb-head');
  head.innerHTML = `
    <div class="lb-card-body lb-head-body">
      <div class="lb-head-main">
        <div class="figure figure--xl">${esc(fmt(num(a.xp)))}</div>
        <div class="figure-label">total XP</div>
        <div class="meta lb-head-range">${esc(rangeStr(first, cur))}</div>
      </div>
      <div class="lb-head-chips">
        ${chips.map(([k, v]) => `<span class="chip"><span class="dim">${esc(k)}</span> ${esc(v)}</span>`).join('')}
      </div>
    </div>`;
  parent.appendChild(head);
}

// ------------------------------------------------------- weekly recap card
// weeklyRecap is a single bundle-level object (the most recent week), not
// per-scan — feature-detected, renders nothing when absent.
function renderRecap(parent, bundle) {
  const w = bundle && bundle.weeklyRecap;
  if (!w) return false;
  const range = (w.week_start && w.week_end) ? rangeStr(w.week_start, w.week_end) : '';
  const st = w.stats || {};
  const chips = [];
  if (typeof st.xp_gain === 'number') chips.push(['XP', (st.xp_gain >= 0 ? '+' : '') + fmt(st.xp_gain), st.xp_gain >= 0 ? 'pos' : 'neg']);
  if (typeof st.achievements_unlocked === 'number' && st.achievements_unlocked) chips.push(['unlocked', fmt(st.achievements_unlocked), 'pos']);
  if (typeof st.quests_completed === 'number') chips.push(['tasks', fmt(st.quests_completed), st.quests_completed ? 'pos' : '']);
  if (typeof st.health_delta === 'number' && st.health_delta) chips.push(['HP', (st.health_delta > 0 ? '+' : '') + fmt(st.health_delta), st.health_delta > 0 ? 'pos' : 'neg']);
  if (typeof st.level_start === 'number' && typeof st.level_end === 'number' && st.level_end !== st.level_start) chips.push(['level', `L${st.level_start}→L${st.level_end}`, 'pos']);

  const sc = w.spellcraft;
  let runLine = '';
  if (sc && typeof sc.casts === 'number') {
    const bits = [`${fmt(num(sc.casts))} run${num(sc.casts) === 1 ? '' : 's'}`];
    if (typeof sc.distinct_spells === 'number') bits.push(`${fmt(sc.distinct_spells)} distinct`);
    if (typeof sc.fizzled === 'number' && sc.fizzled) bits.push(`${fmt(sc.fizzled)} failed`);
    if (typeof sc.spells_known_end === 'number') bits.push(`${fmt(sc.spells_known_end)} known`);
    runLine = bits.join(' · ');
  }

  const card = el('section', 'panel lb-recap');
  // narrative_md is LLM-written text: mdLite() escapes EVERYTHING first and then
  // rebuilds only headings/bold/bullets from the escaped text, so raw HTML in
  // the model's output can never reach the DOM as markup.
  card.innerHTML = `
    <div class="panel-head">
      <span class="panel-title">Weekly recap</span>
      ${range ? `<span class="panel-sub">${esc(range)}</span>` : ''}
      <span class="spacer"></span>
      ${w.ai_narrative ? '<span class="chip">✦ AI written</span>' : ''}
    </div>
    <div class="lb-card-body">
      ${chips.length ? `<div class="lb-recap-chips">${chips.map(([k, v, cl]) => `<span class="chip lb-rchip ${cl}"><b>${esc(v)}</b> ${esc(k)}</span>`).join('')}</div>` : ''}
      ${runLine ? `<div class="meta lb-recap-runs">Automation — ${esc(runLine)}</div>` : ''}
      ${w.narrative_md ? `<div class="lb-narr">${mdLite(w.narrative_md)}</div>` : ''}
    </div>`;
  parent.appendChild(card);
  return true;
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
      const cur = scans[i]?.scan?.id, prev = i > 0 ? scans[i - 1]?.scan?.id : null;
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
  if (dq > 0) return { text: `${dq} task${dq === 1 ? '' : 's'} cleared`, impact: 'positive' };
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
function renderNodes(parent, S, scans, selIdx) {
  const projName = {};
  (S.projects || []).forEach((p) => { if (p && p.id) projName[p.id] = p.name || p.id; });
  const achBuckets = achByScan(S, scans, selIdx);

  const line = el('div', 'lb-timeline');
  let nodes = 0;
  for (let i = selIdx; i >= 0; i--) {
    const scanObj = scans[i];
    if (!scanObj) continue;
    const prev = i > 0 ? scans[i - 1] : null;
    const changes = Array.isArray(scanObj.changes_since_prev) ? scanObj.changes_since_prev : [];

    let rows;
    if (changes.length) {
      rows = changes.map((c) => {
        const who = c?.project_id && projName[c.project_id] ? projName[c.project_id] : '';
        return `<div class="lb-chg ${impactClass(c?.impact)}">
          <span class="lb-chg-t">${esc(chgLabel(c?.type))}</span>${who ? `<span class="lb-chg-p">${esc(who)}</span>` : ''}${c?.detail ? `<span class="lb-chg-d">${esc(c.detail)}</span>` : ''}
        </div>`;
      }).join('');
    } else {
      const d = derivedDelta(scanObj, prev);
      rows = `<div class="lb-chg ${d.impact}"><span class="lb-chg-d solo">${esc(d.text)}</span></div>`;
    }

    const achIds = achBuckets[i] || [];
    // Catalog icons are static developer-authored markup (see ach.js) — safe as
    // HTML; the achievement name/desc are display strings, so those go through
    // esc(). Unknown ids fall back to a generic badge + the de-underscored id.
    const achHtml = achIds.length
      ? `<div class="lb-badges">${achIds.map((id) => {
          const meta = achMeta(id);
          const icon = meta ? meta.icon : '🏅';
          const name = meta ? meta.name : String(id).replace(/_/g, ' ');
          return `<span class="lb-badge" title="${esc(meta ? meta.desc : '')}"><span class="lb-badge-ic">${icon}</span>${esc(name)}</span>`;
        }).join('')}</div>`
      : '';

    const isTop = i === selIdx;
    const ago = isTop ? 'selected snapshot' : `${daysBetween(scanObj.scan?.id, S.scan?.id)}d earlier`;
    const node = el('div', 'lb-node' + (isTop ? ' top' : ''));
    node.innerHTML = `
      <div class="lb-rail"><span class="lb-dot"></span></div>
      <div class="lb-node-body">
        <div class="lb-when">${esc(dayLabel(scanObj.scan?.id))}<span class="lb-yr">${esc(String(yearOf(scanObj.scan?.id)))}</span><span class="meta lb-ago">${esc(ago)}</span></div>
        <div class="lb-changes">${rows}</div>
        ${achHtml}
      </div>`;
    line.appendChild(node);
    nodes++;
  }
  parent.appendChild(line);
  return nodes;
}

// ------------------------------------------------------------------- section
export function renderTimeline(parent, ctx) {
  const S = ctx.data.selected;
  const scans = ctx.data.scans || [];
  const selIdx = ctx.data.selectedIndex;
  renderHeader(parent, S, scans, selIdx);
  const recap = renderRecap(parent, ctx.data.bundle);
  parent.appendChild(el('h2', 'lb-sec', 'Timeline'));
  const nodes = renderNodes(parent, S, scans, selIdx);
  return { nodes, recap };
}
