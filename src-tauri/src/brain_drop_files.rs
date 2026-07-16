use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 20;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SCAN_FILES: usize = 500;
const MAX_DIRECTORY_DEPTH: usize = 12;
const SUPPORTED_EXTENSIONS: [&str; 16] = [
    "md", "markdown", "txt", "csv", "json", "xml", "html", "htm", "pdf", "docx", "pptx",
    "xlsx", "xls", "epub", "msg", "zip",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrainDropDocument {
    name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrainDropReadResult {
    documents: Vec<BrainDropDocument>,
    skipped: usize,
    truncated: bool,
}

struct Candidate {
    path: PathBuf,
    source_name: String,
}

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| SUPPORTED_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.starts_with('.'))
        .unwrap_or(false)
}

fn display_source_name(root: &Path, path: &Path) -> String {
    if root.is_file() {
        return path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
    }
    let root_name = root
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
    format!("{root_name}/{}", relative.replace('\\', "/"))
}

fn collect_candidates(
    root: &Path,
    path: &Path,
    depth: usize,
    candidates: &mut Vec<Candidate>,
    skipped: &mut usize,
) {
    if candidates.len() >= MAX_SCAN_FILES || depth > MAX_DIRECTORY_DEPTH || hidden(path) {
        *skipped += 1;
        return;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        *skipped += 1;
        return;
    };
    if metadata.file_type().is_symlink() {
        *skipped += 1;
        return;
    }
    if metadata.is_file() {
        if supported(path) {
            candidates.push(Candidate {
                path: path.to_path_buf(),
                source_name: display_source_name(root, path),
            });
        } else {
            *skipped += 1;
        }
        return;
    }
    if !metadata.is_dir() {
        *skipped += 1;
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        *skipped += 1;
        return;
    };
    let mut paths = entries.filter_map(Result::ok).map(|entry| entry.path()).collect::<Vec<_>>();
    paths.sort_by_key(|entry| entry.to_string_lossy().to_lowercase());
    for child in paths {
        collect_candidates(root, &child, depth + 1, candidates, skipped);
        if candidates.len() >= MAX_SCAN_FILES {
            break;
        }
    }
}

fn read_documents(paths: Vec<String>) -> Result<BrainDropReadResult, String> {
    if paths.is_empty() {
        return Err("Choose at least one file or folder.".to_string());
    }
    if paths.len() > 64 {
        return Err("Choose at most 64 files or folders at once.".to_string());
    }

    let mut candidates = Vec::new();
    let mut skipped = 0;
    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if !path.is_absolute() {
            skipped += 1;
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            skipped += 1;
            continue;
        };
        if metadata.file_type().is_symlink() {
            skipped += 1;
            continue;
        }
        let Ok(canonical) = path.canonicalize() else {
            skipped += 1;
            continue;
        };
        collect_candidates(&canonical, &canonical, 0, &mut candidates, &mut skipped);
    }

    let mut documents = Vec::new();
    let mut total_bytes = 0u64;
    let mut truncated = candidates.len() >= MAX_SCAN_FILES;
    for candidate in candidates {
        if documents.len() >= MAX_FILES {
            skipped += 1;
            truncated = true;
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&candidate.path) else {
            skipped += 1;
            continue;
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > MAX_FILE_BYTES
            || total_bytes + metadata.len() > MAX_TOTAL_BYTES
        {
            skipped += 1;
            continue;
        }
        let Ok(bytes) = fs::read(&candidate.path) else {
            skipped += 1;
            continue;
        };
        total_bytes += bytes.len() as u64;
        documents.push(BrainDropDocument {
            name: candidate.source_name,
            mime_type: "application/octet-stream".to_string(),
            data_base64: STANDARD.encode(bytes),
        });
    }

    Ok(BrainDropReadResult {
        documents,
        skipped,
        truncated,
    })
}

#[tauri::command]
pub(crate) fn read_local_brain_drop_documents(paths: Vec<String>) -> Result<BrainDropReadResult, String> {
    read_documents(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn recursively_reads_supported_documents_and_skips_other_files() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("hivemind-brain-drop-{unique}"));
        let nested = root.join("Nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("Guide.pdf"), b"pdf").unwrap();
        fs::write(nested.join("Notes.txt"), b"notes").unwrap();
        fs::write(nested.join("Photo.png"), b"image").unwrap();

        let result = read_documents(vec![root.to_string_lossy().to_string()]).unwrap();
        assert_eq!(result.documents.len(), 2);
        assert_eq!(result.documents[0].name, format!("{}/Guide.pdf", root.file_name().unwrap().to_string_lossy()));
        assert_eq!(result.documents[1].name, format!("{}/Nested/Notes.txt", root.file_name().unwrap().to_string_lossy()));
        assert_eq!(result.skipped, 1);
        assert!(!result.truncated);

        fs::remove_dir_all(root).unwrap();
    }
}
