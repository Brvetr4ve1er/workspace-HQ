# WorkspaceHQ scan pipeline: collector -> (enrich) -> assemble -> render.
# Collector/assemble/render are pure Node over the local filesystem + git — no prompts,
# safe unattended. The LLM enrichment step (genuine completion% / build / tests / risk
# severity / insights) now runs BY DEFAULT, but degrades gracefully: enrich.mjs no-ops
# cleanly (exit 0) when the `claude` CLI isn't on PATH, so the deterministic pipeline is
# never blocked. Pass -NoEnrich to force the offline-only path.
#
#   .\run-pipeline.ps1 [-Date yyyy-MM-dd] [-ReportsDir <path>] [-NoEnrich]

param(
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$ReportsDir = 'C:\Users\ROG STRIX\Documents\VEEMO CORTEX\30_Areas\Workspace Status',
  [switch]$NoEnrich,  # skip the LLM enrichment step (stay fully offline/deterministic)
  [switch]$Weekly     # force the weekly narrator (otherwise it only runs on Sundays)
)

$ErrorActionPreference = 'Stop'
$scanDir   = $PSScriptRoot   # project root; relocatable (was .workspace-scan)
$collector = Join-Path $scanDir 'collector'
$logDir    = Join-Path $scanDir 'logs'
$stamp     = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$log       = Join-Path $logDir "pipeline-$stamp.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Ensure node + npm global bin are on PATH under a Task Scheduler session.
$npmGlobal = 'C:\Users\ROG STRIX\AppData\Roaming\npm'
if ($env:Path -notlike "*$npmGlobal*") { $env:Path = "$npmGlobal;$env:Path" }

function Log($msg) { "[$(Get-Date -Format o)] $msg" | Tee-Object -FilePath $log -Append }

Log "WorkspaceHQ pipeline start (date=$Date)"

$latest = Join-Path $scanDir 'data\latest.json'
$mdOut  = Join-Path $ReportsDir "Workspace Status $Date.md"
$steps = @( @{ name = 'collector'; args = @((Join-Path $collector 'collector.mjs')) } )
# Spellbook catalog refresh: read-only discovery of skills/scripts/tasks/MCP into
# data/spellbook.json. Optional — a broken schtasks query must never block the scan.
$steps += @{ name = 'spellbook'; args = @((Join-Path $collector 'spellbook.mjs')); optional = $true }
# PC-health probe: unelevated Windows vitals into data/pc-health.json for Med-Bay.
# Optional — a slow/blocked WMI query must never hold up the scan.
$steps += @{ name = 'pc-health'; args = @((Join-Path $collector 'pc-health.mjs')); optional = $true }
# GitHub account snapshot through the owner's own gh login into data/github.json (gitignored).
# Optional — signed out / offline writes an honest state, never blocks the scan.
$steps += @{ name = 'github'; args = @((Join-Path $collector 'github.mjs')); optional = $true }
if (-not $NoEnrich) { $steps += @{ name = 'enrich'; args = @((Join-Path $collector 'enrich.mjs'), '--reports-dir', $ReportsDir); optional = $true } }
$steps += @{ name = 'assemble'; args = @((Join-Path $collector 'assemble.mjs'), '--date', $Date, '--reports-dir', $ReportsDir) }
$steps += @{ name = 'render';   args = @((Join-Path $collector 'render.mjs'), '--in', $latest, '--out', $mdOut) }
# Weekly Saga: Sundays (or forced via -Weekly, e.g. cast from the dashboard). Optional —
# a narrator hiccup must never block the scan; it degrades to a static recap without claude.
if ($Weekly -or (Get-Date).DayOfWeek -eq 'Sunday') {
  $steps += @{ name = 'weekly-narrator'; args = @((Join-Path $collector 'weekly-narrator.mjs'), '--reports-dir', $ReportsDir); optional = $true }
}

foreach ($s in $steps) {
  Log "-> $($s.name)"
  $out = & node @($s.args) 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { Log "   $_" }
  if ($code -ne 0) {
    # Enrichment is a nice-to-have: if it crashes, assemble/render must still land a
    # fresh latest.json (last good enrichment.json carries forward). Only hard steps abort.
    if ($s.optional) { Log "STEP FAILED (optional, continuing): $($s.name) (exit $code)"; continue }
    Log "STEP FAILED: $($s.name) (exit $code)"; exit $code
  }
}

# Trim logs to 30 most recent.
Get-ChildItem $logDir -Filter 'pipeline-*.log' | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 | Remove-Item -Force -ErrorAction SilentlyContinue

Log "WorkspaceHQ pipeline done -> $ReportsDir\Workspace Status $Date.{json,md}"
