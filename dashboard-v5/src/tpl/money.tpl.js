// Money screen (v.money): today · runway · jars · inbox. Ported from Ember (Brvetr4ve1er/money-manager-).
// <!-- v5: money space --> new fragment, joined in src/app.tpl.js after studio. dc-lite dialect only:
// dotted paths, !, ===; every number arrives finished from vals/money.js (computed main-side).
// The style constants below are the exact button/input/label strings the other fragments inline.
// <!-- v5: money quick start --> the start card (no accounts) and the quick line (Today) live in tpl/money-start.tpl.js.
import { startCard, quickLine } from './money-start.tpl.js';
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;min-width:0';
const CARD = 'padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const ROW = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
const CHIPS = (list, as) => `<sc-for list="{{ ${list} }}" as="${as}" hint-placeholder-count="3"><button type="button" onClick="{{ ${as}.go }}" aria-pressed="{{ ${as}.pressed }}" style="{{ ${as}.style }}">{{ ${as}.label }}</button></sc-for>`;

export default String.raw`        <sc-if value="{{ v.money }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:22px;max-width:900px">
            <sc-if value="{{ mnyOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Money needs the desktop app’s money module (hq.money). Nothing to show here without it — your money data stays in data/money/ and is untouched.</div></sc-if>
            <sc-if value="{{ mnyError }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><span style="font-size:14px;color:var(--red)">Couldn’t read money data · {{ mnyErrorText }}</span><button type="button" onClick="{{ mnyRetry }}" style="${BTN}" ${BTN_HOVER}>Retry</button></div></sc-if>
            <sc-if value="{{ mnyLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Reading money data…</div></sc-if>
            <sc-if value="{{ mnyScrubbed }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--blue)">You’re looking at an older scan — money isn’t part of the scan, so this screen stays live and editable.</div></sc-if>
            <sc-if value="{{ mnyHasAsk }}" hint-placeholder-val="{{ false }}"><div style="${CARD};${ROW};border-color:var(--orange)"><span style="font-size:13px;flex:1 1 240px">{{ mnyAskText }}</span><button type="button" onClick="{{ mnyAskYes }}" style="${GOLD}" ${GOLD_HOVER}>Archive</button><button type="button" onClick="{{ mnyAskNo }}" style="${BTN}" ${BTN_HOVER}>Keep it</button></div></sc-if>
            <sc-if value="{{ mnyReady }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:22px">
                <!-- today -->
                <sc-if value="{{ mnyIsToday }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;flex-direction:column;gap:22px">
                    <sc-if value="{{ mnyNoAccounts }}" hint-placeholder-val="{{ false }}">
                      ${startCard}                    </sc-if>
                    <sc-if value="{{ mnyHasAccounts }}" hint-placeholder-val="{{ true }}">
                      ${quickLine}                      <section>
                        <div style="${LABEL}">breathing room until payday · {{ mnyRoom.payday }}</div>
                        <div style="display:flex;gap:30px;flex-wrap:wrap;align-items:baseline">
                          <div><div style="font-size:38px;line-height:1;color:{{ mnyRoomColor }}">{{ mnyRoom.amount }}</div><div style="font-size:12px;color:var(--muted)">{{ mnyRoom.perDay }} · {{ mnyRoom.days }} left · a forecast, not a verdict</div></div>
                          <div style="font-size:12px;color:var(--muted);display:grid;grid-template-columns:auto auto;gap:2px 12px"><span>you hold</span><span style="color:var(--text)">{{ mnyRoom.holdings }}</span><span>in jars</span><span style="color:var(--text)">− {{ mnyRoom.jars }}</span><span>bills before payday</span><span style="color:var(--text)">− {{ mnyRoom.due }}</span></div>
                        </div>
                        <sc-if value="{{ mnyRoomMissing }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange);margin-top:8px">Some USD isn’t counted yet — set your DA rate below.</div></sc-if>
                      </section>
                      <section>
                        <div style="${LABEL}">log a spend</div>
                        <div style="${ROW}"><input value="{{ mnyLogAmount }}" onChange="{{ onMnyLogAmount }}" onKeyDown="{{ mnyLogKey }}" aria-label="Amount" inputmode="decimal" placeholder="amount" style="${INPUT};width:120px">${CHIPS('mnyLogCur', 'lc')}<input value="{{ mnyLogNote }}" onChange="{{ onMnyLogNote }}" onKeyDown="{{ mnyLogKey }}" aria-label="Note (optional)" placeholder="note (optional)" style="${INPUT};flex:1 1 160px"><button type="button" onClick="{{ mnyLogGo }}" style="${GOLD}" ${GOLD_HOVER}>Log it</button></div>
                        <div style="${ROW};margin-top:8px">${CHIPS('mnyLogCats', 'lk')}</div>
                        <div style="${ROW};margin-top:8px"><span style="font-size:12px;color:var(--faint)">from</span>${CHIPS('mnyLogAccts', 'la')}</div>
                      </section>
                    </sc-if>
                    <sc-if value="{{ mnyAcctOpen }}" hint-placeholder-val="{{ false }}">
                      <section style="${CARD}">
                        <div style="${LABEL}">{{ mnyAcctTitle }}</div>
                        <div style="${ROW}"><input value="{{ mnyAcctName }}" onChange="{{ onMnyAcctName }}" onKeyDown="{{ mnyAcctKey }}" aria-label="Account name" placeholder="name (cash, CCP, RedotPay)" style="${INPUT};flex:1 1 180px"><input value="{{ mnyAcctBalance }}" onChange="{{ onMnyAcctBalance }}" onKeyDown="{{ mnyAcctKey }}" aria-label="Balance now" inputmode="decimal" placeholder="balance now" style="${INPUT};width:140px"></div>
                        <sc-if value="{{ mnyAcctIsNew }}" hint-placeholder-val="{{ true }}"><div style="${ROW};margin-top:8px">${CHIPS('mnyAcctCur', 'ac')}</div></sc-if>
                        <div style="${ROW};margin-top:10px"><button type="button" onClick="{{ mnyAcctSave }}" style="${GOLD}" ${GOLD_HOVER}>Save</button><button type="button" onClick="{{ mnyAcctCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button><span style="font-size:12px;color:var(--faint)">The balance you type is the truth from now on; spending after it moves the estimate.</span></div>
                      </section>
                    </sc-if>
                    <sc-if value="{{ mnyHasAccounts }}" hint-placeholder-val="{{ true }}">
                      <section>
                        <div style="${ROW};margin-bottom:10px"><span style="${LABEL};margin-bottom:0">accounts</span><span style="flex:1"></span><button type="button" onClick="{{ mnyAcctAdd }}" style="${BTN}" ${BTN_HOVER}>＋ Account</button></div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:12px">
                          <sc-for list="{{ mnyAccounts }}" as="a" hint-placeholder-count="2">
                            <div style="${CARD};display:flex;flex-direction:column;gap:6px">
                              <div style="${ROW}"><span style="font-size:15px">{{ a.name }}</span><span style="flex:1"></span><span style="font-size:11px;color:var(--muted);border:1px solid var(--frame);border-radius:6px;padding:1px 6px">{{ a.tag }}</span></div>
                              <div style="font-size:24px;line-height:1.1">{{ a.balance }}</div>
                              <sc-if value="{{ a.isUsd }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ a.balanceDA }}</div></sc-if>
                              <div style="font-size:12px;color:var(--faint)">{{ a.confirmed }}</div>
                              <sc-if value="{{ a.stale }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">A week since you checked — confirm it when you can.</div></sc-if>
                              <div style="${ROW}"><button type="button" onClick="{{ a.confirm }}" style="${BTN}" ${BTN_HOVER}>Confirm balance</button><button type="button" onClick="{{ a.archive }}" style="${BTN}" ${BTN_HOVER}>Archive</button></div>
                            </div>
                          </sc-for>
                        </div>
                      </section>
                      <section>
                        <div style="${LABEL}">your rate and payday</div>
                        <div style="${ROW}"><span style="font-size:12px;color:var(--muted)">DA per 1 USD</span><input value="{{ mnyFx }}" onChange="{{ onMnyFx }}" onKeyDown="{{ mnySetKey }}" aria-label="DA per 1 USD (your rate)" inputmode="decimal" placeholder="e.g. 245" style="${INPUT};width:100px"><span style="font-size:12px;color:var(--muted)">payday (day of month)</span><input value="{{ mnyPd }}" onChange="{{ onMnyPd }}" onKeyDown="{{ mnySetKey }}" aria-label="Payday (day of month)" inputmode="numeric" placeholder="1–28" style="${INPUT};width:70px"><button type="button" onClick="{{ mnySetSave }}" style="${BTN}" ${BTN_HOVER}>Save</button></div>
                        <sc-if value="{{ mnyNoFx }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--faint);margin-top:6px">Your rate, not the bank’s — whatever you actually get. No payday set means end of the month.</div></sc-if>
                      </section>
                    </sc-if>
                    <section>
                      <div style="${ROW};margin-bottom:10px"><span style="${LABEL};margin-bottom:0">ledger</span><span style="flex:1"></span><button type="button" onClick="{{ mnyImport }}" style="${BTN}" ${BTN_HOVER}>Import…</button><button type="button" onClick="{{ mnyExport }}" style="${BTN}" ${BTN_HOVER}>Export…</button></div>
                      <sc-if value="{{ mnyHasRecent }}" hint-placeholder-val="{{ true }}">
                        <div><sc-for list="{{ mnyRecent }}" as="t" hint-placeholder-count="4"><div style="display:flex;gap:12px;align-items:baseline;padding:8px 4px;border-bottom:1px dashed var(--frame);font-size:13px;flex-wrap:wrap"><span style="min-width:120px">{{ t.amount }}</span><span style="color:var(--accent-text)">{{ t.category }}</span><span style="flex:1 1 200px;color:var(--muted)">{{ t.meta }}</span><sc-if value="{{ t.canUndo }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ t.undo }}" aria-label="Remove this entry" style="${BTN};height:24px">Remove</button></sc-if></div></sc-for></div>
                      </sc-if>
                      <sc-if value="{{ mnyNoRecent }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">No entries yet.</div></sc-if>
                      <div style="font-size:12px;color:var(--faint);margin-top:8px">{{ mnyLedgerMore }}</div>
                    </section>
                  </div>
                </sc-if>
                <!-- runway -->
                <sc-if value="{{ mnyIsRunway }}" hint-placeholder-val="{{ false }}">
                  <div style="display:flex;flex-direction:column;gap:22px">
                    <div style="display:flex;gap:30px;flex-wrap:wrap">
                      <div><div style="font-size:38px;line-height:1">{{ mnyDaysToPayday }}</div><div style="font-size:12px;color:var(--muted)">days to payday · {{ mnyPayday }}</div></div>
                      <div><div style="font-size:38px;line-height:1;color:var(--orange)">{{ mnyDueBefore }}</div><div style="font-size:12px;color:var(--muted)">likely to go out before then</div></div>
                    </div>
                    <div style="font-size:12px;color:var(--orange)">{{ mnyDueMissing }}</div>
                    <div style="${ROW}"><button type="button" onClick="{{ mnyBillAdd }}" style="${GOLD}" ${GOLD_HOVER}>＋ Something that repeats</button></div>
                    <sc-if value="{{ mnyBillOpen }}" hint-placeholder-val="{{ false }}">
                      <section style="${CARD};display:flex;flex-direction:column;gap:8px">
                        <div style="${LABEL};margin-bottom:0">{{ mnyBillTitle }}</div>
                        <div style="${ROW}"><input value="{{ mnyBillName }}" onChange="{{ onMnyBillName }}" aria-label="Name" placeholder="name (rent, Idoom, Netflix)" style="${INPUT};flex:1 1 180px"><input value="{{ mnyBillAmount }}" onChange="{{ onMnyBillAmount }}" aria-label="Amount" inputmode="decimal" placeholder="amount" style="${INPUT};width:120px">${CHIPS('mnyBillCur', 'bc')}</div>
                        <div style="${ROW}">${CHIPS('mnyBillKinds', 'bk')}</div>
                        <sc-if value="{{ mnyBillNotInst }}" hint-placeholder-val="{{ true }}"><div style="${ROW}"><span style="font-size:12px;color:var(--faint)">repeats</span>${CHIPS('mnyBillCads', 'bd')}</div></sc-if>
                        <sc-if value="{{ mnyBillIsInst }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><span style="font-size:12px;color:var(--faint)">payments in all</span><input value="{{ mnyBillTotal }}" onChange="{{ onMnyBillTotal }}" aria-label="Payments in all" inputmode="numeric" style="${INPUT};width:70px"><span style="font-size:12px;color:var(--faint)">already paid</span><input value="{{ mnyBillPaid }}" onChange="{{ onMnyBillPaid }}" aria-label="Already paid" inputmode="numeric" style="${INPUT};width:70px"></div></sc-if>
                        <div style="${ROW}"><span style="font-size:12px;color:var(--faint)">first due</span><input value="{{ mnyBillDue }}" onChange="{{ onMnyBillDue }}" aria-label="First due (yyyy-mm-dd)" placeholder="yyyy-mm-dd" style="${INPUT};width:130px"><span style="font-size:12px;color:var(--faint)">paid from</span>${CHIPS('mnyBillAccts', 'ba')}</div>
                        <input value="{{ mnyBillStep }}" onChange="{{ onMnyBillStep }}" aria-label="Next step (optional)" placeholder="next step (optional) — e.g. pay at the post office" style="${INPUT}">
                        <div style="${ROW}"><button type="button" onClick="{{ mnyBillSave }}" style="${GOLD}" ${GOLD_HOVER}>Save</button><button type="button" onClick="{{ mnyBillCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div>
                      </section>
                    </sc-if>
                    <sc-if value="{{ mnyHasBills }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;flex-direction:column;gap:10px">
                        <sc-for list="{{ mnyObligations }}" as="o" hint-placeholder-count="3">
                          <div style="${CARD};border-left:3px solid {{ o.color }}">
                            <div style="${ROW}"><span style="font-size:15px">{{ o.name }}</span><span style="font-size:12px;color:{{ o.color }}">{{ o.meta }}</span><span style="flex:1"></span><span style="font-size:15px">{{ o.amount }}</span></div>
                            <sc-if value="{{ o.nextStep }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted);margin-top:4px">next step · {{ o.nextStep }}</div></sc-if>
                            <div style="${ROW};margin-top:8px">
                              <sc-if value="{{ !o.isDone }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ o.pay }}" style="${GOLD}" ${GOLD_HOVER}>Pay</button></sc-if>
                              <sc-if value="{{ o.hasUndo }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ o.undo }}" style="${BTN}" ${BTN_HOVER}>Undo today’s payment</button></sc-if>
                              <button type="button" onClick="{{ o.edit }}" style="${BTN}" ${BTN_HOVER}>Edit</button><button type="button" onClick="{{ o.archive }}" style="${BTN}" ${BTN_HOVER}>Archive</button>
                            </div>
                            <sc-if value="{{ o.payOpen }}" hint-placeholder-val="{{ false }}">
                              <div style="${ROW};margin-top:10px;padding-top:10px;border-top:1px dashed var(--frame)"><input value="{{ mnyPayAmount }}" onChange="{{ onMnyPayAmount }}" onKeyDown="{{ mnyPayKey }}" aria-label="Amount paid" inputmode="decimal" placeholder="{{ o.amount }}" style="${INPUT};width:130px"><span style="font-size:12px;color:var(--faint)">from</span>${CHIPS('mnyPayAccts', 'pa')}<button type="button" onClick="{{ mnyPayGo }}" style="${GOLD}" ${GOLD_HOVER}>Mark paid</button><button type="button" onClick="{{ mnyPayCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div>
                            </sc-if>
                          </div>
                        </sc-for>
                      </div>
                    </sc-if>
                    <sc-if value="{{ mnyNoBills }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Nothing on the runway yet. Add rent, Idoom, the phone, a subscription on the card, an installment — anything that comes round again.</div></sc-if>
                  </div>
                </sc-if>
                <!-- jars -->
                <sc-if value="{{ mnyIsJars }}" hint-placeholder-val="{{ false }}">
                  <div style="display:flex;flex-direction:column;gap:22px">
                    <div style="${ROW}"><button type="button" onClick="{{ mnyJarAdd }}" style="${GOLD}" ${GOLD_HOVER}>＋ Jar</button><span style="font-size:12px;color:var(--faint)">or start from</span>${CHIPS('mnyJarPresets', 'jp')}</div>
                    <sc-if value="{{ mnyJarOpen }}" hint-placeholder-val="{{ false }}">
                      <section style="${CARD};display:flex;flex-direction:column;gap:8px">
                        <div style="${LABEL};margin-bottom:0">{{ mnyJarTitle }}</div>
                        <div style="${ROW}"><input value="{{ mnyJarName }}" onChange="{{ onMnyJarName }}" aria-label="Jar name" placeholder="name" style="${INPUT};flex:1 1 160px"><input value="{{ mnyJarTarget }}" onChange="{{ onMnyJarTarget }}" aria-label="Target (optional)" inputmode="decimal" placeholder="target DA (optional)" style="${INPUT};width:150px"><input value="{{ mnyJarDate }}" onChange="{{ onMnyJarDate }}" aria-label="Target date (optional)" placeholder="by yyyy-mm-dd (optional)" style="${INPUT};width:170px"></div>
                        <div style="${ROW}"><button type="button" onClick="{{ mnyJarSave }}" style="${GOLD}" ${GOLD_HOVER}>Save</button><button type="button" onClick="{{ mnyJarCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div>
                      </section>
                    </sc-if>
                    <sc-if value="{{ mnyHasJars }}" hint-placeholder-val="{{ true }}">
                      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr));gap:12px">
                        <sc-for list="{{ mnyJars }}" as="j" hint-placeholder-count="3">
                          <div style="${CARD};display:flex;flex-direction:column;gap:8px">
                            <div style="${ROW}"><span style="font-size:15px">{{ j.name }}</span><span style="flex:1"></span><span style="font-size:15px;color:{{ j.color }}">{{ j.balance }}</span></div>
                            <sc-if value="{{ j.hasTarget }}" hint-placeholder-val="{{ true }}">
                              <div><div style="height:10px;background:var(--ink);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:{{ j.pct }}%;background:{{ j.color }}"></span></div><div style="font-size:12px;color:var(--muted);margin-top:4px">{{ j.pct }}% of {{ j.target }}</div></div>
                            </sc-if>
                            <div style="font-size:12px;color:var(--muted)">{{ j.pace }}</div>
                            <div style="font-size:12px;color:{{ j.color }}">{{ j.status }}</div>
                            <div style="${ROW}"><button type="button" onClick="{{ j.topup }}" style="${BTN}" ${BTN_HOVER}>Add</button><button type="button" onClick="{{ j.take }}" style="${BTN}" ${BTN_HOVER}>Take out</button><sc-if value="{{ j.overspent }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ j.coverIt }}" style="${BTN}" ${BTN_HOVER}>Cover it</button></sc-if><button type="button" onClick="{{ j.edit }}" style="${BTN}" ${BTN_HOVER}>Edit</button><button type="button" onClick="{{ j.archive }}" style="${BTN}" ${BTN_HOVER}>Archive</button></div>
                            <sc-if value="{{ j.moveOpen }}" hint-placeholder-val="{{ false }}"><div style="${ROW};padding-top:8px;border-top:1px dashed var(--frame)"><input value="{{ mnyMoveAmount }}" onChange="{{ onMnyMoveAmount }}" onKeyDown="{{ mnyMoveKey }}" aria-label="Amount" inputmode="decimal" placeholder="amount DA" style="${INPUT};width:120px"><button type="button" onClick="{{ mnyMoveGo }}" style="${GOLD}" ${GOLD_HOVER}>{{ mnyMoveLabel }}</button><button type="button" onClick="{{ mnyMoveCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div></sc-if>
                            <sc-if value="{{ j.coverOpen }}" hint-placeholder-val="{{ false }}"><div style="display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px dashed var(--frame)"><div style="${ROW}"><span style="font-size:12px;color:var(--faint)">cover from</span>${CHIPS('j.coverFrom', 'cf')}</div><div style="${ROW}"><input value="{{ mnyCoverAmount }}" onChange="{{ onMnyCoverAmount }}" aria-label="Amount to move" inputmode="decimal" style="${INPUT};width:120px"><button type="button" onClick="{{ mnyCoverGo }}" style="${GOLD}" ${GOLD_HOVER}>Move it</button><button type="button" onClick="{{ mnyCoverCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div></div></sc-if>
                          </div>
                        </sc-for>
                      </div>
                      <section style="${CARD}">
                        <div style="${LABEL}">payday split · {{ mnySplitTotal }} each payday</div>
                        <div style="display:flex;flex-direction:column;gap:6px"><sc-for list="{{ mnyJars }}" as="sj" hint-placeholder-count="2"><div style="${ROW}"><span style="font-size:13px;min-width:140px">{{ sj.name }}</span><input value="{{ sj.splitVal }}" onChange="{{ sj.onSplit }}" aria-label="Payday amount for this jar" inputmode="decimal" placeholder="0" style="${INPUT};width:120px"></div></sc-for></div>
                        <div style="${ROW};margin-top:10px"><button type="button" onClick="{{ mnySplitSave }}" style="${BTN}" ${BTN_HOVER}>Save split</button><button type="button" onClick="{{ mnyPaydayStart }}" style="${GOLD}" ${GOLD_HOVER}>Pay landed — run the split</button></div>
                        <sc-if value="{{ mnyPaydayOpen }}" hint-placeholder-val="{{ false }}"><div style="${ROW};margin-top:10px;padding-top:10px;border-top:1px dashed var(--frame)"><input value="{{ mnyPaydayAmount }}" onChange="{{ onMnyPaydayAmount }}" aria-label="Pay amount" inputmode="decimal" placeholder="how much came in" style="${INPUT};width:150px"><span style="font-size:12px;color:var(--faint)">into</span>${CHIPS('mnyPaydayAccts', 'pd')}<button type="button" onClick="{{ mnyPaydayGo }}" style="${GOLD}" ${GOLD_HOVER}>Record + split</button><button type="button" onClick="{{ mnyPaydayCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div></sc-if>
                      </section>
                    </sc-if>
                    <sc-if value="{{ mnyNoJars }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No jars yet. A jar gives money a job — Eid, rentrée, a soft landing — before it gets spent on something else.</div></sc-if>
                  </div>
                </sc-if>
                <!-- inbox -->
                <sc-if value="{{ mnyIsInbox }}" hint-placeholder-val="{{ false }}">
                  <div style="display:flex;flex-direction:column;gap:22px">
                    <section style="${CARD};display:flex;flex-direction:column;gap:8px">
                      <div style="${LABEL};margin-bottom:0">paste a receipt, email or sms</div>
                      <textarea value="{{ mnyPasteText }}" onChange="{{ onMnyPasteText }}" aria-label="Paste a receipt, email or SMS" rows="4" placeholder="Several at once? Separate them with a blank line or ---" style="width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--frame);border-radius:8px;background:transparent;color:var(--text);padding:8px 10px;font-family:var(--term);font-size:13px"></textarea>
                      <div style="${ROW}"><input value="{{ mnyPasteFrom }}" onChange="{{ onMnyPasteFrom }}" aria-label="From (optional)" placeholder="from (optional) — RedotPay, BaridiMob, orders@jumia.dz" style="${INPUT};flex:1 1 220px"><button type="button" onClick="{{ mnyPasteGo }}" style="${GOLD}" ${GOLD_HOVER}>Read it</button></div>
                      <div style="font-size:12px;color:var(--faint)">Read locally. Nothing is logged until you confirm a slip.</div>
                    </section>
                    <sc-if value="{{ mnyHasSlips }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <sc-for list="{{ mnySlips }}" as="c" hint-placeholder-count="2">
                          <div style="${CARD};display:flex;flex-direction:column;gap:8px">
                            <div style="${ROW}"><span style="font-size:15px">{{ c.merchant }}</span><span style="font-size:12px;color:var(--muted)">{{ c.day }} · {{ c.sure }}% sure</span><span style="flex:1"></span><span style="font-size:15px">{{ c.amount }}</span><span style="font-size:12px;color:var(--muted)">{{ c.approx }}</span></div>
                            <sc-if value="{{ c.hasNotes }}" hint-placeholder-val="{{ false }}"><div style="display:flex;flex-direction:column;gap:4px"><sc-for list="{{ c.notesList }}" as="nt" hint-placeholder-count="1"><div style="font-size:12px;color:var(--orange)">{{ nt.text }}</div></sc-for></div></sc-if>
                            <sc-for list="{{ c.sources }}" as="src" hint-placeholder-count="1"><div style="font-size:12px;padding:8px 10px;background:var(--ink);border:1px dashed var(--frame);border-radius:8px"><div style="color:var(--muted)">{{ src.from }}</div><div style="white-space:pre-wrap;text-wrap:pretty">{{ src.text }}</div></div></sc-for>
                            <sc-if value="{{ !c.refund }}" hint-placeholder-val="{{ true }}"><div style="${ROW}">${CHIPS('c.cats', 'ck')}</div></sc-if>
                            <div style="${ROW}"><span style="font-size:12px;color:var(--faint)">account</span>${CHIPS('c.accts', 'ca')}</div>
                            <sc-if value="{{ c.armed }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)" role="alert">{{ c.warnLine }}</div></sc-if>
                            <div style="${ROW}"><button type="button" onClick="{{ c.confirm }}" style="${GOLD}" ${GOLD_HOVER}>{{ c.confirmLabel }}</button><button type="button" onClick="{{ c.reject }}" style="${BTN}" ${BTN_HOVER}>{{ c.rejectLabel }}</button></div>
                          </div>
                        </sc-for>
                      </div>
                    </sc-if>
                    <sc-if value="{{ mnyNoSlips }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Tray is empty. Money never reads your messages on its own — paste one above.</div></sc-if>
                    <sc-if value="{{ mnyHandled }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><span style="font-size:12px;color:var(--faint)">{{ mnyHandled }}</span><button type="button" onClick="{{ mnyClear }}" style="${BTN}" ${BTN_HOVER}>Clear handled</button></div></sc-if>
                  </div>
                </sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>
`;
