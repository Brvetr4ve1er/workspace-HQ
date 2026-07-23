// PC-HEALTH shaper — runs pc-health.ps1, turns raw Windows metrics into the
// Med-Bay anatomy contract (organs with status / diagnosis / funny teaching /
// curated fix scripts) and writes data/pc-health.json. Additive sidecar: it
// never touches latest.json or the golden-tested collector output.
//   run:  node collector/pc-health.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'pc-health.json');
const HIST = path.join(DATA, 'pc-health-history.json');
const HIST_MAX = 24;                 // rolling samples that feed the sparklines

// ---- gather -------------------------------------------------------------
function gather() {
  const ps = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pc-health.ps1')],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (ps.status !== 0 || !ps.stdout) throw new Error('pc-health.ps1 failed: ' + (ps.stderr || 'no output').slice(0, 300));
  return JSON.parse(ps.stdout.trim());
}

// status tiers by ascending badness: grace (fine) → ember (watch it) → blood (act)
const tier = (v, ember, blood, invert = false) => {
  if (v == null || Number.isNaN(v)) return 'grace';
  if (invert) return v >= ember ? 'grace' : v >= blood ? 'ember' : 'blood';
  return v <= ember ? 'grace' : v <= blood ? 'ember' : 'blood';
};

// deterministic teaching pick (no RNG — day-hash so a given day reads stable)
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const pick = (arr, seed) => arr[fnv(seed) % arr.length];

// ---- history (sparklines) ----------------------------------------------
function loadHistory() { try { const h = JSON.parse(fs.readFileSync(HIST, 'utf8')); return Array.isArray(h) ? h : []; } catch { return []; } }
function sparkOf(hist, key, current) {
  const series = hist.map((h) => h[key]).filter((v) => typeof v === 'number');
  series.push(current);
  return series.slice(-HIST_MAX);
}

// ---- build --------------------------------------------------------------
function build(m, day) {
  const usedRamPct = m.memTotalKB ? Math.round((1 - m.memFreeKB / m.memTotalKB) * 100) : 0;
  const freeRamGB = +(m.memFreeKB / 1024 / 1024).toFixed(1);
  const totalRamGB = Math.round(m.memTotalKB / 1024 / 1024);
  const diskFreePct = m.diskTotalGB ? Math.round((m.diskFreeGB / m.diskTotalGB) * 100) : 0;

  const hist = loadHistory();
  const S = (key, cur) => sparkOf(hist, key, cur);

  const organs = [
    {
      id: 'cpu', label: 'Processor', value: m.cpuLoad, unit: '% load',
      status: tier(m.cpuLoad, 55, 85), spark: S('cpu', m.cpuLoad),
      diagnosis: `${m.cpuName} · ${m.cpuCores} threads · ${m.cpuLoad}% right now.`,
      teaching: pick([
        `${m.cpuLoad}% load. The silicon is either working or thinking about working.`,
        `${m.cpuCores} threads and it still finds time to complain. Relatable.`,
        m.cpuLoad > 85 ? `Pinned at ${m.cpuLoad}%. Something is mining, compiling, or Chrome.` : `Cruising at ${m.cpuLoad}%. The calm before the build.`,
      ], day + 'cpu'),
      fixes: [
        { title: 'Find the CPU hog', why: 'Lists the top 5 processes eating your cores right now.', teaching: 'Nine times out of ten it is a browser tab you forgot in 2019.', command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name, CPU, Id', danger: 'safe' },
      ],
    },
    {
      id: 'ram', label: 'Memory', value: usedRamPct, unit: '% used',
      status: tier(usedRamPct, 75, 90), spark: S('ram', usedRamPct),
      diagnosis: `${freeRamGB} GB free of ${totalRamGB} GB · ${usedRamPct}% committed.`,
      teaching: pick([
        `${usedRamPct}% used. RAM unused is RAM wasted — but ${usedRamPct}% is pushing the philosophy.`,
        `${freeRamGB} GB left. That is a few browser tabs or one Electron app away from zero.`,
        usedRamPct > 90 ? `${usedRamPct}%. Windows is about to start swapping to disk and you will FEEL it.` : `Comfortable at ${usedRamPct}%. Breathing room intact.`,
      ], day + 'ram'),
      fixes: [
        { title: 'Rank the memory eaters', why: 'Top 5 processes by working-set memory.', teaching: 'The winner is almost always something with "Helper" in its name.', command: 'Get-Process | Sort-Object WS -Descending | Select-Object -First 5 Name, @{N="MB";E={[int]($_.WS/1MB)}}, Id', danger: 'safe' },
      ],
    },
    {
      id: 'gpu', label: 'Graphics', value: m.gpuVramGB, unit: 'GB VRAM',
      status: m.gpuDriverDays == null ? 'grace' : tier(m.gpuDriverDays, 365, 730),
      spark: S('gpuDriverDays', m.gpuDriverDays ?? 0),
      diagnosis: `${m.gpuName} · ${m.gpuVramGB} GB · driver ${m.gpuDriverDate || 'unknown'}${m.gpuDriverDays != null ? ` (${m.gpuDriverDays}d old)` : ''}.`,
      teaching: pick([
        `${m.gpuName}. It renders your spreadsheets in glorious 4K.`,
        m.gpuDriverDays > 365 ? `That driver is over a year old. Ancient, in GPU years.` : `Driver is fresh enough. The pixels are in good hands.`,
      ], day + 'gpu'),
      fixes: [
        { title: 'Check for a newer driver', why: 'Opens Windows Update — GPU vendors ship fixes constantly.', teaching: 'A stale driver is the #1 cause of "it worked yesterday" gaming crashes.', command: 'Start-Process ms-settings:windowsupdate', danger: 'safe' },
      ],
    },
    {
      id: 'disk', label: 'Storage', value: m.diskFreeGB, unit: 'GB free',
      status: tier(diskFreePct, 20, 10, true), spark: S('diskFreeGB', m.diskFreeGB),
      diagnosis: `${m.diskFreeGB} GB free of ${m.diskTotalGB} GB on ${process.env.SystemDrive || 'C:'} · ${diskFreePct}% headroom · ${m.diskCount} drive${m.diskCount === 1 ? '' : 's'}.`,
      teaching: pick([
        `${diskFreePct}% free. Windows gets cranky below 10% — it needs room to breathe and swap.`,
        m.diskFreeGB < 20 ? `${m.diskFreeGB} GB left. That is a rounding error. Time to prune.` : `${m.diskFreeGB} GB free. Plenty of room for more node_modules you will never delete.`,
      ], day + 'disk'),
      fixes: [
        { title: 'Find the biggest folders', why: 'Ranks the top 10 space-eaters in your user profile.', teaching: 'Spoiler: it is node_modules, then .cache, then that 40GB folder named "temp final FINAL".', command: 'Get-ChildItem $env:USERPROFILE -Directory | ForEach-Object { [PSCustomObject]@{ GB = [math]::Round((Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB,1); Path = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 10', danger: 'safe' },
        { title: 'Open Disk Cleanup', why: 'The built-in Windows tool for reclaiming system junk.', teaching: 'It is old, it is ugly, and it works. Like most of Windows.', command: 'cleanmgr /d ' + (process.env.SystemDrive || 'C:'), danger: 'safe' },
      ],
    },
    {
      id: 'startup', label: 'Startup', value: m.startupCount, unit: 'apps',
      status: tier(m.startupCount, 8, 16), spark: S('startup', m.startupCount),
      diagnosis: `${m.startupCount} programs launch when Windows boots.`,
      teaching: pick([
        m.startupCount > 16 ? `${m.startupCount} startup apps. That is not a boot, that is a parade.` : `${m.startupCount} startup apps. Restrained, for a Windows machine.`,
        `Every one of these ${m.startupCount} adds seconds to your login and RAM to your idle.`,
      ], day + 'startup'),
      fixes: [
        { title: 'Review startup apps', why: 'Opens Task Manager → Startup, where you disable the freeloaders.', teaching: 'If you cannot name what it does, it probably does not need to greet you at boot.', command: 'Start-Process taskmgr -ArgumentList "/7"', danger: 'safe' },
        { title: 'List them here', why: 'Dumps every auto-start entry with its command.', teaching: 'The scary ones live in the registry Run keys.', command: 'Get-CimInstance Win32_StartupCommand | Select-Object Name, Location, Command | Format-Table -AutoSize', danger: 'safe' },
      ],
    },
    {
      id: 'temp', label: 'Temp debt', value: m.tempGB, unit: 'GB',
      status: tier(m.tempGB, 2, 8), spark: S('temp', m.tempGB),
      diagnosis: `${m.tempGB} GB of temp files sitting in %TEMP% and Windows\\Temp.`,
      teaching: pick([
        m.tempGB > 8 ? `${m.tempGB} GB of temp debt. "Temporary" is doing a lot of heavy lifting there.` : `${m.tempGB} GB of temp files. Mostly harmless, occasionally enormous.`,
        `Installers and updaters dump here and never clean up. ${m.tempGB} GB of digital lint.`,
      ], day + 'temp'),
      fixes: [
        { title: 'Purge %TEMP% (safe)', why: 'Deletes user temp files not currently locked by a running app.', teaching: 'Windows will refuse to delete anything in use, so this cannot break a running program.', command: 'Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue', danger: 'caution' },
      ],
    },
    {
      id: 'network', label: 'Network', value: m.pingMs, unit: 'ms',
      status: m.pingMs == null ? 'blood' : tier(m.pingMs, 40, 120), spark: S('pingMs', m.pingMs ?? 0),
      diagnosis: m.pingMs == null ? 'No response from 1.1.1.1 — offline, or the ICMP gate is closed.' : `${m.pingMs} ms round-trip to 1.1.1.1.`,
      teaching: pick([
        m.pingMs == null ? `Ping came back empty. Either you are offline or a firewall is eating ICMP.` : m.pingMs > 120 ? `${m.pingMs} ms. That is not lag, that is a pen-pal relationship.` : `${m.pingMs} ms. Snappy enough to blame the game server instead.`,
      ], day + 'net'),
      fixes: [
        { title: 'Flush the DNS cache', why: 'Clears stale name lookups — fixes "site won\'t load but works on my phone".', teaching: 'The IT-helpdesk classic, second only to "have you tried turning it off and on".', command: 'ipconfig /flushdns', danger: 'safe' },
        { title: 'Reset the network stack', why: 'Rebuilds Winsock + TCP/IP when connections act cursed.', teaching: 'The nuclear option. Needs a reboot after, and admin rights — it will prompt.', command: 'netsh winsock reset', danger: 'admin' },
      ],
    },
    {
      id: 'updates', label: 'Updates', value: m.updateDays, unit: 'days',
      status: m.updateDays == null ? 'ember' : tier(m.updateDays, 30, 90), spark: S('updateDays', m.updateDays ?? 0),
      diagnosis: m.updateDays == null ? 'Could not read the update history.' : `Last Windows update landed ${m.updateDays} days ago.`,
      teaching: pick([
        m.updateDays == null ? `The hotfix log is being shy. Check Windows Update directly.` : m.updateDays > 90 ? `${m.updateDays} days since the last patch. That is a lot of open windows for the internet to climb through.` : `Patched ${m.updateDays} days ago. Reasonably current.`,
      ], day + 'upd'),
      fixes: [
        { title: 'Check for updates', why: 'Opens Windows Update to pull the latest security patches.', teaching: 'Boring, yes. But unpatched machines are how ransomware pays its rent.', command: 'Start-Process ms-settings:windowsupdate', danger: 'safe' },
      ],
    },
  ];

  return {
    scanned_at: day + 'T' + new Date().toTimeString().slice(0, 8),
    host: { cpu: m.cpuName, ramGB: totalRamGB, uptimeHrs: m.uptimeHrs, battery: m.battery },
    organs,
  };
}

// ---- main ---------------------------------------------------------------
function main() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const m = gather();
  const report = build(m, day);

  fs.mkdirSync(DATA, { recursive: true });
  // append to rolling history (keyed metrics the sparklines read)
  const hist = loadHistory();
  hist.push({ at: report.scanned_at, cpu: m.cpuLoad, ram: report.organs.find((o) => o.id === 'ram').value,
    diskFreeGB: m.diskFreeGB, startup: m.startupCount, temp: m.tempGB, pingMs: m.pingMs ?? 0,
    updateDays: m.updateDays ?? 0, gpuDriverDays: m.gpuDriverDays ?? 0 });
  const trimmed = hist.slice(-HIST_MAX);
  const tmp = HIST + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(trimmed)); fs.renameSync(tmp, HIST);

  const otmp = OUT + '.tmp'; fs.writeFileSync(otmp, JSON.stringify(report, null, 2)); fs.renameSync(otmp, OUT);
  const sick = report.organs.filter((o) => o.status === 'blood').length;
  const warn = report.organs.filter((o) => o.status === 'ember').length;
  console.log(`[pc-health] ${report.organs.length} organs · ${sick} blood · ${warn} ember → ${path.relative(path.join(__dirname, '..'), OUT)}`);
}

main();
