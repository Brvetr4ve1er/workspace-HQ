// Inbox — URL entry + detect, the source/capability card, the candidate
// gallery (grid/list, kind filter, selection), main-side-verified previews,
// a detail drawer, and "add to queue". State survives remounts.
import { html, raw, ico, node, nodeHtml, esc, fmtBytes, fmtDuration, shortUrl, toast, openDrawer, kindIcon } from '../ui.js';
import { setLastResult } from '../store.js';

let C = null, root = null, offs = [];
let inputValue = '', scanning = false, result = null, layout = 'grid', kindFilter = 'all';
const selected = new Set();
const previews = new Map();   // candidate id -> 'loading' | {dataUrl} | {error}

const Q = { direct: 'q_direct', 'page-largest-variant': 'q_page_largest', 'page-variant': 'q_page_variant', metadata: 'q_metadata', thumbnail: 'q_thumbnail', unknown: 'q_unknown' };
const STATE_CLS = { supported: 'green', limited: 'blue', 'authorization-required': 'orange', unavailable: 'red', unsupported: 'red' };
const kindKey = (k) => 'kind_' + (['image', 'video', 'audio'].includes(k) ? k : 'unknown');
const RECENT = 'hq-collector-recent';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } };
const remember = (u) => { try { localStorage.setItem(RECENT, JSON.stringify([u, ...recent().filter((x) => x !== u)].slice(0, 6))); } catch {} };
const visible = () => (result ? result.candidates.filter((c) => kindFilter === 'all' || c.kind === kindFilter) : []);

async function detect(url) {
  const u = String(url || '').trim();
  if (!u || scanning) return;
  inputValue = u; scanning = true; result = null; selected.clear(); previews.clear();
  renderAll();
  const r = await C.api.resolve(u);
  scanning = false;
  result = r && Array.isArray(r.candidates) ? r : { pageUrl: u, source: null, capability: null, title: '', candidates: [], warnings: [], nextAction: '', error: (r && r.error) || { code: 'SOURCE_UNAVAILABLE', message: 'The scan failed.', next: '' } };
  if (!result.error) remember(u);
  setLastResult(result);
  if (result.source === 'direct' && result.candidates.length === 1) selected.add(result.candidates[0].id);
  if (!root) return;
  renderAll();
  autoPreview();
}

function autoPreview() {
  const s = C.state.settings || {};
  if (!s.autoPreviewImages || !result) return;
  for (const c of result.candidates.slice(0, 24)) {
    if (c.kind !== 'image' || c.probeError || !c.probed) continue;
    if (c.bytes != null && c.bytes > (s.previewMaxBytes || 0)) continue;
    loadPreview(c);
  }
}
async function loadPreview(c) {
  if (previews.has(c.id)) return;
  previews.set(c.id, 'loading'); paintCard(c);
  const p = await C.api.preview(c.finalUrl || c.sourceUrl).catch((err) => ({ error: { message: String(err && err.message || err) } }));
  previews.set(c.id, p && p.dataUrl ? p : { error: (p && p.error) || { message: 'no preview' } });
  if (root) paintCard(c);
}

async function addToQueue(cands) {
  const { T, api } = C;
  if (!cands.length) return;
  const out = await api.queueAdd(cands);
  if (out && out.error) { toast(out.error.message, { kind: 'err' }); return; }
  const refused = (out || []).filter((o) => o && o.refused);
  const n = (out || []).length - refused.length;
  if (n) toast(T('toast_queued', { n }), { kind: 'ok', action: { label: T('tab_queue'), fn: () => C.go('queue') } });
  for (const r of refused) toast(`${shortUrl(r.sourceUrl, 40)}: ${r.refused.message}`, { kind: 'err', ms: 6000 });
  for (const c of cands) selected.delete(c.id);
  if (root) { paintToolbar(); for (const c of cands) paintCard(c); }
}

function renderAll() { root.innerHTML = ''; root.appendChild(buildForm()); root.appendChild(buildResults()); }

function buildForm() {
  const { T } = C;
  const wrap = nodeHtml('div', 'mc-ib-head', html`
    <form class="mc-ib-form" autocomplete="off">
      <input class="mc-input big mono" id="mc-url" type="url" placeholder="${T('inbox_placeholder')}" value="${inputValue}" spellcheck="false" ${scanning ? 'disabled' : ''} />
      <button class="mc-btn primary" type="submit" ${scanning ? 'disabled' : ''}>${ico('mc-detect')}<span>${scanning ? T('inbox_scanning') : T('inbox_detect')}</span></button>
      ${scanning ? html`<button class="mc-btn" type="button" id="mc-cancel">${T('inbox_cancel')}</button>` : ''}
    </form>
    <div class="mc-hint">${T('inbox_note')}</div>
    ${scanning ? html`<div class="mc-bar indeterminate"><i></i></div>` : ''}
    ${!scanning && !result && recent().length ? html`<div class="mc-recent"><span>${T('inbox_recent')}</span>${recent().map((u) => html`<button class="mc-btn sm quiet mono" data-url="${u}" title="${u}">${shortUrl(u, 46)}</button>`)}</div>` : ''}`.toString());
  const form = wrap.querySelector('form'), inp = wrap.querySelector('#mc-url');
  form.onsubmit = (e) => { e.preventDefault(); detect(inp.value); };
  inp.oninput = () => { inputValue = inp.value; };
  inp.onpaste = () => setTimeout(() => { if (/^https?:\/\//i.test(inp.value.trim()) && !scanning) detect(inp.value); }, 0);
  const cancel = wrap.querySelector('#mc-cancel'); if (cancel) cancel.onclick = () => C.api.cancelResolve();
  wrap.querySelectorAll('.mc-recent [data-url]').forEach((b) => { b.onclick = () => detect(b.dataset.url); });
  return wrap;
}

function buildResults() {
  const { T } = C;
  const sec = node('div', 'mc-ib-results');
  if (scanning) return sec;
  if (!result) { sec.appendChild(node('div', 'empty-note', T('inbox_empty'))); return sec; }
  sec.appendChild(sourceCard());
  if (result.error && !result.candidates.length) return sec;
  sec.appendChild(nodeHtml('h2', 'sec', html`${T('inbox_results')} <span class="mc-n" id="mc-count"></span>`.toString()));
  sec.appendChild(toolbar());
  const list = node('div', layout === 'grid' ? 'mc-grid' : 'mc-list'); list.id = 'mc-cards';
  sec.appendChild(list);
  queueMicrotask(() => { paintToolbar(); paintCards(); });
  return sec;
}

function sourceCard() {
  const { T } = C;
  const r = result, cap = r.capability;
  const card = nodeHtml('div', 'mc-card mc-src', html`
    <div class="mc-src-top">
      ${cap ? html`<span class="mc-tag ${STATE_CLS[cap.state] || ''}">${T('state_' + cap.state)}</span><span class="mc-pill">${cap.label}</span>` : ''}
      ${r.pageUrl ? html`<a href="#" class="mono mc-src-url" data-url="${r.pageUrl}" title="${r.pageUrl}">${shortUrl(r.pageUrl, 80)}</a>` : ''}
    </div>
    ${r.title ? html`<div class="mc-src-title">${r.title}</div>` : ''}
    ${r.source === 'webpage' && !r.error ? html`<div class="mc-faint">${T('inbox_scanned_one')}</div>` : ''}
    ${r.error ? html`<div class="mc-note err"><span class="mc-code">${r.error.code}</span><div><b>${r.error.message}</b>${r.error.detail ? html` <span class="mc-faint">(${r.error.detail})</span>` : ''}</div>${r.nextAction || r.error.next ? html`<div class="mc-next">${T('inbox_next')}: ${r.nextAction || r.error.next}</div>` : ''}</div>` : ''}
    ${r.warnings && r.warnings.length ? html`<div class="mc-note warn"><span class="mc-code">${T('inbox_notes')}</span>${r.warnings.map((w) => html`<div>${w.message}</div>`)}</div>` : ''}`.toString());
  const a = card.querySelector('.mc-src-url'); if (a) a.onclick = (e) => { e.preventDefault(); C.api.openExternal(a.dataset.url); };
  return card;
}

function toolbar() {
  const { T } = C;
  const tb = nodeHtml('div', 'mc-toolbar', html`
    <button class="mc-btn sm" id="mc-selvis">${ico('mc-check', 13)}${T('inbox_select_visible')}</button>
    <button class="mc-btn sm quiet" id="mc-clear">${T('inbox_clear_sel')}</button>
    <div class="mc-seg" id="mc-kind">${['all', 'image', 'video', 'audio'].map((k) => html`<button data-k="${k}" class="${k === kindFilter ? 'active' : ''}">${T('f_' + k)}</button>`)}</div>
    <div class="mc-seg" id="mc-layout"><button data-v="grid" class="${layout === 'grid' ? 'active' : ''}">${T('inbox_view_grid')}</button><button data-v="list" class="${layout === 'list' ? 'active' : ''}">${T('inbox_view_list')}</button></div>
    <span class="mc-count" id="mc-selcount"></span>
    <button class="mc-btn primary" id="mc-add" disabled>${ico('mc-download')}<span id="mc-add-lbl"></span></button>`.toString());
  tb.querySelector('#mc-selvis').onclick = () => { for (const c of visible()) if (!c.probeError) selected.add(c.id); paintToolbar(); paintCards(); };
  tb.querySelector('#mc-clear').onclick = () => { selected.clear(); paintToolbar(); paintCards(); };
  tb.querySelectorAll('#mc-kind button').forEach((b) => { b.onclick = () => { kindFilter = b.dataset.k; tb.querySelectorAll('#mc-kind button').forEach((x) => x.classList.toggle('active', x === b)); paintToolbar(); paintCards(); }; });
  tb.querySelectorAll('#mc-layout button').forEach((b) => { b.onclick = () => { layout = b.dataset.v; tb.querySelectorAll('#mc-layout button').forEach((x) => x.classList.toggle('active', x === b)); const l = root.querySelector('#mc-cards'); if (l) l.className = layout === 'grid' ? 'mc-grid' : 'mc-list'; paintCards(); }; });
  tb.querySelector('#mc-add').onclick = () => addToQueue(result.candidates.filter((c) => selected.has(c.id)));
  return tb;
}

function paintToolbar() {
  if (!root || !result) return;
  const { T } = C;
  const n = selected.size, vis = visible();
  const cnt = root.querySelector('#mc-count'); if (cnt) cnt.textContent = `${vis.length}${vis.length !== result.candidates.length ? ' / ' + result.candidates.length : ''}`;
  const sc = root.querySelector('#mc-selcount'); if (sc) sc.textContent = n ? T('inbox_selected', { n }) : '';
  const add = root.querySelector('#mc-add'); if (add) add.disabled = !n;
  const lbl = root.querySelector('#mc-add-lbl'); if (lbl) lbl.textContent = n === 1 && result.source === 'direct' ? T('inbox_add_one') : T('inbox_add_selected', { n });
}
function paintCards() { const list = root && root.querySelector('#mc-cards'); if (!list) return; list.innerHTML = ''; for (const c of visible()) list.appendChild(card(c)); }
function paintCard(c) { const old = root && root.querySelector(`[data-cid="${CSS.escape(c.id)}"]`); if (old) old.replaceWith(card(c)); }

function card(c) {
  const { T } = C;
  const el = node('div', `${layout === 'grid' ? 'mc-card' : 'mc-row'} mc-cand${selected.has(c.id) ? ' sel' : ''}${c.probeError ? ' dim' : ''}`);
  el.dataset.cid = c.id;
  const pv = previews.get(c.id);
  const dims = c.width && c.height ? `${c.width}×${c.height}` : c.width ? `${c.width}w` : '';
  const facts = [c.mime || c.extHint || T(kindKey(c.kind)), dims, c.bytes != null ? fmtBytes(c.bytes) : (c.probed ? '' : T('inbox_unprobed')), c.duration ? fmtDuration(c.duration) : ''].filter(Boolean);
  const title = (c.attribution && c.attribution.title) || c.filenameHint || shortUrl(c.sourceUrl, 40);
  el.innerHTML = html`
    <label class="mc-cb"><input type="checkbox" ${selected.has(c.id) ? 'checked' : ''} ${c.probeError ? 'disabled' : ''} aria-label="select" /></label>
    <div class="mc-thumb">${pv && pv.dataUrl ? html`<img src="${pv.dataUrl}" alt="" />` : html`<div class="mc-thumb-ph">${ico(kindIcon(c.kind), 28)}${pv === 'loading' ? html`<span>${T('inbox_preview_loading')}</span>` : c.kind === 'image' && !c.probeError ? html`<button class="mc-btn sm mc-pv">${ico('mc-eye', 12)}${T('inbox_preview')}</button>` : ''}</div>`}</div>
    <div class="mc-cbody">
      <div class="mc-title" title="${title}">${title}</div>
      <div class="mc-host mono">${c.host}</div>
      <div class="mc-tags"><span class="mc-tag ${c.kind === 'image' ? 'blue' : c.kind === 'video' ? 'orange' : c.kind === 'audio' ? 'green' : ''}">${T(kindKey(c.kind))}</span><span class="mc-tag ${c.quality === 'direct' || c.quality === 'page-largest-variant' ? 'accent' : ''}">${T(Q[c.quality] || 'q_unknown')}</span></div>
      <div class="mc-facts mono">${facts.join(' · ')}</div>
      ${c.probeError ? html`<div class="mc-note err sm"><span class="mc-code">${c.probeError.code}</span> ${c.probeError.message}</div>` : ''}
      <div class="mc-btn-row">
        <button class="mc-btn sm primary mc-save" ${c.probeError ? 'disabled' : ''}>${ico('mc-download', 12)}${T('inbox_add_one')}</button>
        <button class="mc-btn sm quiet mc-info">${ico('verb-open', 12)}${T('inbox_open_url')}</button>
      </div>
    </div>`.toString();
  const cb = el.querySelector('input[type=checkbox]');
  cb.onchange = () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); el.classList.toggle('sel', cb.checked); paintToolbar(); };
  el.onclick = (e) => { if (e.target.closest('button, input, label, a, img') || c.probeError) return; cb.checked = !cb.checked; cb.onchange(); };
  const pvb = el.querySelector('.mc-pv'); if (pvb) pvb.onclick = () => loadPreview(c);
  el.querySelector('.mc-save').onclick = () => addToQueue([c]);
  el.querySelector('.mc-info').onclick = () => detail(c);
  const img = el.querySelector('.mc-thumb img'); if (img) img.onclick = () => detail(c);
  return el;
}

function detail(c) {
  const { T, api } = C;
  const b = node('div');
  const pv = previews.get(c.id);
  if (pv && pv.dataUrl) { const box = node('div', 'mc-dwr-preview'); const img = node('img'); img.src = pv.dataUrl; img.alt = ''; box.appendChild(img); b.appendChild(box); }
  b.appendChild(nodeHtml('div', 'mc-kv', html`
    <span class="k">link</span><span class="v mono">${c.sourceUrl}</span>
    ${c.pageUrl ? html`<span class="k">page</span><span class="v mono">${c.pageUrl}</span>` : ''}
    <span class="k">type</span><span class="v">${T(kindKey(c.kind))} · ${c.mime || '—'}${c.mimeTrusted === 'bytes' ? ' (from bytes)' : ''}</span>
    <span class="k">quality</span><span class="v">${T(Q[c.quality] || 'q_unknown')}</span>
    <span class="k">size</span><span class="v">${c.bytes != null ? `${fmtBytes(c.bytes)} (${c.bytes.toLocaleString()} B)` : T('inbox_size_unknown')}</span>
    <span class="k">dims</span><span class="v">${c.width && c.height ? `${c.width}×${c.height}${c.dimsFrom ? ' · ' + c.dimsFrom : ''}` : T('inbox_dims_unknown')}</span>
    ${c.duration ? html`<span class="k">duration</span><span class="v">${fmtDuration(c.duration)}</span>` : ''}
    <span class="k">found via</span><span class="v mono">${(c.via || []).join(', ')}</span>
    ${c.attribution && c.attribution.pageTitle ? html`<span class="k">page title</span><span class="v">${c.attribution.pageTitle}</span>` : ''}`.toString()));
  const acts = node('div', 'mc-btn-row');
  const save = nodeHtml('button', 'mc-btn primary', html`${ico('mc-download')}<span>${T('inbox_add_one')}</span>`.toString()); save.disabled = !!c.probeError; save.onclick = () => addToQueue([c]); acts.appendChild(save);
  const open = nodeHtml('button', 'mc-btn', html`${ico('verb-open')}<span>${T('inbox_open_url')}</span>`.toString()); open.onclick = () => api.openExternal(c.sourceUrl); acts.appendChild(open);
  if (c.pageUrl) { const op = node('button', 'mc-btn quiet', T('inbox_open_page')); op.onclick = () => api.openExternal(c.pageUrl); acts.appendChild(op); }
  b.appendChild(acts);
  openDrawer((c.attribution && c.attribution.title) || c.filenameHint || shortUrl(c.sourceUrl), c.host, b);
}

export function mount(el, ctx) {
  C = ctx; root = node('div', 'mc-inbox'); el.appendChild(root);
  if (!result && ctx.state.lastResult) result = ctx.state.lastResult;
  renderAll();
  offs.push(ctx.cbus.on('settings', () => {}));
  if (!result && !scanning) requestAnimationFrame(() => root && root.querySelector('#mc-url')?.focus());
}
export function unmount() { for (const o of offs) o(); offs = []; root = null; }
