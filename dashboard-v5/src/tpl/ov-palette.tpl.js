// Overlay: command palette (paletteOpen).
// Cut verbatim from lines 935-963 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ paletteOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closePalette }}" style="position:fixed;inset:0;z-index:1000;background:var(--scrim);display:flex;justify-content:center;align-items:flex-start;padding:10vh 12px 12px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Search and commands" style="width:min(660px,100%);max-height:76vh;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;gap:6px;padding:10px 12px 0"><sc-for list="{{ palModeTabs }}" as="m" hint-placeholder-count="2"><button onClick="{{ m.go }}" style="{{ m.style }}">{{ m.label }}</button></sc-for><span style="flex:1"></span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);align-self:center">Tab switches</span></div>
        <div style="padding:10px 12px;border-bottom:2px solid var(--ink)"><input autoFocus="{{ true }}" value="{{ paletteQuery }}" onChange="{{ onPaletteInput }}" placeholder="{{ palPlaceholder }}" style="width:100%;height:46px;padding:0 14px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:16px;outline:none"></div>
        <sc-if value="{{ palIsGo }}" hint-placeholder-val="{{ true }}">
          <div style="overflow-y:auto;padding:6px 0 10px">
            <sc-for list="{{ palGroups }}" as="g" hint-placeholder-count="3">
              <div>
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);padding:10px 14px 4px">{{ g.name }}</div>
                <sc-for list="{{ g.items }}" as="it" hint-placeholder-count="3">
                  <button onClick="{{ it.run }}" onMouseEnter="{{ it.hoverSel }}" style="{{ it.style }}"><span style="width:24px;text-align:center;flex:0 0 auto">{{ it.glyph }}</span><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ it.label }}</span><span style="font-size:12px;color:var(--faint);flex:0 0 auto">{{ it.hint }}</span></button>
                </sc-for>
              </div>
            </sc-for>
            <sc-if value="{{ palEmpty }}" hint-placeholder-val="{{ false }}"><div style="padding:16px;font-size:13px;color:var(--muted)">No matches. Press Tab to ask the local model instead.</div></sc-if>
          </div>
        </sc-if>
        <sc-if value="{{ palIsAsk }}" hint-placeholder-val="{{ false }}">
          <div style="padding:14px;display:flex;flex-direction:column;gap:8px">
            <div style="font-size:13px;color:var(--muted)">Ask the local model about today’s projects, tasks and scans. Press Enter — the answer opens in the Ask panel with what it’s grounded in.</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><sc-for list="{{ askExamples }}" as="e" hint-placeholder-count="4"><button onClick="{{ e.go }}" style="height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;cursor:pointer" style-hover="border-color:var(--purple)">{{ e.q }}</button></sc-for></div>
          </div>
        </sc-if>
        <div style="display:flex;gap:16px;flex-wrap:wrap;padding:8px 14px;border-top:2px solid var(--ink);font-size:12px;color:var(--faint)"><span>↑↓ move</span><span>Enter open</span><span>Tab Go / Ask</span><span>Esc close</span></div>
      </div>
    </div>
  </sc-if>

`;
