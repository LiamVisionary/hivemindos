use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const SOURCE_METADATA_FILE: &str = ".hivemind-skill-source.json";
const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"];

#[derive(Debug, Serialize, Clone)]
struct BrainSkillSummary {
    id: String,
    slug: String,
    name: String,
    description: String,
    provider: String,
    #[serde(rename = "providerLabel")]
    provider_label: String,
    path: String,
    #[serde(rename = "relativePath")]
    relative_path: String,
    checksum: String,
    #[serde(rename = "updatedAt")]
    updated_at: u128,
    imported: bool,
    #[serde(rename = "importedAs")]
    imported_as: Option<String>,
}

#[derive(Debug, Serialize)]
struct BrainSkillProviderInventory {
    id: String,
    label: String,
    home: String,
    skills: Vec<BrainSkillSummary>,
    installed: bool,
}

#[derive(Debug, Serialize)]
struct BrainSkillTotals {
    shared: usize,
    #[serde(rename = "providerSkills")]
    provider_skills: usize,
    importable: usize,
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

fn sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn sanitize_slug(value: &str) -> String {
    let slug = value
        .to_lowercase()
        .chars()
        .map(|item| if item.is_ascii_alphanumeric() || "._-".contains(item) { item } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect::<String>();
    if slug.is_empty() { "skill".to_string() } else { slug }
}

fn slug_to_name(slug: &str) -> String {
    slug.split(['-', '_', '/'])
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

fn frontmatter(markdown: &str) -> HashMap<String, String> {
    let Some(rest) = markdown.strip_prefix("---\n") else {
        return HashMap::new();
    };
    let Some(end) = rest.find("\n---") else {
        return HashMap::new();
    };
    rest[..end]
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((
                key.trim().to_lowercase(),
                value.trim().trim_matches(['"', '\'']).to_string(),
            ))
        })
        .collect()
}

fn first_paragraph(markdown: &str) -> String {
    let body = if markdown.starts_with("---\n") {
        markdown
            .get(4..)
            .and_then(|rest| rest.find("\n---").map(|end| &rest[end + 4..]))
            .unwrap_or(markdown)
    } else {
        markdown
    };
    body.split("\n\n")
        .map(|part| part.trim().trim_start_matches('#').trim())
        .find(|part| !part.is_empty())
        .unwrap_or("")
        .to_string()
}

fn namespaced_shared_slug(base_path: &Path, skill_path: &Path) -> String {
    let relative_dir = skill_path
        .parent()
        .and_then(|parent| parent.strip_prefix(base_path).ok())
        .map(|path| path.components().map(|part| part.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    if relative_dir.len() <= 1 {
        return sanitize_slug(&skill_path.parent().and_then(|path| path.file_name()).and_then(|value| value.to_str()).unwrap_or("skill"));
    }
    relative_dir.iter().map(|part| sanitize_slug(part)).collect::<Vec<_>>().join("/")
}

fn find_skill_files(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    fn walk(current: &Path, depth: usize, max_depth: usize, found: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
        if depth > max_depth || found.len() >= 2000 {
            return;
        }
        let Ok(entries) = fs::read_dir(current) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "SKILL.md" {
                if seen.insert(path.clone()) {
                    found.push(path);
                }
                continue;
            }
            if !path.is_dir() || SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&path, depth + 1, max_depth, found, seen);
        }
    }
    walk(root, 0, max_depth, &mut found, &mut seen);
    found
}

fn source_provider_label(skill_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(skill_dir.join(SOURCE_METADATA_FILE)).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    parsed.get("providerLabel").and_then(serde_json::Value::as_str).map(str::to_string)
}

fn skill_summary(
    skill_path: &Path,
    provider: &str,
    provider_label: &str,
    base_path: &Path,
    shared_by_checksum: &HashMap<String, BrainSkillSummary>,
    shared_by_slug: &HashMap<String, BrainSkillSummary>,
) -> Option<BrainSkillSummary> {
    let markdown = fs::read_to_string(skill_path).ok()?;
    let fields = frontmatter(&markdown);
    let slug = if provider == "shared" {
        namespaced_shared_slug(base_path, skill_path)
    } else {
        sanitize_slug(skill_path.parent()?.file_name()?.to_str()?)
    };
    let checksum = sha256(&markdown);
    let existing = shared_by_checksum.get(&checksum).or_else(|| shared_by_slug.get(&slug));
    let metadata = fs::metadata(skill_path).ok();
    Some(BrainSkillSummary {
        id: format!("{provider}:{}", skill_path.to_string_lossy()),
        slug: slug.clone(),
        name: fields.get("name").cloned().unwrap_or_else(|| slug_to_name(&slug)),
        description: fields.get("description").cloned().unwrap_or_else(|| first_paragraph(&markdown)),
        provider: provider.to_string(),
        provider_label: if provider == "shared" {
            skill_path.parent().and_then(source_provider_label).unwrap_or_else(|| provider_label.to_string())
        } else {
            provider_label.to_string()
        },
        path: skill_path.to_string_lossy().to_string(),
        relative_path: skill_path
            .strip_prefix(base_path)
            .unwrap_or(skill_path)
            .to_string_lossy()
            .replace('\\', "/"),
        checksum,
        updated_at: metadata
            .and_then(|item| item.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
        imported: provider == "shared" || existing.is_some(),
        imported_as: existing.map(|item| item.slug.clone()),
    })
}

fn read_shared_skills(skills_folder: &Path) -> Vec<BrainSkillSummary> {
    let blank_checksum = HashMap::new();
    let blank_slug = HashMap::new();
    let mut unique = HashMap::<String, BrainSkillSummary>::new();
    for skill in find_skill_files(skills_folder, 3)
        .iter()
        .filter_map(|path| skill_summary(path, "shared", "Shared brain", skills_folder, &blank_checksum, &blank_slug))
    {
        let key = if skill.slug.contains('/') { skill.slug.clone() } else { sanitize_slug(&skill.name) };
        unique.entry(key).or_insert(skill);
    }
    let mut skills = unique.into_values().collect::<Vec<_>>();
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills
}

fn provider_roots() -> Vec<(&'static str, &'static str, &'static str, Vec<(String, usize)>)> {
    vec![
        ("claude", "Claude", "~/.claude", vec![("~/.claude/skills".to_string(), 3), ("~/.claude/plugins".to_string(), 8)]),
        ("codex", "Codex", "~/.codex", vec![("~/.codex/skills".to_string(), 4), ("~/.codex/plugins/cache".to_string(), 8)]),
        ("hermes", "Hermes", "~/.hermes", vec![("~/.hermes/skills".to_string(), 4), ("~/.hermes/plugins".to_string(), 8), ("~/.hermes/agents".to_string(), 6)]),
        ("gemini", "Gemini", "~/.gemini", vec![("~/.gemini/skills".to_string(), 4), ("~/.gemini/extensions".to_string(), 8)]),
        ("openclaw", "OpenClaw", "~/.openclaw", vec![("~/.openclaw/skills".to_string(), 4), ("~/Documents/code/projects/hivemind-os/openclaw-next/skills".to_string(), 4)]),
        ("aeon", "Aeon", "~/.aeon", vec![
            ("~/.aeon/skills".to_string(), 4),
            ("~/.aeon/plugins".to_string(), 8),
            ("~/.aeon/agents".to_string(), 6),
            (std::env::var("AEON_LOCAL_PATH").map(|path| format!("{path}/skills")).unwrap_or_else(|_| "~/.aeon/repo/skills".to_string()), 3),
        ]),
    ]
}

#[tauri::command]
pub(crate) fn brain_skill_inventory(vault_path: Option<String>, shared_only: Option<bool>) -> Result<serde_json::Value, String> {
    let vault = vault_root(vault_path);
    let skills_folder = vault.join("Skills");
    let readme_path = skills_folder.join("README.md");
    let shared = read_shared_skills(&skills_folder);
    let shared_by_checksum = shared.iter().map(|skill| (skill.checksum.clone(), skill.clone())).collect::<HashMap<_, _>>();
    let shared_by_slug = shared.iter().map(|skill| (skill.slug.clone(), skill.clone())).collect::<HashMap<_, _>>();
    let mut providers = Vec::new();
    if shared_only != Some(true) {
        for (id, label, home, roots) in provider_roots() {
            let base_path = expand_home(home).canonicalize().unwrap_or_else(|_| expand_home(home));
            let mut skill_paths = HashSet::<PathBuf>::new();
            for (root, depth) in roots {
                let root_path = expand_home(&root).canonicalize().unwrap_or_else(|_| expand_home(&root));
                for path in find_skill_files(&root_path, depth) {
                    skill_paths.insert(path);
                }
            }
            let mut skills = skill_paths
                .iter()
                .filter(|path| !path.starts_with(&skills_folder))
                .filter_map(|path| skill_summary(path, id, label, &base_path, &shared_by_checksum, &shared_by_slug))
                .collect::<Vec<_>>();
            skills.sort_by(|left, right| left.name.cmp(&right.name));
            providers.push(BrainSkillProviderInventory {
                id: id.to_string(),
                label: label.to_string(),
                home: home.to_string(),
                skills,
                installed: base_path.exists(),
            });
        }
    }
    let provider_skills = providers.iter().map(|provider| provider.skills.len()).sum::<usize>();
    let importable = providers
        .iter()
        .flat_map(|provider| provider.skills.iter())
        .filter(|skill| !skill.imported)
        .count();
    let shared_count = shared.len();
    Ok(serde_json::json!({
        "ok": true,
        "vaultPath": vault.to_string_lossy(),
        "skillsFolder": skills_folder.to_string_lossy(),
        "readmePath": readme_path.to_string_lossy(),
        "shared": shared,
        "providers": providers,
        "totals": BrainSkillTotals { shared: shared_count, provider_skills, importable }
    }))
}
