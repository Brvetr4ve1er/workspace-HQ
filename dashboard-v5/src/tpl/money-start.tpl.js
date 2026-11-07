// Money start card + quick line (Money › Today). Two fragments, interpolated into tpl/money.tpl.js by the integrator:
//   startCard  → inside the mnyNoAccounts branch (replaces the "Add an account" card; Import stays beside Start)
//   quickLine  → first thing under mnyHasAccounts on Today
//   default export = startCard.
// <!-- v5: money quick start --> dc-lite dialect only: dotted paths, !, ===; every value arrives finished from vals/money-start.js.
// Same inline token styles as tpl/money.tpl.js (BTN / GOLD / LABEL / INPUT / CARD / ROW).
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;min-width:0';
const CARD = 'padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const ROW = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
const FIELD = 'display:flex;flex-direction:column;gap:4px;flex:1 1 150px;min-width:0';
const FLABEL = 'font-size:12px;color:var(--muted)';

export const startCard = String.raw`<!-- v5: money start card — one minute, one write -->
                      <section style="${CARD}" aria-label="Start Money in one minute">
                        <div style="${LABEL}">money in one minute</div>
                        <div style="font-size:14px;margin-bottom:12px">Type what you hold right now — each box is optional, but one balance is needed. Breathing room starts from there.</div>
                        <sc-if value="{{ mstReadOnly }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--orange);margin-bottom:10px">{{ mstReadOnlyText }}</div></sc-if>
                        <div style="${ROW};align-items:flex-end">
                          <label style="${FIELD}"><span style="${FLABEL}">Cash (DA)</span><input value="{{ mstCashDA }}" onChange="{{ onMstCashDA }}" onKeyDown="{{ mstStartKey }}" aria-label="Cash in DA" inputmode="decimal" placeholder="0" style="${INPUT}"></label>
                          <label style="${FIELD}"><span style="${FLABEL}">CCP / bank (DA)</span><input value="{{ mstBankDA }}" onChange="{{ onMstBankDA }}" onKeyDown="{{ mstStartKey }}" aria-label="CCP or bank in DA" inputmode="decimal" placeholder="0" style="${INPUT}"></label>
                          <label style="${FIELD}"><span style="${FLABEL}">RedotPay card (USD)</span><input value="{{ mstCardUSD }}" onChange="{{ onMstCardUSD }}" onKeyDown="{{ mstStartKey }}" aria-label="RedotPay card in USD" inputmode="decimal" placeholder="0.00" style="${INPUT}"></label>
                        </div>
                        <div style="${ROW};align-items:flex-end;margin-top:10px">
                          <label style="${FIELD}"><span style="${FLABEL}">Today’s rate (DA per 1 USD)</span><input value="{{ mstFx }}" onChange="{{ onMstFx }}" onKeyDown="{{ mstStartKey }}" aria-label="DA per 1 USD" inputmode="decimal" placeholder="optional" style="${INPUT}"></label>
                          <label style="${FIELD}"><span style="${FLABEL}">Payday (day 1–28)</span><input value="{{ mstPayday }}" onChange="{{ onMstPayday }}" onKeyDown="{{ mstStartKey }}" aria-label="Payday, a day from 1 to 28" inputmode="numeric" placeholder="optional" style="${INPUT}"></label>
                        </div>
                        <sc-if value="{{ mstHasRefused }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--red);margin-top:10px">{{ mstRefusedText }}</div></sc-if>
                        <div style="${ROW};margin-top:12px"><button type="button" onClick="{{ mstStartGo }}" disabled="{{ mstStartBusy }}" style="${GOLD}" ${GOLD_HOVER}>{{ mstStartLabel }}</button><button type="button" onClick="{{ mnyImport }}" style="${BTN}" ${BTN_HOVER}>Import an Ember export…</button></div>
                        <div style="font-size:12px;color:var(--faint);margin-top:8px">{{ mstStartHint }}</div>
                      </section>
`;

export const quickLine = String.raw`<!-- v5: money quick line — one line per spend -->
                      <section aria-label="Log a spend in one line">
                        <div style="${LABEL}">log a spend in one line</div>
                        <div style="${ROW}"><input value="{{ mstLine }}" onChange="{{ onMstLine }}" onKeyDown="{{ mstLineKey }}" aria-label="Spend line" placeholder="{{ mstPlaceholder }}" autocomplete="off" style="${INPUT};flex:1 1 280px"><button type="button" onClick="{{ mstLineGo }}" disabled="{{ !mstLineCanSend }}" style="${GOLD}" ${GOLD_HOVER}>Log</button></div>
                        <sc-if value="{{ mstHasPreview }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;margin-top:6px;color:{{ mstPreviewColor }}">{{ mstPreviewText }}</div></sc-if>
                        <sc-if value="{{ mstHasPreviewErr }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;margin-top:6px;color:var(--orange)">{{ mstPreviewErrText }}</div></sc-if>
                        <sc-if value="{{ mstHasLineError }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:12px;margin-top:6px;color:var(--red)">{{ mstLineErrorText }}</div></sc-if>
                        <sc-if value="{{ mstHasNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;margin-top:6px;color:var(--green)">{{ mstNoteText }}</div></sc-if>
                      </section>
`;

export default startCard;
