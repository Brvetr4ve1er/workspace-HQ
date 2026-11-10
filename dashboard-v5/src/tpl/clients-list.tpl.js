// Projects › Clients — every client job on one screen: what is left, the link state, the last update, and one click to the card.
// <!-- v5: Clients list --> new fragment, interpolated by tpl/projects.tpl.js next to the other sub-views. It wraps itself in
// clsShow (true only on Projects › Clients), so the integrator places it without a condition of their own. dc-lite dialect only:
// dotted paths, !, ===; everything arrives finished from vals/clients-list.js (rows from main: dashboard/delivery-clients.js).
// Colours are tokens only (var(--…)); the gold ink #1a0f0a is the one literal, as in the other fragments.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const TRACK = 'height:6px;background:var(--ink);border:1px solid var(--frame);border-radius:4px;overflow:hidden';

export default String.raw`                <!-- v5: Projects › Clients — every client job: what is left, the link, the last update -->
                <sc-if value="{{ clsShow }}" hint-placeholder-val="{{ false }}">
                  <section data-cls="list" aria-label="Clients: every client job and what is left" style="display:flex;flex-direction:column;gap:12px;max-width:980px">
                    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:19px">Clients</span><span style="${LABEL}">{{ clsSummary }}</span><span style="flex:1"></span><button type="button" onClick="{{ clsRetry }}" disabled="{{ clsRetryOff }}" style="${BTN}" ${BTN_HOVER}>{{ clsRetryLabel }}</button></div>
                    <sc-if value="{{ clsOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ clsOfflineText }}</div></sc-if>
                    <sc-if value="{{ clsLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading the client jobs…</div></sc-if>
                    <sc-if value="{{ clsError }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--red)">Couldn’t read the client jobs · {{ clsErrorText }}</div></sc-if>
                    <sc-if value="{{ clsEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ clsEmptyText }}</div></sc-if>
                    <sc-if value="{{ clsReady }}" hint-placeholder-val="{{ true }}">
                      <div role="list" style="display:flex;flex-direction:column;gap:8px">
                        <sc-for list="{{ clsRows }}" as="r" hint-placeholder-count="3">
                          <div role="listitem" data-cls="row" style="{{ r.rowStyle }}">
                            <div style="display:flex;flex-direction:column;gap:6px;flex:1 1 220px;min-width:0">
                              <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;color:var(--text);word-break:break-word">{{ r.name }}</span><sc-if value="{{ r.notInScan }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;color:var(--faint)">{{ r.notInScanText }}</span></sc-if></div>
                              <sc-if value="{{ r.hasStatus }}" hint-placeholder-val="{{ true }}"><div style="{{ r.statusStyle }}">{{ r.statusText }}</div></sc-if>
                              <sc-if value="{{ r.hasBar }}" hint-placeholder-val="{{ true }}"><div role="img" aria-label="{{ r.barLabel }}" style="${TRACK}"><div style="{{ r.barStyle }}"></div></div></sc-if>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:6px;flex:0 1 200px;min-width:0">
                              <sc-if value="{{ r.hasLink }}" hint-placeholder-val="{{ true }}"><div style="{{ r.linkStyle }}">{{ r.linkText }}</div></sc-if>
                              <sc-if value="{{ r.hasUpdate }}" hint-placeholder-val="{{ true }}"><div style="font-size:12px;color:var(--faint)">{{ r.updateText }}</div></sc-if>
                            </div>
                            <sc-if value="{{ r.canOpen }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ r.open }}" aria-label="{{ r.openLabel }}" style="${GOLD}" ${GOLD_HOVER}>Open card</button></sc-if>
                          </div>
                        </sc-for>
                      </div>
                      <sc-if value="{{ clsHasOmitted }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ clsOmittedText }}</div></sc-if>
                    </sc-if>
                  </section>
                </sc-if>
`;
