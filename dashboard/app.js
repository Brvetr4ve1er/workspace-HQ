/* ============================================================================
   WorkspaceHQ dashboard renderer — pure DOM + inline SVG, zero dependencies.
   Consumes window.DATA = { scans:[oldest..newest], latest, built_at } from
   build-data.mjs. The whole UI re-renders for whichever snapshot is selected via
   the time-machine scrubber, so you can preview any day's report live.
   ========================================================================== */
(function () {
  const D = window.DATA || { scans: [], latest: null, built_at: null };
  const SCANS = D.scans || [];
  const $ = (id) => document.getElementById(id);

  // ---- theme system: arcade/okami/numidea/ops — persist, swap live, no reload -----
  const THEMES = {
    arcade:  { label: 'ARCADE' },
    okami:   { label: 'OKAMI' },
    numidea: { label: 'NUMIDEA' },
    ops:     { label: 'OPS DESK' },
  };
  function applyTheme(id) {
    if (!THEMES[id]) id = 'arcade';
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem('hq-theme', id); } catch {}
    // the trigger is a stable SYS menu now; the active theme shows inside the menu
    document.querySelectorAll('.theme-opt[data-theme]').forEach((o) => o.classList.toggle('active', o.dataset.theme === id));
  }
  {
    const saved = (() => { try { return localStorage.getItem('hq-theme') || 'arcade'; } catch { return 'arcade'; } })();
    applyTheme(saved);
    const btn = document.getElementById('theme-btn');
    const menu = document.getElementById('theme-menu');
    if (btn && menu) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
      document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open'); });
      document.querySelectorAll('.theme-opt').forEach((o) => o.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(o.dataset.theme);
        menu.classList.remove('open');
      }));
    }
  }

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Minimal markdown for LLM-written text (Weekly Saga). Escapes EVERYTHING first,
  // then rebuilds only headings/bold/bullets from the escaped text — raw HTML in the
  // input can never reach the DOM as markup.
  const mdLite = (md) => esc(md)
    .split('\n')
    .map((l) => {
      if (/^###?\s+/.test(l)) return `<div class="md-h">${l.replace(/^###?\s+/, '')}</div>`;
      if (/^[-*]\s+/.test(l)) return `<div class="md-li">▸ ${l.replace(/^[-*]\s+/, '')}</div>`;
      return l ? `<div class="md-p">${l}</div>` : '';
    })
    .join('')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const COL = { red: '#ff4757', orange: '#ffa502', yellow: '#ffe14d', green: '#3aff6e', blue: '#4d9fff', purple: '#b14aff', cyan: '#00f0ff', pink: '#ff6bcb', gold: '#ffd23f', low: '#3aff6e', medium: '#ffa502', high: '#ff4757' };
  const isElectron = !!window.hq;
  const devState = {};

  // ---- boot splash: CRT power-on, once per session, skippable ------------
  (function boot() {
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
  })();

  // ---- chiptune SFX: tiny WebAudio square-wave bleeps, off by default ----
  const SFX = (() => {
    let ctx = null, on = localStorage.getItem('hq-sfx') === '1';
    const btn = $('sfx-toggle');
    const paint = () => { if (btn) { btn.textContent = on ? '♪ ON' : '♪ OFF'; btn.classList.toggle('on', on); } };
    const beep = (notes) => {           // notes: [freqHz, durSec, startOffsetSec]
      if (!on) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = ctx.currentTime;
        notes.forEach(([f, d, at]) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'square'; o.frequency.value = f;
          g.gain.setValueAtTime(0.035, t0 + at);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0 + at); o.stop(t0 + at + d + 0.02);
        });
      } catch { /* no audio device — stay silent */ }
    };
    if (btn) btn.onclick = () => { on = !on; localStorage.setItem('hq-sfx', on ? '1' : '0'); paint(); beep([[880, 0.08, 0]]); };
    paint();
    return {
      blip: () => beep([[660, 0.06, 0]]),                       // tab switch
      move: () => beep([[440, 0.05, 0], [554, 0.05, 0.05]]),    // snapshot scrub
      coin: () => beep([[988, 0.07, 0], [1319, 0.18, 0.08]]),   // quest done
      open: () => beep([[523, 0.06, 0], [784, 0.08, 0.06]]),    // drawer open
      // rising arpeggio fanfare for level-ups / new achievements
      levelup: () => beep([[523, 0.09, 0], [659, 0.09, 0.09], [784, 0.09, 0.18], [1047, 0.28, 0.27], [1319, 0.34, 0.4]]),
      badge: () => beep([[784, 0.08, 0], [1047, 0.08, 0.08], [1319, 0.22, 0.16]]),  // achievement pop
      fizzle: () => beep([[220, 0.14, 0], [164, 0.26, 0.12]]),                       // failed cast (descending groan)
    };
  })();

  // ---- AOS scroll-reveal integration ------------------------------------
  // The whole UI rebuilds on snapshot scrub, so after every full render we
  // refreshHard() to let AOS rediscover the new nodes. once:true keeps content
  // permanently visible once revealed (no vanish-on-scroll); we never strip
  // aos-animate by hand because AOS tracks "animated" internally and wouldn't
  // re-add it — that would risk stuck-invisible content. Tab switches keep the
  // existing CSS .tab fadein; AOS owns load, scrub-replay, and scroll reveals.
  const AOS_ON = typeof AOS !== 'undefined';
  const AOS_DUR = 560;   // reveal duration (ms) — applied inline per element, see aos()
  if (AOS_ON) AOS.init({ once: true, duration: AOS_DUR, easing: 'ease-out-back', offset: 28, anchorPlacement: 'top-bottom', disableMutationObserver: true });
  let _aosRaf = 0;
  function aosRefresh() {
    if (!AOS_ON) return;
    cancelAnimationFrame(_aosRaf);
    // double rAF: let the freshly-built DOM lay out before AOS reads positions
    _aosRaf = requestAnimationFrame(() => requestAnimationFrame(() => AOS.refreshHard()));
  }
  // Tag a node for scroll-reveal with an optional capped stagger.
  // Timing is set INLINE, not via data-aos-delay/duration: AOS's bundled CSS only
  // honours those attributes in fixed 50ms steps (`[data-aos-delay="50"]` … 3000),
  // so off-grid values (our 40/45/35/70/60ms staggers and the 560ms global) silently
  // fall back to the 50ms base — killing both the stagger and the duration. Inline
  // styles outrank the stylesheet, so exact ms land reliably. Easing still comes from
  // AOS (a named value, which does have a CSS rule).
  function aos(node, anim, i, step) {
    if (!AOS_ON || !node) return node;
    node.setAttribute('data-aos', anim);
    node.style.transitionDuration = AOS_DUR + 'ms';
    if (i != null) node.style.transitionDelay = Math.min(i * (step || 55), 600) + 'ms';
    return node;
  }
  const aosKids = (parent, anim, step) => { if (parent) [...parent.children].forEach((c, i) => aos(c, anim, i, step)); };
  // Replay a tab's staggered reveal when it becomes active. render() builds all five
  // tabs up-front but four are display:none — AOS reads their offset as 0 and pre-fires
  // them to "revealed" while hidden, so switching in shows fully-built content with no
  // entrance. Stripping aos-animate inside the now-visible tab and refreshing lets AOS
  // re-evaluate with real positions and stagger the on-screen rows back in.
  function revealTab(tab) {
    if (!AOS_ON || !tab) return;
    tab.querySelectorAll('[data-aos].aos-animate').forEach((n) => n.classList.remove('aos-animate'));
    aosRefresh();
  }

  // achievement catalog (static flavor; the scan only stores id + progress).
  // Icons are hand-placed 16x16 pixel-art SVGs so the trophy room stays crisp
  // at any zoom and locked badges can be desaturated via CSS filter.
  const pxi = (inner) => `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" class="px-ico">${inner}</svg>`;
  const PX = {
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
  const ACH = {
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

  if (!SCANS.length) { $('status').textContent = 'No scans found. Run the pipeline, then `node build-data.mjs`.'; return; }

  // ----------------------------------------------------------------- state
  let cur = SCANS.length - 1;          // selected snapshot index (default: latest)
  let projFilter = 'all', projSearch = '';
  let lastShown = null;                // {xp,health,level,xpPct} from the prior render, for juice tweens

  // Count a number up/down to its new value over ~half a second (XP-juice). Stores the
  // current value on the node so re-renders animate only the delta, not from zero.
  function countUp(node, to, fmt) {
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

  const fmtDate = (iso) => iso;        // ids are already yyyy-mm-dd
  const sign = (n) => (n > 0 ? '+' + n : '' + n);
  const deltaSpan = (n, invert) => {
    if (!n) return `<span class="flat">±0</span>`;
    const good = invert ? n < 0 : n > 0;
    return `<span class="${good ? 'up' : 'down'}">${n > 0 ? '▲' : '▼'} ${sign(n)}</span>`;
  };

  // =========================================================== time machine
  function buildTimeMachine() {
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
      dot.innerHTML = `<i></i>${showLbl ? `<span>${s.scan.id.slice(5)}</span>` : ''}`;
      dot.onclick = () => select(i);
      dot.title = `${s.scan.id} · health ${s.account.health_index} · L${s.account.level} · ${s.account.totals.open_quests} open`;
      dots.appendChild(dot);
    });
    $('tm-prev').onclick = () => select(cur - 1);
    $('tm-next').onclick = () => select(cur + 1);
    // rail fold: persisted, and paintTimeMachine force-opens it while off-live
    const tm = $('timemachine');
    tm.classList.toggle('collapsed', localStorage.getItem('hq-tm-open') !== '1');
    $('tm-toggle').onclick = () => {
      const open = tm.classList.toggle('collapsed') === false;
      localStorage.setItem('hq-tm-open', open ? '1' : '0');
      $('tm-toggle').textContent = (open ? '▾' : '▸') + ' STAGE SELECT';
      SFX.blip();
    };
    $('tm-toggle').textContent = (tm.classList.contains('collapsed') ? '▸' : '▾') + ' STAGE SELECT';
    $('tm-live').onclick = () => select(SCANS.length - 1);
  }
  function paintTimeMachine() {
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
    if (!isLatest) { $('timemachine').classList.remove('collapsed'); $('tm-toggle').textContent = '▾ STAGE SELECT'; }
    if (prev) {
      const dh = S.account.health_index - prev.account.health_index;
      const dx = S.account.xp - prev.account.xp;
      $('tm-delta').innerHTML = `vs ${prev.scan.id}: health ${deltaSpan(dh)} · xp ${deltaSpan(dx)}`;
    } else $('tm-delta').innerHTML = `<span class="flat">baseline snapshot</span>`;
  }

  function select(i) {
    if (i < 0 || i >= SCANS.length || i === cur) { if (i === cur) return; }
    cur = Math.max(0, Math.min(SCANS.length - 1, i));
    SFX.move();
    render();
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) { window.hqDemo('level'); return; }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { $('onething').classList.contains('show') ? exitOneThing(false) : enterOneThing(); return; }
    // number keys jump tabs; '/' focuses the visible search box
    if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { activateTab(TAB_ORDER[+e.key - 1]); return; }
    if (e.key === '/') { const s = document.querySelector('.tab.active input[id$="search"]'); if (s) { e.preventDefault(); s.focus(); } return; }
    // ←/→ scrub only when the STAGE SELECT rail is open (or already off-live) —
    // browsing must never silently time-travel into a read-only snapshot.
    const tmOpen = !$('timemachine').classList.contains('collapsed') || cur !== SCANS.length - 1;
    if (e.key === 'ArrowLeft' && tmOpen) select(cur - 1);
    else if (e.key === 'ArrowRight' && tmOpen) select(cur + 1);
    else if (e.key === 'Escape') { closeDrawer(); exitOneThing(false); const to = $('takeover'); if (to) to.classList.remove('show'); }
  });

  // =================================================================== tabs
  const TAB_ORDER = ['overview', 'quests', 'spellbook', 'trends', 'basemap'];
  function activateTab(name) {
    const tab = $(name); if (!tab) return;
    document.querySelectorAll('#tabs button[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    window.scrollTo({ top: 0 });   // never land mid-page on a fresh tab
    SFX.blip();
    revealTab(tab);
  }
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) => b.onclick = () => activateTab(b.dataset.tab));
  // FOCUS chip: the always-visible door into One-Thing mode (was keyboard-only)
  { const tf = $('tab-focus'); if (tf) tf.onclick = () => { $('onething').classList.contains('show') ? exitOneThing(false) : enterOneThing(); }; }

  // =============================================================== main render
  function render() {
    const S = SCANS[cur], prev = SCANS[cur - 1] || null, a = S.account;
    const projById = {}; S.projects.forEach((p) => (projById[p.id] = p));
    const prevProj = {}; if (prev) prev.projects.forEach((p) => (prevProj[p.id] = p));

    // ---- topbar player card
    $('scan-date').textContent = `${S.projects.length} products · ${S.inventory?.vaults?.length || 0} vaults · viewing ${S.scan.id}`;
    $('level').textContent = a.level;
    $('title-rank').textContent = a.title || '';
    countUp($('xp-label'), a.xp, (v) => `${v.toLocaleString()} XP`);
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
    lastShown = { xp: a.xp, health: a.health_index, level: a.level, xpPct };
    $('quest-count').textContent = a.totals.open_quests;
    $('ach-count').textContent = (S.achievements || []).filter((x) => x.unlocked).length;

    $('spell-count').textContent = D.spellbook ? D.spellbook.counts.total : '';

    paintTimeMachine();
    renderOverview(S, prev, projById, prevProj);
    renderQuests(S, projById);
    renderSpellbook();
    renderTrends(S);
    renderAchievements(S);
    renderBaseMap(S, prevProj);
    renderInventory(S);

    const built = D.built_at ? D.built_at.slice(0, 16).replace('T', ' ') : '—';
    $('status').innerHTML = `<b>${esc(S.scan.id)}</b> · ${a.totals.products} products · ${a.totals.open_quests} open (${a.totals.red_quests} red) · health ${a.health_index} · data built ${built} · <span class="keys">1-5 tabs · F focus · / search</span>`;

    aosRefresh();   // rediscover the freshly-built nodes for scroll-reveal
    maybeCelebrate(S);   // fire the takeover if this live scan brought a level-up / unlock / completion
  }

  // --------------------------------------------------------------- spellbook
  // The arsenal: every automation catalogued by collector/spellbook.mjs as a
  // castable RPG spell. Casting itself is wired via window.hq (Electron only).
  const SCHOOL = {
    divination:    { c: COL.cyan,    label: 'DIVINATION' },
    conjuration:   { c: COL.gold,    label: 'CONJURATION' },
    transmutation: { c: COL.orange,  label: 'TRANSMUTATION' },
    abjuration:    { c: COL.blue,    label: 'ABJURATION' },
    evocation:     { c: COL.red,     label: 'EVOCATION' },
    illusion:      { c: '#ff2bd6',   label: 'ILLUSION' },
    enchantment:   { c: COL.purple,  label: 'ENCHANTMENT' },
    restoration:   { c: COL.green,   label: 'RESTORATION' },
  };
  const MASTERY_TIERS = [
    { rank: 'Novice', days: 1 }, { rank: 'Adept', days: 5 }, { rank: 'Expert', days: 15 },
    { rank: 'Master', days: 40 }, { rank: 'Grandmaster', days: 100 },
  ];
  let spellSchool = 'all', spellSource = 'all', spellSearch = '', spellMax = 24;

  const masteryOf = (id) => {
    const days = (D.telemetry?.rollup?.[id]?.distinct_days || []).length;
    let pips = 0;
    for (const t of MASTERY_TIERS) if (days >= t.days) pips++;
    return { days, pips, rank: pips ? MASTERY_TIERS[pips - 1].rank : null };
  };
  const pipsHtml = (n) => `<span class="pips" title="mastery">${'●'.repeat(n)}${'○'.repeat(5 - n)}</span>`;

  // Cooldown ticker: only the countdown text nodes update, never a re-render.
  function fmtCd(ms) {
    if (ms <= 0) return 'ready';
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach((n) => {
      const t = Number(n.dataset.cd);
      n.textContent = `⏳ ${fmtCd(t - Date.now())}`;
    });
  }, 30000);

  function spellCard(s) {
    const sch = SCHOOL[s.school] || SCHOOL.evocation;
    const card = el('div', `spellcard r-${s.rarity}`);
    card.style.setProperty('--sch', sch.c);
    const m = masteryOf(s.id);
    const castable = s.kind === 'castable' || s.kind === 'chain';
    const cd = s.schedule?.next_run ? new Date(s.schedule.next_run).getTime() : null;
    card.innerHTML = `
      <div class="sp-top">
        <span class="sp-icon">${esc(s.icon || '✴️')}</span>
        <span class="sp-name">${esc(s.name)}</span>
        ${m.pips ? pipsHtml(m.pips) : ''}
      </div>
      <div class="sp-meta">
        <span class="sp-school">${sch.label}</span>
        <span class="sp-src">${esc(s.source)}</span>
        <span class="sp-rarity">${esc(s.rarity)}</span>
      </div>
      <div class="sp-desc">${esc(s.tooltip || s.description || '—')}</div>
      <div class="sp-foot">
        ${cd && !isNaN(cd) ? `<span class="sp-cd" data-cd="${cd}">⏳ ${fmtCd(cd - Date.now())}</span>` : ''}
        ${s.kind === 'channeled' ? '<span class="sp-kind">⚡ channeled</span>' : ''}
        ${s.kind === 'tome' ? '<span class="sp-kind">📦 tome</span>' : ''}
        ${s.kind === 'chain' ? '<span class="sp-kind">⛓️ chain</span>' : ''}
        ${castable || s.kind === 'channeled' ? `<button class="sp-cast" ${s.invalid ? 'disabled' : ''}>CAST</button>` : ''}
      </div>`;
    card.onclick = () => openSpellDrawer(s);
    const btn = card.querySelector('.sp-cast');
    if (btn) btn.onclick = (e) => { e.stopPropagation(); castSpell(s); };
    return card;
  }

  // ---- casting flow: id -> main-process whitelist -> dry-run confirm -> stream ----
  async function castSpell(s, confirmedHash) {
    if (!window.hq?.castSpell) { SFX.blip(); alert('Casting engine needs the Electron app (launch WorkspaceHQ, not the browser).'); return; }
    let res;
    try { res = await window.hq.castSpell(s.id, confirmedHash); } catch (e) { res = { error: String(e) }; }
    if (!res) return;
    if (res.error) { castlogLine(null, 'err', `✖ ${s.name}: ${res.error}`); showCastlog(); SFX.fizzle(); return; }
    if (res.confirm_required) { showCastConfirm(s, res.preview); return; }
    if (res.channeled) { castlogLine(null, 'sys', `⚡ ${s.name} channeled into a terminal window`); showCastlog(); SFX.open(); return; }
    showCastlog();
  }

  // Dry-run confirm: the user sees the EXACT command line before it ever runs.
  function showCastConfirm(s, p) {
    const m = $('castconfirm');
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
  const castBlocks = new Map();   // castId -> output <pre>
  function showCastlog() { $('castlog').classList.remove('hidden'); }
  function castlogLine(castId, stream, text) {
    const log = $('castlog');
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

  if (isElectron && window.hq.onCastOutput) {
    window.hq.onCastOutput((d) => {
      showCastlog();
      const pre = castBlocks.get(d.castId);
      if (!pre && d.stream === 'sys') castlogLine(d.castId, 'sys', d.chunk);
      else d.chunk.split(/\r?\n/).forEach((l) => { if (l.trim()) castlogLine(d.castId, d.stream, l); });
      // attach a cancel button to the block header once
      if (d.castId && !castBlocks.get(d.castId)?.parentNode.querySelector('.cl-cancel')) {
        const b = el('button', 'cl-cancel', '✕ cancel');
        b.onclick = () => window.hq.cancelCast(d.spellId);
        castBlocks.get(d.castId)?.parentNode.prepend(b);
      }
    });
    window.hq.onCastDone((d) => {
      const ok = d.outcome === 'resolved';
      castlogLine(d.castId, ok ? 'ok' : 'err',
        ok ? `✨ ${d.name} RESOLVED · ${(d.duration_ms / 1000).toFixed(1)}s`
           : `💥 ${d.name} FIZZLED${d.timed_out ? ' (timeout)' : ` (exit ${d.exit_code})`} · ${(d.duration_ms / 1000).toFixed(1)}s`);
      const blk = castBlocks.get(d.castId)?.parentNode;
      if (blk) { blk.classList.add(ok ? 'done-ok' : 'done-err'); blk.querySelector('.cl-cancel')?.remove(); }
      // optimistic XP hint: the ledger truth lands at the next assemble
      if (ok) castlogLine(d.castId, 'sys', '   +XP queued (settles on next scan — cast Deep Scan to bank it now)');
      ok ? SFX.coin() : SFX.fizzle();
    });
  }

  function openSpellDrawer(s) {
    const sch = SCHOOL[s.school] || SCHOOL.evocation;
    const m = masteryOf(s.id);
    const roll = D.telemetry?.rollup?.[s.id];
    const d = $('drawer');
    d.innerHTML = `
      <div class="spdrawer" style="--sch:${sch.c}">
        <div class="spd-head r-${esc(s.rarity)}">
          <span class="spd-icon">${esc(s.icon || '✴️')}</span>
          <div>
            <div class="spd-name">${esc(s.name)}</div>
            <div class="spd-sub">${sch.label} · ${esc(s.rarity)} · ${esc(s.source)}${m.rank ? ` · ${m.rank} (${m.days}d)` : ''}</div>
          </div>
          <button class="spd-close" title="close">✕</button>
        </div>
        <div class="spd-tip">${esc(s.tooltip || s.description || 'An unidentified incantation.')}</div>
        ${s.body ? `<div class="spd-body">${esc(s.body).slice(0, 1200)}</div>` : ''}
        <div class="spd-sec">INCANTATION (exact command)</div>
        <div class="spd-cmd">${s.kind === 'chain'
          ? esc('chain: ' + (s.chain || []).join(' → '))
          : esc([s.command, ...(s.args || [])].filter(Boolean).join(' '))}</div>
        ${s.cwd ? `<div class="spd-kv">cwd: ${esc(s.cwd)}</div>` : ''}
        ${s.origin_path ? `<div class="spd-kv">origin: ${esc(s.origin_path)}</div>` : ''}
        ${s.schedule ? `<div class="spd-kv">next: ${esc(s.schedule.next_run || '—')} · last: ${esc(s.schedule.last_run || '—')} (result ${esc(String(s.schedule.last_result ?? '—'))})</div>` : ''}
        ${roll ? `<div class="spd-kv">casts: ${roll.lifetime_casts} · last: ${esc((roll.last_cast || '').slice(0, 16).replace('T', ' '))}</div>` : ''}
        <div class="spd-actions">
          ${s.kind === 'castable' || s.kind === 'chain' || s.kind === 'channeled' ? `<button class="spd-cast" ${s.invalid ? 'disabled' : ''}>⚡ CAST</button>` : ''}
          ${s.origin_path && isElectron ? `<button class="spd-open">📂 origin</button>` : ''}
        </div>
      </div>`;
    d.querySelector('.spd-close').onclick = closeDrawer;
    const cb = d.querySelector('.spd-cast');
    if (cb) cb.onclick = () => castSpell(s);
    const ob = d.querySelector('.spd-open');
    if (ob) ob.onclick = () => window.hq?.openFile?.(s.origin_path);
    d.classList.add('open'); $('scrim').classList.add('open');
    SFX.open();
  }

  function renderSpellbook() {
    const sb = $('spellbook'); sb.innerHTML = '';
    const B = D.spellbook;
    if (!B || !B.spells?.length) {
      sb.appendChild(el('div', 'empty-note', 'No spellbook yet — run <b>node collector/spellbook.mjs</b> (or the full pipeline) to divine your arsenal.'));
      return;
    }

    // Header: school chips (click = filter) + collection meter slot (economy fills it in Phase 6)
    const head = el('h2', 'sec', `📖 Arsenal · ${B.counts.total} spells known`);
    if (isElectron) {
      const acts = el('span', 'sec-acts');
      const deep = el('button', 'sec-btn', '🔮 DEEP SCAN');
      deep.title = 'Cast the full pipeline (collector → enrich → assemble → render)';
      deep.onclick = (e) => { e.stopPropagation(); const ds = B.spells.find((x) => x.id === 'grimoire:deep-scan'); if (ds) castSpell(ds); };
      const relearn = el('button', 'sec-btn', '✨ RELEARN');
      relearn.title = 'Rescan skills/scripts/tasks only (fast, no pipeline)';
      relearn.onclick = async (e) => { e.stopPropagation(); relearn.textContent = '…'; await window.hq.rescanSpellbook(); };
      acts.append(deep, relearn);
      head.appendChild(acts);
    }
    sb.appendChild(head);
    const chips = el('div', 'sch-chips');
    const chip = (key, label, color, count) => {
      const c = el('button', 'sch-chip' + (spellSchool === key ? ' active' : ''), `${label} <b>${count}</b>`);
      c.style.setProperty('--sch', color);
      c.onclick = () => { spellSchool = spellSchool === key ? 'all' : key; spellMax = 24; renderSpellbook(); };
      return c;
    };
    for (const [k, v] of Object.entries(SCHOOL)) chips.appendChild(chip(k, v.label, v.c, B.counts.by_school[k] || 0));
    sb.appendChild(chips);

    // Collection meter: how much of the arsenal you've actually wielded
    const sc = D.latest?.account?.spellcraft;
    if (sc) {
      const cm = el('div', 'collmeter');
      const schoolBars = Object.entries(sc.per_school || {})
        .filter(([k]) => SCHOOL[k])
        .map(([k, v]) => `<div class="cm-school" title="${SCHOOL[k].label}: ${v.cast}/${v.known} cast">
            <span class="cm-dot" style="--sch:${SCHOOL[k].c}"></span>
            <div class="cm-mini"><i style="width:${v.pct}%; --sch:${SCHOOL[k].c}"></i></div>
          </div>`).join('');
      cm.innerHTML = `<div class="cm-main">
          <span class="cm-lbl">COLLECTION</span>
          <div class="cm-bar"><i style="width:${sc.ever_cast_pct}%"></i></div>
          <span class="cm-num">${sc.ever_cast}/${sc.spells_known} wielded (${sc.ever_cast_pct}%) · ${sc.lifetime_casts} lifetime casts</span>
        </div><div class="cm-schools">${schoolBars}</div>`;
      sb.appendChild(cm);
    }

    // Toolbar: search + source filter
    const tb = el('div', 'toolbar');
    const sources = ['all', 'grimoire', 'skill', 'command', 'script', 'npm', 'task', 'plugin'];
    tb.innerHTML = `<input id="spsearch" placeholder="Search spells…" value="${esc(spellSearch)}" />
      <div class="seg" id="spseg">${sources.map((s) => `<button data-f="${s}" class="${spellSource === s ? 'active' : ''}">${s === 'plugin' ? 'tomes' : s}</button>`).join('')}</div>
      <span class="count" id="spcount"></span>`;
    sb.appendChild(tb);

    const grid = el('div', 'spellgrid'); sb.appendChild(grid);
    const more = el('div', 'sp-more'); sb.appendChild(more);

    const draw = () => {
      grid.innerHTML = ''; more.innerHTML = '';
      const q = spellSearch.toLowerCase();
      const hits = B.spells.filter((s) =>
        (spellSchool === 'all' || s.school === spellSchool) &&
        (spellSource === 'all' || s.source === spellSource || (spellSource === 'plugin' && s.kind === 'tome')) &&
        (!q || `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(q)));
      // "my spells" first: mastery desc, then most-recently-cast — the first screen
      // is the arsenal you actually wield, not an alphabet of 957 strangers.
      const lastCast = (id) => Date.parse(D.telemetry?.rollup?.[id]?.last_cast || 0) || 0;
      hits.sort((x, y) => (masteryOf(y.id).pips - masteryOf(x.id).pips) || (lastCast(y.id) - lastCast(x.id)));
      $('spcount').textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
      hits.slice(0, spellMax).forEach((s) => grid.appendChild(spellCard(s)));
      if (hits.length > spellMax) {
        const b = el('button', 'sp-morebtn', `SHOW MORE (${hits.length - spellMax} hidden)`);
        b.onclick = () => { spellMax += 120; draw(); };
        more.appendChild(b);
      }
    };
    draw();

    tb.querySelector('#spsearch').oninput = (e) => { spellSearch = e.target.value; spellMax = 24; draw(); };
    tb.querySelectorAll('#spseg button').forEach((b) => b.onclick = () => {
      spellSource = b.dataset.f; spellMax = 24;
      tb.querySelectorAll('#spseg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });

    // Familiars shelf: summoned MCP allies — perched, not castable
    if (B.familiars?.length) {
      sb.appendChild(el('h2', 'sec', `🐦‍⬛ Familiars · ${B.familiars.length} bound`));
      const shelf = el('div', 'famshelf');
      B.familiars.forEach((f) => {
        const sch = SCHOOL[f.school] || SCHOOL.divination;
        const fc = el('div', 'familiar');
        fc.style.setProperty('--sch', sch.c);
        fc.innerHTML = `<span class="fam-eye">◉</span><div><div class="fam-name">${esc(f.name)}</div>
          <div class="fam-sub">${esc(f.transport)} · ${esc(f.scope)}</div></div>`;
        fc.title = f.detail || '';
        shelf.appendChild(fc);
      });
      aosKids(shelf, 'fade-up', 40);
      sb.appendChild(shelf);
    }
  }

  // ---- progressive-disclosure fold: h2 header + persisted open state ---------
  // Detail is never deleted, it collapses behind one click. Collapsed headers show
  // a one-line summary so nothing is invisible, just quiet. (UX contract: BASE
  // presents ONE decision; everything else folds.)
  function foldSec(parent, key, title, summary, build, defaultOpen = false) {
    let open = localStorage.getItem('hq-sec-' + key);
    open = open == null ? defaultOpen : open === '1';
    const h = el('h2', 'sec sec-fold');
    const body = el('div', 'fold-body');
    const paint = () => {
      h.innerHTML = `<span class="fold-chev">${open ? '▾' : '▸'}</span> ${title}${!open && summary ? `<span class="fold-sum">${summary}</span>` : ''}`;
      body.innerHTML = '';
      if (open) build(body);
    };
    h.onclick = () => { open = !open; localStorage.setItem('hq-sec-' + key, open ? '1' : '0'); paint(); SFX.blip(); };
    parent.appendChild(h); parent.appendChild(body);
    paint();
  }

  // ---------------------------------------------------------------- overview
  function renderOverview(S, prev, projById, prevProj) {
    const ov = $('overview'); ov.innerHTML = ''; const a = S.account;
    const t = a.totals, pt = prev?.account.totals;
    const isLatest = cur === SCANS.length - 1;

    // ---- TODAY'S RUN: the ONE decision surface on BASE --------------------
    // daily_top3 (quick-win / momentum / rescue) deduped against the top red
    // quest; each card carries its own FOCUS + DONE verbs so pick→act is one
    // motion. Everything else on this tab is folded context.
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
    // header + the QUESTS gateway chip (the ideas feed moved there)
    const feed = (S.side_quests || []);
    const urgentN = feed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length;
    const head = el('h2', 'sec', 'Today — pick one');
    if (feed.length) {
      const chip = el('button', 'sec-chip', `${urgentN ? `⚠ ${urgentN} urgent · ` : ''}${feed.length - urgentN} ideas ▸`);
      chip.title = 'Side-quests moved to the QUESTS board';
      chip.onclick = () => activateTab('quests');
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
        c.onclick = () => { const p = projById[pick.project_id]; if (p) openDrawer(p, prevProj[pick.project_id]); else activateTab('quests'); };
        const act = c.querySelector('.d3act');
        const fb = el('button', 'qbtn focus', '◎ FOCUS');
        fb.onclick = (e) => { e.stopPropagation(); enterOneThing(q || undefined); };
        act.appendChild(fb);
        if (q && isElectron && isLatest) {
          const dn = el('button', 'qbtn', '✓ DONE');
          dn.onclick = (e) => { e.stopPropagation(); dn.disabled = true; SFX.coin(); window.hq.markQuestDone(q.id); };
          act.appendChild(dn);
        }
        d3.appendChild(c);
      });
      aosKids(d3, 'zoom-in', 60);
      ov.appendChild(d3);
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
        if (sp) castSpell(sp); else activateTab('spellbook');
      };
      ov.appendChild(sc);
    }

    // ---- folded context: pulse (KPIs) + changes — quiet until asked -------
    const avg = Math.round(S.projects.reduce((s, p) => s + p.completion.pct, 0) / S.projects.length);
    const enriched = S.scan && S.scan.enriched === true;
    foldSec(ov, 'kpis', 'Pulse', `${enriched ? '' : '~'}${avg}% avg · ${t.open_quests} open (${t.red_quests} red)`, (body) => {
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
    foldSec(ov, 'changes', `Changes since ${esc(S.scan.previous_scan || 'baseline')}`,
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
    if (wr && wr.narrative_md && cur === SCANS.length - 1) {
      ov.appendChild(el('h2', 'sec', `📜 Weekly Saga · ${esc(wr.week_start)} → ${esc(wr.week_end)}`));
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
        SFX.blip();
      };
      aos(saga, 'fade-up');
      ov.appendChild(saga);
    }

    // (the Ideas & risks feed now lives on the QUESTS board as its own column —
    //  BASE keeps only the gateway chip in the TODAY header)

    // products
    ov.appendChild(el('h2', 'sec', 'Products'));
    const tb = el('div', 'toolbar');
    tb.innerHTML = `<input id="psearch" placeholder="Filter products…" value="${esc(projSearch)}" />
      <div class="seg" id="pseg">
        <button data-f="all" class="${projFilter === 'all' ? 'active' : ''}">All</button>
        <button data-f="risk" class="${projFilter === 'risk' ? 'active' : ''}">At risk</button>
        <button data-f="active" class="${projFilter === 'active' ? 'active' : ''}">Active</button>
        <button data-f="cold" class="${projFilter === 'cold' ? 'active' : ''}">Cold cases</button>
      </div><span class="count" id="pcount"></span>`;
    ov.appendChild(tb);
    const grid = el('div', 'grid'); ov.appendChild(grid);

    const drawCards = (animate) => {
      grid.innerHTML = '';
      let list = [...S.projects].sort((x, y) => y.completion.pct - x.completion.pct);
      const q = projSearch.trim().toLowerCase();
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.stack || []).join(' ').toLowerCase().includes(q));
      if (projFilter === 'risk') list = list.filter((p) => p.metrics.git_safety.risk === 'high' || p.metrics.code_health.build === 'red' || p.metrics.risk_security.score === 'high');
      if (projFilter === 'active') list = list.filter((p) => p.activity.state === 'active');
      if (projFilter === 'cold') list = list.filter((p) => p.activity.state === 'dormant').sort((x, y) => (y.activity.days_since_commit ?? 0) - (x.activity.days_since_commit ?? 0));
      $('pcount').textContent = `${list.length} / ${S.projects.length}`;
      list.forEach((p, i) => { const c = projectCard(p, prevProj[p.id]); if (animate) aos(c, 'fade-up', i, 45); grid.appendChild(c); });
      if (animate) aosRefresh();
    };
    drawCards(true);
    // no reveal on live search redraw — cards swap instantly, no flicker
    $('psearch').oninput = (e) => { projSearch = e.target.value; drawCards(false); };
    tb.querySelectorAll('#pseg button').forEach((b) => b.onclick = () => { projFilter = b.dataset.f; renderOverview(S, prev, projById, prevProj); });
  }

  function gitText(g) {
    if (!g.has_git) return 'no git';
    if (g.commits === 0) return '0 commits';
    if (!g.has_remote) return 'no remote';
    if (g.dirty > 20) return `${g.dirty} dirty`;
    if (g.dirty > 0) return `${g.dirty} dirty`;
    if (g.unpushed) return `${g.ahead} ahead`;
    return 'in sync';
  }

  function projectCard(p, prevP) {
    const g = p.metrics.git_safety, ch = p.metrics.code_health;
    const pc = p.completion.pct, barColor = pc < 50 ? COL.red : pc < 80 ? COL.orange : COL.green;
    const card = el('div', 'card');
    card.style.setProperty('--rc', g.risk === 'high' ? COL.red : g.risk === 'medium' ? COL.orange : COL.green);
    const dpc = prevP ? p.completion.pct - prevP.completion.pct : 0;
    
    const isRunning = devState[p.id];
    let devHtml = '';
    if (isElectron && p.dev_cmd) {
      devHtml = `<button class="cdevbtn ${isRunning ? 'running' : ''}" id="cdevbtn-${p.id}" title="${isRunning ? 'Stop Server' : 'Launch Server'}" onclick="event.stopPropagation(); window.hq.${isRunning ? 'devStop' : 'devStart'}('${p.id}')">${isRunning ? '■' : '▶'}</button>`;
    }

    card.innerHTML = `
      ${devHtml}
      <div class="xpd">${dpc ? deltaSpan(dpc) : ''}</div>
      <h3><span class="pct">${pc}%</span><span class="nm">${esc(p.name)}</span></h3>
      <div class="stack">${esc((p.stack || []).slice(0, 4).join(' · '))}</div>
      <div class="bar"><i style="width:${pc}%;background:${barColor}"></i></div>
      <div class="badges"></div>`;
    const badges = card.querySelector('.badges');
    const buildCls = ch.build === 'red' ? 'red' : ['green', 'runs'].includes(ch.build) ? 'green' : '';
    badges.appendChild(el('span', 'tag ' + buildCls, `build: ${esc(ch.build)}`));
    badges.appendChild(el('span', 'tag ' + (g.risk === 'high' ? 'red' : g.risk === 'medium' ? 'orange' : 'green'), `git: ${esc(gitText(g))}`));
    const ts = ch.tests; badges.appendChild(el('span', 'tag', `tests: ${ts?.passing ? ts.passing + '/' + (ts.count ?? '?') : ts?.present ? 'present' : 'none'}`));
    badges.appendChild(el('span', 'tag blue', esc(p.activity.state)));
    card.onclick = () => openDrawer(p, prevP);
    return card;
  }

  // ----------------------------------------------------- side-quests (Thread D)
  // "Smart propositions": urgent/risky actions + cool ideas, per project. Rendered in
  // the overview feed (global) and in each project drawer (scoped). They ride the same
  // quest-overrides store, so ✓ DID IT persists exactly like a real quest completion.
  const SQ_KIND = {
    risk:   { label: 'RISK',   col: COL.red },
    urgent: { label: 'URGENT', col: COL.orange },
    idea:   { label: 'IDEA',   col: COL.cyan },
    polish: { label: 'POLISH', col: COL.purple },
  };
  function sideQuestRow(sq, showProject) {
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
    if (isElectron && cur === SCANS.length - 1) {
      const act = row.querySelector('.sqact');
      const proj = SCANS[cur].projects.find((p) => p.id === sq.project_id);
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
      b.onclick = (e) => { e.stopPropagation(); b.disabled = true; SFX.coin(); window.hq.markQuestDone(sq.id); };
      act.appendChild(b);
    }
    return row;
  }

  // ---------------------------------------------------------------- quests
  function renderQuests(S, projById) {
    const q = $('quests'); q.innerHTML = '';
    const open = S.quests.filter((x) => x.status === 'open' || x.status === 'in_progress');
    const done = S.quests.filter((x) => x.completed === S.scan.id || (x.status === 'done' && x.completed === S.scan.id));
    const board = el('div', 'qboard'); q.appendChild(board);
    const tierName = { red: 'Red — loss & breakage', orange: 'Orange — before production', yellow: 'Yellow — housekeeping' };
    const isLatest = cur === SCANS.length - 1;
    ['red', 'orange', 'yellow'].forEach((tier) => {
      const qs = open.filter((x) => x.tier === tier);
      const col = el('div', 'qcol ' + tier);
      col.appendChild(el('h3', null, `<span class="dot"></span>${tierName[tier]}<span class="n">${qs.length}</span>`));
      if (!qs.length) col.appendChild(el('div', 'empty-note', 'Clear.'));
      qs.forEach((x, i) => {
        const proj = x.project_id && projById[x.project_id] ? projById[x.project_id] : null;
        const ageCls = x.age_days >= 7 ? 'old' : '';
        const qd = aos(el('div', 'quest'), 'fade-up', i, 40);
        qd.innerHTML = `<div class="coin">+${x.xp}</div><div class="body">
          <div class="t">${esc(x.title)}${x.age_days > 0 ? `<span class="age ${ageCls}">${x.age_days}d</span>` : ''}</div>
          <div class="i">${esc(x.insight || '')}</div>
          ${proj ? `<div class="proj">↳ ${esc(proj.name)}</div>` : ''}
          <div class="qactions"></div></div>`;
        // live actions only on the latest snapshot inside Electron
        if (isElectron && isLatest) {
          const acts = qd.querySelector('.qactions');
          if (proj) { const b = el('button', 'qbtn', '▸ OPEN'); b.onclick = (e) => { e.stopPropagation(); window.hq.openRepo(proj.path); }; acts.appendChild(b); }
          if (proj) { const cb = el('button', 'qbtn claude', '⚡'); cb.title = 'Send to a Claude session'; cb.onclick = (e) => { e.stopPropagation(); window.hq.claudeQuest(proj.path, `${x.title} — ${x.insight || ''}`); }; acts.appendChild(cb); }
          const dn = el('button', 'qbtn', '✓ DONE'); dn.onclick = (e) => { e.stopPropagation(); dn.disabled = true; SFX.coin(); window.hq.markQuestDone(x.id); }; acts.appendChild(dn);
        }
        col.appendChild(qd);
      });
      board.appendChild(col);
    });
    // SIDE-QUESTS column: the ideas & risks feed relocated from BASE — same board,
    // one click from home, so browsing propositions is a choice, not ambient noise.
    const feed = (S.side_quests || []);
    if (feed.length) {
      const urgent = feed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length;
      const col = el('div', 'qcol side');
      col.appendChild(el('h3', null, `<span class="dot"></span>Side-quests — ideas &amp; risks<span class="n">${feed.length}</span>`));
      feed.slice(0, 12).forEach((sq) => col.appendChild(sideQuestRow(sq, true)));
      if (urgent) col.firstChild.insertAdjacentHTML('beforeend', ` <span class="sec-n">${urgent} urgent</span>`);
      board.appendChild(col);
    }
    // Completed: celebration lives in the takeover + changes feed; here it's a slim
    // receipt strip, not a fourth column stealing board width.
    if (done.length) {
      const strip = el('div', 'qdone-strip');
      strip.innerHTML = `<span class="qds-lbl">✔ ${done.length} completed this scan</span>` +
        done.map((x) => `<span class="qds-item">${esc(x.title)} <b>+${x.xp}</b></span>`).join('');
      q.appendChild(strip);
    }
  }

  // ---------------------------------------------------------------- charts
  function lineChart(series, curDate) {
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
  function stackedBar(rows0, keys, colors, curDate) {
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
  function legend(items) { return '<div class="legend">' + items.map((i) => `<span><i style="background:${i.c}"></i>${esc(i.l)}</span>`).join('') + '</div>'; }
  function chartCard(title, now, inner) {
    const c = el('div', 'chart');
    c.appendChild(el('h3', null, `<span>${esc(title)}</span>${now != null ? `<span class="now">${now}</span>` : ''}`));
    c.insertAdjacentHTML('beforeend', inner); return c;
  }

  function renderTrends(S) {
    const tc = $('trends'); tc.innerHTML = '';
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

  // ------------------------------------------------------------ achievements
  // Trophies live inside STATS now ("HIGH SCORES") — one review tab, not two.
  // Must run AFTER renderTrends (which clears #trends).
  function renderAchievements(S) {
    const ac = $('trends');
    ac.appendChild(el('h2', 'sec', `🏆 High scores · ${(S.achievements || []).filter((x) => x.unlocked).length} unlocked`));
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

  // -------------------------------------------------------------- inventory
  // The warehouse lives inside MAP now — vaults/clones/graveyard ARE the base's
  // inventory. Must run AFTER renderBaseMap (which clears #basemap).
  function renderInventory(S) {
    const iv = $('basemap');
    const inv = S.inventory || {};
    iv.appendChild(el('h2', 'sec', '📦 Warehouse'));
    const wrap = el('div', 'invwrap'); iv.appendChild(wrap);
    const card = (title) => { const c = el('div', 'invcard'); c.appendChild(el('h3', null, title)); wrap.appendChild(c); return c; };

    if (inv.vaults?.length) {
      const c = card(`Knowledge vaults · ${inv.vaults.length}`);
      inv.vaults.forEach((v) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(v.name)}</span><span class="meta">${v.notes} notes</span><span class="pill">${esc(v.role)}</span>`)));
    }
    if (inv.clones?.length) {
      const c = card(`Reference clones · ${inv.clones.length}`);
      inv.clones.forEach((cl) => {
        const tag = cl.diverged ? `<span class="pill warn">${cl.dirty} diverged</span>` : `<span class="pill">clean</span>`;
        c.appendChild(el('div', 'invrow', `<span class="nm" title="${esc(cl.origin)}">${esc(cl.name.split('/').pop())}</span>${tag}`));
      });
    }
    if (inv.anomalies?.length) {
      const c = card(`Anomalies · ${inv.anomalies.length}`);
      inv.anomalies.forEach((an) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(an.detail)}</span><span class="pill ${an.severity === 'danger' ? 'dang' : an.severity === 'warning' ? 'warn' : ''}">${esc(an.severity)}</span>`)));
    }
    if (inv.duplicates?.length) {
      const c = card(`Duplicates & twins · ${inv.duplicates.length}`);
      inv.duplicates.forEach((dp) => c.appendChild(el('div', 'invrow', `<span class="nm">${esc(dp.detail)}</span><span class="pill warn">${esc(dp.type)}</span>`)));
    }
    const misc = [];
    if (inv.empty?.length) misc.push(`<div class="invrow"><span class="nm">Empty folders</span><span class="meta">${inv.empty.map(esc).join(', ')}</span></div>`);
    if (inv.trivial?.length) inv.trivial.forEach((t) => misc.push(`<div class="invrow"><span class="nm">${esc(t.name)}</span><span class="meta">${esc(t.note)}</span></div>`));
    if (misc.length) { const c = card('Trivial / empty'); c.insertAdjacentHTML('beforeend', misc.join('')); }

    // Graveyard (Wave 5) — archived projects with one-click revive
    if (S.archived_projects?.length) {
      const c = card(`Graveyard · ${S.archived_projects.length} archived`);
      S.archived_projects.forEach((ap) => {
        const row = el('div', 'invrow');
        row.innerHTML = `<span class="nm">⚰ ${esc(ap.name)}</span><span class="meta">archived ${esc(ap.archived_on || '')}</span>`;
        if (isElectron) {
          const b = el('button', 'qbtn', '↺ Revive');
          b.onclick = () => { window.hq.reviveProject(ap.id); };
          row.appendChild(b);
        }
        c.appendChild(row);
      });
    }

    // Recent learnings (Wave 5)
    if (S.recent_learnings?.length) {
      const c = card(`What I learned · ${S.account?.totals?.learnings || 0} total · +${S.account?.totals?.knowledge_xp || 0} KXP`);
      S.recent_learnings.forEach((l) => c.appendChild(el('div', 'invrow', `<span class="nm">📚 ${esc(l.text)}</span><span class="meta">${esc((l.ts || '').slice(0, 10))}</span>`)));
    }
    aosKids(wrap, 'fade-up', 60);
  }

  // ----------------------------------------------------------------- drawer
  function openDrawer(p, prevP) {
    const g = p.metrics.git_safety, ch = p.metrics.code_health, rs = p.metrics.risk_security;
    const d = $('drawer');
    const mt = (k, v) => `<div class="mtile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const dpc = prevP ? p.completion.pct - prevP.completion.pct : 0;

    // --- "Where was I?" re-entry briefing (cold-start ramp) ---
    const S = SCANS[cur];
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
    if (rf.includes('non-canonical-branch') || (g.flags && g.flags.includes('non-canonical-branch'))) {
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
      SFX.coin();
    };
    d.querySelectorAll('.re-file').forEach((b) => b.onclick = () => { if (window.hq && window.hq.openFile) window.hq.openFile(p.path, b.getAttribute('data-f')); });
    const sqWrap = $('dwr-sq');
    if (sqWrap) (p.side_quests || []).forEach((sq) => sqWrap.appendChild(sideQuestRow(sq, false)));
    if (isElectron) { const ob = $('dwr-open'); if (ob) ob.onclick = () => window.hq.openRepo(p.path); }
    if (isElectron) { const sb = $('dwr-snap'); if (sb) sb.onclick = () => window.hq.snapshot(p.path, p.name); }
    if (isElectron) {
      // ⋯ overflow menu (log/learn/archive live one click deeper, not in the bar)
      const moreBtn = $('dwr-more'), moreMenu = $('dwr-menu');
      if (moreBtn && moreMenu) {
        moreBtn.onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle('open'); };
        d.addEventListener('click', (e) => { if (!moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.classList.remove('open'); });
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
        if (c?.error) alert('Commit failed: ' + c.error); else SFX.coin();
      };
      const lb = $('dwr-learn');
      if (lb) lb.onclick = () => { const t = prompt(`I learned… (about ${p.name})`); if (t && t.trim()) { window.hq.learn(p.id, t.trim()); SFX.coin(); } };
      const db = $('dwr-decide');
      if (db) db.onclick = () => { const t = prompt(`Log a decision about ${p.name}:`); if (t && t.trim()) { window.hq.logDecision(p.id, t.trim()); SFX.coin(); } };
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
    SFX.open();
  }
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('open'); }
  $('scrim').onclick = closeDrawer;

  // ============================================================ isometric base map
  // Each project is a building on a 2:1 iso grid. Height ∝ completion, colour ∝ standing
  // (green→yellow→orange→red by completion / git-risk / build), floor-lines lit by
  // activity, a red pennant per open quest, a ⚠ if secrets were seen. Click → drawer.
  function shade(hex, amt) {            // amt<0 darkens, amt>0 lightens
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0;
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f + add))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(gg) + c(b);
  }
  function isoGround(cx, cy, fx, fy) {
    const pts = [[cx, cy - fy], [cx + fx, cy], [cx, cy + fy], [cx - fx, cy]].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<polygon points="${pts}" fill="#0e0b22" stroke="#241d44" stroke-width="0.7"/>`;
  }
  function isoBuilding(p, cx, cy, fx, fy, openQ, sqN) {
    const comp = p.completion?.pct ?? 0, h = 16 + comp * 0.85;
    const g = p.metrics.git_safety, ch = p.metrics.code_health, rs = p.metrics.risk_security;
    const riskHigh = g.risk === 'high' || ch.build === 'red';
    let base = riskHigh ? COL.red : comp < 40 ? COL.orange : comp < 75 ? COL.yellow : COL.green;
    // Decay tint: fade toward grey as days_since_commit grows. 0d full color, 90d+ ~grey.
    const dsc = p.activity?.days_since_commit ?? 0;
    const decayK = Math.min(1, dsc / 90) * 0.65;
    if (decayK > 0) base = shade(base, -decayK * 0.5);
    const top = base, left = shade(base, -0.40), right = shade(base, -0.20);
    const N = [cx, cy - fy - h], E = [cx + fx, cy - h], Sp = [cx, cy + fy - h], W = [cx - fx, cy - h];
    const Sg = [cx, cy + fy], Eg = [cx + fx, cy], Wg = [cx - fx, cy];
    const f1 = (v) => v.toFixed(1);
    const poly = (pp, fill, extra = '') => `<polygon points="${pp.map((q) => q.map(f1).join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
    let s = `<g class="bld" data-pid="${esc(p.id)}">`;
    s += `<ellipse cx="${f1(cx)}" cy="${f1(cy + fy + 3)}" rx="${fx}" ry="${f1(fy * 0.55)}" fill="#000" opacity="0.4"/>`;
    s += poly([W, Wg, Sg, Sp], left);
    s += poly([Sp, Sg, Eg, E], right);
    const lit = p.activity.state === 'active' ? '#fff3a0' : p.activity.state === 'stale' ? '#8a8550' : '#3a385a';
    const up = [Sp[0] - Sg[0], Sp[1] - Sg[1]];
    for (let v = 0.2; v < 0.95; v += 0.22) {
      const a = [Sg[0] + up[0] * v, Sg[1] + up[1] * v], b = [Eg[0] + up[0] * v, Eg[1] + up[1] * v];
      s += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${lit}" stroke-width="0.8" opacity="0.5"/>`;
    }
    s += poly([N, E, Sp, W], top, 'stroke="#0c0a1e" stroke-width="0.7"');
    if (openQ) s += `<g transform="translate(${f1(cx)},${f1(cy - fy - h - 7)})"><line x1="0" y1="-7" x2="0" y2="6" stroke="#d9d6ff" stroke-width="1"/><polygon points="0,-7 12,-4 0,-1" fill="${COL.red}"/><text x="3.5" y="-2.6" font-size="6" fill="#fff" font-family="monospace">${openQ}</text></g>`;
    if ((rs.secrets_found || 0) > 0) s += `<text x="${f1(cx + fx - 6)}" y="${f1(cy - h + 2)}" font-size="10" fill="${COL.gold}">⚠</text>`;
    // Time-blindness: ghost glyph on dormant (60d+), days-since chip on stale (30-60d)
    if (dsc >= 60) s += `<text x="${f1(cx - fx + 4)}" y="${f1(cy - h + 4)}" font-size="9" fill="#7a7099" opacity="0.85">👻</text>`;
    else if (dsc >= 14) s += `<text x="${f1(cx - fx + 2)}" y="${f1(cy - h + 4)}" font-size="6" fill="#7a7099" font-family="monospace">${dsc}d</text>`;
    const nm = p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name;
    s += `<text class="bpct" x="${f1(cx)}" y="${f1(cy - fy - h - 1.5)}" text-anchor="middle" font-size="7" fill="${base}" font-family="monospace">${comp}%</text>`;
    s += `<text class="blab" x="${f1(cx)}" y="${f1(cy + fy + 13)}" text-anchor="middle" font-size="6.5" fill="#cfcaf5">${esc(nm)}</text>`;
    return s + '</g>';
  }
  function mapLegend() {
    const it = (c, l) => `<span><i style="background:${c}"></i>${l}</span>`;
    return it(COL.green, 'healthy') + it(COL.yellow, 'mid') + it(COL.orange, 'low') + it(COL.red, 'at risk')
      + `<span><i class="penn" style="background:${COL.red}"></i>open quests</span><span><i style="background:${COL.gold}"></i>⚠ secrets</span>`
      + `<span>👻 dormant 60d+</span>`;
  }
  function renderBaseMap(S, prevProj) {
    const bm = $('basemap'); bm.innerHTML = '';
    const projs = [...S.projects];
    if (!projs.length) { bm.appendChild(el('div', 'empty-note', 'No products to map.')); return; }
    const openByProj = {}, sqByProj = {};
    (S.quests || []).filter((q) => q.status === 'open' || q.status === 'in_progress').forEach((q) => { openByProj[q.project_id] = (openByProj[q.project_id] || 0) + 1; });
    (S.side_quests || []).forEach((sq) => { sqByProj[sq.project_id] = (sqByProj[sq.project_id] || 0) + 1; });
    const n = projs.length, cols = Math.ceil(Math.sqrt(n));
    const tileW = 104, tileH = 52, fx = 32, fy = 16;
    const cells = projs.map((p, i) => { const gx = i % cols, gy = Math.floor(i / cols); return { p, gx, gy, cx: (gx - gy) * tileW / 2, cy: (gx + gy) * tileH / 2 }; });
    const hMax = 16 + 100 * 0.85;
    const xs = cells.map((c) => c.cx), ys = cells.map((c) => c.cy);
    const minX = Math.min(...xs) - fx - 16, maxX = Math.max(...xs) + fx + 16;
    const minY = Math.min(...ys) - fy - hMax - 18, maxY = Math.max(...ys) + fy + 24;
    cells.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.cx - b.cx);   // painter's: back-to-front
    let svg = `<svg class="isomap" viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" preserveAspectRatio="xMidYMid meet">`;
    function f(v) { return Number(v).toFixed(1); }
    cells.forEach((c) => { svg += isoGround(c.cx, c.cy, fx, fy); });
    cells.forEach((c) => { svg += isoBuilding(c.p, c.cx, c.cy, fx, fy, openByProj[c.p.id] || 0, sqByProj[c.p.id] || 0); });
    svg += '</svg>';
    const wrap = el('div', 'mapwrap');
    wrap.appendChild(el('div', 'maphead', `<h2 class="sec">Base map · ${n} buildings</h2><div class="maplegend">${mapLegend()}</div>`));
    const holder = el('div', 'mapholder'); holder.innerHTML = svg; wrap.appendChild(holder);
    bm.appendChild(wrap);
    holder.querySelectorAll('[data-pid]').forEach((grp) => {
      grp.onclick = () => { const p = S.projects.find((x) => x.id === grp.getAttribute('data-pid')); if (p) { SFX.open(); openDrawer(p, prevProj[p.id]); } };
    });
  }

  // ============================================================ celebration takeover
  let confettiRaf = 0;
  function fireConfetti(durationMs) {
    const cv = $('confetti'); if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const cols = ['#00f0ff', '#ff2bd6', '#ffd23f', '#3aff6e', '#b14aff', '#ff6bcb'];
    const parts = Array.from({ length: 150 }, (_, i) => ({
      x: W * 0.5 + (Math.random() - 0.5) * 160, y: H * 0.4,
      vx: (Math.random() - 0.5) * 10, vy: Math.random() * -11 - 3,
      g: 0.26 + Math.random() * 0.14, s: 4 + Math.random() * 5,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.5, c: cols[i % cols.length],
    }));
    const t0 = performance.now();
    cancelAnimationFrame(confettiRaf);
    const tick = (now) => {
      const elapsed = now - t0; x.clearRect(0, 0, W, H);
      parts.forEach((p) => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); x.restore(); });
      if (elapsed < durationMs) confettiRaf = requestAnimationFrame(tick); else x.clearRect(0, 0, W, H);
    };
    confettiRaf = requestAnimationFrame(tick);
  }
  function celebrate(items) {
    if (!items || !items.length) return;
    const to = $('takeover'), card = $('to-card'); if (!to || !card) return;
    const lvl = items.find((c) => c.type === 'level_up');
    const ach = items.filter((c) => c.type === 'new_achievement');
    const quests = items.filter((c) => c.type === 'quest_completed');
    const big = lvl ? 'LEVEL UP' : ach.length ? 'ACHIEVEMENT' : 'QUEST COMPLETE';
    const sub = lvl ? `L${lvl.level} · ${esc(lvl.title || '')}` : ach.length ? esc(ach[0].name || ach[0].achievement_id || 'Unlocked') : esc(quests[0]?.detail || '');
    const xpGain = items.reduce((acc, c) => acc + (c.xp || 0), 0);
    const rows = [];
    if (quests.length) rows.push(`<div class="to-row">✓ ${quests.length} quest${quests.length > 1 ? 's' : ''} complete</div>`);
    ach.forEach((c) => rows.push(`<div class="to-row"><span>${esc(c.icon || '🏆')} ${esc(c.name || c.achievement_id)}</span><b>+${c.xp || 0}</b></div>`));
    card.innerHTML = `<div class="to-big">${big}</div><div class="to-sub">${sub}</div>${xpGain ? `<div class="to-xp">+${xpGain} XP</div>` : ''}${rows.length ? `<div class="to-rows">${rows.join('')}</div>` : ''}<div class="to-hint">click to dismiss</div>`;
    to.classList.add('show'); to.setAttribute('aria-hidden', 'false');
    fireConfetti(2800);
    (lvl || ach.length) ? SFX.levelup() : SFX.coin();
    let done = false;
    const dismiss = () => {
      if (done) return; done = true;
      to.classList.remove('show'); to.setAttribute('aria-hidden', 'true');
      cancelAnimationFrame(confettiRaf);
      const c = $('confetti'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      to.removeEventListener('click', dismiss); clearTimeout(autoT);
    };
    const autoT = setTimeout(dismiss, 5400);
    to.addEventListener('click', dismiss);
  }
  function maybeCelebrate(S) {
    if (cur !== SCANS.length - 1) return;                 // only ever for the live snapshot
    const items = (S.changes_since_prev || []).filter((c) => ['level_up', 'new_achievement', 'quest_completed'].includes(c.type));
    if (!items.length) return;
    const sig = S.scan.id + '|' + items.map((c) => c.type + (c.quest_id || c.achievement_id || c.level || '')).sort().join(',');
    if (localStorage.getItem('hq-celebrated') === sig) return;   // already celebrated this exact set
    localStorage.setItem('hq-celebrated', sig);
    celebrate(items);
  }
  // demo hook so the takeover is viewable without waiting for a real level-up:
  // console: hqDemo('level'|'quest'|'ach')  ·  keyboard: Ctrl+Shift+L
  window.hqDemo = (kind) => {
    const a = SCANS[cur].account;
    if (kind === 'quest') return celebrate([{ type: 'quest_completed', detail: 'Put a project under version control', xp: 100 }]);
    if (kind === 'ach') return celebrate([{ type: 'new_achievement', name: 'No Loose Keys', icon: '🔑', xp: 60 }]);
    celebrate([{ type: 'level_up', level: a.level + 1, title: 'Overseer', xp: 0 }, { type: 'new_achievement', name: 'On a Roll', icon: '🔥', xp: 50 }]);
  };

  // ============================================================ shareable stat card (PNG)
  function exportStatCard() {
    const S = SCANS[cur], a = S.account, cv = $('cardcanvas'); if (!cv) return;
    const W = cv.width, H = cv.height, x = cv.getContext('2d');
    const bar = (bx, by, bw, bh, pct, fill) => { x.fillStyle = '#0c0a1e'; x.fillRect(bx, by, bw, bh); x.fillStyle = fill; x.fillRect(bx, by, bw * Math.max(0, Math.min(1, pct)), bh); x.strokeStyle = '#322a5e'; x.lineWidth = 2; x.strokeRect(bx, by, bw, bh); };
    x.fillStyle = '#07060f'; x.fillRect(0, 0, W, H);
    // border
    x.strokeStyle = '#5a4ea8'; x.lineWidth = 6; x.strokeRect(12, 12, W - 24, H - 24);
    x.strokeStyle = '#1a1538'; x.lineWidth = 2; x.strokeRect(24, 24, W - 48, H - 48);
    // header
    x.font = '700 38px "Courier New", monospace'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#00f0ff'; x.fillText('WORKSPACE', 50, 86);
    const wWidth = x.measureText('WORKSPACE').width;
    x.fillStyle = '#ff2bd6'; x.fillText('HQ', 50 + wWidth + 14, 86);
    x.font = '500 18px "Courier New", monospace'; x.fillStyle = '#9a93c9';
    x.fillText('PERSONAL OPS CONSOLE · ' + S.scan.id, 52, 116);
    // level block
    x.font = '700 110px "Courier New", monospace'; x.fillStyle = '#ffd23f'; x.fillText('LV ' + a.level, 50, 250);
    x.font = '700 34px "Courier New", monospace'; x.fillStyle = '#e8e6ff'; x.fillText((a.title || '').toUpperCase(), 54, 300);
    // bars
    x.font = '500 20px "Courier New", monospace';
    const xpPct = a.xp_to_next ? a.xp_into_level / (a.xp_into_level + a.xp_to_next) : 1;
    x.fillStyle = '#9a93c9'; x.fillText(`XP ${a.xp.toLocaleString()}`, 54, 350); bar(54, 360, 420, 22, xpPct, '#b14aff');
    const hp = a.health_index / 100; const hpc = a.health_index < 40 ? '#ff4757' : a.health_index < 70 ? '#ffa502' : '#3aff6e';
    x.fillStyle = '#9a93c9'; x.fillText(`HEALTH ${a.health_index}`, 54, 414); bar(54, 424, 420, 22, hp, hpc);
    // right column stats
    const t = a.totals, rx = 560;
    const stat = (label, val, yy, col) => { x.font = '700 46px "Courier New", monospace'; x.fillStyle = col; x.fillText(String(val), rx, yy); x.font = '500 16px "Courier New", monospace'; x.fillStyle = '#9a93c9'; x.fillText(label, rx, yy + 22); };
    stat('STREAK (days)', a.streak?.scan_days ?? 0, 210, '#ff6348');
    stat('PRODUCTS', t.products, 300, '#4d9fff');
    stat('OPEN QUESTS', t.open_quests, 390, '#ffa502');
    stat('TROPHIES', t.achievements_unlocked, 480, '#ffd23f');
    // footer: unlocked achievement names
    const names = (S.achievements || []).filter((q) => q.unlocked).map((q) => (ACH[q.id] || {}).name || q.id).slice(0, 4);
    x.font = '500 17px "Courier New", monospace'; x.fillStyle = '#5e588a';
    x.fillText('🏆 ' + (names.join('  ·  ') || 'no trophies yet'), 54, 512);
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `workspacehq-L${a.level}-${S.scan.id}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
    SFX.coin();
  }
  { const sc = $('share-card'); if (sc) sc.onclick = exportStatCard; }

  // ============================================================ One-Thing Mode
  let otTimer = null, otStart = 0, otQid = null;
  function enterOneThing(quest) {
    const S = SCANS[cur], tRank = { red: 0, orange: 1, yellow: 2 };
    const q = quest || (S.quests || []).filter((x) => x.status === 'open' || x.status === 'in_progress')
      .sort((x, y) => (tRank[x.tier] - tRank[y.tier]) || (y.xp - x.xp))[0];
    if (!q) return;
    const proj = (S.projects || []).find((p) => p.id === q.project_id);
    $('ot-quest').textContent = q.title;
    $('ot-proj').textContent = proj ? '↳ ' + proj.name : '';
    otQid = q.id; otStart = performance.now();
    const tick = () => { const s = Math.floor((performance.now() - otStart) / 1000); $('ot-timer').textContent = String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
    tick(); clearInterval(otTimer); otTimer = setInterval(tick, 1000);
    document.body.classList.add('focus-mode');
    const ot = $('onething'); ot.classList.add('show'); ot.setAttribute('aria-hidden', 'false');
    SFX.blip();
  }
  function exitOneThing(done) {
    const ot = $('onething'); if (!ot.classList.contains('show')) return;
    const mins = Math.round((performance.now() - otStart) / 60000);
    clearInterval(otTimer); otTimer = null;
    document.body.classList.remove('focus-mode'); ot.classList.remove('show'); ot.setAttribute('aria-hidden', 'true');
    console.log(`[one-thing] ${mins}m focused on ${otQid}`);
    if (done && isElectron && otQid) { SFX.coin(); window.hq.markQuestDone(otQid); }
    otQid = null;
  }
  { const ox = $('ot-exit'); if (ox) ox.onclick = () => exitOneThing(true); }

  // =================================================================== boot
  buildTimeMachine();
  render();

  if (isElectron && window.hq && window.hq.onDevStatus) {
    window.hq.onDevStatus((data) => {
      devState[data.id] = data.running;
      const cbtn = $('cdevbtn-' + data.id);
      if (cbtn) {
        cbtn.className = 'cdevbtn ' + (data.running ? 'running' : '');
        cbtn.title = data.running ? 'Stop Server' : 'Launch Server';
        cbtn.innerHTML = data.running ? '■' : '▶';
        cbtn.onclick = (e) => { e.stopPropagation(); window.hq[data.running ? 'devStop' : 'devStart'](data.id); };
      }
      const dbtn = $('dwr-devbtn-' + data.id);
      if (dbtn) {
        dbtn.className = 'ab-btn dwr-dev-btn ' + (data.running ? 'running' : '');
        dbtn.querySelector('b').textContent = data.running ? '■ STOP' : '▶ DEV';
        dbtn.onclick = () => window.hq[data.running ? 'devStop' : 'devStart'](data.id);
      }
    });
  }
})();
