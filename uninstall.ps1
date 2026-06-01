param(
  [switch]$Yes,
  [switch]$NonInteractive,
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if ($Port -eq 0) { $Port = if ($env:PORT) { [int]$env:PORT } else { 5020 } }

function Info($Message) { Write-Host $Message -ForegroundColor Cyan }
function Ok($Message) { Write-Host "✓ $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "! $Message" -ForegroundColor Yellow }
function Test-Command($Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Ask-YesNo($Prompt, [bool]$DefaultYes = $false) {
  if ($Yes) { return $true }
  if ($NonInteractive) {
    Warn "Would ask: $Prompt"
    return $false
  }
  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  $answer = (Read-Host "$Prompt $suffix").Trim().ToLowerInvariant()
  if ($answer.Length -eq 0) { return $DefaultYes }
  return $answer -eq "y" -or $answer -eq "yes"
}

function Remove-ManagedBlock($Path) {
  if (-not (Test-Path $Path)) { return }
  $lines = Get-Content $Path
  $next = New-Object System.Collections.Generic.List[string]
  $skip = $false
  $changed = $false
  foreach ($line in $lines) {
    if ($line -eq "<!-- BEGIN HIVEMINDOS_SHARED_SKILLS -->" -or $line -eq "<!-- BEGIN OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->") {
      $skip = $true
      $changed = $true
      continue
    }
    if ($line -eq "<!-- END HIVEMINDOS_SHARED_SKILLS -->" -or $line -eq "<!-- END OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->") {
      $skip = $false
      continue
    }
    if (-not $skip) { $next.Add($line) }
  }
  if ($changed) {
    Set-Content -Path $Path -Value $next
    Ok "Removed HivemindOS shared-skill block from $Path"
  }
}

function AgentInstructionFiles {
  $home = [Environment]::GetFolderPath("UserProfile")
  @(
    "$home\.codex\AGENTS.md",
    "$home\.claude\CLAUDE.md",
    "$home\.hermes\SOUL.md",
    "$home\.hermes\AGENTS.md",
    "$home\.gemini\GEMINI.md",
    "$home\.openclaw\AGENTS.md",
    "$home\.aeon\AGENTS.md"
  )
  Get-ChildItem "$home\.openclaw" -Directory -Filter "workspace-*" -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "AGENTS.md" }
}

function AgentSkillDirs {
  $home = [Environment]::GetFolderPath("UserProfile")
  @(
    "$home\.codex\skills\karpathy-guidelines",
    "$home\.claude\skills\karpathy-guidelines",
    "$home\.hermes\skills\karpathy-guidelines",
    "$home\.gemini\skills\karpathy-guidelines",
    "$home\.openclaw\skills\karpathy-guidelines",
    "$home\.aeon\skills\karpathy-guidelines"
  )
  Get-ChildItem "$home\.openclaw" -Directory -Filter "workspace-*" -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "skills\karpathy-guidelines" }
}

function Uninstall-WingetPackage($Name, $Id) {
  if (-not (Test-Command winget)) {
    Warn "winget is not available. Uninstall $Name manually if desired."
    return
  }
  winget uninstall --id $Id --exact --accept-source-agreements
}

$UserHome = [Environment]::GetFolderPath("UserProfile")
$vaultPath = if ($env:NEXT_PUBLIC_OBSIDIAN_VAULT_PATH) { $env:NEXT_PUBLIC_OBSIDIAN_VAULT_PATH } else { Join-Path $UserHome "Documents\Obsidian\hivemindos-vault" }
if ($vaultPath.StartsWith('~\') -or $vaultPath.StartsWith('~/')) {
  $vaultPath = Join-Path $UserHome $vaultPath.Substring(2)
}
$brainServicesFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER } else { "Operations/Brain Services" }
$synthesisFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER } else { "Synthesis" }
$scheduledFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER } else { "Operations/Automations" }
$kanbanFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER } else { "Operations/Work Board" }
$notificationsFolder = if ($env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER) { $env:NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER } else { "Operations/Agent Notifications" }
$gbrainInstallPath = if ($env:NEXT_PUBLIC_GBRAIN_INSTALL_PATH) { $env:NEXT_PUBLIC_GBRAIN_INSTALL_PATH } else { Join-Path $UserHome "gbrain" }
if ($gbrainInstallPath.StartsWith('~\') -or $gbrainInstallPath.StartsWith('~/')) {
  $gbrainInstallPath = Join-Path $UserHome $gbrainInstallPath.Substring(2)
}
$gbrainDataDir = if ($env:NEXT_PUBLIC_GBRAIN_DATA_DIR) { $env:NEXT_PUBLIC_GBRAIN_DATA_DIR } else { Join-Path $UserHome ".gbrain" }
if ($gbrainDataDir.StartsWith('~\') -or $gbrainDataDir.StartsWith('~/')) {
  $gbrainDataDir = Join-Path $UserHome $gbrainDataDir.Substring(2)
}

function Remove-EmptyVaultFolder($RelativePath) {
  $path = Join-Path $vaultPath $RelativePath
  if ((Test-Path $path) -and -not (Get-ChildItem $path -Force -ErrorAction SilentlyContinue)) {
    Remove-Item $path -Force
    Ok "Removed empty folder $path"
  } else {
    Warn "Skipped non-empty or missing folder: $path"
  }
}

Info "HivemindOS Windows uninstall"
Warn "This removes only the pieces you approve. Personal vault notes and third-party apps are left alone unless you say yes."

if (Ask-YesNo "Stop HivemindOS dashboard process on port $Port?" $true) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Ok "Stopped dashboard process $($listener.OwningProcess)"
  }
}

if (Ask-YesNo "Stop Syncthing processes started for HivemindOS?" $true) {
  Get-Process syncthing -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Ok "Stopped Syncthing processes"
}

if (Ask-YesNo "Stop HivemindOS Link sidecar processes?" $true) {
  Get-Process hivemind-linkd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Ok "Stopped HivemindOS Link sidecar processes"
}

if (Ask-YesNo "Remove HivemindOS collector environment file ~/.hivemindos/collector.env?" $false) {
  $collectorEnv = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".hivemindos\collector.env"
  Remove-Item $collectorEnv -Force -ErrorAction SilentlyContinue
  Ok "Removed $collectorEnv"
}

if (Ask-YesNo "Remove HivemindOS shared-skill instructions from agent files?" $true) {
  Remove-ManagedBlock (Join-Path $vaultPath "AGENTS.md")
  AgentInstructionFiles | ForEach-Object { Remove-ManagedBlock $_ }
}

if (Ask-YesNo "Remove copied karpathy-guidelines skill from local agent skill folders?" $false) {
  AgentSkillDirs | ForEach-Object {
    if (Test-Path (Join-Path $_ "SKILL.md")) {
      $content = Get-Content (Join-Path $_ "SKILL.md") -Raw
      if ($content -match "name:\s*karpathy-guidelines") {
        Remove-Item $_ -Recurse -Force
        Ok "Removed $_"
      }
    }
  }
}

if (Ask-YesNo "Remove optional GBrain and Syntho config keys from .env.local?" $false) {
  $envLocal = Join-Path $Root ".env.local"
  if (Test-Path $envLocal) {
    $next = Get-Content $envLocal | Where-Object { $_ -notmatch '^(NEXT_PUBLIC_GBRAIN_|NEXT_PUBLIC_SYNTO_|NEXT_PUBLIC_HIVE_GBRAIN_SURFACE_ENABLED=)' }
    Set-Content -Path $envLocal -Value $next
    Ok "Removed optional GBrain and Syntho config keys from .env.local"
  }
}

if (Ask-YesNo "Remove dashboard auth secret and device token from .env.local?" $false) {
  $envLocal = Join-Path $Root ".env.local"
  if (Test-Path $envLocal) {
    $next = Get-Content $envLocal | Where-Object { $_ -notmatch '^(HIVEMINDOS_DASHBOARD_AUTH_SECRET|HIVEMINDOS_DASHBOARD_DEVICE_TOKEN)=' }
    Set-Content -Path $envLocal -Value $next
    Ok "Removed dashboard auth keys from .env.local"
  }
}

if (Ask-YesNo "Remove optional GBrain service note from the Obsidian vault?" $false) {
  $gbrainServiceNote = Join-Path $vaultPath (Join-Path $brainServicesFolder "GBrain.md")
  Remove-Item $gbrainServiceNote -Force -ErrorAction SilentlyContinue
  Ok "Removed $gbrainServiceNote"
}

if (Ask-YesNo "Remove optional Syntho service note from the Obsidian vault?" $false) {
  $syntoServiceNote = Join-Path $vaultPath (Join-Path $brainServicesFolder "Syntho.md")
  $legacySyntoServiceNote = Join-Path $vaultPath (Join-Path $brainServicesFolder "Synto.md")
  Remove-Item $syntoServiceNote -Force -ErrorAction SilentlyContinue
  Remove-Item $legacySyntoServiceNote -Force -ErrorAction SilentlyContinue
  Ok "Removed $syntoServiceNote"
}

if (Ask-YesNo "Uninstall global Syntho CLI installed by uv?" $false) {
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    & uv tool uninstall synto | Out-Null
    Ok "Requested uv tool removal for synto"
  } else {
    Warn "uv is unavailable; skipped global Syntho CLI removal"
  }
}

if (Ask-YesNo "Remove optional Syntho runtime files from the Synthesis folder?" $false) {
  $syntoRoot = Join-Path $vaultPath $synthesisFolder
  Remove-Item (Join-Path $syntoRoot ".synto") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $syntoRoot "synto.toml") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $syntoRoot "vault-schema.md") -Force -ErrorAction SilentlyContinue
  Ok "Removed optional Syntho runtime files from $syntoRoot"
}

if (Ask-YesNo "Remove namespaced GBrain skillpack from the shared Skills shelf?" $false) {
  $gbrainSkillpack = Join-Path $vaultPath "Skills\GBrain"
  Remove-Item $gbrainSkillpack -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Removed $gbrainSkillpack"
}

if (Ask-YesNo "Uninstall global GBrain CLI installed by Bun?" $false) {
  if (Test-Command bun) {
    & bun remove -g gbrain | Out-Null
    Ok "Requested Bun global removal for gbrain"
  } else {
    Warn "Bun is unavailable; skipped global GBrain CLI removal"
  }
}

if (Ask-YesNo "Remove local GBrain checkout at $gbrainInstallPath?" $false) {
  Remove-Item $gbrainInstallPath -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Removed $gbrainInstallPath"
}

if (Ask-YesNo "Remove local GBrain data directory at $gbrainDataDir?" $false) {
  Remove-Item $gbrainDataDir -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Removed $gbrainDataDir"
}

if (Ask-YesNo "Remove seeded self-writing vault workflow templates from Operations/Automations?" $false) {
  $foundationWorkflows = Join-Path $vaultPath (Join-Path $scheduledFolder "Foundation Workflows")
  Remove-Item $foundationWorkflows -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Removed $foundationWorkflows"
}

if (Ask-YesNo "Remove seeded AI-ready shared-brain contract, templates, and Obsidian service notes?" $false) {
  Remove-Item (Join-Path $vaultPath "Operations\AI-Ready Vault Contract.md") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $vaultPath (Join-Path $brainServicesFolder "Obsidian Plugin Pack.md")) -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $vaultPath (Join-Path $brainServicesFolder "Obsidian CLI.md")) -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $vaultPath "Templates\HivemindOS") -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Removed seeded AI-ready shared-brain files"
}

if (Ask-YesNo "Remove auto-installed packaged HivemindOS skills from the shared Skills shelf?" $false) {
  $skillsFolder = Join-Path $vaultPath "Skills"
  if (Test-Path $skillsFolder) {
    Get-ChildItem -Path $skillsFolder -Recurse -Filter ".hivemind-skill-source.json" -File -ErrorAction SilentlyContinue |
      Where-Object {
        $content = Get-Content $_.FullName -Raw
        $content -match '"provider"\s*:\s*"packaged-auto-install"'
      } |
      ForEach-Object {
        $skillDir = $_.Directory.FullName
        Remove-Item $skillDir -Recurse -Force -ErrorAction SilentlyContinue
        Ok "Removed $skillDir"
      }
  }
}

if (Ask-YesNo "Remove HivemindOS app cache/build/dependencies from this checkout?" $true) {
  foreach ($path in @(".next", ".setup-cache", "node_modules")) {
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
  }
  Ok "Removed .next, .setup-cache, and node_modules"
}

if (Ask-YesNo "Remove the built hivemind-linkd binary from this checkout?" $true) {
  foreach ($path in @("bin\hivemind-linkd.exe", "bin\hivemind-linkd")) {
    if (Test-Path $path) { Remove-Item $path -Force }
  }
  Ok "Removed built hivemind-linkd binaries"
}

if (Ask-YesNo "Remove empty canonical HivemindOS vault folders created by setup?" $false) {
  @(
    $notificationsFolder,
    $kanbanFolder,
    "$scheduledFolder/Foundation Workflows",
    $scheduledFolder,
    $brainServicesFolder,
    "$synthesisFolder/pack",
    "$synthesisFolder/wiki/synthesis",
    "$synthesisFolder/wiki/queries",
    "$synthesisFolder/wiki/sources",
    "$synthesisFolder/wiki/.drafts",
    "$synthesisFolder/wiki",
    "$synthesisFolder/raw",
    $synthesisFolder,
    "Operations",
    "Archive/Processed Requests",
    "Archive",
    "Projects",
    "Templates/HivemindOS",
    "Templates",
    "Memory/Distillations",
    "Memory/Imported Sources",
    "Memory/Meetings",
    "Memory/Weekly Reviews",
    "Memory/Decision Journal",
    "Memory/Daily Briefings",
    "Memory/Book Notes",
    "Memory",
    "Intake/Sources",
    "Intake/Requests",
    "Intake"
  ) | ForEach-Object { Remove-EmptyVaultFolder $_ }
}

if (Ask-YesNo "Remove local Hivemind Link Tailscale state from ~/.hivemindos/link?" $false) {
  $linkState = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".hivemindos\link"
  if (Test-Path $linkState) { Remove-Item $linkState -Recurse -Force }
  Ok "Removed $linkState"
}

if (Ask-YesNo "Remove .env.local from this checkout?" $false) {
  Remove-Item ".env.local" -Force -ErrorAction SilentlyContinue
  Ok "Removed .env.local"
}

if (Ask-YesNo "Remove hive env, transfer, and update commands from ~/.local/bin if they point to this checkout?" $true) {
  $binDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".local\bin"
  foreach ($commandName in @("hive-env-add", "hive-env-run", "hive-env-check", "hive-transfer", "hive-update")) {
    $shimPath = Join-Path $binDir "$commandName.cmd"
    if (Test-Path $shimPath) {
      $content = Get-Content $shimPath -Raw
      if ($content.Contains($Root) -and $content.Contains("scripts\$commandName")) {
        Remove-Item $shimPath -Force
        Ok "Removed $shimPath"
      } else {
        Warn "Skipped $shimPath because it is not managed by this checkout"
      }
    }
  }
}

if (Ask-YesNo "Uninstall Syncthing itself from this machine?" $false) {
  Uninstall-WingetPackage "Syncthing" "Syncthing.Syncthing"
}

if (Ask-YesNo "Uninstall Unison itself from this machine?" $false) {
  Uninstall-WingetPackage "Unison" "Unison.Unison"
}

if (Ask-YesNo "Uninstall Tailscale itself from this machine?" $false) {
  Uninstall-WingetPackage "Tailscale" "Tailscale.Tailscale"
}

if (Ask-YesNo "Uninstall Go itself from this machine?" $false) {
  Uninstall-WingetPackage "Go" "GoLang.Go"
}

if (Ask-YesNo "Uninstall pnpm from this machine?" $false) {
  if (Test-Command npm) { npm uninstall -g pnpm | Out-Null }
  Uninstall-WingetPackage "pnpm" "pnpm.pnpm"
}

if (Ask-YesNo "Uninstall GnuPG/GPG from this machine?" $false) {
  Uninstall-WingetPackage "GnuPG" "GnuPG.GnuPG"
}

if (Ask-YesNo "Uninstall Obsidian from this machine?" $false) {
  Uninstall-WingetPackage "Obsidian" "Obsidian.Obsidian"
}

if (Ask-YesNo "Delete this HivemindOS git checkout after uninstall finishes?" $false) {
  $parent = Split-Path -Parent $Root
  $leaf = Split-Path -Leaf $Root
  Set-Location $parent
  Remove-Item $leaf -Recurse -Force
}

Ok "Uninstall prompts complete"
