// One-Thing FOCUS mode — port of v2 app.js "One-Thing Mode" + the #onething
// markup v2's index.html pre-seeded (v3 creates it lazily under #overlays).
// GLOBAL MODE: the overlay, its keydown listener, its 'focus:toggle' bus
// subscription, and the running timer all survive realm switches on purpose —
// focus is a mode over the whole app, not roundtable state. ensureFocusOverlay()
// wires once and nothing here unmounts. Styles live in chrome.css (#onething/.ot-*).
import { bus } from '../../core/bus.js';
import { data } from '../../core/data.js';
import { sfx } from '../../ui/components.js';
import { computeOneThing } from './one-thing.js';

const $ = (id) => document.getElementById(id);

let wired = false;
let otTimer = null, otStart = 0, otQid = null, otKind = null, otProj = null;

// Accept either an Action (from computeOneThing) or a raw quest object (legacy callers).
const toAction = (x) => !x ? null : (x.kind ? x
  : { kind: 'quest', id: x.id, title: x.title, project_id: x.project_id || null, project_name: null, quest: x });

export function ensureFocusOverlay() {
  if (wired) return;
  wired = true;
  const ot = document.createElement('div');
  ot.id = 'onething';
  ot.setAttribute('aria-hidden', 'true');
  ot.innerHTML = `<div class="ot-card">
      <div class="ot-eyebrow">ONE THING · everything else can wait</div>
      <div class="ot-quest" id="ot-quest">—</div>
      <div class="ot-proj" id="ot-proj"></div>
      <div class="ot-timer" id="ot-timer">00:00</div>
      <button class="ot-exit" id="ot-exit">✓ DONE — exit focus</button>
      <div class="ot-hint">press <b>F</b> to toggle · Esc to leave</div>
    </div>`;
  (document.getElementById('overlays') || document.body).appendChild(ot);
  ot.querySelector('#ot-exit').onclick = () => exitOneThing(true);
  bus.on('focus:toggle', toggleOneThing);        // chrome's FOCUS chip toggles via the bus, no import
  document.addEventListener('keydown', onKey);
}

export function toggleOneThing() {
  const ot = $('onething'); if (!ot) return;
  ot.classList.contains('show') ? exitOneThing(false) : enterOneThing();
}

// v2-verbatim guards: inputs eat keys; F must be bare of ctrl/meta/alt.
// Escape here only leaves focus — drawer Escape belongs to the chrome port.
function onKey(e) {
  if (e.target.tagName === 'INPUT') return;
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleOneThing(); return; }
  if (e.key === 'Escape') exitOneThing(false);
}

export function enterOneThing(input) {
  ensureFocusOverlay();   // idempotent — callers may import this before any roundtable mount
  const S = data.selected;
  const act = toAction(input) || (typeof computeOneThing === 'function' ? computeOneThing(S) : null);
  if (!act) return;
  const projName = act.project_name || (S?.projects || []).find((p) => p.id === act.project_id)?.name || '';
  $('ot-quest').textContent = act.title;
  $('ot-proj').textContent = projName ? '↳ ' + projName : '';
  otQid = act.id; otKind = act.kind; otProj = act.project_id || null; otStart = performance.now();
  const tick = () => { const s = Math.floor((performance.now() - otStart) / 1000); $('ot-timer').textContent = String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  tick(); clearInterval(otTimer); otTimer = setInterval(tick, 1000);
  document.body.classList.add('focus-mode');
  const ot = $('onething'); ot.classList.add('show'); ot.setAttribute('aria-hidden', 'false');
  sfx('blip');
}

export function exitOneThing(done) {
  const ot = $('onething'); if (!ot || !ot.classList.contains('show')) return;
  const mins = Math.round((performance.now() - otStart) / 60000);
  clearInterval(otTimer); otTimer = null;
  document.body.classList.remove('focus-mode'); ot.classList.remove('show'); ot.setAttribute('aria-hidden', 'true');
  if (done && window.hq?.markQuestDone && otKind === 'quest' && otQid) { sfx('coin'); window.hq.markQuestDone(otQid); }
  if (window.hq?.actedOn) {
    // `mins` is the existing local (const mins = Math.round(...)). Do NOT rename to `minutes`.
    window.hq.actedOn({ at: new Date().toISOString(), kind: otKind, action_id: otQid, project_id: otProj, minutes: mins, resolved: !!done, via: 'focus' });
  }
  otQid = null; otKind = null; otProj = null;
}
