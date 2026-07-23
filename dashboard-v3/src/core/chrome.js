// NEXUS chrome — boot splash, CRT layer, Memory-of-Grace scrubber, Warden
// plate, SYS menu, statusbar, FOCUS chip. Ported from dashboard/app.js
// (~110-376 + render()'s topbar/status block). Chrome is app-lifetime: unlike
// realms it never unmounts, so subscriptions here are intentionally undisposed.
import { bus } from './bus.js';
import { data } from './data.js';
import { LX } from './lexicon.js';
import { applyTheme } from './themes.js';
import { el, esc } from '../ui/util.js';
import { sfx, countUp, deltaSpan, closeDrawer } from '../ui/components.js';

const $ = (id) => document.getElementById(id);

let lastShown = null;   // {xp, health, level} from the prior paint, for juice tweens

// ---- boot splash: CRT power-on, once per session, skippable ------------
function bootSplash() {
  const b = $('boot'); if (!b) return;
  if (sessionStorage.getItem('hq-booted')) { b.hidden = true; return; }
  const off = () => {
    if (b.hidden) return;
    b.classList.add('off');
    setTimeout(() => { b.hidden = true; }, 500);
    sessionStorage.setItem('hq-booted', '1');
    document.removeEventListener('keydown', off);
  };
  b.addEventListener('click', off);
  document.addEventListener('keydown', off);
  setTimeout(off, 2400);
}

// ---- SYS menu: theme rows apply, tool rows emit for the fx agent -------
function wireSysMenu() {
  const btn = $('theme-btn');
  const menu = $('theme-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open'); });
  // [data-theme] only — the EXPORT CARD / SFX rows share the class but are
  // NOT themes (clicking them used to silently reset the theme to arcade)
  menu.querySelectorAll('.theme-opt[data-theme]').forEach((o) => o.addEventListener('click', (e) => {
    e.stopPropagation();
    applyTheme(o.dataset.theme);   // theme:changed re-mounts the realm — v2's rerender:true
    menu.classList.remove('open');
  }));
  const sc = $('share-card'); if (sc) sc.onclick = () => bus.emit('fx:export-card');
  const st = $('sfx-toggle'); if (st) st.onclick = () => bus.emit('fx:sfx-toggle');
}

function paintSysActive() {
  const id = document.documentElement.getAttribute('data-theme') || 'arcade';
  document.querySelectorAll('.theme-opt[data-theme]').forEach((o) => o.classList.toggle('active', o.dataset.theme === id));
}

// ---- FOCUS chip: charter places it at the rail bottom. renderRail wipes
// #rail-left on theme change, so mounting is idempotent and re-run then.
function mountFocusChip() {
  const rail = $('rail-left'); if (!rail) return;
  let b = $('tab-focus');
  if (!b) {
    b = el('button', 'tab-focus');
    b.id = 'tab-focus';
    b.title = 'One-Thing focus mode (F)';
    b.onclick = () => bus.emit('focus:toggle');
  }
  b.textContent = LX('focus');
  rail.appendChild(b);
}

function select(i) {
  if (i === data.selectedIndex) return;
  sfx('move');
  data.select(i);   // realms repaint via 'data:select'; chrome does too
}

// =========================================================== time machine
function buildTimeMachine() {
  const SCANS = data.scans;
  const dots = $('tm-dots'); dots.innerHTML = '';
  const n = SCANS.length, padL = 4, padR = 4;
  const xAt = (i) => n === 1 ? 50 : padL + (i * (100 - padL - padR)) / (n - 1);
  // ambient health sparkline through the snapshot points
  const hs = SCANS.map((s) => s.account.health_index);
  const lo = Math.min(...hs), hi = Math.max(...hs), span = (hi - lo) || 1;
  const yAt = (v) => 78 - ((v - lo) / span) * 52;   // viewBox 0..100 x 0..100 (rail is short)
  const pts = SCANS.map((s, i) => `${xAt(i)},${yAt(s.account.health_index)}`).join(' ');
  $('tm-spark').setAttribute('viewBox', '0 0 100 100');
  $('tm-spark').setAttribute('preserveAspectRatio', 'none');
  $('tm-spark').innerHTML =
    `<polyline points="${pts}" fill="none" stroke="#322a5e" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
  // Sparse labels: with 30+ snapshots the dates collide — label only every Nth dot
  // (plus the newest); every dot still carries a hover title and stays clickable.
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  SCANS.forEach((s, i) => {
    const dot = el('div', 'tm-dot');
    dot.style.left = xAt(i) + '%';
    const showLbl = i === n - 1 || i % labelEvery === 0;
    dot.innerHTML = `<i></i>${showLbl ? `<span>${esc(s.scan.id.slice(5))}</span>` : ''}`;
    dot.onclick = () => select(i);
    dot.title = `${s.scan.id} · health ${s.account.health_index} · L${s.account.level} · ${s.account.totals.open_quests} open`;
    dots.appendChild(dot);
  });
  $('tm-prev').onclick = () => select(data.selectedIndex - 1);
  $('tm-next').onclick = () => select(data.selectedIndex + 1);
  // rail fold: persisted, and paintTimeMachine force-opens it while off-live
  const tm = $('timemachine');
  tm.classList.toggle('collapsed', localStorage.getItem('hq-tm-open') !== '1');
  $('tm-toggle').onclick = () => {
    const open = tm.classList.toggle('collapsed') === false;
    localStorage.setItem('hq-tm-open', open ? '1' : '0');
    $('tm-toggle').textContent = (open ? '▾' : '▸') + ' ' + LX('stage');
    sfx('blip');
  };
  $('tm-toggle').textContent = (tm.classList.contains('collapsed') ? '▸' : '▾') + ' ' + LX('stage');
  $('tm-live').onclick = () => select(data.scans.length - 1);
}

function paintTimeMachine() {
  const SCANS = data.scans, cur = data.selectedIndex;
  [...$('tm-dots').children].forEach((d, i) => d.classList.toggle('active', i === cur));
  $('tm-prev').disabled = cur === 0;
  $('tm-next').disabled = cur === SCANS.length - 1;
  const S = SCANS[cur], prev = SCANS[cur - 1];
  $('tm-date').textContent = S.scan.id;
  const live = $('tm-badge'), isLatest = cur === SCANS.length - 1;
  live.textContent = isLatest ? 'latest' : 'past snapshot';
  live.classList.toggle('past', !isLatest);
  // Off-live is a MODE, not a detail: rail unfolds + BACK TO LIVE appears so
  // "why are all my buttons gone" can never be a mystery again.
  $('tm-live').style.display = isLatest ? 'none' : '';
  if (!isLatest) { $('timemachine').classList.remove('collapsed'); $('tm-toggle').textContent = '▾ ' + LX('stage'); }
  if (prev) {
    const dh = S.account.health_index - prev.account.health_index;
    const dx = S.account.xp - prev.account.xp;
    $('tm-delta').innerHTML = `vs ${esc(prev.scan.id)}: health ${deltaSpan(dh)} · xp ${deltaSpan(dx)}`;
  } else $('tm-delta').innerHTML = `<span class="flat">baseline snapshot</span>`;
}

// ---- Warden plate: v2 render()'s topbar player-card block --------------
function paintWarden() {
  const S = data.selected, a = S.account;
  $('scan-date').textContent = `${S.projects.length} products · ${S.inventory?.vaults?.length || 0} vaults · viewing ${S.scan.id}`;
  $('level').textContent = a.level;
  $('title-rank').textContent = a.title || '';
  countUp($('xp-label'), a.xp, (v) => `${v.toLocaleString()} ${LX('xp_unit')}`);
  $('xp-next').textContent = a.xp_to_next ? `${a.xp_to_next} to L${a.level + 1}` : 'max';
  const xpPct = a.xp_to_next ? (a.xp_into_level / (a.xp_into_level + a.xp_to_next)) * 100 : 100;
  $('xp-fill').style.width = xpPct.toFixed(1) + '%';
  countUp($('health'), a.health_index);
  const hf = $('hp-fill');
  hf.style.width = a.health_index + '%';
  hf.classList.toggle('warn', a.health_index < 70 && a.health_index >= 40);
  hf.classList.toggle('crit', a.health_index < 40);
  // pulse HP red when it dropped vs the previously shown value (juice)
  if (lastShown && a.health_index < lastShown.health) { hf.classList.remove('drop'); void hf.offsetWidth; hf.classList.add('drop'); }
  $('streak').textContent = a.streak?.scan_days ?? 0;
  lastShown = { xp: a.xp, health: a.health_index, level: a.level };
}

function paintStatusbar() {
  const S = data.selected, a = S.account;
  const built = data.bundle.built_at ? String(data.bundle.built_at).slice(0, 16).replace('T', ' ') : '—';
  $('status').innerHTML = `<b>${esc(S.scan.id)}</b> · ${a.totals.products} products · ${a.totals.open_quests} open (${a.totals.red_quests} red) · health ${a.health_index} · data built ${esc(built)} · <span class="keys">1-5 tabs · F focus · / search</span>`;
}

// theme swap keeps the chrome nodes; only their words change (v2 relabelChrome).
// Rail tab labels are shell's job; the FOCUS chip is relabelled in mountFocusChip.
function relabel() {
  const hw = $('hp-word'); if (hw) hw.textContent = LX('hp_word');
  const sw = $('streak-word'); if (sw) sw.textContent = LX('streak_word');
  const tm = $('timemachine'), tt = $('tm-toggle');
  if (tm && tt) tt.textContent = (tm.classList.contains('collapsed') ? '▸' : '▾') + ' ' + LX('stage');
}

function paintAll() { paintWarden(); paintTimeMachine(); paintStatusbar(); }

// global keys — attached ONCE (initChrome runs once, from boot)
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    // NOTE: the F (focus) hotkey is owned SOLELY by roundtable/focus.js — do
    // not handle it here too, or one press toggles twice (net no-op + a bogus
    // acted-on ledger write). The FOCUS chip still reaches it via bus.
    // ←/→ scrub only when the STAGE SELECT rail is open (or already off-live) —
    // browsing must never silently time-travel into a read-only snapshot.
    const tmOpen = !$('timemachine').classList.contains('collapsed') || !data.isLatest;
    if (e.key === 'ArrowLeft' && tmOpen) select(data.selectedIndex - 1);
    else if (e.key === 'ArrowRight' && tmOpen) select(data.selectedIndex + 1);
    else if (e.key === 'Escape') closeDrawer();
  });
}

export function initChrome() {
  bootSplash();
  wireSysMenu();
  paintSysActive();
  mountFocusChip();
  bus.on('theme:changed', () => {
    // shell's handler (registered first) already rebuilt the rail — re-seat
    // the FOCUS chip, remark the menu, repaint words with the new lexicon
    mountFocusChip();
    paintSysActive();
    relabel();
    if (data.scans.length) paintAll();
  });
  if (!data.scans.length) { $('status').textContent = 'No scans found. Run the pipeline, then `node build-data.mjs`.'; return; }
  buildTimeMachine();
  wireKeys();
  bus.on('data:select', paintAll);
  paintAll();
}
