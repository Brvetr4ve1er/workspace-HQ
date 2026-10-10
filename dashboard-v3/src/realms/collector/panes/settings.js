// Settings — every value passes the main-side validator; the form re-renders
// from the validated result, so a clamped value shows clamped. Theme and
// language belong to WorkspaceHQ (SYS menu), not to this realm.
import { html, ico, node, nodeHtml, toast, confirmBox } from '../ui.js';
import { saveSettings, refreshLibrary } from '../store.js';

let C = null, root = null, offs = [];
const MB = 1048576;

function render() {
  const { T, api, state } = C;
  const s = state.settings || {};
  root.innerHTML = '';
  const form = nodeHtml('form', 'mc-form', html`
    <div class="mc-field"><label>${T('set_dest')}</label>
      <div class="mc-field-row"><input class="mc-input mono" id="s-dest" value="${s.destination}" /><button class="mc-btn" type="button" id="s-choose">${ico('mc-folder')}${T('set_choose')}</button></div>
      <div class="mc-hint">${T('set_dest_hint')}</div></div>
    <h2 class="sec">${T('set_downloads')}</h2>
    <div class="mc-two">
      <div class="mc-field"><label>${T('set_concurrency')}</label><input class="mc-input" id="s-conc" type="number" min="1" max="4" value="${s.concurrency}" /></div>
      <div class="mc-field"><label>${T('set_max_file')}</label><input class="mc-input" id="s-maxfile" type="number" min="1" value="${Math.round(s.maxFileBytes / MB)}" /></div>
    </div>
    <div class="mc-field"><label>${T('set_template')}</label><input class="mc-input mono" id="s-tpl" value="${s.filenameTemplate}" /><div class="mc-hint">${T('set_template_hint')}</div></div>
    <div class="mc-two">
      <div class="mc-field"><label>${T('set_overwrite')}</label><select class="mc-input" id="s-ow">${['ask', 'skip', 'rename'].map((v) => html`<option value="${v}" ${s.overwritePolicy === v ? 'selected' : ''}>${T('ow_' + v)}</option>`)}</select></div>
      <div class="mc-field end"><label class="mc-check"><input type="checkbox" id="s-keep" ${s.keepPartialOnCancel ? 'checked' : ''} /> ${T('set_keep_partial')}</label></div>
    </div>
    <h2 class="sec">${T('set_scanning')}</h2>
    <label class="mc-check"><input type="checkbox" id="s-robots" ${s.respectRobots ? 'checked' : ''} /> ${T('set_robots')}</label>
    <div class="mc-two">
      <div class="mc-field"><label>${T('set_max_page')}</label><input class="mc-input" id="s-maxpage" type="number" min="1" value="${Math.round(s.maxPageBytes / MB)}" /></div>
      <div class="mc-field"><label>${T('set_max_candidates')}</label><input class="mc-input" id="s-maxc" type="number" min="1" value="${s.maxCandidates}" /></div>
      <div class="mc-field"><label>${T('set_probe_limit')}</label><input class="mc-input" id="s-probe" type="number" min="0" value="${s.probeLimit}" /></div>
      <div class="mc-field end"><label class="mc-check"><input type="checkbox" id="s-pv" ${s.autoPreviewImages ? 'checked' : ''} /> ${T('set_auto_preview', { mb: ((s.previewMaxBytes || 0) / MB).toFixed(1) })}</label></div>
    </div>
    <div class="mc-btn-row"><button class="mc-btn primary" type="submit">${ico('mc-check')}${T('set_save')}</button></div>
    <h2 class="sec">${T('set_privacy')}</h2>
    <p class="mc-lead">${T('set_privacy_body')}</p>
    <div class="mc-kv">
      <span class="k">${T('set_data_dir')}</span><span class="v mono">${state.info ? state.info.dataDir : '—'} <button class="mc-btn sm quiet" type="button" id="s-data">${T('set_open')}</button></span>
      <span class="k">${T('set_ua')}</span><span class="v mono">${state.info ? state.info.userAgent : '—'}</span>
    </div>
    <div class="mc-btn-row"><button class="mc-btn danger" type="button" id="s-clear">${ico('mc-trash')}${T('set_clear_lib')}</button><span class="mc-faint">${T('set_clear_lib_hint')}</span></div>
    <div class="mc-btn-row"><button class="mc-btn" type="button" id="s-ack">${T('set_reset_ack')}</button></div>`.toString());
  root.appendChild(form);
  const g = (id) => form.querySelector('#' + id);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = await saveSettings({
      destination: g('s-dest').value, concurrency: Number(g('s-conc').value), maxFileBytes: Number(g('s-maxfile').value) * MB,
      filenameTemplate: g('s-tpl').value, overwritePolicy: g('s-ow').value, keepPartialOnCancel: g('s-keep').checked,
      respectRobots: g('s-robots').checked, maxPageBytes: Number(g('s-maxpage').value) * MB, maxCandidates: Number(g('s-maxc').value),
      probeLimit: Number(g('s-probe').value), autoPreviewImages: g('s-pv').checked,
    });
    const errs = Object.entries((r && r.errors) || {});
    for (const [k, m] of errs) toast(`${k}: ${m}`, { kind: 'err', ms: 6000 });
    if (!errs.length) toast(T('set_saved'), { kind: 'ok' });
    render();
  };
  g('s-choose').onclick = async () => { const p = await api.chooseDestination(); if (p && p.error) toast(p.error.message, { kind: 'err' }); else if (p) { C.state.settings = await api.settingsGet(); C.cbus.emit('settings', C.state.settings); render(); } };
  g('s-data').onclick = () => api.openDataDir();
  g('s-clear').onclick = async () => {
    const ok = await confirmBox({ title: T('set_clear_lib'), body: T('set_clear_lib_hint'), actions: [{ label: T('no'), value: false }, { label: T('yes'), value: true, cls: 'danger' }] });
    if (ok) { await api.libraryClear(); await refreshLibrary(); }
  };
  g('s-ack').onclick = async () => { await saveSettings({ acknowledgedAt: false }); };   // view.js re-renders on the ack flip
}

export function mount(el, ctx) { C = ctx; root = node('div', 'mc-settings'); el.appendChild(root); render(); }
export function unmount() { for (const o of offs) o(); offs = []; root = null; }
