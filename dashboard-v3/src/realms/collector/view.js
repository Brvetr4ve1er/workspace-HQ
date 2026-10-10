// COLLECT realm — tab host. Header (lead + status plates), the one-time
// permission notice, and five panes: Inbox · Queue · Library · Sources ·
// Settings. The active tab and every pane's state live at module scope, so
// the theme-change force-remount (shell.js) loses nothing.
//
// Lifecycle: mount() subscribes to the realm bus; unmount() drains every
// disposer, unmounts the active pane, and removes realm overlays (toasts,
// confirm). The app-lifetime bridge subscription lives in store.js.
import { state, api, available, cbus, ready, queueSummary, saveSettings } from './store.js';
import { T } from './strings.js';
import { node, nodeHtml, html, ico, fmtBytes, toast, disposeOverlays } from './ui.js';
import * as inbox from './panes/inbox.js';
import * as queue from './panes/queue.js';
import * as library from './panes/library.js';
import * as sources from './panes/sources.js';
import * as settings from './panes/settings.js';

const PANES = { inbox, queue, library, sources, settings };
let tab = 'inbox';
let root = null, body = null, active = null, offs = [], lastAck = null;

function ctx() { return { T, api, state, cbus, go }; }

function go(id) {
  if (!PANES[id]) return;
  tab = id;
  try { sessionStorage.setItem('hq-collector-tab', id); } catch {}
  paintTabs();
  mountPane();
}

function mountPane() {
  if (active) { try { active.unmount(); } catch (err) { console.error('[collector] pane unmount', err); } active = null; }
  body.innerHTML = '';
  const p = PANES[tab];
  try { p.mount(body, ctx()); active = p; }
  catch (err) {
    console.error('[collector] pane mount', tab, err);
    body.appendChild(nodeHtml('div', 'empty-note', html`This tab hit an error: ${String(err && err.message || err)}`));
  }
}

function paintTabs() {
  const s = queueSummary();
  root.querySelectorAll('.mc-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
  });
  const qb = root.querySelector('.mc-tabs [data-tab=queue] .mc-tab-n');
  if (qb) { const n = s.active + s.queued; qb.textContent = n ? String(n) : ''; }
  const lb = root.querySelector('.mc-tabs [data-tab=library] .mc-tab-n');
  if (lb) lb.textContent = state.library.length ? String(state.library.length) : '';
}

function paintPlates() {
  const p = root && root.querySelector('.mc-plates'); if (!p) return;
  const s = queueSummary();
  const dest = (state.settings && state.settings.destination) || '';
  p.innerHTML = html`
    <div class="mc-plate${s.active ? ' live' : ''}"><small>${T('plate_active')}</small><b>${s.active}${s.queued ? html` <span>+${s.queued}</span>` : ''}</b><div class="mc-bar"><i style="width:${s.pct == null ? (s.active ? 30 : 0) : s.pct}%"></i></div></div>
    <div class="mc-plate"><small>${T('plate_saved')}</small><b>${state.savedThisSession}</b></div>
    <button class="mc-plate dest" id="mc-dest" title="${dest}"><small>${T('plate_dest')}</small><b>${dest.length > 34 ? '…' + dest.slice(-33) : dest}</b></button>`.toString();
  p.querySelector('#mc-dest').onclick = () => api.openDestination();
}

function ackCard() {
  const card = nodeHtml('div', 'mc-ack', html`
    <div class="mc-ack-h">${T('ack_h')}</div>
    <p>${T('ack_body')}</p>
    <label class="mc-check"><input type="checkbox" id="mc-ack-cb" /> <span>${T('ack_check')}</span></label>
    <div class="mc-btn-row"><button class="mc-btn primary" id="mc-ack-go" disabled>${T('ack_go')}</button></div>`.toString());
  const cb = card.querySelector('#mc-ack-cb'), go_ = card.querySelector('#mc-ack-go');
  cb.onchange = () => { go_.disabled = !cb.checked; };
  go_.onclick = async () => { await saveSettings({ acknowledgedAt: true }); };   // settings event re-renders
  return card;
}

function render() {
  root.innerHTML = '';
  const head = nodeHtml('div', 'mc-head', html`
    <div class="mc-head-l"><h2 class="sec">COLLECT <span class="mc-ver">${state.info ? 'v' + state.info.version : ''}</span></h2><p class="mc-lead">${T('lead')}</p></div>
    <div class="mc-plates"></div>`.toString());
  root.appendChild(head);
  if (!available) {
    root.appendChild(nodeHtml('div', 'empty-note mc-offline', html`<b>${T('offline_h')}</b><br>${T('offline_body')}`.toString()));
    return;
  }
  if (state.initError) {
    const e = state.initError;
    root.appendChild(nodeHtml('div', 'mc-note err', html`<span class="mc-code">${e.code}</span><div><b>${e.message}</b>${e.detail ? html` <span class="mc-faint">(${e.detail})</span>` : ''}</div>${e.next ? html`<div class="mc-next">${e.next}</div>` : ''}`.toString()));
    return;
  }
  if (!state.ready) { root.appendChild(node('div', 'empty-note', 'Loading…')); ready().then(() => { if (root) render(); }); return; }
  lastAck = !!(state.settings && state.settings.acknowledgedAt);
  if (!lastAck) { root.appendChild(ackCard()); return; }
  const tabs = nodeHtml('div', 'mc-tabs', html`${['inbox', 'queue', 'library', 'sources', 'settings'].map((id) => html`<button data-tab="${id}" role="tab">${T('tab_' + id)}<span class="mc-tab-n"></span></button>`)}`.toString());
  tabs.setAttribute('role', 'tablist');
  tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
  root.appendChild(tabs);
  body = node('div', 'mc-body'); root.appendChild(body);
  paintPlates(); paintTabs(); mountPane();
}

export const view = {
  mount(stage, _hqCtx) {
    try { tab = sessionStorage.getItem('hq-collector-tab') || tab; } catch {}
    if (!PANES[tab]) tab = 'inbox';
    root = node('div', 'mc'); stage.appendChild(root);
    render();
    offs.push(cbus.on('queue', () => { if (!root) return; paintPlates(); if (body) paintTabs(); }));
    offs.push(cbus.on('job', () => { if (root) paintPlates(); }));
    offs.push(cbus.on('library', () => { if (root && body) paintTabs(); }));
    offs.push(cbus.on('settings', (s) => { if (!root) return; const ack = !!(s && s.acknowledgedAt); if (lastAck !== null && ack !== lastAck) { lastAck = ack; render(); } else { lastAck = ack; paintPlates(); } }));
    offs.push(cbus.on('job:done', (j) => toast(T('toast_saved', { name: j.name || '' }), { kind: 'ok', action: { label: T('queue_show_folder'), fn: () => api.showInFolder(j.id) } })));
  },
  unmount() {
    for (const off of offs) off(); offs = [];
    if (active) { try { active.unmount(); } catch {} active = null; }
    disposeOverlays();
    root = null; body = null;
  },
};
