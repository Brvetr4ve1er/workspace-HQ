// Overlay: settings (settingsOpen).
// Cut verbatim from lines 1056-1076 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ settingsOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeSettings }}" style="position:fixed;inset:0;z-index:1050;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Settings" style="width:min(680px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="display:flex;align-items:center"><span style="font-size:24px;flex:1">Settings</span><button onClick="{{ closeSettings }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Appearance</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><sc-for list="{{ themeOpts }}" as="t" hint-placeholder-count="3"><button onClick="{{ t.go }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <div style="display:flex;flex-direction:column;margin-top:14px">
          <sc-for list="{{ settings }}" as="s" hint-placeholder-count="5">
            <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px dashed var(--frame)"><div style="flex:1;min-width:0"><div style="font-size:15px">{{ s.label }}</div><div style="font-size:12px;color:var(--muted)">{{ s.desc }}</div></div><button onClick="{{ s.toggle }}" role="switch" style="{{ s.style }}">{{ s.state }}</button></div>
          </sc-for>
        </div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Global hotkeys</div>
        <div style="display:flex;flex-direction:column;margin-top:6px">
          <sc-for list="{{ hotkeys }}" as="h" hint-placeholder-count="7"><div style="display:flex;gap:12px;padding:6px 0;font-size:13px"><span style="width:150px;flex:0 0 auto;color:var(--text)">{{ h.k }}</span><span style="flex:1;color:var(--muted)">{{ h.d }}</span><span style="color:{{ h.color }}">{{ h.st }}</span></div></sc-for>
        </div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Export</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"><button type="button" onClick="{{ exportCard }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Save stat card PNG</button><span style="font-size:12px;color:var(--faint)">measured numbers only</span></div>
      </div>
    </div>
  </sc-if>

`;
