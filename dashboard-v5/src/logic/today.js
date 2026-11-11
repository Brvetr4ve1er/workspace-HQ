// Home › "Where today went": the ribbon's state, stepping and read cadence, renderer side. The day itself is built main-side
// (dashboard/day-ribbon.js + day-core.mjs, hq:today:read) and held by live/today-slice.mjs; this mixin never decides what a lane shows.
// Component.prototype mixin (src/app.js): same `this` as the class methods. State (flat, tdy-prefixed like brf*, mac*):
//   tdyOffset   0 = today, 1 = yesterday … 6 (a back arrow steps up to 7 days; never beyond what main would accept)
//   tdyNamesAt  bumped when project names arrive (names stay on screen: the Hub's project list, read once per arrival)
//
//  - ONE read per arrival on Home (tdyEnsure, deferred with setTimeout(0): never set state while rendering; tdyRearm re-arms it when
//    the owner leaves Home), never at boot. While Home stays open today re-reads every 10 minutes.
//  - A step reads the day only when it has no answer yet, or its answer is older than the day can have changed (today: a minute;
//    a past day: ten minutes). The previous answer stays on screen while a read is in flight.
//  - One 'today-ribbon' usage mark per screen visit, only while a ribbon is actually shown (tdyMark; logic/use-log.js dedupes).
//  - Wording: blocks, never hours. A lane that has no source says so in main's own words.
export const TDY_TITLE = 'Where today went';
export const TDY_EVERY_MS = 10 * 60 * 1000;
export const TDY_TODAY_FRESH_MS = 60 * 1000;
export const TDY_PAST_FRESH_MS = 10 * 60 * 1000;
export const TDY_MAX_OFFSET = 6;
export const TDY_NO_BRIDGE = 'The day ribbon needs the desktop app';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const clampOffset = (n) => Math.max(0, Math.min(TDY_MAX_OFFSET, Number.isInteger(n) ? n : 0));

/** 'Today' | 'Yesterday' | 'Sun 8 Nov' for a 'YYYY-MM-DD' key and the offset it was asked at (the key's own calendar, no zone maths). */
export function dayLabel(day, offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Yesterday';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) return offset + ' days ago';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

/** Does a stepped-to day need a read? entry is the slice's { model, at } or undefined. */
export function needsRead(entry, offset, nowMs) {
  if (!entry || !entry.model) return true;
  const age = nowMs - (Number.isFinite(entry.at) ? entry.at : 0);
  return age > (offset === 0 ? TDY_TODAY_FRESH_MS : TDY_PAST_FRESH_MS);
}

const clip = (s, n) => { const a = [...String(s == null ? '' : s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

/** A lane's label on screen. Names come from the Hub's own project list (a map id -> name) and never leave this window. */
export function laneLabel(lane, names, claudeIndex, max = 16) {
  if (!lane) return '';
  if (lane.kind === 'browser') return 'browser';
  if (lane.kind === 'power') return 'PC';
  if (lane.kind === 'commits') return 'commits';
  if (lane.id === 'claude-more') return '+' + (lane.more || 0) + ' more projects';
  if (lane.state !== 'ok') return 'Claude';
  const name = lane.ref != null && names ? names[lane.ref] : '';
  if (name) return clip(name, max);
  return lane.ref == null ? 'no project' : 'project ' + (claudeIndex + 1);
}

const minutesOf = (spans, lane, kind) => spans.filter((s) => s.lane === lane && (!kind || s.kind === kind)).reduce((n, s) => n + Math.max(0, (s.endMin || 0) - (s.startMin || 0)), 0);
const dur = (min) => { const m = Math.round(min); const h = Math.floor(m / 60), r = m % 60; return h && r ? h + ' h ' + r + ' m' : h ? h + ' h' : r + ' m'; };

/** The visually-hidden text twin of the ribbon: one sentence per lane, in the same words the picture says. */
export function twinLines(model, labelOf) {
  const lanes = Array.isArray(model && model.lanes) ? model.lanes : [];
  const spans = Array.isArray(model && model.spans) ? model.spans : [];
  const ticks = Array.isArray(model && model.ticks) ? model.ticks : [];
  let ci = 0;
  return lanes.map((l) => {
    const label = labelOf(l, l.kind === 'claude' ? ci++ : 0);
    if (l.state !== 'ok') return label + ': ' + (l.note || (l.state === 'empty' ? 'nothing on this day' : 'not available'));
    if (l.kind === 'claude') return label + ': ' + (l.blocks === 1 ? '1 five-minute block' : (l.blocks || 0) + ' five-minute blocks');
    if (l.kind === 'browser') return label + ': ' + dur(minutesOf(spans, l.id)) + ' of focus' + (l.note ? ' (' + l.note + ')' : '');
    if (l.kind === 'power') return label + ': awake ' + dur(minutesOf(spans, l.id, 'awake')) + ', asleep ' + dur(minutesOf(spans, l.id, 'asleep')) + ', unknown ' + dur(minutesOf(spans, l.id, 'unknown'));
    if (l.kind === 'commits') { const n = ticks.reduce((a, t) => a + (t.count || 1), 0); return label + ': ' + (n === 1 ? '1 commit' : n + ' commits'); }
    return label;
  });
}

export const todayLogic = {
  _tdyMark() { try { if (typeof this.useMark === 'function') this.useMark('today-ribbon'); } catch { /* a usage mark is a bonus, never a failure */ } },
  tdyMark() { this._tdyMark(); },

  /** Read once per arrival on Home (deferred), and every 10 minutes while Home stays open. */
  tdyEnsure() {
    if (this._tdyAsked) return;
    this._tdyAsked = true;
    setTimeout(() => {
      if (!this._tdyAsked) return;   // the owner left Home before the deferred read ran
      this.tdyLoadNames();
      this.tdyRead(clampOffset((this.state || {}).tdyOffset), true);
      if (!this._tdyTimer) {
        this._tdyTimer = setInterval(() => this.tdyRead(clampOffset((this.state || {}).tdyOffset), true), TDY_EVERY_MS);
        if (this._tdyTimer && typeof this._tdyTimer.unref === 'function') this._tdyTimer.unref();   // a Node host (the tests) never waits on it
      }
    }, 0);
  },
  /** The owner left Home: the next arrival reads fresh and the timer stops. */
  tdyRearm() {
    this._tdyAsked = false;
    if (this._tdyTimer) { clearInterval(this._tdyTimer); this._tdyTimer = null; }
  },

  tdyRead(offset, force) {
    try {
      const p = this.store && typeof this.store.refreshToday === 'function' ? this.store.refreshToday(offset, { force: !!force }) : null;
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return !!p;
    } catch { return false; }   // the ribbon shows its own error
  },

  /** The Hub's project list, once per arrival: { id: name } for the lane labels. Failing leaves "project N" labels. */
  async tdyLoadNames() {
    const api = this.hq && this.hq.claudeHub;
    if (!api || typeof api.projects !== 'function' || this._tdyNamesBusy) return false;
    this._tdyNamesBusy = true;
    try {
      const r = await api.projects();
      const rows = Array.isArray(r) ? r : r && Array.isArray(r.projects) ? r.projects : [];
      const map = {};
      for (const p of rows) if (p && typeof p.id === 'string' && typeof p.name === 'string' && p.name) map[p.id] = p.name;
      this._tdyNames = map;
      this.setState({ tdyNamesAt: Date.now() });
      return true;
    } catch { return false; }
    finally { this._tdyNamesBusy = false; }
  },

  tdyBack() {
    const cur = clampOffset((this.state || {}).tdyOffset);
    if (cur >= TDY_MAX_OFFSET) return false;
    return this._tdyStep(cur + 1);
  },
  tdyForward() {
    const cur = clampOffset((this.state || {}).tdyOffset);
    if (cur <= 0) return false;
    return this._tdyStep(cur - 1);
  },
  _tdyStep(next) {
    this.setState({ tdyOffset: next });
    const t = (this.LIVE && this.LIVE.today) || null;
    if (needsRead(t && t.days ? t.days[next] : undefined, next, Date.now())) this.tdyRead(next, false);
    return true;
  },
};
