// MED-BAY — the PC-health anatomy ward (charter realm 7, M2 fe slice).
// v3-native: no v2 parity source. The machine is rendered as a patient — organ
// cards laid out as a wireframe body (grid areas, see medbay.css), each glowing
// by triage status, with a sparkline, a plain-language diagnosis and a bedside
// teaching quip. Fixes are curated Restoration spells cast through the
// EXISTING casting engine (components.js castSpell — confirm gate and all).
//
// PROPOSED DATA SHAPE (CONTRACT.md ask — struct lane's collector/pc-health.mjs
// writes data/pc-health.json, bundled additively as DATA.pcHealth; null today):
// {
//   scanned_at: "2026-07-23T09:00:00",        // local ISO
//   organs: [{
//     id: 'cpu'|'ram'|'gpu'|'disk'|'network'|'startup'|'updates'|'temp',
//     label: 'CPU',                           // display name
//     status: 'grace'|'ember'|'blood',        // triage verdict (collector-owned thresholds)
//     value: 43,                              // headline number
//     unit: '%',                              // '%' | 'GB free' | 'apps' | 'days' | 'ms' | 'GB' …
//     spark: [38, 41, 55, 43],                // recent samples, oldest→newest, render-ready
//     diagnosis: 'plain-language one-liner',  // what is wrong / right, no jargon
//     teaching: 'optional collector quip'     // optional; realm has rotating fallbacks
//   }]
// }
// Unknown organ ids still render (fallback tag, auto grid slot) — additive-safe.
import { el, esc, COL, fmt } from '../../ui/util.js';
import { aosKids, aosRefresh } from '../../ui/components.js';

const STATUS = {
  grace: { cls: 'st-grace', c: COL.green,  word: 'GRACE' },
  ember: { cls: 'st-ember', c: COL.orange, word: 'EMBER' },
  blood: { cls: 'st-blood', c: COL.red,    word: 'BLOOD' },
};

// organ id → body part. The grid slot (.organ-<id>, a closed set — never raw
// data) is medbay.css's business; ids outside this table flow into spare cells.
const ANATOMY = {
  cpu:     { tag: 'BRAIN',  label: 'CPU' },
  gpu:     { tag: 'EYES',   label: 'GPU' },
  ram:     { tag: 'HEART',  label: 'RAM' },
  network: { tag: 'VEINS',  label: 'NETWORK' },
  updates: { tag: 'IMMUNE', label: 'UPDATES' },
  disk:    { tag: 'GUT',    label: 'DISK' },
  temp:    { tag: 'BOWELS', label: 'TEMP DEBT' },
  startup: { tag: 'LEGS',   label: 'STARTUP' },
};

// Bedside manner — rotating lines per organ, picked by day-hash (no RNG: same
// scan date = same quip, so re-renders and screenshots agree). A collector-
// written `teaching` field always outranks these.
const TEACHING = {
  cpu: [
    'the brain is cooking. ideally not literally.',
    'eight cores and somehow the busiest one is running Slack.',
  ],
  gpu: [
    'the eyes were made for shaders, not four hours of 1080p brainrot.',
    'an idle GPU is just expensive silence.',
  ],
  ram: [
    "every tab you keep 'for later' lives here rent free.",
    'the heart pumps what you hoard. close some tabs, feel lighter.',
  ],
  network: [
    'ping spikes are the veins clenching. classic router moment.',
    "the veins don't lie — it really was the wifi this time.",
  ],
  updates: [
    "'remind me tomorrow' — you, for 47 consecutive tomorrows.",
    'patches are armor. you are currently speedrunning unpatched.',
  ],
  disk: [
    'you downloaded that in 2023. you will never open it. free the gut.',
    'somewhere in here is a node_modules you abandoned mid-install.',
  ],
  temp: [
    'temp files: temporary in name only. like most TODOs.',
    "%TEMP% is not a storage strategy, it's a cry for help.",
  ],
  startup: [
    "23 startup apps. that's not a boot, that's a parade.",
    'half these launchers belong to apps you uninstalled. spooky.',
  ],
};

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// Tiny inline pulse — components.js lineChart is a full 320×130 chart card;
// organ cards need a 120×26 heartbeat, so this stays local. Numbers only in.
function spark(vals, color) {
  const v = (Array.isArray(vals) ? vals : []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return '';
  const W = 120, H = 26, P = 3;
  const max = Math.max(...v), min = Math.min(...v);
  const sx = (i) => P + (i * (W - P * 2)) / (v.length - 1);
  const sy = (x) => H - P - ((x - min) / (max - min || 1)) * (H - P * 2);
  const pts = v.map((x, i) => `${sx(i).toFixed(1)},${sy(x).toFixed(1)}`).join(' ');
  return `<svg class="organ-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${sx(v.length - 1).toFixed(1)}" cy="${sy(v[v.length - 1]).toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

let CTX = null, root = null, offSelect = null;
let LIVE = null;   // a fresh RE-EXAMINE report overrides the build-time snapshot

function organCard(o, dayKey) {
  const st = STATUS[o.status] || STATUS.ember;
  const an = ANATOMY[o.id];
  const card = el('div', `organ ${st.cls}${an ? ` organ-${o.id}` : ''}`);
  card.style.setProperty('--oc', st.c);
  const val = typeof o.value === 'number' && Number.isFinite(o.value)
    ? (Number.isInteger(o.value) ? fmt(o.value) : o.value.toFixed(1))
    : esc(String(o.value ?? '—'));
  const lines = TEACHING[o.id];
  const teach = o.teaching ? esc(o.teaching) : (lines ? lines[hash(o.id + dayKey) % lines.length] : '');
  card.innerHTML = `
    <div class="organ-top">
      <span class="organ-tag">${an ? an.tag : 'ORGAN'}</span>
      <span class="organ-name">${esc(o.label || o.id)}</span>
      <span class="organ-status">${st.word}</span>
    </div>
    <div class="organ-read"><b>${val}</b><span class="organ-unit">${esc(o.unit || '')}</span></div>
    ${spark(o.spark, st.c)}
    <div class="organ-dx">${esc(o.diagnosis || '')}</div>
    ${teach ? `<div class="organ-tx">${teach}</div>` : ''}`;
  return card;
}

function renderAnatomy(parent, ph) {
  // pc-health.json is a brand-new struct contract — a null/shapeless entry
  // must not blank the ward while the shape settles
  const organs = ph.organs.filter((o) => o && typeof o === 'object');
  const counts = { grace: 0, ember: 0, blood: 0 };
  organs.forEach((o) => { if (counts[o.status] != null) counts[o.status]++; });
  const when = String(ph.scanned_at || '').slice(0, 16).replace('T', ' ');
  const head = el('h2', 'sec', `${CTX.LX('tab_medbay')} · patient: this machine`);
  if (CTX.hq?.healthScan) {
    const btn = el('button', 'sec-btn mb-reexamine', '◆ RE-EXAMINE');
    btn.title = 'Run a fresh health scan of this machine (~3s)';
    btn.onclick = async () => { btn.disabled = true; btn.textContent = '◆ examining…'; try { const fresh = await CTX.hq.healthScan(); if (fresh?.organs) { LIVE = fresh; render(); } } finally { btn.disabled = false; } };
    head.appendChild(btn);
  }
  parent.appendChild(head);
  parent.appendChild(el('div', 'mb-tally', `
    <span class="mbt" style="--oc:${COL.green}">${counts.grace} in grace</span>
    <span class="mbt" style="--oc:${COL.orange}">${counts.ember} ember</span>
    <span class="mbt" style="--oc:${COL.red}">${counts.blood} blood</span>
    <span class="mbt-when">examined ${esc(when) || '—'}</span>`));
  const grid = el('div', 'anatomy');
  const dayKey = String(ph.scanned_at || '').slice(0, 10);
  organs.forEach((o) => grid.appendChild(organCard(o, dayKey)));
  aosKids(grid, 'zoom-in', 45);
  parent.appendChild(grid);
}

// ---- empty state: the triage cot (what ships today — pcHealth is null until
// the struct lane's collector/pc-health.mjs lands) ---------------------------
const EKG_PATH = 'M0,14 H60 L66,4 L72,24 L78,14 H140 L144,10 L148,14 H220 L226,4 L232,24 L238,14 H300 L304,10 L308,14 H380 L386,4 L392,24 L398,14 H480';

const COT_SVG = `<svg class="cot-px" viewBox="0 0 120 56" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="0" y="52" width="120" height="2" fill="var(--frame, #322a5e)"/>
  <rect x="6" y="12" width="22" height="16" fill="var(--ink, #050409)"/>
  <rect x="8" y="14" width="18" height="12" fill="var(--bg2, #0c0a1e)"/>
  <rect x="10" y="19" width="14" height="2" fill="var(--green, #3aff6e)" class="cot-flat"/>
  <rect x="16" y="28" width="2" height="22" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="11" y="50" width="12" height="2" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="32" y="20" width="3" height="32" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="93" y="26" width="3" height="26" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="32" y="34" width="64" height="3" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="35" y="29" width="58" height="5" fill="var(--frame, #322a5e)"/>
  <rect x="37" y="25" width="11" height="4" fill="var(--text, #e8e6ff)"/>
  <rect x="50" y="24" width="43" height="5" fill="var(--blue, #4d9fff)"/>
  <rect x="66" y="20" width="9" height="4" fill="var(--gold, #ffd23f)"/>
  <rect x="106" y="8" width="2" height="42" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="98" y="7" width="10" height="2" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="101" y="50" width="12" height="2" fill="var(--frame-hi, #5a4ea8)"/>
  <rect x="98" y="10" width="9" height="11" fill="var(--ink, #050409)"/>
  <rect x="99" y="11" width="7" height="9" fill="var(--green, #3aff6e)" opacity="0.55"/>
  <rect x="102" y="21" width="1" height="6" fill="var(--green, #3aff6e)" opacity="0.4"/>
</svg>`;

function renderTriage(parent) {
  parent.appendChild(el('h2', 'sec', `${CTX.LX('tab_medbay')} · no patient on file`));
  const cot = el('div', 'ward-cot');
  cot.innerHTML = `
    <svg class="ekg" viewBox="0 0 480 28" preserveAspectRatio="none" aria-hidden="true">
      <path class="ekg-base" d="${EKG_PATH}"/>
      <path class="ekg-line" d="${EKG_PATH}"/>
    </svg>
    ${COT_SVG}
    <div class="cot-head">THE WARD IS BUILT. THE SCANNER HASN'T RUN.</div>
    <div class="cot-sub">this machine has never been examined — no vitals, no diagnosis, no judgment (yet).</div>
    <div class="cot-how">the struct lane's <b>collector/pc-health.mjs</b> writes <b>data/pc-health.json</b>; the moment it ships, the eight organs below light up.</div>`;
  parent.appendChild(cot);
  // ghost anatomy: the beds are made and named — the layout ships today
  parent.appendChild(el('div', 'ghost-cap', 'eight organs, eight cots, zero readings'));
  const grid = el('div', 'anatomy');
  for (const [id, an] of Object.entries(ANATOMY)) {
    const g = el('div', `organ ghost organ-${id}`);
    g.innerHTML = `
      <div class="organ-top"><span class="organ-tag">${an.tag}</span><span class="organ-name">${an.label}</span></div>
      <div class="organ-read"><b>—</b></div>
      <div class="organ-dx">awaiting vitals</div>`;
    grid.appendChild(g);
  }
  aosKids(grid, 'zoom-in', 45);
  parent.appendChild(grid);
}

// ---- treatments: the real fix scripts --------------------------------------
// Each organ carries curated `fixes` (title, why, teaching, command, danger).
// COPY hands you the exact PowerShell; RUN executes ONLY danger:'safe' fixes,
// and only after main validates the command against the current pc-health.json
// (the renderer can never smuggle an arbitrary command through). Sickest organs
// prescribe first.
const DANGER = {
  safe:    { cls: 'dg-safe',    label: 'read-only' },
  caution: { cls: 'dg-caution', label: 'deletes files' },
  admin:   { cls: 'dg-admin',   label: 'needs admin' },
};
const SEV = { blood: 0, ember: 1, grace: 2 };

function fixCard(fix, organ) {
  const dg = DANGER[fix.danger] || DANGER.caution;
  const an = ANATOMY[organ.id];
  const card = el('div', 'rx');
  const runnable = fix.danger === 'safe' && CTX.hq?.healthFix;
  card.innerHTML = `
    <div class="rx-top">
      <span class="rx-organ" style="--oc:${(STATUS[organ.status] || STATUS.ember).c}">${an ? an.tag : esc(organ.id)}</span>
      <span class="rx-title">${esc(fix.title)}</span>
      <span class="rx-danger ${dg.cls}">${dg.label}</span>
    </div>
    <div class="rx-why">${esc(fix.why || '')}</div>
    ${fix.teaching ? `<div class="rx-teach">${esc(fix.teaching)}</div>` : ''}
    <div class="rx-cmd"><code>${esc(fix.command)}</code></div>
    <div class="rx-act">
      <button class="rx-copy">⧉ COPY</button>
      ${runnable ? '<button class="rx-run">▶ RUN</button>' : `<span class="rx-manual">run it yourself — ${dg.label}</span>`}
    </div>
    <pre class="rx-out" hidden></pre>`;
  const out = card.querySelector('.rx-out');
  card.querySelector('.rx-copy').onclick = async (e) => {
    try { await navigator.clipboard.writeText(fix.command); e.target.textContent = '✓ COPIED'; setTimeout(() => (e.target.textContent = '⧉ COPY'), 1400); } catch {}
  };
  const runBtn = card.querySelector('.rx-run');
  if (runBtn) runBtn.onclick = async () => {
    runBtn.disabled = true; runBtn.textContent = '▶ running…'; out.hidden = false; out.textContent = '…';
    try {
      const r = await CTX.hq.healthFix(fix.command);
      out.textContent = (r?.output || '').trim() || (r?.ok ? '(done — no output)' : 'refused or failed.');
      out.classList.toggle('err', !r?.ok);
    } catch (err) { out.textContent = String(err?.message || err); out.classList.add('err'); }
    finally { runBtn.disabled = false; runBtn.textContent = '▶ RUN'; }
  };
  return card;
}

function renderTreatments(parent, ph) {
  const organs = (ph.organs || []).filter((o) => o && Array.isArray(o.fixes) && o.fixes.length);
  if (!organs.length) return;
  const ranked = [...organs].sort((a, b) => (SEV[a.status] ?? 3) - (SEV[b.status] ?? 3));
  const total = ranked.reduce((n, o) => n + o.fixes.length, 0);
  parent.appendChild(el('h2', 'sec', `🩹 TREATMENTS · ${total} script${total === 1 ? '' : 's'}, sickest first`));
  const list = el('div', 'rx-list');
  ranked.forEach((o) => o.fixes.forEach((f) => list.appendChild(fixCard(f, o))));
  aosKids(list, 'fade-up', 30);
  parent.appendChild(list);
}

function render() {
  if (!root || !CTX) return;
  root.innerHTML = '';
  const ph = LIVE || CTX.data.bundle.pcHealth;
  if (ph && Array.isArray(ph.organs) && ph.organs.length) { renderAnatomy(root, ph); renderTreatments(root, ph); }
  else renderTriage(root);
  aosRefresh();
}

export const view = {
  mount(stage, ctx) {
    CTX = ctx;
    root = el('section', 'realm-medbay');
    stage.appendChild(root);
    offSelect = ctx.bus.on('data:select', render);
    render();
  },
  unmount() {
    offSelect?.(); offSelect = null;
    root = null; CTX = null;
  },
};
