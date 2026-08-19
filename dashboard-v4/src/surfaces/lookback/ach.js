// ach.js — the achievement CATALOG (static flavour), ported verbatim from v3
// ui/components.js. The scan only stores `{id, unlocked, unlocked_on, progress}`;
// the human name, the icon and the unlock criteria live here.
//
// Icons are hand-placed 16×16 pixel-art SVGs (developer-authored constants, NOT
// scan data) so the trophy grid stays crisp at any zoom and locked badges can be
// desaturated with a CSS filter. Because they are markup, they are injected raw
// wherever they render — that is deliberate and safe: nothing here is derived
// from a scan, a session, or any user input. Never "fix" it into esc(icon);
// that would turn the SVG into visible tags.
//
// Ported into this directory rather than shared: LOOKBACK is the only surface
// that renders trophies, and v4's rule is that a surface owns its own content
// tables until a second consumer appears.

const pxi = (inner) => `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" class="lb-px">${inner}</svg>`;

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
  liftoff:        { name: 'Liftoff',            icon: PX.rocket,  desc: 'Push a repo to a remote for the first time.' },
  in_sync:        { name: 'Clean Slate',        icon: PX.sparkle, desc: 'Get a repo to zero uncommitted files.' },
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

// OWN-KEY ONLY. The id comes from scan data and ACH is a plain object literal,
// so it inherits Object.prototype: a bare `ACH[id]` for an id like 'constructor',
// 'toString' or '__proto__' resolves to an INHERITED function/object, which is
// truthy — the caller's `|| fallback` never fires and the grid renders
// "Object" as an achievement name. v3's nudge strip had this guard; v3's trophy
// grid did not. Every lookup in this surface goes through here.
export function achMeta(id) {
  return Object.hasOwn(ACH, id) ? ACH[id] : null;
}

// Display-ready meta for a trophy card: the catalog entry, or an honest
// fallback built from the raw id for an achievement the catalog hasn't learned
// about yet (the scan is the source of truth for WHICH achievements exist).
export function achMetaOrFallback(id) {
  return achMeta(id) || { name: String(id ?? '').replace(/_/g, ' ') || 'unknown', icon: PX.trophy, desc: '' };
}
