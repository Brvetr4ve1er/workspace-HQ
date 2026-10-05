// Overlay: snapshots / time machine (scrubOpen).
// Cut verbatim from lines 852-876 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ scrubOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeScrub }}" style="position:fixed;inset:58px 0 0 0;z-index:880"></div>
    <div ref="{{ popIn }}" style="position:fixed;top:64px;left:12px;z-index:890;width:min(560px,calc(100vw - 24px));background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.4);padding:16px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Snapshots</span><!-- v5: the bars are the last scans (up to 90), not days --><span style="font-size:12px;color:var(--faint)">{{ scrubSpanLabel }} · bar = uncommitted files · ← → to scrub</span></div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:50px;margin:14px 0 8px">
        <sc-for list="{{ scrubBars }}" as="b" hint-placeholder-count="90"><button onClick="{{ b.go }}" title="{{ b.title }}" aria-label="{{ b.title }}" style="flex:1 1 0;min-width:2px;height:{{ b.h }}px;background:{{ b.c }};border:0;padding:0;cursor:pointer" style-hover="background:var(--gold-2)"></button></sc-for>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--faint)"><span>{{ scrubFrom }}</span><span>{{ scrubTo }}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px"><sc-for list="{{ scrubQuick }}" as="q" hint-placeholder-count="5"><button onClick="{{ q.go }}" style="{{ q.style }}">{{ q.label }}</button></sc-for><span style="flex:1"></span><button onClick="{{ toggleCompare }}" style="height:30px;padding:0 12px;border-radius:8px;background:var(--card);border:1px solid var(--frame);color:var(--accent-text);font-family:var(--term);font-size:12px;cursor:pointer">⇄ compare</button></div>
      <sc-if value="{{ compareOn }}" hint-placeholder-val="{{ false }}">
        <div style="margin-top:12px;border:1px solid var(--frame);border-radius:10px;padding:10px 12px">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)"><button onClick="{{ cmpBack }}" style="width:26px;height:26px;border-radius:6px;background:var(--ink);border:1px solid var(--frame);color:var(--text);cursor:pointer">‹</button><span style="flex:1;text-align:center;color:var(--text)">{{ compareLabel }}</span><button onClick="{{ cmpFwd }}" style="width:26px;height:26px;border-radius:6px;background:var(--ink);border:1px solid var(--frame);color:var(--text);cursor:pointer">›</button></div>
          <sc-for list="{{ cmpRows }}" as="c" hint-placeholder-count="5"><div style="display:grid;grid-template-columns:1fr 54px 54px 54px;gap:8px;padding:6px 0;border-bottom:1px dashed var(--frame);font-size:12px"><span style="color:var(--muted)">{{ c.l }}</span><span style="text-align:right">{{ c.a }}</span><span style="text-align:right">{{ c.b }}</span><span style="text-align:right;color:{{ c.c }}">{{ c.d }}</span></div></sc-for>
        </div>
      </sc-if>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--frame)">
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.unc }}</div><div style="font-size:12px;color:var(--muted)">uncommitted</div></div>
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.tasks }}</div><div style="font-size:12px;color:var(--muted)">open tasks</div></div>
        <div><div style="font-size:22px;line-height:1;color:var(--accent-text)">{{ scrubSel.xp }}</div><div style="font-size:12px;color:var(--muted)">xp</div></div>
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.changes }}</div><div style="font-size:12px;color:var(--muted)">changes</div></div>
      </div>
      <div style="font-size:12px;color:var(--faint);margin-top:10px">Showing {{ scrubSel.label }} · every screen follows this date</div>
    </div>
  </sc-if>

`;
