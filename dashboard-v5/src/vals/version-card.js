// "New version inserted" card: render values. The vcd* keys ride under ONE top-level key, vcdv (renderVals sits near its 1015 ceiling).
//
// renderVals runs every surface on every push, so this returns one of TWO frozen constants and builds nothing per render: OFF (the usual
// case: no node in the page) or SHOWN. SHOWN needs all of: the card was started (state.vcShow, set by logic/version-card.mjs), the Console layer
// is ON, reduce motion is OFF (the app's pref or the OS setting), and no dialog/overlay is open. A card that is started and then loses one of those
// (the layer switched off, a dialog opened over it) simply stops showing; the machine's own 1.2 s timer, or its stop(), ends the rest. When it is
// not shown the animation strings are empty: nothing in the page animates.
import { VC_CAPTION, VC_MS, cartridgePaths, cardStyle, cartStyle, overlayOpenOf, reducedNow } from '../logic/version-card.mjs';
import { BUILD_STAMP } from '../live/build-stamp.mjs';

const P = cartridgePaths();
const SHARED = { vcdCaption: VC_CAPTION, vcdStamp: BUILD_STAMP, vcdLabel: VC_CAPTION + ', ' + BUILD_STAMP, vcdMs: VC_MS, vcdShell: P.shell, vcdLabelPath: P.label, vcdRidges: P.ridges, vcdContacts: P.contacts, vcdSlotPlate: P.slotPlate, vcdSlotMouth: P.slotMouth };

export const VCD_OFF = Object.freeze(Object.assign({}, SHARED, { vcdShow: false, vcdCardStyle: '', vcdCartStyle: '' }));
export const VCD_SHOWN = Object.freeze(Object.assign({}, SHARED, { vcdShow: true, vcdCardStyle: cardStyle(), vcdCartStyle: cartStyle() }));

function vcdFlat(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!S.vcShow) return VCD_OFF;                                     // the usual case, and the cheapest
  const L = S.consoleLayer;
  if (!(L && L.on === true)) return VCD_OFF;                         // layer off: never a node
  if (reducedNow(S)) return VCD_OFF;                                 // reduce motion: no card (the machine records the stamp)
  if (overlayOpenOf(S)) return VCD_OFF;                              // never on top of What's-new or any open dialog
  return VCD_SHOWN;
}

/** ONE top-level key (vcdv); the template reads {{ vcdv.vcdShow }} etc. */
export function versionCardVals(ctx) {
  return { vcdv: vcdFlat.call(this, ctx) };
}
