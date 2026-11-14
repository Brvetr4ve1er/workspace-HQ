# tools/nightly-lock.ps1 - the nightly run-pipeline.ps1 takes data/.refresh.lock the way dashboard/refresh-lock.js does.
# Dot-source it:   . (Join-Path $scanDir 'tools\nightly-lock.ps1')
#
#   Take-NightlyLock [-DataDir <dir>] [-Log <scriptblock>]  -> 'taken' | 'inherited' | 'open' | 'skipped'
#       taken      this run now holds the lock as by 'nightly' (Heartbeat and Release act on it)
#       inherited  the lock is the app's own and this PowerShell is its child (parent, or one of the next two ancestors):
#                  the app's Scan / post-commit rescan took it and then spawned us. Write nothing, heartbeat nothing,
#                  release nothing: the app owns and releases it.
#       open       the disk would not take the lock (fail open, like the JS side): proceed, never release
#       skipped    another holder stayed fresh for the whole bounded wait: ONE log line, and the caller exits 0
#   Heartbeat-NightlyLock   rewrites startedAt in this run's own lock (so the 15 minute ceiling never drops a lock under a slow step)
#   Release-NightlyLock     removes the lock only when it is this run's own (by 'nightly' and this pid); safe to call always
#
# Lock shape (identical to dashboard/refresh-lock.js): {"pid":<int>,"by":"nightly","startedAt":"<ISO, UTC, ms>"}, created with
# CreateNew (the JS flag wx). STALE = pid gone, or 15 minutes old or older, or startedAt more than 60 s in the future; an empty or
# unparsable file is fresh for 5 s and then stale. A stale lock is reclaimed under a short-lived .refresh.lock.reclaim gate file
# (CreateNew, 10 s ceiling), looked at again inside, never replaced when fresh by then.
#
# Environment (tests set them; the nightly uses the defaults):
#   HQ_NIGHTLY_LOCK_WAIT_S  total seconds to wait for a fresh foreign holder (default 600; 0 = one attempt, no wait)
#   HQ_NIGHTLY_LOCK_POLL_S  seconds between attempts (default 15)
# Never throws out of these functions.

$script:NightlyLockHome   = $PSScriptRoot
$script:NightlyLockState  = 'none'
$script:NightlyLockFile   = $null
$script:NightlyHolders    = @('app', 'mcp', 'nightly')
$script:NightlyStaleMs    = 15 * 60 * 1000

function Get-NightlyStamp {
  [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-NightlyEnvNumber([string]$Name, [double]$Default) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  $n = 0.0
  if ($v -and [double]::TryParse($v, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$n) -and $n -ge 0) { return $n }
  return $Default
}

# NOTE: the sink parameter must not be named $Log. PowerShell variables are case-insensitive and dynamically scoped, so a parameter called
# $Log would shadow run-pipeline.ps1's own $log (the log file path) while the caller's Log function runs, and that function would lose its file.
function Write-NightlyLog($Sink, [string]$Message) {
  try {
    if ($Sink) { & $Sink $Message | ForEach-Object { Write-Host $_ } }
    else { Write-Host ("[{0}] {1}" -f (Get-NightlyStamp), $Message) }
  } catch { }
}

function Test-NightlyPidAlive($PidValue) {
  try {
    $p = [int64]$PidValue
    if ($p -le 0) { return $false }
    return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue)
  } catch { return $false }
}

# @{ Rec; Fresh; AgeMs; Missing; Torn }  - never throws, never reclaims
function Read-NightlyLock([string]$File) {
  $raw = $null; $mtime = $null
  try { $raw = [IO.File]::ReadAllText($File); $mtime = [IO.File]::GetLastWriteTimeUtc($File) }
  catch [IO.FileNotFoundException]      { return @{ Rec = $null; Fresh = $false; Missing = $true } }
  catch [IO.DirectoryNotFoundException] { return @{ Rec = $null; Fresh = $false; Missing = $true } }
  catch                                 { return @{ Rec = $null; Fresh = $false; Missing = $false; Error = $true } }
  $rec = $null
  try { $rec = $raw | ConvertFrom-Json -ErrorAction Stop } catch { $rec = $null }
  $by = $null
  if ($rec -and $rec.PSObject.Properties['by']) { $by = [string]$rec.by }
  if (-not $rec -or -not ($script:NightlyHolders -contains $by)) {
    # empty or half-written: another process may sit between its create and its write - fresh for 5 s, stale after
    $fresh = (([DateTime]::UtcNow - $mtime).TotalMilliseconds -lt 5000)
    return @{ Rec = $null; Fresh = $fresh; Missing = $false; Torn = $true }
  }
  $age = [double]::PositiveInfinity
  try {
    $started = $rec.startedAt
    if ($started -is [DateTime]) { $started = $started.ToUniversalTime() }
    else { $started = [DateTime]::Parse([string]$started, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) }
    $age = ([DateTime]::UtcNow - $started).TotalMilliseconds
  } catch { $age = [double]::PositiveInfinity }
  $fresh = ($age -lt $script:NightlyStaleMs) -and ($age -gt -60000) -and (Test-NightlyPidAlive $rec.pid)
  return @{ Rec = $rec; Fresh = $fresh; AgeMs = $age }
}

function New-NightlyBody([int64]$PidValue) {
  '{"pid":' + $PidValue + ',"by":"nightly","startedAt":"' + (Get-NightlyStamp) + '"}'
}

function Write-NightlyNew([string]$File, [string]$Body) {
  # CreateNew = the JS flag wx. Throws IOException when the file exists.
  $fs = New-Object IO.FileStream($File, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try { $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Body); $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
}

# 'taken' | 'busy' | 'open'
function Invoke-NightlyReclaim([string]$File, [string]$Body) {
  $gate = $File + '.reclaim'
  $have = $false
  for ($attempt = 0; $attempt -lt 2 -and -not $have; $attempt++) {
    try { Write-NightlyNew $gate ([string]$PID); $have = $true }
    catch [IO.IOException] {
      if (-not (Test-Path -LiteralPath $gate)) { return 'open' }
      $age = $null
      try { $age = ([DateTime]::UtcNow - [IO.File]::GetLastWriteTimeUtc($gate)).TotalMilliseconds } catch { continue }
      if ($age -lt 10000 -and $age -gt -10000) { return 'busy' }          # another taker is reclaiming right now
      try { [IO.File]::Delete($gate) } catch { }   # a crashed reclaimer's leftover
    }
    catch { return 'open' }
  }
  if (-not $have) { return 'busy' }
  try {
    if ((Read-NightlyLock $File).Fresh) { return 'busy' }                  # the faster taker's live lock is left alone
    try { [IO.File]::Delete($File) } catch { }
    try { Write-NightlyNew $File $Body; return 'taken' }
    catch [IO.IOException] { if (Test-Path -LiteralPath $File) { return 'busy' } else { return 'open' } }
    catch { return 'open' }
  } finally { try { [IO.File]::Delete($gate) } catch { } }
}

function Invoke-NightlyTake([string]$File) {
  try {
    [void][IO.Directory]::CreateDirectory((Split-Path $File -Parent))
    $body = New-NightlyBody $PID
    try { Write-NightlyNew $File $body; return 'taken' }
    catch [IO.IOException] {
      if (-not (Test-Path -LiteralPath $File)) { return 'open' }          # not "already there": the disk will not take it, fail open
      if ((Read-NightlyLock $File).Fresh) { return 'busy' }
      return (Invoke-NightlyReclaim $File $body)
    }
  } catch { return 'open' }
}

# True when the fresh lock is the app's own and its pid is this PowerShell's parent or one of the next two ancestors.
function Test-NightlyInherited([string]$File) {
  try {
    $s = Read-NightlyLock $File
    if (-not $s.Rec -or -not $s.Fresh -or $s.Rec.by -ne 'app') { return $false }
    $holder = [int64]$s.Rec.pid
    $p = [int64]$PID
    for ($hop = 0; $hop -lt 3; $hop++) {
      $row = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction Stop
      $parent = [int64]$row.ParentProcessId
      if ($parent -le 0) { return $false }
      if ($parent -eq $holder) { return $true }
      $p = $parent
    }
    return $false
  } catch { return $false }
}

function Take-NightlyLock {
  param([string]$DataDir, [Alias('Log')][scriptblock]$LogSink)
  $script:NightlyLockState = 'none'
  try {
    if (-not $DataDir) { $DataDir = Join-Path (Split-Path $script:NightlyLockHome -Parent) 'data' }
    $file = Join-Path $DataDir '.refresh.lock'
    $script:NightlyLockFile = $file
    $waitS = Get-NightlyEnvNumber 'HQ_NIGHTLY_LOCK_WAIT_S' 600
    $pollS = Get-NightlyEnvNumber 'HQ_NIGHTLY_LOCK_POLL_S' 15
    if ($pollS -lt 0.05) { $pollS = 0.05 }
    $deadline = [DateTime]::UtcNow.AddSeconds($waitS)
    while ($true) {
      if (Test-NightlyInherited $file) { $script:NightlyLockState = 'inherited'; return 'inherited' }
      $r = Invoke-NightlyTake $file
      if ($r -eq 'taken') { $script:NightlyLockState = 'taken'; return 'taken' }
      if ($r -eq 'open')  { $script:NightlyLockState = 'open';  return 'open' }
      $remainingMs = ($deadline - [DateTime]::UtcNow).TotalMilliseconds
      if ($remainingMs -le 0) {
        $by = 'unknown'; $since = 'unknown'
        $s = Read-NightlyLock $file
        if ($s.Rec) { $by = [string]$s.Rec.by; $since = [string]$s.Rec.startedAt }
        Write-NightlyLog $LogSink "skipped: refresh lock held by $by since $since"
        $script:NightlyLockState = 'skipped'
        return 'skipped'
      }
      Start-Sleep -Milliseconds ([int][Math]::Min($pollS * 1000, $remainingMs))
    }
  } catch { $script:NightlyLockState = 'open'; return 'open' }
}

function Get-OwnNightlyLock {
  if ($script:NightlyLockState -ne 'taken' -or -not $script:NightlyLockFile) { return $null }
  $s = Read-NightlyLock $script:NightlyLockFile
  if (-not $s.Rec -or $s.Rec.by -ne 'nightly' -or [int64]$s.Rec.pid -ne [int64]$PID) { return $null }
  return $s
}

function Heartbeat-NightlyLock {
  $tmp = $null
  try {
    if (-not (Get-OwnNightlyLock)) { return }
    $tmp = "$($script:NightlyLockFile).tmp-$PID"
    [IO.File]::WriteAllText($tmp, (New-NightlyBody $PID), (New-Object Text.UTF8Encoding($false)))
    [IO.File]::Replace($tmp, $script:NightlyLockFile, [NullString]::Value)
    $tmp = $null
  } catch { }
  finally { if ($tmp) { try { [IO.File]::Delete($tmp) } catch { } } }
}

function Release-NightlyLock {
  try {
    if (-not (Get-OwnNightlyLock)) { return }
    [IO.File]::Delete($script:NightlyLockFile)
  } catch { }
  finally { if ($script:NightlyLockState -eq 'taken') { $script:NightlyLockState = 'released' } }
}
