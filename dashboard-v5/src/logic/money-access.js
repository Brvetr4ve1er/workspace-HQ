// Settings › "Claude sessions may read Money (words only)": the switch, renderer side.
// Component.prototype mixin (src/app.js): same `this` as the class methods. State (flat, mac-prefixed like Reach's rch*):
//   macOn  the switch as MAIN last said it (never guessed: false until main answers)   macLoaded  main has answered once
//   macAskedAt  ISO of the last hq_money_today call from the audit log, or null          macBusy  a set is in flight
//   macErr  main's own words for the last failed read or set (the switch keeps its last known value)
//
//  - The switch is OFF by default and only turns on when main answers { on:true }: no optimistic flip.
//  - One write per click: macToggle sends hq.moneyAccess.set(next) ONCE (a second click while busy is told, not sent).
//  - macEnsure() reads once per opening of Settings (macRearm() re-arms it when Settings closes); the "last asked" line is
//    names and time only, read main-side from the shared audit log.
//  - The explanation is shown whether the switch is on or off: what turning it on does, what it never shows, and that
//    the words then travel in Claude's transcripts and the Hub's local index.
//  - Money never changes through this switch or the tool behind it: it only lets a session READ words.
export const MAC_TITLE = 'Claude sessions may read Money (words only)';
export const MAC_EXPLAIN = 'Turned on, Claude sessions on this PC can ask whether Money is set up, whether the cycle is ok or tight, how many days to payday, and how many bills are late or due soon.';
export const MAC_NEVER = 'They never see amounts, names, accounts or notes, and they cannot change anything.';
export const MAC_WARN = 'Once on, those words travel in Claude’s transcripts and in the Claude Hub’s local index.';

// "last asked 3 h ago" | "last asked: never"   (names and time only; a time in the future is "just now")
export function lastAskedText(iso, nowMs = Date.now()) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'last asked: never';
  const min = Math.floor((nowMs - t) / 60000);
  if (min < 1) return 'last asked just now';
  if (min < 60) return 'last asked ' + min + ' min ago';
  const h = Math.floor(min / 60);
  if (h < 48) return 'last asked ' + h + ' h ago';
  return 'last asked ' + Math.floor(h / 24) + ' d ago';
}

export const moneyAccessLogic = {
  macEnsure() {
    if (this._macAsked) return;
    this._macAsked = true;
    setTimeout(() => this.macLoad(), 0);   // never set state while rendering
  },
  macRearm() { this._macAsked = false; },   // Settings closed: the next opening reads fresh
  async macLoad() {
    const api = this.hq && this.hq.moneyAccess;
    if (!api || typeof api.read !== 'function' || this._macReading) return false;
    this._macReading = true;
    try {
      const r = await api.read();
      if (!r || r.error || typeof r.on !== 'boolean') this.setState({ macErr: (r && r.error) || 'no answer' });
      else this.setState({ macOn: r.on, macAskedAt: typeof r.lastAskedAt === 'string' ? r.lastAskedAt : null, macLoaded: true, macErr: '' });
      return true;
    } catch (e) {
      this.setState({ macErr: String((e && e.message) || e).slice(0, 200) });
      return false;
    } finally { this._macReading = false; }
  },
  async macToggle() {
    const api = this.hq && this.hq.moneyAccess;
    if (!api || typeof api.set !== 'function') { if (this.denied) this.denied('Unavailable — this switch needs the desktop app'); return false; }
    if (!(this.state || {}).macLoaded) return false;   // never flip a switch whose real position is unknown
    if (this._macSetting) { if (this.toast) this.toast('info', 'Still saving the last change — try again in a moment'); return false; }
    this._macSetting = true;
    const next = (this.state || {}).macOn !== true;
    this.setState({ macBusy: true });
    let r;
    try { r = await api.set(next); }
    catch (e) { r = { error: String((e && e.message) || e).slice(0, 200) }; }
    finally { this._macSetting = false; }
    if (r && typeof r.on === 'boolean' && !r.error) {
      this.setState({ macOn: r.on, macBusy: false, macErr: '' });
      if (this.toast) this.toast('success', r.on ? 'Claude sessions can now read Money in words' : 'Claude sessions can no longer read Money');
      try { if (typeof this.useMark === 'function') this.useMark('money-access', 'act'); } catch { /* a usage mark is a bonus, never a failure */ }
      return true;
    }
    this.setState({ macBusy: false, macErr: (r && r.error) || 'That did not save' });
    if (this.toast) this.toast('error', (r && r.error) || 'That did not save');
    return false;
  },
};
