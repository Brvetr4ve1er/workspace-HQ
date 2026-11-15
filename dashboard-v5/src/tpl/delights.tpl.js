// Small delights (batch 7, dish small-delights). <!-- v5: small delights --> three fragments, dc-lite dialect only (dotted paths, !, ===); every value arrives
// finished from vals/delights.js under the ONE key dlxv. Everything sits inside an sc-if on the layer-gated vals, so with the Console layer off none of it
// exists in the DOM.
//   dlxSeason   the 28 px seasonal ornament: interpolated into tpl/home.tpl.js in the greeting row, between the h1 and the sub line
//   dlxAttract  the idle attract slot: interpolated into tpl/brief.tpl.js INSIDE the empty-Brief line (brfEmpty), right after {{ brfEmptyText }}.
//               A zero-size anchor (no layout, no shift), the SVG scene only while it plays, drawn out of flow, pointer-events none, aria-hidden
//   default     the back room overlay: interpolated into tpl/shell.tpl.js beside the other overlays (above Settings, which is where its door is)
// Motion lives only in styles/delights.css (attached by the layer, gated by prefers-reduced-motion AND the data-hq-reduce root attribute).
// No data, no network, no sound, no count of anything the owner has.
const SEASON_SHAPES = String.raw`<sc-for list="{{ dlxv.dlxSeasonPaths }}" as="p" hint-placeholder-count="1"><path d="{{ p.d }}" style="{{ p.style }}"></path></sc-for><sc-for list="{{ dlxv.dlxSeasonPolys }}" as="q" hint-placeholder-count="1"><polygon points="{{ q.points }}" style="{{ q.style }}"></polygon></sc-for><sc-for list="{{ dlxv.dlxSeasonRects }}" as="r" hint-placeholder-count="1"><rect x="{{ r.x }}" y="{{ r.y }}" width="{{ r.w }}" height="{{ r.h }}" rx="{{ r.rx }}" style="{{ r.style }}"></rect></sc-for><sc-for list="{{ dlxv.dlxSeasonLines }}" as="l" hint-placeholder-count="1"><line x1="{{ l.x1 }}" y1="{{ l.y1 }}" x2="{{ l.x2 }}" y2="{{ l.y2 }}" style="{{ l.style }}"></line></sc-for><sc-for list="{{ dlxv.dlxSeasonCircles }}" as="c" hint-placeholder-count="1"><circle cx="{{ c.cx }}" cy="{{ c.cy }}" r="{{ c.r }}" style="{{ c.style }}"></circle></sc-for>`;

export const dlxSeason = String.raw`              <!-- v5: small delights — the month's ornament, static, follows the Console layer switch -->
              <sc-if value="{{ dlxv.dlxSeasonOn }}" hint-placeholder-val="{{ false }}"><span data-dlx="season" title="{{ dlxv.dlxSeasonTitle }}" style="display:inline-flex;align-self:center;flex:0 0 auto;width:28px;height:28px"><svg viewBox="{{ dlxv.dlxSeasonBox }}" width="28" height="28" role="img" aria-label="{{ dlxv.dlxSeasonLabel }}" focusable="false" style="display:block">${SEASON_SHAPES}</svg></span></sc-if>
`;

export const dlxAttract = String.raw`<sc-if value="{{ dlxv.dlxAttractSlot }}" hint-placeholder-val="{{ false }}"><span data-dlx="attract-anchor" aria-hidden="true" style="position:relative;display:inline-block;width:0;height:0;vertical-align:middle"><sc-if value="{{ dlxv.dlxAttractRun }}" hint-placeholder-val="{{ false }}"><svg class="dlx-attract" data-dlx="attract" viewBox="0 0 96 24" width="96" height="24" focusable="false" style="{{ dlxv.dlxAttractStyle }};position:absolute;left:14px;top:-12px;pointer-events:none;overflow:visible"><rect class="dlx-cursor" x="6" y="6" width="6" height="12" style="fill:var(--green)"></rect><rect x="58" y="12" width="30" height="6" rx="1" style="fill:var(--ink);stroke:var(--frame);stroke-width:1"></rect><g class="dlx-cart"><rect x="64" y="1" width="18" height="15" rx="2" style="fill:var(--card-hi);stroke:var(--frame-hi);stroke-width:1"></rect><rect x="67" y="4" width="12" height="6" rx="1" style="fill:var(--bg2)"></rect><rect x="68" y="13" width="10" height="3" style="fill:var(--frame-hi)"></rect></g></svg></sc-if></span></sc-if>`;

const CLOSE = 'width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer';
const WALL = 'fill:var(--ink)';

export default String.raw`  <!-- v5: small delights — the back room: a dim workshop, drawn in SVG, nothing in it needs the owner -->
  <sc-if value="{{ dlxv.dlxRoomOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ dlxv.dlxRoomClose }}" data-dlx="room-scrim" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ dlxv.dlxRoomStop }}" role="dialog" aria-modal="true" aria-label="{{ dlxv.dlxRoomTitle }}" data-dlx="room" style="width:min(520px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:16px 18px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center"><span style="font-size:20px;flex:1">{{ dlxv.dlxRoomTitle }}</span><button type="button" ref="{{ dlxv.dlxRoomRef }}" onClick="{{ dlxv.dlxRoomClose }}" aria-label="Close back room" style="${CLOSE}">×</button></div>
        <svg viewBox="0 0 320 200" role="img" aria-label="A dim workshop with a shelf of blank cartridges and a lamp" style="width:100%;height:auto;display:block;border-radius:8px;border:1px solid var(--frame)">
          <rect x="0" y="0" width="320" height="200" style="${WALL}"></rect>
          <rect x="0" y="186" width="320" height="14" style="fill:var(--bg2)"></rect>
          <rect x="24" y="102" width="200" height="4" rx="1" style="fill:var(--frame-hi)"></rect>
          <rect x="24" y="158" width="200" height="4" rx="1" style="fill:var(--frame-hi)"></rect>
          <sc-for list="{{ dlxv.dlxRoomCartridges }}" as="k" hint-placeholder-count="6">
            <g><rect x="{{ k.x }}" y="{{ k.y }}" width="{{ k.w }}" height="{{ k.h }}" rx="3" style="fill:var(--card-hi);stroke:var(--frame);stroke-width:1"></rect><rect x="{{ k.labelX }}" y="{{ k.labelY }}" width="{{ k.labelW }}" height="{{ k.labelH }}" rx="1" style="fill:var(--bg2)"></rect><rect x="{{ k.notchX }}" y="{{ k.notchY }}" width="{{ k.notchW }}" height="8" style="fill:var(--frame)"></rect></g>
          </sc-for>
          <circle class="dlx-lamp-glow" cx="262" cy="86" r="42" style="fill:var(--yellow);opacity:.1"></circle>
          <rect x="248" y="180" width="50" height="6" rx="2" style="fill:var(--frame-hi)"></rect>
          <path d="M273 180 L273 122 L258 84" style="fill:none;stroke:var(--frame-hi);stroke-width:3;stroke-linecap:round;stroke-linejoin:round"></path>
          <polygon points="236,70 270,58 282,78 248,90" style="fill:var(--card-hi);stroke:var(--frame-hi);stroke-width:1"></polygon>
          <circle class="dlx-lamp" cx="260" cy="84" r="5" style="fill:var(--yellow)"></circle>
        </svg>
        <div style="font-size:14px;color:var(--muted);text-align:center">{{ dlxv.dlxRoomNote }}</div>
      </div>
    </div>
  </sc-if>
`;
