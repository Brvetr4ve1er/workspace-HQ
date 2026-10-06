// Voice packs — the internet-culture layer riding the canon registers
// (charter PART I). JSON files under voice/, keyed by event type; the active
// theme's pack wins per-event, default fills the gaps. Line picks are
// DETERMINISTIC (fnv1a over seed+event): the economy's no-RNG invariant
// covers flavor text too — same scan, same line, goldens stay stable.
import defaultPack from './voice/default.json' with { type: 'json' };
import nightfallPack from './voice/nightfall.json' with { type: 'json' };

const PACKS = { default: defaultPack, nightfall: nightfallPack };

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// event: level_up | quest_completed | new_achievement | cast_ok | cast_fail |
// break_nudge | ambient. seed: any stable string (scan id, spell id + date).
export function voiceLine(event, seed = '') {
  const theme = document.documentElement.getAttribute('data-theme') || 'arcade';
  const pool = (PACKS[theme] && PACKS[theme][event]) || PACKS.default[event] || [];
  if (!pool.length) return null;
  return pool[fnv1a(seed + '|' + event) % pool.length];
}
