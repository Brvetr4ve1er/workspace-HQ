// FOCUS MODE — the full-screen "one thing" overlay, restored to v4.
//
// Ported from legacy/dashboard-v3/src/realms/roundtable/focus.js (the #onething
// overlay: full-screen, everything else dimmed, F enters, Esc exits, an
// elapsed clock, a DONE verb that writes through the bridge). Everything the
// v3 module did survives here; what changed is the DRESS and the SEAM:
//
//   DRESS  v3's card was a 3px cyan-bordered arcade panel with a glowing gold
//          timer. v4 holds the design constitution: one focal title at display
//          weight, a quiet reason, a neutral clock a step below, and NO border
//          on the panel — it separates from the app by dimming the world
//          behind it. Styles: legacy/dashboard-v4/styles/focus.css.
//   SEAM   v3 imported computeOneThing() from its host realm. This module is
//          CORE, so it takes an explicit item from whoever calls it and only
//          falls back to the app's own "do this now" (intel/derive oracle) for
//          the bare-F path. No surface owns focus; focus is a mode over the
//          whole app.
//
// PUBLIC API (the contract other agents wire against):
//   initFocus()            once at boot — installs THE global F/Esc listener
//                          and the bus seam. Idempotent.
//   ensureFocusOverlay()   builds the overlay DOM + links the sheet. Idempotent,
//                          returns the root element. initFocus() calls it.
//   enterFocus(item)       item = { title, reason?, projectName? } (+ optional
//                          questId / projectId / kind, which unlock the DONE
//                          verb). Missing or partial item never throws.
//   exitFocus()            leave. `exitFocus({ done: true })` marks the quest
//                          done on the way out where that is possible.
//   toggleFocus(item)      what the F key does.
//   teardownFocus()        full disposal — listener, bus subs, timer, DOM,
//                          injected sheet. Exported for completeness and for
//                          leak-checking harnesses; boot never calls it.
//
// BUS SEAM so nothing has to import this module to drive it:
//   in:  focus:toggle (v3 parity) · focus:enter (payload = item) · focus:exit
//   out: focus:entered { title } · focus:exited { resolved, minutes }
//
// LIFECYCLE: the overlay is built ONCE and reused — enter/exit only write
// textContent and flip `hidden`, so a thousand focus sessions add zero nodes
// and zero listeners. Every element handler is a property assignment on a node
// this module created. The one global listener and the three bus subscriptions
// are held in module state and released by teardownFocus().
//
// SAFETY: no data-derived string ever reaches innerHTML. The skeleton is static
// markup; every value from a scan/bridge goes in via textContent.
import { bus } from './bus.js';
import { data } from './data.js';
import { oracle } from '../intel/derive.mjs';

// STYLESHEET. index.html is not this agent's file, so the module links its own
// sheet (the same pattern home/, system/ and lookback/ use). Resolved from
// import.meta.url — not the document URL — so it is correct under the verify
// harnesses too. Tolerates a later static <link> in index.html.
const CSS_HREF = new URL('../../styles/focus.css', import.meta.url).href;
let injectedLink = null;

function ensureStyles() {
  if (document.querySelector('link[data-focus-css], link[href$="focus.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.setAttribute('data-focus-css', '');
  document.head.appendChild(link);
  injectedLink = link;   // only OUR link is removable — a static one is not ours to drop
}

let root = null;        // the overlay element (built once)
let els = null;         // cached child refs
let inited = false;     // initFocus() guard
let shown = false;      // is focus mode currently up
let ticker = null;      // the elapsed-clock interval
let startedAt = 0;      // performance.now() at enter
let current = null;     // the normalized item in focus
let restoreTo = null;   // element that had keyboard focus before we took it
let disposers = [];     // bus unsubscribes

// The calm state: focus was entered with nothing to point at. A sentence, not
// an error — the overlay still opens so the F key is never a silent no-op.
const EMPTY = {
  title: 'Nothing to focus on right now.',
  reason: 'Pick something on HOME or TASKS and press F, or press Esc to go back.',
};
const UNTITLED = 'Untitled task';

// Local copy of the exemplar's sentence normalizer. NOT imported from
// surfaces/home/oracle-logic.mjs: core must not depend on a surface, and that
// file belongs to the approved HOME screen. Idempotent on finished prose.
function sentence(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const head = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(head) ? head : head + '.';
}

const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

// Accept the documented { title, reason, projectName } AND the snake_case ids
// the scan model uses, so a caller can hand a raw quest/pick straight through.
function normalize(item) {
  const it = (item && typeof item === 'object') ? item : {};
  return {
    title: String(it.title ?? '').trim(),
    reason: sentence(it.reason),
    projectName: String(it.projectName ?? it.project_name ?? '').trim(),
    questId: it.questId ?? it.quest_id ?? null,
    projectId: it.projectId ?? it.project_id ?? null,
    kind: it.kind || ((it.questId ?? it.quest_id) ? 'quest' : 'focus'),
  };
}

// The bare-F path: focus whatever the app currently thinks is the one thing.
// The Oracle reads the present tense, so an older snapshot falls straight
// through to today's pick list rather than advising about a world that moved.
// Wrapped whole — a drifted scan must not turn a keystroke into a throw.
function defaultItem() {
  try {
    const S = data.selected;
    if (!S) return null;
    const named = (id) => (id ? (S.projects || []).find((p) => p.id === id)?.name || '' : '');
    if (data.isLatest) {
      const o = oracle(data.bundle, S, new Date().toISOString());
      if (o) return {
        title: o.label,
        reason: o.reason,
        projectName: named(o.target?.projectId),
        questId: o.target?.questId || null,
        projectId: o.target?.projectId || null,
        kind: o.action === 'quest' ? 'quest' : (o.action || 'focus'),
      };
    }
    const pick = (S.account?.daily_top3 || [])[0];
    if (pick) return {
      title: pick.label,
      reason: pick.reason,
      projectName: named(pick.project_id),
      questId: pick.quest_id || null,
      projectId: pick.project_id || null,
      kind: 'quest',
    };
  } catch (err) {
    console.warn('[focus] could not derive a default item', err);
  }
  return null;
}

// NO LYING CONTROLS: the DONE verb needs a quest id, a bridge that can write it,
// AND the live snapshot. Marking a quest done from an older photograph would
// write today's log from yesterday's belief (the same gate HOME's picks use).
function canMarkDone() {
  return !!(current && current.questId
    && typeof window.hq?.markQuestDone === 'function'
    && data.isLatest);
}

// -------------------------------------------------------------------- DOM
export function ensureFocusOverlay() {
  if (root) return root;
  ensureStyles();

  root = document.createElement('div');
  root.id = 'focus';
  root.className = 'focus';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Focus mode');
  // STATIC markup only — every data-derived string is written with textContent
  // below, so this innerHTML can never carry scan or bridge text.
  root.innerHTML = `
    <section class="focus-panel">
      <div class="focus-eyebrow">ONE THING</div>
      <h1 class="focus-title"></h1>
      <p class="focus-project" hidden></p>
      <p class="focus-reason" hidden></p>
      <div class="focus-elapsed">
        <span class="focus-clock">00:00</span>
        <span class="focus-clock-key">elapsed</span>
      </div>
      <div class="focus-act">
        <button class="btn btn--primary focus-go" type="button">Leave focus</button>
        <button class="focus-leave" type="button" hidden>Leave without finishing</button>
      </div>
      <p class="focus-hint">Press <b>Esc</b> to leave · <b>F</b> toggles focus</p>
    </section>`;

  els = {
    title: root.querySelector('.focus-title'),
    project: root.querySelector('.focus-project'),
    reason: root.querySelector('.focus-reason'),
    clock: root.querySelector('.focus-clock'),
    go: root.querySelector('.focus-go'),
    leave: root.querySelector('.focus-leave'),
  };
  // Re-checked at CLICK time, not at paint time, so the button can never
  // promise a write the bridge has since stopped being able to make.
  els.go.onclick = () => exitFocus({ done: canMarkDone() });
  els.leave.onclick = () => exitFocus();

  (document.getElementById('overlays') || document.body).appendChild(root);
  return root;
}

function paintClock() {
  if (els) els.clock.textContent = mmss(performance.now() - startedAt);
}

function paint() {
  const has = !!(current.title || current.reason || current.projectName);
  els.title.textContent = current.title || (has ? UNTITLED : EMPTY.title);

  els.project.textContent = current.projectName;
  els.project.hidden = !current.projectName;

  const reason = current.reason || (has ? '' : EMPTY.reason);
  els.reason.textContent = reason;
  els.reason.hidden = !reason;

  const done = canMarkDone();
  els.go.textContent = done ? 'Mark done and leave' : 'Leave focus';
  els.go.title = done
    ? 'Marks this quest complete, then leaves focus mode.'
    : 'Leaves focus mode. Nothing is written.';
  els.leave.hidden = !done;   // only meaningful when the primary verb DOES something else
}

// ------------------------------------------------------------------ enter
export function enterFocus(item) {
  ensureFocusOverlay();

  // No argument at all = the bare-F path: focus the app's current one thing.
  // A PARTIAL object is honoured exactly as given — showing what it has beats
  // silently substituting a different task behind the user's back.
  const src = (item && typeof item === 'object') ? item : (defaultItem() || {});
  current = normalize(src);
  paint();

  startedAt = performance.now();
  paintClock();
  clearInterval(ticker);
  ticker = setInterval(paintClock, 1000);

  if (!shown) {
    restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add('focus-mode');
    // The CSS dims the app and kills its pointer events, but a filter cannot
    // stop TAB from walking into the rail behind the overlay and Enter from
    // switching surfaces underneath it. `inert` closes that hole for real —
    // focus mode is modal, so the world behind is not just dark, it is gone.
    document.getElementById('v4')?.setAttribute('inert', '');
    root.hidden = false;
    shown = true;
  }
  try { els.go.focus({ preventScroll: true }); } catch { /* detached / no focus support */ }

  bus.emit('focus:entered', { title: current.title });
  console.log(`FOCUS enter title=${JSON.stringify(current.title)} done=${canMarkDone() ? 'yes' : 'no'}`);
  return root;
}

// ------------------------------------------------------------------- exit
// `opts` may be omitted, `{ done: true }`, or bare `true` (v3 call shape). An
// Event object lands here whenever someone wires this straight to a handler —
// it has no `.done`, so it correctly reads as "leave without finishing".
export function exitFocus(opts) {
  if (!root || !shown) return;
  const done = opts === true || !!(opts && typeof opts === 'object' && opts.done === true);
  const minutes = Math.round((performance.now() - startedAt) / 60000);
  const it = current;

  clearInterval(ticker);
  ticker = null;
  shown = false;
  current = null;
  document.body.classList.remove('focus-mode');
  root.hidden = true;
  // BEFORE restoring focus — an inert subtree refuses focus(), so the order
  // here is what makes the restore actually land.
  document.getElementById('v4')?.removeAttribute('inert');

  const back = restoreTo;
  restoreTo = null;
  if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch { /* gone */ } }

  // Bridge writes last, and each one guarded: the dev harness has no window.hq
  // at all, and a throwing bridge must not strand the overlay open.
  const hq = window.hq;
  if (done && it?.questId && typeof hq?.markQuestDone === 'function') {
    try { hq.markQuestDone(it.questId); } catch (err) { console.error('[focus] markQuestDone', err); }
  }
  if (typeof hq?.actedOn === 'function') {
    try {
      hq.actedOn({
        at: new Date().toISOString(),
        kind: it?.kind || 'focus',
        action_id: it?.questId || null,
        project_id: it?.projectId || null,
        minutes,                       // v3 field name — the sidecar reader expects `minutes`
        resolved: !!done,
        via: 'focus',
      });
    } catch (err) { console.error('[focus] actedOn', err); }
  }

  bus.emit('focus:exited', { resolved: !!done, minutes });
  console.log(`FOCUS exit resolved=${!!done} minutes=${minutes}`);
}

export function toggleFocus(item) {
  if (shown) exitFocus(); else enterFocus(item);
}

export function isFocused() { return shown; }

// -------------------------------------------------------------- keyboard
const isTyping = (t) => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
  || t.tagName === 'SELECT' || t.isContentEditable));

// ONE window listener for the app's lifetime, registered in the CAPTURE phase.
// Capture on window is the FIRST stop in the event path, which is what makes
// focus mode properly modal: while the overlay is up, Escape belongs to focus
// and is stopped there, so it cannot also close a TASKS/PROJECTS drawer
// sitting inert behind the dim (those surfaces listen on `document`, which
// capture beats). While focus is DOWN this handler stops nothing and every
// surface keeps its own Escape.
//
// The command palette still wins when it is open over focus: its input holds
// keyboard focus, so `isTyping` bails out before we stop anything and the
// palette's own bubble-phase listener gets the key. `defaultPrevented` is kept
// as a cheap guard against any earlier capture-phase listener.
function onKey(e) {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (shown && !isTyping(e.target)) { e.preventDefault(); e.stopPropagation(); exitFocus(); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (isTyping(e.target)) return;   // "f" belongs to the field being typed into
    e.preventDefault();
    toggleFocus();
  }
}

export function initFocus() {
  if (inited) return;   // idempotent — the selftest re-runs boot logic
  inited = true;
  ensureFocusOverlay();
  window.addEventListener('keydown', onKey, true);
  // Payloads are whatever the emitter sent; enterFocus normalizes and never
  // throws on a malformed one, and bus.emit already isolates handler errors.
  disposers.push(bus.on('focus:toggle', (item) => toggleFocus(item)));
  disposers.push(bus.on('focus:enter', (item) => enterFocus(item)));
  disposers.push(bus.on('focus:exit', () => exitFocus()));
  // Scrubbing to another snapshot while focused changes whether the DONE verb
  // is allowed to write (canMarkDone() gates on data.isLatest), so the button
  // is repainted rather than left advertising a write it would no longer make.
  disposers.push(bus.on('data:select', () => { if (shown && current) paint(); }));
}

// Full disposal. Unlike a surface stylesheet (kept, because dropping it per
// surface switch would flash the app unstyled), the injected sheet IS removed
// here — teardown means gone, and a re-init re-injects it. A static <link> in
// index.html is never ours and is left alone.
export function teardownFocus() {
  if (shown) exitFocus();
  window.removeEventListener('keydown', onKey, true);   // capture flag must match the add
  document.getElementById('v4')?.removeAttribute('inert');
  for (const off of disposers.splice(0)) { try { off(); } catch (err) { console.error('[focus] teardown', err); } }
  clearInterval(ticker);
  ticker = null;
  if (root) root.remove();
  if (injectedLink) { injectedLink.remove(); injectedLink = null; }
  root = null; els = null; current = null; restoreTo = null;
  inited = false; shown = false;
}
