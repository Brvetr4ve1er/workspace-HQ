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
import { spawnSync } from 'node:child_process';

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

function harness({ getProjects, launchClaude, hardStopMs = 120, renameRetryMs, openPath, before } = {}) {
  const base = fs.mkdtempSync(path.join(TMP, 'h-'));
  const root = path.join(base, 'library');
  const videos = path.join(base, 'videos');
  process.env.HQ_STUDIO_ROOT = root;
  if (typeof before === 'function') before({ base, root });   // e.g. lay out the tree before init()
  // the shell is recorded, never real: nothing is revealed, trashed or opened on the desktop
  const opened = [], trashed = [];
  const shell = {
    showItemInFolder() {},
    trashItem: async (p) => { trashed.push(p); },
    openPath: async (p) => { opened.push(p); return typeof openPath === 'function' ? openPath(p) : ''; },
  };

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
    focus() { this.focused = (this.focused || 0) + 1; }
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
    clipboard, nativeImage, shell,
    getProjects, launchClaude, hardStopMs, renameRetryMs,
  });

  const h = {
    base, root, videos, windows, mainWin, clipboard, opened, trashed,
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

const studioPanel = (h) => h.windows.filter((w) => w.opts.title === 'WorkspaceHQ Studio' && !w.destroyed).pop() || null;

test('recToggle with no source is show-only: a second press keeps the setup card up and focuses it', async (t) => {
  const h = harness();
  assert.deepEqual(await h.invoke(CH.REC_TOGGLE, {}), { toggled: 'panel-opened' });
  const panel = studioPanel(h);
  assert.ok(panel, 'panel created');
  t.after(() => { if (!panel.destroyed) panel.close(); });   // module state: never leak the panel
  assert.ok(await waitFor(() => panel.visible), 'shown once it is ready');
  assert.deepEqual(await h.invoke(CH.REC_TOGGLE, {}), { toggled: 'panel-opened' });
  assert.equal(panel.visible, true, 'the second press did not hide it (it used to toggle)');
  assert.ok(panel.focused >= 1, 'brought to the front');
  panel.hide();
  await h.invoke(CH.REC_TOGGLE, {});
  assert.equal(panel.visible, true, 'a hidden panel comes back');
  assert.equal(h.windows.filter((w) => w.opts.title === 'WorkspaceHQ Studio').length, 1, 'never a second panel');
});

test('panel-toggle ("Open recorder") during a recording never hides the live pill; with nothing recording it toggles as before', async (t) => {
  const h = harness();
  await h.invoke(CH.PANEL_TOGGLE);
  const panel = studioPanel(h);
  assert.ok(panel, 'panel created');
  t.after(() => { if (!panel.destroyed) panel.close(); });
  assert.ok(await waitFor(() => panel.visible), 'panel up');
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 'screen:1:0', sourceLabel: 'Screen 1' }, panel.webContents);
  assert.ok(recId);
  t.after(() => h.invoke(CH.REC_STOP, { recId }));   // a failed assertion must not leave a recording running
  assert.equal(await h.invoke(CH.PANEL_TOGGLE), true);
  assert.equal(panel.visible, true, 'the live pill stays on screen');
  assert.ok(panel.focused >= 1, 'and is brought to the front');
  panel.hide();   // hidden some other way: a toggle while recording only ever shows it
  await h.invoke(CH.PANEL_TOGGLE);
  assert.equal(panel.visible, true);
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.ok(res && res.path, 'the recording saved');
  await h.invoke(CH.PANEL_TOGGLE);
  assert.equal(panel.visible, false, 'nothing recording: the panel\'s own Hide works again');
  await h.invoke(CH.PANEL_TOGGLE);
  assert.equal(panel.visible, true);
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

// ---------------------------------------------------------------- recording length sidecar (2026-10-07)

const recsOf = (h) => path.join(h.root, 'recordings');
const shotsOf = (h) => path.join(h.root, 'screenshots');
const metaDirOf = (h) => path.join(recsOf(h), '.meta');
const metaOf = (h, file) => path.join(metaDirOf(h), path.basename(file).replace(/\.webm$/i, '') + '.json');

test('a clean stop writes recordings/.meta/<base>.json {durationMs, startedAt, bytes} BEFORE capture-added; library-list rows carry durationMs', async () => {
  const h = harness();
  const t0 = Date.now();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('ABC') });
  await sleep(120);
  // the renderer re-reads library-list on capture-added, so the sidecar must already be on disk then
  const atBroadcast = [];
  const send = h.mainWin.webContents.send;
  h.mainWin.webContents.send = (ch, p) => { if (ch === CH.CAPTURE_ADDED) atBroadcast.push(fs.existsSync(metaOf(h, p.path))); send(ch, p); };
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.deepEqual(atBroadcast, [true], 'sidecar written before capture-added');
  const metaPath = metaOf(h, res.path);
  assert.ok(metaPath.startsWith(h.root + path.sep), 'the sidecar lives inside the library root');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.deepEqual(Object.keys(meta).sort(), ['bytes', 'durationMs', 'startedAt']);
  assert.equal(meta.durationMs, Math.round(res.durationMs));
  assert.ok(meta.durationMs >= 100, `durationMs ${meta.durationMs} counts the recorded time`);
  assert.ok(meta.startedAt >= t0 && meta.startedAt <= Date.now(), 'startedAt is the start, epoch ms');
  assert.equal(meta.bytes, 3, 'tied to the saved file size');
  const rows = await h.invoke(CH.LIB_LIST, { kind: 'rec' });
  assert.equal(rows.length, 1, 'the .meta folder is not a library row');
  assert.equal(rows[0].path, res.path);
  assert.equal(rows[0].durationMs, meta.durationMs);
  assert.ok(!fs.readdirSync(metaDirOf(h)).some((n) => n.endsWith('.part')), 'no temp sidecar left');
});

test('library-list: shots, recovered recordings and recordings without a usable sidecar list durationMs null', async () => {
  const h = harness();
  const rd = recsOf(h), md = metaDirOf(h);
  fs.mkdirSync(md, { recursive: true });
  const put = (name, body, meta) => {
    fs.writeFileSync(path.join(rd, name), body);
    if (meta !== undefined) fs.writeFileSync(path.join(md, name.replace(/\.webm$/, '') + '.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  };
  put('old.webm', 'xx');                                                         // recorded before sidecars
  put('ok.webm', 'xxxx', { durationMs: 4200, startedAt: 1, bytes: 4 });
  put('nobytes.webm', 'x', { durationMs: 1500, startedAt: 1 });                  // no bytes field: taken as is
  put('changed.webm', 'xxxxx', { durationMs: 4200, startedAt: 1, bytes: 4 });    // the file changed since
  put('corrupt.webm', 'x', '{nope');
  put('string.webm', 'x', { durationMs: '3000', bytes: 1 });
  put('negative.webm', 'x', { durationMs: -1, bytes: 1 });
  put('absurd.webm', 'x', { durationMs: 1e12, bytes: 1 });
  put('array.webm', 'x', '[3000]');
  put('big.webm', 'x', JSON.stringify({ durationMs: 3000, bytes: 1, pad: 'p'.repeat(5000) }));
  put('a.recovered.webm', 'x', { durationMs: 999, bytes: 1 });                  // recovered: never trusted
  fs.writeFileSync(path.join(shotsOf(h), 's.png'), 'png');
  const rows = await h.invoke(CH.LIB_LIST, { kind: 'all' });
  assert.ok(rows.every((r) => 'durationMs' in r), 'every row carries the field');
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.durationMs])), {
    'old.webm': null, 'ok.webm': 4200, 'nobytes.webm': 1500, 'changed.webm': null, 'corrupt.webm': null,
    'string.webm': null, 'negative.webm': null, 'absurd.webm': null, 'array.webm': null, 'big.webm': null,
    'a.recovered.webm': null, 's.png': null,
  });
});

test('a save with missing chunks gets no sidecar: the recorded time is not that file’s length', async () => {
  const h = harness();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  h.emit(CH.REC_CHUNK, { recId, seq: 2, buf: chunk('C') });   // 1 never arrives
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(res.gaps, 1);
  assert.ok(!fs.existsSync(metaOf(h, res.path)));
  const [row] = await h.invoke(CH.LIB_LIST, { kind: 'rec' });
  assert.equal(row.durationMs, null);
});

test('a failed save (rename keeps failing) writes no sidecar', async () => {
  const h = harness({ renameRetryMs: [5] });
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await withRenameFault(() => 'EBUSY', async () => {
    const res = await h.invoke(CH.REC_STOP, { recId });
    assert.equal(res.path, null);
  });
  const left = fs.existsSync(metaDirOf(h)) ? fs.readdirSync(metaDirOf(h)) : [];
  assert.deepEqual(left, []);
});

// Review 2026-10-07: the recorded time is the file's length only when the panel itself stopped
// (flushing its last chunk first) and the disk never made it pause. Otherwise: no sidecar.
test('durations: a hard stop (silent panel) writes no sidecar — main counted time the file never got', async () => {
  const h = harness({ hardStopMs: 80 });
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await h.invoke(CH.REC_TOGGLE, {});
  assert.ok(await waitFor(() => h.broadcasts(CH.REC_STATUS).some((s) => s.state === 'stopped' && s.recId === recId), 2000));
  const late = await h.invoke(CH.REC_STOP, { recId });   // the panel's recStop after the hard stop: same result, still no sidecar
  assert.equal(late.gaps, 0, 'no hole in what arrived — gaps alone would have passed it');
  assert.ok(!fs.existsSync(metaOf(h, late.path)));
  const [row] = await h.invoke(CH.LIB_LIST, { kind: 'rec' });
  assert.equal(row.durationMs, null);
});

test('durations: the panel vanishing mid-recording writes no sidecar (its last chunk never came)', async () => {
  const h = harness();
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  owner.destroyed = true;
  owner.emit('destroyed');
  assert.ok(await waitFor(() => h.broadcasts(CH.CAPTURE_ADDED).length === 1, 2000));
  const p = h.broadcasts(CH.CAPTURE_ADDED)[0].path;
  assert.ok(!fs.existsSync(metaOf(h, p)));
});

test('durations: a recording that hit backpressure writes no sidecar (the panel paused, main’s clock did not)', async () => {
  const h = harness();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: Buffer.alloc(256 * 1024, 1) });   // over the stream's highWaterMark
  assert.ok(h.broadcasts(CH.REC_STATUS).some((s) => s.state === 'backpressure' && s.recId === recId), 'backpressure was signalled');
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(res.gaps, 0);
  assert.ok(res.path && !fs.existsSync(metaOf(h, res.path)));
});

test('durations: a main-initiated stop the panel completes itself (hotkey → flush → recStop) still gets its sidecar', async () => {
  const h = harness({ hardStopMs: 5000 });
  const owner = h.fakeOwner();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, owner);
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  await h.invoke(CH.REC_TOGGLE, {});
  h.emit(CH.REC_CHUNK, { recId, seq: 1, buf: chunk('B') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.equal(res.reason, 'hotkey');
  const meta = JSON.parse(fs.readFileSync(metaOf(h, res.path), 'utf8'));
  assert.equal(meta.durationMs, Math.round(res.durationMs));
});

test('sidecars stay inside the library: a .meta junction to elsewhere gets no write and no trash', { skip: process.platform !== 'win32' }, async (t) => {
  let linked = false, why = '';
  let elsewhere;
  const h = harness({
    before: ({ base, root }) => {
      elsewhere = path.join(base, 'elsewhere-meta');
      fs.mkdirSync(elsewhere, { recursive: true });
      fs.mkdirSync(path.join(root, 'recordings'), { recursive: true });
      try { fs.symlinkSync(elsewhere, path.join(root, 'recordings', '.meta'), 'junction'); linked = true; } catch (e) { why = e.code || e.message; }
    },
  });
  if (!linked) { t.skip('junctions unavailable here: ' + why); return; }
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.ok(res.path && fs.existsSync(res.path), 'the recording itself is saved');
  assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was written through the junction');
  // a sidecar that is already out there (planted) is never trashed through the junction either
  fs.writeFileSync(path.join(elsewhere, path.basename(res.path).replace(/\.webm$/i, '') + '.json'), JSON.stringify({ durationMs: 1, bytes: 1 }));
  assert.equal(await h.invoke(CH.LIB_DELETE, res.path), true);
  assert.deepEqual(h.trashed, [res.path], 'only the recording went to the Recycle Bin');
});

test('deleting a recording also trashes its length sidecar (so a stale one never describes another file)', async () => {
  const h = harness();
  const { recId } = await h.invoke(CH.REC_START, { sourceId: 's' }, h.fakeOwner());
  h.emit(CH.REC_CHUNK, { recId, seq: 0, buf: chunk('A') });
  const res = await h.invoke(CH.REC_STOP, { recId });
  assert.ok(fs.existsSync(metaOf(h, res.path)));
  assert.equal(await h.invoke(CH.LIB_DELETE, res.path), true);
  assert.deepEqual(h.trashed, [res.path, metaOf(h, res.path)]);
});

// ---------------------------------------------------------------- library-open (2026-10-07)

test('library-open: the channel name', () => {
  assert.equal(CH.LIB_OPEN, 'hq:studio:library-open');
});

// What shell.openPath receives is the capture's REAL path (8.3 aliases such as ROGSTR~1 in
// %TEMP% expanded, links followed) — the exact name every rule was checked on (review 2026-10-07).
const real = (p) => fs.realpathSync.native(p);

test('library-open: a screenshot, a recording and a recovered recording reach shell.openPath (stubbed) as real paths', async () => {
  const h = harness();
  const shot = path.join(shotsOf(h), 'a.png'), rec = path.join(recsOf(h), 'b.webm'), recovered = path.join(recsOf(h), 'c.recovered.webm');
  for (const f of [shot, rec, recovered]) fs.writeFileSync(f, 'x');
  for (const f of [shot, rec, recovered]) assert.equal(await h.invoke(CH.LIB_OPEN, f), true, f);
  assert.deepEqual(h.opened, [real(shot), real(rec), real(recovered)]);
  // redundant segments that stay inside resolve to the same capture
  const S = path.sep;
  assert.equal(await h.invoke(CH.LIB_OPEN, recsOf(h) + S + 'sub' + S + '..' + S + '.' + S + 'b.webm'), true);
  assert.equal(h.opened.at(-1), real(rec));
  // forward / mixed separators are the same file, not a different rule
  assert.equal(await h.invoke(CH.LIB_OPEN, shot.replace(/\\/g, '/')), true);
  assert.equal(await h.invoke(CH.LIB_OPEN, rec.replace(/\\recordings\\/, '/recordings/')), true);
  assert.deepEqual(h.opened.slice(-2), [real(shot), real(rec)]);
});

test('library-open: other spellings of a capture only ever over-refuse — case, URL-encoding, file: URLs', async () => {
  const h = harness();
  const shot = path.join(shotsOf(h), 'a.png');
  fs.writeFileSync(shot, 'x');
  const cases = [
    [path.join(h.root, 'Screenshots', 'A.PNG'), 'another case of the kind folder'],
    [shot.replace('a.png', 'a%2Epng'), 'a URL-encoded dot'],
    [shot.replace(/\\screenshots\\/, '\\screenshots%5C'), 'a URL-encoded separator'],
    ['file:///' + shot.replace(/\\/g, '/'), 'a file: URL'],
    [encodeURI('file:///' + shot.replace(/\\/g, '/')), 'an encoded file: URL'],
  ];
  for (const [p, why] of cases) assert.equal(await h.invoke(CH.LIB_OPEN, p), false, why);
  assert.deepEqual(h.opened, [], 'shell.openPath never ran');
});

// Windows answers an 8.3 alias as if it were the file, so the lexical name rules were checked on a
// name that is not the file's: SECRET~1.PNG is really .secret.png (a dot-file), PAYLOA~1.PNG is
// really payload.pngexe (not a .png). Review 2026-10-07 — both opened before the real-name check.
function shortNames(dir) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:HQ_SN_DIR).Files | ForEach-Object { $_.Name + [char]9 + $_.ShortName }'],
  { encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, HQ_SN_DIR: dir } });
  return new Map(String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')));
}
test('library-open: an 8.3 alias never smuggles a dot-file or a non-capture extension past the rules', { skip: process.platform !== 'win32' }, async (t) => {
  const h = harness();
  const shots = shotsOf(h), recs = recsOf(h);
  for (const n of ['.secret.png', 'payload.pngexe', 'ok-long-capture-name.png']) fs.writeFileSync(path.join(shots, n), 'x');
  fs.writeFileSync(path.join(recs, 'payload.webmexe'), 'x');
  const sn = shortNames(shots);
  const alias = (n) => sn.get(n);
  if (!['.secret.png', 'payload.pngexe', 'ok-long-capture-name.png'].every((n) => /~/.test(alias(n) || ''))) { t.skip('8.3 names are off on this volume'); return; }
  assert.match(alias('.secret.png'), /\.PNG$/i, 'the alias of a dot-file looks like a plain .png');
  assert.match(alias('payload.pngexe'), /\.PNG$/i, 'the alias of payload.pngexe ends in .PNG');
  assert.equal(await h.invoke(CH.LIB_OPEN, path.join(shots, alias('.secret.png'))), false, 'a dot-file behind its 8.3 alias');
  assert.equal(await h.invoke(CH.LIB_OPEN, path.join(shots, alias('payload.pngexe'))), false, 'payload.pngexe behind PAYLOA~1.PNG');
  assert.deepEqual(h.opened, [], 'shell.openPath never ran');
  // control: a real capture reached through its alias opens — as its real (long) name
  assert.equal(await h.invoke(CH.LIB_OPEN, path.join(shots, alias('ok-long-capture-name.png'))), true);
  assert.deepEqual(h.opened, [real(path.join(shots, 'ok-long-capture-name.png'))]);
  assert.equal(path.basename(h.opened[0]), 'ok-long-capture-name.png');
});

test('library-open: the OS failing to open is {error} with its message, never true', async () => {
  const msg = 'No application is associated with the specified file for this operation.';
  const h = harness({ openPath: () => msg });
  const shot = path.join(shotsOf(h), 'a.png');
  fs.writeFileSync(shot, 'x');
  assert.deepEqual(await h.invoke(CH.LIB_OPEN, shot), { error: msg });
  const h2 = harness({ openPath: () => { throw new Error('boom'); } });
  const shot2 = path.join(shotsOf(h2), 'a.png');
  fs.writeFileSync(shot2, 'x');
  assert.deepEqual(await h2.invoke(CH.LIB_OPEN, shot2), { error: 'boom' });
});

test('library-open refuses everything that is not a capture file in the library (shell.openPath never runs)', async () => {
  const h = harness();
  const R = h.root, S = path.sep, recs = recsOf(h), shots = shotsOf(h);
  // real files at every refused location, so no refusal is just "file not found"
  const outside = path.join(h.base, 'outside.webm');
  const sibling = path.join(R + '-evil', 'recordings', 'a.webm');
  fs.mkdirSync(path.dirname(sibling), { recursive: true });
  fs.mkdirSync(path.join(recs, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(recs, '.meta'), { recursive: true });
  for (const f of [outside, sibling, path.join(recs, 'a.webm'), path.join(recs, 'evil.exe'), path.join(recs, 'evil.lnk'), path.join(recs, 'evil.bat'),
    path.join(recs, 'evil.url'), path.join(shots, 'a.webm'), path.join(recs, 'a.png'), path.join(R, 'a.webm'), path.join(recs, 'sub', 'a.webm'),
    path.join(recs, '.thumbs', 'a.thumb.jpg'), path.join(recs, '.meta', 'a.json'), path.join(recs, '.hidden.webm')]) fs.writeFileSync(f, 'x');
  const inRoot = path.join(recs, 'a.webm');
  const cases = [
    [R + S + 'recordings' + S + '..' + S + '..' + S + 'outside.webm', '.. climbing out of the root'],
    [outside, 'an absolute path outside the root'],
    [sibling, 'a sibling folder sharing the root as a prefix'],
    ['\\\\host\\share\\recordings\\a.webm', 'a UNC path'],
    ['//host/share/recordings/a.webm', 'a UNC path with forward slashes'],
    ['\\\\?\\' + inRoot, 'a \\\\?\\ namespace path to an in-root capture'],
    ['\\\\.\\' + inRoot, 'a \\\\.\\ device path'],
    ['recordings' + S + 'a.webm', 'a relative path'],
    [path.join(recs, 'evil.exe'), 'an executable dropped into the library'],
    [path.join(recs, 'evil.lnk'), 'a shortcut (.lnk)'],
    [path.join(recs, 'evil.url'), 'an internet shortcut (.url)'],
    [path.join(recs, 'evil.bat'), 'a batch file'],
    [inRoot + ':evil.exe', 'an NTFS alternate data stream'],
    [path.join(shots, 'a.png') + ':x.png', 'a stream that ends in a library extension'],
    [inRoot + '.', 'a trailing dot (Windows would strip it)'],
    [inRoot + ' ', 'a trailing space'],
    [path.join(shots, 'a.webm'), 'a .webm in screenshots/'],
    [path.join(recs, 'a.png'), 'a .png in recordings/'],
    [path.join(R, 'a.webm'), 'a file directly in the root'],
    [path.join(recs, 'sub', 'a.webm'), 'a file nested below recordings/'],
    [path.join(recs, '.thumbs', 'a.thumb.jpg'), 'a thumbnail sidecar'],
    [path.join(recs, '.meta', 'a.json'), 'a length sidecar'],
    [path.join(recs, '.hidden.webm'), 'a dot-file'],
    [path.join(recs, 'missing.webm'), 'a capture that is gone'],
    [recs, 'a directory'],
    [R, 'the root itself'],
    [inRoot + '\0.exe', 'an embedded NUL'],
    ['x'.repeat(5000), 'an absurdly long string'],
    ['', 'empty'], [null, 'null'], [undefined, 'undefined'], [42, 'a number'], [{ path: inRoot }, 'an object'], [[inRoot], 'an array'],
  ];
  for (const [p, why] of cases) assert.equal(await h.invoke(CH.LIB_OPEN, p), false, why);
  assert.deepEqual(h.opened, [], 'shell.openPath never ran');
  assert.equal(await h.invoke(CH.LIB_OPEN, inRoot), true, 'control: the real capture opens');
  assert.deepEqual(h.opened, [real(inRoot)]);
});

test('library-open follows links: a junction inside the library that points outside is refused', async (t) => {
  let linked = false, why = '';
  const h = harness({
    before: ({ base, root }) => {
      const elsewhere = path.join(base, 'elsewhere');
      fs.mkdirSync(elsewhere, { recursive: true });
      fs.writeFileSync(path.join(elsewhere, 'a.webm'), 'x');
      fs.mkdirSync(root, { recursive: true });
      try { fs.symlinkSync(elsewhere, path.join(root, 'recordings'), 'junction'); linked = true; } catch (e) { why = e.code || e.message; }
    },
  });
  if (!linked) { t.skip('junctions unavailable here: ' + why); return; }
  const p = path.join(recsOf(h), 'a.webm');
  assert.ok(fs.existsSync(p), 'the junction shows the outside file inside the library');
  assert.equal(await h.invoke(CH.LIB_OPEN, p), false);
  assert.deepEqual(h.opened, []);
});

test('library-open refuses a symlinked file even when it sits in recordings/', async (t) => {
  const h = harness();
  const target = path.join(h.base, 'target.webm');
  fs.writeFileSync(target, 'x');
  const link = path.join(recsOf(h), 'link.webm');
  try { fs.symlinkSync(target, link, 'file'); } catch (e) { t.skip('file symlinks need privileges here: ' + (e.code || e.message)); return; }
  assert.equal(await h.invoke(CH.LIB_OPEN, link), false);
  assert.deepEqual(h.opened, []);
});
