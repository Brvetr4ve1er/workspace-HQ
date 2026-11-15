// Settings > "Memory card": what the app keeps on this PC, one save-slot block per KIND of data (a size, a file count, how long ago the newest write
// was, and a bar scaled to the largest kind), plus the chat-index snapshot's age. READ-ONLY: the only button is Refresh (a read).
// <!-- v5: Memory card --> new fragment, interpolated into tpl/ov-settings.tpl.js after the Reach / Money blocks, under an sc-if on cslv.cslOn
// (the Console layer's master switch); it wraps itself in mcdv.mcdShow too, so with the layer off the section node does not exist.
// dc-lite dialect only: dotted paths, !, ===; everything arrives finished from vals/memory-card.js. Tokens only (var(--...)); nothing animates
// (no transition, no animation): the section is the same with reduced motion on or off. Each block is an SVG with role="img" and an aria-label; the
// visually hidden list under the strip says the same thing in words. Two hooks for later work, both inert here: an empty element slot for the
// discovered-codes list (data-mcd="codes-slot") and a last "Empty slot" block (data-mcd="empty-slot") that is a plain block with no handler.
const HEAD = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px';
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi)"';
const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

import { foundFragment } from './cheats-overlay.tpl.js';   // batch 7: the codes-found list (names only)

export default String.raw`        <!-- v5: Memory card — what the app keeps on this PC, by kind; read-only (its values nest under ONE key, mcdv) -->
        <sc-if value="{{ mcdv.mcdShow }}" hint-placeholder-val="{{ false }}">
          <section data-mcd="section" aria-label="Memory card: what the app keeps on this PC" style="display:flex;flex-direction:column;gap:8px">
            <sc-if value="{{ mcdv.mcdOffline }}" hint-placeholder-val="{{ false }}"><div data-mcd="offline" style="font-size:13px;color:var(--muted);margin-top:18px">{{ mcdv.mcdOfflineText }}</div></sc-if>
            <sc-if value="{{ mcdv.mcdHasBody }}" hint-placeholder-val="{{ true }}">
              <div style="${HEAD};display:flex;align-items:center;gap:10px"><span style="flex:1">{{ mcdv.mcdTitle }}</span><span data-mcd="summary" style="color:var(--muted)">{{ mcdv.mcdSummary }}</span><button type="button" data-mcd="refresh" onClick="{{ mcdv.mcdRefresh }}" disabled="{{ mcdv.mcdRefreshOff }}" aria-label="{{ mcdv.mcdRefreshAria }}" style="${BTN}" ${BTN_HOVER}>{{ mcdv.mcdRefreshLabel }}</button></div>
              <sc-if value="{{ mcdv.mcdLoading }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--muted)">{{ mcdv.mcdLoadingText }}</div></sc-if>
              <sc-if value="{{ mcdv.mcdHasErr }}" hint-placeholder-val="{{ false }}"><div data-mcd="error" role="alert" style="font-size:13px;color:var(--red)">{{ mcdv.mcdErrText }}</div></sc-if>
              <sc-if value="{{ mcdv.mcdReady }}" hint-placeholder-val="{{ true }}">
                <div data-mcd="strip" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:10px">
                  <sc-for list="{{ mcdv.mcdBlocks }}" as="b" hint-placeholder-count="11">
                    <svg data-mcd="slot" data-mcd-kind="{{ b.kind }}" viewBox="0 0 160 72" role="img" aria-label="{{ b.twin }}" style="width:100%;height:auto;display:block">
                      <rect x="1" y="1" width="158" height="70" rx="6" style="fill:var(--ink);stroke:var(--frame);stroke-width:1"></rect>
                      <text x="10" y="16" style="fill:var(--faint);font-size:9px;font-family:var(--term)">{{ b.label }}</text>
                      <text x="10" y="36" data-mcd="big" style="fill:{{ b.bigFill }};font-size:14px;font-family:var(--term)">{{ b.big }}</text>
                      <text x="10" y="51" data-mcd="small" style="fill:var(--muted);font-size:10px;font-family:var(--term)">{{ b.small }}</text>
                      <sc-if value="{{ b.hasBar }}" hint-placeholder-val="{{ true }}">
                        <rect x="10" y="58" width="140" height="5" rx="2" style="fill:var(--frame);opacity:.4"></rect>
                        <rect data-mcd="fill" x="10" y="58" width="{{ b.fillW }}" height="5" rx="2" style="fill:{{ b.barFill }}"></rect>
                      </sc-if>
                    </svg>
                  </sc-for>
                  <div data-mcd="empty-slot" aria-hidden="true" style="aspect-ratio:160/72;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border:1px dashed var(--frame);border-radius:6px;font-family:var(--term);font-size:10px;color:var(--faint);opacity:.6">{{ mcdv.mcdEmptySlotText }}</div>
                </div>
                <ul data-mcd="twin" aria-label="What the app keeps, in words" style="${HIDDEN}">
                  <sc-for list="{{ mcdv.mcdBlocks }}" as="w" hint-placeholder-count="11"><li>{{ w.twin }}</li></sc-for>
                </ul>
                <sc-if value="{{ mcdv.mcdCapped }}" hint-placeholder-val="{{ false }}"><div data-mcd="capped" style="font-size:12px;color:var(--orange)">{{ mcdv.mcdCappedText }}</div></sc-if>
              </sc-if>
              <div data-mcd="codes-slot" id="mcd-codes-slot">
${foundFragment}</div>
              <div data-mcd="note" style="font-size:12px;color:var(--faint)">{{ mcdv.mcdNote }}</div>
            </sc-if>
          </section>
        </sc-if>
`;
