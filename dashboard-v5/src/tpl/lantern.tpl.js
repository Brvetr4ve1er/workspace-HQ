// The Lantern look's cards (batch 11). <!-- v5: Lantern card --> fragments, interpolated beside the Workbench pictures in the five hosts (the clean-board card in
// tpl/brief-history.tpl.js, the Crew header, the Vault desk header, the empty Brief line and the empty Projects shelf line; each places lntArt(kind) right after
// its wbnArt(kind), and the two never show together) and in the project page header (lntArt('project'): that project's own card).
// Each fragment wraps itself in lntv.<kind>.show (true only while the look is on; a sealed card is shown too, as the face-down back), so with the look off
// (the default) there is NO node in the page. dc-lite dialect only: dotted paths. Every value is one key under lntv, finished by vals/lantern.js from
// logic/lantern-art.mjs. Colours are tokens only (they come from the shapes, which carry var(--...) values).
// The picture is aria-hidden and the wrapper carries role="img" with the readout and the card name (or "Not read yet, card face down"), so a screen reader
// hears it once. The roman number and the bottom line are HTML laid over the card (SVG <text> cannot take a {{ }} binding); the look's own sheet sets their
// face, colour and case. data-lnt-face is "up" or "sealed": the sheet turns a card over when it goes from sealed to up (inside the motion guard).
// NO {{ }} may ever appear inside a <style> text: the runtime would turn it into a <span>.
const SIZE = {
  card: { w: 104, h: 173, roman: 13, read: 9, wrap: 'display:block;flex:0 0 auto;max-width:100%', box: 'left:6%;right:6%;top:81%;height:11%;white-space:nowrap' },
  project: { w: 72, h: 120, roman: 9, read: 6.5, wrap: 'display:block;float:right;margin:0 0 8px 14px', box: 'left:7%;right:7%;top:79%;height:15%;white-space:normal;line-height:1.05;text-align:center' },
};
const SVG = 'display:block;width:100%;height:100%;overflow:visible';
const TEXT = 'position:absolute;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none';

/** one card for `kind` (cleared | skills | notes | needyou | projects | project) */
export const lntArt = (kind) => {
  const z = kind === 'project' ? SIZE.project : SIZE.card;
  return String.raw`<sc-if value="{{ lntv.${kind}.show }}" hint-placeholder-val="{{ false }}"><span role="img" aria-label="{{ lntv.${kind}.aria }}" data-lnt="art-${kind}" data-lnt-face="{{ lntv.${kind}.face }}" style="position:relative;width:${z.w}px;height:${z.h}px;${z.wrap}"><svg viewBox="{{ lntv.${kind}.viewBox }}" aria-hidden="true" focusable="false" style="${SVG}"><sc-for list="{{ lntv.${kind}.shapes }}" as="p" hint-placeholder-count="6"><path d="{{ p.d }}" style="fill:{{ p.fill }};stroke:{{ p.stroke }};stroke-width:{{ p.sw }};stroke-linecap:{{ p.cap }}"></path></sc-for></svg><span data-lnt="roman" aria-hidden="true" style="${TEXT};left:0;right:0;top:6.5%;height:11%;font-size:${z.roman}px;line-height:1">{{ lntv.${kind}.roman }}</span><span data-lnt="readout" aria-hidden="true" style="${TEXT};${z.box};font-size:${z.read}px">{{ lntv.${kind}.label }}</span></span></sc-if>`;
};
