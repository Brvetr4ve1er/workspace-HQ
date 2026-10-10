// Queue — per-item status, progress, speed, pause/resume/cancel/retry/remove,
// conflict decisions (skip / rename / replace), open / reveal on success, and
// the bulk verbs. Rows reconcile by job id; progress ticks patch in place.
import { html, ico, node, nodeHtml, fmtBytes, fmtSpeed, shortUrl, confirmBox, openDrawer, kindIcon } from '../ui.js';

let C = null, root = null, list = null, offs = [];
const asked = new Set();   // conflict prompts already shown (survives repaints, not reloads)
const ST = { done: 'green', failed: 'red', conflict: 'orange', running: 'accent' };

function render() {
  const { T, api, state } = C;
  root.innerHTML = '';
  const bar = nodeHtml('div', 'mc-toolbar', html`
    <span class="mc-count left">${state.queue.length} ${state.queue.length === 1 ? 'job' : 'jobs'}</span>
    <button class="mc-btn sm" id="mc-pa">${ico('mc-pause', 12)}${T('queue_pause_all')}</button>
    <button class="mc-btn sm" id="mc-ra">${ico('mc-play', 12)}${T('queue_resume_all')}</button>
    <button class="mc-btn sm quiet" id="mc-cl">${T('queue_clear_done')}</button>`.toString());
  bar.querySelector('#mc-pa').onclick = () => api.queuePauseAll();
  bar.querySelector('#mc-ra').onclick = () => api.queueResumeAll();
  bar.querySelector('#mc-cl').onclick = () => api.queueClear();
  root.appendChild(bar);
  list = node('div', 'mc-list'); root.appendChild(list);
  reconcile();
}

function reconcile() {
  const { T, state } = C;
  const q = state.queue;
  const cnt = root.querySelector('.mc-count.left'); if (cnt) cnt.textContent = `${q.length} ${q.length === 1 ? 'job' : 'jobs'}`;
  if (!q.length) { list.innerHTML = ''; list.appendChild(node('div', 'empty-note', T('queue_empty'))); return; }
  list.querySelector('.empty-note')?.remove();
  const seen = new Set();
  q.forEach((j, i) => {
    seen.add(j.id);
    let row = list.querySelector(`[data-jid="${CSS.escape(j.id)}"]`);
    if (!row || row.dataset.status !== j.status) { const fresh = buildRow(j); if (row) row.replaceWith(fresh); else list.appendChild(fresh); row = fresh; }
    else paint(row, j);
    if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
  });
  for (const row of [...list.querySelectorAll('[data-jid]')]) if (!seen.has(row.dataset.jid)) row.remove();
}

function buildRow(j) {
  const { T, api } = C;
  const row = node('div', `mc-row mc-job st-${j.status}`); row.dataset.jid = j.id; row.dataset.status = j.status;
  row.innerHTML = html`
    <div class="mc-job-ico">${ico(kindIcon(j.kind), 20)}</div>
    <div class="mc-job-main">
      <div class="mc-job-top"><span class="mc-title" title="${j.sourceUrl}">${j.name || j.title || shortUrl(j.sourceUrl, 50)}</span><span class="mc-tag ${ST[j.status] || ''}">${T('st_' + j.status)}</span></div>
      <div class="mc-faint mono mc-job-sub"><span>${j.host || ''}</span><span class="mc-prog"></span></div>
      <div class="mc-bar ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'err' : j.status === 'paused' ? 'paused' : ''}"><i></i></div>
      <div class="mc-job-msg"></div>
    </div>
    <div class="mc-btn-row mc-job-acts"></div>`.toString();
  const acts = row.querySelector('.mc-job-acts');
  const b = (name, label, cls, fn) => { const x = nodeHtml('button', `mc-btn sm icon ${cls || ''}`.trim(), html`${ico(name)}`.toString()); x.title = label; x.setAttribute('aria-label', label); x.onclick = (e) => { e.stopPropagation(); fn(); }; acts.appendChild(x); };
  if (j.status === 'running' || j.status === 'queued') { b('mc-pause', T('queue_pause'), '', () => api.queuePause(j.id)); b('mc-stop', T('queue_cancel'), 'danger', () => api.queueCancel(j.id)); }
  if (j.status === 'paused') { b('mc-play', T('queue_resume'), 'primary', () => api.queueResume(j.id)); b('mc-stop', T('queue_cancel'), 'danger', () => api.queueCancel(j.id)); }
  if (j.status === 'failed' || j.status === 'cancelled') b('mc-retry', T('queue_retry'), 'primary', () => api.queueRetry(j.id));
  if (j.status === 'conflict') { const d = node('button', 'mc-btn sm primary', T('queue_decide')); d.onclick = (e) => { e.stopPropagation(); ask(j); }; acts.appendChild(d); }
  if (j.status === 'done') { b('verb-open', T('queue_open_file'), '', () => api.openFile(j.id)); b('mc-folder', T('queue_show_folder'), '', () => api.showInFolder(j.id)); }
  if (j.status !== 'running') b('mc-remove', T('queue_remove'), 'quiet', () => api.queueRemove(j.id));
  row.onclick = () => detail(j.id);
  paint(row, j);
  if (j.status === 'conflict' && !asked.has(j.id)) { asked.add(j.id); queueMicrotask(() => ask(j)); }
  return row;
}

function paint(row, j) {
  const { T } = C;
  const pct = j.bytesTotal ? Math.min(100, Math.round((j.bytesDone / j.bytesTotal) * 100)) : (j.status === 'done' ? 100 : null);
  const bar = row.querySelector('.mc-bar');
  bar.classList.toggle('indeterminate', j.status === 'running' && pct == null);
  if (pct != null) bar.querySelector('i').style.width = pct + '%';
  const parts = [];
  if (j.status === 'running' || j.status === 'paused') parts.push(`${fmtBytes(j.bytesDone)}${j.bytesTotal ? ' / ' + fmtBytes(j.bytesTotal) : ''}${pct != null ? ' · ' + pct + '%' : ''}${j.status === 'running' && j.speedBps ? ' · ' + fmtSpeed(j.speedBps) : ''}`);
  else if (j.status === 'done') parts.push(fmtBytes(j.bytesDone));
  else if (j.bytesTotal) parts.push(fmtBytes(j.bytesTotal));
  if (j.attempts > 1) parts.push(T('queue_attempt', { n: j.attempts }));
  row.querySelector('.mc-prog').textContent = parts.length ? ' · ' + parts.join(' · ') : '';
  const msg = row.querySelector('.mc-job-msg');
  msg.className = 'mc-job-msg';
  if (j.error && j.status !== 'done') {
    const retry = j.error.retryingInMs ? ` · ${T('queue_retrying', { s: Math.ceil(j.error.retryingInMs / 1000) })}` : '';
    msg.innerHTML = html`<span class="mc-code">${j.error.code}</span> ${j.error.message}${j.error.detail ? html` <span class="mc-faint">(${j.error.detail})</span>` : ''}${retry}${j.status === 'failed' && j.error.next ? html`<div class="mc-faint">${j.error.next}</div>` : ''}`.toString();
    msg.classList.add(j.status === 'failed' ? 'err' : 'warn');
  } else if (j.status === 'done' && j.result) {
    msg.innerHTML = html`<span class="mono mc-faint">${j.finalPath}</span>${j.result.duplicateOf ? html`<div class="mc-faint">${T('queue_duplicate')}</div>` : ''}`.toString();
  } else if (j.status === 'skipped' && j.result && j.result.existingPath) { msg.textContent = j.result.existingPath; msg.classList.add('mono', 'mc-faint'); }
  else msg.textContent = '';
}

async function ask(j) {
  const { T, api } = C;
  const choice = await confirmBox({
    title: T('conflict_h'), body: T('conflict_body', { name: (j.conflict && j.conflict.proposedName) || j.name || '' }),
    actions: [{ label: T('conflict_skip'), value: 'skip' }, { label: T('conflict_rename'), value: 'rename', cls: 'primary' }, { label: T('conflict_replace'), value: 'replace', cls: 'danger' }],
  });
  if (choice) api.queueConflict(j.id, choice);
}

function detail(id) {
  const { T, api, state } = C;
  const j = state.queue.find((x) => x.id === id); if (!j) return;
  const b = node('div');
  b.appendChild(nodeHtml('div', 'mc-kv', html`
    <span class="k">status</span><span class="v">${T('st_' + j.status)}</span>
    <span class="k">link</span><span class="v mono">${j.sourceUrl}</span>
    ${j.pageUrl ? html`<span class="k">page</span><span class="v mono">${j.pageUrl}</span>` : ''}
    <span class="k">destination</span><span class="v mono">${j.destination}</span>
    ${j.finalPath ? html`<span class="k">file</span><span class="v mono">${j.finalPath}</span>` : ''}
    <span class="k">bytes</span><span class="v mono">${(j.bytesDone || 0).toLocaleString()}${j.bytesTotal ? ' / ' + j.bytesTotal.toLocaleString() : ''}</span>
    ${j.result && j.result.sha256 ? html`<span class="k">sha-256</span><span class="v mono">${j.result.sha256}</span>` : ''}
    <span class="k">attempts</span><span class="v">${j.attempts}</span>
    ${j.error ? html`<span class="k">error</span><span class="v"><span class="mc-code">${j.error.code}</span> ${j.error.message}<br><span class="mc-faint">${j.error.next || ''}</span></span>` : ''}`.toString()));
  if (j.status === 'done') {
    const acts = node('div', 'mc-btn-row');
    const o = nodeHtml('button', 'mc-btn primary', html`${ico('verb-open')}<span>${T('queue_open_file')}</span>`.toString()); o.onclick = () => api.openFile(j.id);
    const f = nodeHtml('button', 'mc-btn', html`${ico('mc-folder')}<span>${T('queue_show_folder')}</span>`.toString()); f.onclick = () => api.showInFolder(j.id);
    acts.appendChild(o); acts.appendChild(f); b.appendChild(acts);
  }
  openDrawer(j.name || j.title || shortUrl(j.sourceUrl), j.host, b);
}

export function mount(el, ctx) {
  C = ctx; root = node('div', 'mc-queue'); el.appendChild(root); render();
  offs.push(ctx.cbus.on('queue', () => { if (root) reconcile(); }));
  offs.push(ctx.cbus.on('job', (j) => { const row = list && list.querySelector(`[data-jid="${CSS.escape(j.id)}"]`); const full = ctx.state.queue.find((x) => x.id === j.id); if (row && full && row.dataset.status === full.status) paint(row, full); }));
}
export function unmount() { for (const o of offs) o(); offs = []; root = null; list = null; }
