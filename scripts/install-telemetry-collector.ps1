<#
.SYNOPSIS
  Windows installer for the HivemindOS agent telemetry collector — the local
  agent bridge a machine needs to host agents and appear "ready" in the Fleet.
  Optionally also installs the Hivemind Link tsnet sidecar (hivemind-linkd).

.DESCRIPTION
  The macOS/Linux installer (install-telemetry-collector.sh) registers the
  collector as a launchd/systemd service. This is the Windows analog, scoped to
  the local collector: it picks a free port, writes ~/.hivemindos/collector.env,
  drops a launcher, registers a per-user logon Scheduled Task that runs the
  collector hidden, starts it now, and verifies /health. It needs no admin
  rights (per-user task, interactive logon).

  When Hivemind Link is enabled (HIVE_LINK_ENABLED=true, -EnableLink, or sticky
  via an existing HIVE_LINK_CONTROL line in collector.env), it also builds
  cmd/hivemind-linkd with Go, registers a second Scheduled Task ("HivemindOS
  Link"), and verifies the link control /health — mirroring the Unix
  installer's HIVE_LINK_* wiring. First-run Tailscale sign-in needs a human
  (or a HIVE_LINK_AUTH_KEY), so a pending sign-in never fails the install.

  Idempotent: re-running re-registers the tasks with -Force.

.NOTES
  The collector script itself is confirmed to run on Windows (CI smoke).
  hivemind-linkd cross-compiles for Windows; its remote-shell feature is
  auto-disabled on Windows by the daemon itself (proxy + file receive +
  health/version all work).
#>
param(
  # Preferred collector port; 0 = auto (env AGENT_TELEMETRY_PORT or 8787), then
  # scan upward for the first free port (mirrors the Unix port picker).
  [int]$Port = 0,
  # Repo root that contains scripts/agent-telemetry-collector.mjs. Defaults to
  # the parent of this script's folder.
  [string]$RepoRoot = "",
  # Ready-to-run runtime paths supplied by the downloadable Link GUI. Empty
  # values preserve the source-install behavior for Advanced setup users.
  [string]$NodePath = "",
  [string]$CollectorScript = "",
  [string]$PrebuiltLinkBinary = "",
  # Skip the post-install Start + /health check (used by callers that start it
  # themselves or run headless).
  [switch]$NoStart,
  # Install the Hivemind Link tsnet sidecar (Windows analog of running the Unix
  # installer with HIVE_LINK_ENABLED=true). Also enabled by collector-only
  # mode, $env:HIVE_LINK_ENABLED = "true", or sticky collector.env state.
  [switch]$EnableLink,
  # Persist this machine as an agent-bridge-only node. A later installer run
  # keeps the mode until -Full is passed.
  [switch]$CollectorOnly,
  [switch]$Full
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot -or $RepoRoot -eq "") {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}
if (-not $CollectorScript) {
  $CollectorScript = Join-Path $RepoRoot "scripts\agent-telemetry-collector.mjs"
}
if (-not (Test-Path -LiteralPath $CollectorScript -PathType Leaf)) {
  throw "Collector script not found at $CollectorScript (pass -RepoRoot or -CollectorScript)."
}

if ($NodePath) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Bundled Node executable not found at $NodePath."
  }
  $nodeExe = (Resolve-Path -LiteralPath $NodePath).Path
} else {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { throw "Node.js was not found on PATH; install Node 20+ and rerun." }
  $nodeExe = $nodeCmd.Source
}

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
$launcherFile = Join-Path $hiveDir "run-collector-hidden.ps1"
$legacyVbsFile = Join-Path $hiveDir "run-collector-hidden.vbs"

if ($CollectorOnly -and $Full) {
  throw "Choose either -CollectorOnly or -Full, not both."
}
$collectorOnlyMode = $false
if ($CollectorOnly) {
  $collectorOnlyMode = $true
} elseif (-not $Full) {
  if ($env:HIVE_COLLECTOR_ONLY -match '^(1|true|yes)$') {
    $collectorOnlyMode = $true
  } elseif (Test-Path $envFile) {
    $collectorOnlyMode = [bool](Select-String -Path $envFile -Pattern '^HIVE_COLLECTOR_ONLY=(1|true|yes)$' -Quiet)
  }
}
$collectorOnlyValue = $collectorOnlyMode.ToString().ToLowerInvariant()

# --- Hivemind Link (optional): embedded tsnet Tailscale sidecar -------------
# Windows analog of the Unix installer's HIVE_LINK_* wiring. Collector-only
# mode defaults to Link; -EnableLink, HIVE_LINK_ENABLED, HIVE_NETWORK_MODE, and
# sticky HIVE_LINK_CONTROL state provide explicit and repeat-run control. An
# explicit HIVE_LINK_ENABLED beats stickiness, mirroring Unix precedence.
$linkTaskName = "HivemindOS Link"
$linkBinDir   = Join-Path $hiveDir "bin"
$linkBin      = Join-Path $linkBinDir "hivemind-linkd.exe"
$linkDir      = Join-Path $hiveDir "link"
$linkStateDir = Join-Path $linkDir "default"
$linkLogFile  = Join-Path $linkDir "hivemind-linkd.err.log"
$linkCmdFile  = Join-Path $hiveDir "run-linkd.cmd"
$linkLauncherFile = Join-Path $hiveDir "run-linkd-hidden.ps1"
$linkLegacyVbsFile = Join-Path $hiveDir "run-linkd-hidden.vbs"
# The Tailnet listen port stays PINNED (default 8787) by design: linkd's
# listener lives inside its own tsnet userspace netstack and binds no host
# port, so a local process on the same port NUMBER can never collide with it,
# and peers (fleet discovery, hive-env sync, the watchdog) find every machine
# at a predictable address. Do not add drift logic; override only via
# HIVE_LINK_TAILNET_PORT (mirrors choose_link_tailnet_port in the .sh).
$linkTailnetPort = 8787
if ($env:HIVE_LINK_TAILNET_PORT) { $linkTailnetPort = [int]$env:HIVE_LINK_TAILNET_PORT }

$linkRequested = $false
if ($EnableLink) {
  $linkRequested = $true
} elseif ($env:HIVE_LINK_ENABLED) {
  $linkRequested = ($env:HIVE_LINK_ENABLED -eq "true")
} elseif ($env:HIVE_NETWORK_MODE) {
  $linkRequested = ($env:HIVE_NETWORK_MODE -eq "link")
} elseif ((Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^HIVE_LINK_CONTROL=' -Quiet)) {
  $linkRequested = $true
} elseif ($collectorOnlyMode) {
  $linkRequested = $true
}

function Refresh-HivemindInstallerPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

function Resolve-HivemindGoCommand {
  Refresh-HivemindInstallerPath
  $command = Get-Command go -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "Go\bin\go.exe") }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Go\bin\go.exe") }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Ensure-HivemindLinkGo {
  $goPath = Resolve-HivemindGoCommand
  if ($goPath) { return $goPath }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Hivemind Link requires Go. Install it with 'winget install --id GoLang.Go --exact', then rerun collector setup."
  }
  Write-Host "Installing Go for Hivemind Link..."
  winget install --id GoLang.Go --exact --accept-package-agreements --accept-source-agreements | Out-Host
  $goPath = Resolve-HivemindGoCommand
  if (-not $goPath) {
    throw "Hivemind Link requires Go, but Go was not available after winget setup. Reopen PowerShell and rerun collector setup."
  }
  return $goPath
}

# Control API address: env wins, then the sticky collector.env value, then the
# canonical default (the Unix installer's resolution order).
$linkControl = "127.0.0.1:8788"
if ($env:HIVE_LINK_CONTROL) {
  $linkControl = $env:HIVE_LINK_CONTROL
} elseif (Test-Path $envFile) {
  $existingControl = Select-String -Path $envFile -Pattern '^HIVE_LINK_CONTROL=(.+)$' | Select-Object -First 1
  if ($existingControl) {
    $existingControlValue = $existingControl.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    if ($existingControlValue) { $linkControl = $existingControlValue }
  }
}

$linkActive = $false
if ($linkRequested) {
  # Stop only the HivemindOS-owned task/process before replacing its binary.
  try { Stop-ScheduledTask -TaskName $linkTaskName -ErrorAction SilentlyContinue } catch {}
  Get-Process hivemind-linkd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  New-Item -ItemType Directory -Force -Path $linkBinDir | Out-Null

  if ($PrebuiltLinkBinary) {
    if (-not (Test-Path -LiteralPath $PrebuiltLinkBinary -PathType Leaf)) {
      throw "Bundled Hivemind Link binary not found at $PrebuiltLinkBinary."
    }
    Write-Host "Installing bundled Hivemind Link sidecar..."
    Copy-Item -LiteralPath $PrebuiltLinkBinary -Destination $linkBin -Force
    try { Unblock-File -LiteralPath $linkBin -ErrorAction SilentlyContinue } catch {}
    $linkActive = Test-Path -LiteralPath $linkBin -PathType Leaf
  } else {
    $goPath = Ensure-HivemindLinkGo
    $linkSource = Join-Path $RepoRoot "cmd\hivemind-linkd\main.go"
    if (-not (Test-Path $linkSource)) {
      throw "Hivemind Link source is missing at $linkSource. Update the HivemindOS checkout and rerun collector setup."
    }
    # Stamp the build so /version and /_hivemind/version can expose stale
    # daemons (mirrors scripts/build-hivemind-linkd.sh). git can be absent on
    # Windows (setup is git-free); "unknown" matches the Unix fallback.
    $buildCommit = "unknown"
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
      try {
        $sha = & $gitCmd.Source -C $RepoRoot rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $sha) { $buildCommit = "$sha".Trim() }
      } catch {}
    }
    $buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "Building hivemind-linkd.exe (commit $buildCommit)..."
    Push-Location $RepoRoot
    try {
      & $goPath build -ldflags "-X main.buildCommit=$buildCommit -X main.buildTime=$buildTime" -o $linkBin ./cmd/hivemind-linkd
      $goExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($goExit -eq 0 -and (Test-Path $linkBin)) {
      $linkActive = $true
    } else {
      throw "Hivemind Link build failed (go build exit code $goExit). The collector was not exposed on a less-protected fallback network."
    }
  }
}

if ($linkActive) {
  # Control port: our own daemon was stopped above, so a live listener here is
  # a foreign process — scan upward for the nearest free port (mirrors
  # choose_link_control_port in the .sh; never kill the owning process).
  $controlParts = $linkControl -split ":"
  if ($controlParts.Count -ne 2 -or -not ($controlParts[1] -match '^\d+$')) {
    Write-Warning "Invalid HIVE_LINK_CONTROL value '$linkControl' (use host:port); using 127.0.0.1:8788."
    $linkControl = "127.0.0.1:8788"
    $controlParts = @("127.0.0.1", "8788")
  }
  $controlHost = $controlParts[0]
  $controlPort = [int]$controlParts[1]
  if (-not (Test-PortFree $controlPort)) {
    $newControlPort = 0
    for ($p = $controlPort + 1; $p -le ($controlPort + 200); $p++) {
      if ($p -eq $Port) { continue }
      if (Test-PortFree $p) { $newControlPort = $p; break }
    }
    if ($newControlPort -eq 0) {
      Write-Warning "Port $controlPort is used by another local service and no nearby Hivemind Link control port was free; skipping the Link sidecar. Set HIVE_LINK_CONTROL to a free host:port and rerun."
      $linkActive = $false
    } else {
      Write-Host "Port $controlPort is already used by another local service, so Hivemind Link will run its control API on the next available port: ${controlHost}:$newControlPort."
      $controlPort = $newControlPort
      $linkControl = "${controlHost}:$controlPort"
    }
  }
}

# --- collector.env (read by the dashboard/native bridge to find the port; the
#     HIVE_LINK_* block also makes Link sticky for future installer reruns) ---
$collectorEnvLines = @(
  "AGENT_TELEMETRY_PORT=$Port",
  "HIVE_COLLECTOR_ONLY=$collectorOnlyValue"
)
if ($linkRequested) {
  # Written on "requested", not "built", so stickiness survives a transient
  # build failure (Go missing on one rerun must not silently disable Link
  # forever) — the Unix installer keeps its sticky marker the same way. An
  # explicit HIVE_LINK_ENABLED=false run drops the block and clears the sticky.
  # Mirrors the Unix installer's link block. The two path values are
  # double-quoted on purpose: every collector.env reader (hivemind-link-
  # control.ts, fleet-health-watchdog.mjs, src-tauri fleet.rs/setup.rs) strips
  # wrapping quotes, while hivemind-link-control.ts backslash-UNESCAPES
  # unquoted values, which would mangle C:\ paths.
  $collectorEnvLines += @(
    "HIVE_TAILNET_COLLECTOR_PORT=$linkTailnetPort",
    "HIVE_LINK_TAILNET_PORT=$linkTailnetPort",
    "HIVE_LINK_CONTROL=$linkControl",
    "HIVE_LINK_CONTROL_URL=http://$linkControl",
    "HIVE_LINK_STATE_DIR=`"$linkStateDir`"",
    "HIVE_LINK_LOG_FILE=`"$linkLogFile`""
  )
}
Set-Content -Path $envFile -Encoding ASCII -Value $collectorEnvLines

# --- launcher .cmd: set env, then run node (cmd /c waits, so a crash propagates) ---
# Loopback-only when Hivemind Link fronts the collector (remote traffic comes
# in through linkd's Tailnet listener), matching the Unix installer.
if ($linkActive) { $collectorHost = "127.0.0.1" } else { $collectorHost = "0.0.0.0" }
Set-Content -Path $cmdFile -Encoding ASCII -Value @(
  "@echo off",
  "set AGENT_TELEMETRY_PORT=$Port",
  "set AGENT_TELEMETRY_HOST=$collectorHost",
  "set HIVE_COLLECTOR_ONLY=$collectorOnlyValue",
  "set HIVEMINDOS_APP_DIR=$RepoRoot",
  "`"$nodeExe`" `"$CollectorScript`""
)

# Keep a hidden supervisor alive for as long as the service command runs. The
# old VBS launcher used WScript.Shell.Run(..., True), which can fail on desktop
# Windows with 80020009 "Unable to wait for process" and show a blocking Script
# Host dialog. A .NET Process handle keeps the task action attached and preserves
# the child exit code without Windows Script Host's synchronous wait path.
function Write-HivemindProcessSupervisor {
  param(
    [string]$Path,
    [string]$CommandFile
  )

  $escapedCommandFile = $CommandFile.Replace("'", "''")
  $supervisorContent = @"
`$ErrorActionPreference = "Stop"
try {
  `$startInfo = New-Object System.Diagnostics.ProcessStartInfo
  `$startInfo.FileName = `$env:ComSpec
  `$startInfo.Arguments = '/d /s /c ""$escapedCommandFile""'
  `$startInfo.UseShellExecute = `$false
  `$startInfo.CreateNoWindow = `$true
  `$process = [System.Diagnostics.Process]::Start(`$startInfo)
  if (-not `$process) { throw "Windows did not return a process handle." }
  `$process.WaitForExit()
  exit `$process.ExitCode
} catch {
  [Console]::Error.WriteLine("HivemindOS launcher failed: " + `$_.Exception.Message)
  exit 1
}
"@
  Set-Content -Path $Path -Encoding UTF8 -Value $supervisorContent
}

Write-HivemindProcessSupervisor -Path $launcherFile -CommandFile $cmdFile
Remove-Item $legacyVbsFile -Force -ErrorAction SilentlyContinue

# --- register the per-user logon launcher (Task Scheduler when allowed,
#     Startup folder fallback when a standard user cannot access the scheduler) ---
$taskName = "HivemindOS Telemetry Collector"
# Build the principal from the canonical, resolvable account name
# ("MACHINE\User" or the domain form). Do NOT use "$env:USERDOMAIN\$env:USERNAME":
# on a workgroup PC USERDOMAIN is "WORKGROUP" (and Microsoft-account logins are
# similar), so that string fails to map to a SID and Register-ScheduledTask dies
# with ERROR_NONE_MAPPED (0x80070534) -- which silently left Windows machines
# with no collector.
#
# Prefer S4U when Windows allows it so a setup/repair run can start the task
# durably right away, even from a headless session. Fall back to Interactive for
# normal, non-elevated desktop users where S4U registration can return
# "Access is denied"; the direct hidden launch below covers the current session.
$principalUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
function Register-HivemindScheduledTask {
  param(
    [string]$Name,
    $Action,
    $Trigger,
    $Settings,
    [string]$Description,
    [switch]$RequireInteractive
  )

  $interactivePrincipal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType Interactive -RunLevel Limited
  if ($RequireInteractive) {
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger `
      -Settings $Settings -Principal $interactivePrincipal -Description $Description -Force | Out-Null
    return "Interactive"
  }

  $s4uPrincipal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType S4U -RunLevel Limited
  try {
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger `
      -Settings $Settings -Principal $s4uPrincipal -Description $Description -Force | Out-Null
    return "S4U"
  } catch {
    $s4uError = $_
    try {
      Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger `
        -Settings $Settings -Principal $interactivePrincipal -Description $Description -Force | Out-Null
      Write-Warning "Scheduled Task '$Name' used Interactive fallback after S4U registration failed: $($s4uError.Exception.Message)"
      return "Interactive"
    } catch {
      throw "Could not register Scheduled Task '$Name' for $principalUser. S4U registration failed: $($s4uError.Exception.Message). Interactive fallback failed: $($_.Exception.Message)"
    }
  }
}

function Get-HivemindStartupFolder {
  $startupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
  if (-not $startupFolder) {
    $startupFolder = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  }
  New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
  return $startupFolder
}

function Register-HivemindStartupLauncher {
  param(
    [string]$Name,
    [string]$LauncherPath
  )

  $safeName = $Name -replace '[\\/:*?"<>|]', '-'
  $startupLauncher = Join-Path (Get-HivemindStartupFolder) "$safeName.vbs"
  $escapedLauncherPath = $LauncherPath.Replace('"', '""')
  $startupContent = @"
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$escapedLauncherPath""", 0, False
"@
  Set-Content -Path $startupLauncher -Encoding ASCII -Value $startupContent
  return $startupLauncher
}

function Remove-HivemindStartupLauncher {
  param([string]$Name)

  $safeName = $Name -replace '[\\/:*?"<>|]', '-'
  $startupLauncher = Join-Path (Get-HivemindStartupFolder) "$safeName.vbs"
  Remove-Item $startupLauncher -Force -ErrorAction SilentlyContinue
}

function Register-HivemindLogonLauncher {
  param(
    [string]$Name,
    [string]$LauncherPath,
    [string]$Description,
    [switch]$RequireInteractive
  )

  try {
    $taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherPath`""
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn
    $taskSettings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero)

    $taskLogonType = Register-HivemindScheduledTask `
      -Name $Name `
      -Action $taskAction `
      -Trigger $taskTrigger `
      -Settings $taskSettings `
      -Description $Description `
      -RequireInteractive:$RequireInteractive

    Remove-HivemindStartupLauncher -Name $Name
    Write-Host "Registered Scheduled Task '$Name' (logon type: $taskLogonType; runs at logon)."
    return [pscustomobject]@{ Kind = "ScheduledTask"; LogonType = $taskLogonType; Path = $null }
  } catch {
    $taskError = $_
    try {
      $startupPath = Register-HivemindStartupLauncher -Name $Name -LauncherPath $LauncherPath
      Write-Warning "Scheduled Task '$Name' could not be registered: $($taskError.Exception.Message)"
      Write-Host "Registered Startup folder launcher '$Name' -> $startupPath"
      return [pscustomobject]@{ Kind = "StartupFolder"; LogonType = "StartupFolder"; Path = $startupPath }
    } catch {
      throw "Could not register '$Name' as a Scheduled Task ($($taskError.Exception.Message)) or Startup folder launcher ($($_.Exception.Message))."
    }
  }
}

function Start-HivemindHiddenLauncher {
  param(
    [string]$Label,
    [string]$LauncherPath
  )

  try {
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherPath`"" -WindowStyle Hidden -PassThru -ErrorAction Stop
    if ($process -and $process.Id) {
      Write-Host "Started $Label launcher (pid $($process.Id))."
    } else {
      Write-Host "Started $Label launcher."
    }
    return $true
  } catch {
    Write-Warning "Could not start the $Label launcher immediately ($_)."
    return $false
  }
}

function Start-HivemindScheduledTaskNow {
  param(
    [string]$Name,
    [int]$TimeoutSeconds = 10
  )

  $process = $null
  try {
    $process = Start-Process -FilePath "schtasks.exe" -ArgumentList "/Run /TN `"$Name`"" -WindowStyle Hidden -PassThru -ErrorAction Stop
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch {}
      Write-Warning "Timed out while asking Scheduled Task '$Name' to start; it will start at next logon."
      return $false
    }
    if ($process.ExitCode -ne 0) {
      Write-Warning "Could not start Scheduled Task '$Name' immediately (schtasks exit code $($process.ExitCode)); it will start at next logon."
      return $false
    }
    return $true
  } catch {
    Write-Warning "Could not start Scheduled Task '$Name' immediately ($_); it will start at next logon."
    return $false
  }
}

function Wait-HivemindCollectorHealth {
  param(
    [int]$Port,
    [int]$Attempts = 30
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/health"
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }

  return $false
}

$collectorRegistration = Register-HivemindLogonLauncher `
  -Name $taskName `
  -LauncherPath $launcherFile `
  -Description "Runs the HivemindOS agent telemetry collector (local agent bridge)."

Write-Host "Collector port: $Port  ->  $envFile"

if ($linkActive) {
  New-Item -ItemType Directory -Force -Path $linkStateDir | Out-Null

  # --- launcher run-linkd.cmd: set env, then run the sidecar (cmd /c waits,
  #     so a crash propagates into the task's recorded exit status). Env
  #     mirrors the Unix service definitions; daemon defaults cover the rest. ---
  Set-Content -Path $linkCmdFile -Encoding ASCII -Value @(
    "@echo off",
    "set HIVE_LINK_TARGET=http://127.0.0.1:$Port",
    "set HIVE_LINK_LISTEN=:$linkTailnetPort",
    "set HIVE_LINK_CONTROL=$linkControl",
    "set HIVE_LINK_STATE_DIR=%USERPROFILE%\.hivemindos\link\default",
    "set HIVE_LINK_LOG_FILE=%USERPROFILE%\.hivemindos\link\hivemind-linkd.err.log",
    "set HIVE_LINK_DISABLE_PORTLIST=true",
    "set HIVE_LINK_EPHEMERAL=false",
    "`"$linkBin`""
  )

  # Same hidden .NET supervisor as the collector so Link also stays attached to
  # Task Scheduler without using WScript.Shell's unreliable synchronous wait.
  Write-HivemindProcessSupervisor -Path $linkLauncherFile -CommandFile $linkCmdFile
  Remove-Item $linkLegacyVbsFile -Force -ErrorAction SilentlyContinue

  # --- register the per-user logon launcher (hidden when Task Scheduler is
  #     available); same canonical identity/logon fallback as
  #     the collector task above — never "$env:USERDOMAIN\$env:USERNAME". ---
  $linkRegistration = Register-HivemindLogonLauncher `
    -Name $linkTaskName `
    -LauncherPath $linkLauncherFile `
    -Description "Runs the HivemindOS Link tsnet sidecar (Tailnet proxy for the local agent bridge)." `
    -RequireInteractive

  Write-Host "Hivemind Link control URL: http://$linkControl/status"
}

if ($NoStart) {
  Write-Host "Skipping start (-NoStart). It will start at next logon."
  return
}

# --- start now + verify /health ---
$startedNow = $false
if ($collectorRegistration.Kind -eq "ScheduledTask" -and $collectorRegistration.LogonType -eq "S4U") {
  $startedNow = Start-HivemindScheduledTaskNow -Name $taskName
  $ok = Wait-HivemindCollectorHealth -Port $Port
  if (-not $ok) {
    $startedNow = Start-HivemindHiddenLauncher -Label "collector" -LauncherPath $launcherFile
    $ok = Wait-HivemindCollectorHealth -Port $Port -Attempts 15
  }
} else {
  $startedNow = Start-HivemindHiddenLauncher -Label "collector" -LauncherPath $launcherFile
  $ok = Wait-HivemindCollectorHealth -Port $Port
}
if (-not $ok -and -not $startedNow -and $collectorRegistration.Kind -eq "ScheduledTask") {
  Start-HivemindScheduledTaskNow -Name $taskName | Out-Null
  $ok = Wait-HivemindCollectorHealth -Port $Port -Attempts 15
}

if ($ok) {
  Write-Host "HivemindOS collector running: http://localhost:$Port"
} else {
  Write-Warning "Collector task installed but /health did not respond on port $Port yet. It should come up at logon; check Task Scheduler -> '$taskName'."
}

if ($linkActive) {
  Write-Host "Starting Hivemind Link..."
  if ($linkRegistration.Kind -eq "ScheduledTask") {
    $linkStartedNow = Start-HivemindScheduledTaskNow -Name $linkTaskName
    if (-not $linkStartedNow) {
      Start-HivemindHiddenLauncher -Label "Hivemind Link" -LauncherPath $linkLauncherFile | Out-Null
    }
  } else {
    $linkStartedNow = Start-HivemindHiddenLauncher -Label "Hivemind Link" -LauncherPath $linkLauncherFile
    if (-not $linkStartedNow) {
      Start-HivemindScheduledTaskNow -Name $linkTaskName | Out-Null
    }
  }

  # Poll the control /health. The daemon serves an honest health: HTTP 200 with
  # ok=false + backendState/authNeeded while the daemon is up but the tailnet
  # is not; no response at all means the daemon itself is down. First-run
  # Tailscale sign-in needs a human, so authNeeded must NOT fail the install.
  $linkHealth = $null
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://$linkControl/health"
      $linkHealth = $r.Content | ConvertFrom-Json
      if ($linkHealth.ok) { break }
      if ($linkHealth.authNeeded -and $linkHealth.authUrl) { break }
    } catch {}
    Start-Sleep -Seconds 1
  }

  if ($linkHealth -and $linkHealth.ok) {
    $connectedName = ""
    try {
      $linkStatus = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://$linkControl/status").Content | ConvertFrom-Json
      if ($linkStatus.self) {
        if ($linkStatus.self.DNSName) { $connectedName = $linkStatus.self.DNSName }
        elseif ($linkStatus.self.HostName) { $connectedName = $linkStatus.self.HostName }
      }
    } catch {}
    if ($connectedName) {
      Write-Host "Hivemind Link connected: $connectedName"
    } else {
      Write-Host "Hivemind Link connected."
    }
  } elseif ($linkHealth -and $linkHealth.authNeeded) {
    $authUrl = $linkHealth.authUrl
    if (-not $authUrl) {
      try {
        $linkStatus = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://$linkControl/status").Content | ConvertFrom-Json
        if ($linkStatus.authUrl) { $authUrl = $linkStatus.authUrl }
      } catch {}
    }
    Write-Host "Hivemind Link authorization is required once for this collector."
    if ($authUrl) {
      Write-Host "1. Open this URL on your main HivemindOS hub, or on any device signed into the same Tailscale account as that hub:"
      Write-Host "  $authUrl"
      try {
        Set-Clipboard -Value $authUrl
        Write-Host "   The URL was copied to this machine's clipboard."
      } catch {
        Write-Host "   Copy the URL manually if this terminal does not provide a clipboard."
      }
      Write-Host "2. Approve this collector in Tailscale."
      Write-Host "3. Return to the Hive Fleet on the main hub. The collector will appear automatically after Link connects."
    } else {
      Write-Host "On this collector, fetch the authorization URL from http://$linkControl/status (authUrl field), then open it on the main HivemindOS hub using the same Tailscale account."
    }
    Write-Host "Headless alternative: set a HIVE_LINK_AUTH_KEY user environment variable (setx HIVE_LINK_AUTH_KEY <tailscale-auth-key>), then restart the '$linkTaskName' task."
  } elseif ($linkHealth) {
    Write-Host "Hivemind Link is still starting (backendState: $($linkHealth.backendState)). Setup can continue; the dashboard will keep checking it."
  } else {
    Write-Warning "Hivemind Link did not answer on http://$linkControl/health yet. It should come up at logon; check Task Scheduler -> '$linkTaskName' and $linkLogFile."
  }
}
