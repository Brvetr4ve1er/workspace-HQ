// Life screen (v.life): screen time, social, notes.
// Cut verbatim from lines 702-769 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.life }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isScreen }}" hint-placeholder-val="{{ true }}">
              <div style="max-width:820px">
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ lifeRanges }}" as="r" hint-placeholder-count="2"><button onClick="{{ r.go }}" style="{{ r.style }}">{{ r.label }}</button></sc-for></div>
                <sc-if value="{{ hasSites }}" hint-placeholder-val="{{ true }}">
                  <div>
                    <div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:20px">
                      <div><div style="font-size:38px;line-height:1">{{ screenTotal }}</div><div style="font-size:12px;color:var(--muted)">in the browser · approx.</div></div>
                      <div><div style="font-size:38px;line-height:1;color:var(--orange)">{{ screenShare }}</div><div style="font-size:12px;color:var(--muted)">{{ screenShareLabel }}</div></div>
                    </div>
                    <div ref="{{ barsAnim }}" style="display:flex;flex-direction:column;gap:10px">
                      <sc-for list="{{ sites }}" as="s" hint-placeholder-count="6">
                        <div style="display:grid;grid-template-columns:minmax(120px,190px) 1fr 70px;gap:12px;align-items:center"><span style="font-size:13px;overflow:hidden;text-overflow:ellipsis">{{ s.name }}</span><span style="height:14px;background:var(--ink);border-radius:4px;position:relative"><span data-bar="1" style="position:absolute;left:0;top:0;bottom:0;width:{{ s.w }}%;background:{{ s.color }};transform-origin:left"></span></span><span style="font-size:13px;text-align:right">{{ s.label }}</span></div>
                      </sc-for>
                    </div>
                    <div style="font-size:12px;color:var(--faint);margin-top:14px">From the browser extension · totals are summed from page visits, so they’re approximate.</div>
                  </div>
                </sc-if>
                <sc-if value="{{ noSites }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No browser data yet. Install the extension to see where time goes.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isSocial }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:820px">
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Awaiting your approval</div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ posts }}" as="p" hint-placeholder-count="2">
                      <div style="padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <div style="display:flex;gap:8px;font-size:12px;color:var(--muted);flex-wrap:wrap"><span style="color:var(--text)">{{ p.handle }}</span><span>· {{ p.where }}</span><span>· staged {{ p.staged }}</span></div>
                        <div style="font-size:15px;margin-top:8px;padding:10px 12px;background:var(--ink);text-wrap:pretty">{{ p.text }}</div>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><button type="button" onClick="{{ p.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Approve in extension ▸</button><button type="button" onClick="{{ p.skip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Discard</button><span style="font-size:12px;color:var(--faint)">Nothing posts until you press Send in the browser.</span></div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ noPosts }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">No drafts waiting.</div></sc-if>
                  </div>
                </section>
                <sc-if value="{{ hasMentions }}" hint-placeholder-val="{{ true }}">
                  <section>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Mentions</div>
                    <sc-for list="{{ mentions }}" as="m" hint-placeholder-count="3"><div style="display:flex;gap:12px;align-items:baseline;padding:10px 4px;border-bottom:1px dashed var(--frame);font-size:13px;flex-wrap:wrap"><span style="color:var(--accent-text)">{{ m.who }}</span><span style="flex:1 1 240px">{{ m.text }}</span><span style="font-size:12px;color:var(--faint)">{{ m.when }}</span></div></sc-for>
                  </section>
                </sc-if>
                <sc-if value="{{ socialEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No social data yet. Connect the browser extension to stage posts and see mentions.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isNotes }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:860px">
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:16px">
                  <sc-for list="{{ vaults }}" as="vv" hint-placeholder-count="3">
                    <div style="padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;display:flex;flex-direction:column;gap:8px">
                      <div style="font-size:18px">{{ vv.name }}</div>
                      <div style="display:flex;height:12px;background:var(--ink);border-radius:4px"><span style="width:{{ vv.aw }}%;background:var(--green)"></span><span style="width:{{ vv.sw }}%;background:var(--frame-hi)"></span></div>
                      <div style="font-size:12px;color:var(--muted)">{{ vv.active }} active this week · {{ vv.stale }} stale · {{ vv.total }} notes</div>
                      <div style="font-size:12px;color:var(--faint)">{{ vv.sync }}</div>
                      <div style="display:flex;gap:6px"><button type="button" onClick="{{ vv.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open in Obsidian</button><button type="button" onClick="{{ vv.search }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Search</button></div>
                    </div>
                  </sc-for>
                </div>
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Recent learnings</div>
                  <sc-for list="{{ learnings }}" as="l" hint-placeholder-count="3"><div style="display:flex;gap:12px;padding:10px 4px;border-bottom:1px dashed var(--frame);font-size:13px;flex-wrap:wrap"><span style="flex:1 1 260px">{{ l.t }}</span><span style="color:var(--muted)">{{ l.p }}</span><span style="color:var(--faint);font-size:12px">{{ l.d }}</span></div></sc-for>
                </section>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
