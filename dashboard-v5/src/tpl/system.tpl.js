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
                <!-- v5: PC health detail (2026-10-26) — what is using the machine right now, from the pc-health detail block -->
                <sc-if value="{{ mdHasNow }}" hint-placeholder-val="{{ true }}">
                  <section data-md="now" style="display:flex;flex-wrap:wrap;gap:12px">
                    <sc-if value="{{ mdHasRam }}" hint-placeholder-val="{{ true }}">
                      <div style="flex:1 1 300px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Using your memory</div>
                        <div style="display:flex;flex-direction:column;gap:8px">
                          <sc-for list="{{ mdRam }}" as="r" hint-placeholder-count="5">
                            <div style="display:flex;flex-direction:column;gap:3px"><div style="display:flex;gap:8px;align-items:baseline;font-size:13px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.name }}</span><span style="color:var(--faint);font-size:11px">{{ r.sub }}</span><span style="font-family:var(--term)">{{ r.val }}</span></div><div style="height:4px;background:var(--frame);border-radius:2px;overflow:hidden"><div style="height:100%;width:{{ r.w }};background:var(--blue)"></div></div></div>
                          </sc-for>
                        </div>
                      </div>
                    </sc-if>
                    <sc-if value="{{ mdHasCpu }}" hint-placeholder-val="{{ true }}">
                      <div style="flex:1 1 300px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Using your processor</div>
                        <div style="display:flex;flex-direction:column;gap:8px">
                          <sc-for list="{{ mdCpu }}" as="c" hint-placeholder-count="4">
                            <div style="display:flex;flex-direction:column;gap:3px"><div style="display:flex;gap:8px;align-items:baseline;font-size:13px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.name }}</span><span style="color:var(--faint);font-size:11px">{{ c.sub }}</span><span style="font-family:var(--term)">{{ c.val }}</span></div><div style="height:4px;background:var(--frame);border-radius:2px;overflow:hidden"><div style="height:100%;width:{{ c.w }};background:var(--gold)"></div></div></div>
                          </sc-for>
                        </div>
                      </div>
                    </sc-if>
                  </section>
                </sc-if>
                <!-- v5: PC health detail (2026-10-26) — where the disk went; Open asks main (hq:pc-open-folder), which opens only a folder listed in the current report -->
                <sc-if value="{{ mdHasDisk }}" hint-placeholder-val="{{ true }}">
                  <section data-md="disk" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:4px">Where your disk went</div>
                    <div style="font-size:12px;color:var(--faint);margin-bottom:10px">{{ mdDiskNote }}</div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                      <sc-for list="{{ mdDisk }}" as="d" hint-placeholder-count="6">
                        <div style="display:flex;gap:10px;align-items:center"><div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><div style="display:flex;gap:8px;align-items:baseline;font-size:13px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{{ d.path }}">{{ d.name }}</span><span style="font-family:var(--term)">{{ d.val }}</span></div><div style="height:4px;background:var(--frame);border-radius:2px;overflow:hidden"><div style="height:100%;width:{{ d.w }};background:var(--orange)"></div></div></div><button type="button" onClick="{{ d.open }}" disabled="{{ !mdCanOpen }}" title="{{ mdOpenTip }}" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)">Open</button><button type="button" onClick="{{ d.copy }}" title="Copy the folder path" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--term)">Copy</button></div>
                      </sc-for>
                    </div>
                  </section>
                </sc-if>
                <!-- v5: PC health detail (2026-10-26) — every GPU with its real VRAM (not WMI's 4 GB cap) and live NVIDIA stats -->
                <sc-if value="{{ mdHasGpus }}" hint-placeholder-val="{{ true }}">
                  <section data-md="gpu" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Graphics</div>
                    <div style="display:flex;flex-direction:column;gap:6px">
                      <sc-for list="{{ mdGpus }}" as="g" hint-placeholder-count="2">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline"><span style="font-size:14px">{{ g.name }}</span><span style="font-family:var(--term);font-size:13px">{{ g.val }}</span><span style="font-size:12px;color:var(--faint)">{{ g.sub }}</span></div>
                      </sc-for>
                    </div>
                    <sc-if value="{{ mdHasLive }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"><sc-for list="{{ mdLive }}" as="l" hint-placeholder-count="5"><span style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-size:13px"><span style="color:var(--muted)">{{ l.k }}</span><span style="color:{{ l.color }}">{{ l.v }}</span></span></sc-for></div>
                    </sc-if>
                  </section>
                </sc-if>
                <!-- v5: PC health detail (2026-10-26) — power, display, network, uptime, storage health and trends from the report's history -->
                <sc-if value="{{ mdHasFacts }}" hint-placeholder-val="{{ true }}">
                  <section data-md="facts">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Power &amp; system</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{ mdFacts }}" as="f" hint-placeholder-count="5"><span style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-size:13px"><span style="color:var(--muted)">{{ f.k }}</span><span style="color:{{ f.color }}">{{ f.v }}</span></span></sc-for></div>
                  </section>
                </sc-if>
                <sc-if value="{{ mdHasStorage }}" hint-placeholder-val="{{ true }}">
                  <section data-md="storage">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Drives</div>
                    <div style="display:flex;flex-direction:column;gap:6px"><sc-for list="{{ mdStorage }}" as="s" hint-placeholder-count="1"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;font-size:13px"><span style="width:7px;height:7px;background:{{ s.color }}"></span><span>{{ s.name }}</span><span style="color:var(--faint);font-size:12px">{{ s.sub }}</span><span style="color:{{ s.color }}">{{ s.health }}</span></div></sc-for></div>
                  </section>
                </sc-if>
                <sc-if value="{{ mdHasTrends }}" hint-placeholder-val="{{ true }}">
                  <section data-md="trends">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Trends</div>
                    <div style="display:flex;flex-direction:column;gap:6px"><sc-for list="{{ mdTrends }}" as="t" hint-placeholder-count="3"><div style="display:flex;gap:8px;font-size:13px;color:{{ t.color }}"><span style="font-family:var(--term)">{{ t.arrow }}</span><span>{{ t.text }}</span></div></sc-for></div>
                  </section>
                </sc-if>
                <sc-if value="{{ mdHasStartup }}" hint-placeholder-val="{{ true }}">
                  <section data-md="startup">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:6px">Starts with Windows</div>
                    <div style="font-size:13px;color:var(--muted);line-height:1.6">{{ mdStartup }}</div>
                  </section>
                </sc-if>
                <sc-if value="{{ mdHasUnreadable }}" hint-placeholder-val="{{ true }}">
                  <div data-md="unreadable" style="font-size:12px;color:var(--faint)">Not readable without admin rights: {{ mdUnreadable }}</div>
                </sc-if>
                <!-- v5: Claude Hub (spec 2026-10-13 §9 System) — the local index of every Claude Code session; honest states incl. no Node / read-only -->
                <sc-if value="{{ hubShow }}" hint-placeholder-val="{{ true }}">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:8px">Claude Hub</div>
                    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline"><span style="font-size:16px;color:{{ hubColor }}">{{ hubState }}</span><sc-if value="{{ hubHasSize }}" hint-placeholder-val="{{ true }}"><span style="font-size:12px;color:var(--faint)">{{ hubSize }}</span></sc-if></div>
                    <div style="font-size:13px;color:var(--muted);margin-top:4px">{{ hubDetail }}</div>
                    <!-- v5: AI archive H6 (spec §6.3 Imports) — drop folder status, refused ZIPs with the reason, and the last import's counts-only report -->
                    <div data-di="folder" style="font-size:12px;color:var(--faint);margin-top:6px">{{ diFolderText }}</div><sc-if value="{{ diHasRefused }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange);margin-top:4px;display:flex;flex-direction:column;gap:2px"><sc-for list="{{ diRefused }}" as="r" hint-placeholder-count="1"><span>{{ r.text }}</span></sc-for></div></sc-if><sc-if value="{{ diHasReport }}" hint-placeholder-val="{{ false }}"><div data-di="report" style="font-size:11px;color:var(--faint);margin-top:6px;display:flex;flex-direction:column;gap:2px"><sc-for list="{{ diReport }}" as="l" hint-placeholder-count="3"><span>{{ l.text }}</span></sc-for></div></sc-if>
                    <sc-if value="{{ hubBar }}" hint-placeholder-val="{{ false }}"><div style="height:4px;background:var(--frame);border-radius:2px;margin-top:10px;overflow:hidden"><div style="height:100%;width:{{ hubBarW }};background:var(--blue)"></div></div></sc-if>
                    <!-- v5: Reindex (spec 2026-10-13 §9 System, H2) — writer only; a reader says why -->
                    <div style="margin-top:10px"><button type="button" onClick="{{ clReindex }}" disabled="{{ !clCanReindex }}" title="{{ clReindexTip }}" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Reindex</button></div>
                  </section>
                </sc-if>
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
