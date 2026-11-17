'use strict';
/* The Launcher's real-process check (dashboard/launcher.native.check.js). Nothing visible ever opens.

   launcher.test.mjs proves the checks and the argument lists with a fake spawn. This proves only what a HIDDEN child can prove:

     1. the real drive lookup (hidden System32 PowerShell) calls the temp folder's drive "Fixed", so an entry on it is added through the
        real launcher.js (the dialog is a fake that returns the invented folder; no dialog opens);
     2. the Windows Terminal lookup: read() says "wt" exactly when the fixed WindowsApps alias exists on this machine; the check only
        looks the file up, it never starts it. When the alias is missing it says so and passes (the console is the fallback);
     3. a hidden child started through the launcher's own spawn options: the real node.exe is chosen as the "editor" (an invented
        folder with an index.js that writes a marker and then waits), Open workspace starts it as [exe, folder] with the spawn options
        launcher.js builds (detached, stdio ignored, no shell, tokens dropped) plus windowsHide:true (the one change: a console program
        must not show a window here), the marker proves it ran in the folder with the folder as its argument, and the check stops it
        (taskkill /t) and sees it gone. The terminal step is planned but NEVER started: the spawn wrapper records it and returns a stub.

   NOT done here, by rule (the owner's one real click does it): opening Windows Terminal, an editor window, a file dialog, a browser.
   Everything lives in one temp folder removed afterwards; every child it starts is stopped, also on a failure or a timeout.

     node dashboard\launcher.native.check.js

   Exit codes copy the other native checks: 0 clean, 1 a check failed, 2 timed out after 60 s. Windows only (elsewhere a note and exit 0).
   HQ_LAUNCHER_CHECK_PROFILE (set by the gate) only names the temp folder. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');

if (process.platform !== 'win32') { console.log('[launcher-native] not Windows: nothing to check here'); process.exit(0); }

const failures = [];
const note = (m) => console.log('[launcher-native] ' + m);
const fail = (m) => { failures.push(m); console.log('[launcher-native] FAIL ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };

const started = [];   // every real child pid, so the final cleanup can stop what a failure left behind
const killTree = (pid) => { try { childProcess.spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/f', '/t'], { windowsHide: true, timeout: 10000 }); } catch { /* gone */ } };

const base = process.env.HQ_LAUNCHER_CHECK_PROFILE ? path.resolve(process.env.HQ_LAUNCHER_CHECK_PROFILE) : path.join(os.tmpdir(), 'hq-launcher-native-' + process.pid);
const cleanup = () => { for (const p of started) { if (alive(p)) killTree(p); } try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* temp */ } };
const timer = setTimeout(() => { note('timed out'); cleanup(); process.exit(2); }, 60000);
process.on('exit', cleanup);

(async () => {
  fs.mkdirSync(base, { recursive: true });
  const root = fs.realpathSync.native(base);   // the long form: a short 8.3 name is refused by design
  const data = path.join(root, 'data'), proj = path.join(root, 'proj a');
  fs.mkdirSync(data); fs.mkdirSync(proj);
  const marker = path.join(root, 'marker.txt');
  fs.writeFileSync(path.join(proj, 'index.js'), "require('fs').writeFileSync(" + JSON.stringify(marker) + ", process.cwd() + '|' + process.argv[1]); setTimeout(function () {}, 60000);\n");

  const { create } = require('./launcher.js');
  const crypto = { encrypt: (s) => Buffer.from('sealed:' + s).toString('base64'), decrypt: (b) => { const t = Buffer.from(b, 'base64').toString(); return t.startsWith('sealed:') ? t.slice(7) : null; } };
  const queue = [];
  const dialog = { showOpenDialog: async () => { const p = queue.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; } };
  const planned = [];
  let editorChild = null;
  const spawn = (file, args, options) => {
    const isEditor = path.resolve(file).toLowerCase() === path.resolve(process.execPath).toLowerCase();
    planned.push({ file, args, isEditor, options });
    if (!isEditor) { const stub = new EventEmitter(); stub.pid = 0; stub.unref = () => {}; return stub; }   // the terminal is planned, never started
    editorChild = childProcess.spawn(file, args, { ...options, windowsHide: true });
    if (editorChild && editorChild.pid) started.push(editorChild.pid);
    return editorChild;
  };
  const marks = [], audits = [];
  const dev = { state: async () => 'none', start: async () => 'refused' };
  const l = create({ dataDir: data, documentsRoot: root, resolveProjectPath: (p) => p, latest: () => ({ projects: [{ id: 'proj-a', name: 'Project A', path: proj, dev_cmd: '' }] }), dev,
    shell: { openPath: async () => 'x', openExternal: async () => { throw new Error('never'); } }, dialog, getWin: () => null, crypto, useMark: (s, a) => { marks.push(s + '/' + a); return { ok: true }; },
    audit: async (f) => { audits.push(f); }, spawn });

  // 1. the real drive lookup, through a real add
  queue.push(proj);
  const added = await l.add({ kind: 'folder' });
  if (added.state === 'added') note('the real drive lookup calls the temp drive Fixed: a folder entry was added');
  else if (added.state === 'refused') note('the temp drive is not called Fixed on this machine (' + added.why + '): the rest of the check cannot add entries here');
  else fail('add answered ' + JSON.stringify(added));

  // 2. Windows Terminal: a lookup only
  const wtFile = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
  let there = false; try { fs.lstatSync(wtFile); there = true; } catch { there = false; }
  const read0 = await l.read();
  if (read0.terminal !== (there ? 'wt' : 'console')) fail('read() says terminal=' + read0.terminal + ' but the alias ' + (there ? 'exists' : 'is missing'));
  else note(there ? 'wt.exe alias found at its fixed place (looked up, never started)' : 'no wt.exe alias on this machine: the console is the fallback (nothing to fail)');

  // 3. a hidden child through Open workspace
  queue.push(process.execPath);
  const app = await l.add({ kind: 'app' });
  if (app.state !== 'added') { note('node.exe could not be added as an app here (' + JSON.stringify(app) + '): step 3 skipped'); }
  else {
    if ((await l.setEditor({ id: app.id })).state !== 'set') fail('the editor could not be set');
    const out = await l.openWorkspace({ projectId: 'proj-a' });
    if (!out.steps || out.steps[1].state !== 'opened') fail('the editor step answered ' + JSON.stringify(out.steps));
    const ed = planned.find((p) => p.isEditor);
    if (!ed) fail('no editor spawn was planned');
    else {
      if (ed.args.length !== 1 || path.resolve(ed.args[0]).toLowerCase() !== path.resolve(proj).toLowerCase()) fail('the editor argument list is ' + JSON.stringify(ed.args));
      if (ed.options.shell !== false || ed.options.stdio !== 'ignore' || ed.options.detached !== true) fail('the spawn options are not detached, silent and shell-free');
      if (Object.keys(ed.options.env || {}).some((k) => /token|secret|password/i.test(k))) fail('a secret-looking variable reached the child');
    }
    const ran = await until(() => fs.existsSync(marker), 15000);
    if (!ran) fail('the hidden child never wrote its marker');
    else {
      const [cwd, arg] = fs.readFileSync(marker, 'utf8').split('|');
      if (path.resolve(cwd).toLowerCase() !== path.resolve(proj).toLowerCase()) fail('the child ran in ' + cwd);
      if (path.resolve(arg).toLowerCase() !== path.resolve(proj).toLowerCase()) fail('the child got the argument ' + arg);
      else note('a hidden child ran as [exe, folder] in the folder through the launcher\'s own options');
    }
    const term = planned.find((p) => !p.isEditor);
    if (!term) fail('no terminal step was planned');
    else if (there ? path.resolve(term.file).toLowerCase() !== path.resolve(wtFile).toLowerCase() || term.args[0] !== '-d' : !/cmd\.exe$/i.test(term.file)) fail('the terminal plan is ' + JSON.stringify([term.file, term.args]));
    else note('the terminal was planned as ' + (there ? 'wt.exe -d <folder>' : 'the console') + ' and not started');
    if (editorChild && editorChild.pid) {
      killTree(editorChild.pid);
      const gone = await until(() => !alive(editorChild.pid), 10000);
      if (!gone) fail('the hidden child did not stop'); else note('the hidden child was stopped and is gone');
    }
    if (!marks.includes('launcher-workspace/act')) fail('no act mark for a started editor');
    if (audits.length < 1 || JSON.stringify(audits).includes(root)) fail('the audit line is missing or holds a path');
  }
  clearTimeout(timer);
  if (failures.length) { note(failures.length + ' check(s) failed'); cleanup(); process.exit(1); }
  note('clean');
  cleanup();
  process.exit(0);
})().catch((e) => { fail('crashed: ' + (e && e.message)); cleanup(); process.exit(1); });
