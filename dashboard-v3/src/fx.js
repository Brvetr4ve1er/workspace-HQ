// NEXUS fx — the app-lifetime juice layer: chiptune SFX engine, celebration
// takeover + confetti, shareable stat-card exporter, cast-stream feed.
// VERBATIM ports of dashboard/app.js's SFX / celebration / exporter blocks;
// only the plumbing changed (closure globals SCANS/cur → the data singleton,
// button onclicks → bus events, pre-seeded HTML nodes → programmatic DOM under
// #overlays). This module is a singleton, not a realm: it never unmounts, so
// its bus/hq subscriptions intentionally live for the whole app (same lifetime
// v2 gave them) — IPC-CONTRACT rule 4 applies to realms, not here.
import { bus } from './core/bus.js';
import { data } from './core/data.js';
import { el, esc } from './ui/util.js';
import { setSfx, ACH, castBlocks, castlogLine, showCastlog } from './ui/components.js';
import { voiceLine } from './lexicon/voice.js';

const $ = (id) => document.getElementById(id);

// ---- chiptune SFX: tiny WebAudio square-wave bleeps, off by default ----
// v2-verbatim engine + cue table. The ♪ toggle button is chrome's; it emits
// 'fx:sfx-toggle' and can repaint from localStorage right after — bus.emit is
// synchronous, so the new 'hq-sfx' value is persisted before emit() returns.
let audioCtx = null, sfxOn = localStorage.getItem('hq-sfx') === '1';
function beep(notes) {                // notes: [freqHz, durSec, startOffsetSec]
  if (!sfxOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    notes.forEach(([f, d, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.035, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + at); o.stop(t0 + at + d + 0.02);
    });
  } catch { /* no audio device — stay silent */ }
}
const CUES = {
  blip: () => beep([[660, 0.06, 0]]),                       // tab switch
  move: () => beep([[440, 0.05, 0], [554, 0.05, 0.05]]),    // snapshot scrub
  coin: () => beep([[988, 0.07, 0], [1319, 0.18, 0.08]]),   // quest done
  open: () => beep([[523, 0.06, 0], [784, 0.08, 0.06]]),    // drawer open
  // rising arpeggio fanfare for level-ups / new achievements
  levelup: () => beep([[523, 0.09, 0], [659, 0.09, 0.09], [784, 0.09, 0.18], [1047, 0.28, 0.27], [1319, 0.34, 0.4]]),
  badge: () => beep([[784, 0.08, 0], [1047, 0.08, 0.08], [1319, 0.22, 0.16]]),  // achievement pop
  fizzle: () => beep([[220, 0.14, 0], [164, 0.26, 0.12]]),                       // failed cast (descending groan)
};
const sfx = (cue) => { CUES[cue]?.(); };

// ============================================================ celebration takeover
// v2 pre-seeded #takeover/#confetti/#to-card in index.html; v3's index.html is
// chrome-only, so the takeover self-anchors under #overlays once at init.
function ensureTakeover() {
  if ($('takeover')) return;
  const to = el('div', null, '<canvas id="confetti"></canvas><div class="to-card" id="to-card"></div>');
  to.id = 'takeover';
  to.setAttribute('aria-hidden', 'true');
  ($('overlays') || document.body).appendChild(to);
}

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
function celebrate(items, seed = '') {
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
  // voice pack line — theme-scoped flavor, deterministic per (seed, event)
  const voice = voiceLine(lvl ? 'level_up' : ach.length ? 'new_achievement' : 'quest_completed', seed);
  card.innerHTML = `<div class="to-big">${big}</div><div class="to-sub">${sub}</div>${voice ? `<div class="to-voice">${esc(voice)}</div>` : ''}${xpGain ? `<div class="to-xp">+${xpGain} XP</div>` : ''}${rows.length ? `<div class="to-rows">${rows.join('')}</div>` : ''}<div class="to-hint">click to dismiss</div>`;
  to.classList.add('show'); to.setAttribute('aria-hidden', 'false');
  fireConfetti(2800);
  (lvl || ach.length) ? sfx('levelup') : sfx('coin');
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
// v2's anti-celebration-storm guards, exactly: live snapshot only, celebrated
// change types only, and the 'hq-celebrated' signature dedupes the exact set.
// (Chrome's Escape handler may strip .show early; the 5400ms auto-dismiss
// still runs the full cleanup afterwards — same as v2.)
function maybeCelebrate(S) {
  if (!S || !S.scan) return;
  if (!data.isLatest) return;                           // only ever for the live snapshot
  const items = (S.changes_since_prev || []).filter((c) => ['level_up', 'new_achievement', 'quest_completed'].includes(c.type));
  if (!items.length) return;
  const sig = S.scan.id + '|' + items.map((c) => c.type + (c.quest_id || c.achievement_id || c.level || '')).sort().join(',');
  if (localStorage.getItem('hq-celebrated') === sig) return;   // already celebrated this exact set
  localStorage.setItem('hq-celebrated', sig);
  celebrate(items, S.scan.id);
}

// ============================================================ shareable stat card (PNG)
// Offscreen 1000x560 canvas → PNG download. Created programmatically (v2
// pre-seeded #cardcanvas in index.html); kept in the DOM, hidden, like v2.
let cardCv = null;
function cardCanvas() {
  if (!cardCv) {
    cardCv = document.createElement('canvas');
    cardCv.id = 'cardcanvas'; cardCv.width = 1000; cardCv.height = 560;
    cardCv.style.display = 'none';
    ($('overlays') || document.body).appendChild(cardCv);
  }
  return cardCv;
}
function exportStatCard() {
  const S = data.selected;
  if (!S || !S.account || !S.account.totals || !S.scan) return;
  const a = S.account, cv = cardCanvas(); if (!cv) return;
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
  x.fillStyle = '#9a93c9'; x.fillText(`XP ${(a.xp ?? 0).toLocaleString()}`, 54, 350); bar(54, 360, 420, 22, xpPct, '#b14aff');
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
  sfx('coin');
}

// ---- cast-stream feed: the onCastOutput/onCastDone wiring components.js
// deliberately left open (its castBlocks export exists for exactly this).
// v2-verbatim lines 547-571; absent in the dev harness (no bridge = no-op).
function wireCastStream() {
  if (!window.hq?.onCastOutput || !window.hq?.onCastDone) return;
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
    ok ? sfx('coin') : sfx('fizzle');
  });
}

// ============================================================ init
let inited = false;
export function initFx() {
  if (inited) return;   // boot calls once; guard keeps a stray re-import harmless
  inited = true;
  setSfx(sfx);
  // v2's #sfx-toggle onclick, minus the paint (the button is chrome's):
  // flip, persist, confirmation blip (audible only when flipping ON — beep
  // checks the new state, exactly like v2).
  bus.on('fx:sfx-toggle', () => { sfxOn = !sfxOn; localStorage.setItem('hq-sfx', sfxOn ? '1' : '0'); beep([[880, 0.08, 0]]); });
  ensureTakeover();
  // v2 called maybeCelebrate(S) at the tail of every render(): once on load,
  // then on each scrub — mirror both trigger points.
  maybeCelebrate(data.selected);
  bus.on('data:select', () => maybeCelebrate(data.selected));
  bus.on('fx:export-card', () => exportStatCard());
  wireCastStream();
  // demo hook so the takeover is viewable without waiting for a real level-up:
  // console: hqDemo('level'|'quest'|'ach')  ·  the Ctrl+Shift+L binding is chrome's
  window.hqDemo = (kind) => {
    const a = data.selected?.account || { level: 0 };
    if (kind === 'quest') return celebrate([{ type: 'quest_completed', detail: 'Put a project under version control', xp: 100 }]);
    if (kind === 'ach') return celebrate([{ type: 'new_achievement', name: 'No Loose Keys', icon: '🔑', xp: 60 }]);
    celebrate([{ type: 'level_up', level: a.level + 1, title: 'Overseer', xp: 0 }, { type: 'new_achievement', name: 'On a Roll', icon: '🔥', xp: 50 }]);
  };
}
