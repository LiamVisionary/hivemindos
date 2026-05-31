use std::{path::PathBuf, process::Command};

fn git(repo_root: &PathBuf, args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn set_env(key: &str, value: &str) {
    println!("cargo:rustc-env={key}={}", value.replace(['\n', '\r'], " "));
}

fn main() {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    println!("cargo:rerun-if-changed={}", repo_root.join(".git/HEAD").display());
    println!("cargo:rerun-if-changed={}", repo_root.join(".git/index").display());

    let commit = git(&repo_root, &["rev-parse", "HEAD"]);
    let branch = git(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let dirty = !git(&repo_root, &["status", "--porcelain"]).is_empty();

    set_env("HIVEMINDOS_GIT_COMMIT", &commit);
    set_env("HIVEMINDOS_GIT_BRANCH", &branch);
    set_env("HIVEMINDOS_GIT_DIRTY", if dirty { "true" } else { "false" });

    tauri_build::build()
}
