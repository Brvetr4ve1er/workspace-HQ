// Reach (dashboard/reach.js): whether each door is open. Temp HOME and injected probes; no real registry, process list or ~/.claude.json.
// Placeholder data — the repo is public.
//   node --test dashboard/reach.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { record } from './assist-audit.mjs';

const require = createRequire(import.meta.url);
const reach = require('./reach.js');

const NOW = Date.parse('2026-11-07T12:00:00Z');
const EXE = 'C:\\work\\alpha-site\\node_modules\\electron\\dist\\electron.exe';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-reach-'));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
function env() {
  const root = tmp(), home = path.join(root, 'home'), dataDir = path.join(root, 'data');
  fs.mkdirSync(home); fs.mkdirSync(dataDir);
  return { root, home, dataDir };
}
const mk = (e, o = {}) => reach.create({
  dataDir: e.dataDir, home: e.home, exePath: EXE, now: () => NOW,
  probes: { processes: async () => [], tray: async () => null, bootTime: () => Date.parse('2026-11-07T07:12:00'), ...(o.probes || {}) },
  ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'probes')),
});
const row = (r, id) => r.rows.find((x) => x.id === id);

test('read() returns the five rows in order with the documented shape', async () => {
  const e = env();
  try {
    const r = await mk(e).read();
    assert.equal(r.at, new Date(NOW).toISOString());
    assert.deepEqual(r.rows.map((x) => x.id), ['phone-door', 'user-scope', 'bridge', 'tray-icon', 'calls']);
    for (const x of r.rows) {
      assert.ok(x.ok === true || x.ok === false || x.ok === null, x.id);
      assert.equal(typeof x.detail, 'string');
      assert.ok(['owner', 'app'].includes(x.who));
      assert.ok(Object.keys(x).every((k) => ['id', 'ok', 'detail', 'step', 'who', 'copy'].includes(k)), JSON.stringify(Object.keys(x)));
      if (x.ok === false) assert.ok(x.step, x.id + ' ends in its one missing step');
    }
  } finally { rm(e.root); }
});

test('phone door: a remote-control process is open; none is closed with the boot time and the command to copy', async () => {
  const e = env();
  try {
    const open = row(await mk(e, { probes: { processes: async () => [
      { pid: 4100, started: '2026-11-07T08:30:00', cmd: 'C:\\tools\\node.exe other.js' },
      { pid: 4242, started: '2026-11-07T09:05:00', cmd: '"C:\\tools\\claude.exe" remote-control --name alpha' },
    ] } }).read(), 'phone-door');
    assert.equal(open.ok, true);
    assert.match(open.detail, /running \(pid 4242\) since \d\d:\d\d/);
    assert.ok(!open.detail.includes('--name'), 'the command line is never echoed');
    const closed = row(await mk(e).read(), 'phone-door');
    assert.equal(closed.ok, false);
    assert.match(closed.detail, /^not running since boot at 07:12$/);
    assert.equal(closed.copy, 'claude remote-control');
    assert.equal(closed.who, 'owner');
    // a remote-control word with no claude in the line is not a hit
    const other = row(await mk(e, { probes: { processes: async () => [{ pid: 9, cmd: 'node some-remote-control-thing.js' }] } }).read(), 'phone-door');
    assert.equal(other.ok, false);
  } finally { rm(e.root); }
});

test('phone door: a state file saying running for a dead pid reads as not running; a live pid is a hint only when the list is unreadable', async () => {
  const e = env();
  try {
    const stateFile = path.join(e.root, 'gateway_state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'running', pid: 31337 }));
    const dead = { processes: async () => { throw new Error('no powershell'); }, isAlive: (pid) => pid === 5555 };
    const a = row(await mk(e, { stateFile, probes: dead }).read(), 'phone-door');
    assert.equal(a.ok, false);
    assert.match(a.detail, /state file still says running for pid 31337, which is gone/);
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'running', pid: 5555 }));
    assert.equal(row(await mk(e, { stateFile, probes: dead }).read(), 'phone-door').ok, true);
    // the process list worked and found nothing: the file's word does not matter
    assert.equal(row(await mk(e, { stateFile, probes: { processes: async () => [], isAlive: () => true } }).read(), 'phone-door').ok, false);
    // nothing to go on: unknown, not a guess
    const unk = row(await mk(e, { probes: dead }).read(), 'phone-door');
    assert.equal(unk.ok, null);
  } finally { rm(e.root); }
});

test('phone door: a probe that hangs is cut off and reads as unknown', async () => {
  const e = env();
  try {
    const r = await mk(e, { probeTimeoutMs: 30, probes: { processes: () => new Promise(() => {}) } }).read();
    assert.equal(row(r, 'phone-door').ok, null);
  } finally { rm(e.root); }
});

test('user scope: key presence only; ~/.claude.json values never appear in any output', async () => {
  const e = env();
  try {
    const cfgFile = path.join(e.home, '.claude.json');
    const secret = 'test-token-0000';
    fs.writeFileSync(cfgFile, JSON.stringify({ oauthAccount: { email: 'owner@example.invalid' }, mcpServers: { other: { command: 'x', env: { API_KEY: secret } } }, projects: { 'C:/work/alpha-site': { history: ['a private prompt'] } } }));
    const off = await mk(e).read();
    const rOff = row(off, 'user-scope');
    assert.equal(rOff.ok, false);
    assert.match(rOff.copy, /^claude mcp add --scope user workspacehq -- node ".*server\.mjs"$/);
    assert.match(rOff.step, /after|once the structure lane has isolated the nightly runs/i);
    fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { workspacehq: { command: 'node', env: { API_KEY: secret } }, other: {} } }));
    const on = await mk(e).read();
    assert.equal(row(on, 'user-scope').ok, true);
    for (const out of [off, on]) {
      const text = JSON.stringify(out);
      for (const s of [secret, 'owner@example.invalid', 'a private prompt', 'API_KEY']) assert.ok(!text.includes(s), s);
    }
    // missing file → off with the command; broken file → unknown
    fs.unlinkSync(cfgFile);
    assert.equal(row(await mk(e).read(), 'user-scope').ok, false);
    fs.writeFileSync(cfgFile, '{ not json');
    assert.equal(row(await mk(e).read(), 'user-scope').ok, null);
    fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: ['workspacehq'] }));
    assert.equal(row(await mk(e).read(), 'user-scope').ok, false, 'an array is not a server table');
  } finally { rm(e.root); }
});

test('bridge: paired only when the pairing file is one the bridge accepts AND the token file is there; contents never reach the output', async () => {
  const e = env();
  try {
    const pair = path.join(e.dataDir, '.bridge-pairing.json'), tok = path.join(e.dataDir, '.bridge-token');
    const good = JSON.stringify({ v: 1, origin: 'chrome-extension://abcdefghijklmnop', pairedAt: '2026-11-07T10:00:00Z' });
    assert.equal(row(await mk(e).read(), 'bridge').ok, false, 'nothing yet');
    fs.writeFileSync(pair, good);
    const noTok = row(await mk(e).read(), 'bridge');
    assert.equal(noTok.ok, false, 'a pairing file without the token fails closed in the bridge');
    assert.match(noTok.detail, /token is missing/);
    fs.writeFileSync(tok, '');
    assert.equal(row(await mk(e).read(), 'bridge').ok, false, 'an empty token');
    fs.writeFileSync(tok, 'test-token-0000');
    const r = await mk(e).read();
    assert.equal(row(r, 'bridge').ok, true);
    assert.ok(!JSON.stringify(r).includes('test-token-0000'));
    for (const bad of ['{not json', JSON.stringify({ v: 2, origin: 'chrome-extension://abc' }), JSON.stringify({ v: 1, origin: 'https://example.com' }), JSON.stringify({ token: 'test-token-0000' }), '[]']) {
      fs.writeFileSync(pair, bad);
      const x = row(await mk(e).read(), 'bridge');
      assert.equal(x.ok, false, bad);
      assert.match(x.detail, /not paired/);
      assert.ok(x.step, 'and it says the one missing step');
    }
  } finally { rm(e.root); }
});

test('phone door: a boot or start time from another day carries its day, so it cannot read as today', async () => {
  const e = env();
  try {
    const old = row(await mk(e, { probes: { bootTime: () => NOW - 57 * 3600e3 } }).read(), 'phone-door');
    assert.match(old.detail, /^not running since boot at (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [0-9][0-9]:[0-9][0-9]$/);
    const far = row(await mk(e, { probes: { bootTime: () => NOW - 20 * 24 * 3600e3 } }).read(), 'phone-door');
    assert.match(far.detail, /^not running since boot at [0-9]{1,2} [A-Z][a-z]{2} [0-9][0-9]:[0-9][0-9]$/);
    const started = row(await mk(e, { probes: { processes: async () => [{ pid: 4242, started: new Date(NOW - 3 * 24 * 3600e3).toISOString(), cmd: 'claude.exe remote-control' }] } }).read(), 'phone-door');
    assert.match(started.detail, /since (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [0-9][0-9]:[0-9][0-9]$/);
  } finally { rm(e.root); }
});

test('tray icon: the registry probe decides; unknown is unknown; the exe path reaches the probe', async () => {
  const e = env();
  try {
    let seen = null;
    const probe = (v) => ({ tray: async (exe) => { seen = exe; return v; } });
    assert.equal(row(await mk(e, { probes: probe(true) }).read(), 'tray-icon').ok, true);
    assert.equal(seen, EXE);
    const hidden = row(await mk(e, { probes: probe(false) }).read(), 'tray-icon');
    assert.equal(hidden.ok, false);
    assert.match(hidden.step, /Other system tray icons/);
    assert.equal(row(await mk(e, { probes: probe(null) }).read(), 'tray-icon').ok, null);
    assert.equal(row(await mk(e, { probes: { tray: async () => { throw new Error('reg failed'); } } }).read(), 'tray-icon').ok, null);
    assert.equal(row(await mk(e, { exePath: null }).read(), 'tray-icon').ok, null);
  } finally { rm(e.root); }
});

test('parseNotifyIcons: this exe\'s IsPromoted from reg query text; other apps do not count', () => {
  const text = [
    '', 'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\111',
    '    ExecutablePath    REG_SZ    C:\\other\\app.exe', '    IsPromoted    REG_DWORD    0x1', '',
    'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\222',
    '    UID    REG_QWORD    0x1', '    ExecutablePath    REG_SZ    C:\\Work\\Alpha-Site\\node_modules\\electron\\dist\\electron.exe', '    IsPromoted    REG_DWORD    0x0', '',
    'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\333',
    '    ExecutablePath    REG_SZ    C:\\work\\beta\\tool.exe', '',
  ].join('\r\n');
  assert.equal(reach.parseNotifyIcons(text, EXE), false);
  assert.equal(reach.parseNotifyIcons(text.replace('IsPromoted    REG_DWORD    0x0', 'IsPromoted    REG_DWORD    0x1'), EXE), true);
  assert.equal(reach.parseNotifyIcons(text, 'C:\\work\\beta\\tool.exe'), false, 'an entry with no IsPromoted value is not promoted');
  assert.equal(reach.parseNotifyIcons(text, 'C:\\nowhere\\x.exe'), null);
  assert.equal(reach.parseNotifyIcons('', EXE), null);
  assert.equal(reach.parseNotifyIcons(text, ''), null);
});

test('calls: this week by door from data/assistant-audit.jsonl, torn lines counted, nothing else read', async () => {
  const e = env();
  try {
    assert.equal(row(await mk(e).read(), 'calls').ok, false, 'no log yet');
    const day = 24 * 3600e3;
    const rec = (door, ago) => record(e.dataDir, { at: NOW - ago, door, tool: 'hq_capture', tier: 'note', ok: true, ms: 1, pid: 9 });
    rec('mcp', 1 * day); rec('mcp', 2 * day); rec('browser', 3 * day); rec('mcp', 9 * day);   // the 9-day-old one is outside the week
    fs.appendFileSync(path.join(e.dataDir, 'assistant-audit.jsonl'), '{"v":1,"at":"2026-1\n');
    const c = row(await mk(e).read(), 'calls');
    assert.equal(c.ok, true);
    assert.equal(c.detail, 'mcp 2 · browser 1 this week · 1 unreadable line(s) skipped');
    assert.equal(c.step, undefined);
  } finally { rm(e.root); }
});

test('it never throws: a missing data folder, a throwing probe and junk options all give rows', async () => {
  const e = env();
  try {
    const r = await reach.create({ dataDir: path.join(e.root, 'nope'), home: path.join(e.root, 'nohome'), now: () => NOW,
      probes: { processes: () => { throw new Error('x'); }, tray: () => { throw new Error('y'); } } }).read();
    assert.equal(r.rows.length, 5);
    const bare = await reach.create({ probes: { processes: async () => null, tray: async () => null } }).read();
    assert.equal(bare.rows.length, 5);
    const handlers = {};
    reach.init({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dataDir: e.dataDir, home: e.home, exePath: EXE, probes: { processes: async () => [], tray: async () => true } });
    const viaIpc = await handlers['hq:reach:read']();
    assert.equal(viaIpc.rows.length, 5);
  } finally { rm(e.root); }
});
