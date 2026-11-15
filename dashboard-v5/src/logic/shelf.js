// Projects > Shelf, renderer side (batch 7, dish "cartridge-shelf"): the two things the Shelf does to state. It reads nothing and
// writes nothing outside the renderer: the chosen view is the persisted sub-flag consoleLayer.shelf (the pref object is owned by
// dish "console-skin": the normaliser in logic/console-layer.mjs, the persistence in app.js), and "Show more" is session state.
// Component.prototype mixin (src/app.js): same `this` as the class methods. No listener, no timer, no frame: the layer rule.
//
//   shelfSet(on)           choose Shelf (true) or List (false); does nothing while the Console layer is off
//   shelfMore(key, pages)  show one more page of cartridges for the filters `key` names (logic/shelf.mjs shelfKey)
// State: shelfMore = { key, pages } | undefined. A different sort, search or status chip makes the remembered key stale, so the page
// count starts again at 1 without anyone having to reset it (shelfPages).
import { shelfFlags } from './shelf.mjs';

export const shelfLogic = {
  shelfSet(on) {
    if (!shelfFlags((this.state || {}).consoleLayer).on) return;
    this.setState((s) => ({ consoleLayer: Object.assign({}, s.consoleLayer, { shelf: on === true }) }));
  },
  shelfMore(key, pages) {
    const have = Number.isInteger(pages) && pages >= 1 ? pages : 1;
    this.setState({ shelfMore: { key: String(key == null ? '' : key), pages: Math.min(have + 1, 1000) } });
  },
};
