<#
.SYNOPSIS
  Switch WorkspaceHQ's renderer and restart the app. Rollback is one command.

.DESCRIPTION
  tools\rollback.ps1 <v2|v3|v4|v5> [-DryRun]

  1. Validates the version. v5 is the app (dashboard-v5\). v2, v3 and v4 are the
     quarantined renderers in legacy\ and only load as a rollback.
  2. Writes data\.ui-version (no BOM, no newline).
  3. Stops the running WorkspaceHQ app: the electron.exe main process started from
     this repo's dashboard\ folder WITHOUT --user-data-dir, then its leftover
     Chromium children. Test instances (they pass --user-data-dir), the trailer
     renderer and the legacy dev harnesses are never touched.
  4. Relaunches it hidden to the tray, detached:
     dashboard\node_modules\electron\dist\electron.exe . --hidden  (working dir dashboard\)

  -DryRun (alias -WhatIf) prints the plan and changes nothing.

  Every decision (the version check, which processes are the app) is made by
  tools\rollback-core.mjs and unit-tested in tools\rollback-core.test.mjs; this
  script only gathers the process list and carries out the plan. It creates no
  scheduled task and no Startup entry.

.EXAMPLE
  tools\rollback.ps1 v3
  Roll back to the legacy v3 renderer.

.EXAMPLE
  tools\rollback.ps1 v5
  Back to the default renderer.

.EXAMPLE
  tools\rollback.ps1 v3 -DryRun
  Show what would happen, change nothing.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Version,
  [Alias('WhatIf')] [switch] $DryRun
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Core = Join-Path $PSScriptRoot 'rollback-core.mjs'
$ElectronExe = Join-Path $Root 'dashboard\node_modules\electron\dist\electron.exe'

if (-not $Version) {
  Write-Host 'usage: tools\rollback.ps1 <v2|v3|v4|v5> [-DryRun]'
  Write-Host '  v5 = the app (default); v2 / v3 / v4 = legacy renderers, rollback only'
  exit 2
}

function Rel([string] $p) {
  if ($p -and $p.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { return $p.Substring($Root.Length).TrimStart('\') }
  return $p
}

# ---- 1. candidate processes (electron.exe only; the core decides which one is the app)
$procs = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)
$procJson = if ($procs.Count) { ConvertTo-Json -InputObject $procs -Compress -Depth 3 } else { '[]' }

# ---- 2. the plan, from the tested core (node, else Electron's own Node runtime)
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$coreArgs = @($Core, 'plan', '--version', $Version, '--repo', $Root)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'   # native stderr must not throw before we read the exit code
try {
  if ($node) {
    $raw = $procJson | & $node.Source @coreArgs 2>&1
  } elseif (Test-Path $ElectronExe) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    try { $raw = $procJson | & $ElectronExe @coreArgs 2>&1 } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  } else {
    Write-Host 'rollback: neither node nor dashboard\node_modules\electron is available (run npm install in dashboard\)' -ForegroundColor Red
    exit 1
  }
  $code = $LASTEXITCODE
} finally { $ErrorActionPreference = $prevEap }
$stdout = @($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
$stderr = @($raw | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) -join "`n"
if ($code -ne 0) {
  Write-Host ("rollback: " + ($(if ($stderr) { $stderr } else { "planning failed (exit $code)" }))) -ForegroundColor Red
  exit 2
}
$plan = $stdout | ConvertFrom-Json

# ---- 3. say what will happen
$was = '(none: v5 by default)'
if (Test-Path -LiteralPath $plan.uiVersionFile) {
  try { $was = ([IO.File]::ReadAllText($plan.uiVersionFile)).Trim(); if (-not $was) { $was = '(empty: v5 by default)' } } catch { $was = '(unreadable)' }
}
$mode = if ($plan.version -eq 'v5') { 'the app' } else { 'legacy renderer, rollback mode' }
Write-Host "WorkspaceHQ renderer -> $($plan.version) ($mode): $($plan.target)"
Write-Host "  write   $(Rel $plan.uiVersionFile) = $($plan.version)   (was: $was)"
if (@($plan.stop).Count) {
  foreach ($s in @($plan.stop)) { Write-Host "  stop    PID $($s.pid)  $($s.commandLine)" }
  if (@($plan.children).Count) { Write-Host "          + $(@($plan.children).Count) child process(es) of the app, if still running after it exits" }
} else {
  Write-Host '  stop    (the app is not running)'
}
Write-Host "  launch  $(Rel $plan.launch.exe) $($plan.launch.args -join ' ')   (working dir $(Rel $plan.launch.cwd), detached)"
if ($env:HQ_UI_VERSION) { Write-Host "  note    HQ_UI_VERSION=$($env:HQ_UI_VERSION) is set in this shell; the relaunched app does not inherit it" }

if ($DryRun) {
  Write-Host '[dry run] nothing changed.'
  exit 0
}

if (-not (Test-Path -LiteralPath $plan.launch.exe)) {
  Write-Host "rollback: $(Rel $plan.launch.exe) not found (run npm install in dashboard\); nothing changed." -ForegroundColor Red
  exit 1
}

# ---- 4. write the flag (no BOM, no newline: dashboard\ui-version.js trims and checks /^v[2-5]$/)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $plan.uiVersionFile) | Out-Null
[IO.File]::WriteAllText($plan.uiVersionFile, $plan.version, [Text.UTF8Encoding]::new($false))
Write-Host "wrote   $(Rel $plan.uiVersionFile) = $($plan.version)"

# ---- 5. stop the app: main process first, then any child that outlived it
$mainIds = @(@($plan.stop) | ForEach-Object { [int]$_.pid })
foreach ($id in $mainIds) {
  try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host "stopped PID $id" }
  catch { Write-Host "PID $id already gone" }
}
foreach ($id in $mainIds) { Wait-Process -Id $id -Timeout 15 -ErrorAction SilentlyContinue }
foreach ($c in @($plan.children)) {
  # only if it is still that app's electron child (PIDs get reused)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$c)" -ErrorAction SilentlyContinue
  if ($p -and $p.Name -eq 'electron.exe' -and ($mainIds -contains [int]$p.ParentProcessId)) {
    Stop-Process -Id ([int]$c) -Force -ErrorAction SilentlyContinue
  }
}

# ---- 6. relaunch hidden, detached, with a clean renderer environment
$saved = @{ HQ_UI_VERSION = $env:HQ_UI_VERSION; ELECTRON_RUN_AS_NODE = $env:ELECTRON_RUN_AS_NODE }
Remove-Item Env:HQ_UI_VERSION, Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
try {
  $p = Start-Process -FilePath $plan.launch.exe -ArgumentList $plan.launch.args -WorkingDirectory $plan.launch.cwd -WindowStyle Hidden -PassThru
  Write-Host "started PID $($p.Id): WorkspaceHQ on $($plan.version), in the tray"
} finally {
  foreach ($k in $saved.Keys) { if ($null -ne $saved[$k]) { Set-Item -Path "Env:$k" -Value $saved[$k] } }
}
