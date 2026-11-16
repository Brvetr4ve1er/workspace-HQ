// Claude > Crew: the installed skills by role, each with a Start button that opens a terminal session. <!-- v5: Crew --> new fragment,
// interpolated by tpl/claude.tpl.js beside the other sub-views. It wraps itself in crwv.on (true only on Claude > Crew), so the integrator
// places it without a condition of its own. dc-lite dialect only: dotted paths, !, ===; EVERY value is one key under crwv, finished by
// vals/crew.js (roster from main: dashboard/crew.js). A skill's description is bound as TEXT only, never as markup or a style.
// Colours are tokens only (var(--...)); the gold ink #1a0f0a is the one literal, as in the other fragments.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const ROW = 'padding:10px 12px;background:var(--card);border:1px solid var(--frame);border-radius:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
const INPUT = 'flex:1 1 220px;min-width:0;height:30px;padding:0 10px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);font-size:12px';

// one skill row, used by the grouped list and by the search results
const SKILL = String.raw`<div role="listitem" data-crw="row" style="${ROW}">
                              <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 260px;min-width:0">
                                <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span data-crw="name" style="font-size:14px;color:var(--text);word-break:break-word">{{ r.name }}</span><sc-if value="{{ r.hasPlugin }}" hint-placeholder-val="{{ false }}"><span style="font-size:11px;color:var(--faint)">{{ r.plugin }}</span></sc-if></div>
                                <sc-if value="{{ r.hasDesc }}" hint-placeholder-val="{{ true }}"><div style="font-size:12px;color:var(--muted);word-break:break-word">{{ r.description }}</div></sc-if>
                              </div>
                              <sc-if value="{{ r.canStart }}" hint-placeholder-val="{{ true }}"><button type="button" data-crw="start" onClick="{{ r.start }}" disabled="{{ r.startOff }}" title="{{ r.startTip }}" style="${GOLD}" ${GOLD_HOVER}>{{ r.startLabel }}</button></sc-if>
                              <sc-if value="{{ !r.canStart }}" hint-placeholder-val="{{ false }}"><span style="font-size:11px;color:var(--faint)">{{ r.noStartText }}</span></sc-if>
                            </div>`;

export default String.raw`            <!-- v5: Claude › Crew — installed skills by role, Start opens a terminal session in default permission mode -->
            <sc-if value="{{ crwv.on }}" hint-placeholder-val="{{ false }}">
              <section data-crw="view" aria-label="Crew: the installed Claude skills by role" style="display:flex;flex-direction:column;gap:12px;max-width:980px">
                <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:19px">Crew</span><span style="${LABEL}">{{ crwv.summary }}</span><span style="flex:1"></span><button type="button" data-crw="refresh" onClick="{{ crwv.refresh }}" disabled="{{ crwv.refreshOff }}" style="${BTN}" ${BTN_HOVER}>{{ crwv.refreshLabel }}</button></div>
                <div style="font-size:12px;color:var(--faint)">{{ crwv.note }}</div>
                <sc-if value="{{ crwv.offline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ crwv.offlineText }}</div></sc-if>
                <sc-if value="{{ crwv.loading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading the installed skills…</div></sc-if>
                <sc-if value="{{ crwv.error }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--red)">Couldn’t read the crew · {{ crwv.errorText }}</div></sc-if>
                <sc-if value="{{ crwv.empty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ crwv.emptyText }}</div></sc-if>
                <sc-if value="{{ crwv.ready }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input data-crw="search" value="{{ crwv.query }}" onChange="{{ crwv.onQuery }}" aria-label="Search the crew" placeholder="Search skills by name, plugin or what they do" style="${INPUT}"><sc-if value="{{ crwv.hasQuery }}" hint-placeholder-val="{{ false }}"><button type="button" data-crw="clear" onClick="{{ crwv.clear }}" style="${BTN}" ${BTN_HOVER}>Clear</button></sc-if></div>
                  <sc-if value="{{ crwv.noMatch }}" hint-placeholder-val="{{ false }}"><div data-crw="no-match" style="font-size:13px;color:var(--muted)">{{ crwv.noMatchText }}</div></sc-if>
                  <div role="list" data-crw="flat" style="display:flex;flex-direction:column;gap:8px">
                    <sc-for list="{{ crwv.flat }}" as="r" hint-placeholder-count="3">
                      ${SKILL}
                    </sc-for>
                  </div>
                  <sc-if value="{{ crwv.flatMore }}" hint-placeholder-val="{{ false }}"><div><button type="button" data-crw="more-page" onClick="{{ crwv.loadMore }}" style="${BTN}" ${BTN_HOVER}>{{ crwv.flatMoreText }}</button></div></sc-if>
                  <sc-for list="{{ crwv.groups }}" as="g" hint-placeholder-count="3">
                    <section data-crw="group" aria-label="{{ g.label }}" style="display:flex;flex-direction:column;gap:8px">
                      <div style="display:flex;gap:10px;align-items:baseline"><span data-crw="role" style="font-size:15px;color:var(--text)">{{ g.label }}</span><span style="${LABEL}">{{ g.countText }}</span></div>
                      <div role="list" style="display:flex;flex-direction:column;gap:8px">
                        <sc-for list="{{ g.rows }}" as="r" hint-placeholder-count="3">
                          ${SKILL}
                        </sc-for>
                      </div>
                      <sc-if value="{{ g.canToggle }}" hint-placeholder-val="{{ false }}"><div><button type="button" data-crw="toggle" onClick="{{ g.toggle }}" style="${BTN}" ${BTN_HOVER}>{{ g.toggleLabel }}</button></div></sc-if>
                    </section>
                  </sc-for>
                </sc-if>
              </section>
            </sc-if>
`;
