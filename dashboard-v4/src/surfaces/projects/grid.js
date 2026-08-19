// PROJECTS grid — the product shelf: toolbar (search / filter / sort, v3 forge
// parity) + one card per project. Cards carry the headline health facts
// (completion figure + delta, meter, build/git/tests/activity chips, dev
// toggle); EVERYTHING deeper lives one click away in the drawer — v4's
// consolidation of v3's inline peek panel (all its facts moved there).
//
// Toolbar state is module-level so it survives re-renders AND surface switches
// (v3 forge kept the same lets for the same reason). Handlers are property
// assignments on nodes this module creates — a redraw drops them with the nodes.
import { el, esc } from '../../ui/util.js';
import { applyView, commitAgoText, completionDelta, gitText, pctOf, testsText } from './core.mjs';
import { makeDevToggle } from './dev-toggle.js';

const viewState = { search: '', filter: 'all', sort: 'completion' };

const FILTERS = [
  { v: 'all',    label: 'All',      title: 'Every project in this snapshot.' },
  { v: 'risk',   label: 'At risk',  title: 'High git risk, red build, or high security score.' },
  { v: 'active', label: 'Active',   title: 'Projects the scan marked active.' },
  { v: 'cold',   label: 'Dormant',  title: 'Projects the scan marked dormant.' },
];
const SORTS = [
  { v: 'completion', label: 'Completion', title: 'Most complete first.' },
  { v: 'risk',       label: 'Risk',       title: 'Most attention-needing first.' },
  { v: 'recent',     label: 'Recent',     title: 'Most recently committed first.' },
];

function chip(label, sev) {
  const c = el('span', 'chip', esc(label));
  if (sev) c.dataset.sev = sev;
  return c;
}

function seg(name, items, cur, onPick) {
  const wrap = el('div', 'p-seg');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', name);
  for (const it of items) {
    const b = el('button', 'btn btn--sm' + (it.v === cur ? ' is-on' : ''), esc(it.label));
    b.type = 'button';
    b.title = it.title;
    b.setAttribute('aria-pressed', it.v === cur ? 'true' : 'false');
    b.onclick = () => {
      for (const x of wrap.children) {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      }
      onPick(it.v);
    };
    wrap.appendChild(b);
  }
  return wrap;
}

// THE product card. Every scan-derived string is esc()'d on the way in; the
// meter width is pctOf() — clamped to [0,100] — because it lands in a style
// attribute where esc() is no defence.
function projectCard(p, prevP, api) {
  const g = p.metrics.git_safety, ch = p.metrics.code_health;
  const pct = pctOf(p);
  const dpc = completionDelta(p, prevP);
  const tone = pct < 50 ? 'red' : pct < 80 ? 'orange' : 'violet';

  const card = el('article', 'p-card');
  card.dataset.risk = g.risk === 'high' ? 'high' : g.risk === 'medium' ? 'medium' : 'low';
  card.innerHTML = `
    <div class="p-head">
      <h3 class="p-name">${esc(p.name)}</h3>
      <span class="p-devslot"></span>
    </div>
    <div class="p-fig">
      <span class="figure">${pct}<span class="p-pctmark">%</span></span>
      ${dpc ? `<span class="p-delta" data-dir="${dpc > 0 ? 'up' : 'down'}">${dpc > 0 ? '+' : ''}${dpc}%</span>` : ''}
    </div>
    <div class="meter" data-tone="${tone}"><i style="width:${pct}%"></i></div>
    <div class="p-stack meta">${esc((p.stack || []).slice(0, 4).join(' · ') || 'no stack detected')}</div>
    <div class="p-chips"></div>
    <div class="p-foot">
      <span class="meta">${esc(commitAgoText(p.activity.days_since_commit))}</span>
      <button class="btn btn--sm" type="button" data-detail
        aria-label="Detail: ${esc(p.name)}"
        title="Open the project panel — re-entry briefing, git, tasks, actions.">Detail</button>
    </div>`;

  const chips = card.querySelector('.p-chips');
  chips.appendChild(chip(`build: ${ch.build ?? '—'}`, ch.build === 'red' ? 'red' : null));
  chips.appendChild(chip(`git: ${gitText(g)}`, g.risk === 'high' ? 'red' : g.risk === 'medium' ? 'orange' : null));
  chips.appendChild(chip(`tests: ${testsText(ch.tests)}`, null));
  chips.appendChild(chip(String(p.activity.state ?? 'unknown'), 'dim'));

  const dt = makeDevToggle(p, api.hq, api.devRunning);
  if (dt) card.querySelector('.p-devslot').appendChild(dt);

  // Whole card opens the drawer (v3 habit); inner buttons keep their own jobs.
  card.onclick = (e) => { if (e.target.closest('button')) return; api.openDetail(p); };
  card.querySelector('[data-detail]').onclick = () => api.openDetail(p);
  return card;
}

export function createGrid(api) {
  // api: { scan, prevMap, hq, devRunning, openDetail(p) }
  const total = (api.scan.projects || []).length;
  const root = el('section', 'panel panel--focal projects-main', `
    <div class="panel-head">
      <span class="panel-title">Projects</span>
      <span class="panel-sub">from the scan snapshot</span>
      <span class="spacer"></span>
      <span class="q-total"><span class="figure" data-count>${total}</span><span class="figure-label">projects</span></span>
    </div>
    <div class="panel-body" data-body></div>`);
  const body = root.querySelector('[data-body]');

  const toolbar = el('div', 'p-toolbar');
  const field = el('div', 'field p-searchfield');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Filter projects…';
  input.value = viewState.search;
  input.setAttribute('aria-label', 'Filter projects by name or stack');
  field.appendChild(input);
  toolbar.appendChild(field);
  toolbar.appendChild(seg('Filter projects', FILTERS, viewState.filter, (v) => { viewState.filter = v; drawCards(); }));
  toolbar.appendChild(seg('Sort projects', SORTS, viewState.sort, (v) => { viewState.sort = v; drawCards(); }));
  const countEl = el('span', 'meta p-count');
  toolbar.appendChild(countEl);
  body.appendChild(toolbar);

  const gridEl = el('div', 'p-grid');
  body.appendChild(gridEl);

  function drawCards() {
    const list = applyView(api.scan.projects, viewState);
    gridEl.innerHTML = '';
    if (!list.length) {
      gridEl.appendChild(el('div', 'empty', total
        ? 'No projects match this filter.'
        : 'No projects in this snapshot — run a scan to populate the shelf.'));
    }
    for (const p of list) gridEl.appendChild(projectCard(p, api.prevMap[p.id] || null, api));
    countEl.textContent = `${list.length} / ${total} shown`;
  }
  input.oninput = () => { viewState.search = input.value; drawCards(); };
  drawCards();

  return { el: root };
}
