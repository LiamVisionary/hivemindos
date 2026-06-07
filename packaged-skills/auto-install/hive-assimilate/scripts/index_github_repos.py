#!/usr/bin/env python3
"""Build an Obsidian-readable GitHub repo graph and JSONL retrieval index."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_VAULT = Path.home() / "Documents" / "hive-assimilate-vault"
DEFAULT_INDEX = Path.home() / ".codex" / "hive-assimilate" / "index"
MANIFEST_NAMES = {
    "package.json",
    "app.json",
    "app.config.js",
    "app.config.ts",
    "expo-env.d.ts",
    "requirements.txt",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pubspec.yaml",
    "Podfile",
}
README_RE = re.compile(r"^readme(\..*)?$", re.I)


@dataclass
class RepoRecord:
    name: str
    full_name: str
    url: str = ""
    description: str = ""
    primary_language: str = ""
    topics: list[str] = field(default_factory=list)
    stars: int | None = None
    pushed_at: str = ""
    license_name: str = ""
    is_private: bool | None = None
    is_fork: bool | None = None
    local_path: Path | None = None
    packages: list[str] = field(default_factory=list)
    frameworks: list[str] = field(default_factory=list)
    readme: str = ""
    manifests: dict[str, str] = field(default_factory=dict)


def run_json(cmd: list[str]) -> object:
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return json.loads(completed.stdout)


def run_text(cmd: list[str], cwd: Path | None = None) -> str:
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True, cwd=cwd)
    return completed.stdout.strip()


def gh_available() -> bool:
    return shutil.which("gh") is not None


def repo_from_gh_view(repo: str) -> RepoRecord:
    fields = [
        "name",
        "nameWithOwner",
        "description",
        "url",
        "primaryLanguage",
        "repositoryTopics",
        "stargazerCount",
        "pushedAt",
        "licenseInfo",
        "isPrivate",
        "isFork",
    ]
    data = run_json(["gh", "repo", "view", repo, "--json", ",".join(fields)])
    return normalize_gh_repo(data)


def repos_from_gh_list(owner_flag: str, owner: str, limit: int) -> list[RepoRecord]:
    fields = [
        "name",
        "nameWithOwner",
        "description",
        "url",
        "primaryLanguage",
        "repositoryTopics",
        "stargazerCount",
        "pushedAt",
        "licenseInfo",
        "isPrivate",
        "isFork",
    ]
    data = run_json(
        [
            "gh",
            "repo",
            "list",
            owner,
            owner_flag,
            "--limit",
            str(limit),
            "--json",
            ",".join(fields),
        ]
    )
    return [normalize_gh_repo(item) for item in data]


def repos_from_authenticated(limit: int) -> list[RepoRecord]:
    repos: list[RepoRecord] = []
    page = 1
    while len(repos) < limit:
        data = run_json(
            [
                "gh",
                "api",
                "-X",
                "GET",
                "/user/repos",
                "-f",
                "affiliation=owner,collaborator,organization_member",
                "-f",
                "visibility=all",
                "-f",
                "per_page=100",
                "-f",
                f"page={page}",
            ]
        )
        if not data:
            break
        for item in data:  # type: ignore[union-attr]
            repos.append(normalize_rest_repo(item))
            if len(repos) >= limit:
                break
        page += 1
    return repos


def normalize_gh_repo(data: object) -> RepoRecord:
    item = dict(data)  # type: ignore[arg-type]
    lang = item.get("primaryLanguage") or {}
    license_info = item.get("licenseInfo") or {}
    topics = item.get("repositoryTopics") or []
    return RepoRecord(
        name=item.get("name", ""),
        full_name=item.get("nameWithOwner", item.get("name", "")),
        url=item.get("url", ""),
        description=item.get("description") or "",
        primary_language=lang.get("name", "") if isinstance(lang, dict) else str(lang),
        topics=[t.get("name", "") for t in topics if isinstance(t, dict) and t.get("name")],
        stars=item.get("stargazerCount"),
        pushed_at=item.get("pushedAt") or "",
        license_name=license_info.get("name", "") if isinstance(license_info, dict) else "",
        is_private=item.get("isPrivate"),
        is_fork=item.get("isFork"),
    )


def normalize_rest_repo(data: object) -> RepoRecord:
    item = dict(data)  # type: ignore[arg-type]
    owner = item.get("owner") or {}
    license_info = item.get("license") or {}
    return RepoRecord(
        name=item.get("name", ""),
        full_name=item.get("full_name", f"{owner.get('login', '')}/{item.get('name', '')}".strip("/")),
        url=item.get("html_url", ""),
        description=item.get("description") or "",
        primary_language=item.get("language") or "",
        topics=item.get("topics") or [],
        stars=item.get("stargazers_count"),
        pushed_at=item.get("pushed_at") or "",
        license_name=license_info.get("name", "") if isinstance(license_info, dict) else "",
        is_private=item.get("private"),
        is_fork=item.get("fork"),
    )


def repo_from_local(path: Path) -> RepoRecord:
    path = path.resolve()
    name = path.name
    url = ""
    full_name = name
    try:
        url = run_text(["git", "remote", "get-url", "origin"], cwd=path)
        match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
        if match:
            full_name = match.group(1)
            url = "https://github.com/" + full_name
    except subprocess.CalledProcessError:
        pass
    return RepoRecord(name=name, full_name=full_name, url=url, local_path=path)


def clone_repo(repo: RepoRecord, clone_root: Path, timeout: int) -> Path | None:
    if not repo.full_name or not gh_available():
        return None
    dest = clone_root / safe_name(repo.full_name)
    if dest.exists():
        return dest
    try:
        subprocess.run(
            ["gh", "repo", "clone", repo.full_name, str(dest), "--", "--depth", "1"],
            check=True,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        return dest
    except subprocess.CalledProcessError as exc:
        print(f"warn: could not clone {repo.full_name}: {exc.stderr.strip()}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"warn: timed out cloning {repo.full_name} after {timeout}s", file=sys.stderr)
        shutil.rmtree(dest, ignore_errors=True)
        return None


def read_repo_files(repo: RepoRecord, root: Path) -> None:
    for path in root.iterdir():
        if path.is_file() and README_RE.match(path.name):
            repo.readme = read_limited(path, 20000)
            break

    for manifest in root.rglob("*"):
        if ".git" in manifest.parts or not manifest.is_file():
            continue
        if manifest.name in MANIFEST_NAMES and len(repo.manifests) < 20:
            try:
                rel = str(manifest.relative_to(root))
            except ValueError:
                rel = manifest.name
            repo.manifests[rel] = read_limited(manifest, 12000)

    repo.packages = sorted(extract_packages(repo.manifests))
    repo.frameworks = sorted(infer_frameworks(repo))


def read_limited(path: Path, limit: int) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[:limit]


def extract_packages(manifests: dict[str, str]) -> set[str]:
    packages: set[str] = set()
    for rel, text in manifests.items():
        if rel.endswith("package.json"):
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue
            for section in ("dependencies", "devDependencies", "peerDependencies"):
                deps = data.get(section) or {}
                if isinstance(deps, dict):
                    packages.update(deps.keys())
        elif rel.endswith("requirements.txt"):
            for line in text.splitlines():
                match = re.match(r"\s*([A-Za-z0-9_.-]+)", line)
                if match:
                    packages.add(match.group(1))
        elif rel.endswith("go.mod"):
            for line in text.splitlines():
                if line.startswith("require "):
                    packages.add(line.split()[1])
    return packages


def infer_frameworks(repo: RepoRecord) -> set[str]:
    haystack = " ".join(
        [
            repo.description,
            repo.primary_language,
            " ".join(repo.topics),
            " ".join(repo.packages),
            " ".join(repo.manifests.keys()),
        ]
    ).lower()
    mapping = {
        "Expo": ["expo", "expo-av", "expo-router"],
        "React Native": ["react-native", "react native"],
        "React": ["react", "vite", "next"],
        "Next.js": ["next", "nextjs"],
        "OpenAI": ["openai", "gpt", "chatgpt"],
        "Voice/TTS": ["tts", "speech", "elevenlabs", "expo-av", "audio"],
        "Animation": ["reanimated", "lottie", "live2d", "animation"],
        "Tailwind": ["tailwind"],
        "Python": ["python", "fastapi", "django", "flask"],
    }
    found = set()
    for label, needles in mapping.items():
        if any(needle in haystack for needle in needles):
            found.add(label)
    return found


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "repo"


def concept_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).title()


def wiki(value: str) -> str:
    escaped = value.replace("|", "-").replace("[", "(").replace("]", ")")
    return f"[[{escaped}]]"


def write_repo_note(repo: RepoRecord, vault: Path) -> Path:
    repos_dir = vault / "Repos"
    repos_dir.mkdir(parents=True, exist_ok=True)
    note_path = repos_dir / f"{safe_name(repo.full_name)}.md"
    concepts = sorted(set(repo.topics + repo.frameworks + ([repo.primary_language] if repo.primary_language else [])))
    body = [
        "---",
        f"repo: {json.dumps(repo.full_name)}",
        f"aliases: [{json.dumps(repo.full_name)}]",
        f"url: {json.dumps(repo.url)}",
        f"language: {json.dumps(repo.primary_language)}",
        f"license: {json.dumps(repo.license_name)}",
        f"stars: {repo.stars if repo.stars is not None else 'null'}",
        f"pushed_at: {json.dumps(repo.pushed_at)}",
        f"private: {str(repo.is_private).lower() if repo.is_private is not None else 'null'}",
        f"fork: {str(repo.is_fork).lower() if repo.is_fork is not None else 'null'}",
        "---",
        "",
        f"# {repo.full_name}",
        "",
        repo.description or "No description indexed.",
        "",
        "## Concepts",
        "",
        " ".join(wiki(concept_name(c)) for c in concepts) or "None indexed.",
        "",
        "## Packages",
        "",
        ", ".join(f"`{p}`" for p in repo.packages[:80]) or "None indexed.",
        "",
        "## Assimilation Notes",
        "",
        "- Reusable parts: TBD after inspection.",
        "- Extraction cost: TBD.",
        "- License check: " + (repo.license_name or "unknown"),
        "",
        "## README Excerpt",
        "",
        trim_markdown(repo.readme, 4000) or "No README indexed.",
    ]
    note_path.write_text("\n".join(body).rstrip() + "\n", encoding="utf-8")
    return note_path


def write_concept_notes(repos: Iterable[RepoRecord], vault: Path) -> None:
    concepts_dir = vault / "Concepts"
    concepts_dir.mkdir(parents=True, exist_ok=True)
    concept_map: dict[str, set[str]] = {}
    for repo in repos:
        for item in set(repo.topics + repo.frameworks + ([repo.primary_language] if repo.primary_language else [])):
            concept_map.setdefault(concept_name(item), set()).add(repo.full_name)
    for concept, names in concept_map.items():
        path = concepts_dir / f"{safe_name(concept)}.md"
        lines = [f"# {concept}", "", "## Repos", ""]
        lines.extend(f"- [[Repos/{safe_name(name)}|{name}]]" for name in sorted(names))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def trim_markdown(text: str, limit: int) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    return text[:limit]


def write_jsonl(repos: list[RepoRecord], index_dir: Path, vault: Path) -> None:
    index_dir.mkdir(parents=True, exist_ok=True)
    records_path = index_dir / "repos.jsonl"
    chunks_path = index_dir / "chunks.jsonl"
    with records_path.open("w", encoding="utf-8") as repos_out, chunks_path.open("w", encoding="utf-8") as chunks_out:
        for repo in repos:
            note = str((vault / "Repos" / f"{safe_name(repo.full_name)}.md").resolve())
            record = {
                "id": f"repo:{repo.full_name}",
                "kind": "repo",
                "repo": repo.full_name,
                "title": repo.full_name,
                "url": repo.url,
                "description": repo.description,
                "language": repo.primary_language,
                "topics": repo.topics,
                "frameworks": repo.frameworks,
                "packages": repo.packages,
                "license": repo.license_name,
                "stars": repo.stars,
                "pushed_at": repo.pushed_at,
                "obsidian_note": note,
                "text": searchable_text(repo),
            }
            repos_out.write(json.dumps(record, ensure_ascii=False) + "\n")
            for chunk in chunk_repo(repo, note):
                chunks_out.write(json.dumps(chunk, ensure_ascii=False) + "\n")


def searchable_text(repo: RepoRecord) -> str:
    return "\n".join(
        [
            repo.full_name,
            repo.description,
            repo.primary_language,
            " ".join(repo.topics),
            " ".join(repo.frameworks),
            " ".join(repo.packages),
            trim_markdown(repo.readme, 4000),
            "\n".join(repo.manifests.values())[:4000],
        ]
    )


def chunk_repo(repo: RepoRecord, note: str) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    chunks.append(
        {
            "id": f"repo:{repo.full_name}:summary",
            "kind": "repo-summary",
            "repo": repo.full_name,
            "title": repo.full_name,
            "url": repo.url,
            "obsidian_note": note,
            "text": searchable_text(repo)[:8000],
        }
    )
    for rel, text in repo.manifests.items():
        chunks.append(
            {
                "id": f"repo:{repo.full_name}:manifest:{rel}",
                "kind": "manifest",
                "repo": repo.full_name,
                "path": rel,
                "title": f"{repo.full_name} {rel}",
                "url": f"{repo.url}/blob/HEAD/{rel}" if repo.url else "",
                "obsidian_note": note,
                "text": text[:8000],
            }
        )
    return chunks


def collect_repos(args: argparse.Namespace) -> list[RepoRecord]:
    repos: list[RepoRecord] = []
    if (args.repo or args.user or args.org) and not gh_available():
        raise SystemExit("gh CLI is required for GitHub repo indexing. Install gh or use --local.")
    if args.authenticated and not gh_available():
        raise SystemExit("gh CLI is required for authenticated repo indexing. Install gh or use --local.")
    if args.authenticated:
        repos.extend(repos_from_authenticated(args.limit))
    for repo in args.repo:
        repos.append(repo_from_gh_view(repo))
    for user in args.user:
        repos.extend(repos_from_gh_list("--source", user, args.limit))
    for org in args.org:
        repos.extend(repos_from_gh_list("--source", org, args.limit))
    for local in args.local:
        repos.append(repo_from_local(Path(local)))

    seen: set[str] = set()
    unique: list[RepoRecord] = []
    for repo in repos:
        key = repo.full_name.lower()
        if key not in seen:
            seen.add(key)
            unique.append(repo)
    return unique


def enrich_repos(repos: list[RepoRecord], clone: bool, clone_timeout: int) -> None:
    with tempfile.TemporaryDirectory(prefix="hive-assimilate-") as tmp:
        clone_root = Path(tmp)
        for repo in repos:
            root = repo.local_path
            if root is None and clone:
                root = clone_repo(repo, clone_root, clone_timeout)
            if root and root.exists():
                read_repo_files(repo, root)
            else:
                repo.frameworks = sorted(infer_frameworks(repo))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", action="append", default=[], help="GitHub repo in owner/name form")
    parser.add_argument("--user", action="append", default=[], help="GitHub username to index")
    parser.add_argument("--org", action="append", default=[], help="GitHub organization to index")
    parser.add_argument("--authenticated", action="store_true", help="Index all repos visible to the authenticated GitHub account")
    parser.add_argument("--local", action="append", default=[], help="Local repo clone path")
    parser.add_argument("--limit", type=int, default=100, help="Max repos per user/org")
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT, help="Obsidian vault output path")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX, help="JSONL index output directory")
    parser.add_argument("--no-clone", action="store_true", help="Only index GitHub metadata, not repo files")
    parser.add_argument("--clone-timeout", type=int, default=45, help="Seconds before skipping a slow repo clone")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repos = collect_repos(args)
    if not repos:
        raise SystemExit("No repos selected. Use --repo, --user, --org, or --local.")
    enrich_repos(repos, clone=not args.no_clone, clone_timeout=args.clone_timeout)
    args.vault.mkdir(parents=True, exist_ok=True)
    for repo in repos:
        write_repo_note(repo, args.vault)
    write_concept_notes(repos, args.vault)
    write_jsonl(repos, args.index, args.vault)
    print(f"indexed {len(repos)} repos")
    print(f"obsidian vault: {args.vault}")
    print(f"jsonl index: {args.index}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
