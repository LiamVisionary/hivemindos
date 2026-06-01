use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const DEFAULT_KANBAN_FOLDER: &str = "Operations/Work Board";
const KANBAN_COLUMNS: [(&str, &str, &str); 6] = [
    ("ideas", "Ideas", "Capture rough thoughts. Nothing runs from here."),
    ("ready", "Waiting for Queen", "Ready for the Queen Bee to assign or take on."),
    ("working", "Working", "Claimed by an agent and actively being handled."),
    ("needs-human", "Needs You", "Blocked on access, approval, or a decision."),
    ("done", "Done", "Finished with notes, evidence, or a result."),
    ("archived", "Archived", "Hidden from the main board, kept for history."),
];

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

fn slug(input: Option<String>) -> Result<String, String> {
    let value = input.unwrap_or_else(|| "default".to_string()).trim().to_lowercase();
    if value.len() > 64
        || !value.chars().next().is_some_and(|ch| ch.is_ascii_alphanumeric())
        || !value.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err("Board slug must start with a letter or number and contain only lowercase letters, numbers, hyphens, or underscores.".to_string());
    }
    Ok(value)
}

fn kanban_folder(input: Option<String>) -> String {
    input
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_KANBAN_FOLDER.to_string())
        .trim_matches('/')
        .to_string()
}

fn storage(slug: &str, vault_path: Option<String>, folder: Option<String>) -> Result<Value, String> {
    let vault = vault_path.filter(|item| !item.trim().is_empty()).unwrap_or_else(|| DEFAULT_VAULT.to_string());
    let vault_root = expand_home(&vault).canonicalize().unwrap_or_else(|_| expand_home(&vault));
    if !vault_root.is_dir() {
        return Err("Kanban vault path is unavailable: Vault path is not a directory.".to_string());
    }
    let root = vault_root.join(kanban_folder(folder));
    let boards_root = root.join("boards");
    let file = board_path(&root, &boards_root, slug);
    Ok(serde_json::json!({
        "source": "obsidian",
        "root": root.to_string_lossy(),
        "boardsRoot": boards_root.to_string_lossy(),
        "file": file.to_string_lossy()
    }))
}

fn board_path(root: &Path, boards_root: &Path, slug: &str) -> PathBuf {
    if slug == "default" {
        root.join("kanban.json")
    } else {
        boards_root.join(slug).join("kanban.json")
    }
}

fn read_board_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn board_meta(board: &Value, slug: &str) -> Value {
    let mut meta = board.get("meta").cloned().unwrap_or_else(|| serde_json::json!({}));
    if let Some(object) = meta.as_object_mut() {
        object.insert("slug".to_string(), Value::String(slug.to_string()));
        object.entry("name".to_string()).or_insert_with(|| Value::String(slug.to_string()));
    }
    meta
}

fn list_boards(storage: &Value) -> Vec<Value> {
    let Some(root) = storage.get("root").and_then(Value::as_str) else {
        return vec![];
    };
    let Some(boards_root) = storage.get("boardsRoot").and_then(Value::as_str) else {
        return vec![];
    };
    let mut boards = Vec::new();
    let default_path = PathBuf::from(root).join("kanban.json");
    let default_board = read_board_file(&default_path).unwrap_or_else(|_| serde_json::json!({
        "meta": { "slug": "default", "name": "Default", "createdAt": 0, "updatedAt": 0 },
        "tasks": [],
        "comments": [],
        "links": [],
        "events": [],
        "runs": []
    }));
    boards.push(board_meta(&default_board, "default"));
    if let Ok(entries) = fs::read_dir(boards_root) {
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "default" || name == "_archived" || !entry.path().is_dir() {
                continue;
            }
            if let Ok(board) = read_board_file(&entry.path().join("kanban.json")) {
                boards.push(board_meta(&board, &name));
            }
        }
    }
    boards.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    boards
}

fn task_matches(task: &Value, include_archived: bool, tenant: &Option<String>, assignee: &Option<String>, query: &Option<String>) -> bool {
    let status = task.get("status").and_then(Value::as_str).unwrap_or("ideas");
    if !include_archived && status == "archived" {
        return false;
    }
    if let Some(value) = tenant {
        if task.get("tenant").and_then(Value::as_str).unwrap_or("") != value {
            return false;
        }
    }
    if let Some(value) = assignee {
        if task.get("assignee").and_then(Value::as_str).unwrap_or("") != value {
            return false;
        }
    }
    if let Some(value) = query {
        let needle = value.to_lowercase();
        let title = task.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase();
        let body = task.get("body").and_then(Value::as_str).unwrap_or("").to_lowercase();
        if !title.contains(&needle) && !body.contains(&needle) {
            return false;
        }
    }
    true
}

fn group_tasks(tasks: &[Value], include_archived: bool) -> Vec<Value> {
    KANBAN_COLUMNS
        .iter()
        .filter(|(status, _, _)| include_archived || *status != "archived")
        .map(|(status, title, description)| {
            let grouped = tasks
                .iter()
                .filter(|task| task.get("status").and_then(Value::as_str).unwrap_or("ideas") == *status)
                .cloned()
                .collect::<Vec<_>>();
            serde_json::json!({ "id": status, "title": title, "description": description, "tasks": grouped })
        })
        .collect()
}

fn trim_board(mut board: Value, tasks: Vec<Value>) -> Value {
    let task_ids = tasks
        .iter()
        .filter_map(|task| task.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<BTreeSet<_>>();
    let trim_by_task = |items: Option<&Vec<Value>>, limit: usize| {
        let mut values = items
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.get("taskId").and_then(Value::as_str).map(|id| task_ids.contains(id)).unwrap_or(true))
            .collect::<Vec<_>>();
        values.sort_by(|left, right| {
            right.get("createdAt").and_then(Value::as_i64).unwrap_or(0).cmp(&left.get("createdAt").and_then(Value::as_i64).unwrap_or(0))
        });
        values.truncate(limit);
        values
    };
    let comments = trim_by_task(board.get("comments").and_then(Value::as_array), 120);
    let events = trim_by_task(board.get("events").and_then(Value::as_array), 160);
    let runs = trim_by_task(board.get("runs").and_then(Value::as_array), 80);
    if let Some(object) = board.as_object_mut() {
        object.insert("tasks".to_string(), Value::Array(tasks));
        object.insert("comments".to_string(), Value::Array(comments));
        object.insert("events".to_string(), Value::Array(events));
        object.insert("runs".to_string(), Value::Array(runs));
    }
    board
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn kanban_read(
    board: Option<String>,
    vault_path: Option<String>,
    kanban_folder: Option<String>,
    boards_only: Option<bool>,
    include_boards: Option<bool>,
    include_archived: Option<bool>,
    tenant: Option<String>,
    assignee: Option<String>,
    query: Option<String>,
) -> Result<Value, String> {
    let slug = slug(board)?;
    let storage = storage(&slug, vault_path, kanban_folder)?;
    if boards_only == Some(true) {
        return Ok(serde_json::json!({ "ok": true, "boards": list_boards(&storage), "storage": storage }));
    }
    let file = storage.get("file").and_then(Value::as_str).ok_or_else(|| "Kanban storage file is unavailable.".to_string())?;
    let board_value = read_board_file(Path::new(file)).unwrap_or_else(|_| serde_json::json!({
        "meta": { "slug": slug, "name": if slug == "default" { "Default".to_string() } else { slug.clone() }, "createdAt": 0, "updatedAt": 0 },
        "tasks": [],
        "comments": [],
        "links": [],
        "events": [],
        "runs": []
    }));
    let all_tasks = board_value.get("tasks").and_then(Value::as_array).cloned().unwrap_or_default();
    let filtered_tasks = all_tasks
        .iter()
        .filter(|task| task_matches(task, include_archived.unwrap_or(false), &tenant, &assignee, &query))
        .cloned()
        .collect::<Vec<_>>();
    let tenants = all_tasks.iter().filter_map(|task| task.get("tenant").and_then(Value::as_str).map(str::to_string)).collect::<BTreeSet<_>>();
    let assignees = all_tasks.iter().filter_map(|task| task.get("assignee").and_then(Value::as_str).map(str::to_string)).collect::<BTreeSet<_>>();
    Ok(serde_json::json!({
        "ok": true,
        "boards": if include_boards.unwrap_or(true) { Value::Array(list_boards(&storage)) } else { Value::Null },
        "board": trim_board(board_value, filtered_tasks.clone()),
        "columns": group_tasks(&filtered_tasks, include_archived.unwrap_or(false)),
        "tenants": tenants.into_iter().collect::<Vec<_>>(),
        "assignees": assignees.into_iter().collect::<Vec<_>>(),
        "storage": storage
    }))
}
