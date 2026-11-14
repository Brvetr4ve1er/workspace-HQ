// Foldable surfaces (batch 7, "subtraction"): the mechanism that hides a surface NOBODY OPENED in 14 days, behind Settings > Show everything.
// PURE: no DOM, no storage, no clock, no IO. The renderer passes the pieces in and filters what it draws with the answers.
//
// The rule (the owner's brief): only a surface with ZERO opens in 14 days is hidden, and only by the measurement, never by a guess. Nothing is
// deleted: a folded surface is still reachable (the Go palette, a deep link, a number key) and Settings > Show everything brings it all back.
// Folding changes the RENDER only: a sub-tab leaves the sub bar, a space leaves the rail and the More list, a panel is not drawn.
//
// MEASURED_ZERO_14D is empty on purpose. Whoever reads the next `node tools/use-report.mjs` (the first real 14-day zero for the three new
// marks is readable on 2026-11-28) puts the ids that showed no open in the 14-day table here, and quotes that table in the commit. The
// per-viewer pref `foldIds` (a plain renderer pref, loadPrefs) can fold more; no screen edits it yet.
//
// decideFold({ measuredZero, ownerFolded, showEverything }) -> {
//   folded      Set of ids to HIDE now: (measuredZero U ownerFolded) minus everything when showEverything is on
//   hasFolded   true when something is set to be folded, EVEN WHILE showEverything is on (the Settings row must stay so it can be turned off)
//   candidates  Set of ids that would be hidden if showEverything were off
//   measured / owner   the two sources of the candidates, as Sets (an id may be in both)
//   showing     showEverything === true
//   names       the candidates' names in words, in FOLDABLE order
// }
// Ids that are not in FOLDABLE are ignored everywhere (a stale pref, a typo, a surface that was removed).
//
// Number keys: each space keeps the digit it has in the UNFOLDED nav order. navDigit() is computed from the original index and the fold filter
// runs after it (foldNav), the bottom nav is the original first four with a folded one dropped (bottomNav), and numberKeyTarget() reads the
// original order, so a key still goes to a folded space. cast-modes' goTable is not touched.

/** The four surfaces that can fold. `surface` is the hq:use mark that measures it (dashboard/use-log.js SURFACES). */
export const FOLDABLE = Object.freeze([
  Object.freeze({ id: 'projects/archived', kind: 'sub', surface: 'projects-archived' }),
  Object.freeze({ id: 'system/hub-panel', kind: 'panel', surface: 'system-hub-panel' }),
  Object.freeze({ id: 'automations/library', kind: 'sub', surface: 'automations-library' }),
  Object.freeze({ id: 'life', kind: 'space', surface: 'space-life' }),
]);

/**
 * Ids whose use mark showed ZERO opens over the last 14 days of `node tools/use-report.mjs`. Empty until measured: the shipped default hides
 * nothing. Quote the report's 14-day table in the commit that changes this array.
 */
export const MEASURED_ZERO_14D = Object.freeze([]);

/** Words for each id (Settings lists them). Kept beside FOLDABLE, not inside its entries. */
export const FOLD_LABELS = Object.freeze({
  'projects/archived': 'Projects › Archived',
  'system/hub-panel': 'System › Claude Hub panel',
  'automations/library': 'Automations › Library',
  life: 'Life',
});

export const SHOW_EVERYTHING_LABEL = 'Show everything';
export const LINE_MEASURED = 'Hidden because nobody opened them in 14 days (counted on this PC).';
export const LINE_OWNER = 'Hidden by you.';
export const LINE_NOTHING = 'Nothing is hidden: no surface has gone 14 days without being opened (counted on this PC).';

const ids = (foldable = FOLDABLE) => foldable.map((f) => f.id);

/** A list of ids, cleaned: strings only, known ids only, no repeats, FOLDABLE order. Never throws. */
export function sanitizeIds(list, foldable = FOLDABLE) {
  const want = new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  return ids(foldable).filter((id) => want.has(id));
}

/** The two renderer prefs, cleaned (app.js loads these from loadPrefs and saves them back): { showEverything: boolean, foldIds: string[] }. */
export function normalizeFoldPrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  return { showEverything: p.showEverything === true, foldIds: sanitizeIds(p.foldIds) };
}

/** What is folded right now. See the header for the returned fields. */
export function decideFold({ measuredZero = MEASURED_ZERO_14D, ownerFolded = [], showEverything = false, foldable = FOLDABLE } = {}) {
  const measured = new Set(sanitizeIds(measuredZero, foldable));
  const owner = new Set(sanitizeIds(ownerFolded, foldable));
  const candidates = new Set(ids(foldable).filter((id) => measured.has(id) || owner.has(id)));
  const showing = showEverything === true;
  return {
    folded: showing ? new Set() : new Set(candidates),
    hasFolded: candidates.size > 0,
    candidates, measured, owner, showing,
    names: [...candidates].map((id) => FOLD_LABELS[id] || id),
  };
}

/** True when `id` is folded in this decision (a decision, or its `folded` Set). */
export function isFolded(decisionOrSet, id) {
  const set = decisionOrSet instanceof Set ? decisionOrSet : decisionOrSet && decisionOrSet.folded;
  return !!set && typeof set.has === 'function' && set.has(id);
}

/** A use mark is sent only while its surface is NOT folded (a folded surface is not an arrival the owner chose to see). */
export const canMark = (decisionOrSet, id) => !isFolded(decisionOrSet, id);

/** The use-mark surface that measures `id` ('' for an id that cannot fold). */
export function surfaceOf(id, foldable = FOLDABLE) {
  const f = foldable.find((x) => x.id === id);
  return f ? f.surface : '';
}

// ----- nav -----

/** The number key a nav destination has: the first ten get 1..9 then 0; the rest none. `index` is the position in the UNFOLDED nav. */
export const navDigit = (index) => (index >= 0 && index < 10 ? String((index + 1) % 10) : '');

const foldedSpaces = (folded, foldable = FOLDABLE) => new Set(foldable.filter((f) => f.kind === 'space' && isFolded(folded, f.id)).map((f) => f.id));

/** The nav entries with their digit (from the original order) and original index; nothing is removed. */
export const withDigits = (nav) => nav.map((n, i) => Object.assign({}, n, { digit: navDigit(i), index: i }));

/** The rail's destinations: digits assigned FIRST, then the folded spaces dropped. Each kept space keeps its own digit. */
export function foldNav(nav, folded) {
  const gone = foldedSpaces(folded);
  return withDigits(nav).filter((n) => !gone.has(n.id));
}

/** The bottom nav's destinations: the ORIGINAL first four, a folded one simply dropped (the fifth does not move up). */
export function bottomNav(nav, folded) {
  const gone = foldedSpaces(folded);
  return withDigits(nav).slice(0, 4).filter((n) => !gone.has(n.id));
}

/** The More list: the original destinations from the fifth on, folded ones dropped, digits from the original order. */
export function moreNav(nav, folded) {
  const gone = foldedSpaces(folded);
  return withDigits(nav).slice(4).filter((n) => !gone.has(n.id));
}

/** Which nav id a number key reaches ('0' = the tenth). It reads the ORIGINAL order, so a folded space is still reached. */
export function numberKeyTarget(nav, key) {
  if (typeof key !== 'string' || !/^[0-9]$/.test(key)) return null;
  const n = nav[key === '0' ? 9 : Number(key) - 1];
  return n ? n.id : null;
}

/** A space's sub tabs, `[[id, label], ...]`, minus the folded ones. */
export function foldSubs(space, subs, folded) {
  return (subs || []).filter((s) => !isFolded(folded, space + '/' + s[0]));
}

/**
 * Where a route lands. A folded space or sub is still resolvable: a deep link and the Go palette keep reaching it (reversible, never
 * unreachable). `folded` tells the caller it is hidden from the rail / sub bar. Unknown tab or sub: { ok: false }.
 */
export function resolveTarget({ nav, subs, tab, sub, folded }) {
  const n = (nav || []).find((x) => x.id === tab);
  if (!n) return { ok: false, tab: null, sub: null, folded: false };
  const list = (subs && subs[tab]) || [];
  if (sub !== undefined && sub !== null && !list.some((s) => s[0] === sub)) return { ok: false, tab, sub: null, folded: false };
  const hidden = isFolded(folded, tab) || (sub ? isFolded(folded, tab + '/' + sub) : false);
  return { ok: true, tab, sub: sub || null, folded: hidden };
}

// ----- Settings -----

/** The quiet line under the row. Always has an answer: with nothing folded it says so. */
export function foldLine(decision) {
  const d = decision || decideFold();
  if (!d.hasFolded) return LINE_NOTHING;
  const parts = [];
  if (d.measured.size) parts.push(LINE_MEASURED);
  if ([...d.owner].some((id) => !d.measured.has(id))) parts.push(LINE_OWNER);
  return parts.join(' ');
}

/**
 * The Settings row, or null when nothing is set to fold (then Settings has no Show-everything row at all). The row stays while Show everything
 * is on, because that is where it is turned off. { label, desc, on } fits the settings switch shape (label, desc, state); the caller adds toggle.
 */
export function foldRow(decision) {
  const d = decision || decideFold();
  if (!d.hasFolded) return null;
  return {
    label: SHOW_EVERYTHING_LABEL,
    desc: (d.showing ? 'Showing: ' : 'Hidden: ') + d.names.join(', ') + '. ' + foldLine(d),
    on: d.showing,
  };
}
