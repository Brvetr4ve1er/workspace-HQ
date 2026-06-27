# Registers the "VEEMO Nightly Workspace Scan" task with TWO triggers:
#   1. Daily at 00:00 local time.
#   2. At user logon (+2 min delay) — so it always runs on startup and never
#      silently skips a day when the machine was asleep/off at midnight.
# StartWhenAvailable also catches up a missed daily slot once the machine wakes.
# Runs the DETERMINISTIC pipeline (collector -> assemble -> render) — pure local
# Node over the filesystem + git, no LLM and no --dangerously-skip-permissions.
# Safe to run unattended. To undo later:
#   Unregister-ScheduledTask -TaskName 'VEEMO Nightly Workspace Scan' -Confirm:$false

$taskName = 'VEEMO Nightly Workspace Scan'
$ps5    = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $PSScriptRoot 'run-scan.ps1'   # resolves to wherever this project lives

$action = New-ScheduledTaskAction -Execute $ps5 `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$daily = New-ScheduledTaskTrigger -Daily -At ([datetime]'00:00')
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$logon.Delay = 'PT2M'  # ISO-8601: wait 2 min after logon so boot churn settles
$triggers = @($daily, $logon)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings `
  -Description 'Workspace scan (collector->assemble->render); writes dated JSON sidecar + Markdown report into VEEMO CORTEX vault. Feeds WorkspaceHQ. Triggers: daily 00:00 + at logon (+2m). Updated 2026-06-02.' `
  -Force | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "Registered '$taskName'. Next run: $($info.NextRunTime)" -ForegroundColor Green
