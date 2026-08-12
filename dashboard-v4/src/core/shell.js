// v4 shell — renders the 6-surface rail + topstrip chrome, owns surface
// switching (mount/unmount + rail active state). Adapted from v3's shell.js
// MINUS themes, lexicon, badges, and enabled-gating: v4 is one theme, plain
// labels, and all six surfaces always exist (design: "One theme. No lexicon.
// Plain copy.").
//
// Surface interface: { id, label, glyph, view: { mount(el, ctx), unmount() } }.
import { bus } from './bus.js';
import { data } from './data.js';
import { el, esc } from '../ui/util.js';

let registry = [];
let activeId = null;

function ctx() {
  return { data, bus, hq: window.hq };
}

export function surfaces() {
  return registry;
}

export function switchSurface(id, force = false) {
  if (id === activeId && !force) return;
  const next = registry.find((s) => s.id === id);
  if (!next) return;
  const stage = document.getElementById('stage');
  const prev = registry.find((s) => s.id === activeId);
  if (prev) { try { prev.view.unmount(); } catch (err) { console.error('[shell] unmount', activeId, err); } }
  stage.innerHTML = '';
  activeId = id;
  try { sessionStorage.setItem('hq-v4-surface', id); } catch {}   // survive win.reload()
  next.view.mount(stage, ctx());
  document.querySelectorAll('#rail .rail-btn').forEach((b) => {
    const on = b.dataset.surface === id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  bus.emit('surface:switched', { id });
}

function renderRail() {
  const rail = document.getElementById('rail');
  rail.innerHTML = '';
  for (const s of registry) {
    // glyph is decorative (the .lbl carries the name) — hidden from AT so the
    // button reads as its surface label, not "<glyph> LABEL".
    const b = el('button', 'rail-btn', `<span class="glyph" aria-hidden="true">${esc(s.glyph)}</span><span class="lbl">${esc(s.label)}</span>`);
    b.dataset.surface = s.id;
    b.title = s.label;
    b.onclick = () => switchSurface(s.id);
    const on = s.id === activeId;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    rail.appendChild(b);
  }
}

// Topstrip: brand + snapshot stamp. The stamp says "snapshot" explicitly —
// the scan is a nightly photograph, and v4 never lets it masquerade as live.
function renderTopstrip() {
  const top = document.getElementById('topstrip');
  const scanId = data.selected?.scan?.id;
  top.innerHTML = `
    <div class="brand">WORKSPACE<span class="hq">HQ</span> v4</div>
    <div class="snapshot">${scanId ? `snapshot ${esc(scanId)}` : 'no scan data'}</div>`;
}

export function startShell(surfaceList, defaultId) {
  registry = surfaceList;
  renderTopstrip();
  renderRail();
  bus.on('data:select', () => renderTopstrip());   // scrubbing changes the snapshot stamp
  switchSurface(defaultId);
}
