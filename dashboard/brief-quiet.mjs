// Brief unclog (batch 6, dish "Unclog the Brief"). PURE: no IO, no clock (`now` is passed in), no LLM. brief-core.mjs calls shape() after it has split
// the ranked rows into fresh and standing; nothing here changes a rule, a key, the 72 h standing test or the cap of three.
//
// Three additions, every field ADDITIVE and absent when it does not apply (v stays 1):
//
//   1. GROUP ROWS. A row of a collapsing rule (COLLAPSE_RULES) whose `count` > 0 already reads "X and N more project". It gains
//        group: { n: count + 1, sinceAt: ISO | null, listAction: { kind:'go', tab:'projects', sub:'grid' } | null }
//      sinceAt is the first-seen time of the STABLE key 'group:<rule>' (brief.js stamps it in firstSeen next to the item keys), so the clock
//      survives the worst project rotating; null when no such key is remembered. listAction exists only for the four rules whose own action goes
//      to ONE project (LIST_ACTION_RULES); the row's own `action` is left alone (brief-act-core reads action.projectId for the Commit verb).
//
//   2. THE AGED SLOT. CAP stays 3. Standing rows never hold a slot two days running and never crowd out fresh ones: only when fewer than `cap`
//      fresh rows exist, the standing rows with severity high or med are the candidates (n of them, in ranked order); with d = floor(now / 86400000)
//      (UTC day) and pos = d mod (n + 1): pos < n puts candidate `pos` after the fresh rows as an item carrying aged: { since: ISO } (and takes it out
//      of standing for that day); pos == n is a rest day. Low standing rows only ever show in the standing line. With `cap` fresh rows: none.
//
//   3. THE QUIET LANE. brief.quiet = { key, rule, kind, text, why, source, age, action } | null: one fixed fourth line that is NOT a slot, never
//      toasts, is never in overflow and is never counted in `more`. The candidates are the facts that are true right now, in a fixed order
//      (security walkthrough never started, browser extension not paired, Money never opened, a sensor file gone dark for 3 days); ONE shows a
//      day: index = floor(now / 86400000) mod candidates.length. None true -> null. The text names a SOURCE kind only, never a path or a name.
//
// shape({ fresh, standing, now, firstSeen, quietInputs, money, cap }) -> { fresh, standing, aged, quiet }
//   fresh / standing are the engine's ranked rows (standing rows carry `since`); fresh keeps its length and order (group fields added).
//   items = fresh.slice(0, cap).concat(aged ? [aged] : []);  overflow and `more` still come from fresh only.
// isToastable(item) -> false for an aged row (a row re-admitted from standing never toasts); shouldToast must ask it for the top item.
//
// quietInputs (dashboard/brief-quiet-sources.js): { security: { started: bool|null }, bridge: { paired: bool|null }, moneyOpened: bool|null,
//   sources: [{ kind, mtimeMs }] }  — null means "could not tell", and a candidate never fires on a null. `money` is the money view
//   (hasAccounts), passed by the engine from its own inputs.

const H = 3600e3, D = 24 * H;
export const DAY_MS = D;
export const DARK_MS = 3 * D;
export const AGED_SEVERITIES = Object.freeze(['high', 'med']);

export const COLLAPSE_RULES = Object.freeze(['secrets', 'unpushed', 'dirty', 'session-left-dirty', 'ci-red', 'prod-deploy-error', 'review-waiting']);
export const LIST_ACTION_RULES = Object.freeze(['secrets', 'unpushed', 'dirty', 'session-left-dirty']);
export const LIST_ACTION = Object.freeze({ kind: 'go', tab: 'projects', sub: 'grid' });
export const groupKey = (rule) => 'group:' + rule;

export const QUIET_RULES = Object.freeze(['quiet-security-unstarted', 'quiet-bridge-unpaired', 'quiet-money-unopened', 'quiet-source-dark']);
// sensor kinds a "gone dark" line may name, in the fixed candidate order; the label is the ONLY words ever used for them
export const DARK_KINDS = Object.freeze(['pc-health', 'github', 'accounts', 'disk-history']);
export const DARK_LABEL = Object.freeze({
  'pc-health': { text: 'The PC health readings have stopped updating', short: 'the PC health readings', action: { kind: 'go', tab: 'system', sub: 'machine' } },
  github: { text: 'The GitHub readings have stopped updating', short: 'the GitHub readings', action: { kind: 'go', tab: 'projects', sub: 'github' } },
  accounts: { text: 'The Vercel and Supabase readings have stopped updating', short: 'the Vercel and Supabase readings', action: { kind: 'go', tab: 'projects', sub: 'accounts' } },
  'disk-history': { text: 'The disk history has stopped updating', short: 'the disk history', action: { kind: 'go', tab: 'system', sub: 'machine' } },
});
// the fixed words per quiet rule (brief-project.mjs WORDING repeats these for the screen-safe projection)
export const QUIET_TEXT = Object.freeze({
  'quiet-security-unstarted': 'The Security walkthrough has not been started',
  'quiet-bridge-unpaired': 'The browser extension is not paired',
  'quiet-money-unopened': 'Money has never been opened',
});

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** UTC day number of `now` (ms) — the one clock both the aged slot and the quiet lane turn on. */
export const dayIndex = (now) => Math.floor(now / DAY_MS);
const mod = (a, m) => ((a % m) + m) % m;

// ---- 1. group rows ----------------------------------------------------------------------------------------------------------------------------

/** group field for a row, or null when the row is not a collapsed group. firstSeen = brief-state.json's { key: {first, last} }. */
export function groupField(row, firstSeen) {
  if (!isObj(row) || typeof row.rule !== 'string' || !COLLAPSE_RULES.includes(row.rule)) return null;
  const count = Number.isInteger(row.count) ? row.count : 0;
  if (count <= 0) return null;
  const seen = isObj(firstSeen) ? firstSeen[groupKey(row.rule)] : null;
  const f = isObj(seen) ? msOf(seen.first) : null;
  return { n: count + 1, sinceAt: f === null ? null : new Date(f).toISOString(), listAction: LIST_ACTION_RULES.includes(row.rule) ? { ...LIST_ACTION } : null };
}

/** A copy of `rows` where each collapsed group row gains its `group` field. Other rows are returned as they are. */
export function withGroups(rows, firstSeen) {
  return arr(rows).map((r) => { const g = groupField(r, firstSeen); return g ? { ...r, group: g } : r; });
}

/** The stable group keys a brief carries right now (brief.js stamps each in firstSeen like an item key). */
export function groupKeysOf(rows) {
  const keys = [];
  for (const r of arr(rows)) { const g = groupField(r, null); if (g && !keys.includes(groupKey(r.rule))) keys.push(groupKey(r.rule)); }
  return keys;
}

// ---- 2. the aged slot -------------------------------------------------------------------------------------------------------------------------

/** { aged: row | null, standing: rows } — see the header. `fresh` only supplies its length: no standing row ever displaces a fresh one. */
export function agedSlot({ fresh, standing, now, cap }) {
  const st = arr(standing), c = Number.isInteger(cap) && cap > 0 ? cap : 3;
  if (arr(fresh).length >= c || !Number.isFinite(now)) return { aged: null, standing: st };
  const cands = st.filter((r) => isObj(r) && AGED_SEVERITIES.includes(r.severity));
  const n = cands.length;
  if (!n) return { aged: null, standing: st };
  const pos = mod(dayIndex(now), n + 1);
  if (pos >= n) return { aged: null, standing: st };   // the rest day
  const pick = cands[pos];
  const { since, ...rest } = pick;
  const f = msOf(since);
  return { aged: { ...rest, aged: { since: f === null ? null : new Date(f).toISOString() } }, standing: st.filter((r) => r !== pick) };
}

/** false for a row re-admitted from standing: it must never raise a toast (shouldToast asks this for the top item). */
export const isToastable = (item) => isObj(item) && !isObj(item.aged);

// ---- 3. the quiet lane ------------------------------------------------------------------------------------------------------------------------

const ageWord = (ms, now) => {
  const d = Math.max(0, now - ms);
  return d < D ? 'under a day ago' : Math.floor(d / D) + ' d ago';
};

/** The quiet candidates that are true now, in the fixed order: [{ key, rule, kind, text, why, source, age, action }]. */
export function quietCandidates({ quietInputs, money, now, skipRules }) {
  const q = isObj(quietInputs) ? quietInputs : {};
  const skip = skipRules instanceof Set ? skipRules : new Set(arr(skipRules));
  const out = [];
  const add = (rule, kind, text, why, source, age, action) => out.push({ key: 'quiet:' + rule + (kind ? ':' + kind : ''), rule, kind: kind || null, text, why, source, age, action });
  if (isObj(q.security) && q.security.started === false) {
    add('quiet-security-unstarted', null, QUIET_TEXT['quiet-security-unstarted'], 'The Security space has a setup walkthrough and nothing in it has been started.', 'security', 'not started', { kind: 'go', tab: 'security', sub: 'setup' });
  }
  if (isObj(q.bridge) && q.bridge.paired === false) {
    // Settings is an overlay, not a route the Brief can open: the Claude chats view is where the extension's sync is explained (the claude-sync rule goes there too)
    add('quiet-bridge-unpaired', null, QUIET_TEXT['quiet-bridge-unpaired'], 'Grabs and claude.ai sync stay closed until it is paired; Settings › Reach shows the state and the extension popup pairs it.', 'bridge', 'not paired', { kind: 'go', tab: 'claude', sub: 'chats' });
  }
  if (q.moneyOpened === false && isObj(money) && money.hasAccounts === false && !skip.has('money-empty')) {
    add('quiet-money-unopened', null, QUIET_TEXT['quiet-money-unopened'], 'No visit to Money shows in the days this PC keeps its logs, and no account is set up.', 'money', 'never opened', { kind: 'go', tab: 'money', sub: 'today' });
  }
  const dark = new Map();
  for (const s of arr(q.sources)) {
    if (!isObj(s) || typeof s.kind !== 'string' || !own(DARK_LABEL, s.kind) || !Number.isFinite(s.mtimeMs) || dark.has(s.kind)) continue;
    if (Number.isFinite(now) && now - s.mtimeMs >= DARK_MS) dark.set(s.kind, s.mtimeMs);
  }
  for (const kind of DARK_KINDS) {
    if (!dark.has(kind)) continue;
    const L = DARK_LABEL[kind];
    add('quiet-source-dark', kind, L.text, 'Its file was last written ' + ageWord(dark.get(kind), now) + ', so what the Brief says from it may be old.', kind, 'last written ' + ageWord(dark.get(kind), now), { ...L.action });
  }
  return out;
}

/** The ONE quiet line of the day, or null. */
export function pickQuiet(args) {
  const now = args && args.now;
  if (!Number.isFinite(now)) return null;
  const c = quietCandidates(args);
  return c.length ? c[mod(dayIndex(now), c.length)] : null;
}

// ---- the one call brief-core makes ------------------------------------------------------------------------------------------------------------

export function shape(args) {
  const { fresh, standing, now, firstSeen, quietInputs, money, cap } = isObj(args) ? args : {};
  const f = withGroups(fresh, firstSeen);
  const s0 = withGroups(standing, firstSeen);
  const { aged, standing: s } = agedSlot({ fresh: f, standing: s0, now, cap });
  // one voice: while Money's own "isn't set up yet" row is on the brief anywhere (fresh or standing), the quiet lane stays off that topic
  const skipRules = new Set(f.concat(s0).filter(isObj).map((r) => r.rule));
  const quiet = pickQuiet({ quietInputs, money, now, skipRules });
  return { fresh: f, standing: s, aged, quiet };
}
