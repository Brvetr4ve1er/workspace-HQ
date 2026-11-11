// Settings › Money for Claude sessions (words only): render values. Keys are mac-prefixed (one shared namespace).
// Everything arrives finished: main says on/off and when a session last asked (dashboard/money-access.js → hq:money-access:read);
// this module only shapes it. Honest states: no bridge · still loading · read failed (the switch keeps its last value, disabled
// until main has answered once) · ready. The switch never shows On before main has said so.
import { MAC_TITLE, MAC_EXPLAIN, MAC_NEVER, MAC_WARN, lastAskedText } from '../logic/money-access.js';

export function moneyAccessVals(ctx) {
  const { S } = ctx;
  const show = !!S.settingsOpen;
  const can = !!(this.hq && this.hq.moneyAccess && typeof this.hq.moneyAccess.read === 'function' && typeof this.hq.moneyAccess.set === 'function');
  if (show && can) this.macEnsure(); else if (!show) this.macRearm();   // the read happens once per opening of Settings, deferred
  const loaded = !!S.macLoaded;
  const on = loaded && S.macOn === true;
  const busy = !!S.macBusy;
  const err = S.macErr || '';
  return {
    macShow: show,
    macTitle: MAC_TITLE, macExplain: MAC_EXPLAIN, macNever: MAC_NEVER, macWarn: MAC_WARN,
    macOffline: !can, macOfflineText: 'This switch needs the desktop app’s money-access module (hq.moneyAccess): nothing can be turned on without it.',
    macLoading: can && !loaded && !err,
    macHasErr: can && !!err, macErrText: loaded ? 'Couldn’t save that · ' + err + ' · the switch still shows its last known position' : 'Couldn’t read the switch · ' + err,
    macOn: on, macStateText: on ? 'On' : 'Off',
    macToggle: () => this.macToggle(),
    macSwitchDisabled: !can || !loaded || busy,
    macSwitchLabel: MAC_TITLE + ': ' + (on ? 'on' : 'off'),
    macSwitchStyle: { width: 64, height: 32, flex: '0 0 auto', cursor: can && loaded && !busy ? 'pointer' : 'default', opacity: can && loaded ? 1 : 0.55, fontFamily: 'var(--px)', fontSize: 10, border: '1px solid var(--frame)', borderRadius: 10, boxShadow: '0 0 0 1px ' + (on ? 'var(--gold)' : 'var(--frame)'), background: on ? 'var(--gold)' : 'var(--ink)', color: on ? '#3a2a00' : 'var(--muted)' },
    macAsked: loaded ? lastAskedText(S.macAskedAt) : '',
    macHasAsked: can && loaded,
  };
}
