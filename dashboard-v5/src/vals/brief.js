// Brief panel render values (Home). Keys are brf-prefixed — one shared namespace with every other surface.
// The brief arrives finished from main (dashboard/brief.js → hq:brief:*); this module only shapes it.
// Honest states: no bridge · read failed · still loading · nothing needs you · items. Empty is never claimed when a
// source failed — "nothing found" and "couldn't look" are different things.
const SEV = { high: ['urgent', 'var(--red)'], med: ['soon', 'var(--orange)'], low: ['when you can', 'var(--muted)'] };
const TAB_LABEL = { money: 'Open Money', system: 'Open System', tasks: 'Open Tasks', claude: 'Open Claude', projects: 'Open Projects', life: 'Open Life', history: 'Open History', automations: 'Open Automations' };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const actLabel = (a) => (!a ? '' : a.kind === 'scan' ? 'Scan now' : a.projectId ? 'Open project' : TAB_LABEL[a.tab] || 'Open');

export function briefVals(ctx) {
  const { S, LIVE, live } = ctx;
  const B = LIVE.brief || {}, brief = B.brief || null;
  const can = !!(this.hq && this.hq.brief);
  const state = !can ? 'offline' : B.error ? 'error' : !B.loaded ? 'loading' : 'ready';
  const items = state === 'ready' && brief && Array.isArray(brief.items) ? brief.items : [];
  const sourceErrors = state === 'ready' && brief && Array.isArray(brief.errors) ? brief.errors : [];
  const more = state === 'ready' && brief ? Number(brief.more) || 0 : 0;
  const busy = !!S.brfBusy;
  if (S.tab === 'home' && live && state === 'ready') this.useMark('brief-panel');   // usage counter: once per arrival on Home, only while the panel can be seen (logic/use-log.js)
  return {
    brfShow: !!live,   // the Brief is about now: hidden while an older scan is being viewed
    brfOffline: state === 'offline',
    brfError: state === 'error', brfErrorText: B.error || '',
    brfLoading: state === 'loading',
    brfEmpty: state === 'ready' && items.length === 0 && more === 0 && sourceErrors.length === 0,
    brfEmptyText: 'Nothing needs you right now' + (hhmm(brief && brief.generatedAt) ? ' · from the ' + hhmm(brief.generatedAt) + ' brief' : ''),
    brfReady: state === 'ready' && (items.length > 0 || more > 0),
    brfItems: items.map((i) => {
      const [sevLabel, color] = SEV[i.severity] || SEV.low;
      // the whole badge style: dc-lite binds a style object OR a string, it can't merge the two
      const sevStyle = { color, border: '1px solid ' + color, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' };
      return { key: i.key, sevLabel, sevStyle, text: i.text, why: i.why, meta: 'from ' + i.age,
        actLabel: actLabel(i.action), act: () => this.brfAct(i.action), dismiss: () => this.brfDismiss(i.key) };
    }),
    brfHasMore: more > 0, brfMoreText: '+' + more + ' more',
    brfHasSourceErrors: sourceErrors.length > 0,
    brfSourceErrorsText: 'Couldn’t read: ' + sourceErrors.map((e) => e.source + ': ' + e.error).join(' · '),
    brfBusy: busy,
  };
}
