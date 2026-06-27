use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Serialize)]
struct SetupCheck {
    id: &'static str,
    label: &'static str,
    installed: bool,
    detail: String,
    install_command: Option<&'static str>,
    optional: bool,
}

#[derive(Serialize)]
struct DetectedAgentRuntime {
    id: &'static str,
    label: &'static str,
    installed: bool,
    detail: String,
}

#[derive(Serialize)]
struct NativeSetupStatus {
    ok: bool,
    checked_at: String,
    auto_runs_setup_script: bool,
    setup_script_available: bool,
    setup_script_path: Option<String>,
    platform: &'static str,
    checks: Vec<SetupCheck>,
    detected_agents: Vec<DetectedAgentRuntime>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeSetupRunRequest {
    install_mode: Option<String>,
    skill_agents: Option<Vec<String>>,
    memory_agents: Option<Vec<String>>,
    import_skills: Option<bool>,
    import_memory: Option<bool>,
    start_dashboard: Option<bool>,
    install_collector: Option<bool>,
    build_dashboard: Option<bool>,
    install_deps: Option<bool>,
    force: Option<bool>,
}

#[derive(Serialize)]
struct NativeSetupRunResult {
    ok: bool,
    command: String,
    command_path: String,
    mode: String,
}

/// Platform matrix for the native setup flow: which setup script runs, how
/// the generated launcher is written, and which package manager installs
/// optional tools. Kept as a value (not cfg-gated code paths) so both
/// variants stay unit-testable from any host OS.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SetupPlatform {
    Unix,
    Windows,
}

impl SetupPlatform {
    fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    fn script_name(self) -> &'static str {
        match self {
            Self::Unix => "setup.sh",
            Self::Windows => "setup.ps1",
        }
    }

    fn launcher_extension(self) -> &'static str {
        match self {
            // Finder runs .command files in Terminal; Explorer/start runs .cmd
            // files in a console window.
            Self::Unix => "command",
            Self::Windows => "cmd",
        }
    }

    fn pick<T>(self, unix: T, windows: T) -> T {
        match self {
            Self::Unix => unix,
            Self::Windows => windows,
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn command_exists(name: &str) -> bool {
    // hidden_command: native_setup_status calls this ~12x per poll (every 4s
    // while setup finishes); a plain `where` spawn flashes a console window
    // each time on Windows. See crate::hidden_command.
    let status = if cfg!(target_os = "windows") {
        crate::hidden_command("where").arg(name).output().map(|output| output.status)
    } else {
        crate::hidden_command("sh")
            .args(["-lc", &format!("command -v {name} >/dev/null 2>&1")])
            .status()
    };
    status.map(|status| status.success()).unwrap_or(false)
}

fn mac_app_exists(name: &str) -> bool {
    cfg!(target_os = "macos") && Path::new("/Applications").join(format!("{name}.app")).exists()
}

fn tcp_port_open(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
}

fn strip_shell_quotes(value: &str) -> String {
    let clean = value.trim();
    if clean.len() >= 2 {
        let bytes = clean.as_bytes();
        let first = bytes[0] as char;
        let last = bytes[clean.len() - 1] as char;
        if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
            return clean[1..clean.len() - 1].to_string();
        }
    }
    clean.to_string()
}

fn collector_env_value(key: &str) -> Option<String> {
    let path = home_dir()?.join(".hivemindos/collector.env");
    let contents = fs::read_to_string(path).ok()?;
    contents.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        if name == key {
            Some(strip_shell_quotes(value))
        } else {
            None
        }
    })
}

fn parse_port(value: Option<String>) -> Option<u16> {
    value
        .as_deref()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn local_collector_ports() -> Vec<u16> {
    let mut ports = Vec::new();
    if let Some(port) = parse_port(std::env::var("AGENT_TELEMETRY_PORT").ok()) {
        ports.push(port);
    }
    if let Some(port) = parse_port(collector_env_value("AGENT_TELEMETRY_PORT")) {
        ports.push(port);
    }
    for port in 8787..=8810 {
        ports.push(port);
    }
    ports.sort_unstable();
    ports.dedup();
    ports
}

fn open_local_collector_port() -> Option<u16> {
    local_collector_ports()
        .into_iter()
        .find(|port| tcp_port_open(*port))
}

fn runtime_home(agent: &str) -> Option<PathBuf> {
    home_dir().map(|home| match agent {
        "codex" => home.join(".codex"),
        "claude" => home.join(".claude"),
        "hermes" => home.join(".hermes"),
        "gemini" => home.join(".gemini"),
        "openclaw" => home.join(".openclaw"),
        "aeon" => home.join(".aeon"),
        _ => home.join(format!(".{agent}")),
    })
}

fn detect_agent_runtime(id: &'static str, label: &'static str, command: Option<&str>) -> DetectedAgentRuntime {
    let home = runtime_home(id);
    let home_exists = home.as_ref().is_some_and(|path| path.exists());
    let command_installed = command.is_some_and(command_exists);
    let installed = home_exists || command_installed;
    let detail = home
        .as_ref()
        .map(|path| {
            if installed {
                format!("Detected {}", path.display())
            } else {
                format!("Not found at {}", path.display())
            }
        })
        .unwrap_or_else(|| "No home directory was detected.".to_string());
    DetectedAgentRuntime {
        id,
        label,
        installed,
        detail,
    }
}

fn detected_agent_runtimes() -> Vec<DetectedAgentRuntime> {
    vec![
        detect_agent_runtime("codex", "Codex", None),
        detect_agent_runtime("claude", "Claude", Some("claude")),
        detect_agent_runtime("hermes", "Hermes", Some("hermes")),
        detect_agent_runtime("gemini", "Gemini", Some("gemini")),
        detect_agent_runtime("openclaw", "OpenClaw", Some("openclaw")),
        detect_agent_runtime("aeon", "Aeon", Some("aeon")),
    ]
}

fn sanitize_agent_list(values: Option<Vec<String>>) -> Vec<String> {
    let mut agents = values
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| {
            let clean = value.trim().to_lowercase();
            match clean.as_str() {
                "codex" | "claude" | "hermes" | "gemini" | "openclaw" | "aeon" => Some(clean),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    agents.sort();
    agents.dedup();
    agents
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn setup_mode_arg(mode: &str) -> &'static str {
    match mode {
        "system-tailscale" => "--system-tailscale",
        "link" => "--link",
        _ => "--local-only",
    }
}

fn app_source_root() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hivemindos/app-source")
}

// GitHub serves a downloadable, extractable snapshot of any ref at these URLs.
// We bootstrap the app source from the archive instead of `git clone` so a
// fresh machine needs no `git` on PATH — a hard blocker on a stock Windows PC,
// which (unlike macOS/Linux) ships no git. Tracks `main`, the same ref the old
// git path pulled. NOTE: this still follows a moving branch; pinning the
// archive to the installed app version is the proper follow-up.
const APP_SOURCE_ARCHIVE_ZIP: &str =
    "https://github.com/LiamVisionary/hivemindos/archive/refs/heads/main.zip";
const APP_SOURCE_ARCHIVE_TARBALL: &str =
    "https://github.com/LiamVisionary/hivemindos/archive/refs/heads/main.tar.gz";

/// Download + extract the HivemindOS app source into `root` with no `git`
/// dependency, using tools always present on a stock OS: PowerShell's
/// Invoke-WebRequest/Expand-Archive on Windows, curl + tar on Unix. Replaces
/// `root` wholesale each run (the previous git path re-cloned on any
/// divergence anyway). The archive expands to a single `<repo>-main/` folder;
/// both variants move that one extracted dir into place rather than hardcoding
/// the prefix, so it stays correct if the default ref is ever renamed.
fn bootstrap_app_source_command(platform: SetupPlatform, root: &Path) -> String {
    let parent = root.parent().unwrap_or_else(|| Path::new("."));
    match platform {
        SetupPlatform::Unix => format!(
            "mkdir -p {parent} && _hm_tmp=\"$(mktemp -d)\" && curl -fsSL {url} -o \"$_hm_tmp/src.tar.gz\" && rm -rf {root} && mkdir -p {root} && tar -xzf \"$_hm_tmp/src.tar.gz\" -C {root} --strip-components=1 && rm -rf \"$_hm_tmp\"",
            parent = shell_quote(&parent.display().to_string()),
            root = shell_quote(&root.display().to_string()),
            url = APP_SOURCE_ARCHIVE_TARBALL,
        ),
        SetupPlatform::Windows => {
            // The whole PowerShell program is ONE cmd-level double-quoted arg, so
            // every inner string literal is single-quoted (no nested `"`). Single
            // quotes also tolerate spaces in the user profile path. $ErrorAction
            // 'Stop' makes any failure exit powershell non-zero for the caller's
            // `if errorlevel 1`. Tls12 keeps the download working on older boxes.
            format!(
                "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $root='{root}'; $tmp=Join-Path $env:TEMP ('hm-src-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force -Path $tmp | Out-Null; $zip=Join-Path $tmp 'src.zip'; Invoke-WebRequest -UseBasicParsing -Uri '{url}' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $inner=Get-ChildItem -Directory $tmp | Select-Object -First 1; if (-not $inner) {{ throw 'app-source archive had no top-level folder' }}; $parent=Split-Path $root -Parent; if ($parent) {{ New-Item -ItemType Directory -Force -Path $parent | Out-Null }}; if (Test-Path $root) {{ Remove-Item -Recurse -Force $root }}; Move-Item $inner.FullName $root; Remove-Item -Recurse -Force $tmp\"",
                root = root.display(),
                url = APP_SOURCE_ARCHIVE_ZIP,
            )
        }
    }
}

fn setup_root_command(platform: SetupPlatform) -> String {
    if let Ok(current_dir) = std::env::current_dir() {
        if current_dir.join(platform.script_name()).exists() {
            return match platform {
                SetupPlatform::Unix => format!("cd {}", shell_quote(&current_dir.display().to_string())),
                SetupPlatform::Windows => format!("cd /d \"{}\"", current_dir.display()),
            };
        }
    }

    let root = app_source_root();
    let bootstrap = bootstrap_app_source_command(platform, &root);
    match platform {
        SetupPlatform::Unix => format!(
            "{bootstrap} && cd {root}",
            root = shell_quote(&root.display().to_string()),
        ),
        SetupPlatform::Windows => format!(
            "{bootstrap}\r\nif errorlevel 1 exit /b 1\r\ncd /d \"{root}\"",
            root = root.display(),
        ),
    }
}

fn launcher_file_content(command: &str, platform: SetupPlatform) -> String {
    match platform {
        SetupPlatform::Unix => format!(
            "#!/usr/bin/env bash\nset -euo pipefail\n{command}\necho\necho 'HivemindOS setup step finished. You can close this terminal.'\nread -r -p 'Press Return to close...' _\n"
        ),
        SetupPlatform::Windows => format!(
            "@echo off\r\nsetlocal\r\n{command}\r\necho.\r\necho HivemindOS setup step finished. You can close this window.\r\npause\r\n"
        ),
    }
}

fn write_command_file(command: &str, platform: SetupPlatform) -> Result<PathBuf, String> {
    let run_dir = home_dir()
        .ok_or_else(|| "No home directory was detected.".to_string())?
        .join(".hivemindos/setup-runs");
    fs::create_dir_all(&run_dir).map_err(|error| error.to_string())?;
    let command_path = run_dir.join(format!(
        "hivemindos-setup-{}.{}",
        chrono::Utc::now().timestamp(),
        platform.launcher_extension()
    ));
    let mut file = fs::File::create(&command_path).map_err(|error| error.to_string())?;
    file.write_all(launcher_file_content(command, platform).as_bytes())
        .map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&command_path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&command_path, permissions).map_err(|error| error.to_string())?;
    }

    Ok(command_path)
}

fn open_command_file(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/c", "start", "", &path.display().to_string()])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else {
        Command::new("sh")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub(crate) fn native_setup_status() -> Result<serde_json::Value, String> {
    let platform = SetupPlatform::current();
    let current_dir = std::env::current_dir().ok();
    let setup_script = current_dir
        .as_ref()
        .map(|dir| dir.join(platform.script_name()))
        .filter(|path| path.exists());
    let package_manager_installed = command_exists(platform.pick("brew", "winget"));
    let pnpm_installed = command_exists("pnpm") || command_exists("corepack");
    let tailscale_installed = command_exists("tailscale") || mac_app_exists("Tailscale");
    let syncthing_installed = command_exists("syncthing");
    let obsidian_installed = command_exists("obsidian") || mac_app_exists("Obsidian");
    let gpg_installed = command_exists("gpg");
    let unison_installed = command_exists("unison");
    let collector_port = open_local_collector_port();
    let collector_running = collector_port.is_some();

    serde_json::to_value(NativeSetupStatus {
        ok: true,
        checked_at: chrono::Utc::now().to_rfc3339(),
        auto_runs_setup_script: false,
        setup_script_available: setup_script.is_some(),
        setup_script_path: setup_script.as_ref().map(|path| path.display().to_string()),
        platform: std::env::consts::OS,
        detected_agents: detected_agent_runtimes(),
        checks: vec![
            SetupCheck {
                id: "app",
                label: "Native app",
                installed: true,
                detail: format!("The desktop app is installed and does not auto-run {}.", platform.script_name()),
                install_command: None,
                optional: false,
            },
            SetupCheck {
                id: "vault",
                label: "Local brain vault",
                installed: false,
                detail: "Checked during setup after you approve local file access.".to_string(),
                install_command: None,
                optional: false,
            },
            SetupCheck {
                id: "obsidian",
                label: "Obsidian",
                installed: obsidian_installed,
                detail: if obsidian_installed {
                    "Installed".to_string()
                } else {
                    "Optional editor for the shared markdown brain.".to_string()
                },
                install_command: Some(platform.pick("brew install --cask obsidian", "winget install --id Obsidian.Obsidian")),
                optional: true,
            },
            SetupCheck {
                id: "tailscale",
                label: "Tailscale",
                installed: tailscale_installed,
                detail: if tailscale_installed {
                    "Installed".to_string()
                } else {
                    "Needed for multi-machine Fleet and private sync.".to_string()
                },
                install_command: Some(platform.pick("brew install --cask tailscale", "winget install --id Tailscale.Tailscale")),
                optional: true,
            },
            SetupCheck {
                id: "collector",
                label: "Local agent bridge",
                installed: collector_running,
                detail: if let Some(port) = collector_port {
                    format!("Local bridge responded on port {port}.")
                } else {
                    "Not running locally; local-only app features still work.".to_string()
                },
                install_command: setup_script.as_ref().map(|_| {
                    platform.pick(
                        "./setup.sh --local-only --skip-build",
                        "powershell -ExecutionPolicy Bypass -File .\\setup.ps1",
                    )
                }),
                optional: true,
            },
            SetupCheck {
                id: "syncthing",
                label: "Syncthing",
                installed: syncthing_installed,
                detail: if syncthing_installed {
                    "Installed".to_string()
                } else {
                    "Optional realtime shared-brain folder sync.".to_string()
                },
                install_command: Some(platform.pick("brew install syncthing", "winget install --id Syncthing.Syncthing")),
                optional: true,
            },
            SetupCheck {
                id: "tools",
                label: "CLI helpers",
                installed: package_manager_installed && pnpm_installed && gpg_installed && unison_installed,
                detail: format!(
                    "{}: {}, pnpm/corepack: {}, GPG: {}, Unison: {}",
                    platform.pick("Homebrew", "winget"),
                    if package_manager_installed { "yes" } else { "no" },
                    if pnpm_installed { "yes" } else { "no" },
                    if gpg_installed { "yes" } else { "no" },
                    if unison_installed { "yes" } else { "no" },
                ),
                install_command: Some(platform.pick(
                    "brew install pnpm gnupg unison",
                    "winget install --id pnpm.pnpm; winget install --id GnuPG.GnuPG",
                )),
                optional: true,
            },
        ],
    })
    .map_err(|error| error.to_string())
}

fn build_setup_invocation(request: NativeSetupRunRequest, platform: SetupPlatform) -> (String, String) {
    let mode = request.install_mode.unwrap_or_else(|| "local".to_string());
    let skill_agents = sanitize_agent_list(request.skill_agents);
    let memory_agents = sanitize_agent_list(request.memory_agents);
    let import_skills = request.import_skills.unwrap_or(true);
    let import_memory = request.import_memory.unwrap_or(true);
    let skill_list = if import_skills && !skill_agents.is_empty() {
        skill_agents.join(",")
    } else {
        "none".to_string()
    };
    let memory_list = if import_memory && !memory_agents.is_empty() {
        memory_agents.join(",")
    } else {
        "none".to_string()
    };

    if platform == SetupPlatform::Windows {
        // setup.ps1 takes a smaller flag surface than setup.sh: it has no
        // network-mode flags (it detects Tailscale itself), no collector
        // install, and handles vault/skills seeding internally, so the mode
        // and import selections have no Windows equivalents to forward.
        let mut flags = Vec::new();
        if !request.start_dashboard.unwrap_or(true) {
            flags.push("-SkipDashboard");
        }
        if !request.build_dashboard.unwrap_or(false) {
            flags.push("-SkipBuild");
        }
        if !request.install_deps.unwrap_or(true) {
            flags.push("-SkipDeps");
        }
        if request.force.unwrap_or(false) {
            flags.push("-Force");
        }
        let flags = flags.join(" ");
        // Prefer PowerShell 7 (pwsh); fall back to the always-present Windows
        // PowerShell, where setup.ps1 re-checks its own version requirements.
        let command = format!(
            "{root}\r\nwhere pwsh >nul 2>&1 && (set \"HIVE_PS=pwsh\") || (set \"HIVE_PS=powershell\")\r\n%HIVE_PS% -ExecutionPolicy Bypass -File setup.ps1 {flags}",
            root = setup_root_command(platform),
        );
        return (mode, command);
    }

    let mut args = vec!["--interactive".to_string(), setup_mode_arg(&mode).to_string()];
    if !request.start_dashboard.unwrap_or(true) {
        args.push("--skip-dashboard".to_string());
    }
    if !request.install_collector.unwrap_or(true) {
        args.push("--skip-collector".to_string());
    }
    if request.build_dashboard.unwrap_or(false) {
        args.push("--build".to_string());
    }
    if !request.install_deps.unwrap_or(true) {
        args.push("--skip-deps".to_string());
    }
    if request.force.unwrap_or(false) {
        args.push("--force".to_string());
    }
    if import_skills {
        args.push(format!("--import-skills={skill_list}"));
        args.push("--share-skills=all".to_string());
    } else {
        args.push("--no-shared-skills".to_string());
    }

    let quoted_args = args.iter().map(|arg| shell_quote(arg)).collect::<Vec<_>>().join(" ");
    let command = format!(
        "{root}\nHIVE_MEMORY_IMPORTS={memory_list} ./setup.sh {args}\nif [ {memory_list} != 'none' ] && [ -x ./scripts/import-agent-memory.sh ]; then ./scripts/import-agent-memory.sh --sources {memory_list}; fi",
        root = setup_root_command(platform),
        memory_list = shell_quote(&memory_list),
        args = quoted_args,
    );
    (mode, command)
}

#[tauri::command]
pub(crate) fn native_setup_run(request: NativeSetupRunRequest) -> Result<serde_json::Value, String> {
    let platform = SetupPlatform::current();
    let (mode, command) = build_setup_invocation(request, platform);
    let command_path = write_command_file(&command, platform)?;
    open_command_file(&command_path)?;

    serde_json::to_value(NativeSetupRunResult {
        ok: true,
        command,
        command_path: command_path.display().to_string(),
        mode,
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mirrors NativeSetupRunInput in src/lib/native/setup.ts. The frontend must
    // invoke as { request: <payload> } because the command parameter is named
    // `request`; this payload is what runNativeSetup sends for the
    // "just this computer" first-run option.
    fn frontend_local_payload() -> serde_json::Value {
        serde_json::json!({
            "installMode": "local",
            "skillAgents": ["claude", "codex"],
            "memoryAgents": [],
            "importSkills": true,
            "importMemory": false,
            "startDashboard": false,
            "installCollector": true,
            "buildDashboard": false,
            "installDeps": true,
            "force": false,
        })
    }

    #[test]
    fn frontend_payload_deserializes() {
        let request: NativeSetupRunRequest =
            serde_json::from_value(frontend_local_payload()).expect("frontend payload must match NativeSetupRunRequest");
        assert_eq!(request.install_mode.as_deref(), Some("local"));
    }

    #[test]
    fn unknown_frontend_fields_are_rejected() {
        let mut payload = frontend_local_payload();
        payload["renamedField"] = serde_json::json!(true);
        assert!(serde_json::from_value::<NativeSetupRunRequest>(payload).is_err());
    }

    #[test]
    fn local_mode_builds_local_only_command() {
        let request: NativeSetupRunRequest = serde_json::from_value(frontend_local_payload()).unwrap();
        let (mode, command) = build_setup_invocation(request, SetupPlatform::Unix);
        assert_eq!(mode, "local");
        assert!(command.contains("./setup.sh"));
        assert!(command.contains("'--local-only'"));
        assert!(command.contains("'--skip-dashboard'"));
        assert!(command.contains("'--import-skills=claude,codex'"));
        assert!(command.contains("HIVE_MEMORY_IMPORTS='none'"));
        assert!(!command.contains("'--force'"));
    }

    #[test]
    fn empty_request_defaults_to_local_mode() {
        let request: NativeSetupRunRequest = serde_json::from_value(serde_json::json!({})).unwrap();
        let (mode, command) = build_setup_invocation(request, SetupPlatform::Unix);
        assert_eq!(mode, "local");
        assert!(command.contains("'--local-only'"));
    }

    #[test]
    fn windows_command_runs_setup_ps1_with_mapped_flags() {
        let request: NativeSetupRunRequest = serde_json::from_value(frontend_local_payload()).unwrap();
        let (mode, command) = build_setup_invocation(request, SetupPlatform::Windows);
        assert_eq!(mode, "local");
        assert!(command.contains("setup.ps1"));
        assert!(command.contains("-SkipDashboard"));
        assert!(command.contains("-SkipBuild"));
        assert!(command.contains("where pwsh"));
        assert!(!command.contains("setup.sh"));
        assert!(!command.contains("--local-only"));
        // Check the setup.ps1 flag segment specifically: the source-bootstrap
        // PowerShell uses its own `-Force` params (Expand-Archive/Remove-Item)
        // earlier in the command, which are unrelated to the setup.ps1 -Force.
        let ps_flags = command.rsplit("-File setup.ps1").next().unwrap();
        assert!(!ps_flags.contains("-Force"));
    }

    #[test]
    fn windows_command_maps_force_and_skip_deps() {
        let mut payload = frontend_local_payload();
        payload["force"] = serde_json::json!(true);
        payload["installDeps"] = serde_json::json!(false);
        let request: NativeSetupRunRequest = serde_json::from_value(payload).unwrap();
        let (_, command) = build_setup_invocation(request, SetupPlatform::Windows);
        let ps_flags = command.rsplit("-File setup.ps1").next().unwrap();
        assert!(ps_flags.contains("-Force"));
        assert!(ps_flags.contains("-SkipDeps"));
    }

    #[test]
    fn windows_launcher_is_a_batch_file_that_pauses() {
        let content = launcher_file_content("echo hi", SetupPlatform::Windows);
        assert!(content.starts_with("@echo off\r\n"));
        assert!(content.contains("pause"));
        let unix = launcher_file_content("echo hi", SetupPlatform::Unix);
        assert!(unix.starts_with("#!/usr/bin/env bash\n"));
        assert!(unix.contains("read -r -p"));
    }

    #[test]
    fn root_command_targets_platform_script_and_shell() {
        // The repo checkout contains setup.ps1/setup.sh, so the generated root
        // command pins to the current directory; both variants must use the
        // platform's own shell syntax to change into it.
        let root = setup_root_command(SetupPlatform::Windows);
        assert!(root.contains("cd /d") || root.contains("Invoke-WebRequest"));
        let unix_root = setup_root_command(SetupPlatform::Unix);
        assert!(unix_root.contains("cd ") || unix_root.contains("curl -fsSL"));
    }

    #[test]
    fn app_source_bootstrap_needs_no_git() {
        // A fresh Windows PC has no git on PATH, so the source bootstrap must
        // not shell out to git. Windows downloads via PowerShell; Unix via
        // curl + tar. Both extract the single top-level archive folder.
        // "github.com" in the archive URL legitimately contains the substring
        // "git", so assert against actual git *invocations*, not the substring.
        let git_invocations = ["git clone", "git -C", "git pull", "git fetch"];
        let root = PathBuf::from("/home/user/.hivemindos/app-source");
        let windows = bootstrap_app_source_command(SetupPlatform::Windows, &root);
        for pat in git_invocations {
            assert!(!windows.contains(pat), "windows bootstrap must not run `{pat}`: {windows}");
        }
        assert!(windows.contains("Invoke-WebRequest"));
        assert!(windows.contains("Expand-Archive"));
        assert!(windows.contains("Move-Item"));
        assert!(windows.contains("archive/refs/heads/main.zip"));

        let unix = bootstrap_app_source_command(SetupPlatform::Unix, &root);
        for pat in git_invocations {
            assert!(!unix.contains(pat), "unix bootstrap must not run `{pat}`: {unix}");
        }
        assert!(unix.contains("curl -fsSL"));
        assert!(unix.contains("tar -xzf"));
        assert!(unix.contains("--strip-components=1"));
        assert!(unix.contains("archive/refs/heads/main.tar.gz"));
    }

    #[test]
    fn platform_matrix_is_consistent() {
        assert_eq!(SetupPlatform::Unix.script_name(), "setup.sh");
        assert_eq!(SetupPlatform::Windows.script_name(), "setup.ps1");
        assert_eq!(SetupPlatform::Unix.launcher_extension(), "command");
        assert_eq!(SetupPlatform::Windows.launcher_extension(), "cmd");
    }

    #[test]
    fn setup_mode_args_map_to_script_flags() {
        assert_eq!(setup_mode_arg("local"), "--local-only");
        assert_eq!(setup_mode_arg("system-tailscale"), "--system-tailscale");
        assert_eq!(setup_mode_arg("link"), "--link");
        assert_eq!(setup_mode_arg("anything-else"), "--local-only");
    }
}
