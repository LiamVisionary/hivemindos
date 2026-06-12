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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .args(["-lc", &format!("command -v {name} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

fn default_vault_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join("Documents/Obsidian/hivemindos-vault"))
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

fn setup_root_command() -> String {
    if let Ok(current_dir) = std::env::current_dir() {
        let setup_script = current_dir.join("setup.sh");
        if setup_script.exists() {
            return format!("cd {}", shell_quote(&current_dir.display().to_string()));
        }
    }

    let root = home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hivemindos/app-source");
    format!(
        "mkdir -p {parent} && if [ ! -d {root}/.git ]; then git clone https://github.com/LiamVisionary/hivemindos.git {root}; else git -C {root} pull --ff-only; fi && cd {root}",
        parent = shell_quote(&root.parent().unwrap_or_else(|| Path::new(".")).display().to_string()),
        root = shell_quote(&root.display().to_string()),
    )
}

fn write_command_file(command: &str) -> Result<PathBuf, String> {
    let run_dir = home_dir()
        .ok_or_else(|| "No home directory was detected.".to_string())?
        .join(".hivemindos/setup-runs");
    fs::create_dir_all(&run_dir).map_err(|error| error.to_string())?;
    let command_path = run_dir.join(format!("hivemindos-setup-{}.command", chrono::Utc::now().timestamp()));
    let mut file = fs::File::create(&command_path).map_err(|error| error.to_string())?;
    writeln!(
        file,
        "#!/usr/bin/env bash\nset -euo pipefail\n{}\necho\necho 'HivemindOS setup step finished. You can close this terminal.'\nread -r -p 'Press Return to close...' _",
        command
    )
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
    let current_dir = std::env::current_dir().ok();
    let setup_script = current_dir
        .as_ref()
        .map(|dir| dir.join("setup.sh"))
        .filter(|path| path.exists());
    let vault_path = default_vault_path();
    let vault_exists = vault_path
        .as_ref()
        .is_some_and(|path| path.exists() && path.is_dir());
    let homebrew_installed = command_exists("brew");
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
                detail: "The desktop app is installed and does not auto-run setup.sh.".to_string(),
                install_command: None,
                optional: false,
            },
            SetupCheck {
                id: "vault",
                label: "Local brain vault",
                installed: vault_exists,
                detail: vault_path
                    .as_ref()
                    .map(|path| {
                        if vault_exists {
                            format!("Found {}", path.display())
                        } else {
                            format!("Not found at {}", path.display())
                        }
                    })
                    .unwrap_or_else(|| "No home directory was detected.".to_string()),
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
                install_command: Some("brew install --cask obsidian"),
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
                install_command: Some("brew install --cask tailscale"),
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
                install_command: setup_script
                    .as_ref()
                    .map(|_| "./setup.sh --local-only --skip-build"),
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
                install_command: Some("brew install syncthing"),
                optional: true,
            },
            SetupCheck {
                id: "tools",
                label: "CLI helpers",
                installed: homebrew_installed && pnpm_installed && gpg_installed && unison_installed,
                detail: format!(
                    "Homebrew: {}, pnpm/corepack: {}, GPG: {}, Unison: {}",
                    if homebrew_installed { "yes" } else { "no" },
                    if pnpm_installed { "yes" } else { "no" },
                    if gpg_installed { "yes" } else { "no" },
                    if unison_installed { "yes" } else { "no" },
                ),
                install_command: Some("brew install pnpm gnupg unison"),
                optional: true,
            },
        ],
    })
    .map_err(|error| error.to_string())
}

fn build_setup_invocation(request: NativeSetupRunRequest) -> (String, String) {
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
        root = setup_root_command(),
        memory_list = shell_quote(&memory_list),
        args = quoted_args,
    );
    (mode, command)
}

#[tauri::command]
pub(crate) fn native_setup_run(request: NativeSetupRunRequest) -> Result<serde_json::Value, String> {
    let (mode, command) = build_setup_invocation(request);
    let command_path = write_command_file(&command)?;
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
        let (mode, command) = build_setup_invocation(request);
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
        let (mode, command) = build_setup_invocation(request);
        assert_eq!(mode, "local");
        assert!(command.contains("'--local-only'"));
    }

    #[test]
    fn setup_mode_args_map_to_script_flags() {
        assert_eq!(setup_mode_arg("local"), "--local-only");
        assert_eq!(setup_mode_arg("system-tailscale"), "--system-tailscale");
        assert_eq!(setup_mode_arg("link"), "--link");
        assert_eq!(setup_mode_arg("anything-else"), "--local-only");
    }
}
