// History screen (v.history): trends, timeline, milestones.
// Cut verbatim from lines 612-659 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.history }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isTrends }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ ranges }}" as="r" hint-placeholder-count="3"><button onClick="{{ r.go }}" style="{{ r.style }}">{{ r.label }}</button></sc-for></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:18px">
                  <sc-for list="{{ trends }}" as="t" hint-placeholder-count="4">
                    <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                      <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">{{ t.label }}</div>
                      <div style="display:flex;align-items:baseline;gap:10px;margin-top:8px"><span style="font-size:33px;line-height:.9"><x-import component-from-global-scope="hq-roll" value="{{ t.value }}" hint-size="auto,1em"></x-import></span><span style="font-size:13px;color:{{ t.dColor }}">{{ t.delta }}</span></div>
                      <svg viewBox="0 0 300 70" preserveAspectRatio="none" style="width:100%;height:70px;display:block;margin-top:10px;overflow:visible"><line x1="0" y1="67" x2="300" y2="67" style="stroke:var(--frame);stroke-width:1"></line><polyline points="{{ t.pts }}" style="fill:none;stroke:var(--gold);stroke-width:2;vector-effect:non-scaling-stroke"></polyline></svg>
                      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--faint);margin-top:4px"><span>min {{ t.min }} · max {{ t.max }}</span><span>{{ t.basis }}</span></div>
                    </div>
                  </sc-for>
                </div>
                <!-- v5: History › Claude activity (spec 2026-10-13 §9, H2) — chats per local day, active time labelled estimate, tokens per project where recorded (whole-chat totals of chats active in the window, labelled "whole chat") -->
                <section data-cl="activity" style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px;margin-top:20px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Claude activity</div>
                  <sc-if value="{{ clAct.emptyText }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);margin-top:8px">{{ clAct.emptyText }}</div></sc-if>
                  <sc-if value="{{ clAct.show }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-top:6px"><span>{{ clAct.chatsText }}</span><span style="color:var(--muted)">{{ clAct.activeText }}</span></div>
                    <div style="display:flex;align-items:flex-end;gap:2px;height:52px;margin-top:10px"><sc-for list="{{ clAct.bars }}" as="b" hint-placeholder-count="10"><div title="{{ b.tip }}" style="flex:1;min-width:3px;height:{{ b.h }};background:var(--purple);border-radius:2px"></div></sc-for></div>
                    <sc-for list="{{ clAct.projects }}" as="p" hint-placeholder-count="3"><div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--frame)"><span>{{ p.name }} · {{ p.chats }} chats</span><sc-if value="{{ p.hasTokens }}" hint-placeholder-val="{{ false }}"><span title="{{ clAct.tokensTip }}" style="color:var(--faint)">{{ p.tokensText }}</span></sc-if></div></sc-for>
                  </sc-if>
                </section>
              </div>
            </sc-if>
            <sc-if value="{{ isTimeline }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:800px">
                <sc-for list="{{ weeks }}" as="w" hint-placeholder-count="3">
                  <section>
                    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:8px;border-bottom:2px solid var(--frame)"><span style="font-size:18px">{{ w.w }}</span><span style="font-size:12px;color:var(--muted)">{{ w.stats }}</span></div>
                    <sc-for list="{{ w.ev }}" as="e" hint-placeholder-count="3">
                      <button onClick="{{ e.open }}" style="width:100%;display:flex;gap:12px;align-items:center;padding:9px 4px;background:none;border:0;border-bottom:1px dashed var(--frame);color:var(--text);font-family:var(--term);font-size:13px;text-align:left;cursor:pointer" style-hover="background:var(--card)"><span style="width:22px;text-align:center;color:{{ e.color }}">{{ e.g }}</span><span style="flex:1">{{ e.t }}</span><span style="font-size:12px;color:var(--faint)">{{ e.d }}</span></button>
                    </sc-for>
                    <div style="font-size:12px;color:var(--faint);padding:8px 4px">· {{ w.quiet }} collapsed</div>
                  </section>
                </sc-for>
                <sc-if value="{{ noWeeks }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No events yet. The first scan starts the timeline.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isMilestones }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px">
                <sc-for list="{{ achGroups }}" as="g" hint-placeholder-count="3">
                  <section>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:12px">{{ g.label }} · {{ g.count }}</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:14px">
                      <sc-for list="{{ g.items }}" as="a" hint-placeholder-count="4">
                        <div style="height:100%;display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:12px;border:1px solid {{ a.ring }};background:var(--card);opacity:{{ a.op }};transition:transform .15s, border-color .15s" style-hover="transform:translateY(-3px)"><div style="font-size:19px;filter:{{ a.filter }}">{{ a.icon }}</div><div style="font-size:12px;font-weight:600">{{ a.name }}</div><div style="font-size:12px;color:var(--muted);text-wrap:pretty">{{ a.desc }}</div><sc-if value="{{ a.hasProgress }}" hint-placeholder-val="{{ false }}"><div style="margin-top:auto;padding-top:6px"><div style="height:4px;border-radius:2px;background:var(--ink);overflow:hidden"><div style="height:100%;width:{{ a.progress }}%;background:var(--gold)"></div></div><div style="font-size:11px;color:var(--faint);margin-top:4px">{{ a.progressLabel }}</div></div></sc-if></div>
                      </sc-for>
                    </div>
                  </section>
                </sc-for>
              </div>
            </sc-if>
          </div>
        </sc-if>

`;
