/* snip-overlay.js — the per-display snip overlay (v5 clean pass S3; was an inline script).
 *
 * Flow: main freezes every display and opens one transparent overlay per display
 * (screen-capture.js snipArm). Drag a rectangle → the post-capture bar appears:
 *   save (S)  — file + thumbnail
 *   copy (C)  — clipboard only, no file
 *   ✦ send to claude — pick a project; main saves the file, then opens an interactive Claude
 *                      terminal in that project with the screenshot's absolute path in the prompt
 *   esc       — cancel
 *   Enter     — save + copy (the pre-v5 behaviour; snip-commit with no action)
 * Without a selection: Space = full display, Enter = full display (save + copy), Esc = cancel.
 * Commits go to main as hq.studio.snipCommit({displayId, rectDIP, mode, action?, projectId?}).
 * Project names come from main (snip-frozen `projects`, {id, name} only) and are written with
 * textContent; an empty list disables send-to-Claude and says why.
 */
'use strict';

(function () {
  const studio = (window.hq && window.hq.studio) || null;

  // ---- surface handles --------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const frozen     = $('frozen');
  const scrim      = $('scrim');
  const frame      = $('selection-frame');
  const chip       = $('dim-chip');
  const flash      = $('flash');
  const hudDisp    = $('hud-display');
  const hudKind    = $('hud-kind');
  const bar        = $('bar');
  const btnSave    = $('btnSave');
  const btnCopy    = $('btnCopy');
  const btnClaude  = $('btnClaude');
  const btnEsc     = $('btnEsc');
  const picker     = $('picker');
  const pickerList = $('pickerList');

  // ---- state ------------------------------------------------------------
  // Query params from main's loadFile({query:{displayId, kind}}) arrive BEFORE onSnipFrozen,
  // so the HUD can label itself even if the freeze push is a beat late.
  const params    = new URLSearchParams(location.search);
  const qDisplay  = params.get('displayId') || '';
  const qKind     = params.get('kind') || 'region';
  let kind        = (qKind === 'full' || qKind === 'window') ? qKind : 'region';
  let displayId   = qDisplay;             // set again from onSnipFrozen
  let displayIndex = null;                // 0-based; badge shows +1
  let committed   = false;                // ignore repeat Enter/mouseup
  let dragging    = false;
  let start       = null;                 // {x, y} in CSS px (DIP)
  let current     = null;                 // {x, y, w, h} in CSS px (DIP)
  let selection   = null;                 // the rect the bar acts on, once the drag ended
  let projects    = [];                   // [{id, name}] from main
  const lastMouse = { x: 0, y: 0 };

  document.body.setAttribute('data-kind', kind);
  hudKind.textContent = kind;
  if (qDisplay) hudDisp.textContent = 'display ' + qDisplay;

  // ---- geometry helpers ---------------------------------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Clip a rectangular hole out of the scrim so the region beneath shines through.
  function paintHole(rect) {
    if (!rect || rect.w < 1 || rect.h < 1) { clearHole(); return; }
    const W = window.innerWidth, H = window.innerHeight;
    const x1 = clamp(rect.x, 0, W), y1 = clamp(rect.y, 0, H);
    const x2 = clamp(rect.x + rect.w, 0, W), y2 = clamp(rect.y + rect.h, 0, H);
    // Outer ring CW, inner rect CCW → evenodd punches the inner out.
    scrim.style.clipPath =
      `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ` +
      `${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
  }
  function clearHole() { scrim.style.clipPath = ''; }

  function showFrame(rect) {
    if (!rect || rect.w < 1 || rect.h < 1) { frame.style.display = 'none'; return; }
    frame.style.display = 'block';
    frame.style.left   = rect.x + 'px';
    frame.style.top    = rect.y + 'px';
    frame.style.width  = rect.w + 'px';
    frame.style.height = rect.h + 'px';
  }
  function hideFrame() { frame.style.display = 'none'; }

  function setChipText(rect) {
    // DIP, so the user sees the size main crops at (it scales by the display factor).
    chip.firstElementChild.textContent = String(Math.max(0, Math.round(rect.w)));
    chip.lastElementChild.textContent  = String(Math.max(0, Math.round(rect.h)));
  }

  // While dragging: a small boxed readout near the cursor, kept on-screen.
  function chipAtCursor(rect, mouseX, mouseY) {
    if (!rect) { hideChip(); return; }
    setChipText(rect);
    chip.classList.add('dragging');
    chip.style.display = 'inline-block';
    const cw = chip.offsetWidth || 96, ch = chip.offsetHeight || 22, PAD = 14;
    const W = window.innerWidth, H = window.innerHeight;
    let cx = mouseX + PAD, cy = mouseY + PAD;
    if (cx + cw > W - 4) cx = mouseX - cw - PAD;
    if (cy + ch > H - 4) cy = mouseY - ch - PAD;
    chip.style.left = clamp(cx, 4, W - cw - 4) + 'px';
    chip.style.top  = clamp(cy, 4, H - ch - 4) + 'px';
  }
  // After the drag: "W × H" just above the selection's top-left (inside it when there's no room).
  function chipAboveSelection(rect, inside) {
    setChipText(rect);
    chip.classList.remove('dragging');
    chip.style.display = 'inline-block';
    const ch = chip.offsetHeight || 16;
    const W = window.innerWidth;
    const above = !inside && rect.y >= ch + 8;
    chip.style.left = clamp(rect.x, 4, W - (chip.offsetWidth || 80) - 4) + 'px';
    chip.style.top  = (above ? rect.y - ch - 6 : rect.y + 6) + 'px';
  }
  function hideChip() { chip.style.display = 'none'; }

  function rectFrom(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  // ---- the post-capture bar ------------------------------------------------
  function renderClaudeButton() {
    const can = projects.length > 0 && !!studio;
    btnClaude.disabled = !can;
    btnClaude.title = can
      ? 'Save, then open Claude in a project with this screenshot\'s path'
      : 'Send to Claude needs a project — main sent none (not wired in this build, or no projects scanned)';
  }

  // Bar below the selection; above it when there's no room; inside its bottom edge otherwise.
  function showBar(rect) {
    selection = rect;
    closePicker();
    bar.hidden = false;
    document.body.classList.add('has-bar');
    renderClaudeButton();
    const W = window.innerWidth, H = window.innerHeight;
    const bw = bar.offsetWidth, bh = bar.offsetHeight, GAP = 10;
    let y = rect.y + rect.h + GAP, inside = false;
    if (y + bh > H - 8) {
      if (rect.y - bh - GAP >= 8) { y = rect.y - bh - GAP; inside = true; }   // the label moves inside
      else { y = rect.y + rect.h - bh - GAP; }
    }
    bar.style.left = clamp(rect.x, 8, Math.max(8, W - bw - 8)) + 'px';
    bar.style.top  = clamp(y, 8, Math.max(8, H - bh - 8)) + 'px';
    chipAboveSelection(rect, inside);
    try { btnSave.focus({ preventScroll: true }); } catch { /* fine */ }
  }

  function hideBar() {
    bar.hidden = true;
    closePicker();
    document.body.classList.remove('has-bar');
    selection = null;
  }

  function pickerOpen() { return !picker.hidden; }

  function openPicker() {
    if (btnClaude.disabled || !selection) return;
    while (pickerList.firstChild) pickerList.removeChild(pickerList.firstChild);
    for (const p of projects) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item';
      item.setAttribute('role', 'menuitem');
      item.textContent = String(p.name || p.id);
      item.title = String(p.name || p.id);
      item.addEventListener('click', () => commit('region', selection, 'claude', p.id));
      pickerList.appendChild(item);
    }
    picker.hidden = false;
    btnClaude.setAttribute('aria-expanded', 'true');
    // Above the bar when it fits, else below it; left-aligned with the claude button.
    const W = window.innerWidth, H = window.innerHeight;
    const br = bar.getBoundingClientRect(), cr = btnClaude.getBoundingClientRect();
    const pw = picker.offsetWidth, ph = picker.offsetHeight;
    let y = br.top - ph - 6;
    if (y < 8) y = br.bottom + 6;
    picker.style.left = clamp(cr.left, 8, Math.max(8, W - pw - 8)) + 'px';
    picker.style.top  = clamp(y, 8, Math.max(8, H - ph - 8)) + 'px';
    const first = pickerList.querySelector('.item');
    if (first) { try { first.focus({ preventScroll: true }); } catch { /* fine */ } }
  }

  function closePicker() {
    picker.hidden = true;
    btnClaude.setAttribute('aria-expanded', 'false');
  }

  function movePickerFocus(delta) {
    const items = Array.from(pickerList.querySelectorAll('.item'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[(i + delta + items.length) % items.length];
    try { next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest' }); } catch { /* fine */ }
  }

  // ---- commit / cancel -------------------------------------------------------
  // action: undefined (save + copy) | 'save' | 'copy' | 'claude' (with projectId).
  function commit(mode, rect, action, projectId) {
    if (committed) return;
    committed = true;
    flash.classList.add('on');   // shutter cue on THIS screen, even if main closes us at once
    const payload = {
      displayId,
      rectDIP: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
      mode,
    };
    if (action) payload.action = action;
    if (action === 'claude' && projectId) payload.projectId = projectId;
    // One frame for the flash to paint before main tears the window down.
    requestAnimationFrame(() => {
      try {
        if (studio && typeof studio.snipCommit === 'function') studio.snipCommit(payload);
        else console.error('[snip-overlay] hq.studio.snipCommit not exposed');
      } catch (e) {
        console.error('[snip-overlay] commit failed:', e && e.message);
      }
    });
  }

  function cancel() {
    if (committed) return;
    committed = true;
    try {
      if (studio && typeof studio.snipCancel === 'function') studio.snipCancel();
      else console.error('[snip-overlay] hq.studio.snipCancel not exposed');
    } catch (e) {
      console.error('[snip-overlay] cancel failed:', e && e.message);
    }
  }

  // ---- freeze subscription -----------------------------------------------
  // Main pushes {displayId, pngDataUrl, bounds, scaleFactor, kind, displayIndex, projects} once
  // the overlay is ready-to-show. Its data is authoritative; the query params were a hint.
  let unsubFreeze = null;
  try {
    if (studio && typeof studio.onSnipFrozen === 'function') {
      unsubFreeze = studio.onSnipFrozen((data) => {
        if (!data) return;
        if (data.pngDataUrl) frozen.src = data.pngDataUrl;
        if (data.displayId != null) displayId = data.displayId;
        if (Number.isInteger(data.displayIndex)) displayIndex = data.displayIndex;
        if (Array.isArray(data.projects)) {
          projects = data.projects
            .filter((p) => p && typeof p.id === 'string' && p.id)
            .map((p) => ({ id: p.id, name: typeof p.name === 'string' && p.name ? p.name : p.id }));
          renderClaudeButton();
        }
        if (data.kind === 'full' || data.kind === 'window' || data.kind === 'region') {
          kind = data.kind;
          document.body.setAttribute('data-kind', kind);
          hudKind.textContent = kind;
        }
        const label = (displayIndex != null ? (displayIndex + 1) : '') ||
          (displayId != null ? String(displayId).slice(0, 6) : '');
        hudDisp.textContent = 'display ' + (label || '—');
        // 'full' kind: snap the whole display and get out of the way (save + copy).
        if (kind === 'full') requestAnimationFrame(() => commit('full', null));
      });
    }
  } catch (e) {
    console.error('[snip-overlay] onSnipFrozen wire failed:', e && e.message);
  }
  window.addEventListener('beforeunload', () => {
    try { if (typeof unsubFreeze === 'function') unsubFreeze(); } catch { /* ignore */ }
  });
  renderClaudeButton();

  // ---- bar buttons -----------------------------------------------------------
  btnSave.addEventListener('click', () => { if (selection) commit('region', selection, 'save'); });
  btnCopy.addEventListener('click', () => { if (selection) commit('region', selection, 'copy'); });
  btnClaude.addEventListener('click', () => { if (pickerOpen()) closePicker(); else openPicker(); });
  btnEsc.addEventListener('click', () => cancel());

  // ---- pointer handling -------------------------------------------------
  // CSS pixels aligned to this overlay's origin (= the display's bounds.{x,y}), so the space is
  // always 0..W × 0..H; main scales by scaleFactor and receives DIP.
  const onUi = (t) => !!(t && t.closest && t.closest('#bar, #picker'));

  window.addEventListener('mousedown', (e) => {
    if (committed || e.button !== 0 || onUi(e.target)) return;
    // A fresh drag replaces any pending selection.
    hideBar();
    dragging = true;
    start = { x: e.clientX, y: e.clientY };
    current = { x: start.x, y: start.y, w: 0, h: 0 };
    clearHole();
    hideFrame();
    hideChip();
  });

  window.addEventListener('mousemove', (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    if (!dragging || committed) return;
    current = rectFrom(start, { x: e.clientX, y: e.clientY });
    paintHole(current);
    showFrame(current);
    chipAtCursor(current, e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragging || committed) return;
    dragging = false;
    current = rectFrom(start, { x: e.clientX, y: e.clientY });
    // A click without a drag is a cancel — better than a 0×0 image or a surprise box.
    if (current.w < 3 || current.h < 3) {
      clearHole(); hideFrame(); hideChip();
      cancel();
      return;
    }
    paintHole(current);
    showFrame(current);
    showBar(current);
  });

  // ---- keyboard ---------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (committed) return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (pickerOpen()) { closePicker(); try { btnClaude.focus({ preventScroll: true }); } catch { /* fine */ } return; }
      cancel();
      return;
    }
    if (pickerOpen()) {
      if (k === 'ArrowDown') { e.preventDefault(); movePickerFocus(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); movePickerFocus(-1); return; }
      // Enter / Space on a focused project item click it natively.
      if (k === 'Enter' || k === ' ') return;
    }
    if (selection) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (k === 's' || k === 'S') { e.preventDefault(); commit('region', selection, 'save'); return; }
      if (k === 'c' || k === 'C') { e.preventDefault(); commit('region', selection, 'copy'); return; }
      if (k === 'Enter') {
        // save + copy — unless a bar button has focus, whose own click must not be overridden
        if (document.activeElement && document.activeElement !== btnSave && bar.contains(document.activeElement)) return;
        e.preventDefault();
        commit('region', selection);
        return;
      }
      return;
    }
    if (k === ' ' || e.code === 'Space') {
      // Space = the whole display under this overlay.
      e.preventDefault();
      commit('full', null);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      // A drag still in progress commits as a region; otherwise the whole display.
      if (current && current.w >= 3 && current.h >= 3) {
        dragging = false;
        commit('region', current);
      } else {
        commit('full', null);
      }
    }
  });

  // No system context menu over the frozen bitmap; the escape hatch is Esc.
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); });

  // A DPI change or scale flip mid-snip: repaint the rect against the new viewport.
  window.addEventListener('resize', () => {
    const r = selection || current;
    if (r && r.w > 0 && r.h > 0) {
      paintHole(r);
      showFrame(r);
      if (selection) showBar(selection);
      else chipAtCursor(r, lastMouse.x, lastMouse.y);
    }
  });
})();
