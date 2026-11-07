// The tray menu as data. main.js buildTrayMenu() hands its state and actions in
// and builds the native menu from what comes back, so the layout is testable
// without Electron.
//   trayTemplate(state, actions) → Electron MenuItemConstructorOptions[]
//     state   = { scan (latest.json or null), spells:[{id,name,icon}],
//                 devServers (count of running dev servers, optional, default 0),
//                 brief (a tray-brief view(), optional: null/absent = today's menu, byte for byte) }
//     actions = { show, scan, quickRun, openAutomations, cast(id), openRef(ref),
//                 pushAll(projects), snapshotDirty(projects), killServers, openUrgent(project), quit }
//       pushAll/snapshotDirty get the scan projects the label counted, openUrgent the
//       project it names — main keeps its confirm dialogs, notifications and rescans.
//   statusLine(scan) → "lv 8 · 34 uncommitted · 2 secrets" (disabled first item)
//   scanCounts(scan) → { level, uncommitted, secrets, unpushed } — the numbers behind
//     the status line:
//       uncommitted = uncommitted FILES summed over projects (git_safety.dirty)
//       secrets     = secrets_found summed over projects (risk_security)
//       unpushed    = PROJECTS with commits not on the remote (git_safety.unpushed)
//       level       = account.level, or null when the scan has none
// Design (Satellites board): status line · Show · Scan now (uses Claude) ·
// Quick-run… · Run ▸ · ─ · Quick actions · ─ · Quit. (Mini HUD and Summon were cut
// 2026-10-28 — no use in a month; restore from tag cleanup-base-2026-10-28.)
//
// Capability map from the pre-v5 buildTrayMenu (main.js ~247-280), nothing dropped:
//   Show WorkspaceHQ → Show workspace-hq · Cast a spell… → Quick-run… · Scan now → Scan now (uses Claude) ·
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
  // a scan row first reports its click (openRef logs the use and answers 'scan', opening nothing), then runs the Scan path
  const runScanRow = (ref) => () => { const f = act.openRef; if (typeof f === 'function') { try { f(ref); } catch { /* the use log never blocks a scan */ } } const s = act.scan; if (typeof s === 'function') s(); };
  const scan = st.scan && typeof st.scan === 'object' ? st.scan : null;

  const spells = (Array.isArray(st.spells) ? st.spells : []).filter((sp) => sp && sp.id != null);
  const runMenu = [
    ...spells.map((sp) => ({ label: `${sp.icon || '✴️'} ${sp.name || sp.id}`, click: run('cast', sp.id) })),
    ...(spells.length ? [{ type: 'separator' }] : []),
    { label: 'Open Automations', click: run('openAutomations') },
  ];

  // The Brief block (tray-brief.js view): its status line replaces the level line (kept below it while the brief isn't ready),
  // then up to 3 rows (a scan row runs the Scan path, any other opens where it gets cleared) and the "+N more" line (opens Home).
  const br = st.brief && typeof st.brief === 'object' ? st.brief : null;
  const head = [];
  if (br) {
    head.push({ label: String(br.statusLine || 'Brief not ready yet'), enabled: false });
    if (br.showLevel) head.push({ label: statusLine(scan), enabled: false });
    if (br.noteLine) head.push({ label: String(br.noteLine), enabled: false });
    for (const r of (Array.isArray(br.rows) ? br.rows : []).slice(0, 3)) if (r && typeof r.ref === 'string') head.push({ label: String(r.label || ''), click: r.scan ? runScanRow(r.ref) : run('openRef', r.ref) });
    if (br.overflow && br.overflow.label) head.push({ label: String(br.overflow.label), click: run('show') });
  } else head.push({ label: statusLine(scan), enabled: false });

  const items = [
    ...head,
    { type: 'separator' },
    { label: 'Show workspace-hq', click: run('show') },
    { label: 'Scan now (uses Claude)', click: run('scan') },
    { label: 'Quick-run… (Ctrl+Alt+X)', click: run('quickRun') },
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
