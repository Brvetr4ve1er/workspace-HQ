// v4 shell — renders the 6-surface rail + the topstrip chrome, owns surface
// switching (mount/unmount + rail active state), and answers `data:select`
// with a full surface re-mount.
//
// The topstrip carries three things, left to right:
//   brand · WARDEN PLATE (LV · XP · HEALTH · STREAK) · SNAPSHOT SCRUBBER
//
// WARDEN PLATE — the game layer. Ported from v3 chrome.js `paintWarden()`
// (itself v2's topbar player card): same fields, same thresholds, same "max"
// case, rebuilt in the System-HUD idiom with display-weight numerals. It reads
// `data.selected.account`, so it describes the SELECTED photograph, not
// always the newest one — which is why it repaints from the same handler that
// drives the scrubber.
//
// CHROME LIFECYCLE: rail + topstrip are app-lifetime — built once in
// startShell(), then PAINTED (textContent / class / disabled) on every
// `data:select`. They are deliberately not innerHTML-rebuilt per event: the
// scrubber invites rapid prev-clicks, and re-creating the strip would destroy
// the button under the cursor and drop keyboard focus on every click.
//
// XSS: nothing scan-derived is ever interpolated into innerHTML in this file.
// The strip's skeleton is a static literal; every value from a scan is written
// with textContent or assigned to `.title`, both of which are strictly
// stronger than esc() (the string is never parsed as markup at all). esc()
// remains in use for the rail, whose labels/glyphs go through innerHTML.
import { bus } from './bus.js';
import { data } from './data.js';
import { createScrubber } from './scrubber.js';
import { el, esc, fmt } from '../ui/util.js';

let registry = [];
let activeId = null;
let scrubber = null;
let warden = null;          // { el, refs..., paint }
let lastShown = null;       // {health} from the previous paint — for the HP drop pulse

function ctx() {
  return { data, bus, hq: window.hq };
}

export function surfaces() {
  return registry;
}

export function activeSurface() {
  return activeId;
}

export function switchSurface(id, force = false) {
  if (id === activeId && !force) return;
  const next = registry.find((s) => s.id === id);
  if (!next) return;
  const stage = document.getElementById('stage');
  const prev = registry.find((s) => s.id === activeId);
  if (prev) { try { prev.view.unmount(); } catch (err) { console.error('[shell] unmount', activeId, err); } }
  stage.innerHTML = '';
  activeId = id;
  try { sessionStorage.setItem('hq-v4-surface', id); } catch {}   // survive win.reload()
  next.view.mount(stage, ctx());
  document.querySelectorAll('#rail .rail-btn').forEach((b) => {
    const on = b.dataset.surface === id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  bus.emit('surface:switched', { id });
}

function renderRail() {
  const rail = document.getElementById('rail');
  rail.innerHTML = '';
  for (const s of registry) {
    // glyph is decorative (the .lbl carries the name) — hidden from AT so the
    // button reads as its surface label, not "<glyph> LABEL".
    const b = el('button', 'rail-btn', `<span class="glyph" aria-hidden="true">${esc(s.glyph)}</span><span class="lbl">${esc(s.label)}</span>`);
    b.dataset.surface = s.id;
    b.title = s.label;
    b.onclick = () => switchSurface(s.id);
    const on = s.id === activeId;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    rail.appendChild(b);
  }
}

// ------------------------------------------------------------ warden plate
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const clamp01 = (x) => Math.max(0, Math.min(100, x));

function createWarden() {
  const root = el('div', 'warden');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Account status');
  // Static skeleton, no interpolation — see the XSS note at the top of the file.
  root.innerHTML = `
    <div class="wp-cell wp-lv">
      <span class="wp-key">LV</span>
      <span class="wp-num wp-num--big" data-w="level">—</span>
      <span class="wp-rank" data-w="rank"></span>
    </div>
    <div class="wp-cell wp-gauge">
      <div class="wp-row">
        <span class="wp-key">XP</span>
        <span class="wp-num" data-w="xp">—</span>
        <span class="wp-sub" data-w="xpnext"></span>
      </div>
      <div class="wp-bar"><i class="wp-fill wp-fill--xp" data-w="xpfill"></i></div>
    </div>
    <div class="wp-cell wp-gauge">
      <div class="wp-row">
        <span class="wp-key">HEALTH</span>
        <span class="wp-num" data-w="health">—</span>
        <span class="wp-sub" data-w="healthword"></span>
      </div>
      <div class="wp-bar"><i class="wp-fill wp-fill--hp" data-w="hpfill"></i></div>
    </div>
    <div class="wp-cell wp-streak">
      <span class="wp-key">STREAK</span>
      <span class="wp-num" data-w="streak">—</span>
      <span class="wp-sub" data-w="streakword"></span>
    </div>`;

  const w = {};
  for (const n of root.querySelectorAll('[data-w]')) w[n.dataset.w] = n;

  function paint() {
    const S = data.selected;
    if (!S) {
      // No photograph, no player card. Hiding beats printing zeros that would
      // read as "you have 0 XP" rather than "there is no scan".
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const a = S.account || {};
    const level = num(a.level);
    const into = num(a.xp_into_level);
    const toNext = num(a.xp_to_next);
    const health = num(a.health_index);
    const streak = num(a.streak?.scan_days);

    w.level.textContent = String(level);
    // Scan-derived: textContent, never parsed. shell.css caps the rank at a
    // fixed measure and ellipsises the overflow so a long title can never push
    // its box out of the LV cell and across the XP gauge (the collision this
    // plate shipped with once); `.title` keeps the full string reachable, so
    // the truncation hides nothing.
    const rank = String(a.title ?? '');
    w.rank.textContent = rank;
    w.rank.title = rank;

    w.xp.textContent = fmt(num(a.xp));
    // v3 parity: a falsy xp_to_next means the level curve is topped out.
    w.xpnext.textContent = toNext ? `${fmt(toNext)} to L${level + 1}` : 'max';
    const xpPct = toNext ? (into / (into + toNext)) * 100 : 100;
    w.xpfill.style.width = clamp01(xpPct).toFixed(1) + '%';
    w.xpfill.parentElement.title = toNext
      ? `${fmt(into)} of ${fmt(into + toNext)} xp into level ${level}`
      : `Level ${level} — no further level defined by this scan.`;

    w.health.textContent = String(health);
    // v3 thresholds, unchanged: <40 critical, 40–69 warn, 70+ nominal.
    const band = health < 40 ? 'crit' : health < 70 ? 'warn' : 'ok';
    w.health.dataset.band = band;
    w.healthword.textContent = band === 'crit' ? 'critical' : band === 'warn' ? 'strained' : 'nominal';
    w.hpfill.dataset.band = band;
    w.hpfill.style.width = clamp01(health) + '%';
    w.hpfill.parentElement.title = `Workspace health index ${health}/100 for this snapshot.`;
    // Motion ONLY on a real state change: the bar flashes when health actually
    // fell since the last thing this plate showed (scrub or reload), never on
    // an idle repaint. base.css disables it under prefers-reduced-motion.
    if (lastShown && health < lastShown.health) {
      w.hpfill.classList.remove('drop');
      void w.hpfill.offsetWidth;                       // restart the animation
      w.hpfill.classList.add('drop');
    }

    w.streak.textContent = String(streak);
    w.streakword.textContent = streak === 1 ? 'scan day' : 'scan days';
    const longest = num(a.streak?.longest_scan_days);
    root.querySelector('.wp-streak').title = longest
      ? `${streak} consecutive scan days · longest run ${longest}`
      : `${streak} consecutive scan days`;

    lastShown = { health };
  }

  paint();
  return { el: root, paint };
}

// --------------------------------------------------------------- topstrip
// Built once; painted thereafter. `data-past` turns "you are reading an old
// photograph" into a MODE the whole strip carries, not a detail in one chip.
function buildTopstrip() {
  const top = document.getElementById('topstrip');
  top.innerHTML = '';
  top.appendChild(el('div', 'brand', 'WORKSPACE<span class="hq">HQ</span> v4'));
  warden = createWarden();
  top.appendChild(warden.el);
  // NO spacer element between the plate and the scrubber any more. The strip
  // wraps at narrow widths (see shell.css), and a `flex: 1 1 auto` spacer would
  // sit at the end of the FIRST line, stranding the scrubber at the left edge
  // of the second. `.scrub { margin-left: auto }` pushes it right on whichever
  // line it lands on, which is the same result on one line and the correct one
  // on two.
  scrubber = createScrubber();
  top.appendChild(scrubber.el);
}

function paintTopstrip() {
  const top = document.getElementById('topstrip');
  if (top) top.dataset.past = data.selected && !data.isLatest ? 'yes' : 'no';
  warden?.paint();
  scrubber?.paint();
}

export function startShell(surfaceList, defaultId) {
  registry = surfaceList;
  buildTopstrip();
  paintTopstrip();
  renderRail();

  // ---- the data:select boundary (recorded at b1d4d9c) -------------------
  // A scrub is a FULL surface re-mount, never a partial refresh: surfaces are
  // built assuming re-mount, and several of them close over their mount-time
  // scan (WORK's agent project list and truth rail, PROJECTS' drawer metrics),
  // so anything less leaves part of the room describing a different photograph
  // than the stamp above it.
  //
  // Synchronous on purpose. Set iteration during emit means the surface's OWN
  // `data:select` handler — registered at mount, deleted by unmount() here
  // before forEach reaches it — never runs for this event, while the FRESH
  // mount's handler, added during the same emit, is visited once. Every
  // surface's handler is an idempotent `if (alive()) repaint()`, so that costs
  // exactly one redundant paint on already-correct data and nothing else.
  bus.on('data:select', () => {
    paintTopstrip();
    if (activeId) switchSurface(activeId, true);
  });

  switchSurface(defaultId);
}
