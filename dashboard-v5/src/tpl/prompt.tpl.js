// The sticky prompt bar at the foot of <main> (showPrompt).
// Cut verbatim from lines 800-806 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ showPrompt }}" hint-placeholder-val="{{ true }}">
          <button onClick="{{ openPalette }}" style="position:sticky;bottom:16px;z-index:5;margin-top:40px;width:100%;display:flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:12px;background:var(--panel);backdrop-filter:blur(12px);border:1px solid var(--frame);color:var(--muted);font-family:var(--term);font-size:13px;cursor:text;text-align:left;box-shadow:0 10px 30px rgba(0,0,0,.25)" style-hover="border-color:var(--gold)">
            <span style="color:var(--gold);font-weight:600">›</span>
            <span style="flex:1;min-width:0;overflow:hidden;white-space:nowrap"><x-import component-from-global-scope="hq-prompt" hints="{{ promptHints }}" hint-size="auto,1em"></x-import></span>
            <span style="font-size:11px;color:var(--faint)">ctrl k</span>
          </button>
        </sc-if>
`;
