use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const SOURCE_METADATA_FILE: &str = ".hivemind-skill-source.json";
const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"];
const GRAPH_SKIPPED_DIRS: &[&str] = &[".git", ".obsidian", ".trash", "node_modules"];
const MAX_GRAPH_NOTES: usize = 260;
const MAX_NOTE_BYTES: u64 = 524_288;
const ACCESS_LOG_PATH: &str = "Operations/Brain Services/access-log.jsonl";
const LEGACY_ACCESS_LOG_PATH: &str = "Projects/HivemindOS/Brain Access/access-log.jsonl";

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

pub(crate) fn brain_summary(vault_path: Option<String>) -> Result<serde_json::Value, String> {
    let vault = vault_root(vault_path);
    let skills_folder = vault.join("Skills");
    let shared = read_shared_skills(&skills_folder);
    let (notes, graph_truncated) = if vault.is_dir() {
        read_graph_notes(&vault)
    } else {
        (Vec::new(), false)
    };
    let accesses = if vault.is_dir() {
        read_access_events(&vault)
    } else {
        Vec::new()
    };
    let folders = notes
        .iter()
        .filter_map(|note| note.path.rsplit_once('/').map(|(folder, _)| folder.to_string()))
        .collect::<HashSet<_>>();

    Ok(serde_json::json!({
        "ok": true,
        "source": "native-brain-summary",
        "checkedAt": chrono::Utc::now().to_rfc3339(),
        "vaultPath": vault.to_string_lossy(),
        "skillsFolder": skills_folder.to_string_lossy(),
        "totals": {
            "sharedSkills": shared.len(),
            "notes": notes.len(),
            "folders": folders.len(),
            "recentAccesses": accesses.len(),
        },
        "recentAccesses": accesses.into_iter().take(12).collect::<Vec<_>>(),
        "truncated": graph_truncated,
    }))
}

#[derive(Debug, Clone)]
struct GraphNote {
    path: String,
    content: String,
    byte_size: u64,
    line_count: usize,
    modified_at: Option<String>,
    preview: String,
    tags: Vec<String>,
}

fn graph_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_sync_conflict_file(name: &str) -> bool {
    name.to_lowercase().contains("sync-conflict-") && name.to_lowercase().ends_with(".md")
}

fn walk_markdown(root: &Path, current: &Path, output: &mut Vec<PathBuf>) {
    if output.len() >= MAX_GRAPH_NOTES {
        return;
    }
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        if output.len() >= MAX_GRAPH_NOTES {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if !GRAPH_SKIPPED_DIRS.contains(&name.as_str()) {
                walk_markdown(root, &path, output);
            }
        } else if file_type.is_file() && name.to_lowercase().ends_with(".md") && !is_sync_conflict_file(&name) && path.starts_with(root) {
            output.push(path);
        }
    }
}

fn extract_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else {
            break;
        };
        let raw = &after[..end];
        let target = raw
            .split(['|', '#', '^'])
            .next()
            .unwrap_or("")
            .trim();
        if !target.is_empty() {
            links.push(target.to_string());
        }
        rest = &after[end + 2..];
    }
    links
}

fn graph_preview(content: &str) -> String {
    let body = if content.trim_start().starts_with("---") {
        content
            .splitn(3, "---")
            .nth(2)
            .unwrap_or(content)
    } else {
        content
    };
    let mut preview = String::new();
    for line in body.lines() {
        let trimmed = line
            .trim()
            .trim_start_matches('#')
            .trim()
            .replace("[[", "")
            .replace("]]", "")
            .replace("**", "")
            .replace("__", "");
        if trimmed.is_empty() || trimmed.starts_with("```") || trimmed.starts_with('|') {
            continue;
        }
        if !preview.is_empty() {
            preview.push(' ');
        }
        preview.push_str(&trimmed);
        if preview.len() >= 280 {
            break;
        }
    }
    preview.chars().take(280).collect()
}

fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    for token in content.split_whitespace() {
        let trimmed = token.trim_matches(|item: char| !item.is_ascii_alphanumeric() && item != '#' && item != '_' && item != '-' && item != '/');
        let Some(tag) = trimmed.strip_prefix('#') else {
            continue;
        };
        if tag.len() >= 2
            && tag.len() <= 48
            && tag.chars().next().is_some_and(|item| item.is_ascii_alphanumeric())
            && tag.chars().all(|item| item.is_ascii_alphanumeric() || item == '_' || item == '-' || item == '/')
        {
            tags.insert(tag.to_string());
        }
        if tags.len() >= 10 {
            break;
        }
    }
    let mut tags = tags.into_iter().collect::<Vec<_>>();
    tags.sort();
    tags
}

fn read_graph_notes(root: &Path) -> (Vec<GraphNote>, bool) {
    let mut paths = Vec::new();
    walk_markdown(root, root, &mut paths);
    let truncated = paths.len() >= MAX_GRAPH_NOTES;
    let mut notes = Vec::new();
    for path in paths {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_NOTE_BYTES {
            continue;
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        notes.push(GraphNote {
            path: graph_relative_path(root, &path),
            byte_size: metadata.len(),
            line_count: content.lines().count(),
            modified_at: metadata
                .modified()
                .ok()
                .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
            preview: graph_preview(&content),
            tags: extract_tags(&content),
            content,
        });
    }
    (notes, truncated)
}

fn read_access_events(root: &Path) -> Vec<serde_json::Value> {
    let paths = [root.join(ACCESS_LOG_PATH), root.join(LEGACY_ACCESS_LOG_PATH)];
    let mut events = Vec::new();
    for path in paths {
        let raw = fs::read_to_string(path).unwrap_or_default();
        for line in raw.lines().filter(|line| !line.trim().is_empty()) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                if value.get("notePath").and_then(serde_json::Value::as_str).is_some()
                    && value.get("accessedAt").and_then(serde_json::Value::as_str).is_some()
                {
                    events.push(value);
                }
            }
        }
    }
    events.sort_by(|left, right| {
        right
            .get("accessedAt")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .cmp(left.get("accessedAt").and_then(serde_json::Value::as_str).unwrap_or(""))
    });
    events.truncate(500);
    events
}

fn resolve_graph_link(target: &str, all_paths: &[String]) -> Option<String> {
    let target_lower = target.trim_end_matches(".md").to_lowercase();
    for path in all_paths {
        let name = path
            .split('/')
            .last()
            .unwrap_or(path)
            .trim_end_matches(".md")
            .to_lowercase();
        if name == target_lower {
            return Some(path.clone());
        }
    }
    for path in all_paths {
        if path.to_lowercase().trim_end_matches(".md").ends_with(&format!("/{target_lower}")) {
            return Some(path.clone());
        }
    }
    None
}

#[tauri::command]
pub(crate) fn brain_graph(vault_path: Option<String>, _force: Option<bool>) -> Result<serde_json::Value, String> {
    let vault = vault_root(vault_path);
    if !vault.is_dir() {
        return Err("Vault path is not a directory.".to_string());
    }
    let (notes, truncated) = read_graph_notes(&vault);
    let accesses = read_access_events(&vault);
    let note_paths = notes.iter().map(|note| note.path.clone()).collect::<Vec<_>>();
    let mut accesses_by_note = HashMap::<String, Vec<serde_json::Value>>::new();
    for event in &accesses {
        if let Some(note_path) = event.get("notePath").and_then(serde_json::Value::as_str) {
            accesses_by_note.entry(note_path.to_string()).or_default().push(event.clone());
        }
    }

    let mut links = Vec::<serde_json::Value>::new();
    let mut unresolved = HashSet::<String>::new();
    for note in &notes {
        for target in extract_wiki_links(&note.content) {
            if let Some(resolved) = resolve_graph_link(&target, &note_paths) {
                links.push(serde_json::json!({ "source": note.path, "target": resolved }));
            } else {
                let id = format!("unresolved:{target}");
                unresolved.insert(id.clone());
                links.push(serde_json::json!({ "source": note.path, "target": id, "unresolved": true }));
            }
        }
    }

    let mut degree = HashMap::<String, (usize, usize)>::new();
    for link in &links {
        let source = link.get("source").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let target = link.get("target").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let source_degree = degree.entry(source).or_insert((0, 0));
        source_degree.1 += 1;
        let target_degree = degree.entry(target).or_insert((0, 0));
        target_degree.0 += 1;
    }

    let mut nodes = notes
        .iter()
        .map(|note| {
            let recent = accesses_by_note.get(&note.path).cloned().unwrap_or_default().into_iter().take(6).collect::<Vec<_>>();
            let mut parts = note.path.split('/').collect::<Vec<_>>();
            let label = parts.pop().unwrap_or(&note.path).trim_end_matches(".md").to_string();
            let folder = if parts.is_empty() { "Vault root".to_string() } else { parts.join("/") };
            let (incoming, outgoing) = degree.get(&note.path).copied().unwrap_or((0, 0));
            serde_json::json!({
                "id": note.path,
                "label": label,
                "folder": folder,
                "tags": note.tags,
                "byteSize": note.byte_size,
                "lineCount": note.line_count,
                "modifiedAt": note.modified_at,
                "preview": note.preview,
                "incoming": incoming,
                "outgoing": outgoing,
                "accessCount": accesses_by_note.get(&note.path).map(Vec::len).unwrap_or(0),
                "lastAccessedAt": recent.first().and_then(|event| event.get("accessedAt")).and_then(serde_json::Value::as_str),
                "recentAccesses": recent,
            })
        })
        .collect::<Vec<_>>();
    for id in unresolved {
        let (incoming, outgoing) = degree.get(&id).copied().unwrap_or((0, 0));
        let label = id.trim_start_matches("unresolved:").to_string();
        nodes.push(serde_json::json!({
            "id": id,
            "label": label,
            "folder": "Unresolved links",
            "tags": [],
            "byteSize": 0,
            "lineCount": 0,
            "preview": "",
            "incoming": incoming,
            "outgoing": outgoing,
            "accessCount": 0,
            "recentAccesses": [],
        }));
    }
    nodes.sort_by(|left, right| {
        let score = |node: &serde_json::Value| {
            node.get("incoming").and_then(serde_json::Value::as_u64).unwrap_or(0)
                + node.get("outgoing").and_then(serde_json::Value::as_u64).unwrap_or(0)
                + node.get("accessCount").and_then(serde_json::Value::as_u64).unwrap_or(0)
        };
        score(right).cmp(&score(left))
    });

    Ok(serde_json::json!({
        "vaultPath": vault.to_string_lossy(),
        "accessLogPath": vault.join(ACCESS_LOG_PATH).to_string_lossy(),
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "nodes": nodes,
        "links": links,
        "recentAccesses": accesses.into_iter().take(24).collect::<Vec<_>>(),
        "truncated": truncated,
    }))
}

#[allow(dead_code)]
fn vault_relative_unused(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[allow(dead_code)]
fn is_sync_conflict_file_unused(name: &str) -> bool {
    name.to_lowercase().contains("sync-conflict-") && name.to_lowercase().ends_with(".md")
}

#[allow(dead_code)]
fn walk_markdown_unused(root: &Path, dir: &Path, output: &mut Vec<PathBuf>) {
    if output.len() >= MAX_GRAPH_NOTES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        if output.len() >= MAX_GRAPH_NOTES {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !GRAPH_SKIPPED_DIRS.contains(&name.as_str()) {
                walk_markdown_unused(root, &path, output);
            }
        } else if path.is_file() && name.to_lowercase().ends_with(".md") && !is_sync_conflict_file_unused(&name) && path.starts_with(root) {
            output.push(path);
        }
    }
}

#[allow(dead_code)]
fn graph_tags(content: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    for part in content.split_whitespace() {
        let tag = part.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '#' && ch != '/' && ch != '_' && ch != '-');
        if let Some(rest) = tag.strip_prefix('#') {
            if rest.len() > 1 && rest.len() <= 48 && rest.chars().next().is_some_and(|ch| ch.is_ascii_alphanumeric()) {
                tags.insert(rest.to_string());
            }
        }
    }
    let mut values = tags.into_iter().collect::<Vec<_>>();
    values.sort();
    values.truncate(10);
    values
}

#[allow(dead_code)]
fn wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else {
            break;
        };
        let raw = &after[..end];
        let target = raw
            .split(['|', '#', '^'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches(".md");
        if !target.is_empty() {
            links.push(target.to_string());
        }
        rest = &after[end + 2..];
    }
    links
}

#[allow(dead_code)]
fn resolve_wiki_link(target: &str, paths: &[String]) -> Option<String> {
    let target = target.trim_end_matches(".md").to_lowercase();
    for path in paths {
        let name = path.rsplit('/').next().unwrap_or("").trim_end_matches(".md").to_lowercase();
        if name == target {
            return Some(path.clone());
        }
    }
    for path in paths {
        if path.trim_end_matches(".md").to_lowercase().ends_with(&format!("/{target}")) {
            return Some(path.clone());
        }
    }
    None
}

#[allow(dead_code)]
fn read_access_events_unused(root: &Path) -> Vec<serde_json::Value> {
    let mut lines = Vec::new();
    for relative in [ACCESS_LOG_PATH, LEGACY_ACCESS_LOG_PATH] {
        let path = root.join(relative);
        if !path.starts_with(root) {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(path) {
            lines.extend(raw.lines().map(str::to_string));
        }
    }
    let mut events = lines
        .iter()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event.get("notePath").and_then(serde_json::Value::as_str).is_some())
        .collect::<Vec<_>>();
    events.sort_by(|left, right| {
        right.get("accessedAt").and_then(serde_json::Value::as_str).unwrap_or("").cmp(left.get("accessedAt").and_then(serde_json::Value::as_str).unwrap_or(""))
    });
    events.truncate(500);
    events
}

#[allow(dead_code)]
fn brain_graph_unused(vault_path: Option<String>, _force: Option<bool>) -> Result<serde_json::Value, String> {
    let root = vault_root(vault_path);
    if !root.is_dir() {
        return Err("Vault path is not a directory.".to_string());
    }
    let mut paths = Vec::new();
    walk_markdown_unused(&root, &root, &mut paths);
    let truncated = paths.len() >= MAX_GRAPH_NOTES;
    let mut notes = Vec::<(String, String, u64, Vec<String>)>::new();
    for path in paths {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_NOTE_BYTES {
            continue;
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        notes.push((vault_relative_unused(&root, &path), content.clone(), metadata.len(), graph_tags(&content)));
    }
    let note_paths = notes.iter().map(|(path, _, _, _)| path.clone()).collect::<Vec<_>>();
    let accesses = read_access_events_unused(&root);
    let mut accesses_by_note = HashMap::<String, Vec<serde_json::Value>>::new();
    for event in &accesses {
        if let Some(note_path) = event.get("notePath").and_then(serde_json::Value::as_str) {
            accesses_by_note.entry(note_path.to_string()).or_default().push(event.clone());
        }
    }
    let mut links = Vec::new();
    let mut unresolved = HashSet::new();
    for (path, content, _, _) in &notes {
        for target in wiki_links(content) {
            if let Some(resolved) = resolve_wiki_link(&target, &note_paths) {
                links.push(serde_json::json!({ "source": path, "target": resolved }));
            } else {
                let id = format!("unresolved:{target}");
                unresolved.insert(id.clone());
                links.push(serde_json::json!({ "source": path, "target": id, "unresolved": true }));
            }
        }
    }
    let mut degree = HashMap::<String, (i64, i64)>::new();
    for link in &links {
        let source = link.get("source").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let target = link.get("target").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        degree.entry(source).and_modify(|item| item.1 += 1).or_insert((0, 1));
        degree.entry(target).and_modify(|item| item.0 += 1).or_insert((1, 0));
    }
    let mut nodes = Vec::new();
    for (path, _, byte_size, tags) in notes {
        let recent = accesses_by_note.get(&path).cloned().unwrap_or_default().into_iter().take(6).collect::<Vec<_>>();
        let access_count = accesses_by_note.get(&path).map(Vec::len).unwrap_or(0);
        let mut parts = path.split('/').collect::<Vec<_>>();
        let file = parts.pop().unwrap_or(&path);
        let label = file.trim_end_matches(".md").to_string();
        let folder = if parts.is_empty() { "Vault root".to_string() } else { parts.join("/") };
        let (incoming, outgoing) = degree.get(&path).copied().unwrap_or((0, 0));
        nodes.push(serde_json::json!({
            "id": path,
            "label": label,
            "folder": folder,
            "tags": tags,
            "byteSize": byte_size,
            "incoming": incoming,
            "outgoing": outgoing,
            "accessCount": access_count,
            "lastAccessedAt": recent.first().and_then(|event| event.get("accessedAt")).cloned().unwrap_or(serde_json::Value::Null),
            "recentAccesses": recent
        }));
    }
    for id in unresolved {
        let (incoming, _) = degree.get(&id).copied().unwrap_or((0, 0));
        let label = id.trim_start_matches("unresolved:").to_string();
        nodes.push(serde_json::json!({
            "id": id,
            "label": label,
            "folder": "Unresolved links",
            "tags": [],
            "byteSize": 0,
            "incoming": incoming,
            "outgoing": 0,
            "accessCount": 0,
            "recentAccesses": []
        }));
    }
    nodes.sort_by(|left, right| {
        let score = |node: &serde_json::Value| {
            node.get("incoming").and_then(serde_json::Value::as_i64).unwrap_or(0)
                + node.get("outgoing").and_then(serde_json::Value::as_i64).unwrap_or(0)
                + node.get("accessCount").and_then(serde_json::Value::as_i64).unwrap_or(0)
        };
        score(right).cmp(&score(left))
    });
    Ok(serde_json::json!({
        "vaultPath": root.to_string_lossy(),
        "accessLogPath": root.join(ACCESS_LOG_PATH).to_string_lossy(),
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "nodes": nodes,
        "links": links,
        "recentAccesses": accesses.into_iter().take(24).collect::<Vec<_>>(),
        "truncated": truncated
    }))
}
