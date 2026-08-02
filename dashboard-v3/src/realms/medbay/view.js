// MED-BAY — the PC-health panel (charter realm 7, M2 fe slice).
// v3-native: no v2 parity source. Eight system vitals are laid out as a
// body-map grid (grid areas, see medbay.css), each with a status, headline
// number, sparkline and a plain-language diagnosis. Recommended fixes are
// curated scripts you COPY or RUN through the existing health-fix engine
// (main validates every command — confirm gate and all).
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
import { anomalies } from '../../intel/derive.mjs';
import { anomalyGroups } from '../../intel/foresight.mjs';
import { dispatch } from '../../core/actions.mjs';

// The data contract keeps the grace/ember/blood keys; the display word is plain.
const STATUS = {
  grace: { cls: 'st-grace', c: COL.green,  word: 'HEALTHY' },
  ember: { cls: 'st-ember', c: COL.orange, word: 'WARNING' },
  blood: { cls: 'st-blood', c: COL.red,    word: 'CRITICAL' },
};

// organ id → body position. The grid slot (.organ-<id>, a closed set — never raw
// data) is medbay.css's business; ids outside this table flow into spare cells.
// The `tag` is a quiet anatomical caption that explains the body-map layout.
const ANATOMY = {
  cpu:     { tag: 'BRAIN',  label: 'CPU' },
  gpu:     { tag: 'EYES',   label: 'GPU' },
  ram:     { tag: 'HEART',  label: 'RAM' },
  network: { tag: 'VEINS',  label: 'NETWORK' },
  updates: { tag: 'IMMUNE', label: 'UPDATES' },
  disk:    { tag: 'GUT',    label: 'DISK' },
  temp:    { tag: 'LIVER',  label: 'TEMP FILES' },
  startup: { tag: 'LEGS',   label: 'STARTUP' },
};

// Plain-language teaching notes — rotating lines per organ, picked by day-hash
// (no RNG: same scan date = same note, so re-renders and screenshots agree). A
// collector-written `teaching` field always outranks these.
const TEACHING = {
  cpu: [
    'the processor is working hard right now.',
    'eight cores, and the busiest one is somehow running a chat app.',
  ],
  gpu: [
    'the graphics card is built for real work, not hours of autoplay video.',
    'an idle GPU is just expensive silence.',
  ],
  ram: [
    "every tab you keep 'for later' lives here, taking up memory.",
    'memory holds what you keep open. close some tabs to free it up.',
  ],
  network: [
    'ping spikes usually mean the connection is struggling — often the router.',
    'the numbers agree: it really was the wifi this time.',
  ],
  updates: [
    "'remind me tomorrow', for 47 tomorrows running.",
    'patches keep you safe. right now some are still pending.',
  ],
  disk: [
    'you downloaded that in 2023 and never opened it. safe to clear.',
    'somewhere in here is a node_modules you abandoned mid-install.',
  ],
  temp: [
    'temp files are temporary in name only. clearing them is safe.',
    '%TEMP% is not a storage plan — it just quietly fills up.',
  ],
  startup: [
    '23 startup apps is a lot to launch every boot.',
    'half of these belong to apps you already uninstalled.',
  ],
};

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// Tiny inline pulse — components.js lineChart is a full 320×130 chart card;
// vital cards need a 120×26 trend line, so this stays local. Numbers only in.
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
let LIVE = null;   // a fresh scan overrides the build-time snapshot

// Shared scan button — same wiring in the header (Re-examine) and the empty
// state (Run scan). Fresh report → LIVE override → full re-render.
function scanButton(label, cls) {
  const btn = el('button', ('sec-btn ' + (cls || '')).trim(), esc(label));
  btn.title = 'Run a fresh health scan of this machine (~3s)';
  btn.onclick = async () => {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Scanning…';
    try {
      const fresh = await CTX.hq.healthScan();
      if (fresh?.organs) { LIVE = fresh; render(); }
    } finally { btn.disabled = false; btn.textContent = prev; }
  };
  return btn;
}

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
      <span class="organ-tag">${an ? an.tag : 'SYSTEM'}</span>
      <span class="organ-name">${esc(o.label || o.id)}</span>
      <span class="organ-status">${st.word}</span>
    </div>
    <div class="organ-read"><b>${val}</b>${o.unit ? `<span class="organ-unit">${esc(o.unit)}</span>` : ''}</div>
    ${spark(o.spark, st.c)}
    ${o.diagnosis ? `<div class="organ-dx">${esc(o.diagnosis)}</div>` : ''}
    ${teach ? `<div class="organ-tx">${teach}</div>` : ''}`;
  return card;
}

function renderAnatomy(parent, ph) {
  // pc-health.json is a brand-new struct contract — a null/shapeless entry
  // must not blank the panel while the shape settles
  const organs = ph.organs.filter((o) => o && typeof o === 'object');
  const counts = { grace: 0, ember: 0, blood: 0 };
  organs.forEach((o) => { if (counts[o.status] != null) counts[o.status]++; });
  const when = String(ph.scanned_at || '').slice(0, 16).replace('T', ' ');
  const head = el('h2', 'sec', `${CTX.LX('tab_medbay')} · this machine`);
  if (CTX.hq?.healthScan) head.appendChild(scanButton('Re-examine', 'mb-reexamine'));
  parent.appendChild(head);
  parent.appendChild(el('div', 'mb-tally', `
    <span class="mbt" style="--oc:${COL.green}">${counts.grace} healthy</span>
    <span class="mbt" style="--oc:${COL.orange}">${counts.ember} warning</span>
    <span class="mbt" style="--oc:${COL.red}">${counts.blood} critical</span>
    <span class="mbt-when">scanned ${esc(when) || '—'}</span>`));
  const grid = el('div', 'anatomy');
  const dayKey = String(ph.scanned_at || '').slice(0, 10);
  organs.forEach((o) => grid.appendChild(organCard(o, dayKey)));
  aosKids(grid, 'fade-up', 45);
  parent.appendChild(grid);
}

// ---- empty state (what ships today — pcHealth is null until the struct lane's
// collector/pc-health.mjs lands) ---------------------------------------------
const EKG_PATH = 'M0,14 H60 L66,4 L72,24 L78,14 H140 L144,10 L148,14 H220 L226,4 L232,24 L238,14 H300 L304,10 L308,14 H380 L386,4 L392,24 L398,14 H480';

function renderTriage(parent) {
  parent.appendChild(el('h2', 'sec', `${CTX.LX('tab_medbay')} · no scan yet`));
  const canScan = !!CTX.hq?.healthScan;
  const empty = el('div', 'mb-empty');
  empty.innerHTML = `
    <svg class="ekg" viewBox="0 0 480 28" preserveAspectRatio="none" aria-hidden="true">
      <path class="ekg-base" d="${EKG_PATH}"/>
      <path class="ekg-line" d="${EKG_PATH}"/>
    </svg>
    <div class="mb-empty-title">No health scan yet</div>
    <div class="mb-empty-sub">${canScan
      ? 'Run a scan to check CPU, memory, GPU, disk, network, startup, updates and temperature.'
      : "This machine hasn't been scanned yet, so there are no vitals to show. The eight system vitals below populate once scanning is available."}</div>`;
  if (canScan) empty.appendChild(scanButton('Run scan', 'mb-scan-cta'));
  parent.appendChild(empty);
  // skeleton: the eight vitals are named and positioned, waiting for readings
  parent.appendChild(el('div', 'ghost-cap', 'Eight system vitals, awaiting the first scan'));
  const grid = el('div', 'anatomy');
  for (const [id, an] of Object.entries(ANATOMY)) {
    const g = el('div', `organ ghost organ-${id}`);
    g.innerHTML = `
      <div class="organ-top"><span class="organ-tag">${an.tag}</span><span class="organ-name">${an.label}</span></div>
      <div class="organ-read"><b>—</b></div>
      <div class="organ-dx">Awaiting scan</div>`;
    grid.appendChild(g);
  }
  aosKids(grid, 'fade-up', 45);
  parent.appendChild(grid);
}

// ---- recommended fixes: the real fix scripts -------------------------------
// Each organ carries curated `fixes` (title, why, teaching, command, danger).
// COPY hands you the exact PowerShell; RUN executes ONLY danger:'safe' fixes,
// and only after main validates the command against the current pc-health.json
// (the renderer can never smuggle an arbitrary command through). Most urgent
// organs prescribe first.
const DANGER = {
  safe:    { cls: 'dg-safe',    label: 'read-only' },
  caution: { cls: 'dg-caution', label: 'deletes files' },
  admin:   { cls: 'dg-admin',   label: 'needs admin' },
};
const SEV = { blood: 0, ember: 1, grace: 2 };

function fixCard(fix, organ) {
  const dg = DANGER[fix.danger] || DANGER.caution;
  const card = el('div', 'rx');
  const runnable = fix.danger === 'safe' && CTX.hq?.healthFix;
  card.innerHTML = `
    <div class="rx-top">
      <span class="rx-organ" style="--oc:${(STATUS[organ.status] || STATUS.ember).c}">${esc(organ.label || organ.id)}</span>
      <span class="rx-title">${esc(fix.title)}</span>
      <span class="rx-danger ${dg.cls}">${dg.label}</span>
    </div>
    <div class="rx-why">${esc(fix.why || '')}</div>
    ${fix.teaching ? `<div class="rx-teach">${esc(fix.teaching)}</div>` : ''}
    <div class="rx-cmd"><code>${esc(fix.command)}</code></div>
    <div class="rx-act">
      <button class="rx-copy">⧉ COPY</button>
      ${runnable ? '<button class="rx-run">▶ RUN</button>' : `<span class="rx-manual">copy and run it yourself — ${dg.label}</span>`}
    </div>
    <pre class="rx-out" hidden></pre>`;
  const out = card.querySelector('.rx-out');
  card.querySelector('.rx-copy').onclick = async (e) => {
    try { await navigator.clipboard.writeText(fix.command); e.target.textContent = '✓ COPIED'; }
    catch { e.target.textContent = '✗ COPY FAILED'; }
    setTimeout(() => (e.target.textContent = '⧉ COPY'), 1400);
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
  parent.appendChild(el('h2', 'sec', `Recommended fixes · ${total} script${total === 1 ? '' : 's'}, most urgent first`));
  const list = el('div', 'rx-list');
  ranked.forEach((o) => o.fixes.forEach((f) => list.appendChild(fixCard(f, o))));
  aosKids(list, 'fade-up', 30);
  parent.appendChild(list);
}

// ---- anomaly cleanup: filesystem clutter (clones/duplicates/empty folders)
// derived straight from the scan's inventory — independent of pc-health.json's
// scan gate, so this shows real content even before any health scan has run.
// Each row's "Note for cleanup" is the ONE working control: it dispatches the
// real capture:note action (window.hq.captureSave under the hood). No preload
// in the dev harness -> render disabled, never a silently-dead button.
const GROUP_LABEL = { clone: 'Cloned repos', duplicate: 'Duplicates', empty: 'Empty folders' };

function anomalyRow(item) {
  const canCapture = !!CTX.hq?.captureSave;
  const row = el('div', 'an-item');
  row.innerHTML = `
    <span class="an-label">${esc(item.label)}</span>
    <button class="an-note"${canCapture ? '' : ' disabled title="Needs the live app — capture is unavailable in this preview"'}>Note for cleanup</button>`;
  if (canCapture) {
    const btn = row.querySelector('.an-note');
    // dispatch()'s synchronous {ok:true} only means the IPC call was SENT —
    // captureSave() returns the ipcRenderer.invoke() promise as `result`. That
    // promise can REJECT (fs.writeFileSync: permissions/disk, or no handler
    // registered on the other end) and it can also RESOLVE FALSY: main's
    // hq:capture-save returns `false` outright when the trimmed text is empty.
    // So awaiting settlement is not enough — the resolved VALUE decides, and a
    // `false` is funnelled into the same catch as a rejection so one path
    // re-enables the button instead of rendering a lie.
    //
    // WHY THERE IS NO SUCCESS STATE: verified live against the real bridge —
    // main's handler (dashboard/main.js hq:capture-save) ends with
    // spawnSync(assemble.mjs) → rebuildData() → win.reload(), and `win` is THIS
    // window. The reload tears the renderer down while we are still awaiting, so
    // the label below is never painted; what the user actually sees is the
    // in-flight 'Saving…' followed by a whole-dashboard reload back into Med-Bay
    // (realm restored from sessionStorage, scroll position lost). That reload
    // belongs to the shared capture pipeline — a main/struct-lane concern, not
    // this view's — so do NOT "fix" the missing confirmation here by adding a
    // toast or delaying the await: the honest fe-lane move is to promise only
    // the in-flight state, which is the one state that can actually be seen.
    btn.onclick = async () => {
      btn.disabled = true;
      btn.title = '';
      btn.textContent = 'Saving…';   // set BEFORE the await — see note above
      try {
        const r = dispatch('capture:note', { text: `Clean up: ${item.label}` });
        if (!r.ok) throw new Error(r.error || 'dispatch failed');
        const ok = await Promise.resolve(r.result);
        if (ok === false) throw new Error('capture refused');
        btn.textContent = 'Noted';   // usually preempted by main's win.reload()
      } catch (err) {
        // Visible, not just console-visible: a silent snap-back to the original
        // label is indistinguishable from a mis-click. Mirrors rx-run pushing
        // its error into .rx-out — here the row has no output slot, so the
        // button itself carries the verdict and the title carries the detail.
        console.warn('[medbay] capture:note failed', err);
        btn.disabled = false;
        btn.title = `Not saved — ${String(err?.message || err)}. Click to retry.`;
        btn.textContent = '✗ Not saved — retry';
      }
    };
  }
  return row;
}

function renderAnomalies(parent, S) {
  const an = anomalies(S);
  const ag = anomalyGroups(an);
  // TWO DIFFERENT CLAIMS, TWO DIFFERENT LINES — do not re-merge them with a '·'.
  // The item count and the reclaimable byte count come from disjoint sources and
  // describe disjoint work:
  //   · the rows are inventory.clones / .duplicates / .empty. Clone entries are
  //     {name, origin, dirty, diverged} and empty entries are bare strings —
  //     NEITHER carries a size field. There is no per-row byte figure to show.
  //   · the bytes are Σ projects[].disk.reclaimable_bytes — build artifacts in a
  //     handful of PRODUCTS, none of which appear in the rows below, freed by a
  //     different control entirely (the per-project purge button, hq.reclaim()).
  // Composed into one sentence they read as "work these rows, reclaim that much",
  // which is false: clearing all the rows frees ~0 bytes.
  const head = ag.total ? `Cleanup — ${fmt(ag.total)} item${ag.total === 1 ? '' : 's'}` : 'Cleanup';
  parent.appendChild(el('h2', 'sec', head));

  // Secondary, muted, and explicitly about something else. Omitted entirely when
  // there is nothing to reclaim. `products` is counted here rather than in
  // derive.anomalies() — that function is the struct lane's and its return shape
  // is contract; this is a view-local presentation detail.
  const bytes = Number(an.reclaimableBytes) || 0;
  const products = (S?.projects || [])
    .filter((p) => Number(p?.disk?.reclaimable_bytes) > 0).length;
  if (bytes > 0 && products > 0) {
    parent.appendChild(el('div', 'ghost-cap an-reclaim',
      `Separately: ~${esc(ag.reclaimableLabel)} of build artifacts reclaimable across ${fmt(products)} product${products === 1 ? '' : 's'} — freed per project, not from this list.`));
  }

  // Scoped to what the list is actually about. A bare "Nothing to clean up."
  // would contradict the reclaimable line directly above it whenever the rows
  // are empty but build artifacts are not.
  if (!ag.total) { parent.appendChild(el('div', 'an-empty', 'No clones, duplicates or empty folders to clear.')); return; }
  const wrap = el('div', 'an-groups');
  ag.groups.forEach((g) => {
    const block = el('div', 'an-group');
    block.appendChild(el('h3', 'an-group-h', `${esc(GROUP_LABEL[g.kind] || g.kind)} · ${fmt(g.count)}`));
    const list = el('div', 'an-list');
    g.items.forEach((item) => list.appendChild(anomalyRow(item)));
    block.appendChild(list);
    wrap.appendChild(block);
  });
  aosKids(wrap, 'fade-up', 30);
  parent.appendChild(wrap);
}

function render() {
  if (!root || !CTX) return;
  root.innerHTML = '';
  const ph = LIVE || CTX.data.bundle.pcHealth;
  if (ph && Array.isArray(ph.organs) && ph.organs.length) { renderAnatomy(root, ph); renderTreatments(root, ph); }
  else renderTriage(root);
  renderAnomalies(root, CTX.data.selected);
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
