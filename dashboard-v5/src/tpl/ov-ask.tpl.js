// Overlay: Ask panel (askOpen).
// Cut verbatim from lines 909-934 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ askOpen }}" hint-placeholder-val="{{ false }}">
    <aside ref="{{ slideIn }}" aria-label="Ask" style="position:fixed;top:58px;right:0;bottom:0;z-index:905;width:min(420px,100vw);background:var(--panel);border-left:1px solid var(--frame);backdrop-filter:blur(10px);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:2px solid var(--ink)"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ Local model</span><span style="font-size:18px;flex:1">Ask</span><button onClick="{{ closeAsk }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
      <div style="padding:10px 16px;font-size:12px;color:var(--faint);border-bottom:1px dashed var(--frame)">Answers come from today’s data only, never the web. Model text stays in this panel.<sc-if value="{{ askPastNote }}" hint-placeholder-val="{{ false }}"> You’re viewing {{ viewedLabel }}; answers are still about today.</sc-if></div>
      <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px">
        <sc-for list="{{ asks }}" as="a" hint-placeholder-count="1">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="align-self:flex-end;max-width:85%;background:var(--ink);border:1px solid var(--frame);border-radius:8px;padding:6px 10px;font-size:13px">{{ a.q }}</div>
            <div style="background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:12px">
              <div style="font-size:13px;text-wrap:pretty"><!-- v5: stream bound to the entry (true while the answer arrives) --><x-import component-from-global-scope="hq-type" text="{{ a.text }}" stream="{{ a.stream }}" speed="12" hide-cursor="" hint-size="auto,1em"></x-import></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                <sc-for list="{{ a.src }}" as="s" hint-placeholder-count="1"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:var(--muted)">grounded in {{ s }}</span></sc-for>
                <sc-if value="{{ a.est }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:1px 6px;border:1px dotted var(--faint);color:var(--faint)">estimate</span></sc-if>
                <sc-if value="{{ a.refusal }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--blue);color:var(--blue)">honest “don’t know”</span></sc-if>
              </div>
            </div>
          </div>
        </sc-for>
      </div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:2px solid var(--ink)">
        <input value="{{ askDraft }}" onChange="{{ onAskInput }}" onKeyDown="{{ askKey }}" placeholder="Ask a follow-up…" style="flex:1;min-width:0;height:40px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none">
        <button type="button" onClick="{{ askSubmit }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Ask</button>
      </div>
    </aside>
  </sc-if>

`;
