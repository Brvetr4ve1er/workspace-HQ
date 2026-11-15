// Cheat codes: the timing overlay (default export) and the found-codes list (named export foundFragment, for Settings > Memory card).
// <!-- v5: cheats --> new fragments. dc-lite dialect only: dotted paths, !, ===; everything arrives finished from vals/cheats.js under ONE
// key, chtv. The overlay is inside sc-if chtv.chtDebug, so with the layer off (or the overlay closed) there is NO DOM at all. It is a small
// fixed panel: pointer-events none, except its own close button; no transition, no animation, no sound, no live region (it must not
// chatter at a screen reader on every render). Colours are tokens only. The node carries data-hq-console so the layer's "nothing is
// attached while off" probe can see it when it is on.
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const ROW = 'display:flex;justify-content:space-between;gap:14px';
const VAL = 'color:var(--text);font-variant-numeric:tabular-nums';

export default String.raw`            <!-- v5: cheats — frame timing overlay (values nest under ONE key, chtv); only while the timing code is on -->
            <sc-if value="{{ chtv.chtDebug }}" hint-placeholder-val="{{ false }}">
              <aside data-hq-console="timing" aria-label="Frame timing" style="position:fixed;left:12px;bottom:12px;z-index:2100;min-width:210px;max-width:min(300px,calc(100vw - 24px));display:flex;flex-direction:column;gap:5px;padding:9px 11px 10px;background:var(--panel);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);font-size:12px;line-height:1.3;color:var(--text);pointer-events:none">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <span style="${LABEL}">frame timing</span>
                  <button type="button" onClick="{{ chtv.chtClose }}" aria-label="Close frame timing" title="Close frame timing" style="pointer-events:auto;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:6px;font-family:var(--term);font-size:13px;line-height:1;cursor:pointer" style-hover="border-color:var(--frame-hi)">×</button>
                </div>
                <div style="${ROW}"><span style="color:var(--muted)">last render</span><span style="${VAL}">{{ chtv.chtLast }}</span></div>
                <div style="${ROW}"><span style="color:var(--muted)">p50</span><span style="${VAL}">{{ chtv.chtP50 }}</span></div>
                <div style="${ROW}"><span style="color:var(--muted)">p95</span><span style="${VAL}">{{ chtv.chtP95 }}</span></div>
                <div style="font-size:11px;color:var(--faint)">{{ chtv.chtSamples }}</div>
                <div style="${ROW}"><span style="color:var(--muted)">renders, last minute</span><span style="${VAL}">{{ chtv.chtPerMin }}</span></div>
                <div style="${ROW}"><span style="color:var(--muted)">values</span><span style="${VAL}">{{ chtv.chtKeys }}</span></div>
                <div style="${ROW}"><span style="color:var(--muted)">last live update</span><span style="${VAL}">{{ chtv.chtEmit }}</span></div>
              </aside>
            </sc-if>
`;

// Settings > Memory card: "Codes found: 2 of 8" and the NAMES of the codes found so far, a dash for each one not found yet (never a
// sequence). Only while the layer is on (the Memory card itself is). The list is an ordinary list; the sentence under it says the same
// in words for a screen reader.
export const foundFragment = String.raw`            <!-- v5: cheats — codes found (Memory card) -->
            <sc-if value="{{ chtv.chtShowFound }}" hint-placeholder-val="{{ false }}">
              <div data-hq-console="found" style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
                <div style="${LABEL}">{{ chtv.chtFoundTitle }}</div>
                <ul aria-label="Codes found, by name" style="list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-family:var(--term);font-size:12px">
                  <sc-for list="{{ chtv.chtFound }}" as="c" hint-placeholder-count="7"><li style="color:{{ c.color }}">{{ c.label }}</li></sc-for>
                </ul>
                <div style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">{{ chtv.chtFoundSr }}</div>
              </div>
            </sc-if>
`;
