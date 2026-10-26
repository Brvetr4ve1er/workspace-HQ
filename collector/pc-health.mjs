// PC-HEALTH runner — runs pc-health.ps1, shapes the result with lib/pc-health.mjs (organs,
// detail, trends) and writes data/pc-health.json. Additive sidecar: it never touches
// latest.json or the golden-tested collector output.
//   run:  node collector/pc-health.mjs
// The disk breakdown (sizing every folder, ~30 s) is cached in data/pc-health-disk.json and
// re-measured at most every HOG_TTL_MS, so Re-examine stays quick.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, historySample, HIST_MAX, HOG_TTL_MS } from './lib/pc-health.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'pc-health.json');
const HIST = path.join(DATA, 'pc-health-history.json');
const HOGS = path.join(DATA, 'pc-health-disk.json');

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeAtomic = (f, data) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };

function gather(skipHogs) {
  const ps = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pc-health.ps1')],
    { encoding: 'utf8', windowsHide: true, timeout: skipHogs ? 60000 : 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...(skipHogs ? { HQ_PC_SKIP_HOGS: '1' } : {}) } });
  if (ps.status !== 0 || !ps.stdout) throw new Error('pc-health.ps1 failed: ' + (ps.stderr || 'no output').slice(0, 300));
  return JSON.parse(ps.stdout.trim());
}

function main() {
  const nowMs = Date.now();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const hogCache = readJson(HOGS, null);
  const hogsFresh = hogCache && Date.parse(hogCache.at) > nowMs - HOG_TTL_MS;
  const m = gather(!!hogsFresh);
  const hist = readJson(HIST, []);
  const report = build(m, { day, hist: Array.isArray(hist) ? hist : [], hogCache, nowMs, home: os.homedir(), systemDrive: process.env.SystemDrive || 'C:' });

  fs.mkdirSync(DATA, { recursive: true });
  if (report.detail.hogs && report.detail.hogs.fresh) writeAtomic(HOGS, JSON.stringify({ at: report.detail.hogs.at, partial: report.detail.hogs.partial, items: report.detail.hogs.items }));
  const trimmed = [...(Array.isArray(hist) ? hist : []), historySample(report, m)].slice(-HIST_MAX);
  writeAtomic(HIST, JSON.stringify(trimmed));
  writeAtomic(OUT, JSON.stringify(report, null, 2));
  const sick = report.organs.filter((o) => o.status === 'blood').length;
  const warn = report.organs.filter((o) => o.status === 'ember').length;
  console.log(`[pc-health] ${report.organs.length} organs · ${sick} blood · ${warn} ember · disk breakdown ${report.detail.hogs ? (report.detail.hogs.fresh ? 'measured' : 'cached') : 'none'} → ${path.relative(path.join(__dirname, '..'), OUT)}`);
}

main();
