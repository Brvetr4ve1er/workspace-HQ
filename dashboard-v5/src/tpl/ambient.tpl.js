// Closes the content column and <main> opened in shell.tpl.js, then the status
// rail (showAmbient) and the end of the body row.
// Cut verbatim from lines 821-837 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`      </div>
    </main>

    <sc-if value="{{ showAmbient }}" hint-placeholder-val="{{ false }}">
      <aside aria-label="Status" ref="{{ slideIn }}" style="{{ ambientStyle }}">
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Status · live</span><sc-if value="{{ ambientOverlayOpen }}" hint-placeholder-val="{{ false }}"><button onClick="{{ toggleAmbientOverlay }}" style="background:none;border:0;color:var(--muted);font-size:15px;cursor:pointer">×</button></sc-if></div>
        <sc-for list="{{ amb }}" as="a" hint-placeholder-count="5">
          <button onClick="{{ a.go }}" style="text-align:left;display:flex;flex-direction:column;gap:3px;padding:11px 12px;background:var(--card);border:1px solid var(--frame);border-radius:12px;cursor:pointer;font-family:var(--term);color:var(--text);transition:transform .12s, box-shadow .12s" style-hover="transform:translateX(-3px);border-color:var(--frame-hi)">
            <span style="display:flex;align-items:center;gap:7px;font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)"><span style="width:7px;height:7px;background:{{ a.color }}"></span>{{ a.label }}</span>
            <span style="font-size:14px;line-height:1.1">{{ a.title }}</span>
            <span style="font-size:12px;color:var(--faint)">{{ a.sub }}</span>
          </button>
        </sc-for>
      </aside>
    </sc-if>
  </div>

`;
