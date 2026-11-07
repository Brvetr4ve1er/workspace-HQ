// Sessions board (heads Claude › Sessions) — a 24-hour lane timeline, one card per session with where it stopped, this
// week's limit stops, and Resume. <!-- v5: Sessions board --> new fragment, interpolated first inside the isSessions column of
// tpl/claude.tpl.js, above "New session". dc-lite dialect only: dotted paths, !, ===; everything arrives finished from
// vals/sessions-board.js (board from main: dashboard/sessions-board.js, states from dashboard/sessions-core.mjs).
// The timeline is inline SVG, colours are tokens only; the pulsing end-cap is drawn only when sbdAnimate (Reduce motion off).
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const CARD = 'padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px';

export default String.raw`                <!-- v5: Sessions board — every Claude Code session of the last 24 hours, in any folder -->
                <section aria-label="Sessions board: every Claude Code session of the last 24 hours" style="display:flex;flex-direction:column;gap:12px">
                  <div style="${LABEL}">sessions board · last 24 hours</div>
                  <sc-if value="{{ sbdOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ sbdOfflineText }}</div></sc-if>
                  <sc-if value="{{ sbdLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading the sessions…</div></sc-if>
                  <sc-if value="{{ sbdError }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">Couldn’t read the sessions board · {{ sbdErrorText }}</div></sc-if>
                  <sc-if value="{{ sbdNote }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--orange)">{{ sbdNoteText }}</div></sc-if>
                  <sc-if value="{{ sbdEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ sbdEmptyText }}</div></sc-if>
                  <sc-if value="{{ sbdReady }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;flex-direction:column;gap:6px">
                      <div style="font-size:12px;color:var(--muted)">{{ sbdSummary }}</div>
                      <svg viewBox="{{ sbdSvgViewBox }}" role="img" aria-label="Timeline of the last 24 hours, one lane per session" style="width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <sc-for list="{{ sbdTicks }}" as="t" hint-placeholder-count="5">
                          <line x1="{{ t.x }}" y1="18" x2="{{ t.x }}" y2="{{ sbdSvgHeight }}" style="stroke:var(--frame);stroke-width:1"></line>
                          <text x="{{ t.tx }}" y="12" style="fill:var(--faint);font-size:10px;font-family:var(--term)">{{ t.label }}</text>
                        </sc-for>
                        <sc-for list="{{ sbdLanes }}" as="l" hint-placeholder-count="6">
                          <g>
                            <title>{{ l.title }}</title>
                            <text x="8" y="{{ l.textY }}" style="fill:{{ l.labelColor }};font-size:11px;font-family:var(--term)">{{ l.label }}</text>
                            <sc-if value="{{ l.isBar }}" hint-placeholder-val="{{ true }}">
                              <rect x="{{ l.x1 }}" y="{{ l.barY }}" width="{{ l.barW }}" height="12" rx="3" style="fill:{{ l.color }};opacity:.3"></rect>
                              <rect x="{{ l.x1 }}" y="{{ l.barY }}" width="{{ l.activeW }}" height="12" rx="3" style="fill:{{ l.color }}"></rect>
                            </sc-if>
                            <sc-if value="{{ l.isMarker }}" hint-placeholder-val="{{ false }}"><rect x="{{ l.x1 }}" y="{{ l.barY }}" width="3" height="12" rx="1" style="fill:{{ l.color }}"></rect></sc-if>
                            <sc-if value="{{ l.capShow }}" hint-placeholder-val="{{ false }}">
                              <circle cx="{{ l.cx }}" cy="{{ l.cy }}" r="4" style="fill:{{ l.color }}"></circle>
                              <sc-if value="{{ l.pulse }}" hint-placeholder-val="{{ false }}">
                                <circle cx="{{ l.cx }}" cy="{{ l.cy }}" r="5" style="fill:none;stroke:{{ l.color }};stroke-width:1.5">
                                  <animate attributeName="r" values="5;11;5" dur="1.8s" repeatCount="indefinite"></animate>
                                  <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite"></animate>
                                </circle>
                              </sc-if>
                            </sc-if>
                          </g>
                        </sc-for>
                        <line x1="{{ sbdNowX }}" y1="16" x2="{{ sbdNowX }}" y2="{{ sbdSvgHeight }}" style="stroke:var(--gold);stroke-width:2"></line>
                        <text x="{{ sbdNowX }}" y="12" text-anchor="end" style="fill:var(--gold);font-size:10px;font-family:var(--term)">now</text>
                      </svg>
                      <sc-if value="{{ sbdHasMore }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ sbdMoreText }}</div></sc-if>
                      <div style="font-size:12px;color:var(--faint)">bright part of a bar = active time, from gaps under 5 min · gold line = now</div>
                    </div>
                  </sc-if>
                  <sc-if value="{{ sbdHasLimitLine }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ sbdLimitLine }}</div></sc-if>
                  <div role="list" style="display:flex;flex-direction:column;gap:8px">
                    <sc-for list="{{ sbdCards }}" as="c" hint-placeholder-count="4">
                      <div role="listitem" style="${CARD};display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
                        <span style="{{ c.stateStyle }}">{{ c.stateLabel }}</span>
                        <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:4px">
                          <div style="font-size:14px;color:var(--text)">{{ c.title }}</div>
                          <div style="font-size:12px;color:var(--muted)">{{ c.sentence }}</div>
                          <div style="font-size:12px;color:var(--faint);display:flex;gap:10px;flex-wrap:wrap">
                            <span>{{ c.project }}</span>
                            <sc-if value="{{ c.hasProjectNote }}" hint-placeholder-val="{{ false }}"><span>{{ c.projectNote }}</span></sc-if>
                            <sc-if value="{{ c.hasBranch }}" hint-placeholder-val="{{ false }}"><span>{{ c.branch }}</span></sc-if>
                            <span>{{ c.started }}</span><span>{{ c.lastActive }}</span>
                            <sc-if value="{{ c.hasActive }}" hint-placeholder-val="{{ true }}"><span title="{{ c.activeTitle }}">{{ c.active }}</span></sc-if>
                            <span>{{ c.messages }}</span>
                          </div>
                          <div style="font-size:11px;color:var(--faint)">{{ c.tokensLabel }}: {{ c.tokens }}</div>
                          <sc-if value="{{ c.hasResumeNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">Resume unavailable · {{ c.resumeNote }}</div></sc-if>
                          <sc-if value="{{ c.canResume }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ c.resumeNote }}</div></sc-if>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                          <sc-if value="{{ c.canResume }}" hint-placeholder-val="{{ false }}">
                            <button type="button" onClick="{{ c.resume }}" style="${GOLD}" ${GOLD_HOVER}>Resume in a terminal</button>
                            <button type="button" onClick="{{ c.resumeSay }}" style="${BTN}" ${BTN_HOVER}>Resume and say continue</button>
                          </sc-if>
                          <button type="button" onClick="{{ c.copy }}" style="${BTN}" ${BTN_HOVER}>Copy resume command</button>
                          <sc-if value="{{ c.canOpen }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ c.open }}" style="${BTN}" ${BTN_HOVER}>Open folder</button></sc-if>
                        </div>
                      </div>
                    </sc-for>
                  </div>
                </section>
`;
