// HOME — the decision surface: today's picks, the One-Thing hero, a suggested-
// automation ribbon, and folded Overview + Changes + Weekly-recap context.
// Products grid + browser focus belong to the forge realm. Realm routing uses
// switchRealm('hunts'/'grimoire'); the scan globals arrive via ctx.data.
// A quiet 14-pt momentum trend (health/xp) sits below the decision surface, and
// the Overview fold carries a per-project health list (status dots + expandable
// detail) alongside the KPI tiles.
import { el, esc, mdLite, fmt, COL } from '../../ui/util.js';
import {
  sfx, aos, aosKids, aosRefresh, deriveScanContext, deltaSpan, foldSec,
  openDrawer, castSpell,
} from '../../ui/components.js';
import { switchRealm } from '../../core/shell.js';
import { computeOneThing } from './one-thing.js';
import { ensureFocusOverlay, enterOneThing } from './focus.js';
import { oracle } from '../../intel/derive.mjs';
import { buildOracleCard, buildRestCard, oracleFlagOn } from './oracle-card.js';

let rootEl = null, ctxRef = null, offData = null;

// Interactive state that must survive a data:select re-render (module scope,
// like grimoire's openTails). These are NOT subscriptions — no disposer needed.
const openPulse = new Set();          // project ids with an expanded health panel
let momentumMetric = 'health_index';  // 'health_index' | 'xp' — sparkline series
let sagaOpen = false;                 // Weekly-recap narrative expanded

// changes_since_prev row glyphs (deterministic; falls back to a neutral mark).
const CHG_ICON = { quest_completed: '✓', git_pushed: '⇧', spell_learned: '🪄', spellcraft_xp: '⚡', spell_cast: '⚡', achievement_unlocked: '🏆', level_up: '⭐', git_committed: '◆' };

// Derive a per-project health tier from real scan metrics (deterministic).
// Red keys off a CONCRETE hazard, not git-risk alone — most repos carry a
// high git-risk flag (unpushed/non-canonical), so that alone would paint the
// whole list red and kill the signal.
function projStatus(p) {
  const m = p.metrics || {}, g = m.git_safety || {}, rs = m.risk_security || {}, ch = m.code_health || {};
  const build = String(ch.build || '').toLowerCase();
  const state = p.activity?.state;
  const secrets = rs.secrets_found || 0;
  // red = exposed secrets, a failing build, or high git-risk sitting on uncommitted work (loss risk)
  if (secrets > 0 || build === 'red' || build === 'failing' || (g.risk === 'high' && (g.dirty || 0) > 0))
    return { c: COL.red, l: 'at risk', rank: 0 };
  // orange = neglected (stale) or elevated git-risk, but nothing actively on fire
  if (state === 'stale' || g.risk === 'high' || g.risk === 'medium')
    return { c: COL.orange, l: 'needs care', rank: 1 };
  // green = actively worked and low-risk
  if (state === 'active')
    return { c: COL.green, l: 'healthy', rank: 3 };
  // yellow = idle (dormant) but not alarming
  return { c: COL.yellow, l: 'idle', rank: 2 };
}

// Compact inline sparkline (no axes). The last point is "now" and pulses (CSS).
// color is a constant hex from COL, never data — safe to inline unescaped.
function sparkSvg(pts, color) {
  const W = 220, H = 34, pad = 4;
  if (!pts.length) return '';
  const vs = pts.map((p) => p.v);
  const max = Math.max(...vs), min = Math.min(...vs), span = (max - min) || 1;
  const n = pts.length;
  const sx = (i) => pad + (n === 1 ? (W - pad * 2) / 2 : (i * (W - pad * 2)) / (n - 1));
  const sy = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
  const lx = sx(n - 1).toFixed(1), ly = sy(pts[n - 1].v).toFixed(1);
  const area = n > 1 ? `${d} L${lx},${H - pad} L${sx(0).toFixed(1)},${H - pad} Z` : '';
  return `<svg class="mo-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${area ? `<path d="${area}" fill="${color}" opacity="0.12"/>` : ''}
      ${n > 1 ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      <circle class="mo-now-ring" cx="${lx}" cy="${ly}" r="3" fill="none" stroke="${color}"/>
      <circle class="mo-now" cx="${lx}" cy="${ly}" r="2.6" fill="${color}"/>
    </svg>`;
}

// MOMENTUM ribbon: glanceable 14-pt trend with a HEALTH/XP toggle. Repaints in
// place on toggle (module-scope momentumMetric survives the data:select rebuild).
function momentumStrip(S) {
  // Calm, on-palette series colors (steel blue / molten gold) — no neon.
  const META = {
    health_index: { label: 'HEALTH', color: '#74a8dc', fmt: (v) => String(v) },
    xp:           { label: 'XP',     color: '#e8a13c', fmt: (v) => fmt(v) },
  };
  const strip = el('div', 'momentum');
  const stk = S.account?.streak;
  const streakDays = stk && typeof stk === 'object' ? stk.scan_days : stk;
  const paint = () => {
    const meta = META[momentumMetric] || META.health_index;
    const raw = (S.trends && S.trends[momentumMetric]) || [];
    const pts = raw.slice(-14);
    const cur = pts.length ? pts[pts.length - 1].v
      : (momentumMetric === 'xp' ? (S.account?.xp ?? 0) : (S.account?.health_index ?? 0));
    const delta = pts.length > 1 ? cur - pts[0].v : 0;
    const range = pts.length > 1 ? `${esc(pts[0].d.slice(5))} → ${esc(pts[pts.length - 1].d.slice(5))}`
      : (pts[0] ? esc(pts[0].d.slice(5)) : '');
    strip.innerHTML = `
      <div class="mo-head">
        <span class="mo-k">Momentum · 14-day trend</span>
        <span class="mo-tabs">
          <button class="mo-tab${momentumMetric === 'health_index' ? ' on' : ''}" data-m="health_index">HEALTH</button>
          <button class="mo-tab${momentumMetric === 'xp' ? ' on' : ''}" data-m="xp">XP</button>
        </span>
      </div>
      <div class="mo-spark" style="--mc:${meta.color}">${sparkSvg(pts, meta.color)}</div>
      <div class="mo-read">
        <span class="mo-val">${esc(meta.fmt(cur))}</span>
        <span class="mo-delta">${deltaSpan(delta)}</span>
        <span class="mo-range">${range}${streakDays ? ` · 🔥 ${esc(streakDays)}` : ''}</span>
      </div>`;
    strip.querySelectorAll('.mo-tab').forEach((b) => b.onclick = () => {
      const m = b.getAttribute('data-m');
      if (m === momentumMetric) return;
      momentumMetric = m; sfx('blip'); paint();
    });
  };
  paint();
  return strip;
}

// One expandable health row's detail panel (real fields only, all escaped).
function pulseDetail(p, prevP, ctx) {
  const m = p.metrics || {}, g = m.git_safety || {}, rs = m.risk_security || {}, ch = m.code_health || {};
  const det = el('div', 'nx-detail pl-detail');
  const bits = [];
  if (p.completion.basis) bits.push(`<div class="pl-basis">${esc(p.completion.basis)}</div>`);
  const chips = [];
  chips.push(`<span class="pl-chip">L${esc(p.level)} · ${esc(fmt(p.xp || 0))} xp</span>`);
  chips.push(`<span class="pl-chip">◷ ${esc(p.activity?.state || '—')}</span>`);
  if (ch.build) chips.push(`<span class="pl-chip">build ${esc(ch.build)}</span>`);
  if (ch.tests?.present) chips.push(`<span class="pl-chip">tests ${ch.tests.passing != null ? esc(ch.tests.passing) + '/' + esc(ch.tests.count ?? '?') : 'present'}</span>`);
  if (g.dirty != null) chips.push(`<span class="pl-chip${g.dirty ? ' warn' : ''}">${esc(g.dirty)} dirty</span>`);
  if (g.ahead) chips.push(`<span class="pl-chip warn">↑${esc(g.ahead)} unpushed</span>`);
  if ((rs.secrets_found || 0) > 0) chips.push(`<span class="pl-chip bad">🔑 ${esc(rs.secrets_found)} secret${rs.secrets_found > 1 ? 's' : ''}</span>`);
  bits.push(`<div class="pl-chips">${chips.join('')}</div>`);
  if (g.last_commit_subject) bits.push(`<div class="pl-commit">“${esc(g.last_commit_subject)}”${p.activity?.days_since_commit != null ? ` <span class="pl-ago">· ${esc(p.activity.days_since_commit)}d ago</span>` : ''}</div>`);
  det.innerHTML = `<div class="pl-detwrap">${bits.join('')}</div><div class="pl-act"><button class="pl-open">OPEN DRAWER ▸</button></div>`;
  det.querySelector('.pl-open').onclick = (e) => { e.stopPropagation(); openDrawer(p, prevP, ctx.data); };
  return det;
}

// Per-project health list — worst first, click a row to expand its detail.
// Repaints locally on toggle so the fold's scroll position holds.
function pulseList(S, projById, prevProj, ctx) {
  const wrap = el('div', 'pulse-list');
  const rows = S.projects.map((p) => ({ p, st: projStatus(p) }))
    .sort((a, b) => (a.st.rank - b.st.rank) || (b.p.completion.pct - a.p.completion.pct));
  const paint = () => {
    wrap.innerHTML = '';
    rows.forEach(({ p, st }) => {
      const prev = prevProj[p.id];
      const dpc = prev ? p.completion.pct - prev.completion.pct : 0;
      const open = openPulse.has(p.id);
      const pct = Math.max(0, Math.min(100, p.completion.pct));
      const row = el('div', 'pl-row' + (open ? ' open' : ''));
      row.setAttribute('data-expand', '');
      row.style.setProperty('--dc', st.c);
      row.innerHTML = `
        <span class="pl-dot"></span>
        <span class="pl-name">${esc(p.name)}</span>
        <span class="pl-bar"><i style="width:${Math.max(3, pct)}%"></i></span>
        <span class="pl-pct">${esc(p.completion.pct)}%</span>
        <span class="pl-d">${dpc ? deltaSpan(dpc) : ''}</span>
        <span class="pl-tag">${esc(st.l)}</span>
        <span class="pl-chev">${open ? '▾' : '▸'}</span>`;
      row.onclick = () => {
        openPulse.has(p.id) ? openPulse.delete(p.id) : openPulse.add(p.id);
        sfx('blip'); paint();
      };
      wrap.appendChild(row);
      if (open) wrap.appendChild(pulseDetail(p, prev, ctx));
    });
  };
  paint();
  return wrap;
}

function render() {
  const root = rootEl, ctx = ctxRef;
  if (!root || !ctx) return;
  root.innerHTML = '';
  if (!ctx.data.selected) return;
  const { S, prev, a, projById, prevProj, isLatest } = deriveScanContext(ctx.data);
  const { LX, hq } = ctx;
  const D = ctx.data.bundle;
  const t = a.totals, pt = prev?.account.totals;
  const ov = el('section', 'realm-roundtable');
  root.appendChild(ov);

  // ---- TODAY — PICK ONE: the ONE decision surface, top of the home screen -
  // daily_top3 (quick-win / momentum / rescue) deduped against the most urgent
  // task; each card carries its own FOCUS + DONE verbs so pick→act is one
  // motion. Everything else on this realm is folded context.
  const tierRank = { red: 0, orange: 1, yellow: 2 };
  const topQ = (S.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .sort((x, y) => (tierRank[x.tier] - tierRank[y.tier]) || (y.xp - x.xp) || (y.age_days - x.age_days));
  const picks = (a.daily_top3 || []).slice(0, 3);
  const questOf = (pick) => (S.quests || []).find((q) => q.id === pick.quest_id) ||
    topQ.find((q) => q.title === pick.label || (pick.project_id && q.project_id === pick.project_id));
  // dedupe: if the single most urgent task isn't already a pick, it replaces the last card
  const covered = new Set(picks.map((p) => questOf(p)?.id).filter(Boolean));
  if (topQ[0] && !covered.has(topQ[0].id)) {
    const rq = { kind: 'red_quest', label: topQ[0].title, reason: topQ[0].insight || `+${topQ[0].xp} XP`, project_id: topQ[0].project_id, quest_id: topQ[0].id };
    picks.length >= 3 ? picks.splice(2, 1, rq) : picks.push(rq);
  }
  // header + the Tasks gateway chip (the ideas feed lives on the Tasks board)
  const feed = (S.side_quests || []);
  const urgentN = feed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length;
  const head = el('h2', 'sec', LX('today'));
  if (feed.length) {
    const chip = el('button', 'sec-chip', `${urgentN ? `⚠ ${urgentN} urgent · ` : ''}${feed.length - urgentN} ideas ▸`);
    chip.title = 'Ideas and risks moved to the Tasks board';
    chip.onclick = () => switchRealm('hunts');
    head.appendChild(chip);
  }
  ov.appendChild(head);
  if (picks.length) {
    const d3 = el('div', 'daily3');
    // Tier accent = a muted, on-palette status seam (no neon): win / momentum / rescue / at-risk.
    const km = { quick_win: { t: 'QUICK WIN', c: '#86b986' }, momentum: { t: 'MOMENTUM', c: '#74a8dc' }, rescue: { t: 'RESCUE', c: '#d98a3a' }, red_quest: { t: 'AT RISK', c: '#d9503f' } };
    picks.forEach((pick) => {
      const m = km[pick.kind] || { t: 'DO', c: '#e8a13c' };
      const q = questOf(pick);
      const c = el('div', 'd3card'); c.style.setProperty('--d3c', m.c);
      // .d3hint is a hover-only affordance: the whole card opens the project.
      c.innerHTML = `<div class="d3k">${m.t}</div><div class="d3l">${esc(pick.label)}</div><div class="d3r">${esc(pick.reason || '')}</div><div class="d3hint">${projById[pick.project_id] ? 'OPEN ▸' : 'BOARD ▸'}</div><div class="d3act"></div>`;
      c.onclick = () => { const p = projById[pick.project_id]; if (p) openDrawer(p, prevProj[pick.project_id], ctx.data); else switchRealm('hunts'); };
      const act = c.querySelector('.d3act');
      const fb = el('button', 'qbtn focus', '◎ FOCUS');
      fb.onclick = (e) => { e.stopPropagation(); enterOneThing(q || undefined); };
      act.appendChild(fb);
      if (q && hq?.markQuestDone && isLatest) {
        const dn = el('button', 'qbtn', '✓ DONE');
        dn.onclick = (e) => { e.stopPropagation(); dn.disabled = true; sfx('coin'); hq.markQuestDone(q.id); };
        act.appendChild(dn);
      }
      d3.appendChild(c);
    });
    aosKids(d3, 'zoom-in', 60);
    ov.appendChild(d3);
  }

  // The Oracle — the single live "do this now", from the tested pure brain
  // (derive.oracle) and routed through dispatch(). Flag hq-ff-oracle OFF falls
  // back to the legacy One-Thing hero (unchanged), so this is a one-flip revert.
  if (oracleFlagOn()) {
    const o = isLatest ? oracle(D, S, new Date().toISOString()) : null;
    const hero = o ? buildOracleCard(o, ctx) : buildRestCard(new Date().toISOString());
    aos(hero, 'fade-up');
    ov.appendChild(hero);
  } else {
    // legacy One-Thing hero (v2 computeOneThing truth) — kept intact behind the flag
    const otAction = (typeof computeOneThing === 'function' && isLatest) ? computeOneThing(S) : null;
    if (otAction) {
      const otc = el('div', 'onething-card');
      otc.innerHTML = `<div class="otc-eyebrow">◎ THE ONE THING · everything else can wait</div>
        <div class="otc-title">${esc(otAction.title)}</div>
        ${otAction.project_name ? `<div class="otc-proj">↳ ${esc(otAction.project_name)}</div>` : ''}
        <div class="otc-reason">${esc(otAction.reason)}</div>
        <div class="otc-actions"><button class="otc-focus">◎ FOCUS</button></div>`;
      otc.querySelector('.otc-focus').onclick = () => enterOneThing(otAction);
      aos(otc, 'fade-up');
      ov.appendChild(otc);
    }
  }

  // Suggested automation — a slim, optional bonus ribbon under the decision surface.
  const sotd = a.spellcraft?.spell_of_day;
  if (sotd && isLatest) {
    const sc = el('div', 'sotd slim');
    sc.innerHTML = `<span class="sotd-k">SUGGESTED</span>
      <span class="sotd-icon">${esc(sotd.icon || '✴️')}</span>
      <span class="sotd-name">${esc(sotd.name)}</span>
      <span class="sotd-meta">Automation · +${sotd.bonus_xp} XP</span>
      <button class="sotd-cast">Run ▸</button>`;
    sc.querySelector('.sotd-cast').onclick = () => {
      const sp = D.spellbook?.spells.find((x) => x.id === sotd.id);
      if (sp) castSpell(sp); else switchRealm('grimoire');
    };
    ov.appendChild(sc);
  }

  // MOMENTUM — a quiet 14-pt trend, demoted below the decision surface so it
  // never competes with the primary action for attention.
  const mo = momentumStrip(S);
  aos(mo, 'fade-up');
  ov.appendChild(mo);

  // ---- folded context: Overview (KPIs + per-project health) + changes ----
  const avg = S.projects.length ? Math.round(S.projects.reduce((s, p) => s + p.completion.pct, 0) / S.projects.length) : 0;
  const enriched = S.scan && S.scan.enriched === true;
  foldSec(ov, 'kpis', LX('pulse'), `${enriched ? '' : '~'}${avg}% avg · ${t.open_quests} open (${t.red_quests} red)`, (body) => {
    const kpis = el('div', 'kpis');
    const kpi = (v, l, color, d) => {
      const c = el('div', 'kpi'); c.style.setProperty('--kc', color);
      c.innerHTML = `<div class="v">${v}</div><div class="l">${l}</div>${d != null ? `<div class="d">${d}</div>` : ''}`;
      return c;
    };
    const dq = pt ? deltaSpan(t.open_quests - pt.open_quests, true) : '';
    const dr = pt ? deltaSpan(t.red_quests - pt.red_quests, true) : '';
    const pavg = prev && prev.projects.length ? Math.round(prev.projects.reduce((s, p) => s + p.completion.pct, 0) / prev.projects.length) : null;
    kpis.appendChild(kpi((enriched ? '' : '~') + avg + '%', enriched ? 'Avg completion' : 'Avg completion (est.)', COL.gold || '#f5b73d', pavg != null ? deltaSpan(avg - pavg) : ''));
    kpis.appendChild(kpi(t.open_quests, 'Open tasks', COL.orange, dq));
    kpis.appendChild(kpi(t.red_quests, 'At-risk tasks', COL.red, dr));
    kpis.appendChild(kpi(t.knowledge_xp ?? 0, 'Knowledge XP', COL.purple));
    body.appendChild(kpis);
    // per-project health — the part that fought the "monotonous" feel
    body.appendChild(el('div', 'pl-h', `PER-PROJECT HEALTH · ${S.projects.length} · tap a row for detail`));
    body.appendChild(pulseList(S, projById, prevProj, ctx));
  });

  const changes = S.changes_since_prev || [];
  foldSec(ov, 'changes', `${LX('changes')} ${esc(S.scan.previous_scan || 'baseline')}`,
    changes.length ? `${changes.length} · ${esc((changes[0]?.detail || '').slice(0, 60))}` : 'nothing moved',
    (body) => {
      if (changes.length) {
        const cf = el('div', 'changes');
        changes.forEach((c) => {
          const row = el('div', 'chg ' + (c.impact || 'neutral'));
          const proj = c.project_id ? projById[c.project_id] : null;
          row.innerHTML = `<span class="chg-ic">${esc(CHG_ICON[c.type] || '◈')}</span><span class="chg-tx">${esc(c.detail)}</span>${proj ? '<span class="chg-go">▸</span>' : ''}`;
          if (proj) { row.classList.add('clickable'); row.onclick = () => openDrawer(proj, prevProj[proj.id], ctx.data); }
          cf.appendChild(row);
        });
        body.appendChild(cf);
      } else {
        body.appendChild(el('div', 'empty-note', 'Nothing moved since the previous scan — metrics held steady.'));
      }
    });

  // Weekly recap: a short narrated summary (only meaningful "now", so latest snapshot only)
  const wr = D.weeklyRecap;
  if (wr && wr.narrative_md && isLatest) {
    ov.appendChild(el('h2', 'sec', `${LX('saga')} · ${esc(wr.week_start)} → ${esc(wr.week_end)}`));
    const saga = el('div', 'saga');
    const st = wr.stats || {};
    const oneliner = (wr.narrative_md.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim();
    saga.innerHTML = `<div class="saga-head">
        <span class="saga-line">${esc(oneliner).slice(0, 160)}</span>
        <span class="saga-stats">+${st.xp_gain ?? 0} XP · ${st.quests_completed ?? 0} tasks · ${st.achievements_unlocked ?? 0} 🏆</span>
        <button class="saga-toggle">${sagaOpen ? 'CLOSE' : 'READ'}</button>
      </div>
      <div class="saga-body" style="display:${sagaOpen ? 'block' : 'none'}">${mdLite(wr.narrative_md)}</div>`;
    saga.querySelector('.saga-toggle').onclick = (e) => {
      const b = saga.querySelector('.saga-body');
      const open = b.style.display !== 'none';
      b.style.display = open ? 'none' : 'block';
      sagaOpen = !open;                          // survive the next data:select rebuild
      e.target.textContent = open ? 'READ' : 'CLOSE';
      sfx('blip');
    };
    aos(saga, 'fade-up');
    ov.appendChild(saga);
  }

  aosRefresh();
}

export const view = {
  mount(root, ctx) {
    rootEl = root; ctxRef = ctx;
    ensureFocusOverlay();          // global mode: overlay + F key outlive this realm
    offData = ctx.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offData) { offData(); offData = null; }
    rootEl = null; ctxRef = null;
  },
};
