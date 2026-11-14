import { briefActRow } from './brief-act.js';   // the row's one local verb (bat* keys, dish brief-act-waiting)
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
  // the quiet lane (batch 6, brief-quiet.mjs): ONE fixed fact of the day. It rides in the standing line (no new key, no template change): appended after the real
  // standing rows with its own tip, and it leads the line with 'Quiet:' only when it is alone. Never a card, never counted.
  const quietRaw = state === 'ready' && brief && brief.quiet && typeof brief.quiet === 'object' && !Array.isArray(brief.quiet) ? brief.quiet : null;
  const quiet = quietRaw && typeof quietRaw.text === 'string' && quietRaw.text.trim() ? quietRaw : null;
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
      // a collapsed group row ("X and N more") opens the LIST when main says where it is (group.listAction); its own action stays the worst project's, which the Commit verb reads
      const g = i.group && typeof i.group === 'object' ? i.group : null, a = g && g.listAction && typeof g.listAction === 'object' ? g.listAction : i.action;
      const oldest = g && dayOf(g.sinceAt), back = i.aged && typeof i.aged === 'object' && dayOf(i.aged.since);   // an aged row is a standing one put back in the last slot for the day
      return { key: i.key, sevLabel, sevStyle, text: i.text, why: i.why, meta: 'from ' + i.age + (oldest ? ' · oldest since ' + oldest : '') + (back ? ' · standing since ' + back : ''),
        actLabel: actLabel(a), act: () => this.brfAct(a), dismiss: () => this.brfDismiss(i.key),
        ...briefActRow.call(this, i, ctx) };
    }),
    brfHasStanding: standing.length > 0 || !!quiet,
    brfStandingLead: !standing.length ? (quiet ? 'Quiet:' : '') : standing.length === 1 ? 'Standing since ' + sinceDay + ':' : 'Standing, oldest since ' + sinceDay + ':',   // only the oldest has stood since that date; each item's own date is in its tooltip
    brfStanding: standing.map((i, n) => ({ key: i.key, text: i.text.trim(), sep: n ? '·' : '', tip: 'Standing since ' + (dayOf(i.since) || 'a while') + ' · ' + actLabel(i.action), act: () => this.brfAct(i.action) }))
      .concat(quiet ? [{ key: String(quiet.key || 'quiet'), text: quiet.text.trim(), sep: standing.length ? '·' : '', tip: 'Quiet lane · changes daily · ' + (actLabel(quiet.action) || 'Open'), act: () => this.brfAct(quiet.action) }] : []),
    brfHasMore: more > 0, brfMoreText: '+' + more + ' more' + (named.length ? ' · ' + named.join(' · ') : ''),
    brfHasSourceErrors: sourceErrors.length > 0,
    brfSourceErrorsText: 'Couldn’t read: ' + sourceErrors.map((e) => e.source + ': ' + e.error).join(' · '),
    brfBusy: busy,
  };
}
