// STUDIO realm — the aftermath surface for the screen-capture Studio. The
// FloatingPanel (dashboard/panel.html, Group 3) is the operator cockpit; this
// realm is the archive: two galleries (SCREENSHOTS + RECORDINGS), a top bar
// with SNIP + RECORD triggers that route through the panel/main-side IPC, and
// a click-to-preview modal. It is DISPLAY-ONLY: fs writes, MediaRecorder, and
// desktopCapturer stay main-side; this file only reads library rows and calls
// the allow-listed contextBridge surface at window.hq.studio.
//
// Library rows shape (from dashboard/screen-capture.js listLibrary()):
//   { kind: 'shot'|'rec', recovered, path, name, size, mtimeMs, thumbDataUrl }
// path is a POSIX/native absolute path under <videos>/WorkspaceHQ. We render
// it via file:// URLs — CSP default-src 'self' permits file:// image/video
// loads in Electron. No CDN, no external asset — every image is either the
// on-disk sidecar (data: URL from thumbDataUrl) or the file:// itself.
//
// XSS: file NAMES can contain any character (Windows allows a lot). Every
// name funnels through textContent OR esc() before ever touching innerHTML.
// Paths never enter innerHTML — they are only used as image/video src via
// setAttribute, and as click payloads to the reveal/delete IPC.
//
// Lifecycle: mount() opens two subscriptions (bus 'data:select' for the LX
// theme swap, and window.hq.studio.onCaptureAdded for live grid updates);
// unmount() disposes both, closes any open modal, and clears the poll timer.
import { el, esc } from '../../ui/util.js';
import { icon } from '../../ui/icons.js';

// -------- module state (survives re-render inside one mount) ----------------
let CTX = null;
let sec = null;              // the realm container appended to #stage
let rows = null;             // last library snapshot ({shot|rec|recovered})
let loaded = false;          // first load done? empty vs "Loading…"
let modal = null;            // open preview overlay, if any
let _offs = [];              // subscription disposers, drained on unmount
let _pollTimer = 0;          // fallback poll interval, on when bridge live

// -------- helpers -----------------------------------------------------------
const has = (fn) => typeof fn === 'function';
const HQ = () => (CTX && CTX.hq && CTX.hq.studio) || null;

// bridge feature flags — each button is enabled iff its target IPC is exposed.
// The panel/main modules degrade gracefully in the harness / v3-only preview.
function bridge() {
  const s = HQ();
  return {
    list:     s && has(s.libraryList),
    reveal:   s && has(s.libraryReveal),
    del:      s && has(s.libraryDelete),
    snip:     s && has(s.snipArm),
    record:   s && has(s.panelToggle),
    liveEvt:  s && has(s.onCaptureAdded),
    // rename has no IPC in the current preload — expose the flag so the
    // per-tile RENAME button is honestly disabled with an explanatory title.
    rename:   false,
  };
}

// path -> file:// URL. Windows paths use \ which must become / for file://,
// and the whole thing needs URI-encoding (spaces, unicode, etc.).
// The path never enters innerHTML — this URL only feeds src attributes via
// setAttribute, so we skip esc() (which would corrupt %-encoded bytes).
function fileUrl(p) {
  if (typeof p !== 'string' || !p) return '';
  const norm = p.replace(/\\/g, '/');
  // encodeURI keeps the ':' after the drive letter and '/' separators intact
  // while encoding spaces, parens, hashes, etc.
  const enc = encodeURI(norm);
  return enc.startsWith('/') ? 'file://' + enc : 'file:///' + enc;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return (i === 0 ? x.toFixed(0) : x.toFixed(1)) + ' ' + u[i];
}

// mtimeMs -> "2026-09-07 14:32" (locale-agnostic, sortable). Never leaks TZ
// offsets into logs — this is display-only.
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Empty rows (safe defaults so callers can .filter without guards).
function empty() { return { shot: [], rec: [], recovered: [] }; }

// Split a library snapshot into the three buckets the UI cares about.
// Recovered .webm shows in BOTH the RECORDINGS bucket AND the Recovered
// sub-list (matches the design's "Recovered bucket with a warning badge").
function bucketize(list) {
  const out = empty();
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'shot') out.shot.push(r);
    else if (r.kind === 'rec') {
      out.rec.push(r);
      if (r.recovered) out.recovered.push(r);
    }
  }
  return out;
}

// -------- data load ---------------------------------------------------------
async function load() {
  const s = HQ();
  if (!s || !has(s.libraryList)) { rows = empty(); loaded = true; render(); return; }
  try {
    // Ask for a generous slice — the main-side handler caps at 1000; 500 is
    // plenty for a masonry that's already scroll-paged by the grid.
    const list = await s.libraryList({ kind: 'all', limit: 500 });
    rows = bucketize(list);
  } catch (err) {
    console.warn('[studio] libraryList failed:', err && err.message);
    rows = empty();
  }
  loaded = true;
  render();
}

// -------- top bar (SNIP + RECORD) ------------------------------------------
function topBar(b) {
  const bar = el('div', 'st-bar');

  // Icon + label. The icon is authored (fixed sprite id), the label is a fixed
  // string — no scan-derived text — so template concatenation here is safe by
  // construction. Label goes in a <span> so CSS can size the icon
  // independently.
  const snip = el('button', 'st-cta st-snip', `${icon('verb-snip', { size: 16 })}<span class="st-cta-lbl">SNIP</span>`);
  if (!b.snip) {
    snip.disabled = true;
    snip.title = 'Needs the live app — the Studio bridge is unavailable in this preview';
  } else {
    snip.title = 'Arm a region snip (Ctrl+Alt+S)';
    snip.onclick = async () => {
      snip.disabled = true;
      try { await HQ().snipArm('region'); } catch (err) { console.warn('[studio] snipArm failed:', err && err.message); }
      // Overlays freeze quickly; re-enable after a beat so the user can
      // trigger a second snip if they escaped out of the first.
      setTimeout(() => { snip.disabled = false; }, 250);
    };
  }

  const rec = el('button', 'st-cta st-rec', `${icon('verb-record', { size: 16 })}<span class="st-cta-lbl">RECORD</span>`);
  if (!b.record) {
    rec.disabled = true;
    rec.title = 'Needs the live app — the Studio bridge is unavailable in this preview';
  } else {
    rec.title = 'Open the capture panel (Ctrl+Alt+R starts a recording directly)';
    rec.onclick = async () => {
      rec.disabled = true;
      try { await HQ().panelToggle(); } catch (err) { console.warn('[studio] panelToggle failed:', err && err.message); }
      setTimeout(() => { rec.disabled = false; }, 250);
    };
  }

  const refresh = el('button', 'st-refresh', 'REFRESH');
  refresh.title = 'Re-scan the capture folder';
  refresh.onclick = () => { refresh.textContent = '…'; load().then(() => { /* render() replaces the bar */ }); };

  bar.appendChild(snip);
  bar.appendChild(rec);
  bar.appendChild(refresh);
  return bar;
}

// -------- tile --------------------------------------------------------------
// A single library entry. innerHTML is fixed markup with only static labels;
// every dynamic string (filename, time, size) is set via textContent below.
function tile(item, b) {
  const t = el('div', 'st-tile');
  if (item.recovered) t.classList.add('recovered');
  t.classList.add(item.kind === 'shot' ? 'shot' : 'rec');

  // Thumbnail slot: prefer the sidecar thumb dataURL if present; otherwise
  // for a shot, the .png itself is loadable inline; for a rec with no thumb,
  // show a mime glyph. Never load a video into an <img>.
  const thumb = el('div', 'st-thumb');
  if (item.thumbDataUrl) {
    const img = document.createElement('img');
    img.setAttribute('src', item.thumbDataUrl);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    thumb.appendChild(img);
  } else if (item.kind === 'shot') {
    const img = document.createElement('img');
    img.setAttribute('src', fileUrl(item.path));
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    thumb.appendChild(img);
  } else {
    thumb.appendChild(el('div', 'st-glyph', '▶'));
  }

  // Kind chip + recovered badge overlay (recovered is a real warning, not decor)
  const chip = el('span', 'st-chip', item.kind === 'shot' ? 'PNG' : 'WEBM');
  thumb.appendChild(chip);
  if (item.recovered) {
    const badge = el('span', 'st-recovered', 'RECOVERED');
    badge.title = 'Restored from a crashed recording — last cluster may be short';
    thumb.appendChild(badge);
  }

  const meta = el('div', 'st-meta');
  const name = el('div', 'st-name');
  name.textContent = item.name || '';                        // XSS: textContent
  name.title = item.name || '';
  const sub = el('div', 'st-sub');
  sub.textContent = `${fmtTime(item.mtimeMs)} · ${fmtBytes(item.size)}`;
  meta.appendChild(name);
  meta.appendChild(sub);

  const actions = el('div', 'st-actions');
  const reveal = el('button', 'st-a', 'REVEAL');
  if (!b.reveal) { reveal.disabled = true; reveal.title = 'Needs the live app'; }
  else {
    reveal.title = 'Show in Explorer';
    reveal.onclick = (e) => { e.stopPropagation(); HQ().libraryReveal(item.path).catch((err) => console.warn('[studio] reveal failed:', err && err.message)); };
  }
  const ren = el('button', 'st-a', 'RENAME');
  ren.disabled = true;
  ren.title = 'Not available yet — rename an on-disk file in Explorer';
  const del = el('button', 'st-a st-danger', 'DELETE');
  if (!b.del) { del.disabled = true; del.title = 'Needs the live app'; }
  else {
    del.title = 'Move to Trash';
    del.onclick = async (e) => {
      e.stopPropagation();
      // A single confirm() dialog: destructive, off-network, honestly named.
      const ok = window.confirm(`Move to Trash?\n\n${item.name}`);
      if (!ok) return;
      del.disabled = true; del.textContent = '…';
      try {
        const okDel = await HQ().libraryDelete(item.path);
        if (okDel === false) throw new Error('main refused the path');
        // Optimistic remove: main will also broadcast studio:capture-added for
        // fresh writes, but there is no capture-removed event yet, so we drop
        // the row locally and re-render.
        for (const key of ['shot', 'rec', 'recovered']) {
          rows[key] = (rows[key] || []).filter((r) => r.path !== item.path);
        }
        render();
      } catch (err) {
        console.warn('[studio] delete failed:', err && err.message);
        del.disabled = false; del.textContent = 'DELETE';
        del.title = `Not moved — ${String(err && err.message || err)}`;
      }
    };
  }
  actions.appendChild(reveal);
  actions.appendChild(ren);
  actions.appendChild(del);

  t.appendChild(thumb);
  t.appendChild(meta);
  t.appendChild(actions);

  // Whole-tile click opens the preview modal (image or video). Buttons above
  // stopPropagation so their clicks don't also open the modal.
  t.onclick = () => openPreview(item);
  return t;
}

// -------- preview modal -----------------------------------------------------
function closePreview() {
  if (!modal) return;
  try {
    const v = modal.querySelector('video');
    if (v) { try { v.pause(); } catch { /* ignore */ } v.removeAttribute('src'); v.load && v.load(); }
  } catch { /* ignore */ }
  try { modal.remove(); } catch { /* ignore */ }
  modal = null;
  document.removeEventListener('keydown', modalKey, true);
}

function modalKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closePreview(); }
}

function openPreview(item) {
  closePreview();
  modal = el('div', 'st-modal');
  const inner = el('div', 'st-modal-inner');
  const head = el('div', 'st-modal-head');
  const title = el('div', 'st-modal-title');
  title.textContent = item.name || '';                        // XSS: textContent
  const close = el('button', 'st-modal-close', 'Close ✕');
  close.onclick = closePreview;
  head.appendChild(title);
  head.appendChild(close);
  inner.appendChild(head);

  const body = el('div', 'st-modal-body');
  if (item.kind === 'shot') {
    const img = document.createElement('img');
    img.setAttribute('src', fileUrl(item.path));
    img.setAttribute('alt', '');
    body.appendChild(img);
  } else {
    const v = document.createElement('video');
    v.setAttribute('src', fileUrl(item.path));
    v.setAttribute('controls', '');
    v.setAttribute('preload', 'metadata');
    body.appendChild(v);
  }
  inner.appendChild(body);
  modal.appendChild(inner);

  // Backdrop click (anywhere outside the inner card) closes.
  modal.onclick = (e) => { if (e.target === modal) closePreview(); };
  document.addEventListener('keydown', modalKey, true);
  document.body.appendChild(modal);
}

// -------- section renderer --------------------------------------------------
function section(title, items, b, extraNote) {
  const s = el('div', 'st-section');
  const h = el('h2', 'st-sec-h', esc(title));
  h.appendChild(el('span', 'st-sec-n', String(items.length)));
  s.appendChild(h);
  if (extraNote) s.appendChild(el('div', 'st-sec-note', esc(extraNote)));
  if (!items.length) {
    s.appendChild(el('div', 'st-empty-mini', esc(`No ${title.toLowerCase()} yet.`)));
    return s;
  }
  const grid = el('div', 'st-grid');
  for (const it of items) grid.appendChild(tile(it, b));
  s.appendChild(grid);
  return s;
}

// -------- top-level render --------------------------------------------------
function render() {
  if (!sec) return;
  sec.innerHTML = '';
  const b = bridge();

  sec.appendChild(topBar(b));

  if (!loaded) {
    sec.appendChild(el('div', 'st-empty', 'Loading Studio library…'));
    return;
  }

  // No bridge at all: single honest empty line (per spec: not a styled panel).
  if (!b.list) {
    sec.appendChild(el('div', 'st-empty', 'Studio bridge unavailable in this preview. In the live app, press Ctrl+Alt+S to snip, or Ctrl+Alt+R to record.'));
    return;
  }

  const anything = rows && (rows.shot.length || rows.rec.length);
  if (!anything) {
    sec.appendChild(el('div', 'st-empty', 'No captures yet. Press Ctrl+Alt+S to snip, or Ctrl+Alt+R to record.'));
    return;
  }

  // Screenshots first, then Recordings. Recovered is a filtered surface at
  // the bottom (only when any exist) so users notice crash-restored files.
  sec.appendChild(section('Screenshots', rows.shot, b));
  sec.appendChild(section('Recordings',  rows.rec,  b));
  if (rows.recovered.length) {
    sec.appendChild(section('Recovered', rows.recovered, b,
      'These files were restored from a recording that ended abnormally. The last cluster may be short.'));
  }
}

// -------- realm exports -----------------------------------------------------
export const view = {
  mount(root, ctx) {
    CTX = ctx;
    rows = null;
    loaded = false;
    sec = el('section', 'studio-realm');
    root.appendChild(sec);

    // Initial paint (top bar + Loading…) + first library fetch.
    render();
    load();

    // Live grid: prepend new tiles as main broadcasts them. onCaptureAdded
    // returns an unsubscribe fn per contextBridge contract; store it.
    const s = HQ();
    if (s && has(s.onCaptureAdded)) {
      _offs.push(s.onCaptureAdded(() => {
        // A single reload is the honest path — main sends {kind, path, at}
        // but not the sidecar thumb or full stat; re-listing is O(dir) and
        // Windows caches this comfortably at our capture rates.
        load();
      }));
    }

    // Theme swap: bus 'data:select' triggers other realms' re-render; the
    // studio has nothing scan-scoped to update, but re-rendering keeps any
    // future LX() lookups fresh and matches the pattern used by SOCIAL.
    if (ctx.bus && has(ctx.bus.on)) {
      _offs.push(ctx.bus.on('data:select', () => render()));
    }

    // Modest fallback poll (30s) — covers the case where the app was still
    // booting when we mounted and the onCaptureAdded subscription races.
    // The interval is idempotent (load() is a plain re-list) and gated on
    // the bridge being alive, so it's a no-op in the harness.
    if (b_hasListPoll()) _pollTimer = setInterval(load, 30000);
  },
  unmount() {
    closePreview();
    for (const off of _offs) { try { off(); } catch { /* disposer already dead */ } }
    _offs = [];
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = 0; }
    CTX = null; sec = null; rows = null; loaded = false;
  },
};

// Tiny helper for the mount-time gate above — kept outside mount so the
// interval closure over `load` stays stable across re-mounts.
function b_hasListPoll() {
  const s = HQ();
  return !!(s && has(s.libraryList));
}
