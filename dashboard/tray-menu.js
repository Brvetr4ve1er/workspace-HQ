// The tray menu as data. main.js buildTrayMenu() hands its state and actions in
// and builds the native menu from what comes back, so the layout is testable
// without Electron.
//   trayTemplate(state, actions) → Electron MenuItemConstructorOptions[]
//     state   = { scan (latest.json or null), hudVisible, spells:[{id,name,icon}],
//                 devServers (count of running dev servers, optional, default 0) }
//     actions = { show, scan, toggleHud, quickRun, summon, openAutomations, cast(id),
//                 pushAll(projects), snapshotDirty(projects), killServers, openUrgent(project), quit }
//       pushAll/snapshotDirty get the scan projects the label counted, openUrgent the
//       project it names — main keeps its confirm dialogs, notifications and rescans.
//   statusLine(scan) → "lv 8 · 34 uncommitted · 2 secrets" (disabled first item)
//   scanCounts(scan) → { level, uncommitted, secrets, unpushed } — the numbers behind
//     the status line, also sent to the mini HUD (main.js miniPayload, IPC-CONTRACT
//     K-6) so the tray and the HUD can never disagree:
//       uncommitted = uncommitted FILES summed over projects (git_safety.dirty)
//       secrets     = secrets_found summed over projects (risk_security)
//       unpushed    = PROJECTS with commits not on the remote (git_safety.unpushed)
//       level       = account.level, or null when the scan has none
// Design (Satellites board): status line · Show · Scan now (uses Claude) · Mini HUD ✓ ·
// Quick-run… · Summon… · Run ▸ · ─ · Quick actions · ─ · Quit.
//
// Capability map from the pre-v5 buildTrayMenu (main.js ~247-280), nothing dropped:
//   Show WorkspaceHQ → Show workspace-hq · Toggle mini HUD → Mini HUD (checkbox) ·
//   Summon widget → Summon… · Cast a spell… → Quick-run… · Scan now → Scan now (uses Claude) ·
//   Cast ▸ favourites + Open Spellbook → Run ▸ spells + Open Automations ·
//   Push all unpushed / Snapshot all dirty / Kill all dev servers / Open most-urgent →
//   the same four quick actions, plain-language labels, shown only when they apply.
// Pure: no Electron requires, never throws on a partial scan (tray-menu.test.mjs).
// main.js buildTrayMenu builds the native menu from it (M4, Phase 4).

const sum = (xs, f) => xs.reduce((n, x) => { const v = Number(f(x)); return n + (Number.isFinite(v) && v > 0 ? v : 0); }, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const projectsOf = (scan) => (scan && Array.isArray(scan.projects) ? scan.projects.filter((p) => p && typeof p === 'object') : []);

function scanCounts(scan) {
  const projects = projectsOf(scan);
  const level = scan && typeof scan === 'object' ? scan.account?.level : undefined;
  return {
    level: level ?? null,
    uncommitted: sum(projects, (p) => p.metrics?.git_safety?.dirty),
    secrets: sum(projects, (p) => p.metrics?.risk_security?.secrets_found),
    unpushed: projects.filter((p) => p.metrics?.git_safety?.unpushed).length,
  };
}

function statusLine(scan) {
  if (!scan || typeof scan !== 'object') return '—';
  const c = scanCounts(scan);
  const parts = [`lv ${c.level ?? '?'}`];
  if (c.uncommitted) parts.push(`${c.uncommitted} uncommitted`);
  if (c.secrets) parts.push(plural(c.secrets, 'secret', 'secrets'));
  return parts.join(' · ');
}

function trayTemplate(state, actions) {
  const st = state && typeof state === 'object' ? state : {};
  const act = actions && typeof actions === 'object' ? actions : {};
  // Wrap every handler: Electron calls click(menuItem, window, event) — actions
  // get only the args we pass — and a missing action is a no-op, not a crash.
  const run = (name, ...args) => () => { const f = act[name]; if (typeof f === 'function') f(...args); };
  const scan = st.scan && typeof st.scan === 'object' ? st.scan : null;

  const spells = (Array.isArray(st.spells) ? st.spells : []).filter((sp) => sp && sp.id != null);
  const runMenu = [
    ...spells.map((sp) => ({ label: `${sp.icon || '✴️'} ${sp.name || sp.id}`, click: run('cast', sp.id) })),
    ...(spells.length ? [{ type: 'separator' }] : []),
    { label: 'Open Automations', click: run('openAutomations') },
  ];

  const items = [
    { label: statusLine(scan), enabled: false },
    { type: 'separator' },
    { label: 'Show workspace-hq', click: run('show') },
    { label: 'Scan now (uses Claude)', click: run('scan') },
    { label: 'Mini HUD', type: 'checkbox', checked: !!st.hudVisible, click: run('toggleHud') },
    { label: 'Quick-run… (Ctrl+Alt+X)', click: run('quickRun') },
    { label: 'Summon… (Ctrl+Alt+G)', click: run('summon') },
    { label: 'Run', submenu: runMenu },
  ];

  // Quick actions: only the ones that apply right now, each says what it does.
  const quick = [];
  const projects = projectsOf(scan);
  const unpushed = projects.filter((p) => p.metrics?.git_safety?.unpushed);
  const dirty = projects.filter((p) => Number(p.metrics?.git_safety?.dirty) > 0);
  if (unpushed.length) quick.push({ label: `Push committed work to the remote (${plural(unpushed.length, 'project', 'projects')})`, click: run('pushAll', unpushed) });
  if (dirty.length) quick.push({ label: `Back up projects with uncommitted changes (${dirty.length})`, click: run('snapshotDirty', dirty) });
  const servers = Number(st.devServers) > 0 ? Math.floor(Number(st.devServers)) : 0;
  if (servers) quick.push({ label: `Stop all running dev servers (${servers})`, click: run('killServers') });
  const top = (Array.isArray(scan?.account?.daily_top3) ? scan.account.daily_top3 : [])[0];
  const urgent = top?.project_id ? projects.find((p) => p.id === top.project_id) : null;
  if (urgent) quick.push({ label: `Open the most urgent project's folder: ${urgent.name || urgent.id}`, click: run('openUrgent', urgent) });
  if (quick.length) items.push({ type: 'separator' }, { label: 'Quick actions', enabled: false }, ...quick);

  items.push({ type: 'separator' }, { label: 'Quit', click: run('quit') });
  return items;
}

module.exports = { trayTemplate, statusLine, scanCounts };
