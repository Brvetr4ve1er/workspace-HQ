// NEXUS shell — renders the left sigil rail + topstrip chrome, owns realm
// switching (mount/unmount + rail active state), relabels on theme change,
// recomputes badges only on data events (charter: badge() is not a hot path).
import { bus } from './bus.js';
import { data } from './data.js';
import { LX } from './lexicon.js';
import { ordered, byId } from './registry.js';
import { THEMES, applyTheme, currentTheme } from './themes.js';
import { el, esc } from '../ui/util.js';

let activeId = null;

function ctx() {
  return { data, bus, LX, theme: currentTheme(), hq: window.hq };
}

export function switchRealm(id) {
  if (id === activeId) return;
  const r = byId(id);
  if (!r || !r.manifest.enabled(data)) return;
  const stage = document.getElementById('stage');
  const prev = byId(activeId);
  if (prev) { try { prev.view.unmount(); } catch (err) { console.error('[shell] unmount', activeId, err); } }
  stage.innerHTML = '';
  activeId = id;
  r.view.mount(stage, ctx());
  document.querySelectorAll('#rail-left .sigil').forEach((b) => b.classList.toggle('active', b.dataset.realm === id));
  bus.emit('realm:switched', { id });
}

function renderRail() {
  const rail = document.getElementById('rail-left');
  rail.innerHTML = '';
  for (const { manifest: m } of ordered()) {
    if (!m.enabled(data)) continue;
    const b = el('button', 'sigil', `<span class="glyph">${m.sigil}</span><span class="lbl">${LX(m.lexKey)}</span><span class="badge"></span>`);
    b.dataset.realm = m.id;
    b.title = LX(m.lexKey);
    b.onclick = () => switchRealm(m.id);
    b.classList.toggle('active', m.id === activeId);
    rail.appendChild(b);
  }
  refreshBadges();
}

function refreshBadges() {
  for (const { manifest: m } of ordered()) {
    const b = document.querySelector(`#rail-left .sigil[data-realm="${m.id}"] .badge`);
    if (!b) continue;
    const v = m.badge(data);
    b.textContent = v == null ? '' : String(v);
    b.style.display = v == null ? 'none' : '';
  }
}

// Topstrip: brand + a dev theme cycler. Placeholder chrome — the real Warden
// plate (LV · Runes · Vitality · Ember) and SYS menu land with the ports.
function renderTopstrip() {
  const top = document.getElementById('topstrip');
  top.innerHTML = '';
  top.appendChild(el('span', 'brand', 'WORKSPACE<span class="hq">HQ</span> · NEXUS'));
  const built = data.bundle.built_at ? esc(String(data.bundle.built_at).slice(0, 10)) : '—';
  top.appendChild(el('span', 'built', `data ${built} · ${data.scans.length} scans`));
  const themeBtn = el('button', 'theme-cycle', `◈ ${THEMES[currentTheme()]?.label || 'ARCADE'}`);
  themeBtn.title = 'Cycle theme (dev placeholder for the SYS menu)';
  themeBtn.onclick = () => {
    const ids = Object.keys(THEMES);
    const next = ids[(ids.indexOf(currentTheme()) + 1) % ids.length];
    applyTheme(next);
    themeBtn.innerHTML = `◈ ${THEMES[next].label}`;
  };
  top.appendChild(themeBtn);
}

export function startShell(defaultRealm) {
  applyTheme(currentTheme());          // sets data-theme + lexicon before first paint
  renderTopstrip();
  renderRail();
  bus.on('theme:changed', () => {      // labels ride the theme; active realm re-mounts for LX
    renderRail();
    const id = activeId; activeId = null;
    if (id) switchRealm(id);
  });
  bus.on('data:select', () => refreshBadges());
  switchRealm(defaultRealm);
}
