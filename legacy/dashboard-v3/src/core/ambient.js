// Right ambient rail — the NEXUS's peripheral vision (charter frame spec):
// Working On Now ticker · machine vitals · latest whisper · Familiar presence
// · night-tide state. Data-driven from the selected scan; live-driven where
// the hq bridge exists (dev harness renders the data-only fallback).
// Collapsible; the choice persists (localStorage 'hq-ambient').
import { bus } from './bus.js';
import { data } from './data.js';
import { LX } from './lexicon.js';
import { el, esc } from '../ui/util.js';
import { fmtDur, deriveScanContext } from '../ui/components.js';
import { oracle } from '../intel/derive.mjs';

let liveTab = null;      // latest hq:browser-tab payload (live app only)
let machine = null;      // latest hq:machine payload (live app only)

const collapsed = () => { try { return localStorage.getItem('hq-ambient') === 'closed'; } catch { return false; } };

function nowHtml(cur) {
  if (!cur) return `<div class="am-empty">no signal — load the Bridge extension</div>`;
  return `<span class="bf-dot ${cur.live ? 'live' : ''}"></span>
    <span class="am-domain">${esc(cur.host || cur.domain || '')}</span>
    ${cur.focus_ms ? `<span class="am-dur">${fmtDur(cur.focus_ms)}</span>` : ''}
    ${cur.title ? `<div class="am-title">${esc(cur.title)}</div>` : ''}`;
}

function machineHtml() {
  if (!machine || typeof machine !== 'object') return `<div class="am-empty">live app only</div>`;
  // generic k:v painter — the hq:machine payload shape belongs to main; the
  // rail shows whatever numeric vitals arrive rather than assuming fields
  return Object.entries(machine)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 5)
    .map(([k, v]) => `<div class="am-kv"><span>${esc(k)}</span><b>${esc(typeof v === 'number' ? String(Math.round(v)) : v)}</b></div>`)
    .join('') || `<div class="am-empty">live app only</div>`;
}

function whisperHtml(S) {
  const feed = S?.side_quests || [];
  const pick = feed.find((s) => s.kind === 'risk' || s.kind === 'urgent') || feed[0];
  if (!pick) return `<div class="am-empty">the board is quiet</div>`;
  return `<div class="am-whisper${pick.kind === 'risk' ? ' risk' : ''}">
    <span class="am-wkind">${esc(pick.kind || 'idea')}</span> ${esc(pick.title || '')}</div>`;
}

// One-line Oracle mirror. Flag-gated (hq-ff-oracle, default on) and latest-only.
// Returns '' when off / not latest / nothing actionable, so the section is
// suppressed entirely rather than showing a hollow slot. Reads the flag inline
// (ambient is a core module and must not depend on a realm file).
function oracleHtml(S) {
  let on = true; try { on = localStorage.getItem('hq-ff-oracle') !== 'off'; } catch {}
  if (!on || !S || !data.isLatest) return '';
  let o = null;
  try { o = oracle(data.bundle, S, new Date().toISOString()); }
  catch (err) {
    // Surface once — render() re-runs on every data:select and a broken
    // derive would otherwise spam identical warnings.
    if (!oracleHtml.warned) { oracleHtml.warned = true; console.warn('[ambient] oracle derive failed', err); }
  }
  if (!o) return '';
  return `<div class="am-next">${esc(o.label)}</div>`;
}

function render() {
  const rail = document.getElementById('rail-right');
  const isNight = document.documentElement.getAttribute('data-theme') === 'nightfall';
  const tide = isNight && document.documentElement.classList.contains('night-tide');
  const S = data.selected ? deriveScanContext(data).S : null;
  const cur = (data.isLatest && liveTab) ? liveTab : S?.browser?.current;

  rail.classList.toggle('closed', collapsed());
  rail.innerHTML = '';
  // Plain ASCII chevrons — the term font (VT323) has no glyph for the
  // Unicode angle brackets ⟨/⟩ this used to use, so the browser fell back to
  // a substitute font whose glyph rendered as a bare ")" at the rail's
  // top-right in every realm/theme. < / > are guaranteed to render.
  const tog = el('button', 'am-toggle', collapsed() ? '<' : '>');
  tog.title = collapsed() ? 'Open the ambient rail' : 'Collapse the ambient rail';
  tog.onclick = () => {
    try { localStorage.setItem('hq-ambient', collapsed() ? 'open' : 'closed'); } catch {}
    document.getElementById('nexus').classList.toggle('ambient-closed', collapsed());
    render();
  };
  rail.appendChild(tog);
  if (collapsed()) return;

  const sec = (label, html) => {
    const s = el('div', 'am-sec');
    s.innerHTML = `<div class="am-h">${label}</div>${html}`;
    rail.appendChild(s);
  };
  sec(`◉ ${LX('working_now')}`, `<div class="am-now">${nowHtml(cur)}</div>`);
  const oh = oracleHtml(S);
  if (oh) sec(LX('amb_next'), oh);
  sec(LX('amb_machine'), machineHtml());
  sec(LX('amb_whisper'), whisperHtml(S));
  // Familiar presence: inert until the M3 session registry wires hq sessions
  sec(LX('amb_familiar'), `<div class="am-empty">${LX('amb_familiar_idle')}</div>`);
  if (tide) rail.appendChild(el('div', 'am-tide', 'the night deepens'));
}

export function initAmbient() {
  document.getElementById('nexus').classList.toggle('ambient-closed', collapsed());
  render();
  bus.on('data:select', render);
  bus.on('theme:changed', render);
  const hq = window.hq;
  if (hq?.getBrowserLive) hq.getBrowserLive().then((l) => { liveTab = l; render(); }).catch(() => {});
  if (hq?.onBrowserTab) hq.onBrowserTab((l) => { liveTab = l; render(); });
  if (hq?.onMachine) hq.onMachine((m) => { machine = m; render(); });
  // core module, mounted once for the app's lifetime — nothing to unsubscribe
}
