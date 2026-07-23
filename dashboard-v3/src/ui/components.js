// Shared render machinery — VERBATIM ports from dashboard/app.js of every
// helper used by two or more render* surfaces (parity requirement: realm ports
// import from here instead of re-inlining). Only module plumbing changed:
// v2's closure globals (SCANS/cur/D) arrive as the ctx.data object parameter,
// and SFX.x() becomes the sfx('x') seam the fx agent wires via setSfx().
import { el, esc, COL } from './util.js';

const $ = (id) => document.getElementById(id);
const isElectron = !!window.hq;   // v2-verbatim gate; false in the dev harness

// ---- sfx seam: realm ports call sfx('blip'|'move'|'coin'|'open'|'levelup'|
// 'badge'|'fizzle') with v2's exact cue names; a no-op until the fx agent
// installs the real chiptune engine via setSfx.
export let sfx = () => {};
export function setSfx(fn) { sfx = fn; }

// ---- AOS scroll-reveal integration ------------------------------------
// M0 never loads the AOS lib, so AOS_ON is false and aos() is a pass-through —
// the guard is load-bearing (data-aos + aos.css without the JS would hide
// content at opacity 0). AOS_ON snapshots at module eval: if the fx agent
// lazy-loads AOS it must do so BEFORE this module is imported.
export const AOS_ON = typeof AOS !== 'undefined';
export const AOS_DUR = 560;   // reveal duration (ms) — applied inline per element, see aos()
if (AOS_ON) AOS.init({ once: true, duration: AOS_DUR, easing: 'ease-out-back', offset: 28, anchorPlacement: 'top-bottom', disableMutationObserver: true });
let _aosRaf = 0;
export function aosRefresh() {
  if (!AOS_ON) return;
  cancelAnimationFrame(_aosRaf);
  // double rAF: let the freshly-built DOM lay out before AOS reads positions
  _aosRaf = requestAnimationFrame(() => requestAnimationFrame(() => AOS.refreshHard()));
}
// Tag a node for scroll-reveal with an optional capped stagger.
// Timing is set INLINE, not via data-aos-delay/duration: AOS's bundled CSS only
// honours those attributes in fixed 50ms steps, so off-grid values (our
// 40/45/35/70/60ms staggers and the 560ms global) silently fall back to the
// 50ms base. Inline styles outrank the stylesheet, so exact ms land reliably.
export function aos(node, anim, i, step) {
  if (!AOS_ON || !node) return node;
  node.setAttribute('data-aos', anim);
  node.style.transitionDuration = AOS_DUR + 'ms';
  if (i != null) node.style.transitionDelay = Math.min(i * (step || 55), 600) + 'ms';
  return node;
}
export const aosKids = (parent, anim, step) => { if (parent) [...parent.children].forEach((c, i) => aos(c, anim, i, step)); };

// Count a number up/down to its new value over ~half a second (XP-juice). Stores the
// current value on the node so re-renders animate only the delta, not from zero.
export function countUp(node, to, fmt) {
  if (!node) return;
  const from = Number(node.getAttribute('data-v') || 0);
  node.setAttribute('data-v', to);
  if (from === to) { node.textContent = fmt ? fmt(to) : to; return; }
  const dur = 520, t0 = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const v = Math.round(from + (to - from) * ease(k));
    node.textContent = fmt ? fmt(v) : v;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const sign = (n) => (n > 0 ? '+' + n : '' + n);
export const deltaSpan = (n, invert) => {
  if (!n) return `<span class="flat">±0</span>`;
  const good = invert ? n < 0 : n > 0;
  return `<span class="${good ? 'up' : 'down'}">${n > 0 ? '▲' : '▼'} ${sign(n)}</span>`;
};

// Cooldown text for [data-cd] nodes. The 30s ticker interval is NOT here —
// the grimoire realm owns it (and clears it on unmount).
export function fmtCd(ms) {
  if (ms <= 0) return 'ready';
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// v2-verbatim duration (browser-focus surfaces). util.js dur() rounds
// differently — parity wins, keep both.
export function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm';
  const h = m / 60;
  return (h >= 10 ? Math.round(h) : h.toFixed(1)) + 'h';
}

// ---- per-render derivation, exactly as v2 render() computed it -------------
// v2: const S = SCANS[cur], prev = SCANS[cur-1] || null, a = S.account; + maps.
export function deriveScanContext(data) {
  const S = data.selected, prev = data.scans[data.selectedIndex - 1] || null, a = S.account;
  const projById = {}; S.projects.forEach((p) => (projById[p.id] = p));
  const prevProj = {}; if (prev) prev.projects.forEach((p) => (prevProj[p.id] = p));
  return { S, prev, a, projById, prevProj, isLatest: data.isLatest };
}

// ---- badge computations (v2 render() → #quest-count/#spell-count/#ach-count)
export const questCount = (S) => S.account.totals.open_quests;
export const achCount = (S) => (S.achievements || []).filter((x) => x.unlocked).length;
export const spellCount = (data) => data.bundle.spellbook ? data.bundle.spellbook.counts.total : '';

// ---- progressive-disclosure fold: h2 header + persisted open state ---------
// Detail is never deleted, it collapses behind one click. Collapsed headers show
// a one-line summary so nothing is invisible, just quiet. (UX contract: BASE
// presents ONE decision; everything else folds.)
export function foldSec(parent, key, title, summary, build, defaultOpen = false) {
  let open = localStorage.getItem('hq-sec-' + key);
  open = open == null ? defaultOpen : open === '1';
  const h = el('h2', 'sec sec-fold');
  const body = el('div', 'fold-body');
  const paint = () => {
    h.innerHTML = `<span class="fold-chev">${open ? '▾' : '▸'}</span> ${title}${!open && summary ? `<span class="fold-sum">${summary}</span>` : ''}`;
    body.innerHTML = '';
    if (open) build(body);
  };
  h.onclick = () => { open = !open; localStorage.setItem('hq-sec-' + key, open ? '1' : '0'); paint(); sfx('blip'); };
  parent.appendChild(h); parent.appendChild(body);
  paint();
}

// ---------------------------------------------------------------- charts
export function lineChart(series, curDate) {
  const W = 320, H = 130, pad = 26;
  const sliced = series.map((s) => ({ ...s, points: s.points.filter((p) => p.d <= curDate) }));
  const all = sliced.flatMap((s) => s.points.map((p) => p.v));
  if (!all.length) return '<svg viewBox="0 0 320 130"></svg>';
  const max = Math.max(1, ...all), min = Math.min(...all, 0);
  const n = Math.max(...sliced.map((s) => s.points.length), 2);
  const sx = (i) => pad + (i * (W - pad * 2)) / (n - 1);
  const sy = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  [0.25, 0.5, 0.75].forEach((f) => { const y = pad + f * (H - pad * 2); svg += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#1d1840"/>`; });
  svg += `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#322a5e"/>`;
  svg += `<text x="${pad}" y="13" fill="#5e588a" font-size="9" font-family="monospace">${max}</text>`;
  sliced.forEach((s) => {
    if (s.points.length < 1) return;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
    if (s.points.length === 1) svg += `<circle cx="${sx(0)}" cy="${sy(s.points[0].v)}" r="3" fill="${s.color}"/>`;
    else {
      if (s.area) { svg += `<path d="${d} L${sx(s.points.length - 1).toFixed(1)},${H - pad} L${sx(0).toFixed(1)},${H - pad} Z" fill="${s.color}" opacity="0.08"/>`; }
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    const last = s.points.length - 1;
    svg += `<circle cx="${sx(last).toFixed(1)}" cy="${sy(s.points[last].v).toFixed(1)}" r="3" fill="${s.color}"/>`;
  });
  return svg + '</svg>';
}
export function stackedBar(rows0, keys, colors, curDate) {
  const rows = rows0.filter((r) => r.d <= curDate);
  const W = 320, H = 130, pad = 26;
  if (!rows.length) return '<svg viewBox="0 0 320 130"></svg>';
  const slot = (W - pad * 2) / rows.length, bw = Math.min(30, slot - 7);
  const totals = rows.map((r) => keys.reduce((s, k) => s + (r[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const sx = (i) => pad + i * slot + (slot - bw) / 2;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  svg += `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#322a5e"/>`;
  rows.forEach((r, i) => {
    let y = H - pad;
    keys.forEach((k) => { const h = ((r[k] || 0) / max) * (H - pad * 2); y -= h; if (h > 0) svg += `<rect x="${sx(i).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[k]}"/>`; });
    svg += `<text x="${(sx(i) + bw / 2).toFixed(1)}" y="${H - pad + 12}" fill="#5e588a" font-size="8" font-family="monospace" text-anchor="middle">${esc(r.d.slice(5))}</text>`;
  });
  return svg + '</svg>';
}
export function legend(items) { return '<div class="legend">' + items.map((i) => `<span><i style="background:${i.c}"></i>${esc(i.l)}</span>`).join('') + '</div>'; }
export function chartCard(title, now, inner) {
  const c = el('div', 'chart');
  c.appendChild(el('h3', null, `<span>${esc(title)}</span>${now != null ? `<span class="now">${now}</span>` : ''}`));
  c.insertAdjacentHTML('beforeend', inner); return c;
}

// ---- schools of magic: shared by the grimoire realm AND the roundtable
// Spell-of-the-Day ribbon.
export const SCHOOL = {
  divination:    { c: COL.cyan,    label: 'DIVINATION' },
  conjuration:   { c: COL.gold,    label: 'CONJURATION' },
  transmutation: { c: COL.orange,  label: 'TRANSMUTATION' },
  abjuration:    { c: COL.blue,    label: 'ABJURATION' },
  evocation:     { c: COL.red,     label: 'EVOCATION' },
  illusion:      { c: '#ff2bd6',   label: 'ILLUSION' },
  enchantment:   { c: COL.purple,  label: 'ENCHANTMENT' },
  restoration:   { c: COL.green,   label: 'RESTORATION' },
};

// achievement catalog (static flavor; the scan only stores id + progress).
// Icons are hand-placed 16x16 pixel-art SVGs so the trophy room stays crisp
// at any zoom and locked badges can be desaturated via CSS filter.
// Shared by the legacy realm (trophy grid) AND the fx card exporter.
export const pxi = (inner) => `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" class="px-ico">${inner}</svg>`;
export const PX = {
  rocket:  pxi('<rect x="7" y="1" width="2" height="2" fill="#ff4757"/><rect x="6" y="3" width="4" height="5" fill="#dfe3ff"/><rect x="7" y="4" width="2" height="2" fill="#00f0ff"/><rect x="4" y="8" width="2" height="3" fill="#ff4757"/><rect x="10" y="8" width="2" height="3" fill="#ff4757"/><rect x="6" y="8" width="4" height="3" fill="#aab0e8"/><rect x="6" y="12" width="4" height="2" fill="#ffa502"/><rect x="7" y="14" width="2" height="1" fill="#ffd23f"/>'),
  sparkle: pxi('<rect x="7" y="2" width="2" height="3" fill="#00f0ff"/><rect x="7" y="11" width="2" height="3" fill="#00f0ff"/><rect x="2" y="7" width="3" height="2" fill="#00f0ff"/><rect x="11" y="7" width="3" height="2" fill="#00f0ff"/><rect x="6" y="6" width="4" height="4" fill="#dffcff"/>'),
  check:   pxi('<rect x="2" y="8" width="2" height="2" fill="#3aff6e"/><rect x="4" y="10" width="2" height="2" fill="#3aff6e"/><rect x="6" y="12" width="2" height="2" fill="#3aff6e"/><rect x="8" y="10" width="2" height="2" fill="#3aff6e"/><rect x="10" y="8" width="2" height="2" fill="#3aff6e"/><rect x="12" y="6" width="2" height="2" fill="#3aff6e"/><rect x="14" y="4" width="2" height="2" fill="#3aff6e"/>'),
  lock:    pxi('<rect x="5" y="4" width="1" height="3" fill="#aab0e8"/><rect x="10" y="4" width="1" height="3" fill="#aab0e8"/><rect x="6" y="3" width="4" height="1" fill="#aab0e8"/><rect x="4" y="7" width="8" height="6" fill="#ffd23f"/><rect x="7" y="9" width="2" height="3" fill="#3a2a00"/>'),
  shield:  pxi('<rect x="4" y="2" width="8" height="2" fill="#4d9fff"/><rect x="3" y="4" width="10" height="5" fill="#4d9fff"/><rect x="4" y="9" width="8" height="2" fill="#3578cc"/><rect x="5" y="11" width="6" height="2" fill="#3578cc"/><rect x="7" y="13" width="2" height="1" fill="#3578cc"/><rect x="6" y="5" width="4" height="3" fill="#dffcff"/>'),
  wrench:  pxi('<rect x="9" y="2" width="4" height="2" fill="#aab0e8"/><rect x="8" y="4" width="2" height="2" fill="#aab0e8"/><rect x="12" y="4" width="2" height="2" fill="#aab0e8"/><rect x="9" y="6" width="4" height="2" fill="#dfe3ff"/><rect x="7" y="8" width="3" height="2" fill="#dfe3ff"/><rect x="5" y="10" width="3" height="2" fill="#dfe3ff"/><rect x="3" y="12" width="3" height="2" fill="#aab0e8"/>'),
  fire:    pxi('<rect x="7" y="1" width="2" height="2" fill="#ffa502"/><rect x="6" y="3" width="4" height="2" fill="#ffa502"/><rect x="5" y="5" width="6" height="3" fill="#ff6348"/><rect x="4" y="8" width="8" height="4" fill="#ff4757"/><rect x="6" y="9" width="4" height="4" fill="#ffd23f"/><rect x="5" y="12" width="6" height="2" fill="#ff6348"/>'),
  trophy:  pxi('<rect x="4" y="2" width="8" height="5" fill="#ffd23f"/><rect x="2" y="3" width="2" height="3" fill="#ffd23f"/><rect x="12" y="3" width="2" height="3" fill="#ffd23f"/><rect x="6" y="7" width="4" height="2" fill="#c98f1b"/><rect x="7" y="9" width="2" height="2" fill="#c98f1b"/><rect x="5" y="11" width="6" height="2" fill="#ffd23f"/><rect x="4" y="13" width="8" height="1" fill="#c98f1b"/>'),
  bars:    pxi('<rect x="2" y="10" width="3" height="4" fill="#4d9fff"/><rect x="6" y="7" width="3" height="7" fill="#00f0ff"/><rect x="10" y="3" width="3" height="11" fill="#3aff6e"/>'),
  broom:   pxi('<rect x="10" y="2" width="2" height="2" fill="#aab0e8"/><rect x="9" y="4" width="2" height="2" fill="#aab0e8"/><rect x="8" y="6" width="2" height="2" fill="#aab0e8"/><rect x="6" y="8" width="3" height="2" fill="#c98f1b"/><rect x="4" y="10" width="5" height="2" fill="#ffd23f"/><rect x="3" y="12" width="6" height="2" fill="#ffa502"/>'),
  key:     pxi('<rect x="2" y="4" width="6" height="6" fill="#ffd23f"/><rect x="3" y="5" width="4" height="4" fill="#0c0a1e"/><rect x="4" y="6" width="2" height="2" fill="#ffd23f"/><rect x="8" y="6" width="6" height="2" fill="#ffd23f"/><rect x="11" y="8" width="2" height="2" fill="#ffd23f"/><rect x="13" y="8" width="1" height="3" fill="#ffd23f"/>'),
  book:    pxi('<rect x="3" y="3" width="10" height="11" fill="#4d9fff"/><rect x="7" y="3" width="2" height="11" fill="#2a5fa8"/><rect x="4" y="5" width="2" height="1" fill="#dffcff"/><rect x="10" y="5" width="2" height="1" fill="#dffcff"/><rect x="4" y="8" width="2" height="1" fill="#dffcff"/><rect x="10" y="8" width="2" height="1" fill="#dffcff"/><rect x="4" y="11" width="2" height="1" fill="#dffcff"/><rect x="10" y="11" width="2" height="1" fill="#dffcff"/>'),
};
export const ACH = {
  liftoff:        { name: 'Liftoff',           icon: PX.rocket,  desc: 'Push a repo to a remote for the first time.' },
  in_sync:        { name: 'Clean Slate',       icon: PX.sparkle, desc: 'Get a repo to zero uncommitted files.' },
  green_machine:  { name: 'Green Machine',      icon: PX.check,   desc: 'Every product builds green at once.' },
  version_control:{ name: 'Under Control',      icon: PX.lock,    desc: 'Every product has a git repo with ≥1 commit.' },
  test_first:     { name: 'Safety Net',         icon: PX.shield,  desc: 'Add the first real passing test suite.' },
  crash_slayer:   { name: 'Crash Slayer',       icon: PX.wrench,  desc: 'Flip a product from red build to green.' },
  quest_streak_5: { name: 'On a Roll',          icon: PX.fire,    desc: 'Complete 5 quests.' },
  debt_zero:      { name: 'Inbox Zero (Code)',  icon: PX.trophy,  desc: 'Drive open RED quests to zero.' },
  scan_streak_7:  { name: 'Habit Formed',       icon: PX.bars,    desc: 'Maintain a 7-day scan streak.' },
  declutter:      { name: 'Marie Kondo',        icon: PX.broom,   desc: 'Remove all stray empty folders.' },
  secret_free:    { name: 'No Loose Keys',      icon: PX.key,     desc: 'No exposed secrets across any product.' },
  documented:     { name: 'Well Documented',    icon: PX.book,    desc: 'Every product has a README.' },
  scribe:         { name: 'Scribe',             icon: '✍️',       desc: 'Capture 30 lessons in your What I Learned log.' },
  cartographer:   { name: 'Cartographer',       icon: '🗺️',       desc: 'Every product has a vault note.' },
  // spellcraft achievements (Spellbook economy)
  first_cast:      { name: 'Apprentice',        icon: '🪄',       desc: 'Cast your first spell from the Spellbook.' },
  arcanist_50:     { name: 'Arcanist',          icon: '📖',       desc: 'Amass an arsenal of 50 known spells.' },
  battle_mage_100: { name: 'Battle Mage',       icon: '⚔️',       desc: 'Resolve 100 lifetime casts.' },
  polymath:        { name: 'Polymath',          icon: '🌈',       desc: 'Cast a spell from every school of magic.' },
  familiar_bond:   { name: 'Familiar Bond',     icon: '🐦‍⬛',      desc: 'Bind 5 MCP familiars to your headquarters.' },
  spell_master:    { name: 'Spell Master',      icon: '🏅',       desc: 'Reach Master mastery (40 distinct days) on one spell.' },
  daily_ritualist: { name: 'Daily Ritualist',   icon: '🕯️',       desc: 'Cast the Spell of the Day 7 times.' },
  chain_caster:    { name: 'Chain Caster',      icon: '⛓️',       desc: 'Resolve a spell chain without a fizzle.' },
};

// ---- dev-server run state: one shared store. projectCard (forge) and the
// drawer both read it; the onDevStatus subscription (chrome/fx wiring) writes
// devState[id] = running.
export const devState = {};

// ----------------------------------------------------- side-quests (Thread D)
// "Smart propositions": urgent/risky actions + cool ideas, per project. Rendered on
// the quest board (global) and in each project drawer (scoped). They ride the same
// quest-overrides store, so ✓ DID IT persists exactly like a real quest completion.
export const SQ_KIND = {
  risk:   { label: 'RISK',   col: COL.red },
  urgent: { label: 'URGENT', col: COL.orange },
  idea:   { label: 'IDEA',   col: COL.cyan },
  polish: { label: 'POLISH', col: COL.purple },
};
export function sideQuestRow(sq, showProject, data) {
  const k = SQ_KIND[sq.kind] || SQ_KIND.idea;
  const row = el('div', 'sq ' + sq.kind);
  row.style.setProperty('--sqc', k.col);
  const meta = [];
  if (sq.effort) meta.push(`effort ${esc(sq.effort)}`);
  if (sq.impact) meta.push(`impact ${esc(sq.impact)}`);
  if (sq.source === 'llm') meta.push('✦ AI');
  row.innerHTML = `
    <span class="sqk">${k.label}</span>
    <div class="sqbody">
      <div class="sqt">${esc(sq.title)}${showProject && sq.project_name ? `<span class="sqp">↳ ${esc(sq.project_name)}</span>` : ''}</div>
      ${sq.detail ? `<div class="sqd">${esc(sq.detail)}</div>` : ''}
      ${meta.length ? `<div class="sqtags">${meta.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="sqact"></div>`;
  if (isElectron && data.isLatest) {
    const act = row.querySelector('.sqact');
    const proj = data.selected.projects.find((p) => p.id === sq.project_id);
    if (sq.fat_dirs && sq.fat_dirs.length && proj) {   // reclaim quest → real PURGE (guarded + confirm in main)
      const pb = el('button', 'qbtn purge', '🗑 PURGE');
      pb.onclick = (e) => { e.stopPropagation(); window.hq.reclaim(proj.path, sq.fat_dirs.map((d) => d.name)); };
      act.appendChild(pb);
    }
    if (proj) {   // ⚡ open an interactive Claude session seeded with this proposition
      const cb = el('button', 'qbtn claude', '⚡');
      cb.title = 'Send to a Claude session';
      cb.onclick = (e) => { e.stopPropagation(); window.hq.claudeQuest(proj.path, `${sq.title}${sq.detail ? ' — ' + sq.detail : ''}`); };
      act.appendChild(cb);
    }
    const b = el('button', 'qbtn', '✓ DID IT');
    b.onclick = (e) => { e.stopPropagation(); b.disabled = true; sfx('coin'); window.hq.markQuestDone(sq.id); };
    act.appendChild(b);
  }
  return row;
}

// ----------------------------------------------------------------- drawer
// The project drawer is opened from three realms (roundtable picks, forge
// cards, lands buildings) — it lives here, anchored on the #drawer/#scrim
// overlay nodes v3's index.html pre-seeds.
export function openDrawer(p, prevP, data) {
  const g = p.metrics.git_safety, ch = p.metrics.code_health, rs = p.metrics.risk_security;
  const D = data.bundle;
  const d = $('drawer');
  const mt = (k, v) => `<div class="mtile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const dpc = prevP ? p.completion.pct - prevP.completion.pct : 0;

  // --- "Where was I?" re-entry briefing (cold-start ramp) ---
  const S = data.selected;
  const tRank = { red: 0, orange: 1, yellow: 2 };
  const openQp = (S.quests || []).filter((q) => (q.status === 'open' || q.status === 'in_progress') && q.project_id === p.id)
    .sort((x, y) => (tRank[x.tier] ?? 1) - (tRank[y.tier] ?? 1))[0];
  const dsc = p.activity.days_since_commit;
  const rfiles = ch.recent_files || [];
  const nextAction = openQp ? openQp.title : (g.dirty > 0 ? `Commit ${g.dirty} dirty files` : 'Open it and look around');
  // RESUME moved to the sticky action bar — the briefing stays pure context.
  const reentryHtml = `
    <div class="dwr-sec reentry">
      <h4>Where was I?</h4>
      <div class="re-line"><b>is</b> ${esc((p.stack || []).slice(0, 3).join(' · ') || 'a project')} · ${p.completion.pct}% done</div>
      ${g.last_commit_subject ? `<div class="re-line"><b>last</b> "${esc(g.last_commit_subject)}"${dsc != null ? ` <span class="muted">· ${dsc}d ago</span>` : ''}</div>` : ''}
      ${g.dirty > 0 ? `<div class="re-line"><b>wip</b> ${g.dirty} uncommitted file${g.dirty > 1 ? 's' : ''}</div>` : ''}
      <div class="re-line"><b>next</b> ${esc(nextAction)}</div>
      ${rfiles.length ? `<div class="re-files">${rfiles.map((f) => `<button class="re-file" data-f="${esc(f)}" title="open ${esc(f)}">${esc(f.split('/').pop())}</button>`).join('')}</div>` : ''}
    </div>`;
  let insHtml = (p.insights || []).map((i) =>
    `<div class="ins ${esc(i.severity)}">${esc(i.text)}${i.tags?.length ? `<div class="tags">${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>`).join('') || '<div class="empty-note">No insights for this snapshot.</div>';
  let sugHtml = (p.suggestions || []).map((s) =>
    `<div class="ins info">${esc(s.text)}<div class="tags"><span class="tag">effort ${esc(s.effort)}</span><span class="tag">impact ${esc(s.impact)}</span></div></div>`).join('');
  let flagHtml = (rs.flags || []).map((f) =>
    typeof f === 'string' ? `<div class="flag">${esc(f)}</div>` : `<div class="flag">${esc(f.detail)}<div class="loc">${esc(f.type)} · ${esc(f.location || '')}</div></div>`).join('');
  let roadHtml = (p.roadmap || []).map((r) =>
    `<div class="road"><div class="ms">${esc(r.milestone)}<span class="tag">${esc(r.status)}${r.progress_pct != null ? ' · ' + r.progress_pct + '%' : ''}</span></div>${r.items?.length ? `<ul class="items">${r.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>` : ''}</div>`).join('');

  let notesHtml = '';
  const pnotes = D.projectNotes && D.projectNotes[p.id] ? D.projectNotes[p.id] : [];
  if (pnotes.length) {
    notesHtml = pnotes.map(n => `<div class="note-item"><div class="date">${n.date.slice(0, 16).replace('T', ' ')}</div><div class="text">${esc(n.text)}</div></div>`).join('');
  } else {
    notesHtml = '<div class="empty-note">No tasks or notes recorded.</div>';
  }

  let branchWarn = '';
  const rf = p.metrics.risk_security.flags || [];
  // risk_security.flags are objects ({type}) with underscore tokens; git_safety
  // .flags are hyphenated strings — check each in its own shape.
  const rsNonCanon = rf.some((f) => typeof f === 'string' ? f === 'non-canonical-branch' : f.type === 'non_canonical_branch');
  if (rsNonCanon || (g.flags && g.flags.includes('non-canonical-branch'))) {
    branchWarn = `<div class="branch-warn">Active branch (${esc(g.branch)}) differs from canonical (${esc(p.canonical_branch)})</div>`;
  }

  const isRunning = devState[p.id];
  // Compact dev toggle for the action bar. Keeps id + inner <b> so the existing
  // onDevStatus handler keeps updating it live.
  const devBarHtml = (isElectron && p.dev_cmd)
    ? `<button class="ab-btn dwr-dev-btn ${isRunning ? 'running' : ''}" id="dwr-devbtn-${p.id}" title="${esc(p.dev_cmd)}"><b>${isRunning ? '■ STOP' : '▶ DEV'}</b></button>`
    : '';

  // fold(): diagnostics collapse behind native <details>. Verbs first, audit second —
  // re-entering a messy project must never read as an indictment.
  const fold = (title, inner, open) => inner
    ? `<details class="dwr-fold"${open ? ' open' : ''}><summary>${title}</summary><div class="df-body">${inner}</div></details>`
    : '';

  const standingInner = `
    <div class="metricgrid">
      ${mt('Completion', `${p.completion.pct}% ${dpc ? deltaSpan(dpc) : ''}`)}
      ${mt('Project level', `L${p.level} · ${p.xp} xp`)}
      ${mt('Build', esc(ch.build))}
      ${mt('Tests', ch.tests?.passing ? `${ch.tests.passing}/${ch.tests.count ?? '?'}` : ch.tests?.present ? 'present' : 'none')}
      ${mt('Activity', esc(p.activity.state))}
      ${mt('Files · LOC', `${ch.files} · ${(ch.loc || 0).toLocaleString()}`)}
    </div>
    <div style="margin-top:10px;font-size:12.5px;color:var(--muted)">${esc(p.completion.basis || '')}</div>`;
  const gitInner = `
    <div class="metricgrid">
      ${mt('Repo', g.has_git ? 'yes' : 'none')}
      ${mt('Remote', g.has_remote ? 'yes' : 'no')}
      ${mt('Commits', g.commits)}
      ${mt('Dirty', g.dirty)}
      ${mt('Ahead / behind', `${g.ahead} / ${g.behind}`)}
      ${mt('Secrets seen', rs.secrets_found)}
    </div>
    ${g.remote ? `<div style="margin-top:10px;font-size:11.5px;color:var(--faint);font-family:var(--mono)">${esc(g.branch || '')} → ${esc(g.remote)}</div>` : ''}
    ${branchWarn}`;

  d.innerHTML = `
    <div class="dwr-head">
      <button class="x" id="dwr-x">✕</button>
      <h2>${esc(p.name)}</h2>
      <div class="sub">${esc((p.stack || []).join(' · '))} · ${esc(p.path)}</div>
    </div>
    ${isElectron ? `<div class="dwr-actionbar">
      <button class="ab-primary" id="re-resume">▶ RESUME</button>
      <button class="ab-btn" id="dwr-open" title="Open project folder">📂 OPEN</button>
      <button class="ab-btn" id="dwr-snap" title="Safe filtered backup to backups/">📦 SNAP</button>
      <button class="ab-btn" id="dwr-commit" title="Claude drafts a commit from the git diff">✍️ COMMIT</button>
      ${devBarHtml}
      <div class="ab-more-wrap">
        <button class="ab-btn" id="dwr-more" title="More actions">⋯</button>
        <div class="ab-menu" id="dwr-menu">
          <button id="dwr-learn">📚 I learned…</button>
          <button id="dwr-decide">📝 Log decision</button>
          <button id="dwr-archive" class="danger">⚰ Archive project</button>
        </div>
      </div>
    </div>` : ''}
    <div class="dwr-body">
      ${reentryHtml}
      <div class="dwr-sec">
        <h4>Tasks & Mistakes</h4>
        <div class="notes-input-group">
          <input type="text" id="dwr-note-in" placeholder="Record a task or mistake..." />
          <button id="dwr-note-add">ADD</button>
        </div>
        <div id="dwr-notes-list">${notesHtml}</div>
      </div>
      ${(p.side_quests && p.side_quests.length) ? `<div class="dwr-sec"><h4>Side-quests · smart propositions</h4><div id="dwr-sq"></div></div>` : ''}
      ${fold(`Git safety — ${esc(g.risk)} risk`, gitInner, g.risk === 'high')}
      ${fold('Security flags', flagHtml, true)}
      ${fold('Standing', standingInner, false)}
      ${fold('Insights', insHtml, false)}
      ${fold('Suggestions', sugHtml, false)}
      ${fold('Roadmap', roadHtml, false)}
    </div>`;
  $('dwr-x').onclick = closeDrawer;
  // re-entry RESUME + clickable recent files
  const resumeBtn = $('re-resume');
  if (resumeBtn) resumeBtn.onclick = () => {
    window.hq.openRepo(p.path);
    if (p.dev_cmd) window.hq.devStart(p.id);
    if (rfiles[0] && window.hq.openFile) window.hq.openFile(p.path, rfiles[0]);
    sfx('coin');
  };
  d.querySelectorAll('.re-file').forEach((b) => b.onclick = () => { if (window.hq && window.hq.openFile) window.hq.openFile(p.path, b.getAttribute('data-f')); });
  const sqWrap = $('dwr-sq');
  if (sqWrap) (p.side_quests || []).forEach((sq) => sqWrap.appendChild(sideQuestRow(sq, false, data)));
  if (isElectron) { const ob = $('dwr-open'); if (ob) ob.onclick = () => window.hq.openRepo(p.path); }
  if (isElectron) { const sb = $('dwr-snap'); if (sb) sb.onclick = () => window.hq.snapshot(p.path, p.name); }
  if (isElectron) {
    // ⋯ overflow menu (log/learn/archive live one click deeper, not in the bar)
    const moreBtn = $('dwr-more'), moreMenu = $('dwr-menu');
    if (moreBtn && moreMenu) {
      moreBtn.onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle('open'); };
      // single-slot handler on the PERSISTENT #drawer: reassigning .onclick each
      // open replaces the prior closure (which referenced a now-detached menu),
      // instead of stacking a fresh addEventListener + leaking DOM every open.
      d.onclick = (e) => { if (!moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.classList.remove('open'); };
    }
    const cm = $('dwr-commit');
    if (cm) cm.onclick = async () => {
      cm.disabled = true; cm.textContent = '✍️ Drafting…';
      const r = await window.hq.draftCommit(p.path);
      cm.disabled = false; cm.textContent = '✍️ COMMIT';
      if (r?.error) { alert('Draft failed: ' + r.error); return; }
      const final = prompt('Claude wrote this commit message — edit & OK to commit:', r.message || '');
      if (final == null || !final.trim()) return;
      const c = await window.hq.doCommit(p.path, final.trim());
      if (c?.error) alert('Commit failed: ' + c.error); else sfx('coin');
    };
    const lb = $('dwr-learn');
    if (lb) lb.onclick = () => { const t = prompt(`I learned… (about ${p.name})`); if (t && t.trim()) { window.hq.learn(p.id, t.trim()); sfx('coin'); } };
    const db = $('dwr-decide');
    if (db) db.onclick = () => { const t = prompt(`Log a decision about ${p.name}:`); if (t && t.trim()) { window.hq.logDecision(p.id, t.trim()); sfx('coin'); } };
    const ab = $('dwr-archive');
    if (ab) ab.onclick = () => { if (confirm(`Archive ${p.name}? It drops out of active counts (you can revive anytime).`)) { window.hq.archiveProject(p.id); closeDrawer(); } };
  }

  if (p.dev_cmd) {
    const db = $('dwr-devbtn-' + p.id);
    if (db) db.onclick = () => window.hq[devState[p.id] ? 'devStop' : 'devStart'](p.id);
  }

  const addBtn = $('dwr-note-add');
  if (addBtn) {
    addBtn.onclick = () => {
      const inp = $('dwr-note-in');
      const val = inp.value.trim();
      if (!val) return;
      if (isElectron) window.hq.saveNote(p.id, val);
      if (!D.projectNotes) D.projectNotes = {};
      if (!D.projectNotes[p.id]) D.projectNotes[p.id] = [];
      D.projectNotes[p.id].push({ date: new Date().toISOString(), text: val, completed: false });
      inp.value = '';
      const list = $('dwr-notes-list');
      if (list.querySelector('.empty-note')) list.innerHTML = '';
      list.innerHTML += `<div class="note-item"><div class="date">Just now</div><div class="text">${esc(val)}</div></div>`;
    };
    $('dwr-note-in').onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
  }
  d.classList.add('open'); $('scrim').classList.add('open');
  sfx('open');
}
export function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('open'); }
{ const sc = $('scrim'); if (sc) sc.onclick = closeDrawer; }

// ---- casting flow: id -> main-process whitelist -> dry-run confirm -> stream ----
// Shared by the grimoire realm and the roundtable Spell-of-the-Day ribbon.
// v2 pre-seeds #castlog/#castconfirm in index.html; v3's index.html only owns
// #scrim/#drawer, so these surfaces self-anchor under #overlays on demand.
function ensureOverlay(id, init) {
  let n = document.getElementById(id);
  if (!n) {
    n = document.createElement('div'); n.id = id;
    if (init) init(n);
    (document.getElementById('overlays') || document.body).appendChild(n);
  }
  return n;
}
const castlogNode = () => ensureOverlay('castlog', (n) => { n.className = 'hidden'; n.setAttribute('aria-live', 'polite'); });

export async function castSpell(s, confirmedHash) {
  if (!window.hq?.castSpell) { sfx('blip'); alert('Casting engine needs the Electron app (launch WorkspaceHQ, not the browser).'); return; }
  let res;
  try { res = await window.hq.castSpell(s.id, confirmedHash); } catch (e) { res = { error: String(e) }; }
  if (!res) return;
  if (res.error) { castlogLine(null, 'err', `✖ ${s.name}: ${res.error}`); showCastlog(); sfx('fizzle'); return; }
  if (res.confirm_required) { showCastConfirm(s, res.preview); return; }
  if (res.channeled) { castlogLine(null, 'sys', `⚡ ${s.name} channeled into a terminal window`); showCastlog(); sfx('open'); return; }
  showCastlog();
}

// Dry-run confirm: the user sees the EXACT command line before it ever runs.
export function showCastConfirm(s, p) {
  const m = ensureOverlay('castconfirm', (n) => n.setAttribute('aria-hidden', 'true'));
  const why = p.always_confirm ? 'This spell always asks.' : p.changed ? '⚠ The spell CHANGED since you last approved it.' : 'First time casting this spell.';
  m.innerHTML = `<div class="cc-card">
      <div class="cc-head">${esc(p.icon || '✴️')} CAST ${esc(p.name)}?</div>
      <div class="cc-why">${esc(why)}</div>
      <div class="cc-sec">it will run exactly:</div>
      <div class="cc-cmd">${esc([p.command, ...(p.args || [])].filter(Boolean).join(' '))}</div>
      ${p.cwd ? `<div class="cc-kv">in: ${esc(p.cwd)}</div>` : ''}
      <div class="cc-actions"><button class="cc-cancel">CANCEL</button><button class="cc-go">⚡ CAST IT</button></div>
    </div>`;
  m.classList.add('open');
  m.querySelector('.cc-cancel').onclick = () => m.classList.remove('open');
  m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); };
  m.querySelector('.cc-go').onclick = () => { m.classList.remove('open'); castSpell(s, p.content_hash); };
}

// ---- casting log: slide-up console, one block per cast, capped buffer ----
// The onCastOutput/onCastDone stream subscriptions are NOT wired here — the fx
// agent owns them, feeding castlogLine/castBlocks (see IPC-CONTRACT.md rule 4).
export const castBlocks = new Map();   // castId -> output <pre>
export function showCastlog() { castlogNode().classList.remove('hidden'); }
export function castlogLine(castId, stream, text) {
  const log = castlogNode();
  if (!log.querySelector('.cl-head')) {
    log.innerHTML = `<div class="cl-head"><span>📡 CASTING LOG</span><button class="cl-clear">CLEAR</button><button class="cl-x">▾ HIDE</button></div><div class="cl-body"></div>`;
    log.querySelector('.cl-x').onclick = () => log.classList.add('hidden');
    log.querySelector('.cl-clear').onclick = () => { log.querySelector('.cl-body').innerHTML = ''; castBlocks.clear(); };
  }
  const body = log.querySelector('.cl-body');
  let pre = castId && castBlocks.get(castId);
  if (!pre) {
    const block = el('div', 'cl-block');
    pre = el('pre', 'cl-pre');
    block.appendChild(pre);
    body.appendChild(block);
    if (castId) castBlocks.set(castId, pre);
  }
  const line = el('div', 'cl-' + stream);
  line.textContent = text;
  pre.appendChild(line);
  while (pre.childNodes.length > 400) pre.removeChild(pre.firstChild);   // bounded buffer
  body.scrollTop = body.scrollHeight;
}
