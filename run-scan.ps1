# Nightly workspace scan — launched by Windows Task Scheduler.
# Thin shim over the WorkspaceHQ pipeline (collector -> enrich -> assemble -> render -> bake).
# No --dangerously-skip-permissions anywhere: the pipeline is local Node over the filesystem
# + git, plus at most one tool-less `claude -p` enrichment call a day, so it is safe unattended.
#
# Enrichment (completion %, insights, roadmap) runs at most once a day: the nightly scan
# enriches unless a scan already enriched today (an in-app scan). Before 2026-10-26 the
# nightly path never enriched, so those fields sat carried forward for weeks (data overhaul
# Front A3). enrich.mjs no-ops cleanly when `claude` is missing; -NoEnrich still forces the
# offline path:  .\run-scan.ps1 -NoEnrich
param([switch]$NoEnrich)

$ErrorActionPreference = 'Continue'
$scanDir  = $PSScriptRoot   # project root; relocatable (was .workspace-scan)
$pipeline = Join-Path $scanDir 'run-pipeline.ps1'

if (-not (Test-Path $pipeline)) {
  Write-Error "Pipeline missing at $pipeline"
  exit 1
}

$today = Get-Date -Format 'yyyy-MM-dd'
$enrichedToday = $false
try {
  $scan = (Get-Content -Raw -LiteralPath (Join-Path $scanDir 'data\latest.json') | ConvertFrom-Json).scan
  $enrichedToday = ($scan.enrichment_scan_id -eq $today) -and ($scan.enrichment_age_days -eq 0)
} catch { }
if ($NoEnrich -or $enrichedToday) { & $pipeline -Date $today -NoEnrich } else { & $pipeline -Date $today }
exit $LASTEXITCODE
