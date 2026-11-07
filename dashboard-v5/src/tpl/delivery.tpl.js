// Client delivery card (project page) — the 2026-11-07 client-delivery item. Interpolated by tpl/project-page.tpl.js
// before the Claude section. <!-- v5: Client delivery --> new fragment, dc-lite dialect only: dotted paths, !, ===;
// everything arrives finished from vals/delivery.js (the view is built main-side by dashboard/delivery-core.mjs).
// Button strings match the other fragments' (brief.tpl.js / money.tpl.js).
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const CARD = 'padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px';
const TRACK = 'height:6px;background:var(--ink);border:1px solid var(--frame);border-radius:4px;overflow:hidden';
const MUTED = 'font-size:12px;color:var(--muted)';

export default String.raw`                <!-- v5: Client delivery — what is left against the agreed scope, the newest link to send, an update to paste -->
                <section data-dlv="card" aria-label="Client delivery">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Client delivery<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><sc-if value="{{ dlvIsClient }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ dlvUnmark }}" disabled="{{ dlvBusy }}" title="Stops tracking delivery here. Your checklist and notes are kept." style="${BTN}" ${BTN_HOVER}>Not a client job</button></sc-if></div>
                  <div style="${CARD};display:flex;flex-direction:column;gap:12px">
                    <sc-if value="{{ dlvOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Client delivery needs the desktop app’s delivery module (hq.delivery) — nothing is tracked without it.</div></sc-if>
                    <sc-if value="{{ dlvError }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">Couldn’t read client delivery · {{ dlvErrorText }}</div></sc-if>
                    <sc-if value="{{ dlvLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading what is left…</div></sc-if>

                    <sc-if value="{{ dlvReady }}" hint-placeholder-val="{{ true }}">
                      <sc-if value="{{ dlvNotClient }}" hint-placeholder-val="{{ true }}">
                        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span style="font-size:13px;color:var(--text);flex:1 1 280px">Is this a client job? Mark it to track what’s left against the agreed scope</span><button type="button" onClick="{{ dlvMarkGo }}" disabled="{{ dlvBusy }}" style="${GOLD}" ${GOLD_HOVER}>Mark as client job</button></div>
                      </sc-if>

                      <sc-if value="{{ dlvIsPlan }}" hint-placeholder-val="{{ false }}">
                        <div style="display:flex;flex-direction:column;gap:6px"><div style="font-size:14px;color:var(--text)">{{ dlvPlanLine }}</div><div style="${MUTED}">{{ dlvSourceLine }}</div></div>
                      </sc-if>

                      <sc-if value="{{ dlvNoScope }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--orange)">{{ dlvNoScopeText }}</div></sc-if>
                      <sc-if value="{{ dlvFileProblem }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">{{ dlvFileProblemText }}</div></sc-if>

                      <sc-if value="{{ dlvHasCounts }}" hint-placeholder-val="{{ true }}">
                        <div style="display:flex;flex-direction:column;gap:8px">
                          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;color:var(--text)">{{ dlvCountText }}</span><span style="${MUTED}">{{ dlvSourceLine }}</span></div>
                          <div role="img" aria-label="{{ dlvCountText }}" style="${TRACK}"><div style="{{ dlvBarStyle }}"></div></div>
                          <sc-if value="{{ dlvReadOnlyNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">Read-only here: edit the checklist in the repo and this updates on the next look.</div></sc-if>
                        </div>
                        <div role="list" style="display:flex;flex-direction:column;gap:10px">
                          <sc-for list="{{ dlvMilestones }}" as="m" hint-placeholder-count="2">
                            <div role="listitem" style="display:flex;flex-direction:column;gap:6px">
                              <div style="display:flex;gap:10px;align-items:center"><span style="${LABEL}">{{ m.name }}</span><span style="font-size:11px;color:var(--faint)">{{ m.countText }}</span><div style="flex:1;min-width:40px;max-width:140px;${TRACK}"><div style="{{ m.barStyle }}"></div></div></div>
                              <sc-for list="{{ m.items }}" as="it" hint-placeholder-count="3">
                                <div style="display:flex;gap:8px;align-items:flex-start">
                                  <sc-if value="{{ it.canToggle }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ it.toggle }}" aria-label="{{ it.toggleLabel }}" style="background:none;border:0;padding:0;color:var(--accent-text);font-family:var(--term);font-size:13px;cursor:pointer">{{ it.mark }}</button></sc-if>
                                  <sc-if value="{{ !it.canToggle }}" hint-placeholder-val="{{ true }}"><span style="color:var(--faint);font-family:var(--term);font-size:13px">{{ it.mark }}</span></sc-if>
                                  <span style="{{ it.textStyle }}">{{ it.text }}</span>
                                  <sc-if value="{{ it.canRemove }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ it.remove }}" disabled="{{ dlvBusy }}" aria-label="{{ it.removeLabel }}" title="Remove from the checklist" style="background:none;border:0;padding:0 4px;color:var(--faint);font-size:13px;cursor:pointer">×</button></sc-if>
                                </div>
                              </sc-for>
                            </div>
                          </sc-for>
                        </div>
                      </sc-if>

                      <sc-if value="{{ dlvShowAdd }}" hint-placeholder-val="{{ false }}">
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input value="{{ dlvDraft }}" onChange="{{ onDlvDraft }}" onKeyDown="{{ dlvAddKey }}" maxlength="200" aria-label="What is in scope" placeholder="what is in scope (from the quote)" style="${INPUT};flex:1 1 240px"><input value="{{ dlvMs }}" onChange="{{ onDlvMs }}" maxlength="80" aria-label="Milestone (optional)" placeholder="milestone (optional)" style="${INPUT};flex:0 1 180px"><button type="button" onClick="{{ dlvAddGo }}" disabled="{{ dlvBusy }}" style="${BTN}" ${BTN_HOVER}>Add</button></div>
                      </sc-if>

                      <sc-if value="{{ dlvCanClear }}" hint-placeholder-val="{{ false }}"><div><button type="button" onClick="{{ dlvClearGo }}" disabled="{{ dlvBusy }}" title="The file itself is never changed" style="${BTN}" ${BTN_HOVER}>Stop using this file</button></div></sc-if>

                      <sc-if value="{{ dlvIsClient }}" hint-placeholder-val="{{ true }}">
                        <div style="display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--frame);padding-top:12px">
                          <div style="${LABEL}">the newest link to send</div>
                          <sc-if value="{{ dlvHasLink }}" hint-placeholder-val="{{ true }}">
                            <div style="display:flex;flex-direction:column;gap:6px">
                              <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:13px;color:var(--text)">{{ dlvLinkKind }}</span><span style="${MUTED}">{{ dlvLinkMeta }}</span></div>
                              <div style="font-family:var(--term);font-size:12px;color:var(--link);word-break:break-all">{{ dlvLinkUrl }}</div>
                              <sc-if value="{{ dlvLinkNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ dlvLinkNote }}</div></sc-if>
                              <sc-if value="{{ dlvLinkWarn }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ dlvLinkWarn }}</div></sc-if>
                              <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onClick="{{ dlvLinkCopy }}" style="${BTN}" ${BTN_HOVER}>Copy link</button><button type="button" onClick="{{ dlvLinkOpen }}" style="${BTN}" ${BTN_HOVER}>Open</button></div>
                            </div>
                          </sc-if>
                          <sc-if value="{{ dlvNoLink }}" hint-placeholder-val="{{ false }}"><div style="${MUTED}">{{ dlvNoLinkText }}</div></sc-if>
                        </div>

                        <sc-if value="{{ dlvHasUpdate }}" hint-placeholder-val="{{ true }}">
                          <div style="display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--frame);padding-top:12px">
                            <div style="${LABEL}">update to paste</div>
                            <div style="font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word;background:var(--ink);border:1px solid var(--frame);border-radius:8px;padding:8px 10px">{{ dlvUpdateText }}</div>
                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" onClick="{{ dlvUpdateCopy }}" disabled="{{ dlvBusy }}" style="${GOLD}" ${GOLD_HOVER}>Copy update</button><span style="font-size:11px;color:var(--faint)">{{ dlvLastCopy }}</span></div>
                          </div>
                        </sc-if>
                      </sc-if>

                      <sc-if value="{{ dlvHasCands }}" hint-placeholder-val="{{ false }}">
                        <div style="display:flex;flex-direction:column;gap:6px;border-top:1px dashed var(--frame);padding-top:12px">
                          <div style="${LABEL}">{{ dlvCandsText }}</div>
                          <sc-for list="{{ dlvCands }}" as="c" hint-placeholder-count="3">
                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-family:var(--term);font-size:12px;color:var(--text);flex:1 1 200px;min-width:0;word-break:break-all">{{ c.rel }}</span><span style="font-size:11px;color:var(--faint)">{{ c.meta }}</span><button type="button" onClick="{{ c.pick }}" disabled="{{ c.pickOff }}" style="${BTN}" ${BTN_HOVER}>{{ c.pickLabel }}</button></div>
                          </sc-for>
                          <sc-if value="{{ dlvHasCandsMore }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ dlvCandsMore }}</div></sc-if>
                        </div>
                      </sc-if>
                      <sc-if value="{{ dlvNoCands }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">No checklist files found in this repo</div></sc-if>
                      <sc-if value="{{ dlvWalkError }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ dlvWalkError }}</div></sc-if>
                    </sc-if>
                  </div>
                </section>
`;
