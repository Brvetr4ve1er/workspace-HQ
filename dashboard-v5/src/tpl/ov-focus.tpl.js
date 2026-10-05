// Overlay: focus mode (hasFocus).
// Cut verbatim from lines 964-992 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ hasFocus }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;inset:0;z-index:950;background:rgba(5,4,9,.9);display:flex;align-items:center;justify-content:center;padding:20px">
      <div ref="{{ popIn }}" role="dialog" aria-label="Focus" style="width:min(680px,100%);text-align:center;color:#e8e6ff">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#ffe27a">Focus</div>
        <sc-if value="{{ focus.has }}" hint-placeholder-val="{{ true }}">
          <div>
            <div style="font-size:clamp(22px,3.6vw,35px);line-height:1.05;margin-top:16px;text-wrap:balance">{{ focus.title }}</div>
            <div style="font-size:15px;color:#9a93c9;margin-top:10px">{{ focus.proj }} · {{ focus.why }}</div>
            <div style="font-size:clamp(40px,7.2vw,69px);line-height:1;margin-top:26px;color:#e8e6ff">{{ focus.elapsed }}</div>
            <div style="font-size:12px;color:#5e588a">elapsed · no timer to beat</div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px">
              <button type="button" onClick="{{ focus.done }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done · +{{ focus.xp }} xp</button>
              <button type="button" onClick="{{ focus.stop }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Stop (not done)</button>
              <button type="button" onClick="{{ focus.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project</button>
            </div>
          </div>
        </sc-if>
        <sc-if value="{{ focus.none }}" hint-placeholder-val="{{ false }}"><div><div style="font-size:31px;margin-top:16px">Nothing to focus on.</div><div style="font-size:15px;color:#9a93c9;margin-top:8px">The board is clear. Enjoy it.</div><div style="margin-top:20px"><button type="button" onClick="{{ closeFocus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Close</button></div></div></sc-if>
        <sc-if value="{{ focus.hasPicker }}" hint-placeholder-val="{{ false }}">
          <div style="margin-top:34px;display:flex;flex-direction:column;gap:6px;align-items:center">
            <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#5e588a">Switch to</span>
            <sc-for list="{{ focus.picker }}" as="p" hint-placeholder-count="3"><button onClick="{{ p.go }}" style="display:flex;align-items:center;gap:8px;background:none;border:0;color:#9a93c9;font-family:var(--term);font-size:13px;cursor:pointer" style-hover="color:#e8e6ff"><span style="width:7px;height:7px;background:{{ p.color }}"></span>{{ p.title }}</button></sc-for>
          </div>
        </sc-if>
        <div style="font-size:12px;color:#5e588a;margin-top:26px">Esc or F to leave</div>
      </div>
    </div>
  </sc-if>

`;
