// ROUNDTABLE — the HOME half of v2 renderOverview (dashboard/app.js ~739-890):
// Today's picks, One-Thing hero, Spell-of-the-Day ribbon, Pulse + Changes
// folds, Weekly Saga. Products grid + renderBrowserFocus belong to the forge
// realm. v2's activateTab('quests'/'spellbook') becomes switchRealm('hunts'/
// 'grimoire'); v2's closure globals (SCANS/cur/D) arrive via ctx.data.
import { el, esc, mdLite, COL } from '../../ui/util.js';
import {
  sfx, aos, aosKids, aosRefresh, deriveScanContext, deltaSpan, foldSec,
  SCHOOL, openDrawer, castSpell,
} from '../../ui/components.js';
import { switchRealm } from '../../core/shell.js';
import { computeOneThing } from './one-thing.js';
import { ensureFocusOverlay, enterOneThing } from './focus.js';

let rootEl = null, ctxRef = null, offData = null;

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

  // ---- TODAY'S RUN: the ONE decision surface on BASE --------------------
  // daily_top3 (quick-win / momentum / rescue) deduped against the top red
  // quest; each card carries its own FOCUS + DONE verbs so pick→act is one
  // motion. Everything else on this realm is folded context.
  const tierRank = { red: 0, orange: 1, yellow: 2 };
  const topQ = (S.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .sort((x, y) => (tierRank[x.tier] - tierRank[y.tier]) || (y.xp - x.xp) || (y.age_days - x.age_days));
  const picks = (a.daily_top3 || []).slice(0, 3);
  const questOf = (pick) => (S.quests || []).find((q) => q.id === pick.quest_id) ||
    topQ.find((q) => q.title === pick.label || (pick.project_id && q.project_id === pick.project_id));
  // dedupe: if the single most urgent quest isn't already a pick, it replaces the last card
  const covered = new Set(picks.map((p) => questOf(p)?.id).filter(Boolean));
  if (topQ[0] && !covered.has(topQ[0].id)) {
    const rq = { kind: 'red_quest', label: topQ[0].title, reason: topQ[0].insight || `+${topQ[0].xp} XP`, project_id: topQ[0].project_id, quest_id: topQ[0].id };
    picks.length >= 3 ? picks.splice(2, 1, rq) : picks.push(rq);
  }
  // header + the QUESTS gateway chip (the ideas feed lives on the hunts board)
  const feed = (S.side_quests || []);
  const urgentN = feed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length;
  const head = el('h2', 'sec', LX('today'));
  if (feed.length) {
    const chip = el('button', 'sec-chip', `${urgentN ? `⚠ ${urgentN} urgent · ` : ''}${feed.length - urgentN} ideas ▸`);
    chip.title = 'Side-quests moved to the QUESTS board';
    chip.onclick = () => switchRealm('hunts');
    head.appendChild(chip);
  }
  ov.appendChild(head);
  if (picks.length) {
    const d3 = el('div', 'daily3');
    const km = { quick_win: { t: '5-MIN WIN', c: COL.green }, momentum: { t: 'MOMENTUM', c: COL.cyan }, rescue: { t: 'RESCUE', c: COL.orange }, red_quest: { t: 'RED QUEST', c: COL.red } };
    picks.forEach((pick) => {
      const m = km[pick.kind] || { t: 'DO', c: COL.gold };
      const q = questOf(pick);
      const c = el('div', 'd3card'); c.style.setProperty('--d3c', m.c);
      c.innerHTML = `<div class="d3k">${m.t}</div><div class="d3l">${esc(pick.label)}</div><div class="d3r">${esc(pick.reason || '')}</div><div class="d3act"></div>`;
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

  // The One Thing: the single highest-leverage move, one click from focus.
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

  // Spell of the Day rides inside the TODAY module as a slim bonus ribbon
  const sotd = a.spellcraft?.spell_of_day;
  if (sotd && isLatest) {
    const sch = SCHOOL[sotd.school] || SCHOOL.evocation;
    const sc = el('div', 'sotd slim');
    sc.style.setProperty('--sch', sch.c);
    sc.innerHTML = `<span class="sotd-k">🃏 BONUS</span>
      <span class="sotd-icon">${esc(sotd.icon || '✴️')}</span>
      <span class="sotd-name">${esc(sotd.name)}</span>
      <span class="sotd-meta">${sch.label} · +${sotd.bonus_xp} XP</span>
      <button class="sotd-cast">⚡ CAST</button>`;
    sc.querySelector('.sotd-cast').onclick = () => {
      const sp = D.spellbook?.spells.find((x) => x.id === sotd.id);
      if (sp) castSpell(sp); else switchRealm('grimoire');
    };
    ov.appendChild(sc);
  }

  // ---- folded context: pulse (KPIs) + changes — quiet until asked -------
  const avg = Math.round(S.projects.reduce((s, p) => s + p.completion.pct, 0) / S.projects.length);
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
    const pavg = prev ? Math.round(prev.projects.reduce((s, p) => s + p.completion.pct, 0) / prev.projects.length) : null;
    kpis.appendChild(kpi((enriched ? '' : '~') + avg + '%', enriched ? 'Avg completion' : 'Avg completion (est.)', COL.gold || '#f5b73d', pavg != null ? deltaSpan(avg - pavg) : ''));
    kpis.appendChild(kpi(t.open_quests, 'Open quests', COL.orange, dq));
    kpis.appendChild(kpi(t.red_quests, 'Red quests', COL.red, dr));
    kpis.appendChild(kpi(t.knowledge_xp ?? 0, 'Knowledge XP', COL.purple));
    body.appendChild(kpis);
  });

  const changes = S.changes_since_prev || [];
  foldSec(ov, 'changes', `${LX('changes')} ${esc(S.scan.previous_scan || 'baseline')}`,
    changes.length ? `${changes.length} · ${esc((changes[0]?.detail || '').slice(0, 60))}` : 'nothing moved',
    (body) => {
      if (changes.length) {
        const cf = el('div', 'changes');
        changes.forEach((c) => cf.appendChild(el('div', 'chg ' + (c.impact || 'neutral'), esc(c.detail))));
        body.appendChild(cf);
      } else {
        body.appendChild(el('div', 'empty-note', 'Nothing moved since the previous scan — metrics held steady.'));
      }
    });

  // Weekly Saga: narrator recap (only meaningful "now", so latest snapshot only)
  const wr = D.weeklyRecap;
  if (wr && wr.narrative_md && isLatest) {
    ov.appendChild(el('h2', 'sec', `${LX('saga')} · ${esc(wr.week_start)} → ${esc(wr.week_end)}`));
    const saga = el('div', 'saga');
    const st = wr.stats || {};
    const oneliner = (wr.narrative_md.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim();
    saga.innerHTML = `<div class="saga-head">
        <span class="saga-line">${esc(oneliner).slice(0, 160)}</span>
        <span class="saga-stats">+${st.xp_gain ?? 0} XP · ${st.quests_completed ?? 0} quests · ${st.achievements_unlocked ?? 0} 🏆</span>
        <button class="saga-toggle">READ</button>
      </div>
      <div class="saga-body" style="display:none">${mdLite(wr.narrative_md)}</div>`;
    saga.querySelector('.saga-toggle').onclick = (e) => {
      const b = saga.querySelector('.saga-body');
      const open = b.style.display !== 'none';
      b.style.display = open ? 'none' : 'block';
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
