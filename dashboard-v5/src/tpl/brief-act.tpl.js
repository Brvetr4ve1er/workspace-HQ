// Brief row verbs (dish brief-act-waiting). <!-- v5: Brief act --> two fragments interpolated into tpl/brief.tpl.js INSIDE the existing
// <sc-for list="{{ brfItems }}" as="i"> row: batButton next to the Open / Dismiss buttons, and the default export (acted line + inline
// confirm) under the row's text column. dc-lite dialect only: dotted paths, !, ===; every value arrives finished from vals/brief-act.js
// (briefActRow, spread into each brfItems entry). The verb is one local action; nothing here pushes or sends.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const INPUT = 'flex:1 1 160px;min-width:0;height:28px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px';

export const batButton = String.raw`<sc-if value="{{ i.batHasVerb }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ i.batVerb }}" disabled="{{ i.batBusy }}" style="${BTN}" ${BTN_HOVER}>{{ i.batVerbLabel }}</button></sc-if>`;

export default String.raw`                          <!-- v5: Brief act — the row's one local verb: the done line, or its inline confirm -->
                          <sc-if value="{{ i.batActed }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:12px;color:var(--green)">{{ i.batActedText }}</div></sc-if>
                          <sc-if value="{{ i.batConfirming }}" hint-placeholder-val="{{ false }}">
                            <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
                              <div style="font-size:12px;color:var(--text)">{{ i.batConfirmText }}</div>
                              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                                <sc-if value="{{ i.batNeedsBalance }}" hint-placeholder-val="{{ false }}"><input value="{{ i.batBalance }}" onChange="{{ i.batOnBalance }}" onKeyDown="{{ i.batOnKey }}" inputMode="decimal" autoComplete="off" aria-label="Balance you see in the account" placeholder="balance" style="${INPUT}"></sc-if>
                                <button type="button" onClick="{{ i.batYes }}" disabled="{{ i.batBusy }}" style="${GOLD}" ${GOLD_HOVER}>{{ i.batYesLabel }}</button>
                                <button type="button" onClick="{{ i.batNo }}" style="${BTN}" ${BTN_HOVER}>Cancel</button>
                              </div>
                            </div>
                          </sc-if>
`;
