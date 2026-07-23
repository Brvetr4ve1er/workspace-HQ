# PC-HEALTH gather — unelevated Windows probes → one JSON blob on stdout.
# Every probe is wrapped so a single failure degrades to null, never aborts.
# pc-health.mjs consumes this and does all thresholding/teaching/fixes.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Try-Val($block, $default = $null) { try { & $block } catch { $default } }

# --- CPU ------------------------------------------------------------------
$cpu = Try-Val { Get-CimInstance Win32_Processor }
$cpuLoad = Try-Val { [int](($cpu | Measure-Object -Property LoadPercentage -Average).Average) } 0
$cpuName = Try-Val { ($cpu | Select-Object -First 1).Name.Trim() } 'Unknown CPU'
$cpuCores = Try-Val { ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum } 0

# --- RAM ------------------------------------------------------------------
$os = Try-Val { Get-CimInstance Win32_OperatingSystem }
$memTotalKB = Try-Val { [double]$os.TotalVisibleMemorySize } 0
$memFreeKB  = Try-Val { [double]$os.FreePhysicalMemory } 0

# --- GPU ------------------------------------------------------------------
$gpu = Try-Val { Get-CimInstance Win32_VideoController | Select-Object -First 1 }
$gpuName = Try-Val { $gpu.Name.Trim() } 'Unknown GPU'
$gpuVramGB = Try-Val { [math]::Round([double]$gpu.AdapterRAM / 1GB, 1) } 0
$gpuDriverDate = Try-Val { $gpu.DriverDate.ToString('yyyy-MM-dd') } $null
$gpuDriverDays = Try-Val { [int]((Get-Date) - $gpu.DriverDate).TotalDays } $null

# --- DISK (system drive) --------------------------------------------------
$sys = Try-Val { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" }
$diskFreeGB  = Try-Val { [math]::Round([double]$sys.FreeSpace / 1GB, 1) } 0
$diskTotalGB = Try-Val { [math]::Round([double]$sys.Size / 1GB, 1) } 0
$diskCount = Try-Val { (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Measure-Object).Count } 1

# --- STARTUP --------------------------------------------------------------
$startupCount = Try-Val { (Get-CimInstance Win32_StartupCommand | Measure-Object).Count } 0

# --- UPDATES (days since most recent hotfix) ------------------------------
$lastHotfix = Try-Val { (Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn }
$updateDays = Try-Val { [int]((Get-Date) - $lastHotfix).TotalDays } $null

# --- TEMP debt ------------------------------------------------------------
$tempBytes = Try-Val {
  $paths = @($env:TEMP, "$env:SystemRoot\Temp") | Select-Object -Unique
  ($paths | ForEach-Object { Get-ChildItem $_ -Recurse -Force -File -ErrorAction SilentlyContinue } | Measure-Object -Property Length -Sum).Sum
} 0
$tempGB = Try-Val { [math]::Round([double]$tempBytes / 1GB, 2) } 0

# --- NETWORK latency (ms to 1.1.1.1) --------------------------------------
$pingMs = Try-Val { [int](Test-Connection -ComputerName 1.1.1.1 -Count 2 -ErrorAction Stop | Measure-Object -Property ResponseTime -Average).Average } $null

# --- BATTERY (null on desktop) --------------------------------------------
$batt = Try-Val { (Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining } $null

# --- UPTIME ---------------------------------------------------------------
$uptimeHrs = Try-Val { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) } $null

[PSCustomObject]@{
  cpuLoad = $cpuLoad; cpuName = $cpuName; cpuCores = $cpuCores
  memTotalKB = $memTotalKB; memFreeKB = $memFreeKB
  gpuName = $gpuName; gpuVramGB = $gpuVramGB; gpuDriverDate = $gpuDriverDate; gpuDriverDays = $gpuDriverDays
  diskFreeGB = $diskFreeGB; diskTotalGB = $diskTotalGB; diskCount = $diskCount
  startupCount = $startupCount
  updateDays = $updateDays
  tempGB = $tempGB
  pingMs = $pingMs
  battery = $batt
  uptimeHrs = $uptimeHrs
} | ConvertTo-Json -Compress
