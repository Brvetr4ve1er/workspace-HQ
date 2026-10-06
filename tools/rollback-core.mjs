// Pure core of tools\rollback.ps1: validate the renderer version, pick the running
// WorkspaceHQ app out of a process list, and plan the restart. The .ps1 gathers the
// processes (Win32_Process) and carries out the plan; every decision is made here so
// tools/rollback-core.test.mjs covers it.
//
// CLI (used by rollback.ps1; process list as JSON on stdin, plan as JSON on stdout):
//   node tools/rollback-core.mjs plan --version v3 --repo <repo root>
// Exit 2 + a message on stderr for a bad version or missing --repo.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const win = path.win32;
export const UI_VERSIONS = ['v2', 'v3', 'v4', 'v5'];

// 'v3' / 'V3' / ' v3 ' → 'v3'; anything else → null.
export function validVersion(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return UI_VERSIONS.includes(s) ? s : null;
}

// Split a Windows command line the way CommandLineToArgvW does: whitespace separates
// arguments, "…" groups (also mid-token: --user-data-dir="C:\a b"), 2n backslashes
// before a quote → n backslashes + a quote toggle, 2n+1 → n backslashes + a literal ".
export function splitArgs(cmdLine) {
  const s = String(cmdLine ?? '');
  const out = [];
  let cur = '', inQ = false, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2) cur += '"'; else inQ = !inQ;
        has = true;
      } else { cur += '\\'.repeat(n); i--; has = true; }
      continue;
    }
    if (c === '"') { inQ = !inQ; has = true; continue; }
    if (!inQ && (c === ' ' || c === '\t')) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

const norm = (p) => win.normalize(String(p)).replace(/[\\/]+$/, '').toLowerCase();

export function appPaths(repoRoot) {
  const dashboard = win.join(repoRoot, 'dashboard');
  return {
    dashboard,
    electron: win.join(dashboard, 'node_modules', 'electron', 'dist', 'electron.exe'),
    uiVersionFile: win.join(repoRoot, 'data', '.ui-version'),
  };
}

// Is this process the owner's running app? Only the MAIN process qualifies:
//  - electron.exe, and the executable is this repo's dashboard\node_modules\electron
//  - no --type= (Chromium children: gpu/renderer/utility) and no --user-data-dir
//    (test instances pass one; Chromium copies the profile dir onto every child, too)
//  - its app argument (first non-flag arg) is "." (the launchers cd into dashboard\)
//    or the dashboard folder / dashboard\main.js by absolute path. A script argument
//    (tools\trailer\render-main.js, dev-main.js) is some other Electron program.
export function matchOwnerApp(proc, repoRoot) {
  if (!proc || String(proc.Name ?? proc.name ?? '').toLowerCase() !== 'electron.exe') return false;
  const args = splitArgs(proc.CommandLine ?? proc.commandLine);
  if (!args.length) return false;
  const { dashboard, electron } = appPaths(repoRoot);
  const exe = proc.ExecutablePath ?? proc.executablePath ?? args[0];
  if (norm(exe) !== norm(electron)) return false;
  const rest = args.slice(1);
  if (rest.some((a) => /^--type=/i.test(a) || /^--user-data-dir(=|$)/i.test(a))) return false;
  const app = rest.find((a) => !a.startsWith('-'));
  if (app === undefined) return false;
  if (app === '.' || app === './' || app === '.\\') return true;
  if (!win.isAbsolute(app)) return false;
  const a = norm(app);
  return a === norm(dashboard) || a === norm(win.join(dashboard, 'main.js'));
}

// The whole rollback, decided: what to write, which PIDs to stop (main processes,
// then their leftover children), and how to relaunch.
export function planRollback({ version, procs, repoRoot }) {
  const v = validVersion(version);
  if (!v) throw new Error(`unknown renderer "${version}" — use one of ${UI_VERSIONS.join(', ')}`);
  if (!repoRoot) throw new Error('repo root required');
  const list = Array.isArray(procs) ? procs : (procs ? [procs] : []);
  const pid = (p) => Number(p.ProcessId ?? p.processId);
  const ppid = (p) => Number(p.ParentProcessId ?? p.parentProcessId);
  const mains = list.filter((p) => matchOwnerApp(p, repoRoot));
  const mainIds = new Set(mains.map(pid));
  const children = list.filter((p) => mainIds.has(ppid(p)) && !mainIds.has(pid(p))).map(pid);
  const paths = appPaths(repoRoot);
  return {
    version: v,
    target: v === 'v5' ? 'dashboard-v5/index.html' : `legacy/dashboard-${v}/index.html`,
    uiVersionFile: paths.uiVersionFile,
    stop: mains.map((p) => ({ pid: pid(p), commandLine: String(p.CommandLine ?? p.commandLine ?? '') })),
    children,
    launch: { exe: paths.electron, args: ['.', '--hidden'], cwd: paths.dashboard },
  };
}

// ---- CLI ---------------------------------------------------------------------------
async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
  if (argv[0] !== 'plan') { process.stderr.write('usage: rollback-core.mjs plan --version vN --repo <root>  (process JSON on stdin)\n'); return 2; }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  input = input.replace(/^\uFEFF/, '').trim();
  let procs = [];
  try { procs = input ? JSON.parse(input) : []; } catch (e) { process.stderr.write(`bad process JSON on stdin: ${e.message}\n`); return 2; }
  try {
    process.stdout.write(JSON.stringify(planRollback({ version: opt('--version'), procs, repoRoot: opt('--repo') })) + '\n');
    return 0;
  } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
