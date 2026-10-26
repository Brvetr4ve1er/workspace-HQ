# PC-HEALTH gather — unelevated Windows probes → one JSON blob on stdout.
# Every probe is wrapped so a single failure degrades to null, never aborts.
# pc-health.mjs consumes this and does all thresholding/teaching/fixes.
# Nothing here needs admin; what only an elevated probe can read is left out
# (pc-health.mjs lists it as "not readable without admin" instead of guessing).
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Try-Val($block, $default = $null) { try { & $block } catch { $default } }
# HQ_PC_TRACE=1 prints how long each probe took (stderr), to keep the scan inside its time limit
$__sw = [Diagnostics.Stopwatch]::StartNew()
function Mark($what) { if ($env:HQ_PC_TRACE) { [Console]::Error.WriteLine(('{0,6} ms  {1}' -f $__sw.ElapsedMilliseconds, $what)) } }

# --- CPU ------------------------------------------------------------------
$cpu = Try-Val { Get-CimInstance Win32_Processor }
$cpuLoad = Try-Val { [int](($cpu | Measure-Object -Property LoadPercentage -Average).Average) } 0
$cpuName = Try-Val { ($cpu | Select-Object -First 1).Name.Trim() } 'Unknown CPU'
$cpuCores = Try-Val { ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum } 0
$cpuMHz = Try-Val { [int]($cpu | Select-Object -First 1).MaxClockSpeed } $null

Mark 'cpu'
# --- RAM ------------------------------------------------------------------
$os = Try-Val { Get-CimInstance Win32_OperatingSystem }
$memTotalKB = Try-Val { [double]$os.TotalVisibleMemorySize } 0
$memFreeKB  = Try-Val { [double]$os.FreePhysicalMemory } 0

Mark 'ram'
# --- GPUs -----------------------------------------------------------------
# WMI's AdapterRAM is a 32-bit field: every card with 4 GB or more reads as ~4 GB.
# The display-class registry key carries the real 64-bit size (qwMemorySize).
$regVram = @{}
Try-Val {
  Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' |
    Where-Object { $_.DriverDesc } |
    ForEach-Object {
      $q = $_.'HardwareInformation.qwMemorySize'
      if ($q -is [array]) { $q = [BitConverter]::ToUInt64([byte[]]$q, 0) }
      if ($q) { $regVram[$_.DriverDesc.Trim()] = [double]$q }
    }
}
$gpus = @(Try-Val {
  Get-CimInstance Win32_VideoController | ForEach-Object {
    $name = $_.Name.Trim()
    $bytes = if ($regVram.ContainsKey($name)) { $regVram[$name] } else { [double]$_.AdapterRAM }
    [PSCustomObject]@{
      name = $name
      vramGB = [math]::Round($bytes / 1GB, 1)
      vramSource = if ($regVram.ContainsKey($name)) { 'registry' } else { 'wmi' }
      driverDate = Try-Val { $_.DriverDate.ToString('yyyy-MM-dd') } $null
      driverDays = Try-Val { [int]((Get-Date) - $_.DriverDate).TotalDays } $null
      width = $_.CurrentHorizontalResolution
      height = $_.CurrentVerticalResolution
      hz = $_.CurrentRefreshRate
    }
  }
} @())

# Live NVIDIA telemetry (nvidia-smi ships with the driver; absent on AMD/Intel-only machines)
$gpuLive = Try-Val {
  $smi = Get-Command nvidia-smi -ErrorAction Stop
  $line = & $smi.Source --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,clocks.gr,pstate --format=csv,noheader,nounits 2>$null | Select-Object -First 1
  if (-not $line) { return $null }
  $f = $line -split ',\s*'
  $n = { param($s) $v = 0.0; if ([double]::TryParse(($s -replace '[^\d\.]', ''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$v)) { $v } else { $null } }
  [PSCustomObject]@{
    name = $f[0].Trim(); tempC = & $n $f[1]; loadPct = & $n $f[2]
    memUsedMB = & $n $f[3]; memTotalMB = & $n $f[4]
    powerW = & $n $f[5]; powerLimitW = & $n $f[6]; clockMHz = & $n $f[7]; pstate = $f[8].Trim()
  }
} $null

Mark 'gpus'
# --- What is using the machine right now ----------------------------------
$topRam = @(Try-Val {
  Get-Process | Group-Object ProcessName | ForEach-Object {
    [PSCustomObject]@{ name = $_.Name; count = $_.Count; mb = [int][math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB) }
  } | Sort-Object mb -Descending | Select-Object -First 6
} @())
$topCpu = @(Try-Val {
  Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $_.Name -notin '_Total', 'Idle' -and $_.PercentProcessorTime -gt 0 } |
    ForEach-Object { [PSCustomObject]@{ name = ($_.Name -replace '#\d+$', ''); pct = [double]$_.PercentProcessorTime } } |
    Group-Object name | ForEach-Object { [PSCustomObject]@{ name = $_.Name; pct = ($_.Group | Measure-Object pct -Sum).Sum } } |
    Sort-Object pct -Descending | Select-Object -First 5
} @())

Mark 'top procs'
# --- DISK (system drive) --------------------------------------------------
$sys = Try-Val { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" }
$diskFreeGB  = Try-Val { [math]::Round([double]$sys.FreeSpace / 1GB, 1) } 0
$diskTotalGB = Try-Val { [math]::Round([double]$sys.Size / 1GB, 1) } 0
$diskCount = Try-Val { (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Measure-Object).Count } 1
$storage = @(Try-Val {
  Get-PhysicalDisk | ForEach-Object {
    [PSCustomObject]@{ name = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; health = [string]$_.HealthStatus; sizeGB = [math]::Round([double]$_.Size / 1GB) }
  }
} @())

Mark 'disk+storage'
# Where the space went: robocopy /L lists without copying and totals bytes fast.
# Top-level folders of the user profile, plus the children of AppData\Local
# (caches, WSL/Docker disks, browser profiles live there). Time-boxed.
function Size-Of($dir) {
  $out = robocopy $dir NULL /L /S /NJH /BYTES /NFL /NDL /XJ /R:0 /W:0 /MT:16 2>$null
  $line = ($out | Select-String -Pattern '^\s*Bytes\s*:' | Select-Object -First 1).Line
  if (-not $line) { return $null }
  $num = ($line -split ':', 2)[1].Trim() -split '\s+' | Select-Object -First 1
  [double]$num
}
$hogBudget = [Diagnostics.Stopwatch]::StartNew()
$hogPartial = $false
# (Try-Val runs its block in a child scope, so each call returns its list instead of appending)
$notLink = { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
$hogDirs = @(
  @(Try-Val { Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Force | Where-Object $notLink | Where-Object { $_.Name -ne 'AppData' } } @()) +
  @(Try-Val { Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -Force | Where-Object $notLink } @()) +
  @(Try-Val { Get-Item -LiteralPath $env:APPDATA -Force } @())
)
# Sizing every folder takes ~30 s, so pc-health.mjs caches the result and sets
# HQ_PC_SKIP_HOGS=1 while that cache is fresh (hogs = $null then means "not measured this run").
$hogs = @()
$hogsMeasured = -not $env:HQ_PC_SKIP_HOGS
if (-not $hogsMeasured) { $hogDirs = @() }
foreach ($d in $hogDirs) {
  if ($hogBudget.Elapsed.TotalSeconds -gt 45) { $hogPartial = $true; break }
  $b = Size-Of $d.FullName
  if ($b -ne $null -and $b -ge 256MB) { $hogs += [PSCustomObject]@{ path = $d.FullName; gb = [math]::Round($b / 1GB, 1) } }
}
$hogs = @($hogs | Sort-Object gb -Descending | Select-Object -First 12)
$recycleGB = Try-Val { [math]::Round([double]((New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum).Sum / 1GB, 2) } $null

Mark 'hogs'
# --- STARTUP --------------------------------------------------------------
$startupItems = @(Try-Val { Get-CimInstance Win32_StartupCommand | Select-Object -ExpandProperty Name | Sort-Object -Unique } @())
$startupCount = $startupItems.Count

Mark 'startup'
# --- UPDATES (days since most recent hotfix) ------------------------------
$lastHotfix = Try-Val { (Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn }
$updateDays = Try-Val { [int]((Get-Date) - $lastHotfix).TotalDays } $null
$rebootPending = Try-Val {
  (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
  (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
} $null

Mark 'updates'
# --- TEMP debt ------------------------------------------------------------
$tempBytes = Try-Val {
  $t = 0.0
  foreach ($p in (@($env:TEMP, "$env:SystemRoot\Temp") | Select-Object -Unique)) { $b = Size-Of $p; if ($b) { $t += $b } }
  $t
} 0
$tempGB = Try-Val { [math]::Round([double]$tempBytes / 1GB, 2) } 0

Mark 'temp'
# --- NETWORK --------------------------------------------------------------
$pingMs = Try-Val { [int](Test-Connection -ComputerName 1.1.1.1 -Count 2 -ErrorAction Stop | Measure-Object -Property ResponseTime -Average).Average } $null
$net = Try-Val {
  $a = Get-NetAdapter | Where-Object Status -eq 'Up' | Sort-Object { $_.ReceiveLinkSpeed } -Descending | Select-Object -First 1
  if ($a) { [PSCustomObject]@{ adapter = $a.InterfaceDescription; wireless = ($a.MediaType -match '802\.11'); linkMbps = [math]::Round([double]$a.ReceiveLinkSpeed / 1e6) } }
} $null

Mark 'network'
# --- POWER ----------------------------------------------------------------
$battRow = Try-Val { Get-CimInstance Win32_Battery | Select-Object -First 1 }
$batt = Try-Val { $battRow.EstimatedChargeRemaining } $null
# BatteryStatus 2 = on AC; the run-time estimate is 71582788 (= "unknown") while plugged in
$plugged = Try-Val { if ($battRow) { [int]$battRow.BatteryStatus -eq 2 -or [int]$battRow.BatteryStatus -ge 6 } else { $null } } $null
$runtimeMin = Try-Val { $r = [int]$battRow.EstimatedRunTime; if ($r -gt 0 -and $r -lt 6000) { $r } else { $null } } $null
$powerPlan = Try-Val { $l = powercfg /getactivescheme; if ($l -match '\(([^)]+)\)') { $Matches[1] } else { $null } } $null

Mark 'power'
# --- UPTIME ---------------------------------------------------------------
$uptimeHrs = Try-Val { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) } $null

$primary = $gpus | Sort-Object vramGB -Descending | Select-Object -First 1

[PSCustomObject]@{
  cpuLoad = $cpuLoad; cpuName = $cpuName; cpuCores = $cpuCores; cpuMHz = $cpuMHz
  memTotalKB = $memTotalKB; memFreeKB = $memFreeKB
  gpuName = if ($primary) { $primary.name } else { 'Unknown GPU' }
  gpuVramGB = if ($primary) { $primary.vramGB } else { 0 }
  gpuDriverDate = if ($primary) { $primary.driverDate } else { $null }
  gpuDriverDays = if ($primary) { $primary.driverDays } else { $null }
  gpus = $gpus; gpuLive = $gpuLive
  topRam = $topRam; topCpu = $topCpu
  diskFreeGB = $diskFreeGB; diskTotalGB = $diskTotalGB; diskCount = $diskCount
  storage = $storage; hogs = if ($hogsMeasured) { $hogs } else { $null }; hogsPartial = $hogPartial; recycleGB = $recycleGB
  startupCount = $startupCount; startupItems = $startupItems
  updateDays = $updateDays; rebootPending = $rebootPending
  tempGB = $tempGB
  pingMs = $pingMs; net = $net
  battery = $batt; plugged = $plugged; runtimeMin = $runtimeMin; powerPlan = $powerPlan
  uptimeHrs = $uptimeHrs
} | ConvertTo-Json -Compress -Depth 5
