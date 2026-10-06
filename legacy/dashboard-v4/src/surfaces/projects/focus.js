// "Working on now" — browser focus, ported from v3 forge renderBrowserFocus.
// TWO sources, told apart honestly:
//   scan.browser        — the SNAPSHOT rollup (dwell by domain / by project)
//   state/live.js       — the live active-tab ticker (hq:browser-tab pushes;
//                         live.js owns the subscription, this panel only paints)
// The current-tab line prefers the live tab ONLY on the latest snapshot; on an
// older snapshot everything here is scan data and a line says so.
import { el, esc, dur } from '../../ui/util.js';

function agoText(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const m = Math.round((Date.now() - then) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function nowLineHtml(cur) {
  if (!cur) return '<span class="pulse-dot" data-live="no"></span><span class="bf-host dim">— idle —</span>';
  const proj = cur.project_name || cur.project_id || '';
  return `<span class="pulse-dot" data-live="${cur.live ? 'yes' : 'no'}"></span>
    <span class="bf-host">${esc(cur.host || cur.domain || '')}</span>
    ${proj ? `<span class="chip">${esc(proj)}</span>` : ''}
    ${cur.focus_ms ? `<span class="meta">${esc(dur(cur.focus_ms))}</span>` : ''}
    ${cur.title ? `<div class="bf-title meta">${esc(cur.title)}</div>` : ''}`;
}

export function createFocusPanel({ scan, hq, isLatest, liveBrowser }) {
  const B = scan.browser || null;                       // optional field — never fabricated (data.js ingress note)
  const panel = el('section', 'panel projects-focus', `
    <div class="panel-head">
      <span class="panel-title">Working on now</span>
      <span class="spacer"></span>
      <span class="panel-sub" data-src></span>
    </div>
    <div class="panel-body" data-body></div>`);
  const body = panel.querySelector('[data-body]');
  const srcEl = panel.querySelector('[data-src]');

  const now0 = (isLatest && liveBrowser) ? liveBrowser : ((B && B.current) || null);

  if ((!B || !B.captured) && !now0) {
    // Nothing to show. In the live app on the latest snapshot that is a setup
    // gap worth naming; anywhere else it is just an honest empty state.
    srcEl.textContent = 'browser';
    body.appendChild(el('div', 'empty', (isLatest && hq)
      ? 'Load the WorkspaceHQ Bridge Chrome extension (browser-bridge/) to see what you are building, live.'
      : 'No browser activity captured in this snapshot.'));
    return { el: panel, paintLive: () => {} };
  }

  srcEl.textContent = 'browser' + (B && B.updated ? ` · ${agoText(B.updated)}` : '');

  const now = el('div', 'bf-now');
  now.innerHTML = nowLineHtml(now0);
  body.appendChild(now);
  if (!isLatest) body.appendChild(el('div', 'meta', 'From the scan snapshot — not live.'));

  const doms = (B && B.by_domain) || [];
  if (doms.length) {
    const max = Math.max(1, Number(doms[0].focus_ms) || 1);
    const bars = el('div', 'bf-bars');
    for (const d of doms.slice(0, 6)) {
      const ms = Number(d.focus_ms) || 0;
      const w = Math.max(4, Math.min(100, Math.round((ms / max) * 100)));   // clamped: style-attribute value
      const row = el('div', 'bf-bar');
      row.innerHTML = `<span class="bf-bd meta">${esc(d.domain)}</span>
        <span class="meter"><i style="width:${w}%"></i></span>
        <span class="bf-bt meta">${esc(dur(ms))}</span>`;
      bars.appendChild(row);
    }
    body.appendChild(bars);
  }

  const projs = (B && B.by_project) || [];
  if (projs.length) {
    const row = el('div', 'bf-projs');
    for (const pr of projs.slice(0, 5)) {
      row.appendChild(el('span', 'chip', `${esc(pr.project_name)} · ${esc(dur(Number(pr.focus_ms) || 0))}`));
    }
    body.appendChild(row);
  }

  // Repaint ONLY the current-tab line on a live push (the rollups are scan
  // data — a live tick must not pretend to update them).
  const paintLive = (browser) => {
    if (!isLatest) return;
    now.innerHTML = nowLineHtml(browser);
  };
  return { el: panel, paintLive };
}
