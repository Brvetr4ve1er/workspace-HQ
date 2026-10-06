// node --test dashboard/screen-capture.test.mjs — the studio main-process wire (v5 clean pass S1).
// Pure helpers first, then init() driven with fake Electron deps (fake ipcMain / BrowserWindow /
// screen / desktopCapturer / clipboard / nativeImage) against a temp library root
// (HQ_STUDIO_ROOT), so recordings and snips really hit the filesystem — never the owner's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sc = require('./screen-capture.js');
const { CH, _pure: P } = sc;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(10)) { if (fn()) return true; }
  return false;
}

// ---------------------------------------------------------------- pure helpers

test('normalizeSnipAction: only save/copy/claude survive; everything else is "absent"', () => {
  for (const a of ['save', 'copy', 'claude']) assert.equal(P.normalizeSnipAction(a), a);
  for (const a of [undefined, null, '', 'SAVE', 'delete', 1, {}]) assert.equal(P.normalizeSnipAction(a), null);
});

test('snipPlan: absent = file + clipboard (pre-v5), copy = clipboard only, save = file only, claude = file + launch', () => {
  assert.deepEqual(P.snipPlan(undefined), { file: true, clipboard: true, claude: false });
  assert.deepEqual(P.snipPlan('bogus'), { file: true, clipboard: true, claude: false });
  assert.deepEqual(P.snipPlan('copy'), { file: false, clipboard: true, claude: false });
  assert.deepEqual(P.snipPlan('save'), { file: true, clipboard: false, claude: false });
  assert.deepEqual(P.snipPlan('claude'), { file: true, clipboard: false, claude: true });
});

const ABS = path.resolve(os.tmpdir(), 'project-a');
const ABS_B = path.resolve(os.tmpdir(), 'project-b');

test('publicProjects: {id, name} only — paths never reach the renderer; invalid rows dropped', () => {
  const out = P.publicProjects([
    { id: 'project-a', name: 'Project A', path: ABS },
    { id: 'project-b', path: ABS_B },                          // name falls back to id
    { id: 'rel', name: 'Relative', path: 'some/relative' },    // not absolute → dropped
    { id: '', name: 'No id', path: ABS },                      // no id → dropped
    null, 'x', { name: 'no id at all', path: ABS },
  ]);
  assert.deepEqual(out, [{ id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'project-b' }]);
  assert.ok(out.every((p) => !('path' in p)));
  assert.deepEqual(P.publicProjects(null), []);
  assert.deepEqual(P.publicProjects({}), []);
});

test('pickProject: resolves an id against main\'s list only; unknown / bad ids and relative paths give null', () => {
  const list = [{ id: 'project-a', name: 'A', path: ABS }, { id: 'rel', path: 'rel/path' }];
  assert.equal(P.pickProject(list, 'project-a').path, ABS);
  assert.equal(P.pickProject(list, 'rel'), null);
  assert.equal(P.pickProject(list, 'nope'), null);
  assert.equal(P.pickProject(list, ABS), null, 'a path is not an id');
  assert.equal(P.pickProject(list, undefined), null);
  assert.equal(P.pickProject(null, 'project-a'), null);
});

test('claudePrompt: the exact prompt K-5 hands launchClaude', () => {
  assert.equal(P.claudePrompt('C:\\shots\\a.png'), 'Look at this screenshot: C:\\shots\\a.png — ');
});

test('panelBounds: setup 340×180 / live 230×44, top-left kept and clamped into the work area', () => {
  assert.deepEqual(P.panelBounds('live', { x: 100, y: 50 }, null), { x: 100, y: 50, width: 230, height: 44 });
  assert.deepEqual(P.panelBounds('setup', { x: 100, y: 50 }, null), { x: 100, y: 50, width: 340, height: 180 });
  const wa = { x: 0, y: 0, width: 1000, height: 700 };
  assert.deepEqual(P.panelBounds('setup', { x: 900, y: 650 }, wa), { x: 660, y: 520, width: 340, height: 180 });
  assert.deepEqual(P.panelBounds('live', { x: -50, y: -10 }, wa), { x: 0, y: 0, width: 230, height: 44 });
  assert.equal(P.panelBounds('huge', { x: 0, y: 0 }, wa), null);
  assert.equal(P.panelBounds('__proto__', { x: 0, y: 0 }, wa), null);
});

test('envRootFrom: absolute paths only', () => {
  assert.equal(P.envRootFrom(ABS), ABS);
  assert.equal(P.envRootFrom('  ' + ABS + '  '), ABS);
  assert.equal(P.envRootFrom('relative/dir'), null);
  assert.equal(P.envRootFrom(''), null);
  assert.equal(P.envRootFrom(undefined), null);
});

// ---------------------------------------------------------------- init() with fake Electron

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-screen-capture-test-'));
test.after(() => { delete process.env.HQ_STUDIO_ROOT; fs.rmSync(TMP, { recursive: true, force: true }); });

function harness({ getProjects, launchClaude, hardStopMs = 120, renameRetryMs } = {}) {
  const base = fs.mkdtempSync(path.join(TMP, 'h-'));
  const root = path.join(base, 'library');
  const videos = path.join(base, 'videos');
  process.env.HQ_STUDIO_ROOT = root;

  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => listeners.set(ch, fn) };
  const windows = [];
  class FakeWin extends EventEmitter {
    constructor(opts = {}) {
      super();
      this.opts = opts;
      this.bounds = { x: opts.x ?? 100, y: opts.y ?? 100, width: opts.width ?? 800, height: opts.height ?? 600 };
      this.destroyed = false;
      this.visible = false;
      this.resizable = opts.resizable !== false;
      this.sent = [];
      this.boundsCalls = [];
      const self = this;
      this.webContents = Object.assign(new EventEmitter(), {
        send: (ch, p) => self.sent.push([ch, p]),
        isDestroyed: () => self.destroyed,
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadFile(file, o) { this.file = file; this.query = o && o.query; setImmediate(() => this.emit('ready-to-show')); return Promise.resolve(); }
    show() { this.visible = true; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isVisible() { return this.visible; }
    close() { this.destroyed = true; this.emit('closed'); }
    setContentProtection() {}
    setAlwaysOnTop() {}
    getBounds() { return { ...this.bounds }; }
    setBounds(b) { this.boundsCalls.push({ b, resizable: this.resizable }); if (this.resizable) this.bounds = { ...b }; }
    isResizable() { return this.resizable; }
    setResizable(v) { this.resizable = !!v; }
  }
  FakeWin.getAllWindows = () => windows.filter((w) => !w.destroyed);

  const display = { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 0, width: 800, height: 560 }, scaleFactor: 1 };
  const screen = {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
  };
  const thumb = { toDataURL: () => 'data:image/png;base64,AAAA', toPNG: () => Buffer.from('full') };
  const desktopCapturer = { getSources: async () => [{ id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: thumb }] };
  const image = {
    crop: (r) => ({ ...image, cropped: r }),
    toPNG: () => Buffer.from('PNGDATA'),
    resize: () => ({ toJPEG: () => Buffer.from('JPG') }),
  };
  const nativeImage = { createFromDataURL: () => image };
  const clipboard = { writes: [], writeImage(img) { this.writes.push(img); } };
  const app = { getPath: (name) => (name === 'videos' ? videos : path.join(base, 'userData')) };

  const mainWin = new FakeWin({ title: 'main' });   // receives broadcasts, like the real main window
  sc.init({
    ipcMain, app, BrowserWindow: FakeWin, screen, desktopCapturer,
    clipboard, nativeImage, shell: { showItemInFolder() {}, trashItem: async () => {} },
    getProjects, launchClaude, hardStopMs, renameRetryMs,
  });

  const h = {
    root, videos, windows, mainWin, clipboard,
    invoke: (ch, arg, sender = null) => handlers.get(ch)({ sender }, arg),
    emit: (ch, arg, sender = null) => listeners.get(ch)({ sender }, arg),
    broadcasts: (ch) => mainWin.sent.filter(([c]) => c === ch).map(([, p]) => p),
    shots: () => { try { return fs.readdirSync(path.join(root, 'screenshots')).filter((n) => n.endsWith('.png')); } catch { return []; } },
    thumbs: () => { try { return fs.readdirSync(path.join(root, 'screenshots', '.thumbs')); } catch { return []; } },
    overlay: () => windows.find((w) => w.opts.title === 'WorkspaceHQ Snip Overlay' && !w.destroyed) || null,
    async arm() {
      await h.invoke(CH.SNIP_ARM, { kind: 'region' });
      assert.ok(await waitFor(() => { const o = h.overlay(); return o && o.sent.some(([c]) => c === CH.SNIP_FROZEN); }), 'overlay got its freeze');
      return h.overlay().sent.find(([c]) => c === CH.SNIP_FROZEN)[1];
    },
    fakeOwner() {
      const wc = Object.assign(new EventEmitter(), { sent: [], destroyed: false });
      wc.send = (ch, p) => wc.sent.push([ch, p]);
      wc.isDestroyed = () => wc.destroyed;
      return wc;
    },
  };
  return h;
}

const RECT = { x: 10, y: 20, w: 30, h: 40 };

test('settings: rootOverride reads back HQ_STUDIO_ROOT and stays refused over IPC', async () => {
  const h = harness();
  const s = await h.invoke(CH.SET_GET);
  assert.equal(s.rootOverride, h.root);
  const after = await h.invoke(CH.SET_SET, { rootOverride: path.join(TMP, 'elsewhere'), defaultMic: true });
  assert.equal(after.rootOverride, h.root, 'IPC cannot move the library root');
  assert.equal(after.defaultMic, true);
  assert.ok(!fs.existsSync(h.videos), 'nothing touched the default <videos> root');
});

test('snip copy: clipboard only — no file, no thumb, no capture-added', async () => {
  const h = harness();
  await h.arm();
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region', action: 'copy' });
  assert.ok(await waitFor(() => h.clipboard.writes.length === 1));
  await sleep(30);
  assert.deepEqual(h.shots(), []);
  assert.deepEqual(h.thumbs(), []);
  assert.equal(h.broadcasts(CH.CAPTURE_ADDED).length, 0);
  assert.deepEqual(h.clipboard.writes[0].cropped, { x: 10, y: 20, width: 30, height: 40 });
  assert.equal(h.overlay(), null, 'overlays closed');
});

test('snip save: file + thumb, no clipboard; capture-added carries a path inside the root', async () => {
  const h = harness();
  await h.arm();
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region', action: 'save' });
  assert.ok(await waitFor(() => h.broadcasts(CH.CAPTURE_ADDED).length === 1));
  assert.equal(h.shots().length, 1);
  assert.equal(h.thumbs().length, 1);
  assert.equal(h.clipboard.writes.length, 0);
  const added = h.broadcasts(CH.CAPTURE_ADDED)[0];
  assert.equal(added.kind, 'shot');
  assert.ok(added.path.startsWith(h.root + path.sep));
  assert.equal(fs.readFileSync(added.path, 'utf8'), 'PNGDATA');
});

test('snip with no action keeps the pre-v5 behaviour: file + thumb + clipboard', async () => {
  const h = harness();
  await h.arm();
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region' });
  assert.ok(await waitFor(() => h.broadcasts(CH.CAPTURE_ADDED).length === 1));
  assert.equal(h.shots().length, 1);
  assert.equal(h.clipboard.writes.length, 1);
});

test('snip claude (K-5 wired): projects reach the overlay without paths; launch gets the project path + absolute shot path', async () => {
  const calls = [];
  const h = harness({
    getProjects: () => [{ id: 'project-a', name: 'Project A', path: ABS }, { id: 'project-b', name: 'Project B', path: ABS_B }],
    launchClaude: (cwd, prompt) => { calls.push({ cwd, prompt }); return true; },
  });
  const frozen = await h.arm();
  assert.deepEqual(frozen.projects, [{ id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'Project B' }]);
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region', action: 'claude', projectId: 'project-b' });
  assert.ok(await waitFor(() => calls.length === 1));
  const shot = h.broadcasts(CH.CAPTURE_ADDED)[0].path;
  assert.ok(path.isAbsolute(shot) && shot.startsWith(h.root + path.sep), 'the shot stays in the library');
  assert.deepEqual(calls[0], { cwd: ABS_B, prompt: `Look at this screenshot: ${shot} — ` });
  assert.equal(h.clipboard.writes.length, 0);
  assert.ok(!fs.existsSync(ABS_B), 'nothing was written into the project');
});

test('snip claude with an unknown project id: saved, never launched', async () => {
  const calls = [];
  const h = harness({ getProjects: () => [{ id: 'project-a', path: ABS }], launchClaude: (...a) => { calls.push(a); return true; } });
  await h.arm();
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region', action: 'claude', projectId: '../../etc' });
  assert.ok(await waitFor(() => h.shots().length === 1));
  await sleep(30);
  assert.equal(calls.length, 0);
});

test('snip claude without K-5 wiring: the overlay gets no projects; a forced claude commit saves and refuses', async () => {
  const h = harness({ getProjects: () => [{ id: 'project-a', path: ABS }] });   // launchClaude missing
  const frozen = await h.arm();
  assert.deepEqual(frozen.projects, [], 'half-wired = not offered');
  h.emit(CH.SNIP_COMMIT, { displayId: 1, rectDIP: RECT, mode: 'region', action: 'claude', projectId: 'project-a' });
  assert.ok(await waitFor(() => h.shots().length === 1), 'the capture is not lost');
});

test('snip cancel closes the overlays and writes nothing', async () => {
  const h = harness();
  await h.arm();
  h.emit(CH.SNIP_CANCEL);
  assert.equal(h.overlay(), null);
  assert.deepEqual(h.shots(), []);
});

// ---------------------------------------------------------------- recording

const chunk = (s) => Buffer.from(s);

test('recording: chunks from seq 0 land in order, the parked tail drains on stop, gaps are counted', async () => {
  const h = harness();
  const owner = h.fakeOwner();
  const { recId, tmpPath } = await h.invoke(CH.REC_START, { sourceId: 'screen:1:0', sourceLabel: 'Screen 1' }, owner);
  assert.ok(tmpPath.startsWith(h.root + path.sep), 'the .part lives in the test root');
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: chunk('B') });   // parks — 0 hasn't come
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });   // releases 0 and 1
  h.emit(CH.REC_CHUNK, { recId, seq: 3, buf: chunk('D') });   // parks across the hole at 2
  h.emit(CH.REC_CHUNK, { recId, seq: '0', buf: chunk('X') }); // junk seq: ignored (was `| 0` → 0)
  h.emit(CH.REC_CHUNK, { recId, seq: -1, buf: chunk('X') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(fs.readFileSync(res.path, 'utf8'), 'ABD', 'the parked tail was written, not dropped');
  assert.equal(res.gaps, 1);
  assert.ok(!fs.existsSync(tmpPath), '.part renamed away');
  const stopped = h.broadcasts(CH.REC_STATUS).filter((s) => s.state === 'stopped');
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].lastPath, res.path);
});

test('recording: ArrayBuffer and Uint8Array chunks are accepted', async () => {
  const h = harness();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  const ab = new TextEncoder().encode('ab').buffer;
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: ab });
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: new TextEncoder().encode('cd') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(fs.readFileSync(res.path, 'utf8'), 'abcd');
  assert.equal(res.gaps, 0);
});

test('recording: paused time is excluded from elapsedMs, and rec-status carries paused', async () => {
  const h = harness();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  const t0 = Date.now();
  await sleep(60);
  h.emit(CH.REC_PAUSE, { recId, paused: true });
  const pausedPush = h.broadcasts(CH.REC_STATUS).filter((s) => s.recId === recId && s.paused === true);
  assert.equal(pausedPush.length, 1, 'a status push announces the pause');
  await sleep(300);
  h.emit(CH.REC_PAUSE, { recId, paused: false });
  await sleep(60);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  const wall = Date.now() - t0;
  assert.ok(res.durationMs <= wall - 250, `duration ${res.durationMs} ms excludes the ~300 ms pause (wall ${wall} ms)`);
  assert.ok(res.durationMs >= 100, `duration ${res.durationMs} ms still counts the recorded time`);
  const resumed = h.broadcasts(CH.REC_STATUS).filter((s) => s.recId === recId && s.state === 'recording').pop();
  assert.equal(resumed.paused, false);
});

test('main-initiated stop asks the recording\'s panel first; a cooperating panel saves before the hard stop', async () => {
  const h = harness({ hardStopMs: 150 });
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  const t = await h.invoke(CH.REC_TOGGLE, {});
  assert.deepEqual(t, { toggled: 'stopped', recId });
  const cmds = owner.sent.filter(([c]) => c === CH.REC_COMMAND).map(([, p]) => p);
  assert.deepEqual(cmds, [{ cmd: 'stop', reason: 'hotkey', recId }], 'only the owner got the command');
  assert.equal(h.mainWin.sent.filter(([c]) => c === CH.REC_COMMAND).length, 0, 'not broadcast');
  // a second hotkey press while the stop is pending does not re-ask
  await h.invoke(CH.REC_TOGGLE, {});
  assert.equal(owner.sent.filter(([c]) => c === CH.REC_COMMAND).length, 1);
  // the panel flushes its last chunk, then stops
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: chunk('B') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(fs.readFileSync(res.path, 'utf8'), 'AB');
  assert.equal(res.reason, 'hotkey');
  await sleep(250);
  assert.equal(h.broadcasts(CH.REC_STATUS).filter((s) => s.state === 'stopped' && s.recId === recId).length, 1, 'the hard-stop timer was cleared');
});

test('main-initiated stop hard-stops a silent panel after the timeout, and a late recStop still gets the file', async () => {
  const h = harness({ hardStopMs: 80 });
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await h.invoke(CH.REC_TOGGLE, {});
  assert.ok(await waitFor(() => h.broadcasts(CH.REC_STATUS).some((s) => s.state === 'stopped' && s.recId === recId), 2000));
  const stopped = h.broadcasts(CH.REC_STATUS).find((s) => s.state === 'stopped' && s.recId === recId);
  assert.equal(fs.readFileSync(stopped.lastPath, 'utf8'), 'A', 'a valid file from what arrived');
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: chunk('late') });   // after the stop: ignored
  const late = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(late.path, stopped.lastPath);
  assert.equal(fs.readFileSync(stopped.lastPath, 'utf8'), 'A');
});

test('the panel going away mid-recording stops it and keeps what arrived', async () => {
  const h = harness();
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  owner.destroyed = true;
  owner.emit('destroyed');
  assert.ok(await waitFor(() => h.broadcasts(CH.REC_STATUS).some((s) => s.state === 'stopped' && s.recId === recId)));
  assert.equal(owner.listenerCount('destroyed'), 0);
});

const OWNER_EVENTS = ['destroyed', 'render-process-gone', 'did-start-navigation'];
const stoppedFor = (h, recId) => h.broadcasts(CH.REC_STATUS).filter((s) => s.state === 'stopped' && s.recId === recId);

test('a crashed panel renderer (render-process-gone, not destroyed) stops the recording at once and keeps what arrived', async () => {
  const h = harness({ hardStopMs: 5000 });
  const owner = h.fakeOwner();
  const { recId, tmpPath } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  for (const ev of OWNER_EVENTS) assert.equal(owner.listenerCount(ev), 1, `listening for ${ev}`);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  owner.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });   // isDestroyed() stays false
  assert.ok(await waitFor(() => stoppedFor(h, recId).length === 1, 1000), 'stopped without waiting for a hotkey or the limit');
  const stopped = stoppedFor(h, recId)[0];
  assert.equal(fs.readFileSync(stopped.lastPath, 'utf8'), 'A');
  assert.ok(!fs.existsSync(tmpPath), 'the .part was finalized');
  for (const ev of OWNER_EVENTS) assert.equal(owner.listenerCount(ev), 0, `${ev} listener removed`);
  const ticks = () => h.broadcasts(CH.REC_STATUS).filter((s) => s.state === 'recording' && s.recId === recId).length;
  const before = ticks();
  await sleep(1200);   // the status push runs at 1 Hz
  assert.equal(ticks(), before, 'no more "recording" ticks after the crash');
});

test('panel navigation: same-document and sub-frame navigations keep recording; a main-frame reload stops it', async () => {
  const h = harness();
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: 'file:///panel.html#x' });
  owner.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: 'about:blank' });
  await sleep(50);
  assert.equal(stoppedFor(h, recId).length, 0, 'still recording');
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: chunk('B') });
  owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'file:///panel.html' });
  assert.ok(await waitFor(() => stoppedFor(h, recId).length === 1, 1000));
  assert.equal(fs.readFileSync(stoppedFor(h, recId)[0].lastPath, 'utf8'), 'AB');
  for (const ev of OWNER_EVENTS) assert.equal(owner.listenerCount(ev), 0, `${ev} listener removed`);
});

test('a main-initiated stop never asks a crashed renderer: no rec-command, no hard-stop wait', async () => {
  const h = harness({ hardStopMs: 5000 });
  const owner = h.fakeOwner();
  owner.isCrashed = () => false;
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  owner.isCrashed = () => true;   // crashed, and the 'render-process-gone' push never reached us
  const t0 = Date.now();
  await h.invoke(CH.REC_TOGGLE, {});
  assert.ok(await waitFor(() => stoppedFor(h, recId).length === 1, 1000), 'stopped now, not after hardStopMs');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(owner.sent.filter(([c]) => c === CH.REC_COMMAND).length, 0, 'the dead renderer was not asked');
  assert.equal(stoppedFor(h, recId)[0].lastPath !== null, true);
});

// fs.renameSync is patched on the shared node:fs object (screen-capture.js calls it through
// the module object). Only the .webm.part → .webm rename is intercepted.
async function withRenameFault(fault, fn) {
  const real = fs.renameSync;
  const calls = [];
  fs.renameSync = function (from, to) {
    if (String(from).endsWith('.webm.part')) {
      calls.push([from, to]);
      const code = fault(calls.length);
      if (code) { const e = new Error(`${code}: resource busy or locked, rename '${from}'`); e.code = code; throw e; }
    }
    return real.apply(this, arguments);
  };
  try { return await fn(calls); } finally { fs.renameSync = real; }
}

test('stop: a .part rename that is busy for a moment is retried and the recording still saves', async () => {
  const h = harness({ renameRetryMs: [5, 5, 5, 5] });
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await withRenameFault((n) => (n <= 2 ? 'EBUSY' : null), async (calls) => {
    const res = await h.invoke(CH.REC_STOP, { recId });
    assert.equal(calls.length, 3, 'two busy attempts, then the rename went through');
    assert.ok(res.path && res.path.endsWith('.webm'));
    assert.equal(res.error, undefined);
    assert.equal(fs.readFileSync(res.path, 'utf8'), 'A');
    assert.equal(h.broadcasts(CH.CAPTURE_ADDED).filter((c) => c.kind === 'rec').length, 1);
  });
});

test('stop: a .part rename that keeps failing is reported as a failure — no path, no capture-added, the .part is kept', async () => {
  const h = harness({ renameRetryMs: [5, 5] });
  const { recId, tmpPath } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await withRenameFault(() => 'EBUSY', async (calls) => {
    const res = await h.invoke(CH.REC_STOP, { recId });
    assert.equal(calls.length, 3, 'first try + one retry per backoff step');
    assert.equal(res.path, null, 'never claims a .webm that does not exist');
    assert.match(res.error, /^rename failed: EBUSY/);
    assert.equal(res.partPath, tmpPath);
    assert.equal(res.bytes, 1);
    assert.equal(fs.readFileSync(tmpPath, 'utf8'), 'A', 'the bytes are still on disk for recovery');
    assert.ok(!fs.existsSync(tmpPath.replace(/\.part$/, '')));
    assert.equal(h.broadcasts(CH.CAPTURE_ADDED).length, 0, 'Studio is not told about a file that is not there');
    const stopped = stoppedFor(h, recId);
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].lastPath, null);
    assert.equal(stopped[0].error, res.error);
    const late = await h.invoke(CH.REC_STOP, { recId });
    assert.deepEqual(late, res, 'a late recStop gets the same failure, not a path');
  });
});

test('stop: a rename error that is not transient is not retried', async () => {
  const h = harness({ renameRetryMs: [5, 5, 5] });
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  await withRenameFault(() => 'EXDEV', async (calls) => {
    const res = await h.invoke(CH.REC_STOP, { recId });
    assert.equal(calls.length, 1);
    assert.equal(res.path, null);
    assert.match(res.error, /^rename failed: EXDEV/);
  });
});

test('abort deletes the .part and reports aborted', async () => {
  const h = harness();
  const { recId, tmpPath } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  h.emit(CH.REC_ABORT, { recId });
  assert.ok(await waitFor(() => h.broadcasts(CH.REC_STATUS).some((s) => s.state === 'aborted' && s.recId === recId)));
  assert.ok(!fs.existsSync(tmpPath), 'no empty .part left behind (unlink waits for the fd to close)');
  assert.deepEqual(fs.readdirSync(path.join(h.root, 'recordings')).filter((n) => !n.startsWith('.')), []);
});

test('recToggle with nothing recording and no source opens the panel instead of an empty file', async () => {
  const h = harness();
  const r = await h.invoke(CH.REC_TOGGLE, {});
  assert.deepEqual(r, { toggled: 'panel-opened' });
  const panel = h.windows.find((w) => w.opts.title === 'WorkspaceHQ Studio');
  assert.ok(panel);
  panel.close();   // the panel is module state; the next test makes its own
});

test('panel-mode sizes the transparent panel (setup 340×180 ↔ live 230×44) and restores non-resizable', async () => {
  const h = harness();
  await h.invoke(CH.PANEL_TOGGLE);
  const panel = h.windows.filter((w) => w.opts.title === 'WorkspaceHQ Studio' && !w.destroyed).pop();
  assert.ok(panel, 'panel created');
  assert.equal(panel.opts.transparent, true);
  assert.equal(await h.invoke(CH.PANEL_MODE, { mode: 'live' }), true);
  assert.equal(panel.bounds.width, 230);
  assert.equal(panel.bounds.height, 44);
  assert.equal(panel.boundsCalls.at(-1).resizable, true, 'resizable lifted for the call');
  assert.equal(panel.isResizable(), false, 'and restored');
  assert.equal(await h.invoke(CH.PANEL_MODE, { mode: 'setup' }), true);
  assert.deepEqual([panel.bounds.width, panel.bounds.height], [340, 180]);
  assert.equal(await h.invoke(CH.PANEL_MODE, { mode: 'giant' }), false);
  assert.equal(await h.invoke(CH.PANEL_MODE, null), false);
  panel.close();
});
