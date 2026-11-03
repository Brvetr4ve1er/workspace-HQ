/**
 * Local-calendar day arithmetic shared by every engine. Day keys are
 * YYYY-MM-DD in LOCAL time (never toISOString — the target market is UTC+1,
 * so UTC keys would roll days at 01:00). Pure: no wall clock in here.
 */
export function localDayISO(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}
/** Local-calendar day key `n` days after `dayISO`. */
export function addDaysISO(dayISO, n) {
    const [y, m, d] = dayISO.split('-').map(Number);
    return localDayISO(new Date(y, m - 1, d + n));
}
/**
 * Day key `n` months after `dayISO`, clamping to the target month's last day
 * (Jan 31 + 1 month = Feb 28/29, never Mar 3) so a monthly bill on the 31st
 * stays an end-of-month bill instead of drifting into the next month.
 */
export function addMonthsISO(dayISO, n) {
    const [y, m, d] = dayISO.split('-').map(Number);
    const last = new Date(y, m - 1 + n + 1, 0).getDate();
    return localDayISO(new Date(y, m - 1 + n, Math.min(d, last)));
}
/** Monday of the week containing `dayISO` (weeks run Mon–Sun). */
export function weekStartISO(dayISO) {
    const [y, m, d] = dayISO.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return addDaysISO(dayISO, -((dow + 6) % 7));
}
/** Whole days from `a` to `b` (b − a); negative when b is earlier. */
export function daysBetween(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Shape AND calendar validity ('2026-02-30' is rejected). */
export function isValidDayKey(v) {
    if (typeof v !== 'string' || !DAY_KEY_RE.test(v))
        return false;
    const [y, m, d] = v.split('-').map(Number);
    return localDayISO(new Date(y, m - 1, d)) === v;
}
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function isIsoDatetime(v) {
    return typeof v === 'string' && ISO_DATETIME_RE.test(v) && Number.isFinite(Date.parse(v));
}
/** "12 Oct" — short, locale-neutral day label for cards. */
export function shortDay(dayISO) {
    const [y, m, d] = dayISO.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
