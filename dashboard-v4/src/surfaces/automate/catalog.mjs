// catalog.mjs — the PURE brain of the AUTOMATE arsenal (v4.1 S4).
// No DOM, no clocks beyond Date.parse on stored strings, no imports: filter /
// sort / usage-tier logic over the spellbook sidecar, unit-tested by
// catalog.test.mjs under node --test.
//
// Ported CONTENT from dashboard-v3/src/realms/grimoire/view.js (the filter and
// usage semantics are v3's, verbatim where they were pure), rebuilt as a
// standalone module so the v4 surface owns its whole seam.

// Plain category labels for the internal "school" ids the data still carries
// (v4 idiom: no lexicon — school -> category).
export const CATEGORY = {
  divination: 'Analyze', conjuration: 'Generate', transmutation: 'Build',
  abjuration: 'Secure', evocation: 'Execute', illusion: 'Design',
  enchantment: 'Notify', restoration: 'Fix',
};
export const catLabel = (k) => CATEGORY[k] || 'Other';

// Friendly labels for the internal source ids (filter + row meta).
export const SOURCE_LABEL = {
  all: 'All', grimoire: 'Built-in', skill: 'Skills', command: 'Commands',
  script: 'Scripts', npm: 'npm', task: 'Tasks', plugin: 'Plugins',
};
export const srcLabel = (k) => SOURCE_LABEL[k] || String(k ?? '');
export const SOURCES = ['all', 'grimoire', 'skill', 'command', 'script', 'npm', 'task', 'plugin'];

// Plain labels for the internal kind ids.
export const KIND_LABEL = { castable: 'Runnable', channeled: 'Interactive', tome: 'Plugin', chain: 'Chain' };
export const kindLabel = (k) => KIND_LABEL[k] || String(k ?? '');

// `run` = one-shot scripts/tasks/chains fired directly; `interactive` = skills
// that open a session; `plugin` = reference-only entries.
export const kindMatch = (s, k) =>
  k === 'all' ||
  (k === 'run' && (s.kind === 'castable' || s.kind === 'chain')) ||
  (k === 'interactive' && s.kind === 'channeled') ||
  (k === 'plugin' && s.kind === 'tome');

// Directly runnable / castable-at-all predicates (RUN button gating).
export const isRunnable = (s) => s.kind === 'castable' || s.kind === 'chain';
export const isCastable = (s) => isRunnable(s) || s.kind === 'channeled';

// Usage tiers: distinct days an automation has been run (real telemetry,
// shown as filled/empty dots — not decoration).
export const USAGE_TIERS = [
  { rank: 'Novice', days: 1 }, { rank: 'Adept', days: 5 }, { rank: 'Expert', days: 15 },
  { rank: 'Master', days: 40 }, { rank: 'Grandmaster', days: 100 },
];

// distinct_days arrives in TWO shapes: the build-time sidecar keeps the array
// of dates; hq.getSpellTelemetry() flattens it to a count. Normalize both.
export function usageDays(rollup, id) {
  const d = rollup?.[id]?.distinct_days;
  if (Array.isArray(d)) return d.length;
  const n = Number(d);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function usageOf(rollup, id) {
  const days = usageDays(rollup, id);
  let pips = 0;
  for (const t of USAGE_TIERS) if (days >= t.days) pips++;
  return { days, pips, rank: pips ? USAGE_TIERS[pips - 1].rank : null };
}

export function lastCastOf(rollup, id) {
  // '' (not 0): Date.parse(0) coerces to the string '0' and parses as a year
  return Date.parse(rollup?.[id]?.last_cast || '') || 0;
}

// ---- filter state ----------------------------------------------------------
export function defaultFilters() {
  return {
    search: '', category: 'all', source: 'all',
    kind: 'all', usage: 'all', scheduled: false, favOnly: false,
    sort: 'used',                         // 'used' | 'recent' | 'name'
  };
}

export function filtersDirty(f) {
  const d = defaultFilters();
  return Object.keys(d).some((k) => f[k] !== d[k]);
}

// ---- the cut ---------------------------------------------------------------
// Filter + sort the catalog. Favorites always sort first (they are the user's
// own pin, and the first screen is what you actually reach for), then the
// chosen sort: most-used (tier desc, recency tiebreak) / recent / name.
export function filterSpells(spells, f, { rollup, favorites } = {}) {
  const favSet = new Set(Array.isArray(favorites) ? favorites : []);
  const q = String(f.search || '').toLowerCase();
  const hits = (Array.isArray(spells) ? spells : []).filter((s) =>
    s && typeof s === 'object' &&
    (f.category === 'all' || s.school === f.category) &&
    (f.source === 'all' || s.source === f.source || (f.source === 'plugin' && s.kind === 'tome')) &&
    kindMatch(s, f.kind) &&
    (!f.scheduled || !!s.schedule) &&
    (!f.favOnly || favSet.has(s.id)) &&
    (f.usage === 'all' || (f.usage === 'used') === (usageDays(rollup, s.id) > 0)) &&
    (!q || `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(q)));

  const fav = (s) => (favSet.has(s.id) ? 0 : 1);
  if (f.sort === 'name') {
    hits.sort((x, y) => fav(x) - fav(y) || String(x.name).localeCompare(String(y.name)));
  } else if (f.sort === 'recent') {
    hits.sort((x, y) => fav(x) - fav(y) || (lastCastOf(rollup, y.id) - lastCastOf(rollup, x.id)));
  } else {
    hits.sort((x, y) => fav(x) - fav(y) ||
      (usageOf(rollup, y.id).pips - usageOf(rollup, x.id).pips) ||
      (lastCastOf(rollup, y.id) - lastCastOf(rollup, x.id)));
  }
  return hits;
}

// Cooldown text for scheduled automations ([data-cd] nodes).
export function fmtCd(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'ready';
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h ? `${h}h ${m}m` : `${m}m`;
}
