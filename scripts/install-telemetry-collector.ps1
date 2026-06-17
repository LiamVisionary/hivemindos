<#
.SYNOPSIS
  Windows installer for the HivemindOS agent telemetry collector — the local
  agent bridge a machine needs to host agents and appear "ready" in the Fleet.

.DESCRIPTION
  The macOS/Linux installer (install-telemetry-collector.sh) registers the
  collector as a launchd/systemd service. This is the Windows analog, scoped to
  the local collector: it picks a free port, writes ~/.hivemindos/collector.env,
  drops a launcher, registers a per-user logon Scheduled Task that runs the
  collector hidden and restarts it on crash (the Task Scheduler analog of
  systemd Restart=always / launchd KeepAlive), starts it now, and verifies
  /health. It needs no admin rights (per-user task, interactive logon).

  Idempotent: re-running re-registers the task with -Force.

.NOTES
  The collector script itself is confirmed to run on Windows (CI smoke). This
  only handles install + autostart. Tailscale / Hivemind Link wiring is NOT set
  up here (local-only collector); that stays a follow-up.
#>
param(
  # Preferred collector port; 0 = auto (env AGENT_TELEMETRY_PORT or 8787), then
  # scan upward for the first free port (mirrors the Unix port picker).
  [int]$Port = 0,
  # Repo root that contains scripts/agent-telemetry-collector.mjs. Defaults to
  # the parent of this script's folder.
  [string]$RepoRoot = "",
  # Skip the post-install Start + /health check (used by callers that start it
  # themselves or run headless).
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot -or $RepoRoot -eq "") {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$collectorScript = Join-Path $RepoRoot "scripts\agent-telemetry-collector.mjs"
if (-not (Test-Path $collectorScript)) {
  throw "Collector script not found at $collectorScript (pass -RepoRoot)."
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "Node.js was not found on PATH; install Node 20+ and rerun." }
$nodeExe = $nodeCmd.Source

# --- pick a free port (default 8787, scan 24 ports up, like the Unix picker) ---
function Test-PortFree([int]$p) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

if ($Port -le 0) {
  if ($env:AGENT_TELEMETRY_PORT) { $Port = [int]$env:AGENT_TELEMETRY_PORT } else { $Port = 8787 }
}
$chosenPort = 0
for ($p = $Port; $p -le ($Port + 23); $p++) {
  if (Test-PortFree $p) { $chosenPort = $p; break }
}
if ($chosenPort -eq 0) {
  throw "No free collector port found in range $Port..$($Port + 23). Stop the process using it or pass -Port."
}
$Port = $chosenPort

# --- paths ---
$hiveDir = Join-Path $env:USERPROFILE ".hivemindos"
New-Item -ItemType Directory -Force -Path $hiveDir | Out-Null
$envFile  = Join-Path $hiveDir "collector.env"
$cmdFile  = Join-Path $hiveDir "run-collector.cmd"
$vbsFile  = Join-Path $hiveDir "run-collector-hidden.vbs"

# --- collector.env (read by the dashboard/native bridge to find the port) ---
Set-Content -Path $envFile -Encoding ASCII -Value @(
  "AGENT_TELEMETRY_PORT=$Port",
  "HIVE_COLLECTOR_ONLY=false"
)

# --- launcher .cmd: set env, then run node (cmd /c waits, so a crash propagates) ---
Set-Content -Path $cmdFile -Encoding ASCII -Value @(
  "@echo off",
  "set AGENT_TELEMETRY_PORT=$Port",
  "set AGENT_TELEMETRY_HOST=0.0.0.0",
  "`"$nodeExe`" `"$collectorScript`""
)

# --- hidden VBS wrapper: runs the .cmd with no console window, WAITS for it
#     (bWaitOnReturn=True) so the Scheduled Task action stays alive as long as
#     the collector runs — that lets restart-on-failure fire when it crashes. ---
$vbsContent = @"
Dim shell, code
Set shell = CreateObject("WScript.Shell")
code = shell.Run("cmd /c ""$cmdFile""", 0, True)
WScript.Quit(code)
"@
Set-Content -Path $vbsFile -Encoding ASCII -Value $vbsContent

# --- register the per-user logon Scheduled Task (hidden, restart on crash) ---
$taskName = "HivemindOS Telemetry Collector"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsFile`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
# Build the principal from the canonical, resolvable account name
# ("MACHINE\User" or the domain form). Do NOT use "$env:USERDOMAIN\$env:USERNAME":
# on a workgroup PC USERDOMAIN is "WORKGROUP" (and Microsoft-account logins are
# similar), so that string fails to map to a SID and Register-ScheduledTask dies
# with ERROR_NONE_MAPPED (0x80070534) -- which silently left Windows machines
# with no collector. S4U (vs Interactive) lets the task start on demand and at
# logon without requiring an interactive session, so the collector comes up
# right after setup and survives logon. Verified on a real Windows box.
$principalUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description "Runs the HivemindOS agent telemetry collector (local agent bridge)." -Force | Out-Null

Write-Host "Registered Scheduled Task '$taskName' (runs at logon, restarts on crash)."
Write-Host "Collector port: $Port  ->  $envFile"

if ($NoStart) {
  Write-Host "Skipping start (-NoStart). It will start at next logon."
  return
}

# --- start now + verify /health ---
try { Start-ScheduledTask -TaskName $taskName } catch {
  Write-Warning "Could not start the task immediately ($_); it will start at next logon."
}

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/health"
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}

if ($ok) {
  Write-Host "HivemindOS collector running: http://localhost:$Port"
} else {
  Write-Warning "Collector task installed but /health did not respond on port $Port yet. It should come up at logon; check Task Scheduler -> '$taskName'."
}
