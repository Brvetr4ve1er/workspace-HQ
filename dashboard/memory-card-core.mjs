// Memory card (Settings, only while the Console layer is on) - the pure half. Read-only: it only COUNTS what the app keeps on this PC.
//
//   classify(relPath)        -> a kind id. Only the TOP-LEVEL name under data/ is looked at, against a fixed table of generic names; anything
//                               unmatched is 'other'. Names never leave main: nothing here returns one.
//   summarise(entries)       -> the ten slots, always in KINDS order: { kind, label, files, bytes, newestMs, partial }
//                               entry shapes (the walker in memory-card.js builds them; every one carries a `kind` or a `rel` to classify):
//                                 { kind|rel, size, mtimeMs }   one file
//                                 { kind|rel, partial: true }   something was not looked into (a cap or the depth limit): the slot is "at least"
//                                 { kind|rel, unreadable: true} a folder or file could not be looked at: the slot answers null ("could not look")
//   snapshotSummary(files)   -> { newestMs|null, kept } over [{ name, mtimeMs }] - only hub-YYYY-MM-DD.sqlite names take part
//   humanBytes(n), humanAge(thenMs, nowMs)    '12 MB', '3 h ago' (the renderer carries the same two words in vals/memory-card.js; a test pins both)
//
// A slot that cannot answer is null/null/null with partial:false - never a zero and never a guess. No file contents are ever read.
export const COULD_NOT_LOOK = 'could not look';

export const KINDS = Object.freeze([
  Object.freeze({ id: 'scans', label: 'Scans and history' }),
  Object.freeze({ id: 'brief', label: 'Brief' }),
  Object.freeze({ id: 'money', label: 'Money (counts only)' }),
  Object.freeze({ id: 'cosmos', label: 'Cosmos library' }),
  Object.freeze({ id: 'security', label: 'Security map (sizes only)' }),
  Object.freeze({ id: 'delivery', label: 'Delivery' }),
  Object.freeze({ id: 'chat-index', label: 'Claude chat index' }),
  Object.freeze({ id: 'logs', label: 'Logs' }),
  Object.freeze({ id: 'today-drift', label: 'Today and drift' }),
  Object.freeze({ id: 'other', label: 'Other' }),
]);

/** The fixed table: generic top-level names under data/ (lower-case) per kind. Everything else is 'other'. */
export const TABLE = Object.freeze({
  scans: Object.freeze(['latest.json', 'raw-metrics.json', 'enrichment.json', 'shards.json', 'spellbook.json', 'spellbook-enrichment.json', 'spell-telemetry.json',
    'weekly-recap.json', 'acted-on.json', 'quest-overrides.json', 'brain-dump.json', 'github.json', 'accounts.json', 'browser-activity.json', 'now-brief.md', 'canvas', 'history', 'backups']),
  brief: Object.freeze(['brief.json', 'brief-state.json', 'brief-ledger.json', 'intents']),
  money: Object.freeze(['money']),
  cosmos: Object.freeze(['cosmos']),
  security: Object.freeze(['security']),
  delivery: Object.freeze(['delivery', 'delivery.json']),
  'chat-index': Object.freeze(['claude']),
  logs: Object.freeze(['assistant-audit.jsonl', 'logs']),
  'today-drift': Object.freeze(['today.json', 'disk-history.json', 'pc-health.json', 'pc-health-history.json', 'pc-health-disk.json']),
});

const LOOKUP = new Map();   // a Map, never an object: a top-level name such as __proto__ must be 'other', not a lookup accident
for (const [kind, names] of Object.entries(TABLE)) for (const n of names) LOOKUP.set(n, kind);
const BY_ID = new Map(KINDS.map((k) => [k.id, k]));

/** The walk limits (memory-card.js reads these; the tests pin them). depth: how many levels below data/ are listed (a folder at that depth is counted as "not looked into"). */
export const LIMITS = Object.freeze({ depth: 3, entries: 5000, ms: 2000 });

/** hub-snapshot.js KEEP and claude-hub/snapshot.mjs NAME_RE, kept here so this module stays pure (memory-card-core.test.mjs pins both). */
export const SNAPSHOT_MAX = 7;
export const SNAPSHOT_NAME_RE = /^hub-(\d{4})-(\d{2})-(\d{2})\.sqlite$/;

export function classify(relPath) {
  const seg = String(relPath == null ? '' : relPath).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.')[0];
  if (!seg || seg === '..') return 'other';
  const name = seg.toLowerCase();
  const hit = LOOKUP.get(name);
  if (hit) return hit;
  if (/\.log$/.test(name)) return 'logs';
  return 'other';
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function summarise(entries) {
  const acc = new Map(KINDS.map((k) => [k.id, { files: 0, bytes: 0, newest: null, partial: false, unknown: false }]));
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object') continue;
    const a = acc.get(typeof e.kind === 'string' && BY_ID.has(e.kind) ? e.kind : classify(e.rel));
    if (e.unreadable === true) { a.unknown = true; continue; }
    if (e.partial === true) { a.partial = true; continue; }
    if (!isNum(e.size) || !isNum(e.mtimeMs)) { a.unknown = true; continue; }   // a file with no size or time cannot be counted honestly
    a.files += 1;
    a.bytes += e.size;
    if (a.newest === null || e.mtimeMs > a.newest) a.newest = e.mtimeMs;
  }
  return KINDS.map((k) => {
    const a = acc.get(k.id);
    return a.unknown
      ? { kind: k.id, label: k.label, files: null, bytes: null, newestMs: null, partial: false }
      : { kind: k.id, label: k.label, files: a.files, bytes: a.bytes, newestMs: a.newest, partial: a.partial };
  });
}

export function snapshotSummary(files) {
  let kept = 0, newest = null;
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.name !== 'string' || !SNAPSHOT_NAME_RE.test(f.name)) continue;
    kept += 1;
    if (isNum(f.mtimeMs) && (newest === null || f.mtimeMs > newest)) newest = f.mtimeMs;
  }
  return { newestMs: newest, kept };
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
/** 0 B, 512 B, 1.5 KB, 12 KB, 4.7 GB. Binary steps (1024), one decimal under 10, none above; a value that is not a size reads "could not look". */
export function humanBytes(n) {
  if (!isNum(n)) return COULD_NOT_LOOK;
  let v = n, i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; }
  if (i === 0) return Math.round(v) + ' B';
  let r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  if (r >= 1024 && i < UNITS.length - 1) { r = Math.round((v / 1024) * 10) / 10; i += 1; }   // 1023.9 KB reads as 1 MB, not 1024 KB
  return String(r) + ' ' + UNITS[i];
}

/** 'just now' (under a minute, or a clock a little ahead), '20 min ago', '3 h ago', '5 d ago'; 'unknown' when there is no time. */
export function humanAge(thenMs, nowMs) {
  if (!isNum(thenMs) || !isNum(nowMs)) return 'unknown';
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}
