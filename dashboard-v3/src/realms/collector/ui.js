// COLLECT ui helpers — realm-local so the shared util.js stays untouched.
// `html` is the safe-by-default template tag (design audit R1): every
// interpolation is escaped unless wrapped in raw(). node() sets TEXT; use
// nodeHtml() only for markup built with `html`.
import { icon } from '../../ui/icons.js';
import { closeDrawer } from '../../ui/components.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i >= values.length) return;
    const v = values[i];
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v == null || v === false) out += '';
    else out += esc(v);
  });
  return new Raw(out);
}
export const ico = (name, size = 14) => raw(icon(name, { size }));

export const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const nodeHtml = (tag, cls, markup) => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = String(markup ?? ''); return e; };

export function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export const fmtSpeed = (bps) => (bps ? `${fmtBytes(bps)}/s` : '');
export function fmtDuration(d) {
  if (d == null) return '';
  let s = 0;
  if (typeof d === 'number') s = d;
  else { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(d)); if (!m) return String(d); s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); }
  s = Math.round(s);
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
  return h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`;
}
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export function shortUrl(u, max = 60) {
  try { const x = new URL(u); const s = x.host + x.pathname; return s.length > max ? s.slice(0, max - 1) + '…' : s; }
  catch { return String(u || '').slice(0, max); }
}

// ---- toasts + confirm live in #overlays (outside #stage, whose children
// animate with a transform that would trap position:fixed) ----------------
function overlays() { return document.getElementById('overlays') || document.body; }
let toastHost = null;
export function toast(message, { kind = '', ms = 4200, action } = {}) {
  if (!toastHost || !toastHost.isConnected) { toastHost = node('div', 'mc-toasts'); toastHost.setAttribute('aria-live', 'polite'); overlays().appendChild(toastHost); }
  const t = node('div', `mc-toast ${kind}`.trim());
  t.appendChild(node('span', null, message));
  if (action) { const b = node('button', 'mc-btn sm', action.label); b.onclick = () => { try { action.fn(); } finally { t.remove(); } }; t.appendChild(b); }
  toastHost.appendChild(t);
  while (toastHost.children.length > 4) toastHost.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}
let modal = null, resolver = null;
export function confirmBox({ title, body, actions }) {
  closeConfirm();
  modal = node('div', 'mc-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const card = node('div', 'mc-modal-card');
  card.appendChild(node('div', 'mc-modal-h', title));
  if (body) card.appendChild(node('div', 'mc-modal-body', body));
  const acts = node('div', 'mc-btn-row end');
  for (const a of actions) { const b = node('button', `mc-btn ${a.cls || ''}`.trim(), a.label); b.onclick = () => done(a.value); acts.appendChild(b); }
  card.appendChild(acts); modal.appendChild(card);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  overlays().appendChild(modal);
  (acts.querySelector('.primary') || acts.querySelector('button'))?.focus();
  return new Promise((res) => { resolver = res; });
  function done(v) { const r = resolver; resolver = null; if (modal) { modal.remove(); modal = null; } if (r) r(v); }
}
export function closeConfirm() { if (modal) { modal.remove(); modal = null; } if (resolver) { const r = resolver; resolver = null; r(null); } }
export function disposeOverlays() { closeConfirm(); if (toastHost) { toastHost.remove(); toastHost = null; } }

// ---- the shared #drawer (shell closes it on every realm switch) ----------
export function openDrawer(title, sub, bodyNode) {
  const d = document.getElementById('drawer'), scrim = document.getElementById('scrim');
  if (!d) return;
  d.innerHTML = '';
  const head = nodeHtml('div', 'dwr-head', html`<button class="x" id="mc-dwr-x" title="Close (Esc)">✕</button><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}`);
  const body = node('div', 'dwr-body mc-dwr'); body.appendChild(bodyNode);
  d.appendChild(head); d.appendChild(body);
  head.querySelector('#mc-dwr-x').onclick = closeDrawer;
  if (scrim) scrim.onclick = closeDrawer;
  d.classList.add('open'); scrim?.classList.add('open');
}
export { closeDrawer };

export const KIND_ICON = { image: 'mc-kind-image', video: 'mc-kind-video', audio: 'mc-kind-audio' };
export const kindIcon = (k) => KIND_ICON[k] || 'mc-kind-file';
