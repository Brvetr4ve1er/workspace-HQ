// The Workbench look's small illustrations. <!-- v5: Workbench art --> fragments, interpolated into the five hosts (the clean-board card in
// tpl/brief-history.tpl.js, the Crew header, the Vault desk header, the empty Brief line and the empty Projects shelf line). Each fragment wraps itself
// in wbnv.wbnOn, so with the look off (the default) there is NO node in the page. dc-lite dialect only: dotted paths. Every value is one key under wbnv,
// finished by vals/workbench.js from logic/workbench-art.mjs. Colours are tokens only (they come from the shapes, which carry var(--...) values).
// The picture is aria-hidden and the wrapper carries role="img" with the readout as its name, so a screen reader hears "3 cleared" once.
// The readout is HTML laid over the little screen (SVG <text> cannot take a {{ }} binding), uppercase monospace through the look's own sheet.
// NO {{ }} may ever appear inside a <style> text: the runtime would turn it into a <span>.
const FRAME = 'position:relative;display:block;width:168px;height:118px;max-width:100%;flex:0 0 auto';
const SVG = 'display:block;width:100%;height:100%;overflow:visible;stroke-linejoin:round;stroke-linecap:round';

/** one illustration for `kind` (cleared | skills | notes | needyou | projects) */
export const wbnArt = (kind) => String.raw`<sc-if value="{{ wbnv.wbnOn }}" hint-placeholder-val="{{ false }}"><span role="img" aria-label="{{ wbnv.${kind}.aria }}" data-wbn="art-${kind}" style="${FRAME}"><svg viewBox="{{ wbnv.${kind}.viewBox }}" aria-hidden="true" focusable="false" style="${SVG}"><sc-for list="{{ wbnv.${kind}.shapes }}" as="p" hint-placeholder-count="8"><path d="{{ p.d }}" style="fill:{{ p.fill }};stroke:{{ p.stroke }};stroke-width:{{ p.sw }}"></path></sc-for><rect class="wbn-cursor" x="{{ wbnv.${kind}.cursorX }}" y="{{ wbnv.${kind}.cursorY }}" width="{{ wbnv.${kind}.cursorW }}" height="{{ wbnv.${kind}.cursorH }}" style="fill:var(--accent-text);stroke:none"></rect></svg><span data-wbn="readout" aria-hidden="true" style="{{ wbnv.${kind}.screenStyle }}">{{ wbnv.${kind}.label }}</span></span></sc-if>`;
