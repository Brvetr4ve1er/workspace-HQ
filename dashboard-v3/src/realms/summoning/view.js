// SUMMONING CIRCLE — Claude command (charter realm 10, M3). Three surfaces:
// the session registry (hq:sessions-list seed + hq:claude-sessions push), the
// Beckoning Bell console (hq:claude-quest → a REAL terminal window), and THE
// CANVAS (JSON Canvas boards — see canvas-board.js). Every hq call is
// feature-detected: the dev harness renders everything, powered-down.
import { el, esc, clock, dur } from '../../ui/util.js';
import { sfx } from '../../ui/components.js';
import { setSessions, sessionCache, runningCount } from './session-store.js';
import { renderCanvas, clearLocalNotes } from './canvas-board.js';

let root = null, CTX = null;
let regWrap = null, consoleWrap = null, canvasWrap = null;
let offSelect = null, offSessions = null, offCanvas = null, tick = 0;
let boards = [];                 // bundle snapshot, replaced by live pushes
const openTails = new Set();     // jobIds whose tail <details> survives repaints

// Rail badge = running-session count. manifest.badge() reads the same cache
// (covers shell repaints on data:select / theme change); this direct paint —
// same node, same rules as shell's refreshBadges — covers pushes in between.
function paintBadge() {
  const b = document.querySelector('#rail-left .sigil[data-realm="summoning"] .badge');
  if (!b) return;
  const v = runningCount() || null;
  b.textContent = v == null ? '' : String(v);
  b.style.display = v == null ? 'none' : '';
}

// ------------------------------------------------------- session registry
function sessionRow(s) {
  const row = el('div', 'ss-row ' + esc(s.status || ''));
  const t0 = Date.parse(s.startedAt || '');
  const t1 = s.status === 'running' ? Date.now() : Date.parse(s.endedAt || s.startedAt || '');
  const span = Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? dur(t1 - t0) : '';
  const chip = s.status === 'running' ? '◉ RUNNING'
    : s.status === 'done' ? '✓ DONE'
    : `✖ FAILED${s.exitCode != null ? ' · exit ' + esc(String(s.exitCode)) : ''}`;
  row.innerHTML = `
    <div class="ss-top">
      <span class="ss-chip ${esc(s.status || '')}">${chip}</span>
      <span class="ss-label">${esc(s.label || s.jobId || 'session')}</span>
      <span class="ss-time">${Number.isFinite(t0) ? clock(t0) : '—'}${span ? ' · ' + span : ''}</span>
    </div>
    ${s.tail ? `<details class="ss-tail"${openTails.has(s.jobId) ? ' open' : ''}><summary>▸ tail</summary><pre>${esc(s.tail)}</pre></details>` : ''}`;
  const det = row.querySelector('details');
  if (det) det.addEventListener('toggle', () => { det.open ? openTails.add(s.jobId) : openTails.delete(s.jobId); });
  return row;
}

function renderSessions() {
  if (!regWrap || !CTX) return;
  regWrap.innerHTML = '';
  const n = runningCount();
  regWrap.appendChild(el('h2', 'sec', `🔔 SESSION REGISTRY${n ? ` · <span class="ss-live">${n} running</span>` : ''}`));
  if (!CTX.hq?.getSessions) {
    regWrap.appendChild(el('div', 'empty-note', 'dev harness — bridge absent. the registry renders, but nothing can answer here.'));
  } else {
    const rank = (s) => (s.status === 'running' ? 0 : 1);
    const list = [...sessionCache()].sort((a, b) =>
      rank(a) - rank(b) || (Date.parse(b.startedAt || '') || 0) - (Date.parse(a.startedAt || '') || 0));
    if (!list.length) {
      regWrap.appendChild(el('div', 'empty-note', 'the bell is silent — no Familiars summoned yet. ring it below and one answers.'));
    } else {
      const wrap = el('div', 'ss-list');
      list.forEach((s) => wrap.appendChild(sessionRow(s)));
      regWrap.appendChild(wrap);
    }
  }
  paintBadge();
}

// -------------------------------------------------------- summon console
function renderConsole() {
  if (!consoleWrap || !CTX) return;
  consoleWrap.innerHTML = '';
  const hq = CTX.hq;
  const projects = CTX.data.selected?.projects || [];
  const armed = !!hq?.claudeQuest && projects.length > 0;
  consoleWrap.appendChild(el('h2', 'sec', 'RING THE BELL'));
  const card = el('div', 'sum-console');
  card.innerHTML = `
    <div class="sum-teach">ringing opens a <b>real terminal window</b> — the Familiar-Prime arrives bound to the project you pick, prompt in claw. close the terminal when the work is done.</div>
    <select class="sum-proj" ${projects.length ? '' : 'disabled'}>
      ${projects.length
        ? projects.map((p, i) => `<option value="${i}">${esc(p.name)} — ${esc(p.path)}</option>`).join('')
        : '<option>no projects in this scan — run the pipeline first</option>'}
    </select>
    <textarea class="sum-prompt" rows="4" placeholder="what do you need, Warden? (e.g. 'hunt down the dead routes in the router')"></textarea>
    <div class="sum-act">
      <button class="sum-go" ${armed ? '' : 'disabled'}>🔔 SUMMON</button>
      <span class="sum-hint">${hq?.claudeQuest ? '' : 'dev harness — the bell has no clapper here'}</span>
    </div>`;
  const go = card.querySelector('.sum-go');
  const ta = card.querySelector('.sum-prompt');
  const sel = card.querySelector('.sum-proj');
  const hint = card.querySelector('.sum-hint');
  go.onclick = () => {
    const p = projects[Number(sel.value)];
    const prompt = ta.value.trim();
    if (!p || !prompt) { sfx('blip'); ta.focus(); return; }
    CTX.hq?.claudeQuest?.(p.path, prompt);
    ta.value = '';
    hint.textContent = '🔔 rung — a terminal just opened with the Familiar-Prime inside.';
    sfx('open');
  };
  consoleWrap.appendChild(card);
}

// ------------------------------------------------------------ THE CANVAS
function renderCanvasSec() {
  if (!canvasWrap || !CTX) return;
  canvasWrap.innerHTML = '';
  canvasWrap.appendChild(el('h2', 'sec', `THE CANVAS · ${boards.length} board${boards.length === 1 ? '' : 's'}`));
  const host = el('div', 'cv-host');
  canvasWrap.appendChild(host);
  renderCanvas(host, CTX, boards);
}

function render() {
  if (!root || !CTX) return;
  root.innerHTML = '';
  regWrap = el('div', 'sum-registry'); root.appendChild(regWrap);
  consoleWrap = el('div', 'sum-summon'); root.appendChild(consoleWrap);
  canvasWrap = el('div', 'sum-canvas'); root.appendChild(canvasWrap);
  renderSessions();
  renderConsole();
  renderCanvasSec();
}

const liveBoards = (payload) => (Array.isArray(payload) ? payload : payload?.boards);

export const view = {
  mount(stage, ctx) {
    CTX = ctx;
    root = el('section', 'realm-summoning');
    stage.appendChild(root);
    boards = Array.isArray(ctx.data.bundle.canvas) ? ctx.data.bundle.canvas : [];
    render();
    offSelect = ctx.bus.on('data:select', render);

    const hq = ctx.hq;
    if (hq?.getSessions) {
      Promise.resolve(hq.getSessions()).then((list) => {
        if (!CTX) return;                      // realm switched before the seed landed
        setSessions(list); renderSessions();
      }).catch(() => {});
    }
    if (hq?.onClaudeSessions) {
      offSessions = hq.onClaudeSessions((list) => { setSessions(list); renderSessions(); });
    }
    // live canvas beats the build-time snapshot — both seams optional until
    // the main-side channels land (orchestrator owns that seam)
    if (hq?.getCanvas) {
      Promise.resolve(hq.getCanvas()).then((payload) => {
        const arr = liveBoards(payload);
        if (CTX && Array.isArray(arr)) { boards = arr; clearLocalNotes(); renderCanvasSec(); }
      }).catch(() => {});
    }
    if (hq?.onCanvas) {
      offCanvas = hq.onCanvas((payload) => {
        const arr = liveBoards(payload);
        if (Array.isArray(arr)) { boards = arr; clearLocalNotes(); renderCanvasSec(); }
      });
    }
    // elapsed-time tick for running rows — registry-only repaint, and only
    // while something is actually running
    tick = setInterval(() => { if (runningCount()) renderSessions(); }, 15000);
  },

  unmount() {
    offSelect?.(); offSelect = null;
    offSessions?.(); offSessions = null;
    offCanvas?.(); offCanvas = null;
    clearInterval(tick); tick = 0;
    root = null; CTX = null;
    regWrap = consoleWrap = canvasWrap = null;
  },
};
