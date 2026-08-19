// SYSTEM · MACHINE — the PC-health section. Content ported from v3
// realms/medbay/view.js (vitals, diagnoses, teaching notes, fix scripts,
// cleanup) and rebuilt on the v4 component language: .panel / .figure /
// .chip / .btn from styles/components.css, plus the section-local classes in
// styles/system.css. No v3 markup survives; every v3 FACT does.
//
// Reads DATA.pcHealth (struct-lane contract, collector/pc-health.mjs):
//   { scanned_at, host, organs:[{id,label,status,value,unit,spark,diagnosis,
//     teaching,fixes:[{title,why,teaching,command,danger}]}] }
// Unknown organ ids still render (fallback tag, auto grid slot) — additive-safe.
import { el, esc, COL, fmt } from '../../ui/util.js';
import { dispatch } from '../../core/actions.mjs';
import { anomalies } from '../../intel/derive.mjs';
import { anomalyGroups } from '../../intel/foresight.mjs';

// The data contract keeps the grace/ember/blood keys; the display word is plain.
const STATUS = {
  grace: { sev: 'dim',    c: COL.green,  word: 'HEALTHY' },
  ember: { sev: 'orange', c: COL.orange, word: 'WARNING' },
  blood: { sev: 'red',    c: COL.red,    word: 'CRITICAL' },
};

// organ id → anatomical caption. A quiet nod to v3's body map: v4 lays the
// cards out on a plain responsive grid (the isometric body was v3 chrome), but
// the caption is CONTENT and stays. Ids outside this table render as SYSTEM.
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

// Tiny inline pulse — 120×26, numbers only in, so no escaping question can
// arise: every value is coerced through Number and dropped unless finite.
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

// A fresh health scan overrides the build-time snapshot. Module scope so the
// fresher reading survives a tab switch / surface re-mount inside one app run —
// it carries its own scanned_at, so nothing can pass it off as the old one.
let LIVE = null;

const DANGER = {
  safe:    { cls: 'dg-safe',    label: 'read-only' },
  caution: { cls: 'dg-caution', label: 'deletes files' },
  admin:   { cls: 'dg-admin',   label: 'needs admin' },
};
const SEV = { blood: 0, ember: 1, grace: 2 };
const GROUP_LABEL = { clone: 'Cloned repos', duplicate: 'Duplicates', empty: 'Empty folders' };

// Why a non-safe fix has no RUN button, stated where the user reads it:
// dashboard/main.js's hq:health-fix handler rebuilds the whitelist from
// pc-health.json on every call and executes ONLY commands whose danger is
// 'safe'. A RUN button on a caution/admin fix would be a lying control — it
// could only ever come back "refused".
const MANUAL_WHY = 'The fix engine only executes read-only fixes (main re-checks the whitelist on every call), so this one is copy-and-run-yourself.';
const NO_BRIDGE_WHY = 'Needs the live app — the health-fix bridge is unavailable in this preview. COPY still works.';

export function createMachineSection(api) {
  // api: { hq, data, alive() }
  const root = el('div', 'sys-sec');
  let dead = false;
  const usable = () => !dead && api.alive() && root.isConnected;

  // ---------------------------------------------------------------- vitals
  function scanButton(label) {
    const btn = el('button', 'btn btn--sm', esc(label));
    if (typeof api.hq?.healthScan !== 'function') {
      btn.disabled = true;
      btn.title = 'Needs the live app — the health-scan bridge is unavailable in this preview.';
      return btn;
    }
    btn.title = 'Run a fresh health scan of this machine (~3s)';
    btn.onclick = async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = 'Scanning…';           // set BEFORE the await: this is the only state the user is guaranteed to see
      try {
        const fresh = await api.hq.healthScan();
        if (!usable()) return;                 // torn down mid-scan: touch nothing
        if (fresh?.organs) { LIVE = fresh; render(); return; }
        btn.title = 'The scan returned no vitals — nothing to update.';
      } catch (err) {
        console.warn('[system] healthScan failed', err);
        if (!usable()) return;
        btn.title = `Scan failed — ${String(err?.message || err)}. Click to retry.`;
      }
      btn.disabled = false;
      btn.textContent = prev;
    };
    return btn;
  }

  function organCard(o, dayKey) {
    const st = STATUS[o.status] || STATUS.ember;
    const an = ANATOMY[o.id];
    const card = el('div', 'organ');
    card.dataset.sev = st.sev;
    card.style.setProperty('--oc', st.c);
    const val = typeof o.value === 'number' && Number.isFinite(o.value)
      ? (Number.isInteger(o.value) ? fmt(o.value) : o.value.toFixed(1))
      : esc(String(o.value ?? '—'));
    const lines = TEACHING[o.id];
    const teach = o.teaching ? esc(o.teaching) : (lines ? lines[hash(String(o.id) + dayKey) % lines.length] : '');
    card.innerHTML = `
      <div class="organ-top">
        <span class="eyebrow organ-tag">${an ? an.tag : 'SYSTEM'}</span>
        <span class="organ-name" title="${esc(o.label || o.id)}">${esc(o.label || o.id)}</span>
        <span class="chip" data-sev="${st.sev}">${st.word}</span>
      </div>
      <div class="organ-read">
        <span class="figure" data-sev="${st.sev}">${val}</span>
        ${o.unit ? `<span class="figure-label">${esc(o.unit)}</span>` : ''}
      </div>
      ${spark(o.spark, st.c)}
      ${o.diagnosis ? `<div class="body organ-dx">${esc(o.diagnosis)}</div>` : ''}
      ${teach ? `<div class="meta organ-tx">${teach}</div>` : ''}`;
    return card;
  }

  function renderVitals(parent, ph) {
    // pc-health.json is a young struct contract — a shapeless entry must not
    // blank the panel while the shape settles.
    const organs = ph.organs.filter((o) => o && typeof o === 'object');
    const counts = { grace: 0, ember: 0, blood: 0 };
    organs.forEach((o) => { if (counts[o.status] != null) counts[o.status]++; });
    const when = String(ph.scanned_at || '').slice(0, 16).replace('T', ' ');
    const h = ph.host || {};
    const hostLine = [h.cpu, Number.isFinite(h.ramGB) ? `${h.ramGB} GB RAM` : null,
      Number.isFinite(h.uptimeHrs) ? `up ${Math.round(h.uptimeHrs)}h` : null,
      Number.isFinite(h.battery) ? `battery ${h.battery}%` : null].filter(Boolean).join(' · ');

    const panel = el('section', 'panel panel--focal', `
      <div class="panel-head">
        <span class="panel-title">Machine</span>
        <span class="panel-sub">${esc(when) || 'no timestamp'}</span>
        <span class="spacer"></span>
      </div>
      <div class="panel-body">
        <div class="sys-tally">
          <span class="chip" data-sev="dim">${counts.grace} healthy</span>
          <span class="chip" data-sev="orange">${counts.ember} warning</span>
          <span class="chip" data-sev="red">${counts.blood} critical</span>
          ${hostLine ? `<span class="meta sys-host">${esc(hostLine)}</span>` : ''}
        </div>
        <div class="organ-grid"></div>
      </div>`);
    panel.querySelector('.panel-head').appendChild(scanButton('Re-examine'));
    const grid = panel.querySelector('.organ-grid');
    const dayKey = String(ph.scanned_at || '').slice(0, 10);
    organs.forEach((o) => grid.appendChild(organCard(o, dayKey)));
    parent.appendChild(panel);
  }

  // ---- no-scan state: the eight vitals are named and positioned, waiting ----
  const EKG_PATH = 'M0,14 H60 L66,4 L72,24 L78,14 H140 L144,10 L148,14 H220 L226,4 L232,24 L238,14 H300 L304,10 L308,14 H380 L386,4 L392,24 L398,14 H480';

  function renderTriage(parent) {
    const canScan = typeof api.hq?.healthScan === 'function';
    const panel = el('section', 'panel panel--focal', `
      <div class="panel-head">
        <span class="panel-title">Machine</span>
        <span class="panel-sub">no scan yet</span>
        <span class="spacer"></span>
      </div>
      <div class="panel-body">
        <div class="mb-empty">
          <svg class="ekg" viewBox="0 0 480 28" preserveAspectRatio="none" aria-hidden="true">
            <path class="ekg-base" d="${EKG_PATH}"/>
            <path class="ekg-line" d="${EKG_PATH}"/>
          </svg>
          <div class="mb-empty-title">No health scan yet</div>
          <div class="body mb-empty-sub">${canScan
            ? 'Run a scan to check CPU, memory, GPU, disk, network, startup, updates and temperature.'
            : "This machine hasn't been scanned yet, so there are no vitals to show. The eight system vitals below populate once scanning is available."}</div>
        </div>
        <div class="eyebrow sys-ghost-cap">Eight system vitals, awaiting the first scan</div>
        <div class="organ-grid"></div>
      </div>`);
    panel.querySelector('.panel-head').appendChild(scanButton('Run scan'));
    const grid = panel.querySelector('.organ-grid');
    for (const [id, an] of Object.entries(ANATOMY)) {
      grid.appendChild(el('div', 'organ is-ghost', `
        <div class="organ-top">
          <span class="eyebrow organ-tag">${an.tag}</span>
          <span class="organ-name">${an.label}</span>
        </div>
        <div class="organ-read"><span class="figure" data-sev="dim">—</span></div>
        <div class="meta organ-dx">Awaiting scan</div>`));
    }
    parent.appendChild(panel);
  }

  // ------------------------------------------------------- recommended fixes
  // Each organ carries curated `fixes`. COPY hands you the exact PowerShell;
  // RUN executes ONLY danger:'safe' fixes, and only after main re-validates the
  // command against the current pc-health.json — the renderer can never smuggle
  // an arbitrary command through. Most urgent organs prescribe first.
  function fixCard(fix, organ) {
    const dg = DANGER[fix.danger] || DANGER.caution;
    const runnable = fix.danger === 'safe' && typeof api.hq?.healthFix === 'function';
    const card = el('div', 'rx');
    card.innerHTML = `
      <div class="rx-top">
        <span class="rx-organ" style="--oc:${(STATUS[organ.status] || STATUS.ember).c}">${esc(organ.label || organ.id)}</span>
        <span class="rx-title">${esc(fix.title)}</span>
        <span class="chip rx-danger ${dg.cls}">${dg.label}</span>
      </div>
      <div class="body rx-why">${esc(fix.why || '')}</div>
      ${fix.teaching ? `<div class="meta rx-teach">${esc(fix.teaching)}</div>` : ''}
      <div class="rx-cmd"><code>${esc(fix.command)}</code></div>
      <div class="rx-act"></div>
      <pre class="term rx-out" hidden></pre>`;
    const out = card.querySelector('.rx-out');
    const acts = card.querySelector('.rx-act');

    const copy = el('button', 'btn btn--sm rx-copy', '⧉ COPY');
    copy.title = 'Copy this command to the clipboard';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(String(fix.command)); if (usable()) copy.textContent = '✓ COPIED'; }
      catch (err) { console.warn('[system] clipboard', err); if (usable()) copy.textContent = '✗ COPY FAILED'; }
      setTimeout(() => { if (usable()) copy.textContent = '⧉ COPY'; }, 1400);
    };
    acts.appendChild(copy);

    const run = el('button', 'btn btn--sm rx-run', '▶ RUN');
    if (!runnable) {
      // Disabled-with-a-reason rather than absent: the control's existence is
      // the honest signal that this fix COULD be run — just not from here.
      run.disabled = true;
      run.title = fix.danger === 'safe' ? NO_BRIDGE_WHY : MANUAL_WHY;
    } else {
      run.title = 'Runs this read-only command through the app (main re-checks the whitelist first)';
      run.onclick = async () => {
        run.disabled = true;
        run.textContent = '▶ running…';        // before the await — the in-flight state is the one that is guaranteed to paint
        out.hidden = false;
        out.textContent = '…';
        try {
          const r = await api.hq.healthFix(fix.command);
          if (!usable()) return;
          out.textContent = String(r?.output || '').trim() || (r?.ok ? '(done — no output)' : 'refused or failed.');
          out.classList.toggle('is-err', !r?.ok);
        } catch (err) {
          console.warn('[system] healthFix failed', err);
          if (!usable()) return;
          out.textContent = String(err?.message || err);
          out.classList.add('is-err');
        }
        run.disabled = false;
        run.textContent = '▶ RUN';
      };
    }
    acts.appendChild(run);
    return card;
  }

  function renderFixes(parent, ph) {
    const organs = (ph.organs || []).filter((o) => o && Array.isArray(o.fixes) && o.fixes.length);
    if (!organs.length) return;
    const ranked = [...organs].sort((a, b) => (SEV[a.status] ?? 3) - (SEV[b.status] ?? 3));
    const total = ranked.reduce((n, o) => n + o.fixes.length, 0);
    const panel = el('section', 'panel', `
      <div class="panel-head">
        <span class="panel-title">Recommended fixes</span>
        <span class="panel-sub">${total} script${total === 1 ? '' : 's'} · most urgent first</span>
      </div>
      <div class="panel-body"><div class="rx-list"></div></div>`);
    const list = panel.querySelector('.rx-list');
    ranked.forEach((o) => o.fixes.forEach((f) => { if (f && typeof f === 'object') list.appendChild(fixCard(f, o)); }));
    parent.appendChild(panel);
  }

  // ------------------------------------------------------------- cleanup
  function anomalyRow(item) {
    const canCapture = typeof api.hq?.captureSave === 'function';
    const row = el('div', 'an-item', `<span class="body an-label">${esc(item.label)}</span>`);
    const btn = el('button', 'btn btn--sm an-note', 'Note for cleanup');
    if (!canCapture) {
      btn.disabled = true;
      btn.title = 'Needs the live app — capture is unavailable in this preview.';
    } else {
      btn.title = 'Writes a capture note so this shows up in your queue';
      // dispatch()'s synchronous {ok:true} only means the IPC call was SENT —
      // captureSave() returns the ipcRenderer.invoke() promise as `result`. That
      // promise can REJECT (fs write: permissions/disk, or no handler on the
      // other end) and it can also RESOLVE FALSY: main's hq:capture-save returns
      // `false` outright when the trimmed text is empty. So awaiting settlement
      // is not enough — the resolved VALUE decides, and a `false` is funnelled
      // into the same catch as a rejection so one path re-enables the button
      // instead of rendering a lie.
      //
      // WHY THERE IS NO SUCCESS STATE (verified against the real bridge): main's
      // hq:capture-save handler ends with spawnSync(assemble.mjs) → rebuildData()
      // → win.reload(), and `win` is THIS window. The reload tears the renderer
      // down while we are still awaiting, so a success label would never paint;
      // what the user actually sees is 'Saving…' followed by a whole-dashboard
      // reload. That reload belongs to the shared capture pipeline (a main-lane
      // concern), so do NOT "fix" the missing confirmation here with a toast —
      // the honest move is to promise only the state that can be seen.
      btn.onclick = async () => {
        btn.disabled = true;
        btn.title = '';
        btn.textContent = 'Saving…';
        try {
          const r = dispatch('capture:note', { text: `Clean up: ${item.label}` });
          if (!r.ok) throw new Error(r.error || 'dispatch failed');
          const ok = await Promise.resolve(r.result);
          if (ok === false) throw new Error('capture refused');
          if (!usable()) return;
          btn.textContent = 'Noted';           // usually preempted by main's win.reload()
        } catch (err) {
          // Visible, not just console-visible: a silent snap-back to the original
          // label is indistinguishable from a mis-click.
          console.warn('[system] capture:note failed', err);
          if (!usable()) return;
          btn.disabled = false;
          btn.title = `Not saved — ${String(err?.message || err)}. Click to retry.`;
          btn.textContent = '✗ Not saved — retry';
        }
      };
    }
    row.appendChild(btn);
    return row;
  }

  function renderCleanup(parent, S) {
    const an = anomalies(S);
    const ag = anomalyGroups(an);
    // TWO DIFFERENT CLAIMS, TWO DIFFERENT LINES — do not re-merge them with a '·'.
    // The item count and the reclaimable byte count come from disjoint sources
    // and describe disjoint work:
    //   · the rows are inventory.clones / .duplicates / .empty. Clone entries are
    //     {name, origin, dirty, diverged} and empty entries are bare strings —
    //     NEITHER carries a size field. There is no per-row byte figure to show.
    //   · the bytes are Σ projects[].disk.reclaimable_bytes — build artifacts in a
    //     handful of PRODUCTS, none of which appear in the rows below, freed by a
    //     different control entirely (the per-project purge, hq.reclaim()).
    // Composed into one sentence they read as "work these rows, reclaim that
    // much", which is false: clearing every row frees ~0 bytes.
    const panel = el('section', 'panel', `
      <div class="panel-head">
        <span class="panel-title">Cleanup</span>
        <span class="panel-sub">${ag.total ? `${fmt(ag.total)} item${ag.total === 1 ? '' : 's'}` : 'nothing listed'}</span>
      </div>
      <div class="panel-body"></div>`);
    const body = panel.querySelector('.panel-body');

    // Secondary, muted, and explicitly about something else. Omitted entirely
    // when there is nothing to reclaim. `products` is counted here rather than
    // in derive.anomalies() — that function is the struct lane's and its return
    // shape is contract; this is a view-local presentation detail.
    const bytes = Number(an.reclaimableBytes) || 0;
    const products = (S?.projects || []).filter((p) => Number(p?.disk?.reclaimable_bytes) > 0).length;
    if (bytes > 0 && products > 0) {
      body.appendChild(el('div', 'meta an-reclaim',
        `Separately: ~${esc(ag.reclaimableLabel)} of build artifacts reclaimable across ${fmt(products)} product${products === 1 ? '' : 's'} — freed per project, not from this list.`));
    }

    // Scoped to what the list is actually about. A bare "Nothing to clean up."
    // would contradict the reclaimable line directly above it whenever the rows
    // are empty but build artifacts are not.
    if (!ag.total) {
      body.appendChild(el('div', 'empty', 'No clones, duplicates or empty folders to clear.'));
      parent.appendChild(panel);
      return;
    }
    for (const g of ag.groups) {
      const block = el('div', 'an-group', `<div class="an-group-h">${esc(GROUP_LABEL[g.kind] || g.kind)} <span class="an-group-n">${fmt(g.count)}</span></div>`);
      const list = el('div', 'an-list');
      g.items.forEach((item) => list.appendChild(anomalyRow(item)));
      block.appendChild(list);
      body.appendChild(block);
    }
    parent.appendChild(panel);
  }

  // ---------------------------------------------------------------- render
  function render() {
    root.innerHTML = '';                       // every handler here is a property on a node inside root — the rebuild drops them
    const ph = LIVE || api.data?.bundle?.pcHealth;
    if (ph && Array.isArray(ph.organs) && ph.organs.length) { renderVitals(root, ph); renderFixes(root, ph); }
    else renderTriage(root);
    renderCleanup(root, api.data?.selected);
  }

  render();
  return { el: root, dispose() { dead = true; } };
}

// test/harness hook: forget a fresh in-session health scan.
export function _resetLive() { LIVE = null; }
