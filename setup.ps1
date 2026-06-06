param(
  [switch]$NonInteractive,
  [switch]$SkipDeps,
  [switch]$SkipBuild,
  [switch]$SkipDashboard,
  [switch]$Force,
  [int]$Port = 0,
  [int]$CollectorPort = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Missing = New-Object System.Collections.Generic.List[string]
if ($Port -eq 0) { $Port = if ($env:PORT) { [int]$env:PORT } else { 5020 } }
if ($CollectorPort -eq 0) { $CollectorPort = if ($env:AGENT_TELEMETRY_PORT) { [int]$env:AGENT_TELEMETRY_PORT } else { 8787 } }

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Ok($Message) { Write-Host "✓ $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "! $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "✗ $Message" -ForegroundColor Red }

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ask-YesNo($Prompt, [bool]$DefaultYes = $false) {
  if ($NonInteractive) { return $false }
  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  $answer = (Read-Host "$Prompt $suffix").Trim().ToLowerInvariant()
  if ($answer.Length -eq 0) { return $DefaultYes }
  return $answer -eq "y" -or $answer -eq "yes"
}

function Install-WingetPackage($Name, $Id) {
  if (-not (Test-Command winget)) {
    Warn "winget is not available. Install $Name manually: winget install --id $Id"
    return $false
  }
  Info "Installing $Name with winget"
  winget install --id $Id --exact --accept-package-agreements --accept-source-agreements
  return $LASTEXITCODE -eq 0
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Invoke-Pnpm {
  param([string[]]$Arguments)
  Refresh-Path
  if (Test-Command pnpm) {
    & pnpm @Arguments
    return
  }
  if (Test-Command corepack) {
    & corepack pnpm @Arguments
    return
  }
  Fail "pnpm is still not available on PATH"
  Write-Host "Open a new terminal or run one of:"
  Write-Host "  npm install -g pnpm"
  Write-Host "  winget install --id pnpm.pnpm"
  exit 1
}

function Ensure-Node {
  if (Test-Command node) {
    Ok "Node found: $(node --version)"
    return
  }
  if (Ask-YesNo "Node.js 20+ is missing. Install Node.js LTS with winget now?" $true) {
    Install-WingetPackage "Node.js LTS" "OpenJS.NodeJS.LTS" | Out-Null
    Refresh-Path
  }
  if (Test-Command node) {
    Ok "Node found: $(node --version)"
  } else {
    $Missing.Add("Node.js 20+")
    Fail "Node is missing"
  }
}

function Ensure-Pnpm {
  if (Test-Command pnpm) {
    Ok "pnpm found: $(pnpm --version)"
    return
  }
  if (Test-Command corepack) {
    if (-not $NonInteractive -and (Ask-YesNo "pnpm is missing. Enable pnpm through Corepack now?" $true)) {
      Info "Enabling pnpm through Corepack"
      corepack enable
      corepack prepare pnpm@8.6.12 --activate
      Refresh-Path
    } elseif ($NonInteractive) {
      Info "pnpm not found; enabling pnpm through Corepack"
      corepack enable
      corepack prepare pnpm@8.6.12 --activate
      Refresh-Path
    }
  }
  if (-not (Test-Command pnpm) -and (Test-Command npm) -and (Ask-YesNo "pnpm is missing. Install pnpm globally with npm now?" $true)) {
    Info "Installing pnpm with npm"
    npm install -g pnpm
    Refresh-Path
  }
  if (-not (Test-Command pnpm) -and (Ask-YesNo "pnpm is missing. Install pnpm with winget now?" $true)) {
    Install-WingetPackage "pnpm" "pnpm.pnpm" | Out-Null
    Refresh-Path
  }
  if (Test-Command pnpm) {
    Ok "pnpm found: $(pnpm --version)"
  } elseif (Test-Command corepack) {
    $pnpmVersion = Invoke-Pnpm @("--version")
    Ok "pnpm available through Corepack: $pnpmVersion"
  } else {
    $Missing.Add("pnpm or corepack")
    Fail "pnpm is missing"
  }
}

function Ensure-Tailscale {
  if (Test-Command tailscale) {
    $status = & tailscale status 2>$null
    if ($LASTEXITCODE -eq 0) {
      Ok "Tailscale is running"
      return $true
    }
    Warn "Tailscale is installed but not connected"
    Warn "Hivemind Sync is disabled until you open Tailscale and sign in, or run: tailscale up"
    return $false
  }
  if (Ask-YesNo "Tailscale is missing. Install it for Hivemind Sync between machines?" $true) {
    Install-WingetPackage "Tailscale" "Tailscale.Tailscale" | Out-Null
    Refresh-Path
  }
  if (Test-Command tailscale) {
    Warn "Tailscale is installed but not connected"
    Warn "Open Tailscale and sign in, or run: tailscale up"
  } else {
    Warn "Tailscale is optional and not installed."
    Warn "Hivemind Sync is disabled. Local-only dashboard, agents, and local vault features will still work."
    Warn "To enable Hivemind Sync later: winget install --id Tailscale.Tailscale"
  }
  return $false
}

function Ensure-Syncthing([bool]$TailnetSyncEnabled) {
  if (-not $TailnetSyncEnabled) {
    Warn "Skipping Syncthing setup because Tailscale is not connected"
    return
  }
  if (-not (Test-Command syncthing)) {
    if (Ask-YesNo "Syncthing is missing. Install it for Hivemind Sync shared-brain folder sync?" $true) {
      Install-WingetPackage "Syncthing" "Syncthing.Syncthing" | Out-Null
      Refresh-Path
    }
  }
  if (Test-Command syncthing) {
    Ok "Syncthing found: $(syncthing --version 2>$null | Select-Object -First 1)"
    $ping = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8384/rest/system/ping" -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($ping.StatusCode -eq 200) {
      Ok "Syncthing is running on 127.0.0.1:8384"
      return
    }
    if (Ask-YesNo "Start Syncthing in the background now?" $true) {
      Start-Process -WindowStyle Hidden -FilePath "syncthing" -ArgumentList "--no-browser", "--gui-address=127.0.0.1:8384"
      Start-Sleep -Seconds 2
      Ok "Syncthing started on 127.0.0.1:8384"
    }
  } else {
    Warn "Syncthing is unavailable; Hivemind Sync shared-brain folder sync is disabled."
  }
}

function Ensure-Unison {
  if (-not (Test-Command unison)) {
    if (Ask-YesNo "Unison is missing. Install it for bidirectional AEON repo <-> Obsidian folder mirroring?" $true) {
      Install-WingetPackage "Unison" "Unison.Unison" | Out-Null
      Refresh-Path
    }
  }
  if (Test-Command unison) {
    Ok "Unison found: $(unison -version 2>$null | Select-Object -First 1)"
  } else {
    Warn "Unison is unavailable; AEON Obsidian folder mirroring can be enabled later."
  }
}

function Ensure-Obsidian {
  $obsidianCommand = Test-Command obsidian
  $obsidianApp = Test-Path (Join-Path $env:LOCALAPPDATA "Obsidian\Obsidian.exe")
  if ($obsidianCommand -or $obsidianApp) {
    Ok "Obsidian found"
    return
  }
  if (Ask-YesNo "Obsidian is missing. Install it for the shared brain desktop app now?" $true) {
    Install-WingetPackage "Obsidian" "Obsidian.Obsidian" | Out-Null
    Refresh-Path
  }
  if ((Test-Command obsidian) -or (Test-Path (Join-Path $env:LOCALAPPDATA "Obsidian\Obsidian.exe"))) {
    Ok "Obsidian installed"
  } else {
    Warn "Obsidian is optional and not installed. Install later with: winget install --id Obsidian.Obsidian"
  }
}

function Ensure-Gpg {
  if (Test-Command gpg) {
    Ok "GPG found: $((gpg --version 2>$null | Select-Object -First 1))"
    return
  }
  if (Ask-YesNo "GPG is missing. Install GnuPG so hive-env-add can refresh encrypted env backups?" $true) {
    Install-WingetPackage "GnuPG" "GnuPG.GnuPG" | Out-Null
    Refresh-Path
  }
  if (Test-Command gpg) {
    Ok "GPG found: $((gpg --version 2>$null | Select-Object -First 1))"
  } else {
    Warn "GPG is optional and not installed. hive-env-add will still update local env files."
  }
}

function Ensure-HiveEnvAdd {
  $binDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".local\bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $pythonCommand = if (Test-Command py) { "py -3" } elseif (Test-Command python) { "python" } elseif (Test-Command python3) { "python3" } else { "" }
  if (-not $pythonCommand) {
    Warn "Python is missing; hive env shims installed but will need Python to run."
    $pythonCommand = "python"
  }
  foreach ($commandName in @("hive-env-add", "hive-env-remove", "hive-env-delete", "hive-env-run", "hive-env-check", "hive-transfer", "hive-update", "hive-brain", "hive-brain-hook")) {
    $shimPath = Join-Path $binDir "$commandName.cmd"
    $scriptPath = Join-Path $Root "scripts\$commandName"
    if ($commandName -eq "hive-transfer") {
      Set-Content -Path $shimPath -Value "@echo off`r`nnode `"$scriptPath.mjs`" %*`r`n" -Encoding ASCII
    } elseif ($commandName -eq "hive-brain" -or $commandName -eq "hive-brain-hook") {
      Set-Content -Path $shimPath -Value "@echo off`r`nnode `"$scriptPath`" %*`r`n" -Encoding ASCII
    } elseif ($commandName -eq "hive-update") {
      Set-Content -Path $shimPath -Value "@echo off`r`nbash `"$scriptPath`" %*`r`n" -Encoding ASCII
    } else {
      Set-Content -Path $shimPath -Value "@echo off`r`n$pythonCommand `"$scriptPath`" %*`r`n" -Encoding ASCII
    }
    Ok "$commandName installed: $shimPath"
  }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($userPath -split ";") -notcontains $binDir) {
    if (Ask-YesNo "Add $binDir to your user PATH for hive env and transfer commands?" $true) {
      $nextPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
      [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
      Refresh-Path
      Ok "Added $binDir to user PATH"
    } else {
      Warn "Add $binDir to PATH to run hive-env-add, hive-env-remove, hive-env-delete, hive-env-run, hive-env-check, hive-transfer, hive-update, hive-brain, and hive-brain-hook from any folder"
    }
  } else {
    Refresh-Path
  }
}

function Ensure-GitLawbCodeProof {
  $stateDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".hivemindos\gitlawb"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  if ((Test-Command gl) -and (Test-Command git-remote-gitlawb)) {
    Ok "GitLawb CLI found: $((Get-Command gl).Source)"
    $identity = & gl identity show 2>$null
    if ($LASTEXITCODE -eq 0 -and $identity) {
      Ok "GitLawb DID found"
    } elseif (Ask-YesNo "Create a local GitLawb DID now? This does not register with a public node." $true) {
      & gl identity new | Out-Null
      if ($LASTEXITCODE -eq 0) { Ok "GitLawb DID created locally" } else { Warn "Could not create GitLawb DID; use Integrations later." }
    }
  } else {
    Warn "GitLawb CLI is optional and not installed. Windows setup will keep Code Proof ready in the dashboard; install GitLawb manually, then refresh Integrations."
  }
  $status = @{
    checkedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    proofReadyDefault = $true
    nodeStartedBySetup = $false
  } | ConvertTo-Json
  Set-Content -Path (Join-Path $stateDir "setup-status.json") -Value $status
}

function Open-DashboardIfRequested($Url) {
  if ($SkipDashboard) { return }
  if (Ask-YesNo "Open the HivemindOS dashboard now?" $true) {
    Start-Process $Url
    Ok "Opened dashboard: $Url"
  }
}

function Get-DashboardDeviceToken {
  $envFile = Join-Path $Root ".env.local"
  if (-not (Test-Path $envFile)) { return "" }
  foreach ($line in Get-Content $envFile -ErrorAction SilentlyContinue) {
    if ($line -match "^HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=(.*)$") { return $Matches[1] }
  }
  return ""
}

function Copy-DashboardTokenIfRequested {
  $token = Get-DashboardDeviceToken
  if (-not $token) { return }
  if (-not (Get-Command Set-Clipboard -ErrorAction SilentlyContinue)) {
    Warn "Set-Clipboard is unavailable; use the copy command printed below."
    return
  }
  if (Ask-YesNo "Copy the dashboard unlock token to your clipboard now?" $true) {
    Set-Clipboard -Value $token
    Ok "Copied dashboard unlock token to clipboard"
  }
}

function Protect-EnvLocal($Path) {
  if (-not (Test-Path $Path)) { return }
  try {
    $item = Get-Item $Path
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = New-Object System.Security.Principal.SecurityIdentifier "S-1-5-18"
    $admins = New-Object System.Security.Principal.SecurityIdentifier "S-1-5-32-544"
    foreach ($identity in @($currentUser, $system, $admins)) {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      $acl.AddAccessRule($rule) | Out-Null
    }
    $acl.SetAccessRuleProtection($true, $false)
    Set-Acl -Path $item.FullName -AclObject $acl
  } catch {
    Warn "Could not tighten .env.local ACL: $($_.Exception.Message)"
  }
}

function Set-EnvLocal($Key, $Value) {
  $envFile = Join-Path $Root ".env.local"
  if (-not (Test-Path $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }
  Protect-EnvLocal $envFile
  $lines = Get-Content $envFile -ErrorAction SilentlyContinue
  $replaced = $false
  $next = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") {
      $replaced = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $replaced) { $next += "$Key=$Value" }
  if (($lines -join "`n") -eq ($next -join "`n")) {
    Protect-EnvLocal $envFile
    return
  }
  Set-Content -Path $envFile -Value $next
  Protect-EnvLocal $envFile
}

function Save-SharedHiveEnvEntries($EntriesText) {
  $hiveEnvAdd = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".local\bin\hive-env-add.cmd"
  if (-not (Test-Path $hiveEnvAdd)) {
    Warn "hive-env-add is unavailable; shared hive env keys were not refreshed"
    return
  }
  try {
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = "cmd.exe"
    $processInfo.Arguments = "/c `"$hiveEnvAdd`" --import-stdin --scope agent --runtime generic"
    $processInfo.WorkingDirectory = $Root
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($processInfo)
    $process.StandardInput.Write($EntriesText)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -eq 0) {
      Ok "Saved dashboard auth keys to shared hive env"
    } else {
      Warn "Could not save dashboard auth keys to shared hive env; dashboard unlock still works from .env.local"
    }
  } catch {
    Warn "Could not save dashboard auth keys to shared hive env: $($_.Exception.Message)"
  }
}

function Get-EnvLocal($Key) {
  $envFile = Join-Path $Root ".env.local"
  if (-not (Test-Path $envFile)) { return "" }
  foreach ($line in Get-Content $envFile -ErrorAction SilentlyContinue) {
    if ($line -match "^$([regex]::Escape($Key))=(.*)$") { return $Matches[1] }
  }
  return ""
}

function New-DashboardSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Get-HashForFiles($Files) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $text = ""
  foreach ($file in $Files) {
    if (Test-Path $file) {
      $text += (Get-FileHash $file -Algorithm SHA256).Hash
    }
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
}

Info "HivemindOS Windows setup"

Ensure-Node
Ensure-Pnpm
$tailnetSyncEnabled = Ensure-Tailscale
Ensure-Syncthing $tailnetSyncEnabled
Ensure-Unison
Ensure-Obsidian
Ensure-Gpg
Ensure-HiveEnvAdd
Ensure-GitLawbCodeProof

if ($Missing.Count -gt 0) {
  Write-Host ""
  Warn "Setup needs required dependencies first:"
  foreach ($item in $Missing) { Write-Host "  - $item" }
  Write-Host ""
  Write-Host "After fixing those, rerun:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\setup.ps1"
  exit 1
}

Set-EnvLocal "NEXT_PUBLIC_TAILNET_SYNC_ENABLED" ($tailnetSyncEnabled.ToString().ToLowerInvariant())
Set-EnvLocal "HIVE_ENV_TAILNET_SYNC" ($tailnetSyncEnabled.ToString().ToLowerInvariant())
Set-EnvLocal "HIVE_ENV_TAILNET_USER" ([Environment]::UserName)
Set-EnvLocal "HONEY_LEDGER_REMOTE_URL" $(if ($env:HONEY_LEDGER_REMOTE_URL) { $env:HONEY_LEDGER_REMOTE_URL } else { "https://hivemindos-honey-ledger.hivemindos.workers.dev" })
Set-EnvLocal "HONEY_LEDGER_ISSUER_ID" $(if ($env:HONEY_LEDGER_ISSUER_ID) { $env:HONEY_LEDGER_ISSUER_ID } else { "hivemindos" })
Set-EnvLocal "HONEY_COMPUTE_GATEWAY_URL" $(if ($env:HONEY_COMPUTE_GATEWAY_URL) { $env:HONEY_COMPUTE_GATEWAY_URL } else { "https://hivemindos-compute-gateway.hivemindos.workers.dev" })
Set-EnvLocal "HIVE_TOKEN_ADDRESS" $(if ($env:HIVE_TOKEN_ADDRESS) { $env:HIVE_TOKEN_ADDRESS } else { "" })
Set-EnvLocal "BANKR_LLM_KEY" $(if ($env:BANKR_LLM_KEY) { $env:BANKR_LLM_KEY } else { "" })
Set-EnvLocal "NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER" $(if ($env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER } else { "Operations/Work Board" })
Set-EnvLocal "NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER" $(if ($env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER } else { "Operations/Agent Notifications" })
Set-EnvLocal "NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER" $(if ($env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER } else { "Operations/Automations" })
Set-EnvLocal "NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER" $(if ($env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER } else { "Synthesis" })
Set-EnvLocal "NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER" $(if ($env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER } else { "Operations/Brain Services" })
Set-EnvLocal "HIVE_NOTE_SECURE_FOLDER" $(if ($env:HIVE_NOTE_SECURE_FOLDER) { $env:HIVE_NOTE_SECURE_FOLDER } else { "Operations/Secure" })
Set-EnvLocal "NEXT_PUBLIC_GBRAIN_CLI_PATH" $(if ($env:NEXT_PUBLIC_GBRAIN_CLI_PATH) { $env:NEXT_PUBLIC_GBRAIN_CLI_PATH } else { "gbrain" })
Set-EnvLocal "NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION" $(if ($env:NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION) { $env:NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION } else { "Skills/GBrain" })
Set-EnvLocal "NEXT_PUBLIC_SYNTO_CLI_PATH" $(if ($env:NEXT_PUBLIC_SYNTO_CLI_PATH) { $env:NEXT_PUBLIC_SYNTO_CLI_PATH } else { "synto" })
Set-EnvLocal "NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL" $(if ($env:NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL) { $env:NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL } else { "llama3.1:8b" })
Set-EnvLocal "NEXT_PUBLIC_GITLAWB_PROOF_READY" "true"
Set-EnvLocal "NEXT_PUBLIC_GITLAWB_NODE_URL" $(if ($env:NEXT_PUBLIC_GITLAWB_NODE_URL) { $env:NEXT_PUBLIC_GITLAWB_NODE_URL } else { "http://127.0.0.1:7545" })
$dashboardAuthSecret = if ($env:HIVEMINDOS_DASHBOARD_AUTH_SECRET) { $env:HIVEMINDOS_DASHBOARD_AUTH_SECRET } else { Get-EnvLocal "HIVEMINDOS_DASHBOARD_AUTH_SECRET" }
$dashboardDeviceToken = if ($env:HIVEMINDOS_DASHBOARD_DEVICE_TOKEN) { $env:HIVEMINDOS_DASHBOARD_DEVICE_TOKEN } else { Get-EnvLocal "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN" }
if (-not $dashboardAuthSecret) { $dashboardAuthSecret = New-DashboardSecret }
if (-not $dashboardDeviceToken) { $dashboardDeviceToken = New-DashboardSecret }
Set-EnvLocal "HIVEMINDOS_DASHBOARD_AUTH_SECRET" $dashboardAuthSecret
Set-EnvLocal "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN" $dashboardDeviceToken
Save-SharedHiveEnvEntries ("HIVEMINDOS_DASHBOARD_AUTH_SECRET=$($dashboardAuthSecret | ConvertTo-Json -Compress)`nHIVEMINDOS_DASHBOARD_DEVICE_TOKEN=$($dashboardDeviceToken | ConvertTo-Json -Compress)`n")

$vaultPath = if ($env:NEXT_PUBLIC_OBSIDIAN_VAULT_PATH) { $env:NEXT_PUBLIC_OBSIDIAN_VAULT_PATH } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) "Documents\Obsidian\hivemindos-vault" }
if ($vaultPath.StartsWith('~\') -or $vaultPath.StartsWith('~/')) {
  $vaultPath = Join-Path ([Environment]::GetFolderPath("UserProfile")) $vaultPath.Substring(2)
}
$kanbanFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER } else { "Operations/Work Board" }
$notificationsFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER } else { "Operations/Agent Notifications" }
$scheduledFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER } else { "Operations/Automations" }
$synthesisFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER } else { "Synthesis" }
$brainServicesFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER } else { "Operations/Brain Services" }
foreach ($folder in @(
  "Intake",
  "Intake/Requests",
  "Intake/Sources",
  ".hivemindos-transfers",
  "Memory",
  "Memory/Book Notes",
  "Memory/Daily Briefings",
  "Memory/Decision Journal",
  "Memory/Meetings",
  "Memory/Weekly Reviews",
  "Memory/Imported Sources",
  "Memory/Distillations",
  "Memory/Distillations/Agent Memory",
  "Projects",
  "Operations",
  "Operations/Code Projects",
  "Operations/Runtime Mirrors",
  "Operations/Secure",
  "Skills",
  "Templates/HivemindOS",
  "Archive",
  "Archive/Processed Requests",
  "$synthesisFolder/raw",
  "$synthesisFolder/wiki/.drafts",
  "$synthesisFolder/wiki/sources",
  "$synthesisFolder/wiki/queries",
  "$synthesisFolder/wiki/synthesis",
  "$synthesisFolder/pack",
  $scheduledFolder,
  $kanbanFolder,
  $notificationsFolder,
  $brainServicesFolder
)) {
  New-Item -ItemType Directory -Force -Path (Join-Path $vaultPath $folder) | Out-Null
}
if (-not (Test-Path (Join-Path $vaultPath "Shared Context.md"))) {
  Set-Content -Path (Join-Path $vaultPath "Shared Context.md") -Value "# Shared Context`n`nCurrent cross-agent context for the HivemindOS vault."
}

function Seed-BundledSharedSkills {
  param([string]$VaultPath)
  $skillsFolder = Join-Path $VaultPath "Skills"
  New-Item -ItemType Directory -Force -Path $skillsFolder | Out-Null
  $bundledSkillFiles = Get-ChildItem -Path (Join-Path $Root "skills") -Recurse -Filter "SKILL.md" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Parent.FullName -eq (Join-Path $Root "skills") }
  $seeded = 0
  foreach ($skillFile in $bundledSkillFiles) {
    $slug = $skillFile.Directory.Name
    $destination = Join-Path $skillsFolder $slug
    if (-not (Test-Path (Join-Path $destination "SKILL.md"))) {
      New-Item -ItemType Directory -Force -Path $destination | Out-Null
      Copy-Item -Path (Join-Path $skillFile.Directory.FullName "*") -Destination $destination -Recurse -Force
      $seeded += 1
    }
    $sourceUrl = if ($slug -eq "karpathy-guidelines") {
      "https://github.com/multica-ai/andrej-karpathy-skills/tree/main/skills/karpathy-guidelines"
    } else {
      "https://github.com/LiamVisionary/hivemindos/tree/main/skills/$slug"
    }
    $metadata = @{
      provider = "bundled"
      providerLabel = "HivemindOS bundled skills"
      sourcePath = $skillFile.Directory.FullName
      sourceUrl = $sourceUrl
      importedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json -Depth 3
    Set-Content -Path (Join-Path $destination ".hivemind-skill-source.json") -Value $metadata
  }
  $autoInstallRoot = Join-Path $Root "packaged-skills\auto-install"
  $autoInstallSkillFiles = if (Test-Path $autoInstallRoot) {
    Get-ChildItem -Path $autoInstallRoot -Recurse -Filter "SKILL.md" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Directory.Parent.FullName -eq $autoInstallRoot }
  } else {
    @()
  }
  foreach ($skillFile in $autoInstallSkillFiles) {
    $slug = $skillFile.Directory.Name
    $destination = Join-Path $skillsFolder $slug
    if (-not (Test-Path (Join-Path $destination "SKILL.md"))) {
      New-Item -ItemType Directory -Force -Path $destination | Out-Null
      Copy-Item -Path (Join-Path $skillFile.Directory.FullName "*") -Destination $destination -Recurse -Force
      $seeded += 1
    }
    $metadata = @{
      provider = "packaged-auto-install"
      providerLabel = "HivemindOS auto-installed packaged skills"
      sourcePath = $skillFile.Directory.FullName
      sourceUrl = "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/$slug"
      importedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    if (@("obsidian-markdown", "obsidian-bases", "json-canvas", "defuddle") -contains $slug) {
      $metadata["upstreamSourceUrl"] = "https://github.com/kepano/obsidian-skills"
    }
    $metadata = $metadata | ConvertTo-Json -Depth 3
    Set-Content -Path (Join-Path $destination ".hivemind-skill-source.json") -Value $metadata
  }

  $readme = New-Object System.Collections.Generic.List[string]
  $readme.Add("# Skills")
  $readme.Add("")
  $readme.Add("Operational know-how distilled into self-contained recipes. Each subfolder is a single skill: a ``SKILL.md`` with frontmatter plus optional helper files.")
  $readme.Add("")
  $readme.Add("Agents should read this index before using shared skills, then read the relevant ``<slug>/SKILL.md`` file.")
  $readme.Add("")
  $readme.Add("## Index")
  $readme.Add("")
  Get-ChildItem -Path $skillsFolder -Directory | Sort-Object Name | ForEach-Object {
    $skillMd = Join-Path $_.FullName "SKILL.md"
    if (-not (Test-Path $skillMd)) { return }
    $content = Get-Content $skillMd -Raw
    $description = "Shared agent skill."
    if ($content -match '(?m)^description:\s*[\''\"]?(.+?)[\''\"]?\s*$') { $description = $Matches[1] }
    $readme.Add("- [[$($_.Name)/SKILL]] - $description")
  }
  Set-Content -Path (Join-Path $skillsFolder "README.md") -Value $readme
  if ($seeded -gt 0) { Ok "Seeded $seeded bundled/auto-install HivemindOS shared skill(s)" } else { Ok "Bundled and auto-install HivemindOS shared skills already present" }
}

function Get-AgentInstructionFiles {
  $homeDir = [Environment]::GetFolderPath("UserProfile")
  @(
    "$homeDir\.codex\AGENTS.md",
    "$homeDir\.claude\CLAUDE.md",
    "$homeDir\.hermes\SOUL.md",
    "$homeDir\.hermes\AGENTS.md",
    "$homeDir\.gemini\GEMINI.md",
    "$homeDir\.openclaw\AGENTS.md",
    "$homeDir\.aeon\AGENTS.md"
  )
  Get-ChildItem "$homeDir\.openclaw" -Directory -Filter "workspace-*" -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "AGENTS.md" }
}

function Remove-HivemindManagedBlock {
  param([string[]]$Lines)
  $next = New-Object System.Collections.Generic.List[string]
  $skip = $false
  foreach ($line in $Lines) {
    if ($line -eq "<!-- BEGIN HIVEMINDOS_SHARED_SKILLS -->" -or $line -eq "<!-- BEGIN OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->") {
      $skip = $true
      continue
    }
    if ($line -eq "<!-- END HIVEMINDOS_SHARED_SKILLS -->" -or $line -eq "<!-- END OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->") {
      $skip = $false
      continue
    }
    if (-not $skip) { $next.Add($line) }
  }
  return $next
}

function Write-HivemindManagedBlock {
  param(
    [string]$Path,
    [string]$VaultPath
  )
  $skillsFolder = Join-Path $VaultPath "Skills"
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $existing = if (Test-Path $Path) { Get-Content $Path } else { @() }
  $lines = Remove-HivemindManagedBlock -Lines $existing
  while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) {
    $lines.RemoveAt($lines.Count - 1)
  }
  if ($lines.Count -gt 0) { $lines.Add("") }
  $lines.Add("<!-- BEGIN HIVEMINDOS_SHARED_SKILLS -->")
  $lines.Add("## HivemindOS Shared Skills")
  $lines.Add("")
  $lines.Add("A shared notes skill shelf is available at:")
  $lines.Add("")
  $lines.Add("- Vault: ``$VaultPath``")
  $lines.Add("- Skills index: ``$(Join-Path $skillsFolder "README.md")``")
  $lines.Add("- Skill files: ``$skillsFolder\<slug>\SKILL.md``")
  $lines.Add("")
  $lines.Add("Before using a shared skill, read ``$(Join-Path $skillsFolder "README.md")`` for the index, then read the relevant ``SKILL.md``. The bundled baseline skill is ``karpathy-guidelines``.")
  $lines.Add("")
  $lines.Add("## Shared Brain Memory")
  $lines.Add("")
  $lines.Add("Use ``hive-brain answer `"<query>`"`` before relying on prior preferences, decisions, instructions, goals, commitments, artifacts, lessons, credential status, or project context. The CLI tries the running HivemindOS ``/api/brain/memory`` route first, then falls back to local vault/index search, so raw/non-managed agents can recall shared memory without being app-routed. Setup also installs ``hive-brain-hook`` as a Claude Code ``UserPromptSubmit`` hook when Claude is targeted, so raw Claude prompts receive relevant shared-brain context automatically. Default recall/answer is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault. Pass ``--scope agent-memory`` for typed/proven memory only, or ``--scope full-vault`` to force broad vault recall. For durable writes, use ``hive-brain remember --type <type> --title <title> --content <content>`` or POST ``/api/brain/memory``; remember only durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, or reusable context.")
  $lines.Add("")
  $lines.Add("Memory writes live under ``Memory/Distillations/Agent Memory/``; the private search index lives at ``Operations/Brain Services/Agent Memory Index.jsonl``; optional GitLawb receipts live at ``Operations/Brain Services/Agent Memory Proofs.jsonl`` and store hashes/provenance instead of memory bodies. Include available ``agentName``, ``agentId``, ``runtime``, ``machineName``, ``machineId``, ``tailnetId``, ``tailnetName``, ``tailnetDnsName``, ``collectorUrl``, ``sessionId``, and ``project`` fields when writing. Use ``proof: `"auto`"`` unless explicit proof is requested. Do not store raw Tailnet IPs or secrets in shared memory. ``Operations/Secure/`` reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set, but plaintext secret values must stay out of notes and responses.")
  $lines.Add("")
  $lines.Add("## Shared Hive Env")
  $lines.Add("")
  $lines.Add("Shared credentials live in ``~/.hivemindos/.env``. Use ``hive-env-check KEY`` to verify presence and ``hive-env-run -- <command>`` to run tools/apps with the shared env loaded. Do not read, print, summarize, or copy secret values; refer to credentials by variable name and set/missing status only. When making a project consume shared credentials, load the ``shared-hive-env`` skill and default project runtime loading to ``~/.hivemindos/.env`` without persisting secrets into project files.")
  $lines.Add("<!-- END HIVEMINDOS_SHARED_SKILLS -->")
  Set-Content -Path $Path -Value $lines
}

function Install-ClaudeBrainHook {
  if ($env:HIVE_CLAUDE_BRAIN_HOOK -eq "0") { return }
  $home = [Environment]::GetFolderPath("UserProfile")
  $settingsFile = Join-Path $home ".claude\settings.json"
  $hookCommand = Join-Path $home ".local\bin\hive-brain-hook.cmd"
  $parent = Split-Path -Parent $settingsFile
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $settings = @{}
  if (Test-Path $settingsFile) {
    try { $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json -AsHashtable } catch { $settings = @{} }
  }
  if (-not $settings) { $settings = @{} }
  if (-not $settings.ContainsKey("hooks") -or $settings["hooks"] -isnot [System.Collections.IDictionary]) {
    $settings["hooks"] = @{}
  }
  $hooks = $settings["hooks"]
  $groups = if ($hooks.ContainsKey("UserPromptSubmit") -and $hooks["UserPromptSubmit"] -is [array]) { @($hooks["UserPromptSubmit"]) } else { @() }
  $filteredGroups = New-Object System.Collections.Generic.List[object]
  foreach ($group in $groups) {
    if ($group -is [System.Collections.IDictionary] -and $group.ContainsKey("hooks") -and $group["hooks"] -is [array]) {
      $nextHooks = @($group["hooks"] | Where-Object { -not ([string]($_.command)).Contains("hive-brain-hook") })
      if ($nextHooks.Count -gt 0) {
        $group["hooks"] = $nextHooks
        $filteredGroups.Add($group)
      }
    } else {
      $filteredGroups.Add($group)
    }
  }
  $filteredGroups.Add(@{
    hooks = @(@{
      type = "command"
      command = "$hookCommand claude-user-prompt"
      timeout = 20
    })
  })
  $hooks["UserPromptSubmit"] = @($filteredGroups)
  $settings | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsFile -Encoding ASCII
  Ok "Installed Claude shared-brain UserPromptSubmit hook"
}

Seed-BundledSharedSkills -VaultPath $vaultPath
Write-HivemindManagedBlock -Path (Join-Path $vaultPath "AGENTS.md") -VaultPath $vaultPath
Get-AgentInstructionFiles | ForEach-Object { Write-HivemindManagedBlock -Path $_ -VaultPath $vaultPath }
Install-ClaudeBrainHook
Ok "Runtime skill and memory hints installed for local agents"
if (-not (Test-Path (Join-Path $vaultPath "$scheduledFolder/README.md"))) {
  Set-Content -Path (Join-Path $vaultPath "$scheduledFolder/README.md") -Value "# Automations`n`nShared schedule definitions and run history for HivemindOS agents.`n`n- ``<device>/<schedule>/schedule.md`` stores each schedule snapshot.`n- ``run0001-<agent>-<timestamp>.md`` files store execution history."
}
if (-not (Test-Path (Join-Path $vaultPath "$synthesisFolder/README.md"))) {
  Set-Content -Path (Join-Path $vaultPath "$synthesisFolder/README.md") -Value "# Synthesis`n`nSyntho-powered reviewed knowledge layer for raw inputs, drafts, wiki articles, source trails, queries, synthesis notes, and agent packs."
}
if (-not (Test-Path (Join-Path $vaultPath "$brainServicesFolder/README.md"))) {
  Set-Content -Path (Join-Path $vaultPath "$brainServicesFolder/README.md") -Value "# Brain Services`n`nStatus notes for optional HivemindOS brain services. GBrain and Syntho can be connected from the dashboard without storing provider secrets in the vault."
}
Set-EnvLocal "NEXT_PUBLIC_HIVE_GBRAIN_SURFACE_ENABLED" "true"
if (-not (Test-Path (Join-Path $vaultPath "$brainServicesFolder/GBrain.md"))) {
  Set-Content -Path (Join-Path $vaultPath "$brainServicesFolder/GBrain.md") -Value "---`ntype: brain-service`nservice: gbrain`nenabled: false`ninstallMode: optional`nsearchMode: balanced`nproviderPolicy: balanced-cloud`nmcpMode: stdio`n---`n`n# GBrain`n`nOptional HivemindOS retrieval, graph, MCP, and dream-cycle service. Install or connect it from the dashboard when ready.`n`nNo provider secrets are stored in this note."
}
if (-not (Test-Path (Join-Path $vaultPath "$brainServicesFolder/Syntho.md"))) {
  Set-Content -Path (Join-Path $vaultPath "$brainServicesFolder/Syntho.md") -Value "---`ntype: brain-service`nservice: synto`nenabled: false`ninstallMode: optional`nmcpMode: stdio`nsourceAccessMode: deny`ncompareHeavyModel: llama3.1:8b`nautoApprove: false`nminConfidence: 0.8`n---`n`n# Syntho`n`nOptional HivemindOS compiled-wiki, pack, and MCP service for the Synthesis layer. Install or connect it from the dashboard when ready. Raw-source MCP tools default to denied until source licenses are configured.`n`nNo provider secrets are stored in this note."
}

& node (Join-Path $Root "scripts\seed-vault-foundation.mjs") `
  --vault $vaultPath `
  --scheduled-folder $scheduledFolder `
  --synthesis-folder $synthesisFolder `
  --brain-services-folder $brainServicesFolder `
  --kanban-folder $kanbanFolder `
  --notifications-folder $notificationsFolder | Out-Null

$setupCache = Join-Path $Root ".setup-cache"
New-Item -ItemType Directory -Force -Path $setupCache | Out-Null

$depsStamp = Join-Path $setupCache "deps-windows.sha"
$depsHash = Get-HashForFiles @("package.json", "pnpm-lock.yaml")
if ($SkipDeps) {
  Warn "Skipping dependency install because -SkipDeps was provided"
} elseif (-not $Force -and (Test-Path "node_modules") -and (Test-Path $depsStamp) -and ((Get-Content $depsStamp -Raw).Trim() -eq $depsHash)) {
  Ok "Dependencies already installed"
} else {
  Info "Installing app dependencies"
  $env:NODE_OPTIONS = "$($env:NODE_OPTIONS) --no-deprecation".Trim()
  Invoke-Pnpm @("install", "--frozen-lockfile")
  Set-Content -Path $depsStamp -Value $depsHash
  Ok "Dependencies installed"
}

$buildStamp = Join-Path $setupCache "build-windows.sha"
$buildHash = Get-HashForFiles @("package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json")
if ($SkipBuild) {
  Warn "Skipping dashboard build because -SkipBuild was provided"
} elseif (-not $Force -and (Test-Path ".next") -and (Test-Path $buildStamp) -and ((Get-Content $buildStamp -Raw).Trim() -eq $buildHash)) {
  Ok "Dashboard build already current"
} else {
  Info "Building dashboard"
  Invoke-Pnpm @("exec", "next", "build", "--webpack")
  Set-Content -Path $buildStamp -Value $buildHash
  Ok "Dashboard built"
}

$dashboardOpenable = $false
if ($SkipDashboard) {
  Warn "Skipping dashboard start because -SkipDashboard was provided"
} else {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Warn "Port $Port is already in use by PID $($listener.OwningProcess); leaving it alone"
  } else {
    Info "Starting dashboard dev server on port $Port"
    New-Item -ItemType Directory -Force -Path ".next" | Out-Null
    $stdoutPath = Join-Path $Root ".next\hivemindos-windows.log"
    $stderrPath = Join-Path $Root ".next\hivemindos-windows.err.log"
    Refresh-Path
    if (Test-Command pnpm) {
      Start-Process -FilePath "pnpm" -ArgumentList @("exec", "next", "dev", "--webpack", "-p", "$Port", "-H", "127.0.0.1") -WorkingDirectory $Root -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden
    } else {
      Start-Process -FilePath "corepack" -ArgumentList @("pnpm", "exec", "next", "dev", "--webpack", "-p", "$Port", "-H", "127.0.0.1") -WorkingDirectory $Root -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden
    }
    $dashboardOpenable = $true
  }
}

Write-Host ""
Ok "Ready"
Write-Host ""
Write-Host "Dashboard:"
Write-Host "  http://localhost:$Port"
Write-Host "  Unlock token: stored in .env.local and shared hive env as HIVEMINDOS_DASHBOARD_DEVICE_TOKEN"
Write-Host "  Copy token later: pnpm dashboard-auth copy-token"
Write-Host "  Reset lost token: pnpm dashboard-auth reset-token"
Copy-DashboardTokenIfRequested
Write-Host ""
Write-Host "Collector:"
Write-Host "  http://localhost:$CollectorPort"
Write-Host ""
Write-Host "Code Proof:"
if (Test-Command gl) {
  Write-Host "  GitLawb CLI: $((Get-Command gl).Source)"
} else {
  Write-Host "  GitLawb CLI: not installed"
}
Write-Host "  GitLawb node: lazy; not started by setup"
Write-Host ""
if ($tailnetSyncEnabled) {
  Write-Host "Tailscale is connected. Hivemind Sync can move shared brain folders, shared env, and handoff transfers between machines."
} else {
  Write-Host "Local-only mode is ready. Install and log in to Tailscale later to enable Hivemind Sync."
}
Write-Host ""
if ($dashboardOpenable) {
  Open-DashboardIfRequested "http://localhost:$Port"
}
