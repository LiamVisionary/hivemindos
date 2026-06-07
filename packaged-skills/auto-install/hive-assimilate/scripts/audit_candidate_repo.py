#!/usr/bin/env python3
"""Heuristic security audit for a Hive candidate repo before assimilation.

This script is intentionally conservative. It clones or reads source, never installs
dependencies, and flags patterns that need human review before code reuse.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


TEXT_EXTENSIONS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".sh",
    ".bash",
    ".zsh",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".php",
    ".java",
    ".kt",
    ".swift",
    ".md",
    ".toml",
    ".lock",
    ".gradle",
}
SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", "coverage", ".expo"}
BLOCK_PATTERNS = [
    ("destructive filesystem command", re.compile(r"\brm\s+-rf\s+[/~*$]|\bchmod\s+-R\s+777\b", re.I)),
    ("crypto miner hint", re.compile(r"(xmrig|stratum\+tcp|monero|coinhive|minerd)", re.I)),
]
MEDIUM_PATTERNS = [
    ("remote code execution pipe", re.compile(r"(curl|wget)\b.+\|\s*(bash|sh|zsh|python|node)", re.I)),
    ("secret/network automation hint", re.compile(r"(GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET|PRIVATE_KEY|process\.env).{0,120}(fetch|axios|curl|wget|request)", re.I | re.S)),
    ("dynamic eval", re.compile(r"\b(eval|Function)\s*\(", re.I)),
    ("node child process", re.compile(r"require\(['\"]child_process['\"]\)|from ['\"]child_process['\"]", re.I)),
    ("base64 decode", re.compile(r"(atob|Buffer\.from)\s*\(.{0,80}base64|base64\s+-d", re.I | re.S)),
    ("remote script reference", re.compile(r"https?://[^\\s'\"`]+\\.(sh|js|py|rb)", re.I)),
    ("github actions secret usage", re.compile(r"\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}", re.I)),
]
BINARY_EXTENSIONS = {".exe", ".dll", ".dylib", ".so", ".bin", ".app", ".pkg", ".dmg"}


@dataclass
class Finding:
    severity: str
    title: str
    path: str
    line: int
    excerpt: str


def clone_repo(repo: str, timeout: int) -> Path:
    if shutil.which("gh") is None:
        raise SystemExit("gh CLI is required to audit GitHub repos. Pass a local path instead.")
    root = Path(tempfile.mkdtemp(prefix="candidate-audit-"))
    dest = root / repo.replace("/", "-")
    try:
        subprocess.run(
            ["gh", "repo", "clone", repo, str(dest), "--", "--depth", "1"],
            check=True,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f"Clone timed out after {timeout}s: {repo}")
    except subprocess.CalledProcessError as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f"Clone failed: {exc.stderr.strip()}")
    return dest


def iter_files(root: Path, max_file_bytes: int, selected_paths: list[Path] | None = None) -> tuple[list[Path], list[Finding]]:
    files: list[Path] = []
    findings: list[Finding] = []
    scan_roots = selected_paths or [root]
    for scan_root in scan_roots:
        if not scan_root.exists():
            findings.append(Finding("high", "selected audit path does not exist", str(scan_root), 1, ""))
            continue
        candidates = [scan_root] if scan_root.is_file() else scan_root.rglob("*")
        for path in candidates:
            collect_file(root, path, max_file_bytes, files, findings)
    return files, findings


def collect_file(root: Path, path: Path, max_file_bytes: int, files: list[Path], findings: list[Finding]) -> None:
        if any(part in SKIP_DIRS for part in path.parts):
            return
        if not path.is_file():
            return
        rel = path.relative_to(root)
        suffix = path.suffix.lower()
        try:
            size = path.stat().st_size
        except OSError:
            return
        if suffix in BINARY_EXTENSIONS:
            findings.append(Finding("medium", "checked-in binary artifact", str(rel), 1, f"{size} bytes"))
            return
        if size > max_file_bytes:
            findings.append(Finding("medium", "large opaque file skipped", str(rel), 1, f"{size} bytes"))
            return
        if suffix in TEXT_EXTENSIONS or path.name in {"Dockerfile", "Makefile", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"}:
            files.append(path)


def scan_text(root: Path, path: Path) -> list[Finding]:
    rel = str(path.relative_to(root))
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    findings: list[Finding] = []
    for title, pattern in BLOCK_PATTERNS:
        for finding in pattern_findings("high", title, rel, text, pattern):
            findings.append(finding)
    for title, pattern in MEDIUM_PATTERNS:
        for finding in pattern_findings("medium", title, rel, text, pattern):
            findings.append(finding)
    if path.name == "package.json":
        findings.extend(scan_package_json(rel, text))
    return findings


def pattern_findings(severity: str, title: str, rel: str, text: str, pattern: re.Pattern[str]) -> list[Finding]:
    findings: list[Finding] = []
    for match in pattern.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        excerpt = re.sub(r"\s+", " ", text[match.start() : match.end()]).strip()[:220]
        findings.append(Finding(severity, title, rel, line, excerpt))
    return findings


def scan_package_json(rel: str, text: str) -> list[Finding]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [Finding("medium", "invalid package.json", rel, 1, "Could not parse JSON")]
    findings: list[Finding] = []
    scripts = data.get("scripts") or {}
    if isinstance(scripts, dict):
        for name in ("preinstall", "install", "postinstall", "prepare"):
            if name in scripts:
                findings.append(classify_lifecycle_script(name, str(scripts[name]), rel))
        for name, value in scripts.items():
            if isinstance(value, str) and re.search(r"(curl|wget|chmod|sudo|rm\s+-rf|base64|eval)", value, re.I):
                findings.append(Finding("medium", f"suspicious npm script: {name}", rel, 1, value[:220]))
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        deps = data.get(section) or {}
        if isinstance(deps, dict):
            for dep in deps:
                if re.search(r"(crypto|miner|xmrig|backdoor|malware)", dep, re.I):
                    findings.append(Finding("medium", f"suspicious dependency name in {section}", rel, 1, dep))
    return findings


def classify_lifecycle_script(name: str, value: str, rel: str) -> Finding:
    """Only block lifecycle scripts that are close to obviously malicious.

    Normal packages often use `prepare` for Husky or build steps. That should be
    review context, not a hard stop. Remote execution, destructive commands,
    obfuscation, or miner strings inside install hooks are strong enough to block.
    """
    block = re.search(
        r"(curl|wget)\b.+\|\s*(bash|sh|zsh|python|node)|\brm\s+-rf\s+[/~*$]|\bchmod\s+-R\s+777\b|"
        r"\b(eval|Function)\s*\(|base64\s+-d|xmrig|stratum\+tcp|monero|coinhive|minerd",
        value,
        re.I,
    )
    severity = "high" if block else "medium"
    title = f"{'dangerous' if block else 'review'} npm lifecycle script: {name}"
    return Finding(severity, title, rel, 1, value[:220])


def print_report(root: Path, findings: list[Finding]) -> int:
    high = [f for f in findings if f.severity == "high"]
    medium = [f for f in findings if f.severity == "medium"]
    low = [f for f in findings if f.severity == "low"]
    print(f"Audit target: {root}")
    print(f"Findings: high={len(high)} medium={len(medium)} low={len(low)}")
    for finding in findings[:80]:
        print(f"- [{finding.severity.upper()}] {finding.title} ({finding.path}:{finding.line})")
        if finding.excerpt:
            print(f"  {finding.excerpt}")
    if len(findings) > 80:
        print(f"... {len(findings) - 80} more findings omitted")
    if high:
        print("Result: BLOCK. High findings are reserved for near-definitive malicious/destructive patterns.")
        return 2
    if medium:
        print("Result: REVIEW. Medium findings are caution signals, not automatic blockers.")
        return 1
    print("Result: PASS heuristic audit. Still inspect manually before substantial reuse.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="GitHub repo owner/name or local path")
    parser.add_argument("--path", action="append", default=[], help="Relative path to audit. Repeat for focused audits.")
    parser.add_argument("--clone-timeout", type=int, default=45)
    parser.add_argument("--max-file-bytes", type=int, default=750_000)
    args = parser.parse_args()

    cleanup_parent: Path | None = None
    target_path = Path(args.target).expanduser()
    if target_path.exists():
        root = target_path.resolve()
    else:
        root = clone_repo(args.target, args.clone_timeout)
        cleanup_parent = root.parent
    try:
        selected_paths = [(root / item).resolve() for item in args.path] if args.path else None
        if selected_paths:
            for selected in selected_paths:
                try:
                    selected.relative_to(root)
                except ValueError:
                    raise SystemExit(f"Selected path escapes repo root: {selected}")
        files, findings = iter_files(root, args.max_file_bytes, selected_paths)
        for path in files:
            findings.extend(scan_text(root, path))
        findings.sort(key=lambda f: {"high": 0, "medium": 1, "low": 2}.get(f.severity, 9))
        return print_report(root, findings)
    finally:
        if cleanup_parent and os.environ.get("KEEP_CANDIDATE_AUDIT") != "1":
            shutil.rmtree(cleanup_parent, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
