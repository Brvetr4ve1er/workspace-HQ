// Tasks screen (v.tasks): ranked, by project, ideas & risks.
// Cut verbatim from lines 429-499 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.tasks }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isRanked }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ taskFilters }}" as="f" hint-placeholder-count="4"><button onClick="{{ f.go }}" style="{{ f.style }}">{{ f.label }}</button></sc-for></div>
                <div style="display:flex;flex-direction:column;gap:12px">
                  <sc-for list="{{ taskRows }}" as="t" hint-placeholder-count="6">
                    <div>
                      <sc-if value="{{ t.isHeader }}" hint-placeholder-val="{{ false }}">
                        <div style="display:flex;align-items:center;gap:10px;margin:12px 0 0"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">{{ t.label }}</span><span style="flex:1;height:2px;background:var(--frame)"></span><button onClick="{{ t.open }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer">Open project ▸</button></div>
                      </sc-if>
                      <sc-if value="{{ t.isTask }}" hint-placeholder-val="{{ true }}">
                        <div style="position:relative;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px 16px 14px 22px;background:var(--card);border:1px solid {{ t.ring }};border-radius:12px;opacity:{{ t.opacity }};transition:box-shadow .2s, opacity .3s">
                          <span style="position:absolute;left:0;top:0;bottom:0;width:6px;background:{{ t.color }}"></span>
                          <div style="flex:1 1 320px;min-width:0">
                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ t.color }}">{{ t.tier }}</span><button onClick="{{ t.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:12px;cursor:pointer">{{ t.proj }} ▸</button><span style="color:var(--faint);font-size:12px">{{ t.age }}</span><!-- v5: in_progress quests are on the board too; say which ones are already started --><sc-if value="{{ t.inProgress }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-blue);border:1px solid color-mix(in oklab,var(--tone-blue) 45%,transparent);background:color-mix(in oklab,var(--tone-blue) 10%,transparent)">in progress</span></sc-if></div>
                            <div style="font-size:16px;text-wrap:pretty">{{ t.title }}</div>
                            <div style="font-size:13px;color:var(--muted);margin-top:2px;text-wrap:pretty">{{ t.why }}</div>
                          </div>
                          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <span style="font-size:13px;color:var(--accent-text);margin-right:4px">+{{ t.xp }} xp</span>
                            <sc-if value="{{ t.isDone }}" hint-placeholder-val="{{ false }}"><span style="color:var(--green);font-size:14px">✓ Done</span></sc-if>
                            <sc-if value="{{ t.isOpen }}" hint-placeholder-val="{{ true }}">
                              <div style="display:flex;gap:6px;flex-wrap:wrap">
                                <button type="button" onClick="{{ t.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Focus</button>
                                <button type="button" onClick="{{ t.claude }}" disabled="{{ cantWrite }}" title="Uses Claude quota" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Claude</button>
                                <button type="button" onClick="{{ t.done }}" disabled="{{ cantWrite }}" title="{{ writeReason }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done</button>
                              </div>
                            </sc-if>
                          </div>
                        </div>
                      </sc-if>
                    </div>
                  </sc-for>
                </div>
                <sc-if value="{{ noTasks }}" hint-placeholder-val="{{ false }}">
                  <div style="background:var(--card);border:1px solid var(--green);border-radius:12px;padding:26px 24px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">Board clear</div>
                    <div style="font-size:30px;margin-top:8px;line-height:1">No open tasks.</div>
                    <div style="font-size:14px;color:var(--muted);margin-top:8px">Tasks come from the scan. When it finds something worth doing, it shows up here — no chores to keep the list alive.</div>
                  </div>
                </sc-if>
                <sc-if value="{{ hasCleared }}" hint-placeholder-val="{{ false }}">
                  <div style="margin-top:22px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 14px;border:1px dashed var(--green)">
                    <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">Cleared this session · +{{ clearedXp }} xp</span>
                    <sc-for list="{{ cleared }}" as="c" hint-placeholder-count="1"><span style="font-size:13px;color:var(--muted)">✓ {{ c.title }}</span></sc-for>
                  </div>
                </sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isIdeas }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:12px">
                <div style="font-size:13px;color:var(--muted)">Side-quests from scan rules and AI suggestions. None of these are obligations.</div>
                <sc-for list="{{ ideaRows }}" as="i" hint-placeholder-count="4">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                    <div style="flex:1 1 320px;min-width:0">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ i.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ i.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ i.tone }}) 10%,transparent)">{{ i.kind }}</span><sc-if value="{{ i.ai }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if><button onClick="{{ i.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:12px;cursor:pointer">{{ i.proj }} ▸</button><span style="font-size:12px;color:var(--faint)">{{ i.meta }} <span style="border:1px dotted var(--faint);padding:0 3px">est.</span></span></div>
                      <div style="font-size:16px">{{ i.title }}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" onClick="{{ i.doIt }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ i.doLabel }}</button>
                      <button type="button" onClick="{{ i.claude }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Claude</button>
                      <button type="button" onClick="{{ i.dismiss }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button>
                    </div>
                  </div>
                </sc-for>
                <sc-if value="{{ noIdeas }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No ideas or risks right now.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>
`;
