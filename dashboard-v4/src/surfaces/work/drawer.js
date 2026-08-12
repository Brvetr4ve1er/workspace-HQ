// Project drawer-lite — the queue's `open` verb. Everything in it comes from
// the SNAPSHOT and the panel says so at the top, because a project drawer that
// looks live while showing last night's git state is exactly the lie v4 exists
// to stop telling.
//
// One control, and it is real: "Reveal folder" calls hq.openRepo (main's
// hq:open-repo -> shell.openPath, containment-checked under Documents). Without
// a bridge it renders disabled with the reason. There is deliberately no
// "open in editor / terminal" button: launching work elsewhere is the v3 habit
// v4 replaced with the agent pane.
import { el, esc, fmt } from '../../ui/util.js';

const NO_BRIDGE = 'Needs the live app — this preview has no bridge to the main process (window.hq is absent).';

function kv(k, v) {
  return `<div class="truth-kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

export function openDrawer(host, project, hq, onClose) {
  const scrim = el('div', 'drawer-scrim');
  const p = project || {};
  const git = p.metrics?.git_safety || {};
  const sec = p.metrics?.risk_security || {};
  const code = p.metrics?.code_health || {};
  const act = p.activity || {};

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
      <div class="eyebrow">Completion</div>
      <div class="truth-figs" style="margin-top:6px">
        <div class="truth-fig">
          <span class="figure figure--xl">${esc(fmt(p.completion?.pct ?? 0))}<span style="font-size:var(--fs-lg)">%</span></span>
          <span class="figure-label">complete</span>
        </div>
        <div class="truth-fig">
          <span class="figure" data-sev="${esc(sec.score === 'high' ? 'red' : sec.score === 'medium' ? 'orange' : 'dim')}">${esc(String(sec.secrets_found ?? 0))}</span>
          <span class="figure-label">secrets found</span>
        </div>
        <div class="truth-fig">
          <span class="figure" data-sev="${esc(Number(git.dirty) > 0 ? 'orange' : 'dim')}">${esc(String(git.dirty ?? 0))}</span>
          <span class="figure-label">dirty files</span>
        </div>
      </div>
      ${p.completion?.basis ? `<div class="q-note" style="margin-top:8px">${esc(p.completion.basis)}</div>` : ''}
      <div class="rule"></div>
      <div class="eyebrow">Git</div>
      <div style="margin-top:6px">
        ${kv('branch', git.branch ?? '—')}
        ${kv('commits', fmt(git.commits ?? 0))}
        ${kv('ahead / behind', `${git.ahead ?? 0} / ${git.behind ?? 0}`)}
        ${kv('remote', git.remote ?? 'none')}
        ${kv('risk', git.risk ?? 'unknown')}
      </div>
      <div class="rule"></div>
      <div class="eyebrow">Health</div>
      <div style="margin-top:6px">
        ${kv('state', act.state ?? 'unknown')}
        ${kv('last commit', `${act.last_commit ?? '—'} (${act.days_since_commit ?? '?'}d)`)}
        ${kv('files / loc', `${fmt(code.files ?? 0)} / ${fmt(code.loc ?? 0)}`)}
        ${kv('tests', code.tests?.status ?? 'unknown')}
        ${kv('todo / fixme', fmt(code.todo_fixme ?? 0))}
      </div>
      <div class="rule"></div>
      <button class="btn" type="button" data-reveal>Reveal folder</button>
      <div class="meta" data-revealmsg style="margin-top:8px"></div>
    </div>`;

  scrim.appendChild(drawer);
  host.appendChild(scrim);

  const close = () => { scrim.remove(); if (onClose) onClose(); };
  drawer.querySelector('[data-close]').onclick = close;
  // Clicking the dimmed area closes; clicks inside the drawer must not.
  scrim.onclick = (e) => { if (e.target === scrim) close(); };

  const reveal = drawer.querySelector('[data-reveal]');
  const msg = drawer.querySelector('[data-revealmsg]');
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
        console.warn('[work/drawer] openRepo failed', err);
        reveal.classList.add('btn--bad');
        msg.textContent = `Not opened — ${String(err?.message || err)}`;
      } finally {
        reveal.disabled = false;
        reveal.textContent = 'Reveal folder';
      }
    };
  }

  drawer.querySelector('[data-close]').focus();
  return { close, el: scrim };
}
