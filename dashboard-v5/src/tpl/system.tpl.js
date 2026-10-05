// System screen (v.system): machine, clutter.
// Cut verbatim from lines 660-701 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.system }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isMachine }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:26px">
                <section style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;background:var(--card);border:1px solid {{ verdictColor }};border-radius:12px;padding:16px 20px">
                  <x-import component-from-global-scope="hq-obj-viewer" src="model:computer" mode="ascii" accent="{{ verdictHex }}" res="140" style="width:180px;height:180px;flex:0 0 auto" hint-size="180px,180px"></x-import>
                  <div style="flex:1 1 280px;min-width:0">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ verdictColor }}">Verdict</div>
                    <div style="font-size:clamp(24px,2.9vw,35px);line-height:1;margin-top:8px">{{ verdict }}</div>
                    <div style="font-size:13px;color:var(--muted);margin-top:8px">{{ verdictSub }}</div>
                  </div>
                  <!-- v5: v3 Med-Bay parity — Re-examine runs a fresh health scan (hq.healthScan, no reload) and refreshes the verdict, issues and vitals -->
                  <button type="button" onClick="{{ sysScan }}" disabled="{{ sysScanOff }}" title="{{ sysScanTip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ sysScanLabel }}</button>
                </section>
                <sc-if value="{{ hasIssues }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;flex-direction:column;gap:12px">
                    <sc-for list="{{ issues }}" as="i" hint-placeholder-count="2">
                      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;box-shadow:inset 5px 0 0 var(--orange)">
                        <div style="flex:1 1 320px;min-width:0;padding-left:6px"><div style="font-size:16px">{{ i.title }}</div><div style="font-size:13px;color:var(--muted)">{{ i.why }}</div><div style="font-size:12px;color:var(--faint);margin-top:4px">Fix · {{ i.fix }} · <span style="color:var(--text)">{{ i.cmd }}</span></div></div>
                        <div style="display:flex;gap:6px"><button type="button" onClick="{{ i.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Run fix</button><button type="button" onClick="{{ i.copy }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Copy</button></div>
                      </div>
                    </sc-for>
                  </div>
                </sc-if>
                <!-- v5: a safe fix that ran ok:true hides its issue until the next Re-examine; say so instead of claiming the machine is fixed -->
                <sc-if value="{{ hasFixed }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ fixedNote }}</div></sc-if>
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Vitals</div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{ vitals }}" as="vt" hint-placeholder-count="8"><span style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-size:13px"><span style="width:7px;height:7px;background:{{ vt.color }}"></span><span style="color:var(--muted)">{{ vt.k }}</span><span>{{ vt.v }}</span></span></sc-for></div>
                </section>
              </div>
            </sc-if>
            <sc-if value="{{ isClutter }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:800px">
                <sc-for list="{{ clutter }}" as="c" hint-placeholder-count="4">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px"><div style="flex:1 1 240px"><div style="font-size:16px">{{ c.title }}</div><div style="font-size:12px;color:var(--muted)">{{ c.detail }}</div></div>
                    <sc-if value="{{ c.danger }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ c.act }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">{{ c.verb }}</button></sc-if>
                    <sc-if value="{{ c.safe }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ c.act }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ c.verb }}</button></sc-if>
                    <!-- v5: v3 Med-Bay parity — one row per item, each with "Note for cleanup" (hq.captureSave('Clean up: …'); the window refreshes) -->
                    <sc-if value="{{ c.hasItems }}" hint-placeholder-val="{{ true }}">
                      <div style="flex:1 1 100%;display:flex;flex-direction:column;border-top:1px dashed var(--frame);margin-top:2px">
                        <sc-for list="{{ c.items }}" as="it" hint-placeholder-count="3">
                          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:8px 0;border-bottom:1px dashed var(--frame)"><div style="flex:1 1 220px;min-width:0;font-size:13px;overflow-wrap:anywhere">{{ it.label }}<sc-if value="{{ it.hasNote }}" hint-placeholder-val="{{ false }}"> <span style="font-size:12px;color:var(--faint)">· {{ it.note }}</span></sc-if></div><button type="button" onClick="{{ it.save }}" disabled="{{ it.off }}" title="{{ it.tip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ it.btn }}</button></div>
                        </sc-for>
                        <sc-if value="{{ c.hasMore }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--faint);padding-top:8px">{{ c.more }}</div></sc-if>
                      </div>
                    </sc-if>
                  </div>
                </sc-for>
                <sc-if value="{{ noClutter }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">The workspace is tidy.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
