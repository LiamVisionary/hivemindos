<#
.SYNOPSIS
  Hands a HivemindOS update command to its own one-shot Scheduled Task
  ("HivemindOS Update") and starts it. Launched by the collector's POST /update
  (see scripts/lib/collector-update-launcher.mjs).

.DESCRIPTION
  The update cannot run as a plain child of the collector, for two reasons
  validated on a real Windows Server box:
  - Windows PowerShell's console host exits immediately WITHOUT executing when
    spawned with DETACHED_PROCESS (Node's `detached: true`), so a detached
    spawn silently no-ops.
  - A non-detached child inherits the collector task's Job object, and the
    update restarts that task — Task Scheduler would kill the update mid-run
    the moment it stops the collector.
  Registering a separate task gives the update its own job and a proper task
  host, so it survives the collector restart it performs. The task is
  registered fresh (-Force) on every update and left in place for Task
  Scheduler's last-run visibility; uninstall.ps1 removes it.

  The command arrives base64-encoded (UTF-16LE, PowerShell's -EncodedCommand
  format) so no quoting survives three hops of cmd/PowerShell parsing.
#>
param(
  [Parameter(Mandatory = $true)][string]$EncodedTaskCommand,
  [string]$TaskName = "HivemindOS Update"
)

$ErrorActionPreference = "Stop"

# Fail fast on a mangled payload — a nonzero exit here tells the collector's
# launcher to release its maintenance reservation.
[void][Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($EncodedTaskCommand))

$taskArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $EncodedTaskCommand"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArguments
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$description = "Runs a HivemindOS update outside the collector task's job so the update survives the collector restart it performs."

# S4U first, Interactive fallback — same reasoning as the canonical
# Register-HivemindScheduledTask in scripts/install-telemetry-collector.ps1
# (S4U starts durably from headless sessions; some non-elevated desktop users
# get "Access is denied" from S4U registration).
$principalUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$registered = $false
foreach ($logonType in @("S4U", "Interactive")) {
  try {
    $principal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType $logonType -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Settings $settings `
      -Principal $principal -Description $description -Force | Out-Null
    $registered = $true
    break
  } catch {
    Write-Warning "Scheduled Task '$TaskName' registration as $logonType failed: $($_.Exception.Message)"
  }
}

if (-not $registered) {
  # No Task Scheduler access (rare standard-user installs fall back to the
  # Startup-folder launcher, which runs outside any job): run the update as a
  # plain hidden child instead. Outside a job this survives the collector's
  # exit; inside one it is best effort.
  Start-Process -FilePath "powershell.exe" -ArgumentList $taskArguments -WindowStyle Hidden | Out-Null
  Write-Host "Task Scheduler unavailable; started the update as a hidden process instead."
  exit 0
}

Start-ScheduledTask -TaskName $TaskName
Write-Host "Update started under Scheduled Task '$TaskName'."
