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
  [switch]$NoEnrich  # skip the LLM enrichment step (stay fully offline/deterministic)
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
if (-not $NoEnrich) { $steps += @{ name = 'enrich'; args = @((Join-Path $collector 'enrich.mjs'), '--reports-dir', $ReportsDir) } }
$steps += @{ name = 'assemble'; args = @((Join-Path $collector 'assemble.mjs'), '--date', $Date, '--reports-dir', $ReportsDir) }
$steps += @{ name = 'render';   args = @((Join-Path $collector 'render.mjs'), '--in', $latest, '--out', $mdOut) }

foreach ($s in $steps) {
  Log "-> $($s.name)"
  $out = & node @($s.args) 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { Log "   $_" }
  if ($code -ne 0) { Log "STEP FAILED: $($s.name) (exit $code)"; exit $code }
}

# Trim logs to 30 most recent.
Get-ChildItem $logDir -Filter 'pipeline-*.log' | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 | Remove-Item -Force -ErrorAction SilentlyContinue

Log "WorkspaceHQ pipeline done -> $ReportsDir\Workspace Status $Date.{json,md}"
