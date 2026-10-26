// PC-HEALTH shaping — pure. Turns the raw probe blob from pc-health.ps1 into the Med-Bay
// contract (organs with status / diagnosis / teaching / curated fixes) plus the `detail`
// and `trends` blocks the System › Machine screen renders. No I/O: collector/pc-health.mjs
// runs the probes, owns the history file and writes data/pc-health.json.

export const HIST_MAX = 96;           // rolling samples (~a week of scans plus Re-examines)
export const HOG_TTL_MS = 6 * 3600e3; // the disk breakdown is re-measured at most every 6 h
// What an unelevated probe cannot read on Windows — shown as such instead of guessed.
export const UNREADABLE = [
  'Armoury Crate mode (Silent / Performance / Turbo)',
  'Battery wear',
  'SSD wear and temperature',
  'CPU temperature',
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []); // ConvertTo-Json unwraps 1-item arrays
const r1 = (v) => Math.round(v * 10) / 10;

// status tiers by ascending badness: grace (fine) → ember (watch it) → blood (act)
export const tier = (v, ember, blood, invert = false) => {
  if (v == null || Number.isNaN(v)) return 'grace';
  if (invert) return v >= ember ? 'grace' : v >= blood ? 'ember' : 'blood';
  return v <= ember ? 'grace' : v <= blood ? 'ember' : 'blood';
};

// deterministic teaching pick (no RNG — day-hash so a given day reads stable)
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export const pick = (arr, seed) => arr[fnv(seed) % arr.length];

export function sparkOf(hist, key, current) {
  const series = arr(hist).map((h) => h && h[key]).filter((v) => typeof v === 'number');
  if (typeof current === 'number') series.push(current);
  return series.slice(-24);
}

// a home-relative label for a folder path: C:\Users\me\AppData\Local\Docker → AppData\Local\Docker
export function folderLabel(p, home) {
  const s = String(p || '');
  if (home && s.toLowerCase().startsWith(String(home).toLowerCase() + '\\')) return s.slice(String(home).length + 1);
  return s;
}

// which hog list to show: this run's (when it measured), else the cached one while it is fresh
export function pickHogs(m, cache, nowMs, home) {
  const measured = m.hogs != null; // an array (or a 1-item object from ConvertTo-Json); null = not measured this run
  const src = measured ? { at: new Date(nowMs).toISOString(), partial: !!m.hogsPartial, items: arr(m.hogs) }
    : cache && Date.parse(cache.at) > nowMs - HOG_TTL_MS * 4 ? cache : null; // a stale cache still beats nothing; its age is shown
  if (!src) return null;
  const items = arr(src.items).filter((h) => h && num(h.gb) != null && h.path)
    .map((h) => ({ path: String(h.path), label: folderLabel(h.path, home), gb: h.gb }))
    .sort((a, b) => b.gb - a.gb).slice(0, 12);
  return { at: src.at, partial: !!src.partial, items, fresh: measured };
}

// Trend lines from the rolling history: only ones the samples can back, each with its window.
export function trends(hist, cur, nowMs) {
  const H = arr(hist).filter((h) => h && Date.parse(h.at) > 0);
  const out = [];
  const week = H.filter((h) => Date.parse(h.at) >= nowMs - 7 * 864e5);
  const first = week[0];
  const span = first ? Math.max(1, Math.round((nowMs - Date.parse(first.at)) / 864e5)) : 0;
  const window = span >= 7 ? 'this week' : span + ' day' + (span === 1 ? '' : 's');
  if (first && num(first.diskFreeGB) != null && num(cur.diskFreeGB) != null && span >= 1) {
    const d = r1(cur.diskFreeGB - first.diskFreeGB);
    if (Math.abs(d) >= 1) out.push({ id: 'disk', dir: d < 0 ? 'down' : 'up', bad: d < 0, text: `Disk free ${d < 0 ? 'fell' : 'grew'} ${Math.abs(d)} GB over ${window} (${first.diskFreeGB} → ${cur.diskFreeGB} GB)` });
    else out.push({ id: 'disk', dir: 'flat', bad: false, text: `Disk free held steady over ${window} (${cur.diskFreeGB} GB)` });
  }
  const rams = week.map((h) => num(h.ram)).filter((v) => v != null);
  if (rams.length >= 3) {
    const avg = Math.round(rams.reduce((a, b) => a + b, 0) / rams.length);
    out.push({ id: 'ram', dir: 'flat', bad: avg >= 85, text: `RAM averaged ${avg}% across the last ${rams.length} checks (peak ${Math.max(...rams)}%)` });
  }
  if (first && num(first.temp) != null && num(cur.tempGB) != null && span >= 1) {
    const d = r1(cur.tempGB - first.temp);
    if (d >= 0.5) out.push({ id: 'temp', dir: 'up', bad: true, text: `Temp files grew ${d} GB over ${window}` });
  }
  const temps = H.map((h) => num(h.gpuTempC)).filter((v) => v != null);
  if (temps.length >= 2) out.push({ id: 'gputemp', dir: 'flat', bad: Math.max(...temps) >= 85, text: `GPU ran ${Math.min(...temps)}–${Math.max(...temps)} °C across ${temps.length} checks` });
  return out;
}

const gb = (mb) => r1(mb / 1024);

export function build(m, ctx) {
  const { day, hist = [], hogCache = null, nowMs = Date.now(), home = '', systemDrive = 'C:' } = ctx || {};
  const usedRamPct = m.memTotalKB ? Math.round((1 - m.memFreeKB / m.memTotalKB) * 100) : 0;
  const freeRamGB = +(m.memFreeKB / 1024 / 1024).toFixed(1);
  const totalRamGB = Math.round(m.memTotalKB / 1024 / 1024);
  const diskFreePct = m.diskTotalGB ? Math.round((m.diskFreeGB / m.diskTotalGB) * 100) : 0;
  const S = (key, cur) => sparkOf(hist, key, cur);

  const gpus = arr(m.gpus).filter((g) => g && g.name).map((g) => ({ name: String(g.name), vramGB: num(g.vramGB), vramSource: g.vramSource === 'registry' ? 'registry' : 'wmi',
    driverDate: g.driverDate || null, driverDays: num(g.driverDays), width: num(g.width), height: num(g.height), hz: num(g.hz) }));
  const live = m.gpuLive && typeof m.gpuLive === 'object' ? m.gpuLive : null;
  // nvidia-smi's total is exact; the registry's qwMemorySize is too; WMI's 32-bit field is not (caps at 4 GB)
  const primary = gpus.slice().sort((a, b) => (b.vramGB || 0) - (a.vramGB || 0))[0] || null;
  const vram = live && num(live.memTotalMB) && primary && live.name === primary.name ? gb(live.memTotalMB) : primary ? primary.vramGB : num(m.gpuVramGB);
  const gpuName = primary ? primary.name : m.gpuName || 'Unknown GPU';
  const driverDays = primary ? primary.driverDays : num(m.gpuDriverDays);
  const driverDate = primary ? primary.driverDate : m.gpuDriverDate || null;
  const otherGpus = gpus.filter((g) => g !== primary).map((g) => `${g.name}${g.vramGB != null ? ' (' + g.vramGB + ' GB)' : ''}`);
  const gpuTemp = live ? num(live.tempC) : null;

  const topRam = arr(m.topRam).filter((p) => p && p.name && num(p.mb) != null).slice(0, 6).map((p) => ({ name: String(p.name), count: num(p.count) || 1, mb: p.mb }));
  const cores = num(m.cpuCores) || 1;
  // perf counters report % of ONE core; share of the whole CPU is that over the thread count
  const topCpu = arr(m.topCpu).filter((p) => p && p.name && num(p.pct) != null).slice(0, 5).map((p) => ({ name: String(p.name), pct: Math.round(p.pct / cores) }));
  const hogs = pickHogs(m, hogCache, nowMs, home);
  const battery = num(m.battery) != null ? { pct: m.battery, plugged: m.plugged === true, runtimeMin: num(m.runtimeMin) } : null;

  const organs = [
    {
      id: 'cpu', label: 'Processor', value: m.cpuLoad, unit: '% load',
      status: tier(m.cpuLoad, 55, 85), spark: S('cpu', m.cpuLoad),
      diagnosis: `${m.cpuName} · ${m.cpuCores} threads${num(m.cpuMHz) ? ' · ' + (m.cpuMHz / 1000).toFixed(1) + ' GHz' : ''} · ${m.cpuLoad}% right now${topCpu[0] && topCpu[0].pct > 0 ? ` · busiest: ${topCpu[0].name} (${topCpu[0].pct}%)` : ''}.`,
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
      diagnosis: `${freeRamGB} GB free of ${totalRamGB} GB · ${usedRamPct}% committed${topRam[0] ? ` · biggest: ${topRam[0].name} (${gb(topRam[0].mb)} GB)` : ''}.`,
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
      id: 'gpu', label: 'Graphics', value: vram, unit: 'GB VRAM',
      status: driverDays == null ? 'grace' : tier(driverDays, 365, 730),
      spark: S('gpuDriverDays', driverDays ?? 0),
      diagnosis: `${gpuName} · ${vram} GB · driver ${driverDate || 'unknown'}${driverDays != null ? ` (${driverDays}d old)` : ''}${gpuTemp != null ? ` · ${gpuTemp} °C` : ''}${otherGpus.length ? ' · also ' + otherGpus.join(', ') : ''}.`,
      teaching: pick([
        `${gpuName}. It renders your spreadsheets in glorious 4K.`,
        driverDays > 365 ? `That driver is over a year old. Ancient, in GPU years.` : `Driver is fresh enough. The pixels are in good hands.`,
      ], day + 'gpu'),
      fixes: [
        { title: 'Check for a newer driver', why: 'Opens Windows Update — GPU vendors ship fixes constantly.', teaching: 'A stale driver is the #1 cause of "it worked yesterday" gaming crashes.', command: 'Start-Process ms-settings:windowsupdate', danger: 'safe' },
      ],
    },
    {
      id: 'disk', label: 'Storage', value: m.diskFreeGB, unit: 'GB free',
      status: tier(diskFreePct, 20, 10, true), spark: S('diskFreeGB', m.diskFreeGB),
      diagnosis: `${m.diskFreeGB} GB free of ${m.diskTotalGB} GB on ${systemDrive} · ${diskFreePct}% headroom · ${m.diskCount} drive${m.diskCount === 1 ? '' : 's'}${hogs && hogs.items[0] ? ` · biggest folder: ${hogs.items[0].label} (${hogs.items[0].gb} GB)` : ''}.`,
      teaching: pick([
        `${diskFreePct}% free. Windows gets cranky below 10% — it needs room to breathe and swap.`,
        m.diskFreeGB < 20 ? `${m.diskFreeGB} GB left. That is a rounding error. Time to prune.` : `${m.diskFreeGB} GB free. Plenty of room for more node_modules you will never delete.`,
      ], day + 'disk'),
      fixes: [
        { title: 'Find the biggest folders', why: 'Ranks the top 10 space-eaters in your user profile.', teaching: 'Spoiler: it is node_modules, then .cache, then that 40GB folder named "temp final FINAL".', command: 'Get-ChildItem $env:USERPROFILE -Directory | ForEach-Object { [PSCustomObject]@{ GB = [math]::Round((Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB,1); Path = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 10', danger: 'safe' },
        { title: 'Open Disk Cleanup', why: 'The built-in Windows tool for reclaiming system junk.', teaching: 'It is old, it is ugly, and it works. Like most of Windows.', command: 'cleanmgr /d ' + systemDrive, danger: 'safe' },
        { title: 'Open Storage settings', why: 'Windows’ own breakdown of what fills the drive, with cleanup suggestions.', teaching: 'Storage Sense can empty Downloads and the Recycle Bin on a schedule.', command: 'Start-Process ms-settings:storagesense', danger: 'safe' }
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
      diagnosis: m.pingMs == null ? 'No response from 1.1.1.1 — offline, or the ICMP gate is closed.' : `${m.pingMs} ms round-trip to 1.1.1.1${m.net && num(m.net.linkMbps) ? ` · ${m.net.wireless ? 'Wi-Fi' : 'wired'} link ${m.net.linkMbps} Mbps` : ''}.`,
      teaching: pick([
        m.pingMs == null ? `Ping came back empty. Either you are offline or a firewall is eating ICMP.` : m.pingMs > 120 ? `${m.pingMs} ms. That is not lag, that is a pen-pal relationship.` : `${m.pingMs} ms. Snappy enough to blame the server instead.`,
      ], day + 'net'),
      fixes: [
        { title: 'Flush the DNS cache', why: 'Clears stale name lookups — fixes "site won\'t load but works on my phone".', teaching: 'The IT-helpdesk classic, second only to "have you tried turning it off and on".', command: 'ipconfig /flushdns', danger: 'safe' },
        { title: 'Reset the network stack', why: 'Rebuilds Winsock + TCP/IP when connections act cursed.', teaching: 'The nuclear option. Needs a reboot after, and admin rights — it will prompt.', command: 'netsh winsock reset', danger: 'admin' },
      ],
    },
    {
      id: 'updates', label: 'Updates', value: m.updateDays, unit: 'days',
      status: m.updateDays == null ? 'ember' : m.rebootPending ? 'ember' : tier(m.updateDays, 30, 90), spark: S('updateDays', m.updateDays ?? 0),
      diagnosis: m.updateDays == null ? 'Could not read the update history.' : `Last Windows update landed ${m.updateDays} days ago${m.rebootPending ? ' · a restart is pending to finish installing' : ''}.`,
      teaching: pick([
        m.updateDays == null ? `The hotfix log is being shy. Check Windows Update directly.` : m.updateDays > 90 ? `${m.updateDays} days since the last patch. That is a lot of open windows for the internet to climb through.` : `Patched ${m.updateDays} days ago. Respectable hygiene.`,
      ], day + 'upd'),
      fixes: [
        { title: 'Check for updates', why: 'Opens Windows Update to pull the latest security patches.', teaching: 'Boring, yes. But unpatched machines are how ransomware pays its rent.', command: 'Start-Process ms-settings:windowsupdate', danger: 'safe' },
      ],
    },
  ];
  if (battery) {
    const low = !battery.plugged && battery.pct <= 20;
    organs.push({
      id: 'battery', label: 'Battery', value: battery.pct, unit: '%',
      status: battery.plugged ? 'grace' : tier(battery.pct, 40, 20, true), spark: S('battery', battery.pct),
      diagnosis: `${battery.pct}% · ${battery.plugged ? 'plugged in' : 'on battery'}${battery.runtimeMin ? ` · about ${battery.runtimeMin >= 60 ? Math.floor(battery.runtimeMin / 60) + ' h ' : ''}${battery.runtimeMin % 60} min left` : ''}.`,
      teaching: pick([
        battery.plugged ? `On the charger at ${battery.pct}%. Laptops love a cool, plugged-in life.` : low ? `${battery.pct}% and unplugged. Find a socket before the RTX does.` : `${battery.pct}% on battery. The 3070 drinks fast when it wakes up.`,
      ], day + 'bat'),
      fixes: [
        { title: 'Battery report', why: 'Windows writes a full battery health report (design vs. current capacity) to your Documents.', teaching: 'Wear shows up as "full charge capacity" drifting below "design capacity".', command: 'powercfg /batteryreport /output "$env:USERPROFILE\\Documents\\battery-report.html"', danger: 'safe' },
      ],
    });
  }

  const detail = {
    gpus, gpuLive: live ? { name: String(live.name || gpuName), tempC: num(live.tempC), loadPct: num(live.loadPct), memUsedMB: num(live.memUsedMB), memTotalMB: num(live.memTotalMB),
      powerW: num(live.powerW), powerLimitW: num(live.powerLimitW), clockMHz: num(live.clockMHz), pstate: live.pstate ? String(live.pstate) : null } : null,
    topRam, topCpu, hogs,
    recycleGB: num(m.recycleGB),
    storage: arr(m.storage).filter((d) => d && d.name).map((d) => ({ name: String(d.name), media: String(d.media || ''), bus: String(d.bus || ''), health: String(d.health || 'Unknown'), sizeGB: num(d.sizeGB) })),
    battery,
    power: { plan: m.powerPlan ? String(m.powerPlan) : null },
    network: m.net && typeof m.net === 'object' ? { adapter: String(m.net.adapter || ''), wireless: !!m.net.wireless, linkMbps: num(m.net.linkMbps) } : null,
    displays: gpus.filter((g) => g.width && g.height).map((g) => ({ gpu: g.name, width: g.width, height: g.height, hz: g.hz })),
    rebootPending: m.rebootPending === true,
    startupApps: arr(m.startupItems).map(String).slice(0, 30),
    uptimeHrs: num(m.uptimeHrs),
    unreadable: UNREADABLE,
  };

  return {
    scanned_at: day + 'T' + new Date(nowMs).toTimeString().slice(0, 8),
    host: { cpu: m.cpuName, ramGB: totalRamGB, uptimeHrs: m.uptimeHrs, battery: m.battery ?? null, plugged: battery ? battery.plugged : null, gpu: gpuName, vramGB: vram },
    organs,
    detail,
    trends: trends(hist, { diskFreeGB: m.diskFreeGB, tempGB: m.tempGB }, nowMs),
  };
}

// the history sample one run appends (keys the sparklines and trends read)
export function historySample(report, m) {
  const organ = (id) => report.organs.find((o) => o.id === id) || {};
  const gpuSpark = organ('gpu').spark || [];
  return { at: report.scanned_at, cpu: m.cpuLoad, ram: organ('ram').value, diskFreeGB: m.diskFreeGB, startup: m.startupCount, temp: m.tempGB, pingMs: m.pingMs ?? 0,
    updateDays: m.updateDays ?? 0, gpuDriverDays: gpuSpark.length ? gpuSpark[gpuSpark.length - 1] : 0,
    gpuTempC: report.detail.gpuLive ? report.detail.gpuLive.tempC : null, battery: report.detail.battery ? report.detail.battery.pct : null };
}
