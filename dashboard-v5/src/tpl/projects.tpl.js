// Projects screen (v.projects): grid, map, archived, GitHub.
// Cut verbatim from lines 265-332 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.projects }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isGrid }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;align-items:center"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-right:6px">Sort</span>
                  <sc-for list="{{ projSorts }}" as="s" hint-placeholder-count="4"><button onClick="{{ s.go }}" style="{{ s.style }}">{{ s.label }}</button></sc-for><span style="flex:1"></span><button onClick="{{ openOnboard }}" style="height:30px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:8px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-family:var(--term);font-size:12px;font-weight:600;cursor:pointer"><x-import component-from-global-scope="hq-icon" name="plus" size="14" hint-size="14px,14px"></x-import>add project</button>
                </div>
                <!-- v5: P7 search (name or stack) + status chips with a shown / total count; session state only -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-6px 0 18px;align-items:center"><input value="{{ projSearch }}" onChange="{{ onProjSearch }}" placeholder="Search name or stack…" aria-label="Search projects" style="width:min(240px,100%);height:32px;padding:0 10px;margin-right:6px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none">
                  <sc-for list="{{ projStatuses }}" as="f" hint-placeholder-count="5"><button type="button" onClick="{{ f.go }}" aria-pressed="{{ f.on }}" style="{{ f.style }}">{{ f.label }}</button></sc-for><span style="flex:1"></span><span style="font-size:12px;color:var(--faint);white-space:nowrap">{{ projCount }}</span>
                </div>
                <!-- v5: P7 nothing matches the search / status chip: say so, offer the way back -->
                <sc-if value="{{ noProjMatch }}" hint-placeholder-val="{{ false }}"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px;color:var(--muted);margin-bottom:18px">No project matches. <button type="button" onClick="{{ clearProjFilters }}" style="background:none;border:0;padding:0;color:var(--link);font-family:var(--term);font-size:13px;cursor:pointer;text-decoration:underline">Clear filters</button></div></sc-if>
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
            <!-- v5: Projects › GitHub (2026-10-26) — the owner's account from data/github.json (read-only, through their own gh login); Open asks main (hq:github-open), which opens only a github.com link listed in the snapshot -->
            <sc-if value="{{ isGithub }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:16px;max-width:980px">
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:19px">GitHub</span><span style="font-family:var(--term);font-size:13px;color:var(--muted)">{{ ghLogin }}</span><span style="font-size:12px;color:var(--faint)">{{ ghWhen }}</span><span style="flex:1"></span><button type="button" onClick="{{ ghRefresh }}" disabled="{{ ghRefreshOff }}" title="{{ ghRefreshTip }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:var(--card);color:var(--text);font-family:var(--term);font-size:12px;cursor:pointer">{{ ghRefreshLabel }}</button></div>
                <sc-if value="{{ ghNotOk }}" hint-placeholder-val="{{ false }}"><div data-gh="connect" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;font-size:14px;color:var(--muted);line-height:1.6">{{ ghWhy }}</div></sc-if>
                <sc-if value="{{ ghStale }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--orange)">{{ ghStaleText }}</div></sc-if>
                <sc-if value="{{ ghPartial }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--orange)">{{ ghPartialText }}</div></sc-if>
                <sc-if value="{{ ghOk }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;flex-direction:column;gap:16px">
                    <div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{ ghStats }}" as="s" hint-placeholder-count="5"><span style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-size:13px"><span style="color:var(--muted)">{{ s.k }}</span><span style="color:{{ s.color }}">{{ s.v }}</span></span></sc-for></div>
                    <section data-gh="waiting" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                      <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Waiting on you</div>
                      <sc-if value="{{ ghNoWaiting }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--faint)">Nothing waiting — no review requests, assigned pull requests or open pull requests from others on your repos.</div></sc-if>
                      <div style="display:flex;flex-direction:column;gap:8px"><sc-for list="{{ ghWaiting }}" as="p" hint-placeholder-count="3"><div style="display:flex;gap:10px;align-items:center"><div style="flex:1;min-width:0"><div style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.title }}</div><div style="font-size:12px;color:var(--faint)">{{ p.meta }} · <span style="color:var(--gold)">{{ p.tag }}</span> <span style="color:{{ p.ciTone }}">{{ p.ci }}</span></div></div><button type="button" onClick="{{ p.open }}" title="Open on GitHub" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)">Open</button><button type="button" onClick="{{ p.copy }}" title="Copy the link" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--term)">Copy</button></div></sc-for></div>
                      <div style="font-size:12px;color:var(--faint)">{{ ghWaitingMore }}</div>
                    </section>
                    <sc-if value="{{ ghHasMine }}" hint-placeholder-val="{{ true }}">
                      <section data-gh="mine" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Your open pull requests</div>
                        <div style="display:flex;flex-direction:column;gap:8px"><sc-for list="{{ ghMine }}" as="p" hint-placeholder-count="2"><div style="display:flex;gap:10px;align-items:center"><div style="flex:1;min-width:0"><div style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.title }}</div><div style="font-size:12px;color:var(--faint)">{{ p.meta }} <span style="color:{{ p.ciTone }}">{{ p.ci }}</span></div></div><button type="button" onClick="{{ p.open }}" title="Open on GitHub" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)">Open</button><button type="button" onClick="{{ p.copy }}" title="Copy the link" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--term)">Copy</button></div></sc-for></div>
                        <div style="font-size:12px;color:var(--faint)">{{ ghMineMore }}</div>
                      </section>
                    </sc-if>
                    <sc-if value="{{ ghHasIssues }}" hint-placeholder-val="{{ false }}">
                      <section data-gh="issues" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Issues assigned to you</div>
                        <div style="display:flex;flex-direction:column;gap:8px"><sc-for list="{{ ghIssues }}" as="p" hint-placeholder-count="2"><div style="display:flex;gap:10px;align-items:center"><div style="flex:1;min-width:0"><div style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ p.title }}</div><div style="font-size:12px;color:var(--faint)">{{ p.meta }}</div></div><button type="button" onClick="{{ p.open }}" title="Open on GitHub" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)">Open</button></div></sc-for></div>
                        <div style="font-size:12px;color:var(--faint)">{{ ghIssuesMore }}</div>
                      </section>
                    </sc-if>
                    <section data-gh="repos">
                      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-right:6px">Repos</span><sc-for list="{{ ghFilters }}" as="f" hint-placeholder-count="5"><button type="button" onClick="{{ f.go }}" style="{{ f.style }}">{{ f.label }}</button></sc-for></div>
                      <sc-if value="{{ ghNoRepoMatch }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);margin-bottom:10px">No repo matches this filter.</div></sc-if>
                      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px">
                        <sc-for list="{{ ghRepos }}" as="r" hint-placeholder-count="6">
                          <div style="display:flex;flex-direction:column;gap:6px;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;min-width:0">
                            <div style="display:flex;gap:8px;align-items:baseline"><span style="font-size:16px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{{ r.full }}">{{ r.name }}</span><span style="font-size:11px;white-space:nowrap;color:{{ r.ciTone }}">{{ r.ci }}</span></div>
                            <div style="font-size:12px;color:var(--faint)">{{ r.tags }}</div>
                            <div style="font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{{ r.desc }}">{{ r.desc }}</div>
                            <div style="font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{{ r.commit }}">Pushed {{ r.pushed }} · {{ r.commit }}</div>
                            <div style="font-size:12px;color:var(--muted)">{{ r.counts }}</div>
                            <div style="display:flex;gap:8px;align-items:center"><span style="flex:1;min-width:0;font-size:11px;color:{{ r.whereColor }};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="{{ r.where }}">{{ r.where }}</span><button type="button" onClick="{{ r.open }}" title="Open on GitHub" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)">Open</button><button type="button" onClick="{{ r.copy }}" title="Copy the link" style="height:24px;padding:0 8px;font-size:11px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-family:var(--term)">Copy</button></div>
                          </div>
                        </sc-for>
                      </div>
                      <sc-if value="{{ ghHasArchived }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--faint);margin-top:10px">{{ ghArchivedNote }}</div></sc-if>
                    </section>
                  </div>
                </sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
