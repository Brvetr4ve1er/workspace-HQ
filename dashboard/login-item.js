// Start WorkspaceHQ at login, hidden to the tray (data overhaul Front A4).
// Before 2026-10-26 only a packaged build registered itself, and the owner runs the app
// unpackaged (electron.exe . --hidden), so it never auto-started: scans that landed while it
// was closed weren't caught live. The unpackaged entry runs the same electron.exe with this
// app folder + --hidden. Test and preview instances never register: anything started with its
// own --user-data-dir, a v5 harness profile, --selftest, or HQ_NO_LOGIN_ITEM=1.
// Turn it off: Task Manager › Startup apps, or launch once with HQ_NO_LOGIN_ITEM=1 (it then
// stays as it is — the env var skips the write, it doesn't remove the entry).

function loginItemPlan({ isPackaged, argv = [], execPath, appPath, env = {} }) {
  const isTest = argv.some((a) => typeof a === 'string' && (a.startsWith('--user-data-dir') || a === '--selftest'))
    || !!env.HQ_NO_LOGIN_ITEM || !!env.HQ_V5_PROFILE;
  if (isTest) return null;
  if (isPackaged) return { openAtLogin: true, args: ['--hidden'] };
  if (!execPath || !appPath) return null;
  // Electron writes the Run entry as `path args…` verbatim, unquoted — and these paths hold spaces
  // ("ROG STRIX", "workspace hq"), which Windows would split. Quote both.
  return { openAtLogin: true, path: quote(execPath), args: [quote(appPath), '--hidden'] };
}
const quote = (s) => (/\s/.test(s) && !/^".*"$/.test(s) ? '"' + s + '"' : s);

function init({ app, argv = process.argv, env = process.env, log = console }) {
  const plan = loginItemPlan({ isPackaged: app.isPackaged, argv, execPath: process.execPath, appPath: app.getAppPath(), env });
  if (!plan) return null;
  try { app.setLoginItemSettings(plan); } catch (e) { log.error('[login-item] could not register: ' + ((e && e.message) || e)); return null; }
  return plan;
}

module.exports = { init, loginItemPlan };
