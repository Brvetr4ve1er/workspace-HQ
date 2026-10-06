// Suggested actions — Epic D's quiet strip: intel/agency.mjs proposals (real
// signal gaps: no tests / CI / README / license) with two REAL verbs per row,
// both through the audited registry (core/actions.mjs):
//   claude:dispatch — opens a NEW terminal running `claude "<prompt>"` in the
//     project. spawnSync('start') returns almost immediately; nothing here
//     waits on Claude finishing, so the only honest success is "Opened".
//   capture:note — writes the capture inbox; main then runs a BLOCKING
//     re-assemble and win.reload() (~1.6s freeze). "Saving…" is set BEFORE the
//     await because the reload usually destroys this view mid-flight — never
//     promise a post-capture confirmation (the standing capture hazard).
// Handling copies the WORK queue-rail note/done verbs in spirit: in-flight
// label before the await, the resolved VALUE decides success, and a visible
// failure state that re-enables — never a silent snap-back.
import { el, esc } from '../../ui/util.js';
import { dispatch } from '../../core/actions.mjs';
import { agencyProposals } from '../../intel/agency.mjs';

const CAP = 8;   // it must not outshout the product grid (Epic D #5/#7)

function sendClaudeButton(p, hq) {
  const btn = el('button', 'btn btn--sm', 'Send Claude');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Send Claude: ${p.projectName} — ${p.label}`);
  if (typeof hq?.claudeQuest !== 'function') {
    btn.disabled = true;
    btn.title = 'Needs the live app — Claude dispatch is unavailable in this preview (window.hq is absent).';
    return btn;
  }
  btn.title = 'Opens a new terminal window running Claude in this project — nothing runs automatically, and nothing here waits on Claude finishing.';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.title = '';
    try {
      const r = dispatch('claude:dispatch', { projectPath: p.projectPath, prompt: p.seedPrompt });
      if (!r.ok) throw new Error(r.error || 'dispatch failed');
      const ok = await Promise.resolve(r.result);
      // main resolves false when the project path cannot become a cwd — a real
      // failure, not a refusal to show.
      if (ok === false) throw new Error("couldn't resolve the project path");
      btn.textContent = 'Opened ▸';
      btn.title = 'A terminal window opened running Claude in this project. Stays disabled — a re-click would spawn a second terminal.';
    } catch (err) {
      console.warn('[projects/strip] claude:dispatch failed', err);
      btn.disabled = false;
      btn.classList.add('btn--bad');
      btn.textContent = '✗ Not opened';
      btn.title = `Not opened — ${String(err?.message || err)}. Click to retry.`;
    }
  };
  return btn;
}

function addIdeaButton(p, hq) {
  const btn = el('button', 'btn btn--sm', 'Add to ideas');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Add to ideas: ${p.captureText}`);
  if (typeof hq?.captureSave !== 'function') {
    btn.disabled = true;
    btn.title = 'Needs the live app — capture is unavailable in this preview (window.hq is absent).';
    return btn;
  }
  btn.title = 'Writes this to the capture inbox. Main saves, reassembles and RELOADS the window (~1.6s freeze); it appears in the queue after the next scan.';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.title = '';
    btn.textContent = 'Saving…';   // BEFORE the await — see the module note
    try {
      const r = dispatch('capture:note', { text: p.captureText });
      if (!r.ok) throw new Error(r.error || 'dispatch failed');
      const ok = await Promise.resolve(r.result);
      if (ok === false) throw new Error('capture refused');
      btn.textContent = 'Noted';   // usually preempted by main's win.reload()
    } catch (err) {
      console.warn('[projects/strip] capture:note failed', err);
      btn.disabled = false;
      btn.classList.add('btn--bad');
      btn.textContent = '✗ Not saved';
      btn.title = `Not saved — ${String(err?.message || err)}. Click to retry.`;
    }
  };
  return btn;
}

// No proposals -> null, and the caller renders NOTHING (v3 forge parity: an
// empty "Suggested actions" shell would be noise, not honesty).
export function createActionsStrip({ scan, hq }) {
  const proposals = agencyProposals(scan);
  if (!proposals.length) return null;

  const panel = el('section', 'panel projects-strip', `
    <div class="panel-head">
      <span class="panel-title">Suggested actions</span>
      <span class="spacer"></span>
      <span class="panel-sub">${proposals.length} signal gap${proposals.length === 1 ? '' : 's'}</span>
    </div>
    <div class="panel-body" data-body></div>`);
  const body = panel.querySelector('[data-body]');

  for (const p of proposals.slice(0, CAP)) {
    const row = el('div', 'fa-row');
    row.innerHTML = `
      <div class="fa-info">
        <span class="fa-proj">${esc(p.projectName)}</span>
        <span class="chip" data-sev="dim">${esc(p.label)}</span>
      </div>
      <div class="fa-btns"></div>`;
    const btns = row.querySelector('.fa-btns');
    btns.appendChild(sendClaudeButton(p, hq));
    btns.appendChild(addIdeaButton(p, hq));
    body.appendChild(row);
  }
  if (proposals.length > CAP) {
    body.appendChild(el('div', 'meta', `+${proposals.length - CAP} more — the top ${CAP} are shown`));
  }
  return { el: panel, count: Math.min(proposals.length, CAP) };
}
