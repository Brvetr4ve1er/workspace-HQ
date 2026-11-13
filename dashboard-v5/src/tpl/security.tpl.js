// Security screen (v.security, the 11th destination, no number key): Map, Health, Setup, Generator, plus the unlock dialog and the emergency sheet.
// <!-- v5: security space --> new fragment, joined in src/app.tpl.js after cosmos. dc-lite dialect only: dotted paths, !, ===; every value arrives finished
// from vals/security.js and ALL of it rides under the one top-level key secv ({{ secv.secShow }}). Tokens only (var(--...)), except the printed sheet,
// which is paper. No window., no fetch: a fragment binds to vals; the actions are vals handlers (logic/security.js).
//
// The passphrase input below carries NO value binding and NO change handler: it is uncontrolled. Its element is read once, at click time, by
// logic/security.js (secSubmitUnlock) through the ref and emptied in the same tick. Nothing in this file may ever bind it.
//
// Named exports let the integrator place the overlays apart from the space if a transformed ancestor would trap position:fixed:
//   space    the four sub-views        overlays   the unlock dialog and the emergency sheet        default = space + overlays
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;min-width:0';
const CARD = 'padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const ROW = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
const COL = 'display:flex;flex-direction:column;gap:10px';
const MUTED = 'font-size:12px;color:var(--muted)';
const WARN = 'font-size:13px;color:var(--red)';

export const space = String.raw`        <sc-if value="{{ secv.secShow }}" hint-placeholder-val="{{ false }}">
          <div data-sec="space" style="display:flex;flex-direction:column;gap:16px;width:100%">
            <sc-if value="{{ secv.secOffline }}" hint-placeholder-val="{{ false }}"><div data-sec="offline" style="font-size:14px;color:var(--muted)">{{ secv.secOfflineText }}</div></sc-if>
            <sc-if value="{{ secv.secLoading }}" hint-placeholder-val="{{ false }}"><div data-sec="loading" style="font-size:13px;color:var(--muted)">{{ secv.secLoadingText }}</div></sc-if>
            <sc-if value="{{ secv.secHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" data-sec="error" style="${WARN}">{{ secv.secErrText }}</div></sc-if>
            <sc-if value="{{ !secv.secOffline }}" hint-placeholder-val="{{ true }}">
              <div style="${COL}">
                <!-- v5: the strip above every sub-view: what the map holds, when it was read, the one Refresh -->
                <section style="${COL}">
                  <div style="${MUTED}">{{ secv.secIntro }}</div>
                  <div style="${ROW}">
                    <span data-sec="status" aria-live="polite" style="font-size:12px;color:var(--text)">{{ secv.secStatusLine }}</span>
                    <span style="flex:1"></span>
                    <button type="button" data-sec="refresh" onClick="{{ secv.secRefreshOpen }}" disabled="{{ secv.secRefreshOff }}" style="${GOLD}" ${GOLD_HOVER}>{{ secv.secRefreshLabel }}</button>
                  </div>
                  <sc-if value="{{ secv.secHasRefreshWhy }}" hint-placeholder-val="{{ false }}"><div data-sec="refresh-why" style="${MUTED}">{{ secv.secRefreshWhy }}</div></sc-if>
                  <sc-if value="{{ secv.secHasNote }}" hint-placeholder-val="{{ false }}"><div data-sec="note" role="status" style="font-size:12px;color:var(--green)">{{ secv.secNote }}</div></sc-if>
                </section>

                <!-- v5: MAP -->
                <sc-if value="{{ secv.secSubMap }}" hint-placeholder-val="{{ true }}">
                  <div data-sec="map" style="${COL}">
                    <div style="${ROW}">
                      <button type="button" data-sec="add-account" onClick="{{ secv.secAddAccount }}" disabled="{{ secv.secAddOff }}" style="${BTN}" ${BTN_HOVER}>Add account</button>
                      <button type="button" data-sec="add-identity" onClick="{{ secv.secAddIdentity }}" disabled="{{ secv.secAddOff }}" style="${BTN}" ${BTN_HOVER}>Add identity</button>
                      <span data-sec="count" style="${MUTED}">{{ secv.secNodeCountText }}</span>
                    </div>
                    <sc-if value="{{ secv.secFormAccount }}" hint-placeholder-val="{{ false }}">
                      <div data-sec="form-account" role="group" aria-label="Add an account by hand" style="${CARD};${COL}">
                        <div style="${LABEL}">Add an account by hand</div>
                        <div style="${ROW}">
                          <input data-sec="form-title" ref="{{ secv.secTitleRef }}" onKeyDown="{{ secv.secFormKey }}" aria-label="Account name" placeholder="name, e.g. alpha-site" autocomplete="off" spellcheck="false" style="${INPUT};flex:1 1 180px">
                          <input data-sec="form-host" ref="{{ secv.secHostRef }}" onKeyDown="{{ secv.secFormKey }}" aria-label="Site address" placeholder="address, e.g. alpha-site.test" autocomplete="off" spellcheck="false" style="${INPUT};flex:1 1 180px">
                        </div>
                        <div style="${MUTED}">Names only. A password is never asked for here.</div>
                        <sc-if value="{{ secv.secHasFormErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="${WARN}">{{ secv.secFormErr }}</div></sc-if>
                        <div style="${ROW}"><button type="button" data-sec="form-save" onClick="{{ secv.secFormSubmit }}" disabled="{{ secv.secFormBusy }}" style="${GOLD}" ${GOLD_HOVER}>Add</button><button type="button" onClick="{{ secv.secFormCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div>
                      </div>
                    </sc-if>
                    <sc-if value="{{ secv.secFormIdentity }}" hint-placeholder-val="{{ false }}">
                      <div data-sec="form-identity" role="group" aria-label="Add an identity" style="${CARD};${COL}">
                        <div style="${LABEL}">Add an identity (an email address or a phone number)</div>
                        <div style="${ROW}">
                          <select data-sec="form-idkind" ref="{{ secv.secIdKindRef }}" aria-label="Kind" style="${INPUT}"><option value="email">email</option><option value="phone">phone</option></select>
                          <input data-sec="form-idvalue" ref="{{ secv.secIdValueRef }}" onKeyDown="{{ secv.secFormKey }}" aria-label="Address or number" placeholder="owner@example.test" autocomplete="off" spellcheck="false" style="${INPUT};flex:1 1 220px">
                        </div>
                        <div style="${MUTED}">It is stored encrypted and shown only in the main window, nowhere else.</div>
                        <sc-if value="{{ secv.secHasFormErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="${WARN}">{{ secv.secFormErr }}</div></sc-if>
                        <div style="${ROW}"><button type="button" data-sec="form-save" onClick="{{ secv.secFormSubmit }}" disabled="{{ secv.secFormBusy }}" style="${GOLD}" ${GOLD_HOVER}>Add</button><button type="button" onClick="{{ secv.secFormCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div>
                      </div>
                    </sc-if>
                    <sc-if value="{{ secv.secMapEmpty }}" hint-placeholder-val="{{ false }}"><div data-sec="empty" style="font-size:14px;color:var(--muted)">{{ secv.secMapEmptyText }}</div></sc-if>
                    <sc-if value="{{ secv.secMapReady }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
                        <div style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:8px">
                          <svg data-sec="graph" viewBox="{{ secv.secViewBox }}" role="group" aria-label="Footprint map: large bubbles are identities, small bubbles are accounts" style="width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                            <sc-for list="{{ secv.secEdges }}" as="e" hint-placeholder-count="6">
                              <line x1="{{ e.x1 }}" y1="{{ e.y1 }}" x2="{{ e.x2 }}" y2="{{ e.y2 }}" style="{{ e.style }}"></line>
                            </sc-for>
                            <sc-for list="{{ secv.secNodes }}" as="n" hint-placeholder-count="8">
                              <g data-sec-node="{{ n.id }}" data-sec-kind="{{ n.kindText }}" role="{{ n.role }}" tabindex="{{ n.tab }}" aria-label="{{ n.title }}" onClick="{{ n.go }}" onKeyDown="{{ n.key }}" style="cursor:pointer;opacity:{{ n.opacity }}">
                                <title>{{ n.title }}</title>
                                <circle cx="{{ n.cx }}" cy="{{ n.cy }}" r="{{ n.r }}" style="fill:{{ n.fill }};stroke:{{ n.stroke }};stroke-width:{{ n.strokeW }};stroke-dasharray:{{ n.dash }}"></circle>
                                <sc-for list="{{ n.dots }}" as="d" hint-placeholder-count="2"><circle cx="{{ d.cx }}" cy="{{ d.cy }}" r="3.5" style="fill:{{ d.fill }};stroke:var(--card);stroke-width:1"></circle></sc-for>
                                <sc-if value="{{ n.showLabel }}" hint-placeholder-val="{{ true }}"><text x="{{ n.tx }}" y="{{ n.ty }}" text-anchor="middle" style="fill:var(--text);font-size:11px;font-family:var(--term)">{{ n.label }}</text></sc-if>
                              </g>
                            </sc-for>
                          </svg>
                          <div style="${ROW}"><sc-for list="{{ secv.secLegend }}" as="lg" hint-placeholder-count="3"><span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--faint)"><svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" style="{{ lg.style }}"></line></svg>{{ lg.text }}</span></sc-for></div>
                          <sc-if value="{{ secv.secHasFold }}" hint-placeholder-val="{{ false }}"><div data-sec="fold" style="${MUTED}">{{ secv.secFoldText }}</div></sc-if>
                          <sc-if value="{{ secv.secHasLocked }}" hint-placeholder-val="{{ false }}"><div data-sec="locked" style="font-size:12px;color:var(--orange)">{{ secv.secLockedNote }}</div></sc-if>
                        </div>
                        <!-- v5: the side card of the picked bubble -->
                        <sc-if value="{{ secv.secCard.show }}" hint-placeholder-val="{{ false }}">
                          <aside data-sec="card" role="region" aria-label="Details of the picked bubble" style="flex:0 1 320px;min-width:min(100%,260px);${CARD};${COL}">
                            <div style="${ROW}"><span data-sec="card-title" style="font-size:15px;color:var(--text);word-break:break-word">{{ secv.secCard.title }}</span><span style="flex:1"></span><button type="button" data-sec="card-close" onClick="{{ secv.secCard.close }}" aria-label="Close the details" style="${BTN}" ${BTN_HOVER}>Close</button></div>
                            <div style="${MUTED}">{{ secv.secCard.kindText }}</div>
                            <sc-if value="{{ secv.secCard.hasHost }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--text);word-break:break-all">{{ secv.secCard.host }}</div></sc-if>
                            <sc-if value="{{ secv.secCard.hasGroup }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint);word-break:break-all">in {{ secv.secCard.group }}</div></sc-if>
                            <sc-if value="{{ secv.secCard.isIdentity }}" hint-placeholder-val="{{ false }}">
                              <div style="${COL}">
                                <sc-if value="{{ secv.secCard.hasUses }}" hint-placeholder-val="{{ true }}"><div style="font-size:13px;color:var(--text)">{{ secv.secCard.usesText }}</div></sc-if>
                                <sc-if value="{{ secv.secCard.hasLocked }}" hint-placeholder-val="{{ false }}"><div data-sec="card-locked" style="font-size:12px;color:var(--orange)">{{ secv.secCard.lockedText }}</div></sc-if>
                              </div>
                            </sc-if>
                            <sc-if value="{{ secv.secCard.isAccount }}" hint-placeholder-val="{{ true }}">
                              <div style="${COL}">
                                <div data-sec="card-flags" style="display:flex;flex-direction:column;gap:6px">
                                  <sc-if value="{{ secv.secCard.hasFlags }}" hint-placeholder-val="{{ true }}"><div style="display:flex;flex-direction:column;gap:6px"><sc-for list="{{ secv.secCard.flags }}" as="cf" hint-placeholder-count="2"><div style="font-size:12px;color:var(--text)"><span style="color:var(--orange)">{{ cf.label }}</span> - {{ cf.todo }}</div></sc-for></div></sc-if>
                                  <sc-if value="{{ !secv.secCard.hasFlags }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ secv.secCard.noFlagsText }}</div></sc-if>
                                  <sc-if value="{{ secv.secCard.hasBreach }}" hint-placeholder-val="{{ true }}"><div data-sec="card-breach" style="${MUTED}">{{ secv.secCard.breachText }}</div></sc-if>
                                </div>
                                <div style="display:flex;flex-direction:column;gap:4px"><span style="${LABEL}">2FA method</span><div role="group" aria-label="2FA method" data-sec="card-twofa" style="${ROW}"><sc-for list="{{ secv.secCard.twofa }}" as="ot" hint-placeholder-count="3"><button type="button" onClick="{{ ot.go }}" aria-pressed="{{ ot.pressed }}" style="{{ ot.style }}">{{ ot.label }}</button></sc-for></div></div>
                                <div style="display:flex;flex-direction:column;gap:4px"><span style="${LABEL}">Signs in with</span><div role="group" aria-label="Signs in with another account" data-sec="card-signin" style="${ROW}"><sc-for list="{{ secv.secCard.signIn }}" as="os" hint-placeholder-count="3"><button type="button" onClick="{{ os.go }}" aria-pressed="{{ os.pressed }}" style="{{ os.style }}">{{ os.label }}</button></sc-for></div></div>
                                <sc-if value="{{ secv.secCard.hasSignInNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ secv.secCard.signInNote }}</div></sc-if>
                                <div style="display:flex;flex-direction:column;gap:4px"><span style="${LABEL}">Recovers through</span><div role="group" aria-label="Recovery identity" data-sec="card-recovery" style="${ROW}"><sc-for list="{{ secv.secCard.recovery }}" as="orc" hint-placeholder-count="3"><button type="button" onClick="{{ orc.go }}" aria-pressed="{{ orc.pressed }}" style="{{ orc.style }}">{{ orc.label }}</button></sc-for></div></div>
                                <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-sec="card-hide" checked="{{ secv.secCard.hidden }}" onChange="{{ secv.secCard.onHide }}" style="margin-top:3px"><span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;color:var(--text)">{{ secv.secCard.hideLabel }}</span><span data-sec="card-hide-words" style="font-size:11px;color:var(--faint)">{{ secv.secCard.hideWording }}</span></span></label>
                                <button type="button" data-sec="card-archive" onClick="{{ secv.secCard.onArchive }}" style="${BTN}" ${BTN_HOVER}>{{ secv.secCard.archiveLabel }}</button>
                              </div>
                            </sc-if>
                          </aside>
                        </sc-if>
                      </div>
                    </sc-if>
                    <!-- v5: growth: numbers only, and the slider that shows the map as it was -->
                    <sc-if value="{{ secv.secGrowthShow }}" hint-placeholder-val="{{ true }}">
                      <section data-sec="growth" style="${CARD};${COL}">
                        <div style="${LABEL}">Growth</div>
                        <div data-sec="growth-text" style="font-size:13px;color:var(--text)">{{ secv.secGrowthText }}</div>
                        <sc-if value="{{ secv.secGrowthHasPath }}" hint-placeholder-val="{{ false }}">
                          <svg viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="Accounts (gold) and flags (red) over the kept refreshes" style="width:100%;height:60px;display:block;overflow:visible"><line x1="4" y1="56" x2="296" y2="56" style="stroke:var(--frame);stroke-width:1;vector-effect:non-scaling-stroke"></line><path d="{{ secv.secGrowthAcc }}" style="fill:none;stroke:var(--gold);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke"></path><path d="{{ secv.secGrowthFlags }}" style="fill:none;stroke:var(--red);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke"></path></svg>
                        </sc-if>
                        <sc-if value="{{ secv.secSliderShow }}" hint-placeholder-val="{{ false }}">
                          <div style="${ROW}">
                            <input type="range" min="0" max="{{ secv.secSliderMax }}" value="{{ secv.secSliderVal }}" onChange="{{ secv.secSliderOn }}" data-sec="slider" aria-label="Show the map as it was on this day" style="flex:1 1 220px;min-width:0">
                            <span data-sec="slider-label" style="${MUTED}">{{ secv.secSliderLabel }}</span>
                            <sc-if value="{{ secv.secShowAllShow }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ secv.secShowAll }}" style="${BTN}" ${BTN_HOVER}>Show everything</button></sc-if>
                          </div>
                        </sc-if>
                      </section>
                    </sc-if>
                  </div>
                </sc-if>

                <!-- v5: HEALTH -->
                <sc-if value="{{ secv.secSubHealth }}" hint-placeholder-val="{{ false }}">
                  <div data-sec="health" style="${COL}">
                    <section style="${CARD};${COL}">
                      <div style="${LABEL}">What the last refresh found</div>
                      <div role="list" style="display:flex;flex-direction:column;gap:10px">
                        <sc-for list="{{ secv.secFlagRows }}" as="fr" hint-placeholder-count="6">
                          <div role="listitem" data-sec="flag-row" data-flag="{{ fr.key }}" style="display:flex;flex-direction:column;gap:2px">
                            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:13px;color:var(--text)">{{ fr.label }}</span><span style="flex:1"></span><span data-sec="flag-count" style="font-family:var(--term);font-size:12px;color:var(--text)">{{ fr.countText }}</span></div>
                            <div style="${MUTED}">{{ fr.todo }}</div>
                          </div>
                        </sc-for>
                      </div>
                      <div data-sec="breach-line" style="font-size:12px;color:var(--faint)">{{ secv.secBreachLine }}</div>
                    </section>
                    <section style="${CARD};${COL}">
                      <div style="${LABEL}">Accounts with a flag</div>
                      <sc-if value="{{ secv.secHasNoFlags }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ secv.secNoFlagsText }}</div></sc-if>
                      <sc-if value="{{ secv.secHasFlagged }}" hint-placeholder-val="{{ true }}">
                        <div role="list" style="display:flex;flex-direction:column;gap:6px">
                          <sc-for list="{{ secv.secFlagged }}" as="fl" hint-placeholder-count="4">
                            <div role="listitem" data-sec="flagged" style="${ROW}"><button type="button" onClick="{{ fl.go }}" aria-label="Show {{ fl.title }} on the map" style="${BTN}" ${BTN_HOVER}>{{ fl.title }}</button><sc-if value="{{ fl.hasHost }}" hint-placeholder-val="{{ true }}"><span style="font-size:11px;color:var(--faint)">{{ fl.host }}</span></sc-if><span style="font-size:12px;color:var(--orange)">{{ fl.flagsText }}</span></div>
                          </sc-for>
                        </div>
                      </sc-if>
                      <sc-if value="{{ secv.secHasFlaggedMore }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ secv.secFlaggedMore }}</div></sc-if>
                    </section>
                    <section data-sec="exports" style="${CARD};${COL}">
                      <div style="${ROW}"><span style="${LABEL}">Files that may be plain password exports</span><span style="flex:1"></span><button type="button" data-sec="exports-scan" onClick="{{ secv.secExportsScan }}" style="${BTN}" ${BTN_HOVER}>Check again</button></div>
                      <div data-sec="exports-note" style="${MUTED}">{{ secv.secExportsNote }}</div>
                      <!-- v5: Batch 5 honesty pass - says where the scan looked (labels and a count, never a path), so a moved folder is visible -->
                      <sc-if value="{{ secv.secLookedShow }}" hint-placeholder-val="{{ true }}"><div data-sec="exports-looked" style="${MUTED}">{{ secv.secLookedText }}</div></sc-if>
                      <sc-if value="{{ secv.secHasExports }}" hint-placeholder-val="{{ true }}">
                        <div role="list" style="display:flex;flex-direction:column;gap:8px">
                          <sc-for list="{{ secv.secExports }}" as="ex" hint-placeholder-count="2">
                            <div role="listitem" data-sec="export-row" style="${ROW}"><div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 240px"><span style="font-size:13px;color:var(--text);word-break:break-all">{{ ex.name }}</span><span style="font-size:11px;color:var(--faint);word-break:break-all">{{ ex.dir }} · {{ ex.meta }} · {{ ex.wording }}</span></div><button type="button" data-sec="export-trash" onClick="{{ ex.trash }}" style="${BTN}" ${BTN_HOVER}>Move to Recycle Bin</button></div>
                          </sc-for>
                        </div>
                      </sc-if>
                    </section>
                    <sc-if value="{{ secv.secConflictShow }}" hint-placeholder-val="{{ false }}">
                      <section data-sec="conflicts" role="alert" style="${CARD};${COL};border-color:var(--orange)"><div style="${LABEL}">Vault conflict copies</div><div style="font-size:13px;color:var(--text)">{{ secv.secConflictCount }}</div><div style="font-size:13px;color:var(--text)">{{ secv.secConflictText }}</div></section>
                    </sc-if>
                  </div>
                </sc-if>

                <!-- v5: SETUP -->
                <sc-if value="{{ secv.secSubSetup }}" hint-placeholder-val="{{ false }}">
                  <div data-sec="setup" style="${COL}">
                    <div data-sec="steps-done" style="${MUTED}">{{ secv.secStepsDone }}</div>
                    <div role="list" style="display:flex;flex-direction:column;gap:10px">
                      <sc-for list="{{ secv.secSteps }}" as="st" hint-placeholder-count="10">
                        <div role="listitem" data-sec="step" data-step="{{ st.id }}" style="${CARD};${COL}">
                          <div style="${ROW}"><span aria-hidden="true" style="font-size:16px;color:{{ st.markColor }}">{{ st.mark }}</span><span style="font-size:14px;color:var(--text);flex:1 1 240px">{{ st.n }}. {{ st.title }}</span><sc-if value="{{ st.canTick }}" hint-placeholder-val="{{ true }}"><button type="button" data-sec="tick" onClick="{{ st.tick }}" style="${BTN}" ${BTN_HOVER}>{{ st.tickLabel }}</button></sc-if></div>
                          <div style="${MUTED}">{{ st.help }}</div>
                          <div data-sec="step-check" style="font-size:12px;color:var(--faint)">{{ st.check }}</div>
                          <sc-if value="{{ st.hasExtra }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--text)">{{ st.extra }}</div></sc-if>
                          <sc-if value="{{ st.isVault }}" hint-placeholder-val="{{ false }}">
                            <div style="${COL}">
                              <div style="${ROW}"><input data-sec="vault-path" ref="{{ secv.secVaultRef }}" value="{{ secv.secVaultValue }}" onKeyDown="{{ secv.secVaultKey }}" aria-label="Vault file path" placeholder="the full path of your .kdbx file" autocomplete="off" spellcheck="false" style="${INPUT};flex:1 1 280px"><button type="button" data-sec="vault-save" onClick="{{ secv.secVaultSave }}" style="${GOLD}" ${GOLD_HOVER}>Save path</button></div>
                              <sc-if value="{{ secv.secHasVaultErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="${WARN}">{{ secv.secVaultErr }}</div></sc-if>
                            </div>
                          </sc-if>
                          <sc-if value="{{ st.isSheet }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><button type="button" data-sec="sheet-open" onClick="{{ st.openSheet }}" style="${BTN}" ${BTN_HOVER}>Open the sheet</button></div></sc-if>
                        </div>
                      </sc-for>
                    </div>
                  </div>
                </sc-if>

                <!-- v5: GENERATOR -->
                <sc-if value="{{ secv.secSubGen }}" hint-placeholder-val="{{ false }}">
                  <section data-sec="generator" style="${CARD};${COL}">
                    <div style="${LABEL}">Generator</div>
                    <div style="${MUTED}">{{ secv.secGenIntro }}</div>
                    <div style="${ROW}"><sc-for list="{{ secv.secGenKinds }}" as="gk" hint-placeholder-count="2"><button type="button" onClick="{{ gk.go }}" aria-pressed="{{ gk.pressed }}" style="{{ gk.style }}">{{ gk.label }}</button></sc-for></div>
                    <label style="display:flex;flex-direction:column;gap:4px"><span data-sec="gen-len-label" style="font-size:12px;color:var(--text)">{{ secv.secGenLenLabel }}</span><input type="range" min="{{ secv.secGenLenMin }}" max="{{ secv.secGenLenMax }}" value="{{ secv.secGenLen }}" onChange="{{ secv.secGenOnLen }}" data-sec="gen-len" aria-label="Length" style="max-width:360px"></label>
                    <sc-if value="{{ secv.secGenIsChars }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><sc-for list="{{ secv.secGenSets }}" as="gs" hint-placeholder-count="4"><label style="display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--text);cursor:pointer"><input type="checkbox" checked="{{ gs.checked }}" onChange="{{ gs.toggle }}" data-sec="gen-set">{{ gs.label }}</label></sc-for></div></sc-if>
                    <div data-sec="gen-bits" style="${MUTED}">{{ secv.secGenBits }}</div>
                    <div style="${ROW}"><button type="button" data-sec="gen-do" onClick="{{ secv.secGenDo }}" style="${GOLD}" ${GOLD_HOVER}>{{ secv.secGenDoLabel }}</button></div>
                    <sc-if value="{{ secv.secGenHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="${WARN}">{{ secv.secGenErr }}</div></sc-if>
                    <sc-if value="{{ secv.secGenHasOut }}" hint-placeholder-val="{{ false }}">
                      <div style="${COL}">
                        <code data-sec="gen-out" style="display:block;padding:10px 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);font-size:14px;color:var(--text);word-break:break-all;user-select:all">{{ secv.secGenOut }}</code>
                        <div style="${MUTED}">{{ secv.secGenOutBits }}</div>
                        <div style="${ROW}"><button type="button" data-sec="gen-copy" onClick="{{ secv.secGenCopy }}" style="${BTN}" ${BTN_HOVER}>Copy</button><button type="button" data-sec="gen-clear" onClick="{{ secv.secGenClear }}" style="${BTN}" ${BTN_HOVER}>Clear</button></div>
                      </div>
                    </sc-if>
                    <sc-if value="{{ secv.secGenHasNote }}" hint-placeholder-val="{{ false }}"><div data-sec="gen-note" role="status" style="font-size:12px;color:var(--green)">{{ secv.secGenNote }}</div></sc-if>
                    <div data-sec="gen-copy-note" style="font-size:11px;color:var(--faint)">Copy: {{ secv.secGenCopyNote }}</div>
                  </section>
                </sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>
`;

export const overlays = String.raw`        <!-- v5: the unlock dialog. Main window only. The passphrase field has no value binding and no change handler on purpose (uncontrolled). -->
        <sc-if value="{{ secv.secDlgOpen }}" hint-placeholder-val="{{ false }}">
          <div onClick="{{ secv.secDlgCancel }}" style="position:fixed;inset:0;z-index:1150;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
            <div onClick="{{ secv.secDlgStop }}" onKeyDown="{{ secv.secDlgKey }}" role="dialog" aria-modal="true" aria-label="Unlock the vault" data-sec="dialog" style="width:min(480px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:12px">
              <div style="${LABEL}">{{ secv.secDlgTitle }}</div>
              <div style="${MUTED}">{{ secv.secDlgHelp }}</div>
              <input type="password" data-sec="pass" ref="{{ secv.secPassRef }}" name="vault-passphrase" aria-label="Master passphrase" autocomplete="off" spellcheck="false" autocapitalize="off" autoFocus="{{ true }}" style="${INPUT};height:36px">
              <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-sec="breaches" checked="{{ secv.secDlgBreaches }}" onChange="{{ secv.secDlgToggle }}" style="margin-top:3px"><span style="font-size:13px;color:var(--text)">{{ secv.secDlgBreachText }}</span></label>
              <sc-if value="{{ secv.secDlgOffShow }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ secv.secDlgOffText }}</div></sc-if>
              <sc-if value="{{ secv.secDlgHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" data-sec="dialog-error" style="${WARN}">{{ secv.secDlgErr }}</div></sc-if>
              <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" data-sec="dialog-cancel" onClick="{{ secv.secDlgCancel }}" style="${BTN};height:34px;padding:0 14px" ${BTN_HOVER}>Cancel</button><button type="button" data-sec="dialog-go" onClick="{{ secv.secDlgSubmit }}" disabled="{{ secv.secDlgBusy }}" style="${GOLD};height:34px;padding:0 14px" ${GOLD_HOVER}>{{ secv.secDlgSubmitLabel }}</button></div>
            </div>
          </div>
        </sc-if>
        <!-- v5: the emergency sheet: paper, blank lines only, never data -->
        <sc-if value="{{ secv.secSheetOpen }}" hint-placeholder-val="{{ false }}">
          <div onClick="{{ secv.secSheetClose }}" style="position:fixed;inset:0;z-index:1140;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
            <div onClick="{{ secv.secDlgStop }}" role="dialog" aria-modal="true" aria-label="Emergency sheet" data-sec="sheet" style="width:min(640px,100%);max-height:92vh;overflow:auto;background:#fff;color:#111;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:28px 32px;display:flex;flex-direction:column;gap:14px">
              <div style="font-size:20px;font-weight:600;color:#111">{{ secv.secSheetTitle }}</div>
              <div style="font-size:12px;color:#444">{{ secv.secSheetHelp }}</div>
              <sc-for list="{{ secv.secSheetLines }}" as="sl" hint-placeholder-count="8"><div data-sec="sheet-line" style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;color:#444">{{ sl.label }}</span><span style="display:block;height:26px;border-bottom:1px solid #111">{{ sl.line }}</span></div></sc-for>
              <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" data-sec="sheet-close" onClick="{{ secv.secSheetClose }}" style="${BTN}" ${BTN_HOVER}>Close</button><button type="button" data-sec="sheet-print" onClick="{{ secv.secSheetPrint }}" style="${GOLD}" ${GOLD_HOVER}>Print</button></div>
            </div>
          </div>
        </sc-if>
`;

export default space + overlays;
