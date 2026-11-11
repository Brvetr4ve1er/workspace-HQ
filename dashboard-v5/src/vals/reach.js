// Reach block (Settings) render values — whether each door to the assistant is open. Keys are rch-prefixed (one shared namespace).
// Rows arrive finished from main (dashboard/reach.js → hq:reach:read); this module only labels and colours them.
// Honest states: no bridge · read failed · still loading · rows (open / closed / unknown each said in words, never by colour alone).
const LABEL = {
  'phone-door': 'Phone door · Claude remote control',
  'user-scope': 'Tools in every Claude session',
  bridge: 'Browser extension paired',
  'tray-icon': 'Tray icon visible',
  calls: 'Assistant calls this week',
  'breach-check': 'Breach check',
};
const STATE = {
  open: { text: 'open', color: 'var(--green)' },
  closed: { text: 'closed', color: 'var(--orange)' },
  unknown: { text: 'unknown', color: 'var(--muted)' },
};
const WHO = { owner: 'you', app: 'the app' };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

export function reachVals(ctx) {
  const { S } = ctx;
  const show = !!S.settingsOpen;
  const can = !!(this.hq && this.hq.reach && typeof this.hq.reach.read === 'function');
  // the rows load once per opening of Settings; closing re-arms it (vals run on every render, so this only flips a flag and defers the read)
  if (show && can) this.rchEnsure(); else if (!show) this.rchRearm();
  const rows = Array.isArray(S.rchRows) ? S.rchRows : null;
  const error = S.rchError || '';
  const state = !can ? 'offline' : rows ? 'ready' : error ? 'error' : 'loading';   // a failed refresh keeps the rows it already has and says so
  const items = rows || [];
  const open = items.filter((r) => r.ok === true).length;
  return {
    rchShow: show,
    rchOffline: state === 'offline',
    rchError: state === 'error', rchErrorText: error,
    rchLoading: state === 'loading',
    rchReady: items.length > 0,
    rchRows: items.map((r) => {
      const st = r.ok === true ? STATE.open : r.ok === false ? STATE.closed : STATE.unknown;
      const next = r.ok === false && r.step ? 'Next: ' + r.step + ' · ' + (WHO[r.who] ? 'by ' + WHO[r.who] : 'by you') : '';
      return {
        id: r.id, label: LABEL[r.id] || String(r.id),
        stateText: st.text,
        stateStyle: { color: st.color, border: '1px solid ' + st.color, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' },
        detail: r.detail || '',
        hasNext: !!next, next,
        hasCopy: !!r.copy, copy: () => this.rchCopy(r.copy), copyLabel: 'Copy command', copyAria: 'Copy: ' + (LABEL[r.id] || r.id),
      };
    }),
    rchSummary: items.length ? open + ' of ' + items.length + ' open' + (S.rchAt && hhmm(S.rchAt) ? ' · checked ' + hhmm(S.rchAt) : '') : '',
    rchStaleError: state === 'ready' && !!error,
    rchBusy: !!S.rchBusy,
    rchRefresh: () => this.rchLoad(),
  };
}
