import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, trends, pickHogs, folderLabel, historySample, UNREADABLE, HOG_TTL_MS } from './pc-health.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const HOME = 'C:\\Users\\tester';
const raw = (o = {}) => ({
  cpuLoad: 10, cpuName: 'Placeholder CPU 8-Core', cpuCores: 16, cpuMHz: 3200,
  memTotalKB: 16 * 1024 * 1024, memFreeKB: 4 * 1024 * 1024,
  gpuName: 'Placeholder dGPU', gpuVramGB: 4, gpuDriverDate: '2026-07-02', gpuDriverDays: 100,
  gpus: [
    { name: 'Placeholder dGPU', vramGB: 8, vramSource: 'registry', driverDate: '2026-07-02', driverDays: 100, width: null, height: null, hz: null },
    { name: 'Placeholder iGPU', vramGB: 0.5, vramSource: 'registry', driverDate: '2025-12-11', driverDays: 320, width: 1920, height: 1080, hz: 144 },
  ],
  gpuLive: { name: 'Placeholder dGPU', tempC: 50, loadPct: 3, memUsedMB: 512, memTotalMB: 8192, powerW: 12.5, powerLimitW: null, clockMHz: 210, pstate: 'P8' },
  topRam: [{ name: 'app-a', count: 20, mb: 3072 }, { name: 'app-b', count: 2, mb: 900 }],
  topCpu: [{ name: 'app-a', pct: 160 }, { name: 'app-b', pct: 16 }],
  diskFreeGB: 40, diskTotalGB: 475, diskCount: 1,
  storage: { name: 'Placeholder NVMe', media: 'SSD', bus: 'NVMe', health: 'Healthy', sizeGB: 477 },
  hogs: [{ path: HOME + '\\Downloads', gb: 10.5 }, { path: HOME + '\\AppData\\Local\\Cache', gb: 22.4 }], hogsPartial: true, recycleGB: 0.02,
  startupCount: 2, startupItems: ['App One', 'App Two'],
  updateDays: 10, rebootPending: false, tempGB: 8.5, pingMs: 14,
  net: { adapter: 'Placeholder Wi-Fi', wireless: true, linkMbps: 287 },
  battery: 39, plugged: true, runtimeMin: null, powerPlan: 'High performance', uptimeHrs: 12,
  ...o,
});
const run = (m, ctx = {}) => build(m, { day: '2026-10-26', hist: [], nowMs: NOW, home: HOME, systemDrive: 'C:', ...ctx });
const organ = (r, id) => r.organs.find((o) => o.id === id);

test('VRAM is the real size of the biggest GPU, not WMI\'s 4 GB cap', () => {
  const r = run(raw());
  assert.equal(organ(r, 'gpu').value, 8);
  assert.match(organ(r, 'gpu').diagnosis, /Placeholder dGPU · 8 GB/);
  assert.match(organ(r, 'gpu').diagnosis, /also Placeholder iGPU \(0\.5 GB\)/);
  assert.equal(r.host.vramGB, 8);
});

test('without the gpus list the old single-GPU fields still work', () => {
  const r = run(raw({ gpus: undefined, gpuLive: null }));
  assert.equal(organ(r, 'gpu').value, 4);
});

test('per-process CPU is shown as a share of the whole CPU', () => {
  const r = run(raw());
  assert.deepEqual(r.detail.topCpu.map((p) => p.pct), [10, 1]); // 160% of one core / 16 threads
  assert.match(organ(r, 'cpu').diagnosis, /busiest: app-a \(10%\)/);
});

test('one-item arrays from ConvertTo-Json are accepted (storage came as an object)', () => {
  const r = run(raw());
  assert.equal(r.detail.storage.length, 1);
  assert.equal(r.detail.storage[0].health, 'Healthy');
});

test('disk hogs are labelled from home, sorted biggest first, and say when partial', () => {
  const r = run(raw());
  assert.deepEqual(r.detail.hogs.items.map((h) => h.label), ['AppData\\Local\\Cache', 'Downloads']);
  assert.equal(r.detail.hogs.partial, true);
  assert.equal(r.detail.hogs.fresh, true);
  assert.match(organ(r, 'disk').diagnosis, /biggest folder: AppData\\Local\\Cache \(22\.4 GB\)/);
});

test('a skipped hog measurement falls back to the cache, marked not fresh', () => {
  const cache = { at: new Date(NOW - 3600e3).toISOString(), partial: false, items: [{ path: HOME + '\\Videos', gb: 50 }] };
  const h = pickHogs({ hogs: null }, cache, NOW, HOME);
  assert.equal(h.fresh, false);
  assert.equal(h.items[0].label, 'Videos');
  assert.equal(pickHogs({ hogs: null }, { ...cache, at: new Date(NOW - HOG_TTL_MS * 5).toISOString() }, NOW, HOME), null);
  assert.equal(pickHogs({ hogs: null }, null, NOW, HOME), null);
});

test('folderLabel keeps paths outside home whole', () => {
  assert.equal(folderLabel('D:\\Games', HOME), 'D:\\Games');
  assert.equal(folderLabel(HOME + '\\.cache', HOME), '.cache');
});

test('battery organ: fine when plugged in, warns low and unplugged', () => {
  assert.equal(organ(run(raw()), 'battery').status, 'grace');
  assert.equal(organ(run(raw({ battery: 15, plugged: false, runtimeMin: 75 })), 'battery').status, 'blood');
  assert.match(organ(run(raw({ battery: 15, plugged: false, runtimeMin: 75 })), 'battery').diagnosis, /about 1 h 15 min left/);
  assert.equal(organ(run(raw({ battery: null })), 'battery'), undefined);
});

test('a pending restart flags the updates organ', () => {
  const r = run(raw({ rebootPending: true }));
  assert.equal(organ(r, 'updates').status, 'ember');
  assert.match(organ(r, 'updates').diagnosis, /restart is pending/);
});

test('every fix keeps the danger field main.js whitelists on', () => {
  const r = run(raw());
  for (const o of r.organs) for (const f of o.fixes) assert.ok(['safe', 'caution', 'admin'].includes(f.danger), o.id + ' ' + f.title);
  assert.equal(organ(r, 'temp').fixes[0].danger, 'caution');
  assert.equal(organ(r, 'network').fixes[1].danger, 'admin');
});

test('detail lists what cannot be read without admin, honestly', () => {
  assert.deepEqual(run(raw()).detail.unreadable, UNREADABLE);
});

test('trends come only from what the history backs, with their window', () => {
  const hist = [
    { at: '2026-10-19T18:00:00', diskFreeGB: 49.6, ram: 70, temp: 7.5, gpuTempC: 45 },
    { at: '2026-10-22T12:00:00', diskFreeGB: 45, ram: 80, temp: 8, gpuTempC: 60 },
    { at: '2026-10-25T12:00:00', diskFreeGB: 42, ram: 75, temp: 8.2, gpuTempC: 50 },
  ];
  const t = trends(hist, { diskFreeGB: 40, tempGB: 8.5 }, NOW);
  const byId = Object.fromEntries(t.map((x) => [x.id, x]));
  assert.match(byId.disk.text, /Disk free fell 9\.6 GB over this week \(49\.6 → 40 GB\)/);
  assert.equal(byId.disk.bad, true);
  assert.match(byId.ram.text, /RAM averaged 75% across the last 3 checks \(peak 80%\)/);
  assert.match(byId.temp.text, /Temp files grew 1 GB/);
  assert.match(byId.gputemp.text, /GPU ran 45–60 °C across 3 checks/);
  assert.deepEqual(trends([], { diskFreeGB: 40, tempGB: 1 }, NOW), []);
});

test('the history sample carries the new trend keys', () => {
  const m = raw();
  const s = historySample(run(m), m);
  assert.equal(s.gpuTempC, 50);
  assert.equal(s.battery, 39);
  assert.equal(s.gpuDriverDays, 100);
  assert.equal(s.diskFreeGB, 40);
});
