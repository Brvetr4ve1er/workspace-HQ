// Library — saved files: search, sort, kind filter, open / reveal, notes and
// tags, soft delete with undo.
import { html, ico, node, nodeHtml, fmtBytes, fmtTime, toast, openDrawer, closeDrawer, kindIcon } from '../ui.js';
import { refreshLibrary } from '../store.js';

let C = null, root = null, offs = [], q = '', sort = 'savedAt', kind = 'all', seq = 0;

async function load() {
  const my = ++seq;
  const items = await C.api.libraryList({ q, sort, dir: sort === 'finalName' || sort === 'host' ? 'asc' : 'desc', kind });
  if (root && my === seq) paintList(Array.isArray(items) ? items : []);
}

function render() {
  const { T, state } = C;
  root.innerHTML = '';
  const total = state.library.reduce((a, i) => a + (i.bytes || 0), 0);
  const tb = nodeHtml('div', 'mc-toolbar', html`
    <input class="mc-input" id="mc-lq" type="search" placeholder="${T('lib_search')}" value="${q}" />
    <div class="mc-seg" id="mc-lk">${['all', 'image', 'video', 'audio'].map((k) => html`<button data-k="${k}" class="${k === kind ? 'active' : ''}">${T('f_' + k)}</button>`)}</div>
    <div class="mc-seg" id="mc-ls">${[['savedAt', 'lib_sort_date'], ['finalName', 'lib_sort_name'], ['bytes', 'lib_sort_size'], ['host', 'lib_sort_host']].map(([k, l]) => html`<button data-s="${k}" class="${k === sort ? 'active' : ''}">${T(l)}</button>`)}</div>
    <span class="mc-count" id="mc-lcount">${T('lib_count', { n: state.library.length, bytes: fmtBytes(total) || '0 B' })}</span>`.toString());
  const inp = tb.querySelector('#mc-lq'); let t; inp.oninput = () => { q = inp.value; clearTimeout(t); t = setTimeout(load, 120); };
  tb.querySelectorAll('#mc-lk button').forEach((b) => { b.onclick = () => { kind = b.dataset.k; tb.querySelectorAll('#mc-lk button').forEach((x) => x.classList.toggle('active', x === b)); load(); }; });
  tb.querySelectorAll('#mc-ls button').forEach((b) => { b.onclick = () => { sort = b.dataset.s; tb.querySelectorAll('#mc-ls button').forEach((x) => x.classList.toggle('active', x === b)); load(); }; });
  root.appendChild(tb);
  const list = node('div', 'mc-list'); list.id = 'mc-llist'; root.appendChild(list);
  load();
}

function paintList(items) {
  const { T } = C;
  const list = root.querySelector('#mc-llist'); if (!list) return;
  list.innerHTML = '';
  if (!items.length) { list.appendChild(node('div', 'empty-note', T('lib_empty'))); return; }
  for (const it of items) list.appendChild(row(it));
}

function row(it) {
  const { T, api } = C;
  const r = node('div', 'mc-row mc-job mc-lib'); r.dataset.lid = it.id;
  const dims = it.width && it.height ? ` · ${it.width}×${it.height}` : '';
  r.innerHTML = html`
    <div class="mc-job-ico">${ico(kindIcon(it.kind), 20)}</div>
    <div class="mc-job-main">
      <div class="mc-job-top"><span class="mc-title" title="${it.localPath}">${it.finalName}</span>${it.tags.length ? html`<span class="mc-tags">${it.tags.map((t) => html`<span class="mc-tag">${t}</span>`)}</span>` : ''}</div>
      <div class="mc-faint mono mc-job-sub">${it.host} · ${fmtBytes(it.bytes)}${dims} · ${fmtTime(Date.parse(it.savedAt))}${it.pageTitle ? ` · ${it.pageTitle}` : ''}</div>
      ${it.note ? html`<div class="mc-faint mc-lib-note">${it.note}</div>` : ''}
    </div>
    <div class="mc-btn-row mc-job-acts"></div>`.toString();
  const acts = r.querySelector('.mc-job-acts');
  const b = (name, label, cls, fn) => { const x = nodeHtml('button', `mc-btn sm icon ${cls || ''}`.trim(), html`${ico(name)}`.toString()); x.title = label; x.setAttribute('aria-label', label); x.onclick = (e) => { e.stopPropagation(); fn(); }; acts.appendChild(x); };
  b('verb-open', T('lib_open'), '', async () => { if (!(await api.openFile(it.id))) toast(T('lib_missing'), { kind: 'err' }); });
  b('mc-folder', T('lib_folder'), '', async () => { if (!(await api.showInFolder(it.id))) toast(T('lib_missing'), { kind: 'err' }); });
  b('mc-trash', T('lib_delete'), 'quiet', () => remove(it));
  r.onclick = () => detail(it);
  return r;
}

async function remove(it) {
  const { T, api } = C;
  await api.libraryRemove(it.id); await refreshLibrary(); load();
  toast(T('lib_deleted'), { ms: 8000, action: { label: T('lib_undo'), fn: async () => { await api.libraryRestore(it.id); await refreshLibrary(); load(); } } });
}

function detail(it) {
  const { T, api } = C;
  const b = node('div');
  b.appendChild(nodeHtml('div', 'mc-kv', html`
    <span class="k">file</span><span class="v mono">${it.localPath}</span>
    <span class="k">from</span><span class="v mono">${it.sourceUrl}</span>
    ${it.pageUrl ? html`<span class="k">page</span><span class="v mono">${it.pageUrl}</span>` : ''}
    <span class="k">type</span><span class="v">${it.mime} · ${fmtBytes(it.bytes)} (${(it.bytes || 0).toLocaleString()} B)</span>
    ${it.width && it.height ? html`<span class="k">dims</span><span class="v">${it.width}×${it.height}</span>` : ''}
    <span class="k">sha-256</span><span class="v mono">${it.sha256}</span>
    <span class="k">saved</span><span class="v">${fmtTime(Date.parse(it.savedAt))}</span>
    <span class="k">quality</span><span class="v">${it.quality}</span>
    <span class="k">original</span><span class="v mono">${it.originalName || '—'}</span>`.toString()));
  const form = nodeHtml('div', 'mc-form', html`
    <div class="mc-field"><label>${T('lib_tags')}</label><input class="mc-input" id="mc-tags" value="${it.tags.join(', ')}" /></div>
    <div class="mc-field"><label>${T('lib_note')}</label><textarea class="mc-input" id="mc-note">${it.note}</textarea></div>
    <div class="mc-btn-row"><button class="mc-btn primary" id="mc-lsave">${T('lib_save')}</button><button class="mc-btn" id="mc-lopen">${ico('verb-open')}${T('lib_open')}</button><button class="mc-btn" id="mc-lfold">${ico('mc-folder')}${T('lib_folder')}</button></div>`.toString());
  form.querySelector('#mc-lsave').onclick = async () => {
    const tags = form.querySelector('#mc-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    await api.libraryUpdate(it.id, { tags, note: form.querySelector('#mc-note').value });
    await refreshLibrary(); load(); closeDrawer();
  };
  form.querySelector('#mc-lopen').onclick = () => api.openFile(it.id);
  form.querySelector('#mc-lfold').onclick = () => api.showInFolder(it.id);
  b.appendChild(form);
  openDrawer(it.finalName, it.host, b);
}

export function mount(el, ctx) {
  C = ctx; root = node('div', 'mc-library'); el.appendChild(root); render();
  offs.push(ctx.cbus.on('library', () => {
    if (!root) return;
    const c = root.querySelector('#mc-lcount');
    if (c) c.textContent = ctx.T('lib_count', { n: ctx.state.library.length, bytes: fmtBytes(ctx.state.library.reduce((a, i) => a + (i.bytes || 0), 0)) || '0 B' });
    load();
  }));
}
export function unmount() { for (const o of offs) o(); offs = []; root = null; }
