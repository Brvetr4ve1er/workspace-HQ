// HOME — the default landing surface, and the v4.2 STYLE REFERENCE every other
// surface will be revised to match.
//
// It is the v3 decision surface reborn (dashboard-v3/src/realms/roundtable),
// held to the v4 design constitution:
//
//   THE ORACLE      the one focal element — derive.oracle()'s "do this now"
//   TODAY           up to three cards from account.daily_top3; they RECEDE
//   MOMENTUM        a quiet 14-point trend with a HEALTH/XP toggle
//
// CONSTITUTION COMPLIANCE, stated so a later editor knows what not to break:
// - ONE focal element. `.oracle` is the only display-weight title and the only
//   panel carrying glow + scanline. Nothing else may grow to compete with it.
// - VIOLET BUDGET: exactly TWO violet accents — the hero's edge glow and the
//   hero's primary button. Every other colour on this screen is either neutral
//   or a muted status seam. Do not add a third.
// - BORDER DIET: no passive container is outlined. Sections separate by a
//   background step (--hud-panel over --hud-ink) plus --space-7 of air. The
//   only border on a card is its 2px status seam on the accent edge.
// - MIXED CASE: every sentence and every title is prose. ALL-CAPS + mono is a
//   label register only — eyebrows, the kind chips, the metric toggle, the
//   stat caption under the sparkline.
//
// LIFECYCLE CONTRACT (the reference implementation is work/view.js): everything
// created in mount() is released in unmount(). `gen` is bumped by BOTH mount and
// unmount so any continuation that resolves post-teardown touches nothing. Every
// element handler is a property assignment on a node this surface created, so a
// re-render drops the handler with the node — there are no timers and no global
// listeners here at all.
import { el, esc, fmt } from '../../ui/util.js';
import { oracle } from '../../intel/derive.mjs';
import { dispatch, resolve } from '../../core/actions.mjs';
import { oracleActionId, oracleButtonMeta, sentence, restCopy } from './oracle-logic.mjs';

// STYLESHEET. index.html is not in this agent's ownership, so the surface links
// its own sheet on first mount (same pattern as system/ and lookback/). Resolved
// from import.meta.url — not the document URL — so it is correct under the
// verify harness too. Idempotent, tolerates a later static <link>, and never
// torn down: it is one <head> node, and removing it per surface switch would
// flash the surface unstyled.
const CSS_HREF = new URL('../../../styles/home.css', import.meta.url).href;
function ensureStyles() {
  if (document.querySelector('link[data-home-css], link[href$="home.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.setAttribute('data-home-css', '');
  document.head.appendChild(link);
}

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

// Module scope on purpose (v3 parity): which series the momentum strip is
// showing survives a local repaint, a `data:select` re-render AND a full
// surface re-mount. A trend that snapped back to HEALTH every time the shell
// blinked would be its own small lie about what you are looking at.
let momentumMetric = 'health_index';

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[home] teardown', err); }
  }
}

// ---------------------------------------------------------------- constants
// Muted, on-palette status seams carried from v3's daily-3 so the screen stays
// FAMILIAR. These are module constants, never scan data, so inlining them into
// a style property / SVG attribute is safe.
const KIND = {
  quick_win: { key: 'QUICK WIN', seam: '#86b986' },
  momentum:  { key: 'MOMENTUM',  seam: '#74a8dc' },
  rescue:    { key: 'RESCUE',    seam: '#d98a3a' },
};
const KIND_FALLBACK = { key: 'TODAY', seam: '#6b6390' };

const SERIES = {
  health_index: { key: 'HEALTH', color: '#74a8dc', fmt: (v) => String(Math.round(v)) },
  xp:           { key: 'XP',     color: '#e8a13c', fmt: (v) => fmt(v) },
};

// ---------------------------------------------------------------- sparkline
// Compact inline sparkline, no axes — geometry ported from v3's roundtable
// strip. The end point is "now" and is a STATIC dot: v3 pulsed it forever, and
// the constitution allows motion only on real state changes. `color` is one of
// the SERIES constants above, never data, so it is safe unescaped.
function sparkSvg(pts, color) {
  const W = 800, H = 64, pad = 6;
  if (!pts.length) return '';
  const vs = pts.map((p) => p.v);
  const max = Math.max(...vs), min = Math.min(...vs), span = max - min;
  const n = pts.length;
  const sx = (i) => pad + (n === 1 ? (W - pad * 2) / 2 : (i * (W - pad * 2)) / (n - 1));
  // A perfectly flat series (health parked at one value for a fortnight — real,
  // and what the live data currently looks like) has no range to normalize
  // against. v3 divided by a fallback of 1, which pinned the line to the very
  // BOTTOM of the box and read as "you are at rock bottom". A flat run is
  // neither high nor low, so it draws down the middle.
  const sy = (v) => (span ? H - pad - ((v - min) / span) * (H - pad * 2) : H / 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
  const lx = sx(n - 1).toFixed(1), ly = sy(pts[n - 1].v).toFixed(1);
  const area = n > 1 ? `${d} L${lx},${H - pad} L${sx(0).toFixed(1)},${H - pad} Z` : '';
  return `<svg class="mo-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${area ? `<path d="${area}" fill="${color}" opacity="0.10"/>` : ''}
      ${n > 1 ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      <circle cx="${lx}" cy="${ly}" r="3.2" fill="${color}"/>
    </svg>`;
}

// ------------------------------------------------------------- oracle hero
// The ONE focal element. Three states, all calm: a live recommendation, the
// rest state, and "you are reading an old photograph".
function buildHero(o, isLatest, nowIso, ctx) {
  if (!isLatest) {
    // v4's scrubber is real, so this state is reachable. The Oracle reads the
    // present tense; on an old snapshot it would be advising about a world that
    // has already moved. One sentence, no panel, no button.
    const past = el('section', 'oracle oracle--rest');
    past.innerHTML = `<div class="oracle-eyebrow">EARLIER SNAPSHOT</div>
      <p class="oracle-quiet">You are reading an older scan. The Oracle only advises on the latest one.</p>`;
    return past;
  }
  if (!o) {
    const c = restCopy(nowIso);
    const rest = el('section', 'oracle oracle--rest');
    rest.innerHTML = `<div class="oracle-eyebrow">${esc(c.eyebrow)}</div>
      <p class="oracle-quiet">${esc(c.line)}</p>`;
    return rest;
  }

  const meta = oracleButtonMeta(o);
  const id = oracleActionId(o);
  const hero = el('section', 'oracle');
  hero.dataset.action = o.action || '';
  hero.innerHTML = `
    <div class="oracle-eyebrow">DO THIS NOW</div>
    <h1 class="oracle-label">${esc(o.label || '')}</h1>
    <p class="oracle-reason">${esc(sentence(o.reason))}</p>
    <div class="oracle-act"></div>`;

  const btn = el('button', 'btn btn--primary oracle-go', `${esc(meta.icon)} ${esc(meta.label)}`);
  btn.type = 'button';
  // The app's standing rule: a real action, or disabled WITH A REASON. boot.js
  // seeds the registry before the first mount, so this is belt-and-braces — but
  // a button that silently dispatches into nothing is exactly the kind of lie
  // the rule exists to stop.
  if (!resolve(id)) {
    btn.disabled = true;
    btn.title = `No action registered for "${id}" in this build.`;
  } else {
    btn.onclick = () => dispatch(id, ctx);
  }
  hero.querySelector('.oracle-act').appendChild(btn);
  return hero;
}

// ------------------------------------------------------------ today: pick one
// Straight from `account.daily_top3` — no re-ranking, no injected red quest.
// The Oracle above already carries the single most urgent thing; a second
// ranking here would just argue with it.
function buildToday(S, ctx, isLatest) {
  const sec = el('section', 'home-sec');
  sec.appendChild(el('h2', 'home-key', 'TODAY — PICK ONE'));

  const picks = (S.account?.daily_top3 || []).slice(0, 3);
  if (!picks.length) {
    sec.appendChild(el('p', 'home-quiet', 'Nothing queued for today. The one thing above is the whole list.'));
    return { el: sec, count: 0 };
  }

  const projectIds = new Set((S.projects || []).map((p) => p.id));
  const grid = el('div', 'picks');
  for (const pick of picks) {
    const k = KIND[pick.kind] || KIND_FALLBACK;
    // A pick that names a project we actually hold opens the shelf; anything
    // else opens the queue. The verb names the room it opens, because that is
    // all a `go:*` action does today.
    const toProjects = !!pick.project_id && projectIds.has(pick.project_id);
    const goId = toProjects ? 'go:projects' : 'go:work';

    const card = el('article', 'pick');
    card.style.setProperty('--seam', k.seam);
    card.innerHTML = `
      <div class="pick-kind">${esc(k.key)}</div>
      <h3 class="pick-title"><button class="pick-open" type="button">${esc(pick.label || 'Untitled')}</button></h3>
      <p class="pick-why">${esc(sentence(pick.reason))}</p>
      <div class="pick-act"></div>`;

    const open = card.querySelector('.pick-open');
    open.title = toProjects ? 'Open the Projects shelf' : 'Open the Work queue';
    open.onclick = () => dispatch(goId, ctx);

    // DONE only where the underlying method exists AND the snapshot is the live
    // one — completing a quest from an old photograph would write today's log
    // from yesterday's belief. Where either is missing the verb is OMITTED, not
    // shown disabled: this card is meant to recede, and an inert control on
    // every card would be three pieces of dead chrome.
    if (isLatest && pick.quest_id && typeof ctx.hq?.markQuestDone === 'function') {
      const done = el('button', 'pick-done', 'Mark done');
      done.type = 'button';
      done.onclick = () => {
        done.disabled = true;
        done.textContent = 'Marked done';
        dispatch('quest:done', { ...ctx, questId: pick.quest_id });
      };
      card.querySelector('.pick-act').appendChild(done);
    }
    grid.appendChild(card);
  }
  sec.appendChild(grid);
  return { el: sec, count: picks.length };
}

// ------------------------------------------------------------------ momentum
// The quiet one. Repaints IN PLACE on toggle so the section never jumps, and
// carries the only other display-weight number on the screen — deliberately
// neutral-coloured and unglowing, so it reads as second, not as a rival focal.
function buildMomentum(S) {
  const strip = el('section', 'momentum');
  const streak = S.account?.streak?.scan_days;

  const paint = () => {
    const meta = SERIES[momentumMetric] || SERIES.health_index;
    const pts = ((S.trends && S.trends[momentumMetric]) || []).slice(-14);
    const cur = pts.length
      ? pts[pts.length - 1].v
      : (momentumMetric === 'xp' ? (S.account?.xp ?? 0) : (S.account?.health_index ?? 0));
    const delta = pts.length > 1 ? cur - pts[0].v : 0;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    // "· 0" is not a reading — it is punctuation pretending to be one. A flat
    // fortnight says so in words.
    const move = dir === 'flat' ? 'no change' : `${dir === 'up' ? '▲' : '▼'} ${fmt(Math.abs(delta))}`;
    const range = pts.length > 1
      ? `${esc(pts[0].d.slice(5))} → ${esc(pts[pts.length - 1].d.slice(5))}`
      : (pts[0] ? esc(pts[0].d.slice(5)) : 'no samples yet');

    strip.innerHTML = `
      <div class="mo-head">
        <h2 class="home-key">MOMENTUM · LAST 14 SCANS</h2>
        <div class="mo-tabs" role="group" aria-label="Momentum series"></div>
      </div>
      <div class="mo-spark">${sparkSvg(pts, meta.color)}</div>
      <div class="mo-read">
        <span class="mo-val">${esc(meta.fmt(cur))}</span>
        <span class="mo-delta" data-dir="${dir}">${esc(move)}</span>
        <span class="mo-range">${range}${streak ? ` · ${esc(streak)} scan day${streak === 1 ? '' : 's'}` : ''}</span>
      </div>`;

    const tabs = strip.querySelector('.mo-tabs');
    for (const [id, s] of Object.entries(SERIES)) {
      const on = id === momentumMetric;
      const b = el('button', 'mo-tab' + (on ? ' on' : ''), esc(s.key));
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.onclick = () => { if (id !== momentumMetric) { momentumMetric = id; paint(); } };
      tabs.appendChild(b);
    }
  };

  paint();
  return strip;
}

// ---------------------------------------------------------------------- view
export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // a mount without a prior unmount still starts clean
    ensureStyles();

    const root = el('div', 'home');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    const render = () => {
      root.innerHTML = '';
      const S = ctx.data.selected;      // re-read EVERY render — scrub-safe
      if (!S) {
        // No photograph, no decision. One calm sentence, no controls: every
        // verb on this screen needs a scan to point at.
        root.appendChild(el('p', 'home-quiet home-quiet--only',
          'No scan data in this build yet. Run a scan and this screen will tell you what to do first.'));
        return { hero: 'none', picks: 0, label: '' };
      }
      const isLatest = ctx.data.isLatest;
      const nowIso = new Date().toISOString();
      // The pure brain decides; this file only renders what it says.
      const o = isLatest ? oracle(ctx.data.bundle, S, nowIso) : null;

      root.appendChild(buildHero(o, isLatest, nowIso, ctx));
      const today = buildToday(S, ctx, isLatest);
      root.appendChild(today.el);
      root.appendChild(buildMomentum(S));

      return { hero: o ? (o.action || 'unknown') : (isLatest ? 'rest' : 'past'), picks: today.count, label: o?.label || '' };
    };

    const stats = render();

    // Scrubbing the time machine re-renders from the newly selected snapshot.
    // (The v4.1 shell additionally full-re-mounts on data:select per the
    // recorded b1d4d9c boundary — this handler keeps the surface honest even
    // where only the bus event arrives.) Idempotent, so the redundant paint
    // during a re-mount costs one repaint on already-correct data.
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) render(); }));

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d —
    // this is console text, not DOM; the oracle label is JSON-quoted so a
    // project name with spaces cannot break the field split.
    console.log(`HOME mounted hero=${stats.hero} picks=${stats.picks} label=${JSON.stringify(stats.label)} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();
  },
};
