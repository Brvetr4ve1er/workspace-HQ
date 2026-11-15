// Projects > Shelf (batch 7, dish "cartridge-shelf"): the List | Shelf toggle and the Shelf view, two fragments for tpl/projects.tpl.js.
//   import shelfView, { shelfToggle } from './shelf.tpl.js';
//   - shelfToggle goes in the Sort row of the grid (after the last sort chip's </sc-for>). It wraps itself in cslv.cslOn, so with the
//     Console layer off it renders nothing: no node, no wrapper.
//   - shelfView goes inside the grid's <sc-if isGrid> div, right after the "No project matches" block. It wraps itself in shfv.shelfOn.
//   - the list's own card grid gets ONE wrapper, <sc-if value="{{ shfv.listOn }}">, so the Shelf replaces it while chosen
//     (shfv.listOn is true whenever the layer is off or List is chosen; an sc-if adds no element).
// dc-lite dialect only: dotted paths, !, ===. Every binding is a key of vals/shelf.js SHF_OFF (the test pins that, so the runtime's
// unresolved-path counter stays 0). Colours are tokens; the art itself is baked colour from the data (logic/shelf.mjs).
// Hover: the lifting variant and the outlining variant are two sc-if branches chosen by shfv.lift (the reduceMotion pref OR the OS
// query), because style-hover is compiled once from its literal text and cannot be bound. No transition anywhere in the outline one.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer';
const CART_BTN = 'display:block;padding:0;margin:0;background:none;border:0;color:inherit;cursor:pointer';

// One cartridge's artwork (everything inside the <svg>), bound to a cartridge `c` (logic/shelf.mjs cartridgeOf). Initials are the only text.
const INNER = String.raw`<defs><linearGradient id="{{ c.gid }}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{{ c.stop0 }}"></stop><stop offset="1" stop-color="{{ c.stop1 }}"></stop></linearGradient></defs>
<polygon points="{{ c.paths.shell }}" style="fill:{{ c.paths.paint.shell }};stroke:{{ c.paths.paint.edge }};stroke-width:2;stroke-linejoin:round"></polygon>
<polygon points="{{ c.paths.bevelLight }}" style="fill:{{ c.paths.paint.bevelLight }};opacity:{{ c.paths.paint.bevelLightOpacity }}"></polygon>
<polygon points="{{ c.paths.bevelDark }}" style="fill:{{ c.paths.paint.bevelDark }};opacity:{{ c.paths.paint.bevelDarkOpacity }}"></polygon>
<path d="{{ c.paths.gripD }}" style="fill:none;stroke:{{ c.paths.paint.grip }};stroke-width:3;stroke-linecap:round"></path>
<rect x="{{ c.paths.label.x }}" y="{{ c.paths.label.y }}" width="{{ c.paths.label.w }}" height="{{ c.paths.label.h }}" rx="{{ c.paths.label.rx }}" style="fill:{{ c.fill }}"></rect>
<rect x="{{ c.paths.stripe.x }}" y="{{ c.paths.stripe.y }}" width="{{ c.paths.stripe.w }}" height="{{ c.paths.stripe.h }}" style="fill:{{ c.stripe }}"></rect>
<text x="{{ c.paths.initials.x }}" y="{{ c.paths.initials.y }}" text-anchor="middle" style="font-family:var(--term);font-size:30px;font-weight:700;fill:{{ c.ink }}">{{ c.initials }}</text>`;

const ART = String.raw`<svg viewBox="0 0 120 148" width="104" height="128" role="img" aria-label="{{ c.label }}" focusable="false" style="display:block;overflow:visible">
${INNER}
</svg>`;

// The console with one cartridge pushed into its slot from above (the lower part hides behind the console's front).
const INSERTED = String.raw`<sc-if value="{{ shfv.hasInserted }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;align-items:flex-end;gap:12px">
            <sc-for list="{{ shfv.insertedList }}" as="c" hint-placeholder-count="1">
              <button type="button" data-shelf="inserted" data-id="{{ c.id }}" aria-label="{{ c.label }}" onClick="{{ c.open }}" style="${CART_BTN}">
                <svg viewBox="{{ c.art.viewBox }}" width="{{ c.art.w }}" height="{{ c.art.h }}" role="img" aria-label="{{ c.label }}" focusable="false" style="display:block;overflow:visible">
                  <g transform="{{ c.art.cartTransform }}">
${INNER}
                  </g>
                  <polygon points="{{ c.art.front }}" style="fill:{{ c.art.paint.front }}"></polygon>
                  <polygon points="{{ c.art.lip }}" style="fill:{{ c.art.paint.lip }}"></polygon>
                  <polygon points="{{ c.art.slot }}" style="fill:{{ c.art.paint.slot }}"></polygon>
                  <line x1="{{ c.art.light.x1 }}" y1="{{ c.art.light.y1 }}" x2="{{ c.art.light.x2 }}" y2="{{ c.art.light.y2 }}" style="stroke:{{ c.art.paint.light }};stroke-opacity:.18;stroke-width:1"></line>
                </svg>
              </button>
              <span data-shelf="inserted-caption" style="font-family:var(--term);font-size:12px;color:var(--muted);padding-bottom:6px">{{ c.caption }}</span>
            </sc-for>
          </div>
        </sc-if>`;

const CART_LIFT = String.raw`<button type="button" data-shelf="cart" data-id="{{ c.id }}" aria-label="{{ c.label }}" onClick="{{ c.open }}" style="${CART_BTN};transition:transform .12s ease-out, filter .12s ease-out" style-hover="transform:translateY(-6px);filter:drop-shadow(0 8px 6px rgba(0,0,0,.45))">
${ART}
                  </button>`;
const CART_FLAT = String.raw`<button type="button" data-shelf="cart" data-id="{{ c.id }}" aria-label="{{ c.label }}" onClick="{{ c.open }}" style="${CART_BTN}" style-hover="outline:2px solid var(--gold);outline-offset:3px">
${ART}
                  </button>`;

/** The List | Shelf toggle. Only while the Console layer is on (the outer sc-if); one pressed button at a time. */
export const shelfToggle = String.raw`<!-- v5: Projects List | Shelf toggle (batch 7, Console layer only: the sc-if renders nothing while the layer is off) --><sc-if value="{{ cslv.cslOn }}" hint-placeholder-val="{{ false }}"><span role="group" aria-label="Projects view" data-shelf="toggle" style="display:inline-flex;gap:4px;margin-left:8px"><sc-for list="{{ shfv.toggle }}" as="b" hint-placeholder-count="2"><button type="button" data-shelf-view="{{ b.id }}" onClick="{{ b.go }}" aria-pressed="{{ b.on }}" style="{{ b.style }}">{{ b.label }}</button></sc-for></span></sc-if>`;

/** The Shelf view: the inserted console, the count line, rows of cartridges standing on rails, Show more. */
export default String.raw`<!-- v5: Projects Shelf view (batch 7, Console layer only): cartridges standing on rails, the console slot, paged 48 at a time; a second view of the same list -->
    <sc-if value="{{ shfv.shelfOn }}" hint-placeholder-val="{{ false }}">
      <div data-shelf="view" style="display:flex;flex-direction:column;gap:14px;margin-bottom:8px">
        <div style="display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap">
        ${INSERTED}
          <span style="flex:1"></span>
          <span data-shelf="count" style="font-size:12px;color:var(--faint);white-space:nowrap">{{ shfv.countLine }}</span>
        </div>
        <sc-if value="{{ shfv.empty }}" hint-placeholder-val="{{ false }}"><div data-shelf="empty" style="font-size:14px;color:var(--muted)">{{ shfv.emptyLine }}</div></sc-if>
        <div role="list" aria-label="{{ shfv.listLabel }}" data-shelf="shelf" style="display:flex;flex-direction:column;gap:10px">
          <sc-for list="{{ shfv.rows }}" as="r" hint-placeholder-count="6">
            <div data-shelf="row" style="display:flex;flex-direction:column;gap:0">
              <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;padding:10px 10px 0">
                <sc-for list="{{ r.items }}" as="c" hint-placeholder-count="8">
                  <div role="listitem" style="display:block">
                    <sc-if value="{{ shfv.lift }}" hint-placeholder-val="{{ true }}">
                  ${CART_LIFT}
                    </sc-if>
                    <sc-if value="{{ !shfv.lift }}" hint-placeholder-val="{{ false }}">
                  ${CART_FLAT}
                    </sc-if>
                  </div>
                </sc-for>
              </div>
              <svg viewBox="{{ r.rail.viewBox }}" preserveAspectRatio="none" aria-hidden="true" focusable="false" style="display:block;width:100%;height:12px">
                <polygon points="{{ r.rail.face }}" style="fill:var(--frame)"></polygon>
                <line x1="{{ r.rail.lit.x1 }}" y1="{{ r.rail.lit.y1 }}" x2="{{ r.rail.lit.x2 }}" y2="{{ r.rail.lit.y2 }}" style="stroke:var(--frame-hi);stroke-width:1;vector-effect:non-scaling-stroke"></line>
                <line x1="{{ r.rail.shade.x1 }}" y1="{{ r.rail.shade.y1 }}" x2="{{ r.rail.shade.x2 }}" y2="{{ r.rail.shade.y2 }}" style="stroke:var(--ink);stroke-width:1.5;vector-effect:non-scaling-stroke"></line>
              </svg>
            </div>
          </sc-for>
        </div>
        <sc-if value="{{ shfv.hasMore }}" hint-placeholder-val="{{ false }}"><div><button type="button" data-shelf="more" onClick="{{ shfv.more }}" style="${BTN}">{{ shfv.moreLabel }}</button></div></sc-if>
      </div>
    </sc-if>`;
