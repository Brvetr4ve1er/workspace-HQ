'use strict';
/* Client delivery check — the Electron-run native check (dashboard/delivery-check.native.check.js).

   The fake-window tests (delivery-check.test.mjs) prove the wiring; only a real Chromium can say whether the defence holds.
   This script runs the real dashboard/delivery-check.js in a real hidden Electron against the placeholder site
   dashboard/__fixtures__/make-check-site.mjs (three pages with deliberate faults and non-loopback references) and checks:

     1. every seeded fault is found (REFS.faults: overflow, viewport, small text, 20 px tap target, identical strings,
        missing dir, a number run inside Arabic);
     2. the "N outside requests blocked" count equals the fixture's non-loopback references that the network stack asks
        about (REFS.visibleOutside);
     3. no outside request succeeded: the fixture's hosts are example.test names that never resolve, and the canary
        (below) never answers, so a connection that reaches it is counted, not served;
     4. the defence in depth is MEASURED: the black-hole proxy is replaced by a loopback canary listener, and the number of
        connections it saw (traffic the webRequest hook cannot see: WebRTC STUN, DNS prefetch, a preconnect hint) is
        printed. A non-zero count means the hook alone would have leaked it and the proxy caught it; zero means the
        browser made no such attempt. Neither is an error; "reached the real network" is impossible by construction here.

     dashboard\node_modules\electron\dist\electron.exe dashboard\delivery-check.native.check.js

   Exit codes copy dashboard-v5/dev-main.js: 0 clean, 1 a check failed, 2 timed out after 60 s.
   A hidden test instance: its own userData under os.tmpdir() (named by HQ_DCK_CHECK_PROFILE), no single-instance lock, no
   tray, no shortcuts, no visible window, a temp data dir removed afterwards. It cannot touch the owner's running app.

   HQ_DCK_CHECK_BREAK=hook   test-only: points the run at a port nothing listens on; the run must then exit 1 (it proves
                             the check can fail). */

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TIMEOUT_MS = 60000;
const BREAK = process.env.HQ_DCK_CHECK_BREAK === 'hook';

app.setPath('userData', path.join(os.tmpdir(), process.env.HQ_DCK_CHECK_PROFILE || 'hq-dck-check-profile'));
app.on('window-all-closed', () => { /* the check window comes and goes; do not quit when it does */ });

let finished = false;
function finish(code, line) {
  if (finished) return;
  finished = true;
  const exit = () => app.exit(code);
  process.stdout.write(line + '\n', exit);
  setTimeout(exit, 1500);
}
const say = (line) => process.stdout.write('[delivery-check-native] ' + line + '\n');
const messageOf = (e) => String((e && e.message) || e).slice(0, 300);
const fileUrl = (...p) => pathToFileURL(path.join(__dirname, ...p)).href;

async function main() {
  const site = await (await import(fileUrl('__fixtures__', 'make-check-site.mjs'))).startCheckSite();
  const { REFS } = await import(fileUrl('__fixtures__', 'make-check-site.mjs'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dck-native-'));
  // the canary: a loopback listener standing where the black-hole proxy would; it counts and drops every connection
  let canaryConnections = 0;
  const canary = net.createServer((sock) => { canaryConnections++; sock.on('error', () => {}); sock.destroy(); });
  await new Promise((r) => canary.listen(0, '127.0.0.1', r));
  const canaryPort = canary.address().port;
  const cleanup = async () => {
    try { await site.close(); } catch { /* closing */ }
    try { canary.close(); } catch { /* closing */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp */ }
  };

  const failures = [];
  const expect = (ok, what) => { say((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

  try {
    const { create } = require('./delivery-check.js');
    const project = { id: 'acme-site', dev_cmd: 'node serve-acme.js --port ' + site.port };
    const c = create({ dataDir, latest: () => ({ projects: [project] }), proxyPort: canaryPort, settleMs: 600 });

    const found = await c.detect('acme-site');
    expect(found.state === 'ready' && found.candidates[0] && found.candidates[0].origin === site.origin, 'detect found the fixture site at its own port from the command');
    expect(found.candidates[0] && found.candidates[0].title === 'Acme Studio', 'detect read the page title');

    const report = await c.run('acme-site', BREAK ? 'http://127.0.0.1:1' : site.origin);
    if (report.error) { expect(false, 'the run finished: ' + report.error); throw new Error(report.error); }
    expect(report.routes.length === 3, 'three pages were checked (entry, /fr, /ar): ' + report.routes.map((r) => r.path).join(' '));
    for (const f of REFS.faults) {
      expect(report.findings.some((x) => x.id === f.id && x.route === f.route), 'fault found: ' + f.id + ' on ' + f.route);
    }
    expect(report.shots.length === 3, 'one phone-size screenshot per page (' + report.shots.length + ')');
    const shotPath = report.shots[0] && c.shotPath(report.shots[0]);
    expect(!!shotPath && fs.existsSync(shotPath) && fs.statSync(shotPath).size > 500, 'the screenshot file exists and is not empty');
    const want = REFS.visibleOutside.length;
    expect(report.blocked.count === want, 'blocked count ' + report.blocked.count + ' equals the fixture\'s non-loopback references ' + want);
    expect(report.blockedLine.includes('blocked') && !/nothing left your pc/i.test(JSON.stringify(report)), 'the wording is "blocked and counted", never absolute');
    expect(report.requestsSeen <= 200, 'requests seen within the 200 budget (' + report.requestsSeen + ')');
    // no outside request succeeded: nothing ever answered on the canary, and the fixture never saw a non-loopback Host header
    say('no outside request can have succeeded: the canary only counts and drops, and example.test never resolves (stated by construction, not asserted)');
    say('canary connections from traffic the webRequest hook cannot see: ' + canaryConnections + ' (fixture seeded ' + REFS.invisibleOutside.length + ' such references: ' + REFS.invisibleOutside.map((r) => r.kind).join(', ') + ')');
    const forgot = await c.forget('acme-site');
    expect(forgot.ok === true && (await c.read('acme-site')) === null, 'forget removes the report');
  } catch (e) {
    if (!failures.length) failures.push('crashed: ' + messageOf(e));
  }
  await cleanup();
  if (failures.length) return finish(1, '[delivery-check-native] ' + failures.length + ' check(s) failed');
  finish(0, '[delivery-check-native] all checks passed');
}

process.on('unhandledRejection', (e) => finish(1, '[delivery-check-native] unhandled rejection: ' + messageOf(e)));
app.whenReady().then(() => {
  setTimeout(() => finish(2, '[delivery-check-native] timed out after ' + TIMEOUT_MS / 1000 + ' s'), TIMEOUT_MS).unref();
  return main();
}).catch((e) => finish(1, '[delivery-check-native] the check crashed: ' + messageOf(e)));
