// Brief row verbs: render values (dish brief-act-waiting). Keys are bat-prefixed: one shared namespace with every other surface.
// briefActRow.call(this, item, ctx) returns the PER-ROW fields; vals/brief.js spreads them into each brfItems entry (the template
// reads them as i.batXxx inside the existing sc-for). briefActVals(ctx) is the panel-wide busy mirror: NOT registered in vals/index.js (the template reads the per-row i.batBusy; registering it would add a key to every golden scenario).
// Honest states: no bridge or an unknown rule gives no verb at all (never a dead button); acted: the row says "done ... clears when the
// next scan confirms" and offers nothing more; the inline balance field exists only for money-stale.
import { verbFor, secondaryFor, needsConfirm, VERB_LABEL, CONFIRM_TEXT, actedText, LINE_TTL_MS } from '../logic/brief-act.js';

const fn = () => {};

export function briefActRow(item, ctx = {}) {
  const S = ctx.S || this.state || {};
  const can = !!(this.hq && this.hq.brief && typeof this.hq.brief.act === 'function');
  const key = item && typeof item.key === 'string' ? item.key : '';
  const verb = can && key ? verbFor(item) : null;
  const doneLocal = key && S.batDone && S.batDone[key] ? S.batDone[key] : null;
  const acted = (item && item.acted) || doneLocal;   // main's own marker wins over the local mirror
  const said = acted ? actedText(acted, typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now()) : '';
  const confirming = !!verb && !said && S.batOpen === key && needsConfirm(verb);
  const balance = confirming && verb === 'confirm-balance';
  // the second button and the Launcher's result line live under ONE per-row key, `verbs` (the golden moves only there)
  const sec = can && key && !said ? secondaryFor(item) : null;
  const ln = key && S.batLine && S.batLine[key] ? S.batLine[key] : null;
  const nowMs = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now();
  const lineOn = !!ln && typeof ln.text === 'string' && ln.text !== '' && nowMs - Number(ln.at || 0) < LINE_TTL_MS;
  const verbs = {
    secHas: !!sec && !confirming, secLabel: sec ? VERB_LABEL[sec] : '', sec: sec ? () => this.batStartSecondary(item) : fn,
    lineGood: lineOn && !ln.bad, lineBad: lineOn && !!ln.bad, line: lineOn ? ln.text : '',
  };
  return {
    verbs,
    batHasVerb: !!verb && !said && !confirming,
    batVerbLabel: verb ? VERB_LABEL[verb] : '',
    batVerb: verb ? () => this.batStart(item) : fn,
    batBusy: !!S.batBusy,
    batConfirming: confirming,
    batConfirmText: confirming ? CONFIRM_TEXT[verb] : '',
    batYesLabel: verb ? VERB_LABEL[verb] : '',
    batYes: confirming ? () => this.batYes(item) : fn,
    batNo: () => this.batCancel(),
    batNeedsBalance: balance,
    batBalance: balance ? String(S.batBal || '') : '',
    batOnBalance: (e) => this.batType(e && e.target ? e.target.value : e),
    batOnKey: (e) => {
      if (!e) return;
      if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); this.batYes(item); } else if (e.key === 'Escape') this.batCancel();
    },
    batActed: !!said,
    batActedText: said,
  };
}

export function briefActVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  return { batBusy: !!S.batBusy };
}
