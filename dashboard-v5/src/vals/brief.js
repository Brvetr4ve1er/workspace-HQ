// Brief panel render values (Home). Keys are brf-prefixed — one shared namespace with every other surface.
// The brief arrives finished from main (dashboard/brief.js → hq:brief:*); this module only shapes it.
// Honest states: no bridge · read failed · still loading · nothing needs you · items. Empty is never claimed when a
// source failed — "nothing found" and "couldn't look" are different things.
const SEV = { high: ['urgent', 'var(--red)'], med: ['soon', 'var(--orange)'], low: ['when you can', 'var(--muted)'] };
const TAB_LABEL = { money: 'Open Money', system: 'Open System', tasks: 'Open Tasks', claude: 'Open Claude', projects: 'Open Projects', life: 'Open Life', history: 'Open History', automations: 'Open Automations' };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
// Projects › GitHub and Projects › Vercel & Supabase are named: those two actions come from the CI / deploy / pull-request senses
const SUB_LABEL = { projects: { github: 'Open GitHub', accounts: 'Open Vercel & Supabase' } };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const actLabel = (a) => (!a ? '' : a.kind === 'scan' ? 'Scan now' : a.projectId ? 'Open project' : (SUB_LABEL[a.tab] || {})[a.sub] || TAB_LABEL[a.tab] || 'Open');

export function briefVals(ctx) {
  const { S, LIVE, live } = ctx;
  const B = LIVE.brief || {}, brief = B.brief || null;
  const can = !!(this.hq && this.hq.brief);
  const state = !can ? 'offline' : B.error ? 'error' : !B.loaded ? 'loading' : 'ready';
  const items = state === 'ready' && brief && Array.isArray(brief.items) ? brief.items : [];
  const sourceErrors = state === 'ready' && brief && Array.isArray(brief.errors) ? brief.errors : [];
  const more = state === 'ready' && brief ? Number(brief.more) || 0 : 0;
  // what the "+N more" hides: up to two overflow items, by their own text (names are fine here — it is the main window)
  const overflow = state === 'ready' && brief && Array.isArray(brief.overflow) ? brief.overflow : [];
  const named = overflow.map((i) => (i && typeof i.text === 'string' ? i.text.trim() : '')).filter(Boolean).slice(0, 2);
  // standing: items unchanged for 3 days that stepped aside (engine: brief-core.mjs). One line under the items, each still one click from where it is cleared.
  const standing = state === 'ready' && brief && Array.isArray(brief.standing) ? brief.standing.filter((i) => i && typeof i.text === 'string' && i.text.trim()) : [];
  const sinceMs = standing.map((i) => Date.parse(i.since)).filter(Number.isFinite);
  const sinceDay = sinceMs.length ? dayOf(new Date(Math.min(...sinceMs)).toISOString()) : 'a while';   // the oldest one
  const busy = !!S.brfBusy;
  if (S.tab === 'home' && live && state === 'ready') this.useMark('brief-panel');   // usage counter: once per arrival on Home, only while the panel can be seen (logic/use-log.js)
  return {
    brfShow: !!live,   // the Brief is about now: hidden while an older scan is being viewed
    brfOffline: state === 'offline',
    brfError: state === 'error', brfErrorText: B.error || '',
    brfLoading: state === 'loading',
    brfEmpty: state === 'ready' && items.length === 0 && more === 0 && sourceErrors.length === 0,
    // standing items are still there (3+ days old): the panel must not claim nothing needs the owner while a high one has stood for days
    brfEmptyText: (standing.length ? 'Nothing new right now' : 'Nothing needs you right now') + (hhmm(brief && brief.generatedAt) ? ' · from the ' + hhmm(brief.generatedAt) + ' brief' : ''),
    brfReady: state === 'ready' && (items.length > 0 || more > 0),
    brfItems: items.map((i) => {
      const [sevLabel, color] = SEV[i.severity] || SEV.low;
      // the whole badge style: dc-lite binds a style object OR a string, it can't merge the two
      const sevStyle = { color, border: '1px solid ' + color, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' };
      return { key: i.key, sevLabel, sevStyle, text: i.text, why: i.why, meta: 'from ' + i.age,
        actLabel: actLabel(i.action), act: () => this.brfAct(i.action), dismiss: () => this.brfDismiss(i.key) };
    }),
    brfHasStanding: standing.length > 0,
    brfStandingLead: !standing.length ? '' : standing.length === 1 ? 'Standing since ' + sinceDay + ':' : 'Standing, oldest since ' + sinceDay + ':',   // only the oldest has stood since that date; each item's own date is in its tooltip
    brfStanding: standing.map((i, n) => ({ key: i.key, text: i.text.trim(), sep: n ? '·' : '', tip: 'Standing since ' + (dayOf(i.since) || 'a while') + ' · ' + actLabel(i.action), act: () => this.brfAct(i.action) })),
    brfHasMore: more > 0, brfMoreText: '+' + more + ' more' + (named.length ? ' · ' + named.join(' · ') : ''),
    brfHasSourceErrors: sourceErrors.length > 0,
    brfSourceErrorsText: 'Couldn’t read: ' + sourceErrors.map((e) => e.source + ': ' + e.error).join(' · '),
    brfBusy: busy,
  };
}
