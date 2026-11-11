// Today ribbon, the Claude lane's source: which 5-minute blocks of a window had at least one user or assistant turn, per project.
// A pure function over an open node:sqlite handle, so store.mjs gets a one-line method (`activityBuckets(a) { return activityBuckets(db, a); }`)
// and hub.mjs a one-line op (`activityBuckets: (a) => { if (!store) throw new Error('the index is not open yet'); return store.activityBuckets(a || {}); }`).
// Additive: INDEX_VERSION and the schema do not move; it uses the existing message_at index (m.at range).
//
//   activityBuckets(db, { fromMs, toMs, bucketMin = 5 }) -> { fromMs, toMs, bucketMin, buckets: [{ project_id, start_ms, messages }] }
//
// Rules, stated because a ribbon built on them is labelled "blocks", never "hours worked":
//   - a turn is a message row with role 'user' or 'assistant' (system and tool-result rows are not turns); an assistant row that
//     only carries a tool call IS a turn: Claude was working.
//   - sidechain (subagent) turns COUNT: while a subagent runs the parent chat is quiet but Claude is busy on that project. This
//     differs from hq_recall, which leaves subagent turns out of what it returns as TEXT; here only a count leaves the index.
//   - the same filters as stats(): forgotten chats never count, and Instagram / Facebook rows are not Claude activity.
//   - [fromMs, toMs): a turn exactly at fromMs counts, one exactly at toMs does not. A bucket is a multiple of bucketMin since the
//     Unix epoch (UTC), so it lines up with local time for every zone whose offset is a multiple of bucketMin minutes (all real ones
//     for 5, 15 and 30); start_ms is the bucket's start. project_id is null for a chat with no project.
//   - names never leave: the renderer maps project ids to names on its own screen.
export const MAX_WINDOW_MS = 8 * 86400000;
export const DEFAULT_BUCKET_MIN = 5;
const NOT_PEOPLE = "c.source NOT IN ('instagram', 'facebook')";   // the same rule as store.mjs

export function activityBuckets(db, { fromMs, toMs, bucketMin = DEFAULT_BUCKET_MIN } = {}) {
  if (!Number.isInteger(fromMs) || !Number.isInteger(toMs) || !(toMs > fromMs)) throw new Error('activityBuckets: fromMs and toMs must be whole milliseconds with toMs after fromMs');
  if (toMs - fromMs > MAX_WINDOW_MS) throw new Error('activityBuckets: the window is at most 8 days');
  if (!Number.isInteger(bucketMin) || bucketMin < 1 || bucketMin > 60) throw new Error('activityBuckets: bucketMin must be a whole number from 1 to 60');
  const lo = new Date(fromMs).toISOString(), hi = new Date(toMs).toISOString();
  const sec = bucketMin * 60;   // a validated integer, inlined: an integer bound parameter could arrive as REAL and turn the division into a fraction
  const rows = db.prepare(`SELECT c.project_id AS project_id, CAST(strftime('%s', m.at) AS INTEGER) / ${sec} AS b, COUNT(*) AS messages
      FROM message m JOIN conversation c ON c.id = m.conversation_id
      WHERE c.forgotten = 0 AND ${NOT_PEOPLE} AND m.role IN ('user', 'assistant') AND m.at >= ? AND m.at < ? AND strftime('%s', m.at) IS NOT NULL
      GROUP BY c.project_id, b ORDER BY b, c.project_id`).all(lo, hi);
  return {
    fromMs, toMs, bucketMin,
    buckets: rows.map((r) => ({ project_id: r.project_id == null ? null : String(r.project_id), start_ms: Number(r.b) * sec * 1000, messages: Number(r.messages) })),
  };
}
