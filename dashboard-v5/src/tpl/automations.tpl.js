// Automations screen (v.automations): runnable, library, scheduled.
// Cut verbatim from lines 500-561 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.automations }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isRunnable }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:28px">
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:12px">Shelf · pinned</div>
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:16px">
                    <sc-for list="{{ shelf }}" as="a" hint-placeholder-count="3">
                      <div style="display:flex;flex-direction:column;gap:8px;padding:14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;transition:transform .14s cubic-bezier(.22,1.4,.36,1)" style-hover="transform:translateY(-3px)">
                        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:19px">{{ a.icon }}</span><span style="font-size:16px;flex:1;line-height:1.05">{{ a.name }}</span></div>
                        <div style="font-size:12px;color:{{ a.lastColor }}">{{ a.last }}</div>
                        <button type="button" onClick="{{ a.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run</button>
                      </div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ noShelf }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Pin up to 8 things you run often with ☆.</div></sc-if>
                </section>
                <section>
                  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Everything runnable</span><span style="flex:1"></span><input value="{{ autoQuery }}" onChange="{{ onAutoQuery }}" placeholder="Filter…" style="width:min(260px,100%);height:36px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none"></div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ autos }}" as="a" hint-placeholder-count="8">
                      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <button onClick="{{ a.pin }}" title="{{ a.pinTitle }}" style="background:none;border:0;color:{{ a.pinColor }};font-size:16px;cursor:pointer;width:28px">{{ a.pinLabel }}</button>
                        <span style="font-size:18px">{{ a.icon }}</span>
                        <div style="flex:1 1 260px;min-width:0"><div style="font-size:15px">{{ a.name }}</div><div style="font-size:12px;color:var(--muted)">{{ a.desc }}</div></div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                          <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ a.modeTone }});border:1px solid color-mix(in oklab,var(--tone-{{ a.modeTone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ a.modeTone }}) 10%,transparent)">{{ a.mode }}</span>
                          <sc-if value="{{ a.quota }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-gold);border:1px solid color-mix(in oklab,var(--tone-gold) 45%,transparent);background:color-mix(in oklab,var(--tone-gold) 10%,transparent)">quota</span></sc-if>
                          <span style="font-size:12px;color:{{ a.lastColor }};min-width:110px">{{ a.last }}</span>
                          <button type="button" onClick="{{ a.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run</button>
                        </div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ noAutos }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Nothing runnable matches. The Library has the rest.</div></sc-if>
                  </div>
                </section>
              </div>
            </sc-if>
            <sc-if value="{{ isLibrary }}" hint-placeholder-val="{{ false }}">
              <div style="max-width:760px">
                <!-- v5: the counts come from the spellbook (autoTotal, AUTOS, INTERACTIVE), not fixed numbers; agents open a terminal, they are not reference only -->
                <div style="font-size:14px;color:var(--muted);margin-bottom:16px;text-wrap:pretty">{{ libIntro }}</div>
                <div ref="{{ barsAnim }}" style="display:flex;flex-direction:column;gap:12px">
                  <sc-for list="{{ lib }}" as="l" hint-placeholder-count="6">
                    <div style="display:grid;grid-template-columns:minmax(110px,160px) 1fr auto;gap:12px;align-items:center">
                      <span style="font-size:14px">{{ l.name }}</span>
                      <span style="height:14px;background:var(--ink);border-radius:4px;position:relative"><span data-bar="1" style="position:absolute;left:0;top:0;bottom:0;width:{{ l.w }}%;background:var(--frame-hi);transform-origin:left"></span></span>
                      <span style="font-size:12px;color:var(--muted);white-space:nowrap">{{ l.total }} · {{ l.why }}</span>
                    </div>
                  </sc-for>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isScheduled }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:760px">
                <sc-for list="{{ scheduled }}" as="s" hint-placeholder-count="3">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px"><div style="flex:1 1 220px"><div style="font-size:16px">{{ s.name }}</div><div style="font-size:12px;color:var(--muted)">{{ s.when }}</div></div><div style="font-size:13px;text-align:right"><div>Next · {{ s.next }}</div><div style="color:var(--green);font-size:12px">{{ s.last }}</div></div></div>
                </sc-for>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
