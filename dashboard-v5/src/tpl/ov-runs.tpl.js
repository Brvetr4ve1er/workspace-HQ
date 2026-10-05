// Overlay: Activity panel, runs and notifications (runsOpen).
// Cut verbatim from lines 877-908 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ runsOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeRuns }}" style="position:fixed;inset:0;z-index:910;background:var(--scrim)"></div>
    <aside ref="{{ slideIn }}" aria-label="Activity" style="position:fixed;top:0;right:0;bottom:0;z-index:920;width:min(440px,100vw);background:var(--panel);border-left:1px solid var(--frame);backdrop-filter:blur(10px);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:16px;border-bottom:1px solid var(--frame);backdrop-filter:blur(10px)"><span style="font-size:21px;flex:1">Activity</span><span style="font-size:12px;color:var(--muted)">scans · runs · dev servers · terminals</span><button onClick="{{ closeRuns }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
      <div style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:6px"><sc-for list="{{ actTabs }}" as="t" hint-placeholder-count="2"><button onClick="{{ t.go }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <sc-if value="{{ isRunsTab }}" hint-placeholder-val="{{ true }}"><div style="display:flex;flex-direction:column;gap:10px">
        <sc-for list="{{ runs }}" as="r" hint-placeholder-count="3">
          <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:12px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="width:8px;height:8px;background:{{ r.color }}"></span>
              <span style="font-size:14px;flex:1 1 160px">{{ r.name }}</span>
              <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ r.color }}">{{ r.status }}</span>
            </div>
            <div style="font-size:12px;color:var(--faint);margin-top:4px;word-break:break-word">{{ r.started }} · {{ r.meta }}</div>
            <sc-if value="{{ r.isRunning }}" hint-placeholder-val="{{ false }}"><div style="height:6px;background:var(--ink);margin-top:8px;border-radius:4px"><div style="height:100%;width:{{ r.progress }}%;background:var(--gold);transition:width .5s"></div></div></sc-if>
            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
              <button type="button" onClick="{{ r.toggle }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Output</button>
              <sc-if value="{{ r.canCancel }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ r.cancel }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">Cancel</button></sc-if>
              <sc-if value="{{ r.isDev }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ r.stop }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">■ Stop</button></sc-if>
            </div>
            <sc-if value="{{ r.expanded }}" hint-placeholder-val="{{ false }}"><div style="margin-top:10px;background:var(--ink);padding:10px;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto"><x-import component-from-global-scope="hq-lines" text="{{ r.out }}" hint-size="100%,1em"></x-import></div></sc-if>
          </div>
        </sc-for></div></sc-if>
        <sc-if value="{{ isNotesTab }}" hint-placeholder-val="{{ false }}"><div style="display:flex;flex-direction:column">
          <div style="font-size:12px;color:var(--faint);padding-bottom:8px">Only measured, actionable, new events. No reminders.</div>
          <sc-for list="{{ notes }}" as="n" hint-placeholder-count="5"><div style="display:flex;gap:10px;align-items:baseline;padding:9px 2px;border-bottom:1px dashed var(--frame);font-size:13px"><span style="width:7px;height:7px;border-radius:2px;background:{{ n.c }};flex:0 0 auto;transform:translateY(-1px)"></span><span style="flex:1">{{ n.t }}</span><span style="font-size:11px;color:var(--faint);white-space:nowrap">{{ n.d }}</span></div></sc-for>
        </div></sc-if>
      </div>
    </aside>
  </sc-if>

`;
