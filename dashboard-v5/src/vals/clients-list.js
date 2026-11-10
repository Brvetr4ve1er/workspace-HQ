// Projects › Clients render values. Keys are cls-prefixed — one shared namespace with every other surface. The list arrives finished
// from main (dashboard/delivery-clients.js → hq:delivery:clients: id, name, done/total, linkState, lastCopyAt, fileState, inScan —
// counts and words only); logic/clients-list.js reads it on arrival; this module only sorts and shapes it.
//
// renderVals runs every surface on every machine push, so while the owner is on another screen this returns a frozen constant:
// nothing is sorted or formatted. Honest states: no bridge · loading · error (no list held: Retry) · empty ("No client jobs yet")
// · ready · ready with a later error (the last list stays, the error is said above it) · a marked project gone from the scan
// (dimmed, "not in the latest scan", no Open button — told apart from a service error).
import { sortClients, clsLeft, CLS_OFF } from '../logic/clients-list.js';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
// a thin fill, token colours only (the track is in the template)
const fill = (done, total) => ({ width: pct(done, total) + '%', height: '100%', background: done >= total && total > 0 ? 'var(--green)' : 'var(--accent-text)', borderRadius: 3, transition: 'width .25s' });

export function clsAgo(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'a while ago';
  const d = Math.max(0, now - t), H = 3600e3, D = 24 * H;
  if (d < H) return Math.max(1, Math.round(d / 60e3)) + ' min ago';
  if (d < D) return Math.round(d / H) + ' h ago';
  const n = Math.floor(d / D);
  return n + (n === 1 ? ' day' : ' days') + ' ago';
}
export const CLS_LINK = Object.freeze({ 'ready-production': 'link ready · production', 'ready-preview': 'link ready · preview', 'not-ready': 'link not ready', none: 'no link yet' });
const LINK_COLOR = Object.freeze({ 'ready-production': 'var(--green)', 'ready-preview': 'var(--green)', 'not-ready': 'var(--orange)', none: 'var(--muted)' });
const FILE_WORDS = Object.freeze({ missing: 'scope file not found', outside: 'scope file is outside the project folder', 'too-big': 'scope file is over 64 KB', unreadable: 'scope file could not be read' });
export const CLS_EMPTY_TEXT = 'No client jobs yet. Mark one on a project page.';

const OFF = Object.freeze({
  clsShow: false, clsOffline: false, clsOfflineText: '', clsLoading: false, clsError: false, clsErrorText: '', clsEmpty: false, clsEmptyText: '',
  clsReady: false, clsSummary: '', clsRows: [], clsHasOmitted: false, clsOmittedText: '', clsRetryLabel: 'Refresh', clsRetryOff: true, clsRetry: () => {},
});

export function clientsVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!(S.tab === 'projects' && S.sub && S.sub.projects === 'clients')) return OFF;
  const can = typeof this.clsCan === 'function' ? this.clsCan() : false;
  const C = S.cls || {};
  const held = Array.isArray(C.rows) ? C.rows : null;
  const busy = !!C.busy, err = typeof C.error === 'string' ? C.error : '';
  const retry = () => (typeof this.clsRead === 'function' ? this.clsRead() : null);
  const retryLabel = busy ? 'Reading…' : err && !held ? 'Retry' : 'Refresh';
  if (!can) return { ...OFF, clsShow: true, clsOffline: true, clsOfflineText: CLS_OFF + ' — client jobs are read by the app, not this window.', clsRetryLabel: 'Refresh', clsRetryOff: true };
  if (!held) {
    return {
      ...OFF, clsShow: true, clsRetry: retry, clsRetryLabel: retryLabel, clsRetryOff: busy,
      clsLoading: !err, clsError: !!err, clsErrorText: err,
    };
  }

  const now = Date.now();
  const rows = sortClients(held).map((r) => {
    const fileBad = !!r.fileState && r.fileState !== 'ok';
    const hasBar = r.inScan && r.total > 0 && !fileBad;
    const left = clsLeft(r);
    const statusText = !r.inScan ? '' : fileBad ? FILE_WORDS[r.fileState] || 'scope file problem' : r.total > 0 ? r.done + ' of ' + r.total + ' done' : 'no scope yet';
    return {
      key: r.id, name: r.name, notInScan: !r.inScan, notInScanText: 'not in the latest scan',
      rowStyle: 'padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' + (r.inScan ? '' : ';opacity:.6'),
      statusText, hasStatus: r.inScan, statusStyle: 'font-size:13px;color:' + (fileBad ? 'var(--orange)' : r.total > 0 ? 'var(--text)' : 'var(--muted)'),
      hasBar: hasBar, barLabel: hasBar ? statusText + (left ? ' · ' + left + ' left' : '') : '', barStyle: hasBar ? fill(r.done, r.total) : {},
      linkText: r.inScan ? CLS_LINK[r.linkState] : '', hasLink: r.inScan, linkStyle: 'font-size:12px;color:' + (LINK_COLOR[r.linkState] || 'var(--muted)'),
      updateText: r.inScan || r.lastCopyAt ? (r.lastCopyAt ? 'last copied ' + clsAgo(r.lastCopyAt, now) : 'never copied') : '',
      hasUpdate: r.inScan || !!r.lastCopyAt,
      canOpen: r.inScan, open: () => (typeof this.clsOpen === 'function' ? this.clsOpen(r.id) : null), openLabel: 'Open card for ' + r.name,
    };
  });
  const withLeft = held.filter((r) => clsLeft(r) > 0).length;
  const gone = held.filter((r) => !r.inScan).length;
  const omitted = Number(C.omitted) > 0 ? Number(C.omitted) : 0;
  return {
    ...OFF, clsShow: true, clsRetry: retry, clsRetryLabel: retryLabel, clsRetryOff: busy,
    // a later read error keeps the list that was read before and says so above it
    clsError: !!err, clsErrorText: err ? err + ' — showing the list from the last read' : '',
    clsEmpty: rows.length === 0, clsEmptyText: rows.length === 0 ? CLS_EMPTY_TEXT : '',
    clsReady: rows.length > 0,
    clsSummary: rows.length ? plural(rows.length, 'client job') + ' · ' + withLeft + ' with work left' + (gone ? ' · ' + gone + ' not in the latest scan' : '') : '',
    clsRows: rows,
    clsHasOmitted: omitted > 0, clsOmittedText: omitted > 0 ? plural(omitted, 'more client job') + ' not shown — the list stops at 50' : '',
  };
}
