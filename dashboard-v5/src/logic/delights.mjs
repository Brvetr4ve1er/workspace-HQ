// Small delights (batch 7, dish small-delights): an idle attract scene on the empty Brief, a monthly ornament beside the Home greeting (seasons.mjs)
// and one hidden room. All three live behind the Console layer's ONE master switch (consoleLayer.on): with the layer off nothing here arms, registers,
// draws or runs, and the cheat registry's 'backroom' code does not open the room either.
//
// This file is the pure half plus the Component.prototype mixin (src/app.js registers `delightsLogic` beside the other mixins):
//
//   attractOk(args)            PURE. true only when the layer is on, the empty-Brief card is visible, the page is visible, motion is allowed, the owner has
//                              been idle for the threshold (90 s), nothing is selected and no dialog, overlay, palette, Settings or text field is open or focused.
//                              A blocker given as anything but the exact good value (an unknown) blocks.
//   overlayOpen(S)             PURE. true while any overlay flag of app.js closeTop's list (plus the back room) is set.
//   isTextField(el)            PURE on a DOM-shaped object: input, textarea, select, contenteditable, role textbox / searchbox / combobox.
//   readDomEnv(doc, win)       reads the selection, the focused field, any [role=dialog], page visibility and whether the attract anchor is on screen.
//   reducedNow(S, win)         the reduce-motion pref OR the OS media query OR the root data-hq-reduce flag that setReduceFlag writes.
//   createAttract(deps)        the controller: arms only while the card is eligible; the input listeners and the ONE idle timer are registered through the
//                              layer's own layerOn / layerTimer (injected as deps.layer = { on, timer }), so detach() of the layer removes them and its
//                              probe counts them. A started loop counts toward the cap of 3 per visit to the card.
//   addFound(list, id)         the cheatsFound list with one more name (names only), the same list when it is already there.
//   delightsLogic              the mixin: dlxBind, dlxSync, dlxOpenRoom, dlxCloseRoom, dlxEscape, dlxCleanup (+ the test hooks _dlxClock, _dlxIdleMs, _dlxHold).
//
// WHY ONE CONTROLLER AND NO RAW BROWSER CALLS: the layer's contract is "zero cost when off, provable by a probe". A listener or timer made any other
// way would not be counted and would survive detach(). The source test in delights.test.mjs fails if this dish's files make one.
export const ATTRACT_IDLE_MS = 90000;
export const ATTRACT_LOOP_MS = 6000;
export const ATTRACT_MAX_LOOPS = 3;

/** [target, type] pairs the controller listens to while armed. 'window' / 'document' are resolved from deps. */
export const ATTRACT_INPUTS = Object.freeze([
  ['window', 'pointerdown'], ['window', 'pointermove'], ['window', 'mousedown'], ['window', 'mousemove'], ['window', 'keydown'],
  ['window', 'wheel'], ['window', 'touchstart'], ['window', 'touchmove'], ['document', 'visibilitychange'],
]);

// the overlay flags of app.js closeTop (levelUp .. pageMore) plus the back room itself
export const OVERLAY_FLAGS = Object.freeze(['levelUp', 'sheet', 'commit', 'confirm', 'onboard', 'vault', 'whatsNewOpen', 'cosReportOpen', 'cosIdx', 'cheatOpen',
  'settingsOpen', 'paletteOpen', 'cosLb', 'scrubOpen', 'moreOpen', 'runsOpen', 'askOpen', 'ambientOverlay', 'focus', 'pageMore', 'dlxRoom']);

export const ROOM_TITLE = 'Back room';
export const ROOM_NOTE = 'Nothing here needs you.';
export const ROOM_CODE = 'backroom';
export const ANCHOR_ATTR = 'data-dlx';
export const ANCHOR_VALUE = 'attract-anchor';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** The whole eligibility rule, pure. See the header. `thresholdMs` is the test hook for the idle clock; it never makes the rule looser than "idle >= threshold". */
export function attractOk(a) {
  if (!isObj(a)) return false;
  if (a.layerOn !== true || a.allClearVisible !== true || a.pageVisible !== true) return false;
  if (a.reduced !== false) return false;
  if (a.dialogOpen !== false) return false;
  if (typeof a.selectionText !== 'string' || a.selectionText.length > 0) return false;
  const need = Number.isFinite(a.thresholdMs) && a.thresholdMs > 0 ? a.thresholdMs : ATTRACT_IDLE_MS;
  return Number.isFinite(a.idleMs) && a.idleMs >= need;
}

/** true while any overlay flag is set (truthy). */
export function overlayOpen(S) {
  if (!isObj(S)) return false;
  for (const k of OVERLAY_FLAGS) if (S[k]) return true;
  return false;
}

const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image', 'hidden']);

/** A DOM-shaped element that takes typed text (or a choice by keyboard). */
export function isTextField(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !NON_TEXT_INPUT.has(String(el.type || 'text').toLowerCase());
  if (el.isContentEditable === true) return true;
  const ce = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
  if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/** What the page says right now. Every probe is optional: one that cannot answer reads as "blocked" (never as clear). */
export function readDomEnv(doc, win) {
  const out = { selectionText: '?', dialogOpen: true, pageVisible: false, anchorVisible: false };
  try {
    const sel = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
    out.selectionText = sel ? String(sel.toString()) : '?';   // no selection object to ask = unknown = blocked
  } catch { out.selectionText = '?'; }
  try {
    const dlg = doc && typeof doc.querySelector === 'function' ? doc.querySelector('[role="dialog"],[role="alertdialog"],[aria-modal="true"]') : null;
    out.dialogOpen = !!dlg || isTextField(doc && doc.activeElement);
  } catch { out.dialogOpen = true; }
  try { out.pageVisible = !!doc && doc.visibilityState === 'visible' && doc.hidden !== true; } catch { out.pageVisible = false; }
  try {
    const a = doc && typeof doc.querySelector === 'function' ? doc.querySelector('[' + ANCHOR_ATTR + '="' + ANCHOR_VALUE + '"]') : null;
    if (a && typeof a.getBoundingClientRect === 'function') {
      const r = a.getBoundingClientRect(), w = Number(win && win.innerWidth) || 0, h = Number(win && win.innerHeight) || 0;
      out.anchorVisible = r.top >= 0 && r.top <= h && r.left >= 0 && r.left <= w;
    }
  } catch { out.anchorVisible = false; }
  return out;
}

/** The reduce-motion pref, the OS media query and the root attribute: any one set means "no motion". An unreadable media query reads as reduced. */
export function reducedNow(S, win) {
  if (S && S.reduceMotion) return true;
  try {
    if (win && win.document && win.document.documentElement && win.document.documentElement.dataset && win.document.documentElement.dataset.hqReduce) return true;
    if (win && typeof win.matchMedia === 'function') return !!win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return true; }
  return false;
}

/** The cheatsFound list with `id` added (names only). The same array when it is already there, so a state patch can skip the write. */
export function addFound(list, id) {
  const cur = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  if (typeof id !== 'string' || !id || cur.includes(id)) return Array.isArray(list) ? list : cur;
  return cur.concat(id);
}

const noop = () => {};
const undoer = (r) => {
  if (typeof r === 'function') return r;
  if (r && typeof r === 'object') for (const k of ['off', 'cancel', 'clear', 'remove', 'dispose']) if (typeof r[k] === 'function') return () => r[k]();
  return noop;
};

/**
 * The idle attract controller. deps:
 *   layer     { on(target, type, fn) -> undo, timer(fn, ms) -> cancel }   the Console layer's layerOn / layerTimer (counted by its probe)
 *   win, doc  the page objects the input listeners are put on
 *   read()    -> { layerOn, allClearVisible, reduced, selectionText, dialogOpen, pageVisible }, asked only when the idle timer fires
 *   now()     -> ms          idleMs() -> the idle threshold (90 000 unless a test shortens it)         loopMs, maxLoops
 *   onChange({ running, loops })   told when the scene starts or stops
 * sync(cond) is told what the render knows: { layerOn, allClearVisible, reduced, pageVisible }. It arms (input listeners + ONE timer) only while all four
 * hold and the visit has loops left, and disarms (everything removed) the moment one stops holding. A visit ends when the card leaves the screen.
 */
export function createAttract(deps) {
  const layer = deps.layer || {}, win = deps.win, doc = deps.doc;
  const now = deps.now || (() => Date.now());
  const idleMs = deps.idleMs || (() => ATTRACT_IDLE_MS);
  const loopMs = deps.loopMs || ATTRACT_LOOP_MS, maxLoops = deps.maxLoops || ATTRACT_MAX_LOOPS;
  const tell = deps.onChange || noop;
  let armed = false, running = false, rested = false, loopsUsed = 0, lastInput = 0, runStart = 0, runLoops = 0;
  let offs = [], cancelTimer = noop, hasTimer = false, tgen = 0;

  const setTimer = (fn, ms) => { clearTimer(); const my = ++tgen; hasTimer = true; cancelTimer = undoer(layer.timer && layer.timer(() => { if (my !== tgen) return; hasTimer = false; fn(); }, ms)); };
  const clearTimer = () => { tgen++; hasTimer = false; try { cancelTimer(); } catch { /* the layer already dropped it */ } cancelTimer = noop; };
  const announce = () => { try { tell({ running, loops: runLoops }); } catch { /* a listener of ours never breaks the page */ } };

  function disarm() {
    clearTimer();
    for (const off of offs.splice(0)) { try { off(); } catch { /* already removed by the layer's own detach */ } }
    armed = false;
    if (running) { running = false; announce(); }
  }
  function rest() { disarm(); rested = true; announce(); }
  function wait() { setTimer(onTimer, Math.max(1, idleMs())); }
  function stopRun() {   // a started loop counts, even when it was cut short
    const played = Math.max(1, Math.min(runLoops, Math.ceil((now() - runStart) / loopMs)));
    loopsUsed += played; running = false; announce();
    if (loopsUsed >= maxLoops) rest(); else wait();
  }
  function onInput() {
    if (!armed) return;
    lastInput = now();
    if (running) stopRun();
  }
  function onVisibility() {
    if (!armed) return;
    lastInput = now();
    if (running) stopRun();
  }
  function onTimer() {
    if (!armed) return;
    if (running) { loopsUsed += runLoops; running = false; announce(); rest(); return; }   // the scene played to its end: rest until the card leaves
    const idle = now() - lastInput, need = Math.max(1, idleMs());
    if (idle < need) { setTimer(onTimer, need - idle); return; }
    let r = null;
    try { r = deps.read(); } catch { r = null; }
    if (!attractOk(Object.assign({}, r, { idleMs: idle, thresholdMs: need }))) { lastInput = now(); wait(); return; }   // blocked: ask again after another idle spell
    running = true; runStart = now(); runLoops = Math.max(1, maxLoops - loopsUsed);
    setTimer(onTimer, runLoops * loopMs);
    announce();
  }
  function arm() {
    armed = true; lastInput = now();
    for (const [which, type] of ATTRACT_INPUTS) {
      const target = which === 'window' ? win : doc;
      if (!target) continue;
      const handler = type === 'visibilitychange' ? onVisibility : onInput;
      offs.push(undoer(layer.on && layer.on(target, type, handler)));
    }
    wait();
  }

  return {
    sync(cond) {
      const c = cond || {};
      const eligible = c.layerOn === true && c.allClearVisible === true && c.reduced === false && c.pageVisible === true;
      if (!c.layerOn || !c.allClearVisible) { rested = false; loopsUsed = 0; }   // the visit is over: a new one starts when the card comes back
      if (eligible && !armed && !rested) arm();
      else if (!eligible && armed) disarm();
    },
    /** What the page-level probe would count from this controller. */
    status() { return { armed, running, rested, loopsUsed, listeners: offs.length, timers: hasTimer ? 1 : 0, loops: runLoops }; },
    destroy() { disarm(); rested = false; loopsUsed = 0; },
    // exposed for the tests: the handlers the layer was given
    _input: onInput, _visibility: onVisibility, _timer: onTimer,
  };
}

/** The component state this dish adds (app.js spreads it into the defaults; every reader also tolerates it missing). */
export function delightsInitState() { return { dlxRoom: false, dlxRun: false, dlxLoops: ATTRACT_MAX_LOOPS }; }

const layerIsOn = (S) => !!(S && S.consoleLayer && S.consoleLayer.on === true);

/** Component.prototype mixin. State: dlxRoom (the back room is open), dlxRun (the attract scene is playing), dlxLoops (loops left in this run). */
export const delightsLogic = {
  /** app.js passes the Console layer's { layerOn, layerTimer, isAttached } (the module's own exports; isAttached is optional) once at mount. */
  dlxBind(api) {
    this._dlxApi = api && typeof api.layerOn === 'function' && typeof api.layerTimer === 'function' ? api : null;
    if (!this._dlxApi && this._dlxCtl) { this._dlxCtl.destroy(); this._dlxCtl = null; }
  },
  /** The one injected clock (the seasonal ornament reads it). _dlxClock is the fake-clock hook of the gates. */
  dlxNowDate() { return new Date(typeof this._dlxClock === 'function' ? this._dlxClock() : Date.now()); },
  /** The idle clock in ms (_dlxMs is the unit tests' hook; the gates shorten the threshold instead and let real time pass). */
  dlxMs() { return typeof this._dlxMs === 'function' ? this._dlxMs() : Date.now(); },
  /** The idle threshold; _dlxIdleMs is the gates' shortening hook and can only make it shorter. */
  dlxIdleMs() { const t = this._dlxIdleMs; return Number.isFinite(t) && t > 0 && t < ATTRACT_IDLE_MS ? t : ATTRACT_IDLE_MS; },

  /** Called from the vals with what the render knows. Deferred to a microtask: never touches state or the layer while rendering. */
  dlxSync(cond) {
    this._dlxCond = cond;
    const S = this.state || {};
    // layer off and nothing of ours alive: no microtask, nothing to undo (the common case, so the off path costs one property read per render)
    if (!(cond && cond.layerOn) && !this._dlxCtl && !S.dlxRoom && !S.dlxRun) return;
    if (this._dlxHold || this._dlxPending) return;
    this._dlxPending = true;
    Promise.resolve().then(() => { this._dlxPending = false; this._dlxApply(this._dlxCond); });
  },
  _dlxApply(cond) {
    const S = this.state || {};
    const c = cond || { layerOn: false, allClearVisible: false };
    const win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null;
    if (!c.layerOn && S.dlxRoom) this.setState({ dlxRoom: false });   // the layer went off: the room closes with it
    if (!this._dlxApi || !win || !doc) { if (S.dlxRun) this.setState({ dlxRun: false }); return; }
    if (!this._dlxCtl) {
      this._dlxCtl = createAttract({
        // the layer's own calls: inputs are passive and captured (a handler that stops propagation cannot hide them), the idle clock is ONE-SHOT (layerTimer defaults to an interval)
        layer: { on: (t, ty, fn) => this._dlxApi.layerOn(t, ty, fn, { passive: true, capture: true }), timer: (fn, ms) => this._dlxApi.layerTimer(fn, ms, { once: true }) },
        win, doc, now: () => this.dlxMs(), idleMs: () => this.dlxIdleMs(),
        read: () => {
          const st = this.state || {}, d = readDomEnv(doc, win);
          return { layerOn: layerIsOn(st), allClearVisible: !!(this._dlxCond && this._dlxCond.allClearVisible) && d.anchorVisible, reduced: reducedNow(st, win),
            selectionText: d.selectionText, dialogOpen: overlayOpen(st) || d.dialogOpen, pageVisible: d.pageVisible };
        },
        onChange: ({ running, loops }) => this.setState((s) => (!!s.dlxRun === running && (!running || s.dlxLoops === loops) ? null : { dlxRun: running, dlxLoops: running ? loops : ATTRACT_MAX_LOOPS })),
      });
    }
    // the layer's own calls are no-ops while it is detached: a controller armed against a detached layer would hold listeners that were never registered
    const attached = typeof this._dlxApi.isAttached !== 'function' || this._dlxApi.isAttached() === true;
    this._dlxCtl.sync({ layerOn: !!c.layerOn && attached, allClearVisible: !!c.allClearVisible, reduced: reducedNow(S, win), pageVisible: doc.visibilityState === 'visible' });
  },

  /** The back room: the Memory card's empty slot and the typed code 'backroom' (cheats registry) both call this. Needs the layer on; records the name. */
  dlxOpenRoom() {
    if (!layerIsOn(this.state)) return false;
    this.setState((s) => ({ dlxRoom: true, cheatsFound: addFound(s.cheatsFound, ROOM_CODE) }));
    return true;
  },
  dlxCloseRoom() { this.setState((s) => (s.dlxRoom ? { dlxRoom: false } : null)); },
  /** closeTop() asks this first: true when the room was open and Escape closed it. */
  dlxEscape() {
    const S = this.state || {};
    if (!S.dlxRoom) return false;
    this.setState({ dlxRoom: false });
    return true;
  },
  /** unmount: the controller removes what it registered (the layer's own detach would too). */
  dlxCleanup() { if (this._dlxCtl) { this._dlxCtl.destroy(); this._dlxCtl = null; } },
};
