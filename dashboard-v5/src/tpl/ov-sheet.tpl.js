// Overlay: confirm sheet for archive / fix / delete (hasSheet).
// Cut verbatim from lines 1042-1055 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ hasSheet }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelSheet }}" style="position:fixed;inset:0;z-index:1150;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="alertdialog" style="width:min(500px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-size:21px;line-height:1.1">{{ sheet.title }}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:10px;text-wrap:pretty;white-space:pre-wrap;overflow-wrap:anywhere">{{ sheet.body }}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">
          <button type="button" onClick="{{ cancelSheet }}" autoFocus="{{ true }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Cancel</button>
          <sc-if value="{{ sheetDanger }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ sheetOk }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">{{ sheet.ok }}</button></sc-if>
          <sc-if value="{{ sheetSafe }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ sheetOk }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ sheet.ok }}</button></sc-if>
        </div>
      </div>
    </div>
  </sc-if>

`;
