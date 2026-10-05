// Overlay: run confirmation (hasConfirm).
// Cut verbatim from lines 993-1018 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ hasConfirm }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelConfirm }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: focus moves into the dialog when it opens (Enter on a focused button only clicks that button, so the trigger must not keep focus); outline:none for that programmatic focus -->
      <div onClick="{{ stop }}" ref="{{ confirmRef }}" tabindex="-1" role="dialog" aria-label="Run confirm" style="width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;outline:none">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this runs</div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:10px"><span style="font-size:24px">{{ confirm.icon }}</span><div><div style="font-size:21px;line-height:1">{{ confirm.name }}</div><div style="font-size:13px;color:var(--muted)">{{ confirm.desc }}</div></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
          <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ confirm.kindTone }});border:1px solid color-mix(in oklab,var(--tone-{{ confirm.kindTone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ confirm.kindTone }}) 10%,transparent)">{{ confirm.kind }}</span>
          <sc-if value="{{ confirm.quota }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-gold);border:1px solid color-mix(in oklab,var(--tone-gold) 45%,transparent);background:color-mix(in oklab,var(--tone-gold) 10%,transparent)">Uses Claude quota</span></sc-if>
          <sc-if value="{{ confirm.destructive }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-red);border:1px solid color-mix(in oklab,var(--tone-red) 45%,transparent);background:color-mix(in oklab,var(--tone-red) 10%,transparent)">Changes remote repos · always asks</span></sc-if>
        </div>
        <div style="margin-top:14px;font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Exact command</div>
        <div style="margin-top:6px;background:var(--ink);padding:10px 12px;font-size:13px;word-break:break-all">{{ confirm.cmd }}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--muted)">in {{ confirm.dir }}</div>
        <sc-if value="{{ confirm.hasSteps }}" hint-placeholder-val="{{ false }}">
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px"><sc-for list="{{ confirm.steps }}" as="s" hint-placeholder-count="3"><div style="font-size:13px"><span style="color:var(--accent-text);margin-right:8px">{{ s.n }}.</span>{{ s.s }}</div></sc-for></div>
        </sc-if>
        <div style="margin-top:12px;font-size:12px;color:{{ confirm.lastColor }}">{{ confirm.last }}</div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px"><sc-for list="{{ confirm.askOpts }}" as="o" hint-placeholder-count="2"><button onClick="{{ o.go }}" disabled="{{ o.disabled }}" style="display:flex;gap:10px;align-items:center;background:none;border:0;padding:4px 0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;text-align:left" style-hover="color:var(--accent-text)"><span style="color:var(--accent-text)">{{ o.on }}</span>{{ o.label }}</button></sc-for></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button type="button" onClick="{{ cancelConfirm }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Cancel · Esc</button>
          <button type="button" onClick="{{ confirmRun }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run · Enter</button>
        </div>
      </div>
    </div>
  </sc-if>

`;
