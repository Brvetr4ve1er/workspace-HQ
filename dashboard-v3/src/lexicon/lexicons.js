// Lexicon tables — canon terms ride the theme (docs/CANON.md). Display-level
// only; the data contract never changes. Ported VERBATIM from dashboard/app.js
// so default-theme labels stay byte-identical (M0 parity requirement). The one
// addition is tab_forge: the Forge realm is new in v3 (Products split out of
// the old overview), so it needs a label in both registers.
export const LEXICONS = {
  default: {
    tab_overview: 'BASE', tab_quests: 'QUESTS', tab_spellbook: 'SPELLBOOK', tab_trends: 'STATS', tab_basemap: 'MAP',
    tab_forge: 'PRODUCTS',
    focus: '◎ FOCUS', stage: 'STAGE SELECT', hp_word: 'HP', streak_word: 'STREAK', xp_unit: 'XP',
    today: 'Today — pick one', pulse: 'Pulse', changes: 'Changes since', saga: '📜 Weekly Saga',
    working_now: 'WORKING ON NOW',
    products: 'Products', arsenal: '📖 Arsenal', spells_known: 'spells known',
    familiars: '🐦‍⬛ Familiars', familiars_bound: 'bound',
    tier_red: 'Red — loss & breakage', tier_orange: 'Orange — before production', tier_yellow: 'Yellow — housekeeping',
    side_col: 'Side-quests — ideas &amp; risks', done_strip: 'completed this scan',
    memorials: '🏆 High scores', warehouse: '📦 Warehouse', basemap_head: 'Base map', buildings: 'buildings',
    blessing_head: '🌳 Completion grove', fragment_word: 'day-fragments', classes: false,
    amb_machine: 'MACHINE', amb_whisper: 'SIDE-QUEST', amb_familiar: 'CLAUDE',
    amb_familiar_idle: 'no sessions running',
    tab_medbay: 'MED-BAY', tab_observatory: 'OBSERVATORY', tab_watchtower: 'WATCHTOWER', tab_summoning: 'SUMMONING',
  },
  nightfall: {
    tab_overview: 'ROUNDTABLE', tab_quests: 'HUNTS', tab_spellbook: 'GRIMOIRE', tab_trends: 'LEGACY', tab_basemap: 'LANDS BETWEEN',
    tab_forge: 'THE FORGE',
    focus: '◎ THE HUNT', stage: 'MEMORY OF GRACE', hp_word: 'VIT', streak_word: 'EMBER', xp_unit: 'RUNES',
    today: 'Tonight&#8217;s Hunt — choose one', pulse: 'Vitality', changes: 'Since last grace', saga: '📜 The Saga',
    working_now: 'THE PURSUIT AT HAND',
    products: 'Legacy Dungeons', arsenal: '📖 Grimoire', spells_known: 'incantations known',
    familiars: '👻 Spirit Summons', familiars_bound: 'bound',
    tier_red: 'Night Hunts — loss & breakage', tier_orange: 'Blood Hunts — before production', tier_yellow: 'Ember Hunts — housekeeping',
    side_col: 'Whispers — ideas &amp; risks', done_strip: 'hunts completed this scan',
    memorials: '🏆 Memorials', warehouse: '📦 The Warehouse', basemap_head: 'The Lands Between', buildings: 'holdings',
    blessing_head: '🌳 Scadutree Blessing', fragment_word: 'fragments', classes: true,
    amb_machine: 'THE VESSEL', amb_whisper: 'WHISPER', amb_familiar: 'FAMILIAR',
    amb_familiar_idle: 'unbound — the bell is silent',
    tab_medbay: 'THE WARD', tab_observatory: 'OBSERVATORY', tab_watchtower: 'THE SPIRE', tab_summoning: 'THE CIRCLE',
  },
};
