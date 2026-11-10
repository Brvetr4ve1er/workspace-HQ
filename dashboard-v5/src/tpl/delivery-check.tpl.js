// Client delivery check (project page, directly under the delivery card). Interpolated by tpl/project-page.tpl.js after ${delivery}.
// <!-- v5: Client delivery check --> new fragment, dc-lite dialect only: dotted paths, !, ===; everything arrives finished from
// vals/delivery-check.js (the report is built main-side by dashboard/delivery-check-core.mjs). The address field is always
// present so the owner can type a local address; only a dev server on this PC can be checked.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const CARD = 'padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px';
const MUTED = 'font-size:12px;color:var(--muted)';

export default String.raw`                <!-- v5: Client delivery check — phone size and Arabic / French / English, against the dev server on this PC -->
                <sc-if value="{{ dckShow }}" hint-placeholder-val="{{ true }}">
                <section data-dck="card" aria-label="Check phone and languages">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Check phone and languages<span style="color:var(--faint);font-weight:400"> ─╮</span></h2></div>
                  <div style="${CARD};display:flex;flex-direction:column;gap:12px">
                    <sc-if value="{{ dckOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ dckOfflineText }}</div></sc-if>

                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input value="{{ dckUrl }}" onChange="{{ onDckUrl }}" onKeyDown="{{ dckUrlKey }}" maxlength="200" aria-label="Dev server address on this PC" placeholder="http://127.0.0.1:5173" style="${INPUT};flex:1 1 240px"><button type="button" onClick="{{ dckRunGo }}" disabled="{{ dckRunOff }}" style="${GOLD}" ${GOLD_HOVER}>{{ dckRunLabel }}</button><button type="button" onClick="{{ dckLookGo }}" disabled="{{ dckLookOff }}" title="Probe the usual local ports for a dev server" style="${BTN}" ${BTN_HOVER}>Look for the dev server</button></div>
                    <div style="${MUTED}">{{ dckOnly }}</div>

                    <sc-if value="{{ dckLooking }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Looking on the usual local ports…</div></sc-if>
                    <sc-if value="{{ dckNotLooked }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Not looked yet. Press “Look for the dev server”, or type its address and press Check.</div></sc-if>
                    <sc-if value="{{ dckReady }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--text)">{{ dckReadyText }}</div></sc-if>
                    <sc-if value="{{ dckNothing }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--orange)">{{ dckNothingText }}</div></sc-if>
                    <sc-if value="{{ dckNoCommand }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ dckNoCommandText }}</div></sc-if>
                    <sc-if value="{{ dckRunning }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Checking at phone size, one page at a time. This can take up to 45 seconds.</div></sc-if>
                    <sc-if value="{{ dckHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--red)">{{ dckErr }}</div></sc-if>

                    <sc-if value="{{ dckHasReport }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--frame);padding-top:12px">
                        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;color:var(--text)">{{ dckSummary }}</span><span style="${MUTED}">{{ dckCheckedLine }}</span></div>
                        <sc-if value="{{ dckClean }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--green)">Nothing found on the pages that were checked.</div></sc-if>
                        <sc-if value="{{ dckHasFindings }}" hint-placeholder-val="{{ true }}">
                          <div role="list" style="display:flex;flex-direction:column;gap:8px">
                            <sc-for list="{{ dckFindings }}" as="f" hint-placeholder-count="3">
                              <div role="listitem" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
                                <span style="{{ f.tagStyle }}">{{ f.tag }}</span>
                                <span style="${LABEL}">{{ f.route }}</span>
                                <span style="font-size:13px;color:var(--text);flex:1 1 240px;min-width:0;word-break:break-word">{{ f.text }}</span>
                                <sc-if value="{{ f.hasSamples }}" hint-placeholder-val="{{ false }}"><span style="font-size:11px;color:var(--faint);flex:1 1 100%;word-break:break-word">{{ f.samplesText }}</span></sc-if>
                              </div>
                            </sc-for>
                          </div>
                        </sc-if>
                        <sc-if value="{{ dckHasFindingsMore }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ dckFindingsMore }}</div></sc-if>
                        <sc-if value="{{ dckHasRoutes }}" hint-placeholder-val="{{ false }}">
                          <div style="display:flex;flex-direction:column;gap:4px"><span style="${LABEL}">pages checked</span>
                            <sc-for list="{{ dckRoutes }}" as="r" hint-placeholder-count="3"><div style="font-size:12px;color:var(--muted)">{{ r.path }} · {{ r.meta }}</div></sc-for>
                          </div>
                        </sc-if>
                        <sc-if value="{{ dckHasNotes }}" hint-placeholder-val="{{ false }}">
                          <div style="display:flex;flex-direction:column;gap:4px"><sc-for list="{{ dckNotes }}" as="n" hint-placeholder-count="1"><div style="font-size:12px;color:var(--orange)">{{ n.text }}</div></sc-for></div>
                        </sc-if>
                        <div style="${MUTED}">{{ dckBlockedLine }}</div>
                        <sc-if value="{{ dckHasShots }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ dckShotsLine }}</div></sc-if>
                        <div style="display:flex;gap:8px"><button type="button" onClick="{{ dckForgetGo }}" disabled="{{ dckForgetOff }}" title="Delete the saved report and screenshots" style="${BTN}" ${BTN_HOVER}>Forget results</button></div>
                      </div>
                    </sc-if>
                  </div>
                </section>
                </sc-if>
`;
