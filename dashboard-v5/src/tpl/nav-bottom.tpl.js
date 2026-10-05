// Bottom nav for narrow windows (L.bottomNav) and its More sheet (moreOpen).
// Cut verbatim from lines 838-851 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ L.bottomNav }}" hint-placeholder-val="{{ false }}">
    <nav aria-label="Destinations" style="flex:0 0 auto;height:62px;display:flex;background:var(--panel);border-top:1px solid var(--frame);backdrop-filter:blur(10px);position:relative;z-index:30">
      <sc-for list="{{ bottomNav }}" as="b" hint-placeholder-count="5">
        <button onClick="{{ b.go }}" style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:0;cursor:pointer;color:{{ b.color }};font-family:var(--term);font-size:12px"><x-import component-from-global-scope="hq-icon" name="{{ b.icon }}" size="18" hint-size="18px,18px"></x-import><span>{{ b.label }}</span></button>
      </sc-for>
    </nav>
  </sc-if>
  <sc-if value="{{ moreOpen }}" hint-placeholder-val="{{ false }}">
    <div ref="{{ popIn }}" style="position:fixed;left:8px;right:8px;bottom:70px;z-index:900;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">
      <sc-for list="{{ moreNav }}" as="n" hint-placeholder-count="5">
        <button onClick="{{ n.go }}" style="height:46px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer"><x-import component-from-global-scope="hq-icon" name="{{ n.id }}" size="16" hint-size="16px,16px"></x-import><span>{{ n.label }}</span></button>
      </sc-for>
    </div>
  </sc-if>
`;
