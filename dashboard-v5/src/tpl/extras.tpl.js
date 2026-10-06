// v5 additions that have no slice in the Claude Design template (Phase 3 P8:
// the "What's new · trailers" overlay). Joined just before toasts.tpl.js, which
// closes the root <div>, so anything here sits inside the app root. Every
// element here is a v5 addition and carries a <!-- v5: reason --> marker.
// Styled with the template's own tokens and the Settings overlay's scrim, card,
// label and button styles; z-index 1070 puts it over Settings (1050), which it
// can be opened from, and under the lightbox (1080) and the dialogs (1100+).
export default String.raw`  <!-- v5: "What's new · trailers" overlay (Phase 3 P8); opens once per version, from Settings and from the palette -->
  <sc-if value="{{ whatsNewOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: scrim; a click outside the card closes it (Escape too, through closeTop) -->
    <div onClick="{{ closeWhatsNew }}" style="position:fixed;inset:0;z-index:1070;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: the card, same frame as Settings -->
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="What's new" style="width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <!-- v5: title row: title, version, close -->
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:24px;flex:1">What's new</span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">{{ whatsNew.version }}</span><button type="button" onClick="{{ closeWhatsNew }}" aria-label="Close" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <!-- v5: section label -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Trailers</div>
        <!-- v5: the two trailers, side by side when there's room -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:8px">
          <sc-for list="{{ whatsNew.trailers }}" as="t" hint-placeholder-count="2">
            <!-- v5: one trailer card -->
            <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
              <sc-if value="{{ t.ok }}" hint-placeholder-val="{{ false }}">
                <!-- v5: the trailer; preload none and no autoplay: nothing loads or plays until you press play -->
                <video preload="none" controls poster="{{ t.poster }}" src="{{ t.src }}" onError="{{ t.failed }}" style="display:block;width:100%;aspect-ratio:16/9;background:var(--ink);border:1px solid var(--frame);border-radius:8px"></video>
              </sc-if>
              <sc-if value="{{ t.missing }}" hint-placeholder-val="{{ true }}">
                <!-- v5: text fallback when the file isn't in this build or won't play -->
                <div style="display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;padding:12px;text-align:center;background:var(--ink);border:1px dashed var(--frame);border-radius:8px;color:var(--muted);font-size:13px">Trailer not bundled in this build</div>
              </sc-if>
              <!-- v5: trailer caption -->
              <div style="font-size:13px;color:var(--muted)">{{ t.title }}</div>
            </div>
          </sc-for>
        </div>
        <!-- v5: honesty note (README.md says the same): the trailers are sample data rendered for the video, and silent until the soundtrack lands -->
        <div style="font-size:12px;color:var(--faint);margin-top:8px">The trailers show sample data, not your scans: the projects, numbers and the question in them are made up. They have no sound yet.</div>
        <!-- v5: section label -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">What changed in this version</div>
        <!-- v5: the change list (logic/whats-new.js CHANGES, only what this build does) -->
        <div style="display:flex;flex-direction:column;margin-top:6px">
          <sc-for list="{{ whatsNew.changes }}" as="c" hint-placeholder-count="5">
            <!-- v5: one change -->
            <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="flex:0 0 auto;color:var(--gold)">✻</span><span style="color:var(--text)">{{ c }}</span></div>
          </sc-for>
        </div>
        <!-- v5: where to find it again -->
        <div style="font-size:12px;color:var(--faint);margin-top:12px">Shown once per update. Settings › What's new · trailers opens it again.</div>
      </div>
    </div>
  </sc-if>

`;
