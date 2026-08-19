// sessions.js — session history panel for AUTOMATE (v4.1 S4).
// Source of truth: dashboard-v3/src/realms/summoning/view.js (the sessions
// list). Data comes from state/live.js — the one boot-time subscriber to
// hq:claude-sessions — via the state object the view hands to render(); this
// module never subscribes to anything itself.
//
// What the list IS: the live session registry (running sessions + a ~60s
// linger for finished ones), not an archive — the panel's copy says so.
//
// UNTRUSTED TEXT: session labels/ids are esc()'d into innerHTML; session
// output (tail or live buffer) reaches the DOM through textContent only.
import { el, esc, clock, dur } from '../../ui/util.js';
import { getOutput } from '../../state/live.js';

function elapsed(s, now) {
  const t0 = Date.parse(s.startedAt || '');
  if (!Number.isFinite(t0)) return '';
  const t1 = s.status === 'running' ? now : (Date.parse(s.endedAt || s.startedAt || '') || now);
  return t1 >= t0 ? dur(t1 - t0) : '';
}

export function createSessionsPanel({ hq }) {
  const connected = typeof hq?.getSessions === 'function';
  let sessions = [];
  const openTails = new Set();        // jobIds whose output stays open across repaints

  const root = el('section', 'panel automate-sessions', `
    <div class="panel-head">
      <span class="panel-title">Sessions</span>
      <span class="panel-sub" data-count></span>
      <span class="spacer"></span>
      <span class="panel-sub" title="The live session registry: running sessions plus a short linger after they finish. Not an archive.">registry · live</span>
    </div>
    <div class="panel-body" data-list></div>`);
  const listEl = root.querySelector('[data-list]');
  const countEl = root.querySelector('[data-count]');

  function row(s) {
    const r = el('div', 'ss-row');
    r.dataset.status = s.status || 'running';
    r.dataset.job = s.jobId || '';
    const t0 = Date.parse(s.startedAt || '');
    const chipSev = s.status === 'failed' ? ' data-sev="red"' : s.status === 'done' ? '' : '';
    const chipText = s.status === 'running' ? 'Running'
      : s.status === 'done' ? 'Done'
      : `Failed${s.exitCode != null ? ` · exit ${esc(String(s.exitCode))}` : ''}`;
    r.innerHTML = `
      <div class="ss-top">
        <span class="chip ss-chip"${chipSev}>${chipText}</span>
        <span class="ss-label">${esc(s.label || s.jobId || 'session')}</span>
        <span class="meta ss-time" data-elapsed></span>
      </div>`;
    const meta = r.querySelector('[data-elapsed]');
    meta.textContent = `${Number.isFinite(t0) ? clock(t0) : '—'}${elapsed(s, Date.now()) ? ' · ' + elapsed(s, Date.now()) : ''}`;

    // Output: the 64KB live buffer holds what THIS window heard; the registry
    // keeps a rolling ~800-char tail for sessions that ran while it wasn't
    // listening. Show whichever exists and SAY which one it is.
    const live = getOutput(s.jobId);
    const text = live || s.tail || '';
    if (text) {
      const det = el('details', 'ss-out');
      if (openTails.has(s.jobId)) det.open = true;
      const sum = el('summary', null,
        `Output <span class="meta">· ${text.length} chars · ${live ? 'live (heard by this window)' : 'registry tail (last ~800 chars)'}</span>`);
      det.appendChild(sum);
      const pre = el('pre', 'term ss-pre');
      pre.textContent = text;                       // UNTRUSTED — textContent only
      det.appendChild(pre);
      det.addEventListener('toggle', () => { det.open ? openTails.add(s.jobId) : openTails.delete(s.jobId); });
      r.appendChild(det);
    }
    return r;
  }

  function render(list) {
    sessions = Array.isArray(list) ? list : [];
    listEl.innerHTML = '';
    const running = sessions.filter((s) => s.status === 'running').length;
    countEl.textContent = sessions.length ? `${running} running · ${sessions.length} tracked` : '';
    if (!connected) {
      listEl.appendChild(el('div', 'empty',
        'Not connected — this preview has no bridge to the session registry (window.hq is absent). ' +
        'In the live app, Claude sessions appear here as they run.'));
      return;
    }
    if (!sessions.length) {
      listEl.appendChild(el('div', 'empty',
        'No sessions tracked right now. Dispatch an agent from WORK, or run `claude` in a project — sessions appear here while they run (and linger a minute after).'));
      return;
    }
    const rank = (s) => (s.status === 'running' ? 0 : 1);
    const sorted = [...sessions].sort((a, b) =>
      rank(a) - rank(b) || (Date.parse(b.startedAt || '') || 0) - (Date.parse(a.startedAt || '') || 0));
    for (const s of sorted.slice(0, 50)) listEl.appendChild(row(s));
  }

  // Second-resolution elapsed labels for running rows — text nodes only,
  // driven by the view's single interval. Never a re-render (it would close
  // the output <details> mid-read).
  function tick() {
    if (!sessions.some((s) => s.status === 'running')) return;
    const now = Date.now();
    for (const r of listEl.querySelectorAll('.ss-row[data-status="running"]')) {
      const s = sessions.find((x) => x.jobId === r.dataset.job);
      if (!s) continue;
      const t0 = Date.parse(s.startedAt || '');
      const span = elapsed(s, now);
      const slot = r.querySelector('[data-elapsed]');
      if (slot) slot.textContent = `${Number.isFinite(t0) ? clock(t0) : '—'}${span ? ' · ' + span : ''}`;
    }
  }

  render([]);
  return { el: root, render, tick };
}
