// Home screen (v.home).
// Cut verbatim from lines 124-264 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.home }}" hint-placeholder-val="{{ true }}">
          <div>
            <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:22px">
              <h1 style="margin:0;font-weight:400;font-size:clamp(26px,3.2vw,37px);line-height:1"><x-import component-from-global-scope="hq-type" text="{{ home.greeting }}" hint-size="auto,1em"></x-import></h1>
              <span style="font-size:14px;color:var(--muted)">{{ home.sub }}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start">
              <div style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:36px">
                <sc-if value="{{ showSince }}" hint-placeholder-val="{{ false }}">
                  <section ref="{{ popIn }}" style="border:1px dashed var(--frame-hi);border-radius:12px;padding:12px 16px;background:var(--card)">
                    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;color:var(--faint)">› {{ sinceLabel }}</span><span style="flex:1"></span><button onClick="{{ dismissSince }}" style="background:none;border:0;color:var(--faint);font-size:12px;cursor:pointer;font-family:var(--term)">dismiss</button></div>
                    <div style="display:flex;flex-direction:column;margin-top:6px">
                      <sc-for list="{{ since }}" as="x" hint-placeholder-count="4"><button onClick="{{ x.open }}" style="display:flex;gap:10px;align-items:center;padding:5px 0;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;text-align:left" style-hover="color:var(--accent-text)"><span style="width:16px;color:{{ x.c }}">{{ x.g }}</span><span>{{ x.t }}</span></button></sc-for>
                    </div>
                  </section>
                </sc-if>
                <sc-if value="{{ home.hasNext }}" hint-placeholder-val="{{ true }}">
                  <section aria-label="Next action" style="position:relative;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 10px 0 -4px var(--ink);padding:22px 24px 20px">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--accent-text)">Next action</span>
                      <span style="font-size:12px;color:var(--faint)">picked by fixed rules · not AI</span>
                      <span style="flex:1"></span>
                      <!-- v5: in_progress quests are on the board too; say which ones are already started --><sc-if value="{{ home.next.inProgress }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-blue);border:1px solid color-mix(in oklab,var(--tone-blue) 45%,transparent);background:color-mix(in oklab,var(--tone-blue) 10%,transparent)">in progress</span></sc-if>
                      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ home.next.color }}">{{ home.next.tier }}</span>
                    </div>
                    <div style="font-size:clamp(20px,2.4vw,29px);line-height:1.05;text-wrap:balance"><x-import component-from-global-scope="hq-scramble" intro="" text="{{ home.next.title }}" hint-size="auto,1em"></x-import></div>
                    <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-top:8px;font-size:14px;color:var(--muted)">
                      <button onClick="{{ home.next.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:14px;cursor:pointer" style-hover="color:var(--link-hover)">{{ home.next.proj }} ▸</button><span>·</span><span style="text-wrap:pretty">{{ home.next.why }}</span>
                    </div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px">
                      <button type="button" onClick="{{ home.next.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Start focus</button>
                      <button type="button" onClick="{{ home.next.done }}" disabled="{{ cantWrite }}" title="{{ writeReason }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Mark done</button>
                      <button type="button" onClick="{{ home.next.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project</button>
                      <span style="margin-left:auto;font-size:15px;color:var(--accent-text)">+{{ home.next.xp }} xp</span>
                    </div>
                    <sc-if value="{{ cantWrite }}" hint-placeholder-val="{{ false }}"><div style="margin-top:10px;font-size:12px;color:var(--faint)">{{ writeReason }}</div></sc-if>
                    <sc-if value="{{ home.hasAlts }}" hint-placeholder-val="{{ true }}">
                      <div style="margin-top:20px;padding-top:14px;border-top:1px dashed var(--frame);display:flex;flex-direction:column;gap:10px">
                        <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Or, if that’s too much right now</span>
                        <sc-for list="{{ home.alts }}" as="a" hint-placeholder-count="2">
                          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                            <span style="width:8px;height:8px;background:{{ a.color }};flex:0 0 auto"></span>
                            <span style="flex:1 1 240px;min-width:0;font-size:14px">{{ a.title }} <span style="color:var(--faint)">· {{ a.proj }}</span></span>
                            <button type="button" onClick="{{ a.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Focus</button>
                            <button type="button" onClick="{{ a.done }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done</button>
                          </div>
                        </sc-for>
                      </div>
                    </sc-if>
                  </section>
                </sc-if>
                <sc-if value="{{ home.isRest }}" hint-placeholder-val="{{ false }}">
                  <section style="background:var(--card);border:1px solid var(--green);border-radius:12px;padding:28px 24px;position:relative;overflow:hidden"><x-import component-from-global-scope="hq-obj-viewer" src="model:rocket" mode="ascii" res="110" style="position:absolute;right:10px;top:6px;width:140px;height:140px" hint-size="140px,140px"></x-import>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">All clear</div>
                    <div style="font-size:clamp(24px,2.9vw,33px);margin-top:10px;line-height:1">Nothing on fire.</div>
                    <div style="font-size:14px;color:var(--muted);margin-top:8px;text-wrap:pretty;padding-right:min(150px,30%)">{{ home.restSub }}</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
                      <button type="button" onClick="{{ goTasksIdeas }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Browse ideas</button>
                      <button type="button" onClick="{{ scanNow }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">⟳ Scan now</button>
                    </div>
                  </section>
                </sc-if>

                <section aria-label="Portfolio">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                    <h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Portfolio<span style="color:var(--faint);font-weight:400"> ─╮</span></h2>
                    <span style="font-size:13px;color:var(--muted)">worst first · {{ home.kpiLine }} · ~{{ home.avg }}% avg <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 4px">est.</span></span>
                    <span style="flex:1"></span>
                    <button onClick="{{ goProjects }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer" style-hover="color:var(--link-hover)">All projects ▸</button>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ home.rows }}" as="r" hint-placeholder-count="8">
                      <button onClick="{{ r.open }}" style="width:100%;text-align:left;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;transition:transform .12s, box-shadow .12s" style-hover="transform:translateY(-2px);border-color:var(--frame-hi)">
                        <span style="width:10px;height:10px;background:{{ r.color }};flex:0 0 auto"></span>
                        <span style="flex:0 0 112px;font-size:15px">{{ r.name }}</span>
                        <span style="flex:1 1 170px;min-width:0;font-size:13px;color:{{ r.reasonColor }}">{{ r.reason }}</span>
                        <span style="display:flex;gap:5px;flex-wrap:wrap">
                          <sc-for list="{{ r.chips }}" as="c" hint-placeholder-count="2"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:{{ c.color }};white-space:nowrap">{{ c.text }}</span></sc-for>
                        </span>
                        <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ r.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ r.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ r.tone }}) 10%,transparent)">{{ r.tag }}</span>
                        <span style="color:var(--faint)">▸</span>
                      </button>
                    </sc-for>
                  </div>
                </section>

                <section aria-label="Changes">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                    <h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Changes<span style="color:var(--faint);font-weight:400"> ─╮</span></h2>
                    <span style="font-size:13px;color:var(--muted)">since the {{ home.prevLabel }} scan</span>
                  </div>
                  <sc-if value="{{ home.hasChanges }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;flex-direction:column;gap:0;border-top:1px dashed var(--frame)">
                      <sc-for list="{{ home.changes }}" as="c" hint-placeholder-count="4">
                        <button onClick="{{ c.open }}" style="display:flex;align-items:center;gap:12px;padding:10px 4px;background:none;border:0;border-bottom:1px dashed var(--frame);color:var(--text);font-family:var(--term);font-size:13px;text-align:left;cursor:pointer" style-hover="background:var(--card)">
                          <span style="width:22px;text-align:center;color:{{ c.c }};font-size:14px">{{ c.g }}</span>
                          <span style="flex:1 1 auto">{{ c.t }}</span>
                          <span style="color:var(--faint);font-size:12px">{{ c.when }}</span>
                        </button>
                      </sc-for>
                    </div>
                  </sc-if>
                  <sc-if value="{{ home.noChanges }}" hint-placeholder-val="{{ false }}">
                    <div style="font-size:14px;color:var(--muted);padding:14px 0;border-top:1px dashed var(--frame)">Nothing moved since the previous scan. Metrics held steady.</div>
                  </sc-if>
                </section>
              </div>

              <aside style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:20px">
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:16px">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Trend</span><span style="flex:1"></span>
                    <!-- v5: momentum tabs say which one is on (aria-pressed) --><sc-for list="{{ home.momTabs }}" as="m" hint-placeholder-count="2"><button onClick="{{ m.go }}" aria-pressed="{{ m.on }}" style="{{ m.style }}">{{ m.label }}</button></sc-for>
                  </div>
                  <div style="display:flex;align-items:baseline;gap:10px;margin-top:10px"><span style="font-size:36px;line-height:.9"><x-import component-from-global-scope="hq-roll" value="{{ home.mom.value }}" hint-size="auto,1em"></x-import></span><span style="font-size:13px;color:{{ home.mom.deltaColor }}">{{ home.mom.delta }}</span></div>
                  <div style="font-size:12px;color:var(--muted)">{{ home.mom.label }}</div>
                  <svg viewBox="0 0 280 56" preserveAspectRatio="none" style="width:100%;height:56px;display:block;margin-top:12px;overflow:visible"><polyline points="{{ home.mom.pts }}" style="fill:none;stroke:var(--gold);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:bevel"></polyline></svg>
                  <div style="font-size:12px;color:var(--faint);margin-top:6px">{{ home.mom.range }}</div>
                </section>
                <sc-if value="{{ home.hasSuggest }}"><section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Worth a re-run</div>
                  <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><span style="font-size:18px">{{ home.suggest.icon }}</span><div style="flex:1;min-width:0"><div style="font-size:15px">{{ home.suggest.name }}</div><div style="font-size:12px;color:var(--red)">Failed {{ home.suggest.last.ago }} · {{ home.suggest.last.err }}</div></div></div>
                  <div style="margin-top:12px"><button type="button" onClick="{{ runSuggest }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Review &amp; run ▸</button></div>
                </section></sc-if>
                <sc-if value="{{ home.showRecap }}" hint-placeholder-val="{{ false }}">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Weekly recap · {{ home.recapRange }}</span><span style="flex:1"></span><sc-if value="{{ home.recapAi }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if></div>
                    <div style="font-size:12px;color:var(--faint);margin-top:6px">{{ home.recapStats }}</div>
                    <sc-if value="{{ home.recapOpen }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--text);margin-top:10px;text-wrap:pretty;white-space:pre-line">{{ home.recapText }}</div></sc-if>
                    <div style="display:flex;gap:8px;margin-top:12px">
                      <button type="button" onClick="{{ toggleRecap }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Read</button>
                      <button type="button" onClick="{{ dismissRecap }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button>
                    </div>
                  </section>
                </sc-if>
              </aside>
            </div>
          </div>
        </sc-if>

`;
