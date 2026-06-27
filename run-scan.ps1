# Nightly workspace scan — launched by Windows Task Scheduler.
# Thin shim over the deterministic WorkspaceHQ pipeline (collector -> assemble ->
# render). No LLM and no --dangerously-skip-permissions: this is pure local Node
# over the filesystem + git, so it is safe to run fully unattended.
#
# (The old headless-Claude approach was retired 2026-05-27. An optional LLM
#  enrichment step can be re-added between assemble and render via scan-prompt.md.)

$ErrorActionPreference = 'Continue'
$scanDir  = $PSScriptRoot   # project root; relocatable (was .workspace-scan)
$pipeline = Join-Path $scanDir 'run-pipeline.ps1'

if (-not (Test-Path $pipeline)) {
  Write-Error "Pipeline missing at $pipeline"
  exit 1
}

& $pipeline -Date (Get-Date -Format 'yyyy-MM-dd')
exit $LASTEXITCODE
