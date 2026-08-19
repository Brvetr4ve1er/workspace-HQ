// PROJECTS drawer — the full project panel. Everything in it comes from the
// SNAPSHOT and the head says so (same honesty label as the work drawer-lite,
// whose .drawer / .truth-kv component classes this reuses rather than forks).
//
// v4 consolidation: v3-forge's inline peek panel (.nx-detail) and the shared
// drawer's re-entry briefing both land HERE — one detail surface, all the same
// facts: briefing (is/last/wip/next/recent files), completion + delta, git,
// health, stack, open tasks, browser dwell, security flags, completion basis.
//
// Actions (the S1 scope): Reveal folder via hq.openRepo (handler shape copied
// from work/drawer.js — the resolved VALUE decides success), the dev-server
// toggle (shared component, repainted by the view's onDevStatus handler), and
// recent-file buttons via hq.openFile. Every one is real or disabled-with-why.
import { el, esc, fmt, dur } from '../../ui/util.js';
import { commitAgoText, completionDelta, dwellFor, nextActionFor, openTasksFor, pctOf, testsText } from './core.mjs';
import { makeDevToggle } from './dev-toggle.js';

const NO_BRIDGE = 'Needs the live app — this preview has no bridge to the main process (window.hq is absent).';

const kv = (k, v) => `<div class="truth-kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;

const TIER_SEV = { red: 'red', orange: 'orange', yellow: 'yellow' };

export function openDrawer(host, opts, onClose) {
  const { project, prev, scan, hq, devRunning } = opts;
  const p = project || {};
  const git = p.metrics?.git_safety || {};
  const sec = p.metrics?.risk_security || {};
  const code = p.metrics?.code_health || {};
  const act = p.activity || {};
  const pct = pctOf(p);
  const dpc = completionDelta(p, prev);
  const dirty = Number(git.dirty) || 0;
  const dsc = act.days_since_commit;
  const rfiles = (code.recent_files || []).slice(0, 6);
  const tasks = openTasksFor(scan?.quests, p.id);
  const dw = dwellFor(scan?.browser, p.id);
  const flags = (sec.flags || []);

  const scrim = el('div', 'drawer-scrim');
  const drawer = el('aside', 'drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', `Project ${p.name || p.id || 'detail'}`);
  drawer.innerHTML = `
    <div class="drawer-head">
      <div style="min-width:0">
        <div class="eyebrow">From the scan snapshot — not live</div>
        <div class="drawer-title">${esc(p.name || p.id || 'unknown project')}</div>
        <div class="mono-path">${esc(p.path || 'no path in the scan')}</div>
      </div>
      <button class="btn btn--sm" type="button" data-close title="Close this panel (Esc)">Close</button>
    </div>
    <div class="drawer-body">
      <div class="eyebrow">Where was I?</div>
      <div class="re-lines">
        <div class="re-line"><span class="re-k">is</span><span class="re-v">${esc((p.stack || []).slice(0, 3).join(' · ') || 'a project')} · ${pct}% done</span></div>
        ${git.last_commit_subject ? `<div class="re-line"><span class="re-k">last</span><span class="re-v">"${esc(git.last_commit_subject)}"${dsc != null ? ` <span class="dim">· ${esc(commitAgoText(dsc))}</span>` : ''}</span></div>` : ''}
        ${dirty > 0 ? `<div class="re-line"><span class="re-k">wip</span><span class="re-v">${dirty} uncommitted file${dirty > 1 ? 's' : ''}</span></div>` : ''}
        <div class="re-line"><span class="re-k">next</span><span class="re-v">${esc(nextActionFor(p, scan?.quests))}</span></div>
      </div>
      ${rfiles.length ? '<div class="re-files" data-refiles></div>' : ''}
      <div class="rule"></div>
      <div class="p-actions" data-actions></div>
      <div class="meta" data-actionmsg style="margin-top:8px"></div>
      <div class="rule"></div>
      <div class="truth-figs">
        <div class="truth-fig">
          <span class="figure figure--xl">${pct}<span style="font-size:var(--fs-lg)">%</span></span>
          <span class="figure-label">complete${dpc ? ` <span class="p-delta" data-dir="${dpc > 0 ? 'up' : 'down'}">${dpc > 0 ? '+' : ''}${dpc}</span>` : ''}</span>
        </div>
        <div class="truth-fig">
          <span class="figure" data-sev="${esc(sec.score === 'high' ? 'red' : sec.score === 'medium' ? 'orange' : 'dim')}">${esc(String(sec.secrets_found ?? 0))}</span>
          <span class="figure-label">secrets found</span>
        </div>
        <div class="truth-fig">
          <span class="figure" data-sev="${dirty > 0 ? 'orange' : 'dim'}">${dirty}</span>
          <span class="figure-label">dirty files</span>
        </div>
      </div>
      ${p.completion?.basis ? `<div class="meta" style="margin-top:8px">${esc(p.completion.basis)}</div>` : ''}
      <div class="rule"></div>
      <div class="eyebrow">Git</div>
      <div style="margin-top:6px">
        ${kv('branch', git.branch ? `${git.branch}${git.remote ? ` → ${git.remote}` : ''}` : '—')}
        ${kv('commits', fmt(git.commits ?? 0))}
        ${kv('ahead / behind', `${git.ahead ?? 0} / ${git.behind ?? 0}`)}
        ${kv('remote', git.remote ?? 'none')}
        ${kv('risk', git.risk ?? 'unknown')}
      </div>
      <div class="rule"></div>
      <div class="eyebrow">Health</div>
      <div style="margin-top:6px">
        ${kv('state', act.state ?? 'unknown')}
        ${kv('last commit', `${act.last_commit ?? '—'} (${dsc ?? '?'}d)`)}
        ${kv('build', code.build ?? 'unknown')}
        ${kv('files / loc', `${fmt(code.files ?? 0)} / ${fmt(code.loc ?? 0)}`)}
        ${kv('tests', testsText(code.tests))}
        ${kv('todo / fixme', fmt(code.todo_fixme ?? 0))}
      </div>
      ${flags.length ? `<div class="rule"></div><div class="eyebrow">Security flags</div><div style="margin-top:6px" data-flags></div>` : ''}
      <div class="rule"></div>
      <div class="eyebrow">Stack</div>
      <div class="p-chips" style="margin-top:6px">${(p.stack || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="meta">no stack detected</span>'}</div>
      <div class="rule"></div>
      <div class="eyebrow">Open tasks</div>
      <div style="margin-top:6px" data-tasks></div>
      <div class="rule"></div>
      <div class="eyebrow">Browser time this scan</div>
      <div class="body" style="margin-top:6px">${dw
        ? `${esc(dur(dw.focus_ms || 0))} · ${esc(String(dw.visits ?? 0))} visit${dw.visits === 1 ? '' : 's'}${dw.domains?.length ? ` · ${esc(dw.domains.join(', '))}` : ''}`
        : '<span class="dim">no browser time this scan</span>'}</div>
    </div>`;

  // security flags — two shapes in the wild (v3 note): strings, or {type, detail, location}
  const flagsEl = drawer.querySelector('[data-flags]');
  if (flagsEl) {
    for (const f of flags) {
      flagsEl.appendChild(el('div', 'meta', typeof f === 'string'
        ? esc(f)
        : `${esc(f?.detail ?? f?.type ?? 'flag')}${f?.location ? ` <span class="dim">· ${esc(f.location)}</span>` : ''}`));
    }
  }

  // open tasks, worst tier first (cap 6, honest about the remainder)
  const tasksEl = drawer.querySelector('[data-tasks]');
  if (tasks.length) {
    for (const q of tasks.slice(0, 6)) {
      tasksEl.appendChild(el('div', 're-task',
        `<span class="chip" data-sev="${esc(TIER_SEV[q.tier] || 'dim')}">${esc(q.tier || 'task')}</span><span>${esc(q.title)}</span>`));
    }
    if (tasks.length > 6) tasksEl.appendChild(el('div', 'meta', `+${tasks.length - 6} more open`));
  } else {
    tasksEl.appendChild(el('span', 'dim meta', 'no open tasks'));
  }

  // recent files — real openFile or disabled-with-why, never a dead chip
  const refilesEl = drawer.querySelector('[data-refiles]');
  if (refilesEl) {
    const canOpen = typeof hq?.openFile === 'function' && !!p.path;
    for (const f of rfiles) {
      const b = el('button', 'btn btn--sm', esc(String(f).split('/').pop()));
      b.type = 'button';
      if (canOpen) {
        b.title = `Open ${f} in its default app.`;
        b.onclick = () => { Promise.resolve(hq.openFile(p.path, f)).catch((err) => console.warn('[projects/drawer] openFile failed', err)); };
      } else {
        b.disabled = true;
        b.title = p.path ? NO_BRIDGE : 'This project has no path in the scan.';
      }
      refilesEl.appendChild(b);
    }
  }

  // ---- actions row: Reveal folder + dev toggle --------------------------
  const actionsEl = drawer.querySelector('[data-actions]');
  const msg = drawer.querySelector('[data-actionmsg]');
  const reveal = el('button', 'btn', 'Reveal folder');
  reveal.type = 'button';
  actionsEl.appendChild(reveal);
  if (typeof hq?.openRepo !== 'function' || !p.path) {
    reveal.disabled = true;
    reveal.title = p.path ? NO_BRIDGE : 'This project has no path in the scan.';
  } else {
    reveal.title = 'Open this folder in Windows Explorer.';
    reveal.onclick = async () => {
      reveal.disabled = true;
      reveal.textContent = 'Opening…';                 // before the await
      msg.textContent = '';
      try {
        const res = await Promise.resolve(hq.openRepo(p.path));
        // main returns false when the path is refused (outside Documents), and
        // shell.openPath resolves to '' on success or an error STRING.
        if (res === false) throw new Error('refused — path is outside the Documents root');
        if (typeof res === 'string' && res) throw new Error(res);
        msg.textContent = 'Opened in Explorer.';
      } catch (err) {
        console.warn('[projects/drawer] openRepo failed', err);
        reveal.classList.add('btn--bad');
        msg.textContent = `Not opened — ${String(err?.message || err)}`;
      } finally {
        reveal.disabled = false;
        reveal.textContent = 'Reveal folder';
      }
    };
  }
  const dt = makeDevToggle(p, hq, devRunning);
  if (dt) actionsEl.appendChild(dt);

  scrim.appendChild(drawer);
  host.appendChild(scrim);

  const close = () => { scrim.remove(); if (onClose) onClose(); };
  drawer.querySelector('[data-close]').onclick = close;
  // Clicking the dimmed area closes; clicks inside the drawer must not.
  scrim.onclick = (e) => { if (e.target === scrim) close(); };

  drawer.querySelector('[data-close]').focus();
  return { close, el: scrim };
}
