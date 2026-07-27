param(
  [switch]$Uninstall,
  [switch]$NoStart,
  [int]$Port = 8111
)

$ErrorActionPreference = "Stop"
$PinnedCommit = "d3a770c365644bb369b9490588333b0e0309c11c"
$TaskName = "HivemindOS OpenSRE Sidecar"
$InstallRoot = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".hivemindos\opensre"
$Venv = Join-Path $InstallRoot "venv-$($PinnedCommit.Substring(0, 12))"
$Runner = Join-Path $InstallRoot "run-sidecar.ps1"
$Manifest = Join-Path $InstallRoot "install.json"
$TokenFile = Join-Path $InstallRoot "gateway-token"

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the OpenSRE Scheduled Task. The isolated runtime and incident history were preserved."
  exit 0
}

$Python = Get-Command python3.13, python3.12, python -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Python) { throw "Python 3.12+ is required for the optional OpenSRE sidecar." }
& $Python.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
if ($LASTEXITCODE -ne 0) { throw "Python 3.12+ is required for the optional OpenSRE sidecar." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required to install the pinned OpenSRE source." }

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
if (-not (Test-Path $TokenFile)) {
  $tokenBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
  [Convert]::ToBase64String($tokenBytes) | Set-Content -Path $TokenFile -NoNewline -Encoding UTF8
}
$VenvPython = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPython)) { & $Python.Source -m venv $Venv }
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not prepare the OpenSRE virtual environment." }
& $VenvPython -m pip install --disable-pip-version-check "git+https://github.com/Tracer-Cloud/opensre.git@$PinnedCommit"
if ($LASTEXITCODE -ne 0) { throw "Could not install the reviewed OpenSRE commit." }

$RunnerContent = @'
$ErrorActionPreference = "Stop"
$safeEnvironment = @{
  "SystemRoot" = [Environment]::GetEnvironmentVariable("SystemRoot")
  "TEMP" = [Environment]::GetEnvironmentVariable("TEMP")
  "TMP" = [Environment]::GetEnvironmentVariable("TMP")
  "USERPROFILE" = [Environment]::GetEnvironmentVariable("USERPROFILE")
  "HOME" = [Environment]::GetEnvironmentVariable("USERPROFILE")
  "PATH" = [Environment]::GetEnvironmentVariable("PATH")
  "OPENSRE_NO_TELEMETRY" = "1"
  "OPENSRE_PROMPT_LOG_DISABLED" = "1"
  "OPENSRE_HISTORY_ENABLED" = "0"
  "OPENSRE_MASK_ENABLED" = "true"
  "OPENSRE_ALERT_LISTENER_TOKEN" = (Get-Content "__TOKEN_FILE__" -Raw).Trim()
  "LLM_PROVIDER" = "ollama"
  "OLLAMA_HOST" = "http://127.0.0.1:11434"
}
Get-ChildItem Env: | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
foreach ($entry in $safeEnvironment.GetEnumerator()) { if ($null -ne $entry.Value) { Set-Item "Env:$($entry.Key)" $entry.Value } }
Set-Location "__INSTALL_ROOT__"
& "__VENV_PYTHON__" -m uvicorn gateway.http.webapp:app --host 127.0.0.1 --port __PORT__
'@
$RunnerContent = $RunnerContent.Replace("__VENV_PYTHON__", $VenvPython).Replace("__TOKEN_FILE__", $TokenFile).Replace("__INSTALL_ROOT__", $InstallRoot).Replace("__PORT__", "$Port")
Set-Content -Path $Runner -Value $RunnerContent -Encoding UTF8
@{
  provider = "opensre"
  commit = $PinnedCommit
  baseUrl = "http://127.0.0.1:$Port"
  entrypoint = "gateway.http.webapp:app"
  interactiveShell = $false
  autonomousRemediation = $false
  telemetry = $false
  promptLogging = $false
  history = $false
} | ConvertTo-Json | Set-Content -Path $Manifest -Encoding UTF8

$Pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $Pwsh) { $Pwsh = (Get-Command powershell -ErrorAction Stop).Source }
$Action = New-ScheduledTaskAction -Execute $Pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
if (-not $NoStart) { Start-ScheduledTask -TaskName $TaskName }

Write-Host "Installed pinned OpenSRE sidecar at http://127.0.0.1:$Port."
Write-Host "Privacy defaults: telemetry off, prompt logging off, history off, masking on; local Ollama provider."
