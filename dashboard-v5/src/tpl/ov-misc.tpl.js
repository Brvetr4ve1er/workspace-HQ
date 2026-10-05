// Overlays: keyboard cheat sheet (cheatOpen), level-up card (hasLevel),
// refreshing pill (refreshing).
// Cut verbatim from lines 1077-1105 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ cheatOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeCheat }}" style="position:fixed;inset:0;z-index:1050;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Shortcuts" style="width:min(460px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;padding:20px 22px">
        <div style="font-size:21px">Keyboard</div>
        <div style="display:flex;flex-direction:column;margin-top:10px"><sc-for list="{{ keys }}" as="k" hint-placeholder-count="7"><div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="width:150px;flex:0 0 auto;color:var(--accent-text)">{{ k.k }}</span><span style="color:var(--muted)">{{ k.d }}</span></div></sc-for></div>
        <div style="font-size:12px;color:var(--faint);margin-top:12px">Typing in a field never triggers a shortcut.</div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasLevel }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;inset:0;z-index:1200;background:rgba(5,4,9,.88);display:flex;align-items:center;justify-content:center;padding:16px;perspective:600px">
      <div ref="{{ popIn }}" style="text-align:center;color:#e8e6ff;width:min(460px,100%)">
        <x-import component-from-global-scope="hq-obj-viewer" src="model:trophy" mode="ascii" res="130" style="width:200px;height:160px;margin:0 auto;display:block" hint-size="200px,160px"></x-import>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#ffe27a;margin-top:24px">Level up</div>
        <div style="font-size:40px;line-height:1;margin-top:8px">Level {{ lvl.l }} · {{ lvl.t }}</div>
        <div style="margin-top:22px;background:#14102b;border:2px solid #050409;box-shadow:0 0 0 2px #ffd23f;padding:14px 16px;text-align:left">
          <!-- v5: the stats below are all-time and last-scans numbers, not deltas since the previous level --><div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#9a93c9;margin-bottom:8px">Measured from your scans</div>
          <sc-for list="{{ lvl.stats }}" as="s" hint-placeholder-count="4"><div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span style="color:#9a93c9">{{ s.k }}</span><span>{{ s.v }}</span></div></sc-for>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px"><button type="button" onClick="{{ closeLevel }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Continue</button><button type="button" onClick="{{ exportCard }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Save card</button></div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ refreshing }}" hint-placeholder-val="{{ false }}">
    <div ref="{{ popIn }}" style="position:fixed;top:66px;left:50%;transform:translateX(-50%);z-index:1250;background:var(--card);border:1px solid var(--gold);border-radius:12px;padding:8px 16px;font-size:13px">⟳ Refreshing · keeping your place</div>
  </sc-if>

`;
