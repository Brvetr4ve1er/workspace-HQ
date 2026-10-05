// Studio capture lightbox (hasLightbox), still inside <main>.
// Cut verbatim from lines 807-820 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ hasLightbox }}" hint-placeholder-val="{{ false }}">
          <div onClick="{{ closeLightbox }}" style="position:fixed;inset:0;z-index:1080;background:rgba(5,4,9,.85);display:flex;align-items:center;justify-content:center;padding:20px">
            <div onClick="{{ stop }}" ref="{{ popIn }}" style="width:min(820px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px">
              <div style="height:min(52vh,460px);display:grid;place-items:center;background:repeating-linear-gradient(45deg,var(--panel) 0 14px,var(--card) 14px 28px);color:var(--faint);font-size:15px">{{ lb.name }}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 14px">
                <div style="flex:1 1 200px;min-width:0"><div style="font-size:14px;word-break:break-all">{{ lb.name }}</div><div style="font-size:12px;color:var(--muted)">{{ lb.meta }}</div></div>
                <button type="button" onClick="{{ lbOpen }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open</button>
                <button type="button" onClick="{{ lbCopy }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Copy</button>
                <button type="button" onClick="{{ lbReveal }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Show in folder</button>
                <button type="button" onClick="{{ lbDelete }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">Delete…</button>
              </div>
            </div>
          </div>
        </sc-if>
`;
