// NEXUS shell — renders the left sigil rail + topstrip chrome, owns realm
// switching (mount/unmount + rail active state), relabels on theme change,
// recomputes badges only on data events (charter: badge() is not a hot path).
import { bus } from './bus.js';
import { data } from './data.js';
import { LX } from './lexicon.js';
import { ordered, byId } from './registry.js';
import { applyTheme, currentTheme } from './themes.js';
import { el } from '../ui/util.js';

let activeId = null;

function ctx() {
  return { data, bus, LX, theme: currentTheme(), hq: window.hq };
}

export function switchRealm(id, force = false) {
  if (id === activeId && !force) return;
  const r = byId(id);
  if (!r || !r.manifest.enabled(data)) return;
  const stage = document.getElementById('stage');
  const prev = byId(activeId);
  if (prev) { try { prev.view.unmount(); } catch (err) { console.error('[shell] unmount', activeId, err); } }
  stage.innerHTML = '';
  activeId = id;
  try { sessionStorage.setItem('hq-active-realm', id); } catch {}   // survive win.reload()
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

export function refreshBadges() {
  for (const { manifest: m } of ordered()) {
    const b = document.querySelector(`#rail-left .sigil[data-realm="${m.id}"] .badge`);
    if (!b) continue;
    const v = m.badge(data);
    b.textContent = v == null ? '' : String(v);
    b.style.display = v == null ? 'none' : '';
  }
}

// Topstrip: v2's #topbar chrome verbatim — brand + status plate + SYS menu.
// Structure only (static markup, built once): chrome.js wires behavior and
// paints the live values; the ids are the contract between the two files.
function renderTopstrip() {
  const top = document.getElementById('topstrip');
  top.innerHTML = `
    <div class="brand">
      <div class="logo" aria-hidden="true">
        <!-- pixel monitor glyph -->
        <svg viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="1" y="2" width="14" height="10" fill="#1b1640"/><rect x="2" y="3" width="12" height="8" fill="#0c0a1e"/><rect x="3" y="4" width="6" height="2" fill="#00f0ff"/><rect x="3" y="7" width="9" height="1" fill="#ff2bd6"/><rect x="3" y="9" width="4" height="1" fill="#ffd23f"/><rect x="6" y="12" width="4" height="1" fill="#1b1640"/><rect x="4" y="13" width="8" height="1" fill="#1b1640"/></svg>
      </div>
      <div>
        <div class="title">WORKSPACE<span class="hq">HQ</span></div>
        <div class="subtitle" id="scan-date">—</div>
      </div>
    </div>

    <div class="player">
      <div class="level-chip"><small>LV</small><b id="level">–</b><small id="title-rank">—</small></div>
      <div class="xp">
        <div class="xp-row"><b id="xp-label">0 XP</b><span class="muted" id="xp-next">—</span></div>
        <div class="xp-bar"><div class="xp-fill" id="xp-fill"></div></div>
      </div>
      <div class="stat hp">
        <label><span id="hp-word">HP</span> <b id="health" class="hpnum">0</b></label>
        <div class="hp-bar" id="hp-bar"><div class="hp-fill" id="hp-fill"></div></div>
      </div>
      <div class="stat">
        <div class="flame" id="flame">
          <svg viewBox="0 0 16 16" shape-rendering="crispEdges" class="px-flame"><rect x="7" y="1" width="2" height="2" fill="#ffa502"/><rect x="6" y="3" width="4" height="2" fill="#ffa502"/><rect x="5" y="5" width="6" height="3" fill="#ff6348"/><rect x="4" y="8" width="8" height="4" fill="#ff4757"/><rect x="6" y="9" width="4" height="4" fill="#ffd23f"/><rect x="5" y="12" width="6" height="2" fill="#ff6348"/></svg>
          <b id="streak">0</b>
        </div>
        <label id="streak-word">STREAK</label>
      </div>
      <!-- One SYS menu instead of three sibling utility buttons: status stays glanceable,
           config lives one click away (accent-budget + declutter rule). -->
      <div class="theme-wrap">
        <button id="theme-btn" class="sfx theme-btn" title="Themes · card export · sound">◈ SYS</button>
        <div id="theme-menu" class="theme-menu" role="menu">
          <div class="th-group">THEME</div>
          <button data-theme="nexus" class="theme-opt"><span class="th-name">NEXUS</span><span class="th-hint">clean dark</span></button>
          <button data-theme="daylight" class="theme-opt"><span class="th-name">DAYLIGHT</span><span class="th-hint">clean light</span></button>
          <div class="th-group">TOOLS</div>
          <button id="share-card" class="theme-opt"><span class="th-name">◈ EXPORT CARD</span><span class="th-hint">shareable stat PNG</span></button>
          <button id="sfx-toggle" class="theme-opt"><span class="th-name">♪ OFF</span><span class="th-hint">chiptune sound effects</span></button>
        </div>
      </div>
    </div>`;
}

export function startShell(defaultRealm) {
  applyTheme(currentTheme());          // sets data-theme + lexicon before first paint
  renderTopstrip();
  renderRail();
  bus.on('theme:changed', () => {      // labels ride the theme; active realm re-mounts for LX
    renderRail();
    if (activeId) switchRealm(activeId, true);   // force: real unmount()→mount(), no leak
  });
  bus.on('data:select', () => refreshBadges());
  switchRealm(defaultRealm);
}
