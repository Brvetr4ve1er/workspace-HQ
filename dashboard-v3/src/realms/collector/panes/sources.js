// Sources — the capability registry rendered honestly: state, access mode,
// media, pagination, rate limits, limitations, what works today, official
// documentation, and the explicit out-of-scope list.
import { html, node, nodeHtml } from '../ui.js';

let C = null;
const CLS = { supported: 'green', limited: 'blue', 'authorization-required': 'orange', unavailable: 'red', unsupported: 'red' };
const ORDER = { supported: 0, limited: 1, 'authorization-required': 2, unavailable: 3, unsupported: 4 };

export function mount(el, ctx) {
  C = ctx;
  const { T, state, api } = ctx;
  const root = node('div', 'mc-sources'); el.appendChild(root);
  root.appendChild(node('p', 'mc-lead', T('src_intro')));
  const grid = node('div', 'mc-grid wide');
  for (const s of [...state.sources].sort((a, b) => ORDER[a.state] - ORDER[b.state])) {
    const card = nodeHtml('div', 'mc-card mc-srccard', html`
      <div class="mc-src-top spread"><h3>${s.label}</h3><span class="mc-tag ${CLS[s.state] || ''}">${T('state_' + s.state)}</span></div>
      <div class="mc-kv">
        <span class="k">${T('src_urls')}</span><span class="v">${s.urlTypes.join(' · ')}</span>
        <span class="k">${T('src_auth')}</span><span class="v">${s.auth}</span>
        <span class="k">${T('src_types')}</span><span class="v">${s.mediaTypes.length ? s.mediaTypes.join(', ') : '—'}</span>
        <span class="k">${T('src_pagination')}</span><span class="v">${s.pagination}</span>
        <span class="k">${T('src_limits')}</span><span class="v">${s.rateLimits}</span>
      </div>
      <div class="mc-lim"><span class="mc-lbl">${T('src_limitations')}</span><ul>${s.limitations.map((l) => html`<li>${l}</li>`)}</ul></div>
      <div class="mc-note"><b>${T('src_next')}:</b> ${s.nextAction}</div>
      ${s.docs.length ? html`<div class="mc-docs"><span class="mc-lbl">${T('src_docs')}</span>${s.docs.map((d) => html`<a href="#" data-url="${d.url}">${d.label}</a>`)}</div>` : ''}`.toString());
    card.querySelectorAll('a[data-url]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.url); }; });
    grid.appendChild(card);
  }
  root.appendChild(grid);
  root.appendChild(nodeHtml('h2', 'sec', html`${T('scope_h')}`.toString()));
  root.appendChild(node('div', 'empty-note', T('scope_body')));
}
export function unmount() { C = null; }
