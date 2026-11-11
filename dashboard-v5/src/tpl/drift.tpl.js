// System › Machine › "How the PC changed": seven small charts from the kept checks, an opt-in disk estimate, and what filled the disk.
// <!-- v5: Machine drift --> new fragment, interpolated by tpl/system.tpl.js under the Machine detail panels as ${drift}. It wraps itself
// in dftShow (true only on System › Machine), so the integrator places it without a condition of their own. dc-lite dialect only:
// dotted paths, !, ===; everything arrives finished from vals/drift.js. Tokens only (var(--…)); no literal colour. Each chart is an SVG
// (a gap is a break in the line, never a zero) with its text twin printed under it; phone width: one column below ~520px.
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const BTN = 'display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const CARD = 'display:flex;flex-direction:column;gap:6px;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;min-width:0';

export default String.raw`                <!-- v5: Machine drift — how the PC moved over the kept checks, and what filled the disk -->
                <sc-if value="{{ dftv.dftShow }}" hint-placeholder-val="{{ false }}">
                  <section data-md="drift" aria-label="How the PC changed" style="display:flex;flex-direction:column;gap:12px">
                    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="${LABEL}">{{ dftv.dftTitle }}</span><span style="flex:1"></span><button type="button" onClick="{{ dftv.dftRefresh }}" disabled="{{ dftv.dftRefreshOff }}" style="${BTN}" ${BTN_HOVER}>{{ dftv.dftRefreshLabel }}</button></div>
                    <div style="font-size:12px;color:var(--muted)">{{ dftv.dftIntro }}</div>
                    <sc-if value="{{ dftv.dftOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ dftv.dftOfflineText }}</div></sc-if>
                    <sc-if value="{{ dftv.dftLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading the kept checks…</div></sc-if>
                    <sc-if value="{{ dftv.dftHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--red)">{{ dftv.dftErrText }}</div></sc-if>
                    <sc-if value="{{ dftv.dftEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ dftv.dftEmptyText }}</div></sc-if>
                    <sc-if value="{{ dftv.dftReady }}" hint-placeholder-val="{{ true }}">
                      <div data-dft="summary" style="font-size:12px;color:var(--faint)">{{ dftv.dftSummary }}</div>
                      <div role="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px">
                        <sc-for list="{{ dftv.dftCharts }}" as="c" hint-placeholder-count="7">
                          <div role="listitem" data-dft="chart" data-dft-id="{{ c.id }}" style="${CARD}">
                            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-size:14px;color:var(--text)">{{ c.title }}</span><span style="flex:1"></span><sc-if value="{{ c.hasLast }}" hint-placeholder-val="{{ true }}"><span style="font-family:var(--term);font-size:12px;color:var(--text)">{{ c.lastText }}</span></sc-if></div>
                            <div style="font-size:11px;color:var(--faint)">{{ c.countText }}<sc-if value="{{ c.hasRange }}" hint-placeholder-val="{{ true }}"> · {{ c.rangeText }}</sc-if></div>
                            <sc-if value="{{ c.hasPath }}" hint-placeholder-val="{{ true }}">
                              <svg viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="{{ c.label }}" style="width:100%;height:80px;display:block;overflow:visible"><line x1="4" y1="74" x2="296" y2="74" style="stroke:var(--frame);stroke-width:1;vector-effect:non-scaling-stroke"></line><path d="{{ c.path }}" style="fill:none;stroke:var(--gold);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke"></path></svg>
                            </sc-if>
                            <div data-dft="twin" style="font-size:12px;color:var(--muted);line-height:1.5;word-break:break-word">{{ c.text }}</div>
                            <sc-if value="{{ c.hasNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ c.noteText }}</div></sc-if>
                            <sc-if value="{{ c.isDisk }}" hint-placeholder-val="{{ true }}">
                              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" onClick="{{ c.est }}" aria-pressed="{{ c.estPressed }}" data-dft="estimate-button" style="${BTN}" ${BTN_HOVER}>{{ c.estLabel }}</button><span style="font-size:11px;color:var(--faint)">A straight line through the readings; refuses unless there is enough.</span></div>
                            </sc-if>
                            <sc-if value="{{ c.hasEst }}" hint-placeholder-val="{{ false }}">
                              <div data-dft="estimate" role="status" style="display:flex;flex-direction:column;gap:4px"><div style="{{ c.estStyle }}">{{ c.estText }}</div><sc-if value="{{ c.hasEstBasis }}" hint-placeholder-val="{{ false }}"><div style="font-size:11px;color:var(--faint)">{{ c.estBasis }}</div></sc-if></div>
                            </sc-if>
                          </div>
                        </sc-for>
                      </div>
                    </sc-if>
                    <sc-if value="{{ dftv.dftDiskShow }}" hint-placeholder-val="{{ true }}">
                    <div data-dft="disk" style="display:flex;flex-direction:column;gap:6px;padding-top:6px">
                      <div style="${LABEL}">{{ dftv.dftDiskTitle }}</div>
                      <sc-if value="{{ dftv.dftHasDiskLines }}" hint-placeholder-val="{{ true }}">
                        <div role="list" style="display:flex;flex-direction:column;gap:4px"><sc-for list="{{ dftv.dftDiskLines }}" as="l" hint-placeholder-count="3"><div role="listitem" style="font-size:13px;color:var(--text)">{{ l.text }}</div></sc-for></div>
                      </sc-if>
                      <sc-if value="{{ dftv.dftHasDiskNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ dftv.dftDiskNote }}</div></sc-if>
                    </div>
                    </sc-if>
                  </section>
                </sc-if>
`;
