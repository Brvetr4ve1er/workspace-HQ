// Reach block (Settings) render values — whether each door to the assistant is open. Keys are rch-prefixed (one shared namespace).
// Rows arrive finished from main (dashboard/reach.js → hq:reach:read); this module only labels and colours them.
// Honest states: no bridge · read failed · still loading · rows (open / closed / unknown each said in words, never by colour alone).
const LABEL = {
  'phone-door': 'Phone door · Claude remote control',
  'user-scope': 'Tools in every Claude session',
  bridge: 'Browser extension paired',
  'brief-file': 'Phone brief file',
  'notify-test': 'Test notification',
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
// Row actions (batch 6): main sends r.actions = [{ id, label }] on a row; an id becomes a button only when it is in this table, and its handler
// sits on the row object (no top-level vals key). { api, arg } = hq.reach[api](arg), run by logic/use-log.js rchAct. Unknown ids render nothing.
const ACTIONS = new Map([
  ['brief-file-pick', { api: 'briefFile', arg: 'pick' }],
  ['brief-file-clear', { api: 'briefFile', arg: 'clear' }],
  ['notify-test', { api: 'notifyTest', done: 'Sent - did you see it?' }],   // done: the honest toast for an answer that took effect; a refusal says its reason (use-log.js rchAct)
]);
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
      const acts = (Array.isArray(r.actions) ? r.actions : [])
        .filter((a) => a && typeof a.id === 'string' && ACTIONS.has(a.id) && typeof a.label === 'string' && a.label)
        .map((a) => ({ id: a.id, label: a.label.slice(0, 40), aria: a.label.slice(0, 40) + ': ' + (LABEL[r.id] || r.id), busy: !!S.rchBusy, run: () => this.rchAct(ACTIONS.get(a.id)) }));
      return {
        id: r.id, label: LABEL[r.id] || String(r.id),
        stateText: st.text,
        stateStyle: { color: st.color, border: '1px solid ' + st.color, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' },
        detail: r.detail || '',
        hasNext: !!next, next,
        hasCopy: !!r.copy, copy: () => this.rchCopy(r.copy), copyLabel: 'Copy command', copyAria: 'Copy: ' + (LABEL[r.id] || r.id),
        hasActions: acts.length > 0, actions: acts,
      };
    }),
    rchSummary: items.length ? open + ' of ' + items.length + ' open' + (S.rchAt && hhmm(S.rchAt) ? ' · checked ' + hhmm(S.rchAt) : '') : '',
    rchStaleError: state === 'ready' && !!error,
    rchBusy: !!S.rchBusy,
    rchRefresh: () => this.rchLoad(),
  };
}
