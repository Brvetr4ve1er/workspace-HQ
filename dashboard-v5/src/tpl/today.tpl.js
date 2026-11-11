// Home › "Where today went": one SVG ribbon for one local day, a back arrow that steps up to 7 days, a caption in blocks, and a text twin.
// <!-- v5: Today ribbon --> new fragment, interpolated into tpl/home.tpl.js right under the Brief (and the sessions strip). dc-lite dialect
// only: dotted paths, !, ===; everything arrives finished from vals/today.js (the day from main: dashboard/day-ribbon.js).
// The ribbon is inline SVG, colours are tokens only. Every lane that has no source says why in its own row. The visually-hidden list under
// the picture says the same thing in words (the SVG has an aria-label too), so nothing depends on colour or on seeing the drawing.
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const STEP = 'display:inline-flex;align-items:center;justify-content:center;width:32px;height:28px;font-size:16px;line-height:1;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer';
const STEP_HOVER = 'style-hover="border-color:var(--frame-hi)" style-active="transform:translateY(1px)"';
const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

export default String.raw`            <!-- v5: Today ribbon — where today went: Claude blocks per project, browser focus, PC awake or asleep, commit ticks -->
            <sc-if value="{{ tdyShow }}" hint-placeholder-val="{{ false }}">
              <section aria-label="Where today went" style="display:flex;flex-direction:column;gap:8px;margin-bottom:26px;max-width:900px">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <div style="${LABEL}">{{ tdyTitle }}</div>
                  <span style="flex:1 1 auto"></span>
                  <button type="button" onClick="{{ tdyBack }}" disabled="{{ tdyBackDisabled }}" aria-label="{{ tdyBackLabel }}" title="{{ tdyBackLabel }}" style="${STEP}" ${STEP_HOVER}>‹</button>
                  <span role="status" aria-live="polite" style="min-width:84px;text-align:center;font-size:12px;color:var(--text);font-family:var(--term)">{{ tdyDayLabel }}</span>
                  <button type="button" onClick="{{ tdyForward }}" disabled="{{ tdyForwardDisabled }}" aria-label="{{ tdyForwardLabel }}" title="{{ tdyForwardLabel }}" style="${STEP}" ${STEP_HOVER}>›</button>
                </div>
                <sc-if value="{{ tdyOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ tdyOfflineText }}</div></sc-if>
                <sc-if value="{{ tdyLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading the day…</div></sc-if>
                <sc-if value="{{ tdyHasError }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--red)">{{ tdyErrorText }}</div></sc-if>
                <sc-if value="{{ tdyHasStale }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:12px;color:var(--orange)">{{ tdyStaleText }}</div></sc-if>
                <sc-if value="{{ tdyReady }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <div style="font-size:13px;color:var(--text)">{{ tdyCaption }}</div>
                    <svg viewBox="{{ tdySvgViewBox }}" role="img" aria-label="{{ tdyAria }}" style="width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                      <sc-if value="{{ tdyHasFuture }}" hint-placeholder-val="{{ false }}"><rect x="{{ tdyFuture.x }}" y="{{ tdyFuture.y }}" width="{{ tdyFuture.w }}" height="{{ tdyFuture.h }}" style="fill:var(--frame);opacity:.3"></rect></sc-if>
                      <sc-for list="{{ tdyAxis }}" as="a" hint-placeholder-count="9">
                        <line x1="{{ a.x }}" y1="{{ a.lineY1 }}" x2="{{ a.x }}" y2="{{ a.lineY2 }}" style="stroke:var(--frame);stroke-width:1"></line>
                        <text x="{{ a.x }}" y="12" style="fill:var(--faint);font-size:10px;font-family:var(--term);text-anchor:{{ a.anchor }}">{{ a.label }}</text>
                      </sc-for>
                      <sc-for list="{{ tdyRows }}" as="r" hint-placeholder-count="5">
                        <rect x="{{ r.trackX }}" y="{{ r.y }}" width="{{ r.trackW }}" height="{{ r.h }}" rx="3" style="fill:var(--frame);opacity:.22"></rect>
                        <text x="{{ r.labelX }}" y="{{ r.labelY }}" style="fill:var(--muted);font-size:11px;font-family:var(--term);text-anchor:{{ r.labelAnchor }}">{{ r.label }}</text>
                        <sc-if value="{{ r.hasNote }}" hint-placeholder-val="{{ false }}"><text x="{{ r.noteX }}" y="{{ r.noteY }}" style="fill:var(--faint);font-size:10px;font-family:var(--term);text-anchor:{{ r.noteAnchor }}">{{ r.note }}</text></sc-if>
                      </sc-for>
                      <sc-for list="{{ tdyRects }}" as="b" hint-placeholder-count="12">
                        <rect x="{{ b.x }}" y="{{ b.y }}" width="{{ b.w }}" height="{{ b.h }}" rx="2" style="fill:{{ b.fill }};opacity:{{ b.opacity }}"></rect>
                      </sc-for>
                      <sc-for list="{{ tdyTicks }}" as="k" hint-placeholder-count="4">
                        <line x1="{{ k.x }}" y1="{{ k.y1 }}" x2="{{ k.x }}" y2="{{ k.y2 }}" style="stroke:var(--gold);stroke-width:2"></line>
                      </sc-for>
                      <sc-if value="{{ tdyHasNow }}" hint-placeholder-val="{{ false }}"><line x1="{{ tdyNowX }}" y1="15" x2="{{ tdyNowX }}" y2="{{ tdyNowY2 }}" style="stroke:var(--text);stroke-width:1;stroke-dasharray:3 3"></line></sc-if>
                    </svg>
                    <ul aria-label="Where today went, in words" style="${HIDDEN}">
                      <sc-for list="{{ tdyTwin }}" as="w" hint-placeholder-count="5"><li>{{ w.text }}</li></sc-for>
                    </ul>
                    <div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:var(--faint)">
                      <sc-for list="{{ tdyLegend }}" as="g" hint-placeholder-count="6"><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:{{ g.color }}"></span>{{ g.label }}</span></sc-for>
                    </div>
                    <sc-if value="{{ tdyHasNotes }}" hint-placeholder-val="{{ false }}">
                      <div role="status" style="display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--orange)">
                        <sc-for list="{{ tdyNotes }}" as="n" hint-placeholder-count="2"><span>{{ n.text }}</span></sc-for>
                      </div>
                    </sc-if>
                  </div>
                </sc-if>
              </section>
            </sc-if>
`;
