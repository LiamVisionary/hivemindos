<#
.SYNOPSIS
  Windows updater for a HivemindOS checkout — the PowerShell analog of
  scripts/update-hivemindos.sh, launched by the collector's POST /update (see
  scripts/lib/collector-update-command.mjs) or run by hand.

.DESCRIPTION
  Updates the source (git pull when the checkout is a git clone and git is on
  PATH; otherwise the same GitHub main archive the desktop app's setup uses,
  overlaid in place so node_modules and local env files survive), records the
  downloaded source commit in .hivemindos-source-commit so a git-free checkout
  still reports its version to the fleet, refreshes the collector's single npm
  dependency, and restarts the collector by re-running
  scripts/install-telemetry-collector.ps1.

  The dashboard dev server is intentionally not managed here: Windows machines
  run the dashboard as the packaged desktop app, not a dev server. PowerShell
  parses this whole file before executing it, so the archive overlay replacing
  this script mid-run is safe; install-telemetry-collector.ps1 runs AFTER the
  overlay, so the freshly updated installer is the one that runs.
#>
param(
  # Update only the agent bridge (skips the workspace pnpm install). Default
  # follows HIVE_COLLECTOR_ONLY / the sticky collector.env value, like the .sh.
  [switch]$CollectorOnly,
  # Force the full update path even when this machine is marked collector-only.
  [switch]$Full,
  # Do not update the source checkout (git pull / archive overlay).
  [switch]$SkipPull,
  # Do not reinstall/restart the telemetry collector.
  [switch]$SkipCollector
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# An unhandled top-level throw bypasses the launcher's *>> log redirection
# (PowerShell surfaces it through the host, not the redirected streams), which
# leaves a failed update with no trace. Land it in the log, exit nonzero.
trap {
  Write-Host "[update] FAILED: $($_ | Out-String)"
  exit 1
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Update-Info([string]$Message) { Write-Host "[update] $Message" }

# Scheduled-task environments carry a stale PATH; merge in the current
# machine/user PATH so node/npm/pnpm installed after the task registration
# still resolve (same approach as install-telemetry-collector.ps1).
function Update-RefreshPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machinePath, $userPath, $env:Path) -join ";"
}

Update-RefreshPath
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "Node.js was not found on PATH; install Node 20+ and rerun." }

Update-Info "Updating HivemindOS in $Root ($(Get-Date -Format o))"

if ($CollectorOnly -and $Full) {
  throw "Choose either -CollectorOnly or -Full, not both."
}
$hiveEnvFile = Join-Path $env:USERPROFILE ".hivemindos\collector.env"
$collectorOnlyMode = $false
if ($CollectorOnly) {
  $collectorOnlyMode = $true
} elseif (-not $Full) {
  if ($env:HIVE_COLLECTOR_ONLY -match '^(1|true|yes)$') {
    $collectorOnlyMode = $true
  } elseif (Test-Path $hiveEnvFile) {
    $collectorOnlyMode = [bool](Select-String -Path $hiveEnvFile -Pattern '^HIVE_COLLECTOR_ONLY=(1|true|yes)$' -Quiet)
  }
}
if ($collectorOnlyMode) {
  Update-Info "Collector-only machine: updating the agent bridge without the workspace install"
}

# --- update the source checkout ---------------------------------------------
$markerFile = Join-Path $Root ".hivemindos-source-commit"
if ($SkipPull) {
  Update-Info "Skipping source update (-SkipPull)"
} elseif ((Test-Path (Join-Path $Root ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  Update-Info "Pulling latest git changes"
  & $nodeCmd.Source (Join-Path $Root "scripts\pull-with-changelog-preserve.mjs")
  if ($LASTEXITCODE -ne 0) { throw "git pull failed (exit code $LASTEXITCODE)." }
} else {
  # Git-free checkout (the desktop app bootstraps app-source from the GitHub
  # archive): download the same archive and overlay it IN PLACE. Never delete
  # $Root wholesale here — the running collector watches files inside it, and
  # the overlay preserves node_modules plus any local env files.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $sha = ""
  try {
    $shaResponse = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 `
      -Headers @{ Accept = "application/vnd.github.sha"; "User-Agent" = "hivemindos-update" } `
      -Uri "https://api.github.com/repos/LiamVisionary/hivemindos/commits/main"
    $shaContent = $shaResponse.Content
    # Windows PowerShell 5.1 returns byte[] for content types it does not
    # recognize as text (application/vnd.github.sha); PowerShell 7 returns a
    # string. Handle both or .Trim() throws on 5.1.
    if ($shaContent -is [byte[]]) {
      $sha = [Text.Encoding]::ASCII.GetString($shaContent).Trim()
    } else {
      $sha = ("" + $shaContent).Trim()
    }
  } catch {
    Write-Warning "Could not resolve the latest main commit: $($_.Exception.Message)"
  }
  $tmp = Join-Path $env:TEMP ("hm-update-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "src.zip"
    Update-Info "Downloading the latest HivemindOS source archive"
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/LiamVisionary/hivemindos/archive/refs/heads/main.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -Directory $tmp | Select-Object -First 1
    if (-not $inner) { throw "The source archive had no top-level folder." }
    Update-Info "Applying the updated source over $Root"
    Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $Root -Recurse -Force
    if ($sha -match '^[0-9a-fA-F]{40}$') {
      Set-Content -Path $markerFile -Encoding ASCII -Value $sha.ToLowerInvariant()
    } else {
      # An unknown version reported honestly beats a stale marker claiming the
      # previous commit is still what runs here.
      Remove-Item $markerFile -Force -ErrorAction SilentlyContinue
    }
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# --- dependencies -------------------------------------------------------------
if ($collectorOnlyMode) {
  # Port of ensure-collector-deps.sh: the collector needs only bonjour-service;
  # the full workspace install OOMs small hosts.
  if (-not (Test-Path (Join-Path $Root "node_modules\bonjour-service\package.json"))) {
    $spec = ""
    try {
      $spec = (& $nodeCmd.Source -p "require('./package.json').dependencies['bonjour-service']" 2>$null | Out-String).Trim()
    } catch {}
    if (-not $spec -or $spec -eq "undefined") { $spec = "^1.4.0" }
    Update-Info "Installing collector runtime dependency bonjour-service@$spec"
    & npm install --no-save --no-audit --no-fund --loglevel=error "bonjour-service@$spec"
    if ($LASTEXITCODE -ne 0) { throw "npm install of bonjour-service failed (exit code $LASTEXITCODE)." }
  }
} else {
  Update-Info "Installing workspace dependencies"
  $env:NODE_OPTIONS = "$($env:NODE_OPTIONS) --no-deprecation".Trim()
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm install --frozen-lockfile
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm install --frozen-lockfile
  } else {
    throw "pnpm is not available. Install pnpm or enable corepack, then rerun this update."
  }
  if ($LASTEXITCODE -ne 0) { throw "Dependency install failed (exit code $LASTEXITCODE)." }
}

# --- restart the telemetry collector -----------------------------------------
if ($SkipCollector) {
  Update-Info "Skipping telemetry collector restart (-SkipCollector)"
} else {
  Update-Info "Restarting the telemetry collector"
  # Keep the collector's port stable across the reinstall (the installer scans
  # for a free port, so the old collector must be gone first — and stopping it
  # is what makes the recorded port free again).
  $portArgs = @{ RepoRoot = $Root }
  if (Test-Path $hiveEnvFile) {
    $portLine = Select-String -Path $hiveEnvFile -Pattern '^AGENT_TELEMETRY_PORT=(\d+)$' | Select-Object -First 1
    if ($portLine) { $portArgs.Port = [int]$portLine.Matches[0].Groups[1].Value }
  }
  # Pin the machine's EXISTING Hivemind Link state for the installer (the unix
  # updater does the same via detect_hivemind_link_enabled): the installer's
  # collector-only mode otherwise DEFAULTS Link on, which requires Go — and a
  # Link-less box without Go would fail its update at the restart step.
  if (-not $env:HIVE_LINK_ENABLED) {
    if ((Test-Path $hiveEnvFile) -and (Select-String -Path $hiveEnvFile -Pattern '^HIVE_LINK_CONTROL=' -Quiet)) {
      $env:HIVE_LINK_ENABLED = "true"
    } else {
      $env:HIVE_LINK_ENABLED = "false"
    }
  }
  try { Stop-ScheduledTask -TaskName "HivemindOS Telemetry Collector" -ErrorAction SilentlyContinue } catch {}
  # Stop ONLY our own collector: the node process running this checkout's
  # collector script, matched by command line — never a foreign port owner.
  $collectorScript = Join-Path $Root "scripts\agent-telemetry-collector.mjs"
  $escapedScript = [regex]::Escape($collectorScript)
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedScript } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  try {
    & (Join-Path $Root "scripts\install-telemetry-collector.ps1") @portArgs
  } catch {
    # The collector was already stopped above — a failed reinstall must not
    # strand the machine bridge-less. Restart the existing task, then fail.
    Write-Warning "Collector reinstall failed: $($_.Exception.Message)"
    try { Start-ScheduledTask -TaskName "HivemindOS Telemetry Collector" -ErrorAction SilentlyContinue } catch {}
    throw
  }
  Update-Info "Telemetry collector reinstall finished"
}

Update-Info "HivemindOS update finished"
