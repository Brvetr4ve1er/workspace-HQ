// Projects screen (v.projects): grid, map, archived.
// Cut verbatim from lines 265-332 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.projects }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isGrid }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;align-items:center"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-right:6px">Sort</span>
                  <sc-for list="{{ projSorts }}" as="s" hint-placeholder-count="4"><button onClick="{{ s.go }}" style="{{ s.style }}">{{ s.label }}</button></sc-for><span style="flex:1"></span><button onClick="{{ openOnboard }}" style="height:30px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:8px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-family:var(--term);font-size:12px;font-weight:600;cursor:pointer"><x-import component-from-global-scope="hq-icon" name="plus" size="14" hint-size="14px,14px"></x-import>add project</button>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,272px),1fr));gap:20px">
                  <sc-for list="{{ projCards }}" as="c" hint-placeholder-count="8">
                    <button onClick="{{ c.open }}" style="text-align:left;display:flex;flex-direction:column;gap:10px;padding:0 0 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer;transition:transform .14s cubic-bezier(.22,1.4,.36,1), box-shadow .14s;min-width:0" style-hover="transform:translateY(-4px);border-color:var(--frame-hi)">
                      <span style="display:block;height:5px;background:{{ c.color }}"></span>
                      <span style="display:flex;align-items:center;gap:8px;padding:4px 16px 0"><span style="font-size:19px;flex:1 1 auto;min-width:0">{{ c.name }}</span><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ c.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ c.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ c.tone }}) 10%,transparent)">{{ c.tag }}</span></span>
                      <span style="padding:0 16px;font-size:12px;color:var(--muted)">{{ c.stack }}</span>
                      <span style="padding:0 16px;font-size:15px;color:{{ c.reasonColor }}">{{ c.reason }}</span>
                      <span style="display:flex;gap:5px;flex-wrap:wrap;padding:0 16px"><sc-for list="{{ c.chips }}" as="ch" hint-placeholder-count="2"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:{{ ch.color }}">{{ ch.text }}</span></sc-for></span>
                      <span style="display:flex;align-items:center;gap:8px;padding:0 16px"><span style="flex:1;height:6px;background:var(--ink);border-radius:4px"><span style="display:block;height:100%;width:{{ c.pct }}%;background:var(--muted)"></span></span><span style="font-size:12px;color:var(--faint)">{{ c.pct }}% <span style="border:1px dotted var(--faint);padding:0 3px">est.</span></span></span>
                      <span style="display:flex;gap:10px;padding:0 16px;font-size:12px;color:var(--faint)"><span>{{ c.activity }}</span><sc-if value="{{ c.alive }}" hint-placeholder-val="{{ false }}"><svg viewBox="0 0 60 12" style="width:60px;height:12px;align-self:center"><path d="M0 6h20l3-5 4 10 3-5h30" style="fill:none;stroke:var(--green);stroke-width:1.3;stroke-dasharray:70;stroke-dashoffset:70"><animate attributeName="stroke-dashoffset" values="70;0;-70" dur="2.6s" repeatCount="indefinite"></animate></path></svg></sc-if><sc-if value="{{ c.devOn }}" hint-placeholder-val="{{ false }}"><span style="color:var(--green)">● dev :{{ c.port }}</span></sc-if></span>
                    </button>
                  </sc-for>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isMap }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
                <div style="flex:1 1 480px;min-width:0;background:var(--panel);border:1px solid var(--frame);border-radius:12px;padding:10px">
                  <svg ref="{{ rise }}" viewBox="20 30 500 330" style="width:100%;height:auto;display:block" role="img" aria-label="Isometric project map · height is risk">
                    <sc-for list="{{ tiles }}" as="tl" hint-placeholder-count="24"><polygon points="{{ tl.pts }}" style="fill:var(--card);fill-opacity:{{ tl.op }};stroke:var(--frame);stroke-width:1"></polygon></sc-for>
                    <sc-for list="{{ towers }}" as="t" hint-placeholder-count="8">
                      <g data-tower="1" onClick="{{ t.open }}" onMouseEnter="{{ t.hover }}" style="cursor:pointer">
                        <polygon points="{{ t.left }}" style="fill:{{ t.color }};fill-opacity:.62;stroke:var(--ink);stroke-width:1.5"></polygon>
                        <polygon points="{{ t.right }}" style="fill:{{ t.color }};fill-opacity:.4;stroke:var(--ink);stroke-width:1.5"></polygon>
                        <polygon points="{{ t.top }}" style="fill:{{ t.color }};stroke:{{ t.stroke }};stroke-width:{{ t.sw }}"></polygon>
                        <sc-for list="{{ t.wins }}" as="w" hint-placeholder-count="0"><rect x="{{ w.x }}" y="{{ w.y }}" width="4" height="5" style="fill:var(--gold-2)"><animate attributeName="opacity" values="1;.15;1" dur="{{ w.dur }}" repeatCount="indefinite"></animate></rect></sc-for>
                        <sc-for list="{{ t.smoke }}" as="m" hint-placeholder-count="0"><circle cx="{{ m.x }}" cy="{{ m.y0 }}" r="3" style="fill:var(--faint)"><animate attributeName="cy" from="{{ m.y0 }}" to="{{ m.y1 }}" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate><animate attributeName="r" values="2;6" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate><animate attributeName="opacity" values=".7;0" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate></circle></sc-for>
                        <text x="{{ t.lx }}" y="{{ t.ly }}" text-anchor="middle" style="font-family:var(--term);font-size:12px;fill:var(--muted)">{{ t.name }}</text>
                      </g>
                    </sc-for>
                  </svg>
                  <div style="display:flex;gap:14px;flex-wrap:wrap;padding:6px 6px 2px;font-size:12px;color:var(--muted)"><span>Height = risk (uncommitted, secrets, no git)</span><span style="color:var(--red)">■ at risk</span><span style="color:var(--orange)">■ needs care</span><span style="color:var(--blue)">■ idle</span><span style="color:var(--green)">■ healthy</span></div>
                </div>
                <div style="flex:1 1 260px;min-width:0;background:var(--card);border:1px solid {{ mapCard.color }};border-radius:12px;padding:16px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Hover a tower</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span style="font-size:22px;flex:1">{{ mapCard.name }}</span><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ mapCard.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ mapCard.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ mapCard.tone }}) 10%,transparent)">{{ mapCard.tag }}</span></div>
                  <div style="font-size:14px;color:{{ mapCard.reasonColor }};margin-top:6px">{{ mapCard.reason }}</div>
                  <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:14px;font-size:13px">
                    <span style="color:var(--faint)">Stack</span><span>{{ mapCard.stack }}</span>
                    <span style="color:var(--faint)">Uncommitted</span><span>{{ mapCard.dirtyText }}</span>
                    <span style="color:var(--faint)">Last commit</span><span>{{ mapCard.last }}</span>
                    <span style="color:var(--faint)">Activity</span><span>{{ mapCard.activity }}</span>
                  </div>
                  <div style="margin-top:16px"><button type="button" onClick="{{ mapOpen }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project ▸</button></div>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isArchived }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:720px">
                <sc-for list="{{ archived }}" as="a" hint-placeholder-count="1">
                  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                    <div style="flex:1 1 220px"><div style="font-size:16px">{{ a.name }}</div><div style="font-size:12px;color:var(--faint)">{{ a.stack }} · {{ a.since }}</div></div>
                    <button type="button" onClick="{{ a.restore }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">↺ Restore</button>
                  </div>
                </sc-for>
                <sc-if value="{{ noArchived }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Nothing archived. Archive a project from its page (⋯ menu) — it’s reversible.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
