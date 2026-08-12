// AGENT pane — the ACT column, and the reason v4 exists: dispatch an agent at a
// real project, watch it stream, kill it or let it finish, see what it changed.
// No terminal, no launcher.
//
// UNTRUSTED INPUT: everything a session prints is attacker-influenced text
// (file contents, tool output, a repo's README). It reaches the DOM through
// textContent ONLY — never innerHTML, never esc()+innerHTML. The `pre` element
// is created once and only its .textContent is ever written.
//
// ASYNC HONESTY: session start is a round trip to the main process; the button
// says "Starting…" before the await and reports the real verdict after it. KILL
// asks no confirmation (it is a kill switch, a modal would defeat it) but it
// stays "Killing…" until the SESSIONS PUSH confirms the process actually left
// 'running' — the renderer never claims a kill it has not observed.
//
// LIFECYCLE: this module creates no timers and no global listeners. Its only
// element handlers are property assignments on nodes it creates, so a re-render
// (which replaces those nodes) drops them with the nodes. The view owns the one
// interval and calls tick().
import { el, esc, dur } from '../../ui/util.js';
import { dispatch } from '../../core/actions.mjs';
import { getOutput } from '../../state/live.js';
import { sessionAppeared, sessionSettled, outputArrived } from './motion.js';

const STICK_SLACK = 24;     // px from the bottom still counted as "at the bottom"
const PULSE_MS = 400;       // output-arrival pulse throttle

const NO_BRIDGE = 'Needs the live app — this preview has no bridge to the main process (window.hq is absent).';

function elapsedOf(s, now) {
  const start = Date.parse(s.startedAt || '');
  if (!Number.isFinite(start)) return '';
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  return dur(Math.max(0, (Number.isFinite(end) ? end : now) - start));
}

export function createAgentPane(api) {
  // api: { hq, projects: [{name, path}], alive() }
  const hq = api.hq;
  const canDispatch = typeof hq?.sessionStart === 'function';
  const canKill = typeof hq?.sessionKill === 'function';
  const canDiff = typeof hq?.sessionDiff === 'function';

  let sessions = [];                 // last known registry list
  let selected = null;               // jobId
  let stuck = true;                  // stick-to-bottom
  let lastOut = null;                // what the <pre> shows; null = unknown, forces the next write
  let lastPulse = 0;
  const cwdByJob = new Map();        // only sessions THIS pane started
  const diffByJob = new Map();       // jobId -> {state, files, stat, error}
  const killPending = new Set();
  const prevStatus = new Map();      // jobId -> status, for transition detection

  const root = el('section', 'panel panel--focal work-agent', `
    <div class="panel-head">
      <span class="panel-title">Agent</span>
      <span class="panel-sub" data-running>0 running</span>
      <span class="spacer"></span>
      <span class="panel-sub">in-app · no terminal</span>
    </div>
    <div class="agent-body">
      <div class="agent-top">
        <div class="agent-form">
          <div class="field">
            <label for="ag-target">Target project</label>
            <select id="ag-target" data-target></select>
          </div>
          <div class="field">
            <label for="ag-task">Task</label>
            <textarea id="ag-task" data-task placeholder="What should the agent do in that project?"></textarea>
          </div>
          <div data-warn></div>
          <div class="agent-form-row">
            <div class="agent-status" data-status role="status"></div>
            <button class="btn btn--primary" type="button" data-go>Dispatch</button>
          </div>
        </div>
        <div class="rule"></div>
        <div class="eyebrow">Sessions</div>
        <div class="sess-strip" data-strip></div>
      </div>
      <div class="out-wrap">
        <div class="out-head">
          <span class="pulse-dot" data-dot></span>
          <span data-outname>no session selected</span>
          <span class="spacer"></span>
          <span data-outmeta></span>
        </div>
        <div class="out-scroll scroll" data-scroll>
          <div class="empty" data-outhint hidden></div>
          <pre class="term" data-out></pre>
        </div>
        <div class="out-foot" data-foot></div>
      </div>
      <div class="chg" data-chg></div>
    </div>`);

  const q = (sel) => root.querySelector(sel);
  const targetEl = q('[data-target]');
  const taskEl = q('[data-task]');
  const warnEl = q('[data-warn]');
  const statusEl = q('[data-status]');
  const goEl = q('[data-go]');
  const stripEl = q('[data-strip]');
  const runningEl = q('[data-running]');
  const dotEl = q('[data-dot]');
  const outNameEl = q('[data-outname]');
  const outMetaEl = q('[data-outmeta]');
  const scrollEl = q('[data-scroll]');
  const outEl = q('[data-out]');
  const outHintEl = q('[data-outhint]');
  const footEl = q('[data-foot]');
  const chgEl = q('[data-chg]');

  function setStatus(text, tone) {
    statusEl.textContent = text;                       // textContent: may quote main's error string
    if (tone) statusEl.dataset.tone = tone; else delete statusEl.dataset.tone;
  }

  // ------------------------------------------------------------------ form
  {
    const opts = ['<option value="">— choose a project —</option>'];
    for (const p of api.projects) {
      opts.push(`<option value="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name || p.path)}</option>`);
    }
    targetEl.innerHTML = opts.join('');
    if (!api.projects.length) {
      targetEl.innerHTML = '<option value="">no project in this snapshot has a path</option>';
    }
  }

  if (!canDispatch) {
    // Disabled WITH the reason, on every control of the form — the standing
    // "no dead or lying controls" rule.
    targetEl.disabled = true;  targetEl.title = NO_BRIDGE;
    taskEl.disabled = true;    taskEl.title = NO_BRIDGE;
    goEl.disabled = true;      goEl.title = NO_BRIDGE;
    warnEl.className = 'agent-warn';
    warnEl.textContent = 'Preview mode: window.hq.sessionStart is unavailable, so nothing here can start an agent. Run the app (or the dev harness with HQ_V4_PRELOAD=v2) to dispatch.';
  } else {
    goEl.title = 'Start a Claude session in the selected project (headless print mode, streamed below).';
    goEl.onclick = async () => {
      const cwd = targetEl.value;
      const task = taskEl.value.trim();
      if (!cwd) { setStatus('Choose a target project first.', 'bad'); return; }
      if (!task) { setStatus('Describe the task first.', 'bad'); return; }
      const label = task.split('\n')[0].slice(0, 60);
      goEl.disabled = true;
      goEl.textContent = 'Starting…';                  // set BEFORE the await
      setStatus(`Starting an agent in ${cwd}…`);
      try {
        const r = dispatch('session:start', { cwd, task, label });
        if (!r.ok) throw new Error(r.error || 'dispatch failed');
        const res = await Promise.resolve(r.result);
        if (!api.alive()) return;                      // surface torn down mid-flight
        if (!res || typeof res !== 'object') throw new Error('no reply from the main process');
        if (res.error) throw new Error(res.error);
        if (!res.jobId) throw new Error('main returned no jobId');
        cwdByJob.set(res.jobId, cwd);
        selected = res.jobId;
        stuck = true;
        setStatus(`Started ${res.jobId} — output streams below as it arrives.`, 'good');
        renderOutput(); renderFoot(); renderChanges();
      } catch (err) {
        console.warn('[work/agent] session:start failed', err);
        setStatus(`Not started — ${String(err?.message || err)}`, 'bad');
      } finally {
        if (api.alive()) { goEl.disabled = false; goEl.textContent = 'Dispatch'; }
      }
    };
  }

  // Fill the form from a queue item (the queue's `dispatch` verb).
  function seed(item) {
    if (item.projectPath) targetEl.value = item.projectPath;
    // gaps/ideas carry a purpose-written seedPrompt; anything else composes
    // from the item's own words. Never invent detail the scan did not have.
    taskEl.value = item.seedPrompt || [item.title, item.detail].filter(Boolean).join(' — ');
    setStatus(`Loaded from the queue: ${item.title}`);
    if (canDispatch) taskEl.focus();
  }

  // -------------------------------------------------------------- sessions
  function sessionCard(s) {
    const card = el('button', 'sess-card');
    card.type = 'button';
    card.dataset.job = s.jobId;
    card.dataset.status = s.status || 'running';
    card.classList.toggle('is-active', s.jobId === selected);
    card.innerHTML = `
      <span class="sess-label">${esc(s.label || s.jobId)}</span>
      <span class="sess-meta" data-elapsed></span>`;
    // .title is a PROPERTY assignment, not innerHTML — esc() here would show
    // the entity text to the user instead of the character.
    card.title = `${s.jobId} · started ${s.startedAt || '?'}`;
    card.setAttribute('aria-label', `Session ${s.label || s.jobId}, ${s.status}`);
    card.onclick = () => select(s.jobId);
    return card;
  }

  function renderStrip() {
    stripEl.innerHTML = '';
    if (!sessions.length) {
      stripEl.appendChild(el('div', 'empty',
        canDispatch ? 'No agent sessions tracked. Dispatch one above.'
                    : 'Session presence needs the live app — nothing is tracked in this preview.'));
    } else {
      for (const s of sessions) stripEl.appendChild(sessionCard(s));
    }
    const running = sessions.filter((s) => s.status === 'running').length;
    runningEl.textContent = `${running} running · ${sessions.length} tracked`;
    tick();
  }

  function select(jobId) {
    if (selected === jobId) return;
    selected = jobId;
    stuck = true;
    lastOut = null;                    // unknown -> the next renderOutput always writes
    for (const c of stripEl.querySelectorAll('.sess-card')) c.classList.toggle('is-active', c.dataset.job === jobId);
    renderOutput(); renderFoot(); renderChanges();
  }

  // ---------------------------------------------------------------- output
  // The registry keeps a rolling 800-char `tail` for every session; the 64KB
  // per-job ring buffer in state/live.js only holds what THIS window heard.
  // A session that started before the window opened therefore has an empty
  // buffer and a non-empty tail — show the tail and SAY that is what it is.
  function outputFor(jobId) {
    const live = getOutput(jobId);
    if (live) return { text: live, source: 'live' };
    const s = sessions.find((x) => x.jobId === jobId);
    if (s?.tail) return { text: s.tail, source: 'tail' };
    return { text: '', source: 'none' };
  }

  // The hint lives OUTSIDE the <pre>, styled as a dashed empty box, so it can
  // never be mistaken for something the agent printed.
  function setHint(text) {
    outHintEl.textContent = text || '';
    outHintEl.hidden = !text;
  }

  function renderOutput() {
    if (!selected) {
      outNameEl.textContent = 'no session selected';
      outMetaEl.textContent = '';
      dotEl.dataset.live = 'none';
      dotEl.title = 'No session selected.';
      outEl.textContent = '';
      setHint(canDispatch
        ? 'No session selected. Dispatch a task above, or pick a session card.'
        : 'No session selected, and this preview cannot start one.');
      lastOut = '';
      return;
    }
    const s = sessions.find((x) => x.jobId === selected);
    const { text, source } = outputFor(selected);
    outNameEl.textContent = s?.label || selected;
    dotEl.dataset.live = s?.status === 'running' ? 'yes' : 'no';
    dotEl.title = s?.status === 'running' ? 'Session is running — output streams live.' : `Session status: ${s?.status || 'unknown'}.`;
    outMetaEl.textContent = source === 'tail'
      ? `${text.length} chars · registry tail (this window was not listening while it ran)`
      : `${text.length} chars${source === 'none' ? ' · nothing received yet' : ''}`;
    setHint(source === 'none'
      ? (s?.status === 'running'
        ? 'Session is running — nothing has been printed yet.'
        : 'This session produced no output that reached this window.')
      : '');
    if (text === lastOut) return;
    lastOut = text;
    outEl.textContent = text;                       // UNTRUSTED — textContent only
    if (stuck) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  scrollEl.onscroll = () => {
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < STICK_SLACK;
    if (atBottom === stuck) return;
    stuck = atBottom;
    renderFoot();
  };

  // ------------------------------------------------------------------ kill
  function renderFoot() {
    footEl.innerHTML = '';
    const s = sessions.find((x) => x.jobId === selected);
    const kill = el('button', 'btn btn--danger', killPending.has(selected) ? 'Killing…' : 'Kill');
    kill.type = 'button';
    if (!selected) {
      kill.disabled = true; kill.title = 'Select a session first.';
    } else if (!canKill) {
      kill.disabled = true; kill.title = NO_BRIDGE;
    } else if (s?.status !== 'running') {
      kill.disabled = true; kill.title = `Session already ${s?.status || 'gone'} — nothing to kill.`;
    } else if (killPending.has(selected)) {
      // Deliberately still "Killing…": main accepted the taskkill, and the
      // renderer waits for the hq:claude-sessions push to confirm the process
      // actually left 'running'. Claiming success earlier would be a lie.
      kill.disabled = true; kill.title = 'Kill signal sent — waiting for the session registry to confirm.';
    } else {
      kill.title = 'Terminate this session now. No confirmation — this is the stop button.';
      kill.onclick = async () => {
        const job = selected;
        killPending.add(job);
        renderFoot();                                  // -> "Killing…" before the await
        try {
          const r = dispatch('session:kill', { jobId: job });
          if (!r.ok) throw new Error(r.error || 'dispatch failed');
          const ok = await Promise.resolve(r.result);
          if (!api.alive()) return;
          if (ok !== true) throw new Error('the session registry refused (already finished?)');
          // Intentionally NO success state here: the registry push is the
          // confirmation, and it flips the card's status + this button.
        } catch (err) {
          console.warn('[work/agent] session:kill failed', err);
          killPending.delete(job);
          if (!api.alive()) return;
          renderFoot();
          const btn = footEl.querySelector('.btn--danger');
          if (btn) {
            btn.classList.add('btn--bad');
            btn.textContent = '✗ Not killed';
            btn.title = `Kill failed — ${String(err?.message || err)}. Click to retry.`;
          }
        }
      };
    }
    footEl.appendChild(kill);

    if (!stuck && selected) {
      const jump = el('button', 'btn btn--sm', 'Jump to latest');
      jump.type = 'button';
      jump.title = 'Scroll to the end and resume following the stream.';
      jump.onclick = () => { stuck = true; scrollEl.scrollTop = scrollEl.scrollHeight; renderFoot(); };
      footEl.appendChild(jump);
      footEl.appendChild(el('span', 'out-unstuck', 'following paused — you scrolled up'));
    }
  }

  // --------------------------------------------------------------- changes
  function probe(job) {
    const cwd = cwdByJob.get(job);
    if (!canDiff || !cwd) return;
    diffByJob.set(job, { state: 'loading' });
    renderChanges();
    Promise.resolve(hq.sessionDiff({ cwd }))
      .then((res) => {
        if (!api.alive()) return;
        if (!res || typeof res !== 'object') diffByJob.set(job, { state: 'error', error: 'no reply from the main process' });
        else if (res.error) diffByJob.set(job, { state: 'error', error: String(res.error) });
        else diffByJob.set(job, { state: 'done', files: Array.isArray(res.files) ? res.files : [], stat: String(res.stat || '') });
        renderChanges();
      })
      .catch((err) => {
        if (!api.alive()) return;
        diffByJob.set(job, { state: 'error', error: String(err?.message || err) });
        renderChanges();
      });
  }

  function renderChanges() {
    chgEl.innerHTML = '';
    const head = el('div', 'panel-title', 'Changes');
    chgEl.appendChild(head);
    const s = sessions.find((x) => x.jobId === selected);
    const say = (text) => chgEl.appendChild(el('div', 'empty', esc(text)));

    if (!selected) { say('Select a session to see what it changed.'); return; }
    if (s?.status === 'running') { say('Session is still running — the working tree is probed when it settles.'); return; }
    const cwd = cwdByJob.get(selected);
    if (!cwd) { say('This session was not started from the workbench, so its working directory is unknown here — no diff can be probed.'); return; }
    if (!canDiff) { say(`Change probe ${NO_BRIDGE}`); return; }

    const d = diffByJob.get(selected);
    if (!d || d.state === 'idle') { say('Not probed yet.'); }
    else if (d.state === 'loading') { say(`Probing git in ${cwd}…`); }
    else if (d.state === 'error') {
      const box = el('div', 'empty');
      box.textContent = `Probe failed — ${d.error}`;   // main's text: textContent
      chgEl.appendChild(box);
    } else if (!d.files.length) {
      // The honest empty state. "no changes detected" is a real, verified
      // answer from `git status --porcelain`, not an absence of information.
      say('no changes detected — git reports a clean working tree in this project.');
      if (d.stat) chgEl.appendChild(el('div', 'chg-stat meta', esc(d.stat)));
    } else {
      const list = el('div', 'chg-list');
      for (const f of d.files) {
        const row = el('div', 'chg-row');
        row.innerHTML = `<span class="chg-status">${esc(f.status || '?')}</span><span class="chg-path">${esc(f.path || '')}</span>`;
        list.appendChild(row);
      }
      chgEl.appendChild(el('div', 'meta', `${d.files.length} file${d.files.length === 1 ? '' : 's'} touched in ${esc(cwd)}`));
      chgEl.appendChild(list);
      if (d.stat) {
        const stat = el('pre', 'term chg-stat');
        stat.textContent = d.stat;                     // git output: textContent
        chgEl.appendChild(stat);
      }
    }

    const again = el('button', 'btn btn--sm', 'Probe again');
    again.type = 'button';
    again.style.marginTop = 'var(--space-2)';
    again.title = `Re-run git status/diff --stat in ${cwd}.`;
    again.onclick = () => probe(selected);
    chgEl.appendChild(again);
  }

  // ------------------------------------------------------------------ sync
  // Called by the view when live state changed. `sessionsChanged` is a
  // reference comparison done by the caller, so a pure output chunk does not
  // rebuild the session strip (which would drop focus and fight the scroller).
  // `animate` is false for the MOUNT-TIME call: sessions that already existed
  // before this panel opened did not just start, and motion here is reserved
  // for state changes the user is actually witnessing.
  function sync(state, sessionsChanged, animate = true) {
    if (sessionsChanged) {
      sessions = Array.isArray(state.sessions) ? state.sessions : [];
      const seen = new Set();
      const fresh = [];
      const settled = [];
      for (const s of sessions) {
        seen.add(s.jobId);
        const was = prevStatus.get(s.jobId);
        if (was === undefined) fresh.push(s.jobId);
        else if (was === 'running' && s.status !== 'running') settled.push(s.jobId);
        prevStatus.set(s.jobId, s.status);
      }
      for (const id of [...prevStatus.keys()]) if (!seen.has(id)) prevStatus.delete(id);
      for (const id of settled) killPending.delete(id);
      if (!selected && sessions.length) selected = sessions[sessions.length - 1].jobId;
      if (selected && !seen.has(selected)) selected = null;   // registry dropped it after the linger window

      renderStrip();
      renderFoot();
      renderChanges();

      // motion, strictly on the two real transitions
      if (animate) for (const id of fresh) sessionAppeared(stripEl.querySelector(`[data-job="${CSS.escape(id)}"]`), api.alive);
      for (const id of settled) {
        if (animate) sessionSettled(stripEl.querySelector(`[data-job="${CSS.escape(id)}"]`), api.alive);
        if (id === selected) probe(id);                // completion -> the CHANGES panel
      }
    }

    const before = lastOut;
    renderOutput();
    if (animate && lastOut !== before && lastOut && Date.now() - lastPulse > PULSE_MS) {
      lastPulse = Date.now();
      outputArrived(dotEl, api.alive);                 // pulse the indicator, never the text
    }
  }

  // Second-resolution labels, driven by the view's single interval.
  function tick() {
    const now = Date.now();
    for (const card of stripEl.querySelectorAll('.sess-card')) {
      const s = sessions.find((x) => x.jobId === card.dataset.job);
      if (!s) continue;
      const slot = card.querySelector('[data-elapsed]');
      if (!slot) continue;
      const code = (s.status === 'failed' && s.exitCode != null) ? ` · exit ${s.exitCode}` : '';
      slot.textContent = `${s.status} · ${elapsedOf(s, now)}${code}`;
    }
  }

  // first paint (no live data yet in a preview — these render the honest
  // "nothing tracked" states rather than an empty box)
  renderStrip();
  renderOutput();
  renderFoot();
  renderChanges();

  return { el: root, seed, sync, tick };
}
