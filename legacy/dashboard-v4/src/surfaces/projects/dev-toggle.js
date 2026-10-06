// Dev-server toggle — ONE component used by both the product card and the
// drawer's action row, so the two can never drift (v3 had cdevbtn + dwr-devbtn
// with separate repaint paths; this is the consolidation).
//
// Honesty contract: hq.devStart/devStop are fire-and-forget IPC invokes and the
// TRUTH about run state arrives later on the hq:dev-status push — so the label
// only flips when main confirms (the view's onDevStatus handler repaints every
// .dev-toggle via paintDevToggle). The click handler reads the CURRENT run
// state from the shared devRunning map at click time — never a render-time
// closure, which is the stale-toggle bug v3 carried.
import { el } from '../../ui/util.js';

export function paintDevToggle(btn, running) {
  btn.classList.toggle('is-running', !!running);
  btn.textContent = running ? '■ Stop' : '▶ Dev';
  const cmd = btn.dataset.devCmd || '';
  btn.title = `${running ? 'Stop' : 'Start'} the dev server${cmd ? ` (${cmd})` : ''} — asynchronous: this button updates when main confirms via a status push.`;
}

// Returns a button, or null when the scan carries no dev_cmd (no command ->
// no control at all, v3 parity — a start button with nothing to start would lie).
export function makeDevToggle(p, hq, devRunning) {
  if (!p?.dev_cmd) return null;
  const btn = el('button', 'btn btn--sm dev-toggle');
  btn.type = 'button';
  btn.dataset.devId = String(p.id);
  btn.dataset.devCmd = String(p.dev_cmd);
  btn.setAttribute('aria-label', `Dev server: ${p.name || p.id}`);

  if (typeof hq?.devStart !== 'function' || typeof hq?.devStop !== 'function') {
    btn.disabled = true;
    btn.textContent = '▶ Dev';
    btn.title = 'Needs the live app — dev servers are unavailable in this preview (window.hq is absent).';
    return btn;
  }

  paintDevToggle(btn, !!devRunning[p.id]);
  btn.onclick = (e) => {
    e.stopPropagation();                       // the card behind this opens the drawer
    const running = !!devRunning[p.id];        // read at CLICK time
    try {
      Promise.resolve(hq[running ? 'devStop' : 'devStart'](p.id))
        .catch((err) => console.warn('[projects] dev toggle failed', err));
    } catch (err) { console.warn('[projects] dev toggle failed', err); }
    btn.title = `${running ? 'Stop' : 'Start'} requested — waiting for main to confirm via a status push.`;
  };
  return btn;
}
