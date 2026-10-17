// Project page (v.project).
// Cut verbatim from lines 333-428 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.project }}" hint-placeholder-val="{{ false }}">
          <div>
            <button onClick="{{ pg.back }}" style="background:none;border:0;padding:0;color:var(--link);font-size:13px;cursor:pointer" style-hover="color:var(--link-hover)">← {{ pg.backLabel }}</button>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:12px 0 6px">
              <h1 style="margin:0;font-weight:400;font-size:clamp(26px,3.2vw,37px);line-height:1"><x-import component-from-global-scope="hq-type" text="{{ pg.name }}" hint-size="auto,1em"></x-import></h1>
              <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ pg.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ pg.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ pg.tone }}) 10%,transparent)">{{ pg.tag }}</span>
              <span style="font-size:13px;color:var(--faint);white-space:nowrap">{{ pg.fresh }}</span>
            </div>
            <div style="font-size:13px;color:var(--muted)">{{ pg.stack }} · <span style="color:var(--faint)">{{ pg.path }}</span></div>
            <sc-if value="{{ pg.secretAlert }}" hint-placeholder-val="{{ false }}">
              <div style="margin-top:16px;display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--card);border:1px solid var(--red);border-radius:12px;font-size:13px"><span style="color:var(--red);font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500">Secret</span><span>{{ pg.secretText }}</span></div>
            </sc-if>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px;position:relative">
              <button type="button" onClick="{{ pg.resume }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Resume</button>
              <button type="button" onClick="{{ pg.commit }}" disabled="{{ pg.cantCommit }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✎ Commit… ({{ pg.dirty }})</button>
              <button type="button" onClick="{{ pg.dev }}" disabled="{{ pg.noDev }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ pg.devLabel }}</button>
              <button type="button" onClick="{{ pg.openFolder }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open folder</button>
              <button type="button" onClick="{{ pg.snapshot }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Snapshot…</button>
              <button type="button" onClick="{{ pg.toggleMore }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">⋯</button>
              <sc-if value="{{ pg.moreOpen }}" hint-placeholder-val="{{ false }}">
                <div ref="{{ popIn }}" style="position:absolute;top:50px;right:0;z-index:40;min-width:230px;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.35);padding:6px;display:flex;flex-direction:column">
                  <button onClick="{{ pg.logLearning }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Log a learning</button>
                  <button onClick="{{ pg.logDecision }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Log a decision</button>
                  <button onClick="{{ pg.archive }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;border-top:1px dashed var(--frame);color:var(--red);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Archive project…</button>
                </div>
              </sc-if>
            </div>
            <div style="font-size:12px;color:var(--faint);margin-top:8px">{{ pg.resumeHint }}</div>
            <sc-if value="{{ cantWrite }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange);margin-top:4px">{{ writeReason }}</div></sc-if>

            <div style="display:flex;flex-wrap:wrap;gap:28px;margin-top:30px;align-items:flex-start">
              <div style="flex:1 1 480px;min-width:0;display:flex;flex-direction:column;gap:32px">
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:18px 20px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--accent-text);margin-bottom:12px">Where was I?</div>
                  <div style="display:flex;flex-direction:column;gap:8px">
                    <sc-for list="{{ pg.brief }}" as="b" hint-placeholder-count="5">
                      <div style="display:grid;grid-template-columns:62px 1fr;gap:12px;align-items:baseline"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">{{ b.k }}</span><span style="font-size:15px;color:{{ b.color }}">{{ b.v }}<sc-if value="{{ b.est }}" hint-placeholder-val="{{ false }}"> <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 4px">est.</span></sc-if></span></div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ pg.hasRecent }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);align-self:center;margin-right:4px">recent</span>
                      <sc-for list="{{ pg.recent }}" as="f" hint-placeholder-count="3"><button onClick="{{ f.open }}" style="height:30px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;cursor:pointer" style-hover="border-color:var(--gold)">{{ f.name }}</button></sc-for>
                    </div>
                  </sc-if>
                </section>

                <section>
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Next<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><span style="font-size:13px;color:var(--muted)">{{ pg.nextCount }} · tasks, side-quests and suggestions in one list</span></div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ pg.next }}" as="n" hint-placeholder-count="3">
                      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <div style="flex:1 1 280px;min-width:0">
                          <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ n.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ n.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ n.tone }}) 10%,transparent)">{{ n.kind }}</span><sc-if value="{{ n.ai }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if><!-- v5: in_progress quests are on the board too; say which ones are already started --><sc-if value="{{ n.inProgress }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-blue);border:1px solid color-mix(in oklab,var(--tone-blue) 45%,transparent);background:color-mix(in oklab,var(--tone-blue) 10%,transparent)">in progress</span></sc-if></div>
                          <div style="font-size:15px">{{ n.title }}</div>
                          <div style="font-size:12px;color:var(--muted)">{{ n.why }}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          <!-- v5: a scan suggestion has no quest behind it (nothing to mark done), so its row has no "Do it" -->
                          <sc-if value="{{ n.canDo }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ n.doIt }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Do it</button></sc-if>
                          <button type="button" onClick="{{ n.claude }}" disabled="{{ cantWrite }}" title="Uses Claude quota" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Send to Claude</button>
                          <!-- v5: v3 Forge parity — ⚡ opens interactive Claude in a terminal at this project, seeded with the side quest (hq.claudeQuest) -->
                          <sc-if value="{{ n.terminal }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ n.term }}" disabled="{{ cantWrite }}" title="Opens interactive Claude in a terminal at this project · uses Claude quota" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">⚡ Terminal</button></sc-if>
                          <sc-if value="{{ n.canDismiss }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ n.dismiss }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button></sc-if>
                        </div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ pg.noNext }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Nothing queued for this project. Nice.</div></sc-if>
                  </div>
                  <!-- v5: v3 Forge parity — basics the scan found missing (an explicit false signal) can be added to the Ideas feed (hq.captureSave; the window refreshes) -->
                  <sc-if value="{{ pg.hasGaps }}" hint-placeholder-val="{{ false }}">
                    <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
                      <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Missing basics · from the scan's file checks</div>
                      <sc-for list="{{ pg.gaps }}" as="g" hint-placeholder-count="2">
                        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 14px;background:var(--card);border:1px dashed var(--frame);border-radius:12px"><div style="flex:1 1 220px;min-width:0"><div style="font-size:14px">{{ g.label }}</div><div style="font-size:12px;color:var(--faint)">{{ g.text }}</div></div><button type="button" onClick="{{ g.add }}" disabled="{{ g.off }}" title="{{ g.tip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ g.btn }}</button></div>
                      </sc-for>
                    </div>
                  </sc-if>
                </section>

                <section>
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Journal<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><span style="font-size:13px;color:var(--muted)">{{ pg.mirrorNote }}</span></div>
                  <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:12px">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><sc-for list="{{ pg.jKinds }}" as="j" hint-placeholder-count="3"><button onClick="{{ j.go }}" style="{{ j.style }}">{{ j.label }}</button></sc-for></div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                      <input value="{{ journalDraft }}" onChange="{{ onJournal }}" onKeyDown="{{ journalKey }}" placeholder="What happened, what you decided, what you learned…" style="flex:1 1 260px;min-width:0;height:40px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none">
                      <button type="button" onClick="{{ addJournal }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Add</button>
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;margin-top:10px">
                    <sc-for list="{{ pg.journal }}" as="j" hint-placeholder-count="2">
                      <div style="display:flex;gap:12px;align-items:baseline;padding:10px 4px;border-bottom:1px dashed var(--frame)"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ j.color }};width:70px;flex:0 0 auto">{{ j.kind }}</span><span style="flex:1;font-size:14px">{{ j.text }}</span><span style="font-size:12px;color:var(--faint)">{{ j.date }}</span></div>
                    </sc-for>
                    <sc-if value="{{ pg.noJournal }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:10px 4px">No entries yet. The first one is always the hardest.</div></sc-if>
                  </div>
                </section>
                <!-- v5: project page › Claude (spec 2026-10-13 §9, H2) — this project's last 5 linked chats + New chat (a terminal session until the H3 composer) -->
                <section data-cl="page">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Claude<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><button type="button" onClick="{{ clNewChat }}" title="Opens Claude Code in a terminal in this project" style="height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--purple);background:transparent;color:var(--text);cursor:pointer">New chat <span style="font-size:11px;color:var(--faint)">uses your Claude quota</span></button></div>
                  <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:6px 12px">
                    <sc-if value="{{ clPageEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:8px 0">{{ clPageEmpty }}</div></sc-if>
                    <sc-for list="{{ clPageChats }}" as="c" hint-placeholder-count="5"><button type="button" onClick="{{ c.open }}" style="display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:8px 0;border:0;border-bottom:1px dashed var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term);font-size:13px"><span>{{ c.title }}</span><span style="font-size:11px;color:var(--faint)">{{ c.when }}</span></button></sc-for>
                  </div>
                </section>
              </div>

              <aside style="flex:1 1 300px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Diagnostics</div>
                <div role="tablist" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px"><sc-for list="{{ pg.diagTabs }}" as="d" hint-placeholder-count="5"><button role="tab" onClick="{{ d.go }}" style="{{ d.style }}">{{ d.label }}</button></sc-for></div>
                <sc-for list="{{ pg.diag }}" as="d" hint-placeholder-count="6">
                  <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="color:var(--muted);flex:0 0 auto">{{ d.k }}</span><span style="color:{{ d.color }};text-align:right">{{ d.v }}<sc-if value="{{ d.est }}" hint-placeholder-val="{{ false }}"> <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 3px">est.</span></sc-if></span></div>
                </sc-for>
              </aside>
            </div>
          </div>
        </sc-if>

`;
