// Studio screen (v.studio): captures. Its lightbox is lightbox.tpl.js (the
// prompt bar sits between them).
// Cut verbatim from lines 770-799 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`        <sc-if value="{{ v.studio }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:24px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <button type="button" onClick="{{ snip }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✂ Snip</button>
              <!-- v5: the button opens the record panel; recording starts there --><button type="button" onClick="{{ record }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">● Open recorder</button>
              <span style="flex:1"></span>
              <sc-for list="{{ studioFilters }}" as="f" hint-placeholder-count="3"><button onClick="{{ f.go }}" style="{{ f.style }}">{{ f.label }}</button></sc-for>
            </div>
            <sc-if value="{{ hasLatest }}" hint-placeholder-val="{{ true }}">
              <button onClick="{{ openLatest }}" style="display:flex;flex-wrap:wrap;gap:16px;align-items:stretch;padding:0;text-align:left;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer" style-hover="border-color:var(--frame-hi)">
                <!-- v5: the latest capture itself (the file, else its thumbnail), ▶ for a recording without one --><span style="flex:2 1 320px;height:240px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--panel);color:var(--faint);font-size:28px;border-radius:11px"><sc-if value="{{ latest.hasImg }}" hint-placeholder-val="{{ true }}"><img src="{{ latest.src }}" alt="" onError="{{ latest.onErr }}" style="max-width:100%;max-height:100%;object-fit:contain;display:block"></sc-if><sc-if value="{{ latest.noImg }}" hint-placeholder-val="{{ false }}">{{ latest.glyph }}</sc-if></span>
                <span style="flex:1 1 200px;padding:16px;display:flex;flex-direction:column;gap:6px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Latest capture</span><span style="font-size:16px;word-break:break-all">{{ latest.name }}</span><span style="font-size:12px;color:var(--muted)">{{ latest.day }} {{ latest.time }} · {{ latest.size }}</span></span>
              </button>
            </sc-if>
            <sc-for list="{{ days }}" as="d" hint-placeholder-count="2">
              <section>
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">{{ d.day }}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));gap:14px">
                  <sc-for list="{{ d.items }}" as="c" hint-placeholder-count="3">
                    <button onClick="{{ c.open }}" style="display:flex;flex-direction:column;padding:0;text-align:left;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer;transition:transform .14s" style-hover="transform:translateY(-3px);border-color:var(--frame-hi)">
                      <!-- v5: a real thumbnail (the sidecar, else the snip file), ▶ for a recording without one; recovered recordings badged; the length shows only once the video has reported it --><span style="width:100%;height:110px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--panel);color:var(--faint);font-size:16px;position:relative;border-radius:11px 11px 0 0"><sc-if value="{{ c.hasImg }}" hint-placeholder-val="{{ true }}"><img src="{{ c.src }}" alt="" loading="lazy" decoding="async" onError="{{ c.onErr }}" style="width:100%;height:100%;object-fit:cover;display:block"></sc-if><sc-if value="{{ c.noImg }}" hint-placeholder-val="{{ false }}">{{ c.glyph }}</sc-if><sc-if value="{{ c.recovered }}" hint-placeholder-val="{{ false }}"><span title="{{ c.recoveredTip }}" style="position:absolute;left:6px;top:6px;font-size:11px;padding:1px 6px;background:var(--orange);color:#1a0f0a">recovered</span></sc-if><sc-if value="{{ c.isRec }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;right:6px;bottom:6px;font-size:12px;padding:1px 6px;background:var(--red);color:#fff">●<sc-if value="{{ c.hasDur }}" hint-placeholder-val="{{ false }}"> {{ c.dur }}</sc-if></span></sc-if></span>
                      <span style="padding:8px 10px;font-size:12px;color:var(--muted);word-break:break-all">{{ c.time }} · {{ c.size }}</span>
                    </button>
                  </sc-for>
                </div>
              </section>
            </sc-for>
            <sc-if value="{{ noCaps }}" hint-placeholder-val="{{ false }}"><!-- v5: Ctrl Alt R opens the record panel, it does not start a recording --><div style="font-size:14px;color:var(--muted)">No captures yet. Ctrl Alt S to snip, Ctrl Alt R opens the recorder.</div></sc-if>
          </div>
        </sc-if>
`;
