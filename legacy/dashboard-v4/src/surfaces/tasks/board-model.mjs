// board-model.mjs — PURE. Turns a scan snapshot into the TASKS board model:
// the full intel/queue.mjs queue, SECTIONED the way v3's War Room sectioned its
// SITROOM board, plus the two derived numbers the header needs and the blip
// list the 3D radar will consume.
//
// No DOM, no Date.now(), no globals — same firewall as intel/, so it runs under
// `node --test` (board-model.test.mjs).
//
// WHY TWO SOURCES. `buildQueue()` is the data and the VERB CONTRACT: it decides
// what is on the board and which verbs are honest for each row. It does not
// carry `blastRadius`, because nothing in the WORK rail needed it. The SITROOM
// presentation the user misses does: the blast bar is the one thing that
// discriminates between two "uncommitted" rows. So triage() is read a second
// time purely to recover that number and it is JOINED back onto the queue's own
// threat rows by the id scheme queue.mjs documents (`threat:<projectId>:<kind>`).
// The join never invents a row: an unmatched threat simply gets no bar.
import { buildQueue } from '../../intel/queue.mjs';
import { triage } from '../../intel/derive.mjs';

// Per-kind ABSOLUTE blast ceilings, mirroring derive.triage()'s formulas — the
// same table legacy/dashboard-v3/src/realms/warroom/warroom-model.mjs locks, and for
// the same reason: a blast-RELATIVE denominator is not comparable across
// snapshots, so rotating the worst secret would make every other bar jump with
// no change in the world. In an app with a time-machine scrubber that is a lie.
// Anchoring to the per-kind maximum keeps each bar snapshot-stable and makes it
// discriminate WITHIN its category.
//   security     100 + secrets            -> 105 at the 5-secret mark
//   uncommitted   50 + min(dirty, 40)     ->  90 hard cap
//   stale         20 + min(days, 60) / 2  ->  50 hard cap
//   no-tests      15 (fixed)   no-ci  10 (fixed)
const KIND_MAX = { security: 105, uncommitted: 90, stale: 50, 'no-tests': 15, 'no-ci': 10 };
const KIND_MAX_FALLBACK = 105;          // unknown kind: treat as the worst-case ceiling

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Board sections in render order. Threat sections split by KIND (which is what
// queue.mjs parks in a threat row's `detail`); the other three sections are one
// per queue SOURCE. `mode` is the weight a section renders at — a "no CI" chip
// has never deserved the same pixel budget as a leaked credential:
//   card   full card, blast bar, every verb
//   row    one compact line (the long tail)
//   rollup the whole section collapsed into a single hand-off control
export const GROUPS = [
  { id: 'security',    label: 'SECURITY',    word: 'security',    source: 'threat', kinds: ['security'],            mode: 'card' },
  { id: 'uncommitted', label: 'UNCOMMITTED', word: 'uncommitted', source: 'threat', kinds: ['uncommitted'],         mode: 'card' },
  { id: 'stale',       label: 'STALE',       word: 'stale',       source: 'threat', kinds: ['stale'],               mode: 'row' },
  { id: 'hygiene',     label: 'HYGIENE',     word: 'hygiene',     source: 'threat', kinds: ['no-tests', 'no-ci'],   mode: 'rollup' },
  { id: 'task',        label: 'TASKS',       word: 'tasks',       source: 'task',   mode: 'card' },
  { id: 'gap',         label: 'GAPS',        word: 'gaps',        source: 'gap',    mode: 'row' },
  { id: 'idea',        label: 'IDEAS',       word: 'ideas',       source: 'idea',   mode: 'row' },
];

// Severity order, worst first. A CLOSED list: queue.mjs guarantees the enum, so
// anything else is 'dim' by construction and can never colour the hero.
const SEV_ORDER = ['red', 'orange', 'yellow'];

function blastIndex(selected) {
  const byId = new Map();
  let rows = [];
  try { rows = triage(selected) || []; } catch { rows = []; }
  for (const r of rows) {
    if (!r) continue;
    byId.set(`threat:${r.projectId}:${r.kind}`, r.blastRadius);
  }
  return byId;
}

// `null` means "no reading" and the view draws no bar at all — deliberately
// NOT 0%, which would render as the clamped 4% hairline and read as "measured,
// and almost nothing". null/undefined are rejected BEFORE Number(), because
// Number(null) is 0 and would quietly become that lie.
export function hpPct(blastRadius, kind) {
  if (blastRadius == null) return null;
  const max = KIND_MAX[kind] || KIND_MAX_FALLBACK;
  const n = Number(blastRadius);
  if (!Number.isFinite(n) || !(max > 0)) return null;
  return clamp(Math.round((n / max) * 100), 4, 100);
}

// buildBoard(selected) -> {
//   items, counts,            // exactly what buildQueue returned (+ threat extras)
//   total,                    // every row on the board
//   flagged,                  // rows carrying a severity — the HERO number
//   worstSev,                 // 'red'|'orange'|'yellow'|'dim'
//   groups: [{...GROUPS[i], items, count, kinds?}],
//   shape,                    // "3 security · 4 uncommitted · …" (mixed case)
//   radar,                    // [{idx, angle, radius, sev}] for the 3D accent
// }
// Null/garbage input yields an empty board and never throws.
export function buildBoard(selected) {
  let q = { items: [], counts: {} };
  try { q = buildQueue(selected) || { items: [], counts: {} }; } catch { q = { items: [], counts: {} }; }
  const raw = Array.isArray(q.items) ? q.items : [];
  const blast = blastIndex(selected);

  // Threat rows gain `kind` (lifted out of queue.mjs's `detail` so the view
  // never has to know that overload) plus the joined blast figures.
  const items = raw.map((it) => {
    if (!it || it.source !== 'threat') return it;
    const kind = it.detail || '';
    const b = blast.get(it.id);
    return { ...it, kind, blastRadius: b ?? null, hpPct: b == null ? null : hpPct(b, kind) };
  });

  const groups = GROUPS.map((g) => {
    const mine = items.filter((it) => it && it.source === g.source
      && (!g.kinds || g.kinds.includes(it.kind || it.detail || '')));
    return { ...g, items: mine, count: mine.length };
  });

  const flagged = items.filter((it) => it && it.severity && it.severity !== 'dim').length;
  const worstSev = SEV_ORDER.find((s) => items.some((it) => it && it.severity === s)) || 'dim';
  const shape = groups.filter((g) => g.count).map((g) => `${g.count} ${g.word}`).join(' · ');

  // Radar blips, ported from warroom-model.mjs. Radius is PORTFOLIO-relative
  // (this threat's blast against the worst one), deliberately NOT hpPct: hpPct
  // is per-kind absolute, so a `no-ci` row scores 100 there and would land dead
  // centre. On a radar centre = closest = worst, so the mapping runs 0.95 (calm,
  // at the rim) down to 0.35 (worst, at the eye).
  const threats = items.filter((it) => it && it.source === 'threat');
  const maxBlast = threats.reduce((m, t) => Math.max(m, Number(t.blastRadius) || 0), 0) || 1;
  const n = threats.length;
  const radar = threats.map((t, idx) => ({
    idx,
    angle: (idx / n) * Math.PI * 2,
    radius: 0.95 - 0.6 * clamp((Number(t.blastRadius) || 0) / maxBlast, 0.04, 1),
    sev: t.severity || 'dim',
  }));

  return { items, counts: q.counts || {}, total: items.length, flagged, worstSev, groups, shape, radar };
}
