// Toast stack, then the root </div> opened in shell.tpl.js.
// Cut verbatim from lines 1122-1133 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <div aria-live="polite" style="position:fixed;right:16px;bottom:84px;z-index:1300;display:flex;flex-direction:column;gap:8px;align-items:flex-end;max-width:min(420px,calc(100vw - 32px));pointer-events:none">
    <sc-for list="{{ toasts }}" as="t" hint-placeholder-count="0">
      <div ref="{{ t.ref }}" style="pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;box-shadow:inset 5px 0 0 {{ t.color }}, 0 12px 30px rgba(0,0,0,.35);font-size:13px">
        <sc-if value="{{ t.isProgress }}" hint-placeholder-val="{{ false }}"><span ref="{{ pulse }}" style="width:8px;height:8px;background:var(--gold);flex:0 0 auto"></span></sc-if>
        <span style="flex:1;min-width:0">{{ t.text }}</span>
        <sc-if value="{{ t.hasUndo }}" hint-placeholder-val="{{ false }}"><button onClick="{{ t.undo }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer">Undo</button></sc-if>
        <sc-if value="{{ t.hasCancel }}" hint-placeholder-val="{{ false }}"><button onClick="{{ t.cancel }}" style="background:none;border:0;color:var(--red);font-size:13px;cursor:pointer">Cancel</button></sc-if>
        <button onClick="{{ t.close }}" aria-label="Dismiss" style="background:none;border:0;color:var(--faint);font-size:13px;cursor:pointer">×</button>
      </div>
    </sc-for>
  </div>
</div>
`;
