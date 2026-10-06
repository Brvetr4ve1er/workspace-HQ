// TRUTH rail — the SENSE column. Four tiles, each one explicit about WHAT KIND
// of truth it is showing, because conflating the three is exactly how v3 turned
// a nightly photograph into a fake live dashboard:
//
//   SESSIONS · MACHINE · BROWSER   live push  (main -> this renderer)
//   SNAPSHOT                        slow truth (data/latest.json, a photograph)
//
// The live/stale dot reports ONE fact the renderer actually owns: how long ago
// THIS WINDOW last received a push on that channel. It never claims anything
// about the health of the far end, and each tile's title spells that out.
import { el, esc, dur, fmt } from '../../ui/util.js';

const LIVE_MS = 120000;   // a push newer than this reads as "live"

// Observed, not guessed: dashboard/main.js pushMachine() sends hq:machine to
// miniWin only (and only while the mini HUD is visible), so the main window
// never receives one. The tile therefore states that instead of sitting in a
// permanent "waiting…" that would be a lie — and it still renders a real
// payload if one ever arrives, so this degrades correctly if main changes.
const MACHINE_NOTE = 'No sample on this window: main pushes hq:machine to the mini HUD only (dashboard/main.js pushMachine). Nothing here is stale — nothing was ever sent.';

export function createTruthRail(api) {
  // api: { hq, scan, alive() }
  const hq = api.hq;
  const at = { sessions: 0, machine: 0, browser: 0 };
  let state = { sessions: [], machine: null, browser: null };

  const root = el('section', 'panel work-truth', `
    <div class="panel-head">
      <span class="panel-title">Truth</span>
      <span class="spacer"></span>
      <span class="panel-sub">live · snapshot</span>
    </div>
    <div class="panel-body">
      <div class="truth-tile" data-t="sessions"></div>
      <div class="truth-tile" data-t="machine"></div>
      <div class="truth-tile" data-t="browser"></div>
      <div class="truth-tile" data-t="snapshot"></div>
    </div>`);

  const tile = (k) => root.querySelector(`[data-t="${k}"]`);

  // head = name + dot + age. `avail` false renders the dashed "no channel" dot.
  // The age wording distinguishes three genuinely different states, because
  // collapsing them is how a rail starts lying:
  //   stamp>0   -> this view saw the push, N ago
  //   hasData   -> data arrived BEFORE this view mounted (live.js subscribes at
  //                boot and keeps state across surface switches), age unknown
  //   otherwise -> nothing has ever arrived on this channel
  function head(node, name, avail, stamp, why, hasData) {
    const now = Date.now();
    const live = avail && stamp > 0 && (now - stamp) < LIVE_MS;
    const age = stamp ? `${dur(now - stamp)} ago`
      : (!avail ? 'no channel' : (hasData ? 'before this panel opened' : 'no push yet'));
    const h = el('div', 'truth-head', `
      <span class="pulse-dot" data-live="${avail ? (live ? 'yes' : 'no') : 'none'}"></span>
      <span class="truth-name">${esc(name)}</span>
      <span class="truth-age" data-stamp="${stamp || 0}">${esc(age)}</span>`);
    h.title = why;
    node.appendChild(h);
    return h;
  }

  function renderSessions() {
    const n = tile('sessions');
    n.innerHTML = '';
    const avail = typeof hq?.onClaudeSessions === 'function';
    const list = Array.isArray(state.sessions) ? state.sessions : [];
    head(n, 'Agent sessions', avail, at.sessions,
      avail
        ? 'Time since this window last received an hq:claude-sessions push. The channel only pushes when the registry CHANGES, so a long gap means "quiet", not "broken".'
        : 'This preview has no bridge — hq.onClaudeSessions is absent, so no session presence can be received.',
      list.length > 0);
    const running = list.filter((s) => s?.status === 'running').length;
    const body = el('div', 'truth-body');
    body.innerHTML = `
      <div class="truth-figs">
        <div class="truth-fig"><span class="figure" data-sev="${running ? 'red' : 'dim'}">${running}</span><span class="figure-label">running</span></div>
        <div class="truth-fig"><span class="figure" data-sev="dim">${list.length}</span><span class="figure-label">tracked</span></div>
      </div>`;
    n.appendChild(body);
  }

  function renderMachine() {
    const n = tile('machine');
    n.innerHTML = '';
    const m = state.machine;
    head(n, 'Machine', !!m, at.machine, m
      ? 'Time since this window last received an hq:machine push.'
      : MACHINE_NOTE, !!m);
    const body = el('div', 'truth-body');
    if (!m || typeof m !== 'object') {
      body.innerHTML = `<div class="meta">${esc(MACHINE_NOTE)}</div>`;
    } else {
      const bar = (k, v) => `
        <div class="truth-kv"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}%</span></div>
        <div class="meter"><i style="width:${Math.max(0, Math.min(100, Number(v) || 0))}%"></i></div>`;
      body.innerHTML = `
        ${bar('cpu', m.cpu ?? 0)}
        ${bar('ram', m.ram ?? 0)}
        <div class="truth-kv" style="margin-top:8px"><span class="k">dev servers</span><span class="v">${esc(String(m.servers ?? 0))}</span></div>`;
    }
    n.appendChild(body);
  }

  function renderBrowser() {
    const n = tile('browser');
    n.innerHTML = '';
    const avail = typeof hq?.onBrowserTab === 'function';
    const b = state.browser;
    head(n, 'Active tab', avail, at.browser, avail
      ? 'Time since this window last received an hq:browser-tab push from the bridge extension. No push means the extension is idle, paused, or not installed.'
      : 'This preview has no bridge — hq.onBrowserTab is absent.', !!b);
    const body = el('div', 'truth-body');
    if (!b || typeof b !== 'object') {
      body.innerHTML = `<div class="meta">${avail ? 'No tab reported yet — the browser bridge extension pushes only while a tab is focused.' : 'Unavailable in this preview.'}</div>`;
    } else {
      const focus = Number(b.focus_ms);
      body.innerHTML = `
        <div class="body">${esc(b.title || b.url || 'untitled tab')}</div>
        <div class="truth-kv" style="margin-top:6px"><span class="k">${esc(b.domain || b.host || '—')}</span><span class="v">${Number.isFinite(focus) ? esc(dur(focus)) : ''}</span></div>`;
    }
    n.appendChild(body);
  }

  function renderSnapshot() {
    const n = tile('snapshot');
    n.innerHTML = '';
    const h = el('div', 'truth-head', `
      <span class="pulse-dot" data-live="none"></span>
      <span class="truth-name">Snapshot</span>
      <span class="truth-age">not live</span>`);
    h.title = 'The nightly scan (data/latest.json). It is a photograph of the disk at scan time, never a live reading — that is why it has no pulse.';
    n.appendChild(h);
    const s = api.scan;
    const body = el('div', 'truth-body');
    if (!s) {
      body.innerHTML = '<div class="meta">No scan data in this build.</div>';
    } else {
      const open = (s.quests || []).filter((q) => q?.status === 'open' || q?.status === 'in_progress').length;
      body.innerHTML = `
        <div class="truth-kv"><span class="k">scan</span><span class="v">${esc(s.scan?.id ?? '—')}</span></div>
        <div class="truth-kv"><span class="k">projects</span><span class="v">${esc(fmt((s.projects || []).length))}</span></div>
        <div class="truth-kv"><span class="k">open quests</span><span class="v">${esc(fmt(open))}</span></div>`;
    }
    n.appendChild(body);
  }

  // changed: { sessions?, machine?, browser? } — reference comparison done by
  // the caller, so the stamps record real receipts, not re-renders.
  // stamp=false is the MOUNT-TIME call: it paints whatever live.js already
  // holds without claiming this view just received it.
  function sync(next, changed, stamp = true) {
    state = next;
    const now = Date.now();
    if (changed.sessions) { if (stamp) at.sessions = now; renderSessions(); }
    if (changed.machine)  { if (stamp) at.machine = now;  renderMachine(); }
    if (changed.browser)  { if (stamp) at.browser = now;  renderBrowser(); }
  }

  // Ages tick without a re-render: only the text of the stamp elements moves.
  function tick() {
    const now = Date.now();
    for (const ageEl of root.querySelectorAll('[data-stamp]')) {
      const stamp = Number(ageEl.dataset.stamp) || 0;
      if (!stamp) continue;
      ageEl.textContent = `${dur(now - stamp)} ago`;
      const dot = ageEl.parentElement?.querySelector('.pulse-dot');
      if (dot && dot.dataset.live !== 'none') dot.dataset.live = (now - stamp) < LIVE_MS ? 'yes' : 'no';
    }
  }

  renderSessions();
  renderMachine();
  renderBrowser();
  renderSnapshot();

  return { el: root, sync, tick };
}
