use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const TRANSFER_DIR: &str = ".hivemindos-transfers";
const PAYLOAD_DIR: &str = "payload";
const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const DEFAULT_AEON_ROOT: &str = "~/.aeon";
const DEFAULT_AEON_MODEL: &str = "claude-sonnet-4-6";
const MIROSHARK_RUNS_ROOT: &[&str] = &["Projects", "HivemindOS", "MiroShark Simulations", "runs"];
const AEON_OUTPUT_DIRS: &[&str] = &[".outputs", "outputs", "dashboard/outputs"];
const DELIVERABLE_FILENAMES: &[&str] = &[
    "aeon-rehearsal.md",
    "aeon-rehearsal.json",
    "run.md",
    "run.json",
    "posts.md",
    "posts.json",
];

#[derive(Debug, Serialize)]
pub(crate) struct AeonDeliverable {
    id: String,
    title: String,
    kind: String,
    source: String,
    repository: Option<String>,
    #[serde(rename = "simulationId")]
    simulation_id: Option<String>,
    status: Option<String>,
    path: Option<String>,
    url: Option<String>,
    #[serde(rename = "relativePath")]
    relative_path: Option<String>,
    size: Option<u64>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "availableOnMachine")]
    available_on_machine: bool,
    #[serde(rename = "machineName")]
    machine_name: Option<String>,
    summary: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AeonOutput {
    filename: String,
    skill: String,
    source: String,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
    excerpt: String,
}

#[derive(Debug, Default)]
struct AeonSkillConfig {
    enabled: Option<bool>,
    schedule: Option<String>,
    var: Option<String>,
    model: Option<String>,
}

#[derive(Debug)]
struct AeonConfig {
    skills: HashMap<String, AeonSkillConfig>,
    model: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeSchedule {
    id: String,
    runtime: String,
    #[serde(rename = "agentId")]
    agent_id: Option<String>,
    name: String,
    schedule: String,
    every: String,
    message: String,
    enabled: Option<bool>,
    #[serde(rename = "lastStatus")]
    last_status: Option<String>,
    source: String,
    metadata: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct MemoryEntry {
    slug: String,
    title: String,
    excerpt: String,
    path: String,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeMemorySnapshot {
    root: String,
    index: Option<String>,
    topics: Vec<MemoryEntry>,
    logs: Vec<MemoryEntry>,
    issues: Vec<MemoryEntry>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeRepoSyncStatus {
    root: String,
    repo: String,
    branch: String,
    #[serde(rename = "hasChanges")]
    has_changes: bool,
    #[serde(rename = "changedFiles")]
    changed_files: Vec<String>,
    behind: i64,
    ahead: i64,
    #[serde(rename = "lastMessage")]
    last_message: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeRun {
    id: String,
    runtime: String,
    name: String,
    status: String,
    url: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
    conclusion: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeRunLog {
    id: String,
    summary: String,
    logs: String,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeliverableMachineTarget {
    key: Option<String>,
    name: Option<String>,
    runtime: Option<String>,
    #[serde(rename = "agentId")]
    agent_id: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if let Some(home) = home_dir() {
        if trimmed == "~" || trimmed.is_empty() {
            return home;
        }
        if let Some(rest) = trimmed.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn vault_root(value: Option<String>) -> PathBuf {
    let raw = value
        .filter(|item| !item.trim().is_empty())
        .or_else(|| std::env::var("NEXT_PUBLIC_OBSIDIAN_VAULT_PATH").ok())
        .unwrap_or_else(|| DEFAULT_VAULT.to_string());
    expand_home(&raw).canonicalize().unwrap_or_else(|_| expand_home(&raw))
}

fn join_segments(root: &Path, segments: &[&str]) -> PathBuf {
    segments.iter().fold(root.to_path_buf(), |path, segment| path.join(segment))
}

fn string_field(agent: Option<&Value>, key: &str) -> String {
    agent
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn aeon_root(agent: Option<&Value>) -> Option<PathBuf> {
    let raw = [
        string_field(agent, "aeonLocalPath"),
        string_field(agent, "localDataDir"),
        std::env::var("AEON_LOCAL_PATH").unwrap_or_default(),
        std::env::var("AEON_HOME").unwrap_or_default(),
        DEFAULT_AEON_ROOT.to_string(),
    ]
    .into_iter()
    .find(|value| !value.is_empty() && !value.starts_with("http://") && !value.starts_with("https://"))?;
    Some(expand_home(&raw).canonicalize().unwrap_or_else(|_| expand_home(&raw)))
}

fn walk_files(root: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    if depth > 8 || files.len() >= 700 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".outputs" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, depth + 1, files);
        } else if path.is_file() {
            files.push(path);
        }
    }
}

fn metadata_for(path: &Path) -> HashMap<String, String> {
    let content = fs::read_to_string(path).unwrap_or_default();
    ["aeon_repository", "simulation_id", "status"]
        .into_iter()
        .filter_map(|key| frontmatter_value(&content, key).map(|value| (key.to_string(), value)))
        .collect()
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (left, right) = line.split_once(':')?;
        if left.trim() != key {
            return None;
        }
        Some(right.trim().trim_matches(['"', '\'']).to_string())
    })
}

fn title_from_slug(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_yaml_quotes(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn parse_inline_fields(raw: &str) -> HashMap<String, String> {
    raw.split(',')
        .filter_map(|part| {
            let (key, value) = part.split_once(':')?;
            Some((key.trim().to_string(), strip_yaml_quotes(value)))
        })
        .collect()
}

fn parse_aeon_config(raw: &str) -> AeonConfig {
    let mut config = AeonConfig {
        skills: HashMap::new(),
        model: DEFAULT_AEON_MODEL.to_string(),
    };
    let mut in_skills = false;
    let mut current = String::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("model:") {
            config.model = strip_yaml_quotes(value);
            continue;
        }
        if trimmed == "skills:" {
            in_skills = true;
            current.clear();
            continue;
        }
        if !in_skills {
            continue;
        }
        if !line.starts_with("  ") || line.starts_with("    ") {
            if line.starts_with("    ") && !current.is_empty() {
                if let Some((key, value)) = trimmed.split_once(':') {
                    let entry = config.skills.entry(current.clone()).or_default();
                    let value = strip_yaml_quotes(value);
                    match key.trim() {
                        "enabled" => entry.enabled = Some(value != "false"),
                        "schedule" => entry.schedule = Some(value),
                        "var" => entry.var = Some(value),
                        "model" => entry.model = Some(value),
                        _ => {}
                    }
                }
            }
            continue;
        }
        let Some((slug, value)) = trimmed.split_once(':') else {
            continue;
        };
        current = slug.trim().to_string();
        let entry = config.skills.entry(current.clone()).or_default();
        let value = value.trim();
        if value.starts_with('{') && value.ends_with('}') {
            current.clear();
            for (key, value) in parse_inline_fields(value.trim_matches(['{', '}'])) {
                match key.as_str() {
                    "enabled" => entry.enabled = Some(value != "false"),
                    "schedule" => entry.schedule = Some(value),
                    "var" => entry.var = Some(value),
                    "model" => entry.model = Some(value),
                    _ => {}
                }
            }
        } else if value.is_empty() {
            entry.enabled = Some(entry.enabled.unwrap_or(true));
        }
    }
    config
}

fn read_aeon_config(agent: Option<&Value>) -> Option<AeonConfig> {
    let root = aeon_root(agent)?;
    let raw = fs::read_to_string(root.join("aeon.yml")).unwrap_or_default();
    if raw.trim().is_empty() {
        return None;
    }
    Some(parse_aeon_config(&raw))
}

fn normalize_repo(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("git@github.com:")
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/")
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_lowercase()
}

fn normalize_name(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .map(|item| if item.is_ascii_alphanumeric() { item } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn matches_agent(agent: Option<&Value>, repository: Option<&String>) -> bool {
    let Some(repository) = repository else {
        return true;
    };
    let Some(agent) = agent else {
        return true;
    };
    let deliverable_repo = normalize_repo(repository);
    let agent_repo = normalize_repo(&string_field(Some(agent), "aeonRepo"));
    if !agent_repo.is_empty()
        && (agent_repo == deliverable_repo
            || agent_repo.ends_with(&format!("/{}", deliverable_repo.split('/').last().unwrap_or(""))))
    {
        return true;
    }
    let aeon_repo_name = string_field(Some(agent), "aeonRepoName");
    let fallback_name = string_field(Some(agent), "name");
    let agent_name = normalize_name(if aeon_repo_name.is_empty() { &fallback_name } else { &aeon_repo_name });
    let repo_name = normalize_name(deliverable_repo.split('/').last().unwrap_or(&deliverable_repo));
    !agent_name.is_empty() && !repo_name.is_empty() && agent_name == repo_name
}

fn kind_for(path: &Path) -> String {
    let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("").to_lowercase();
    if name == "aeon-rehearsal.md" {
        "verdict"
    } else if name == "run.md" {
        "miroshark-run"
    } else if name == "posts.md" {
        "posts"
    } else if name.ends_with(".json") {
        "json"
    } else if name.ends_with(".md") {
        "document"
    } else {
        "file"
    }
    .to_string()
}

fn title_for(path: &Path, metadata: &HashMap<String, String>) -> String {
    let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("").to_lowercase();
    let suffix = metadata
        .get("simulation_id")
        .map(|value| format!(" · {value}"))
        .unwrap_or_default();
    match name.as_str() {
        "aeon-rehearsal.md" => format!("AEON verdict{suffix}"),
        "run.md" => format!("MiroShark run{suffix}"),
        "posts.md" => format!("MiroShark posts{suffix}"),
        _ => path.file_name().and_then(|item| item.to_str()).unwrap_or("Deliverable").to_string(),
    }
}

fn preview_text(path: &Path) -> Option<String> {
    let extension = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_lowercase();
    if !matches!(extension.as_str(), "md" | "txt" | "json") {
        return None;
    }
    let mut content = fs::read_to_string(path).ok()?;
    if content.starts_with("---") {
        if let Some(index) = content[3..].find("---") {
            content = content[index + 6..].to_string();
        }
    }
    let preview = content
        .chars()
        .map(|item| if "#>*_`[]()".contains(item) { ' ' } else { item })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    Some(preview.chars().take(220).collect())
}

fn stable_id(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn timestamp_for(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
        .unwrap_or_else(|| "1970-01-01T00:00:00+00:00".to_string())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn now_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_millis())
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    let Some(home) = home_dir() else {
        return text;
    };
    let home_text = home.to_string_lossy();
    if text == home_text {
        return "~".to_string();
    }
    text.strip_prefix(&format!("{home_text}/"))
        .map(|rest| format!("~/{rest}"))
        .unwrap_or(text)
}

fn slug(value: &str, fallback: &str) -> String {
    let cleaned = value
        .trim()
        .trim_end_matches(".git")
        .replace(['"', '\''], "")
        .chars()
        .map(|item| if item.is_ascii_alphanumeric() || "._-".contains(item) { item } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if cleaned.is_empty() { fallback.to_string() } else { cleaned }
}

fn repo_name_from_url(value: &str) -> String {
    let cleaned = value.trim().trim_end_matches(".git");
    let name = cleaned
        .split(['/', ':'])
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or("aeon");
    slug(name, "aeon")
}

fn repo_full_name_from_url(value: &str) -> String {
    let cleaned = value.trim().trim_end_matches(".git");
    if let Some(rest) = cleaned.split("github.com/").nth(1) {
        let mut parts = rest.split('/').filter(|part| !part.is_empty());
        if let (Some(owner), Some(repo)) = (parts.next(), parts.next()) {
            return format!("{owner}/{}", repo.trim_end_matches(".git"));
        }
    }
    if let Some(rest) = cleaned.split("github.com:").nth(1) {
        let mut parts = rest.split('/').filter(|part| !part.is_empty());
        if let (Some(owner), Some(repo)) = (parts.next(), parts.next()) {
            return format!("{owner}/{}", repo.trim_end_matches(".git"));
        }
    }
    let mut parts = cleaned.split('/').filter(|part| !part.is_empty());
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(repo), None) => format!("{owner}/{}", repo.trim_end_matches(".git")),
        _ => String::new(),
    }
}

fn logo_from_repo(repo: &str) -> String {
    let full = repo_full_name_from_url(repo);
    let owner = full.split('/').next().unwrap_or("");
    if owner.is_empty() { String::new() } else { format!("https://github.com/{owner}.png") }
}

fn git_remote(root: &Path) -> String {
    Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn command_output(command: &str, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut process = Command::new(command);
    process.args(args);
    if let Some(cwd) = cwd {
        process.current_dir(cwd);
    }
    let output = process.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

fn command_ok(command: &str, args: &[&str], cwd: Option<&Path>) -> bool {
    command_output(command, args, cwd).is_ok()
}

fn aeon_repo(agent: Option<&Value>) -> String {
    [
        string_field(agent, "aeonRepo"),
        std::env::var("AEON_REPO").unwrap_or_default(),
        std::env::var("GITHUB_REPO").unwrap_or_default(),
    ]
    .into_iter()
    .find(|value| !value.trim().is_empty())
    .unwrap_or_default()
}

fn aeon_branch(agent: Option<&Value>) -> String {
    [
        string_field(agent, "aeonBranch"),
        std::env::var("AEON_BRANCH").unwrap_or_default(),
        "main".to_string(),
    ]
    .into_iter()
    .find(|value| !value.trim().is_empty())
    .unwrap_or_else(|| "main".to_string())
}

fn gh_repo_args(repo: &str) -> Vec<String> {
    if repo.trim().is_empty() {
        Vec::new()
    } else {
        vec!["-R".to_string(), repo.trim().to_string()]
    }
}

fn run_status(status: &str, conclusion: Option<&str>) -> String {
    match status {
        "queued" | "requested" | "waiting" => "queued",
        "in_progress" => "active",
        "completed" if conclusion == Some("success") => "completed",
        "completed" => "failed",
        _ => "unknown",
    }
    .to_string()
}

fn clean_log(value: &str) -> String {
    let without_ansi = value
        .replace("\u{1b}[0m", "")
        .replace("\u{1b}[31m", "")
        .replace("\u{1b}[32m", "")
        .replace("\u{1b}[33m", "")
        .replace("\u{1b}[34m", "")
        .replace("\u{1b}[35m", "")
        .replace("\u{1b}[36m", "");
    without_ansi
        .lines()
        .map(|line| {
            let chars = line.chars().collect::<Vec<_>>();
            if chars.len() > 21
                && chars.get(4) == Some(&'-')
                && chars.get(7) == Some(&'-')
                && chars.get(10) == Some(&'T')
                && chars.iter().take(21).any(|item| *item == 'Z')
            {
                line.split_once(' ').map(|(_, rest)| rest).unwrap_or(line)
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn ensure_file(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn ensure_aeon_workspace(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join("skills")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("memory").join("topics")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("memory").join("logs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("memory").join("issues")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join(".outputs")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("dashboard").join("outputs")).map_err(|error| error.to_string())?;
    ensure_file(&root.join("aeon.yml"), "skills:\n")?;
    ensure_file(&root.join("skills.json"), "{\n  \"skills\": []\n}\n")?;
    ensure_file(&root.join("memory").join("MEMORY.md"), "# AEON Memory\n\n")?;
    if !root.join(".git").is_dir() {
        let _ = Command::new("git").arg("init").current_dir(root).output();
    }
    Ok(())
}

fn workspace_agent(root: &Path, name: Option<String>, repo: Option<String>, machine_name: Option<String>) -> Result<Value, String> {
    let remote = repo.unwrap_or_else(|| git_remote(root));
    let repo_full_name = repo_full_name_from_url(&remote);
    let default_name = if remote.is_empty() {
        root.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("AEON Workspace")
            .to_string()
    } else {
        repo_name_from_url(&remote)
    };
    let repo_name = slug(name.as_deref().unwrap_or(&default_name), "AEON Workspace");
    let id_name = repo_name.to_lowercase();
    let repo_value = if repo_full_name.is_empty() { remote.clone() } else { repo_full_name.clone() };
    Ok(serde_json::json!({
        "id": format!("aeon-{id_name}-{}", now_millis()?),
        "name": name.unwrap_or_else(|| repo_name.replace(['-', '_'], " ")),
        "runtime": "aeon",
        "runtimeKind": "background",
        "runtimeCapabilities": {
            "status": true,
            "skills": true,
            "schedules": true,
            "runs": true,
            "outputs": true,
            "memory": true,
            "backgroundTasks": true,
            "notifications": true,
            "setup": true
        },
        "gatewayUrl": "http://127.0.0.1:41241",
        "a2aUrl": "http://127.0.0.1:41241",
        "chatPath": "",
        "statusPath": "/health",
        "agentId": repo_name,
        "localDataDir": display_path(root),
        "aeonLocalPath": display_path(root),
        "aeonRepo": repo_value,
        "aeonRepoName": repo_name,
        "aeonLogoUrl": logo_from_repo(&remote),
        "aeonBranch": "main",
        "aeonMode": if remote.is_empty() { "local" } else { "github" },
        "machineName": machine_name.unwrap_or_else(|| "local".to_string()),
        "telemetryUrl": "",
        "useSharedVault": true,
        "beeRole": "worker",
        "workerClass": "ops"
    }))
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn vault_deliverables(vault_path: &Path, agent: Option<&Value>) -> Vec<AeonDeliverable> {
    let root = join_segments(vault_path, MIROSHARK_RUNS_ROOT);
    let mut files = Vec::new();
    walk_files(&root, 0, &mut files);
    files
        .into_iter()
        .filter(|path| {
            let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("");
            DELIVERABLE_FILENAMES.contains(&name)
        })
        .filter_map(|path| {
            let metadata = metadata_for(&path);
            let repository = metadata.get("aeon_repository").cloned();
            if !matches_agent(agent, repository.as_ref()) {
                return None;
            }
            let info = fs::metadata(&path).ok()?;
            Some(AeonDeliverable {
                id: stable_id(&path.to_string_lossy()),
                title: title_for(&path, &metadata),
                kind: kind_for(&path),
                source: "vault".to_string(),
                repository,
                simulation_id: metadata.get("simulation_id").cloned(),
                status: metadata.get("status").cloned(),
                path: Some(path.to_string_lossy().to_string()),
                url: None,
                relative_path: relative_path(vault_path, &path),
                size: Some(info.len()),
                updated_at: timestamp_for(&info),
                available_on_machine: true,
                machine_name: Some("This Mac".to_string()),
                summary: preview_text(&path),
            })
        })
        .collect()
}

fn aeon_output_deliverables(agent: Option<&Value>) -> Vec<AeonDeliverable> {
    let Some(root) = aeon_root(agent) else {
        return Vec::new();
    };
    AEON_OUTPUT_DIRS
        .iter()
        .flat_map(|entry| {
            let mut files = Vec::new();
            walk_files(&root.join(entry), 0, &mut files);
            files
        })
        .filter_map(|path| {
            let info = fs::metadata(&path).ok()?;
            let kind = if kind_for(&path) == "json" { "json" } else { "output" }.to_string();
            Some(AeonDeliverable {
                id: stable_id(&path.to_string_lossy()),
                title: path.file_name().and_then(|item| item.to_str()).unwrap_or("Deliverable").to_string(),
                kind,
                source: "aeon-output".to_string(),
                repository: None,
                simulation_id: None,
                status: None,
                path: Some(path.to_string_lossy().to_string()),
                url: None,
                relative_path: relative_path(&root, &path),
                size: Some(info.len()),
                updated_at: timestamp_for(&info),
                available_on_machine: true,
                machine_name: Some("This Mac".to_string()),
                summary: preview_text(&path),
            })
        })
        .collect()
}

fn output_skill(name: &str) -> String {
    let stem = name
        .trim_end_matches(".md")
        .trim_end_matches(".json")
        .trim_end_matches(".txt");
    stem.split("-20").next().unwrap_or(stem).to_string()
}

fn output_excerpt(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .chars()
        .take(1200)
        .collect()
}

fn memory_entry(root: &Path, subdir: &str, path: &Path) -> Option<MemoryEntry> {
    let name = path.file_name()?.to_str()?.to_string();
    let slug = name
        .trim_end_matches(".md")
        .trim_end_matches(".txt")
        .trim_end_matches(".json")
        .to_string();
    let raw = fs::read_to_string(path).unwrap_or_default();
    let title = raw
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| title_from_slug(&slug));
    let excerpt = raw
        .lines()
        .filter(|line| !line.trim().starts_with("# "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .chars()
        .take(600)
        .collect::<String>();
    let updated_at = fs::metadata(path).ok().as_ref().map(timestamp_for);
    Some(MemoryEntry {
        slug,
        title,
        excerpt,
        path: relative_path(root, path).unwrap_or_else(|| format!("memory/{subdir}/{name}")),
        updated_at,
    })
}

fn memory_files(root: &Path, subdir: &str) -> Vec<MemoryEntry> {
    let Ok(entries) = fs::read_dir(root.join("memory").join(subdir)) else {
        return Vec::new();
    };
    let mut items = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_str()?.to_lowercase();
            if !path.is_file() || !matches!(extension.as_str(), "md" | "txt" | "json") {
                return None;
            }
            memory_entry(root, subdir, &path)
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .updated_at
            .as_deref()
            .unwrap_or("")
            .cmp(left.updated_at.as_deref().unwrap_or(""))
    });
    items
}

fn aeon_outputs(agent: Option<&Value>) -> Vec<AeonOutput> {
    let Some(root) = aeon_root(agent) else {
        return Vec::new();
    };
    [".outputs", "dashboard/outputs"]
        .into_iter()
        .flat_map(|relative| {
            let dir = root.join(relative);
            let Ok(entries) = fs::read_dir(&dir) else {
                return Vec::new();
            };
            let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
            entries
                .into_iter()
                .filter_map(|entry| {
                    let path = entry.path();
                    let name = path.file_name()?.to_str()?.to_string();
                    let extension = path.extension()?.to_str()?.to_lowercase();
                    if !path.is_file() || !matches!(extension.as_str(), "md" | "json" | "txt") {
                        return None;
                    }
                    let metadata = fs::metadata(&path).ok();
                    Some(AeonOutput {
                        filename: name.clone(),
                        skill: output_skill(&name),
                        source: relative.to_string(),
                        updated_at: metadata.as_ref().map(timestamp_for),
                        excerpt: output_excerpt(&path),
                    })
                })
                .take(50)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>()
}

#[tauri::command]
pub(crate) fn list_aeon_deliverables(agent: Option<Value>, vault_path: Option<String>) -> Result<Value, String> {
    let vault_path = vault_root(vault_path);
    let mut deliverables = vault_deliverables(&vault_path, agent.as_ref());
    deliverables.extend(aeon_output_deliverables(agent.as_ref()));
    deliverables.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    deliverables.truncate(80);
    Ok(serde_json::json!({ "ok": true, "deliverables": deliverables }))
}

#[tauri::command]
pub(crate) fn list_aeon_outputs(agent: Option<Value>) -> Result<Value, String> {
    let mut outputs = aeon_outputs(agent.as_ref());
    outputs.sort_by(|left, right| {
        right
            .updated_at
            .as_deref()
            .unwrap_or("")
            .cmp(left.updated_at.as_deref().unwrap_or(""))
    });
    Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "outputs": outputs }))
}

#[tauri::command]
pub(crate) fn list_aeon_schedules(agent: Option<Value>) -> Result<Value, String> {
    let Some(config) = read_aeon_config(agent.as_ref()) else {
        return Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "schedules": [] }));
    };
    let agent_id = string_field(agent.as_ref(), "id");
    let schedules = config
        .skills
        .into_iter()
        .map(|(slug, skill)| {
            let schedule = skill.schedule.unwrap_or_else(|| "workflow_dispatch".to_string());
            let var = skill.var.unwrap_or_else(|| format!("Run Aeon skill {slug}"));
            let model = skill.model.unwrap_or_else(|| config.model.clone());
            RuntimeSchedule {
                id: slug.clone(),
                runtime: "aeon".to_string(),
                agent_id: if agent_id.is_empty() { None } else { Some(agent_id.clone()) },
                name: title_from_slug(&slug),
                every: schedule.clone(),
                schedule,
                message: var.clone(),
                enabled: skill.enabled,
                last_status: None,
                source: "aeon.yml".to_string(),
                metadata: HashMap::from([
                    ("skill".to_string(), slug),
                    ("model".to_string(), model),
                    ("var".to_string(), var),
                ]),
            }
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "schedules": schedules }))
}

#[tauri::command]
pub(crate) fn get_aeon_memory(agent: Option<Value>) -> Result<Value, String> {
    let Some(root) = aeon_root(agent.as_ref()) else {
        return Ok(serde_json::json!({
            "ok": true,
            "runtime": "aeon",
            "memory": { "root": "", "topics": [], "logs": [], "issues": [] }
        }));
    };
    let index = fs::read_to_string(root.join("memory").join("MEMORY.md"))
        .ok()
        .filter(|value| !value.trim().is_empty());
    let memory = RuntimeMemorySnapshot {
        root: root.to_string_lossy().to_string(),
        index,
        topics: memory_files(&root, "topics"),
        logs: memory_files(&root, "logs"),
        issues: memory_files(&root, "issues"),
    };
    Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "memory": memory }))
}

#[tauri::command]
pub(crate) fn prepare_aeon_workspace(
    action: String,
    path: Option<String>,
    name: Option<String>,
    repo_url: Option<String>,
    machine_name: Option<String>,
) -> Result<Value, String> {
    if !matches!(action.as_str(), "initialize" | "link") {
        return Err("Only local initialize/link workspaces can use the native path.".to_string());
    }
    let root = expand_home(path.as_deref().unwrap_or(DEFAULT_AEON_ROOT))
        .canonicalize()
        .unwrap_or_else(|_| expand_home(path.as_deref().unwrap_or(DEFAULT_AEON_ROOT)));
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    ensure_aeon_workspace(&root)?;
    let agent = workspace_agent(&root, name, repo_url, machine_name)?;
    Ok(serde_json::json!({
        "ok": true,
        "action": action,
        "agent": agent,
        "root": display_path(&root)
    }))
}

fn repo_sync_status(agent: Option<&Value>) -> RuntimeRepoSyncStatus {
    let root = aeon_root(agent).unwrap_or_else(|| expand_home(DEFAULT_AEON_ROOT));
    let repo = aeon_repo(agent);
    let branch = aeon_branch(agent);
    let status = command_output("git", &["status", "--porcelain"], Some(&root)).unwrap_or_default();
    let changed_files = status
        .lines()
        .filter_map(|line| line.get(3..).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string))
        .collect::<Vec<_>>();
    let ahead_behind = command_output("git", &["rev-list", "--left-right", "--count", &format!("origin/{branch}...HEAD")], Some(&root))
        .ok()
        .map(|value| {
            value
                .split_whitespace()
                .filter_map(|part| part.parse::<i64>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let last_message = command_output("git", &["log", "-1", "--pretty=%s"], Some(&root)).ok().filter(|value| !value.is_empty());
    RuntimeRepoSyncStatus {
        root: root.to_string_lossy().to_string(),
        repo,
        branch,
        has_changes: !changed_files.is_empty(),
        changed_files,
        behind: ahead_behind.first().copied().unwrap_or(0),
        ahead: ahead_behind.get(1).copied().unwrap_or(0),
        last_message,
    }
}

fn pull_aeon_branch(root: &Path, branch: &str) -> Result<(), String> {
    command_output("git", &["fetch", "--quiet", "origin", branch], Some(root))?;
    command_output("git", &["pull", "--rebase", "--autostash", "origin", branch], Some(root))?;
    Ok(())
}

fn push_aeon_branch(root: &Path, branch: &str) -> Result<(), String> {
    match command_output("git", &["push", "-u", "origin", branch], Some(root)) {
        Ok(_) => Ok(()),
        Err(error) if error.contains("fetch first") || error.contains("non-fast-forward") || error.contains("failed to push some refs") || error.contains("rejected") => {
            pull_aeon_branch(root, branch)?;
            command_output("git", &["push", "-u", "origin", branch], Some(root))?;
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn has_staged_changes(root: &Path) -> bool {
    !command_ok("git", &["diff", "--cached", "--quiet"], Some(root))
}

#[tauri::command]
pub(crate) fn aeon_repo_sync(agent: Option<Value>, action: String) -> Result<Value, String> {
    let status = if action == "status" {
        repo_sync_status(agent.as_ref())
    } else {
        let root = aeon_root(agent.as_ref()).ok_or_else(|| "Configure an Aeon local path before syncing the repo.".to_string())?;
        let branch = aeon_branch(agent.as_ref());
        if action == "pull" {
            pull_aeon_branch(&root, &branch)?;
        } else if action == "push" {
            let _ = command_output("git", &["config", "user.name", "aeonframework"], Some(&root));
            let _ = command_output("git", &["config", "user.email", "aeonframework@proton.me"], Some(&root));
            let _ = command_output("git", &["checkout", "-B", &branch], Some(&root));
            pull_aeon_branch(&root, &branch)?;
            let _ = command_output("git", &["add", "aeon.yml", "skills.json", "skills", "memory"], Some(&root));
            if has_staged_changes(&root) {
                command_output("git", &["commit", "-m", "Update AEON dashboard configuration"], Some(&root))?;
            }
            push_aeon_branch(&root, &branch)?;
        } else {
            return Err(format!("Unsupported AEON repo sync action: {action}"));
        }
        repo_sync_status(agent.as_ref())
    };
    let message = match action.as_str() {
        "pull" => "Pulled AEON repo.",
        "push" => "Pushed AEON repo.",
        _ => "AEON repo status refreshed.",
    };
    Ok(serde_json::json!({ "ok": true, "status": status, "message": message }))
}

#[tauri::command]
pub(crate) fn list_aeon_runs(agent: Option<Value>) -> Result<Value, String> {
    let root = aeon_root(agent.as_ref());
    let repo = aeon_repo(agent.as_ref());
    let mut args = vec![
        "run".to_string(),
        "list".to_string(),
    ];
    args.extend(gh_repo_args(&repo));
    args.extend([
        "--workflow".to_string(),
        "aeon.yml".to_string(),
        "--json".to_string(),
        "databaseId,displayTitle,status,conclusion,createdAt,updatedAt,url".to_string(),
        "--limit".to_string(),
        "30".to_string(),
    ]);
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = command_output("gh", &refs, root.as_deref()).unwrap_or_else(|_| "[]".to_string());
    let parsed = serde_json::from_str::<Vec<Value>>(&output).unwrap_or_default();
    let runs = parsed
        .into_iter()
        .map(|run| {
            let status = run.get("status").and_then(Value::as_str).unwrap_or("");
            let conclusion = run.get("conclusion").and_then(Value::as_str);
            RuntimeRun {
                id: run.get("databaseId").map(|value| value.to_string()).unwrap_or_default().trim_matches('"').to_string(),
                runtime: "aeon".to_string(),
                name: run.get("displayTitle").and_then(Value::as_str).unwrap_or("Aeon run").to_string(),
                status: run_status(status, conclusion),
                conclusion: conclusion.map(str::to_string),
                created_at: run.get("createdAt").and_then(Value::as_str).map(str::to_string),
                updated_at: run.get("updatedAt").and_then(Value::as_str).map(str::to_string),
                url: run.get("url").and_then(Value::as_str).map(str::to_string),
            }
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "runs": runs }))
}

#[tauri::command]
pub(crate) fn get_aeon_run_log(agent: Option<Value>, run_id: String) -> Result<Value, String> {
    if !run_id.chars().all(|item| item.is_ascii_digit()) {
        return Err("Invalid Aeon run id.".to_string());
    }
    let root = aeon_root(agent.as_ref());
    let repo = aeon_repo(agent.as_ref());
    let mut metadata_args = vec!["run".to_string(), "view".to_string(), run_id.clone()];
    metadata_args.extend(gh_repo_args(&repo));
    metadata_args.extend(["--json".to_string(), "displayTitle,status,conclusion,url,jobs".to_string()]);
    let metadata_refs = metadata_args.iter().map(String::as_str).collect::<Vec<_>>();
    let metadata_raw = command_output("gh", &metadata_refs, root.as_deref()).unwrap_or_else(|_| "{}".to_string());
    let metadata = serde_json::from_str::<Value>(&metadata_raw).unwrap_or_else(|_| serde_json::json!({}));
    let mut log_args = vec!["run".to_string(), "view".to_string(), run_id.clone()];
    log_args.extend(gh_repo_args(&repo));
    log_args.push("--log".to_string());
    let log_refs = log_args.iter().map(String::as_str).collect::<Vec<_>>();
    let logs = command_output("gh", &log_refs, root.as_deref()).unwrap_or_default();
    let failed_steps = metadata
        .get("jobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|job| {
            let job_name = job.get("name").and_then(Value::as_str).unwrap_or("job").to_string();
            job.get("steps")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(move |step| {
                    if step.get("conclusion").and_then(Value::as_str) == Some("failure") {
                        Some(format!("{job_name} / {}", step.get("name").and_then(Value::as_str).unwrap_or("step")))
                    } else {
                        None
                    }
                })
        })
        .collect::<Vec<_>>();
    let title = metadata.get("displayTitle").and_then(Value::as_str).unwrap_or("Aeon run");
    let status = metadata.get("status").and_then(Value::as_str).unwrap_or("unknown");
    let conclusion = metadata.get("conclusion").and_then(Value::as_str).unwrap_or("");
    let summary = [
        title.to_string(),
        if conclusion.is_empty() { status.to_string() } else { format!("{status} · {conclusion}") },
        if failed_steps.is_empty() { String::new() } else { format!("Failed: {}", failed_steps.join(", ")) },
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    let log = RuntimeRunLog {
        id: run_id,
        summary,
        logs: clean_log(&logs),
        url: metadata.get("url").and_then(Value::as_str).map(str::to_string),
    };
    Ok(serde_json::json!({ "ok": true, "runtime": "aeon", "log": log }))
}

fn target_is_local(target: &str) -> bool {
    target.starts_with('/') || target.starts_with("file://") || target.starts_with('~')
}

fn path_from_target(target: &str) -> Result<PathBuf, String> {
    let clean = target.trim().replace(['\0', '\r', '\n'], "");
    if clean.starts_with("file://") {
        let url = url::Url::parse(&clean).map_err(|error| error.to_string())?;
        return url
            .to_file_path()
            .map_err(|_| "Deliverable file URL could not be converted to a local path.".to_string());
    }
    Ok(expand_home(&clean))
}

#[tauri::command]
pub(crate) fn download_aeon_deliverable(path: Option<String>, url: Option<String>) -> Result<Value, String> {
    let target = path.or(url).unwrap_or_default();
    if !target_is_local(&target) {
        return Err("HTTP deliverables require the Next fallback.".to_string());
    }
    let path = path_from_target(&target)?;
    if !path.is_file() {
        return Err("Deliverable is not a file.".to_string());
    }
    Ok(serde_json::json!({ "ok": true, "path": path.to_string_lossy(), "downloaded": false }))
}

fn safe_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("deliverable")
        .chars()
        .map(|item| if item.is_ascii_alphanumeric() || "._ -".contains(item) { item } else { '-' })
        .collect::<String>()
        .trim_start_matches('.')
        .trim()
        .to_string()
}

fn media_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|item| item.to_str()).unwrap_or("").to_lowercase().as_str() {
        "md" => "text/markdown",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub(crate) fn send_aeon_deliverable(
    path: Option<String>,
    url: Option<String>,
    vault_path: Option<String>,
    target_machine: Option<DeliverableMachineTarget>,
) -> Result<Value, String> {
    let target = path.or(url).unwrap_or_default();
    if !target_is_local(&target) {
        return Err("Only files available on this machine can be sent to another machine.".to_string());
    }
    let source = path_from_target(&target)?;
    if !source.is_file() {
        return Err("Deliverable is not a file.".to_string());
    }
    let machine = target_machine.ok_or_else(|| "Target machine is required.".to_string())?;
    let vault = vault_root(vault_path);
    let root = vault.join(TRANSFER_DIR);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let created_at = now_rfc3339();
    let id = format!("hive-transfer-{now}-{}", &stable_id(&source.to_string_lossy())[..12]);
    let dir = root.join(&id);
    let payload_dir = dir.join(PAYLOAD_DIR);
    fs::create_dir_all(&payload_dir).map_err(|error| error.to_string())?;
    let name = safe_file_name(&source);
    let destination = payload_dir.join(&name);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    let stats = fs::metadata(&destination).map_err(|error| error.to_string())?;
    let manifest = serde_json::json!({
        "id": id,
        "schema": "hivemind.transfer.v1",
        "status": "pending",
        "createdAt": created_at,
        "note": format!("AEON deliverable: {name}"),
        "from": { "host": std::env::var("HOSTNAME").unwrap_or_else(|_| "This Mac".to_string()), "runtime": "aeon", "agentId": "" },
        "to": {
            "machineId": machine.key.unwrap_or_default(),
            "host": machine.name.unwrap_or_default(),
            "runtime": machine.runtime.unwrap_or_else(|| "aeon".to_string()),
            "agentId": machine.agent_id.unwrap_or_default()
        },
        "payloads": [{
            "name": name,
            "mediaType": media_type_for(&destination),
            "bytes": stats.len(),
            "sha256": sha256(&destination)?,
            "path": format!("{TRANSFER_DIR}/{id}/{PAYLOAD_DIR}/{}", destination.file_name().and_then(|item| item.to_str()).unwrap_or("deliverable"))
        }]
    });
    fs::write(
        dir.join("manifest.json"),
        format!("{}\n", serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?),
    )
    .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ok": true, "transfer": manifest }))
}
