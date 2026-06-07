#!/usr/bin/env python3
"""Search all public GitHub repos live and cache candidates as Obsidian notes."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_VAULT = Path.home() / "Documents" / "github-assimilator-vault"
DEFAULT_INDEX = Path.home() / ".codex" / "github-assimilator" / "index" / "public-candidates.jsonl"
SKILL_DIR = Path(__file__).resolve().parents[1]
LOG_SCRIPT = SKILL_DIR / "scripts" / "log_assimilation_decision.py"

EXPANSION_PRESETS = [
    (
        {"finance", "financial", "bank", "banks", "csv", "spending", "savings", "budget", "expense", "expenses"},
        [
            "personal finance dashboard",
            "expense tracker",
            "budget tracker",
            "spending tracker",
            "finance analytics app",
            "bank csv parser",
            "plaid finance dashboard",
            "personal finance app",
            "money manager",
        ],
    ),
    (
        {"ebook", "epub", "reader", "book", "library", "highlight", "highlights"},
        [
            "ebook reader",
            "epub reader",
            "web epub reader",
            "book library app",
            "reader highlights notes",
            "full text search ebook",
        ],
    ),
    (
        {"workout", "fitness", "routine", "sets", "reps", "training", "gym"},
        [
            "workout planner",
            "fitness tracker",
            "gym tracker",
            "exercise tracker",
            "training plan app",
            "rest timer workout",
        ],
    ),
    (
        {"crm", "kanban", "freelancer", "leads", "deals", "contacts", "invoice", "invoices"},
        [
            "open source crm",
            "kanban crm",
            "freelancer crm",
            "invoice tracker",
            "deal pipeline",
            "contacts crm",
        ],
    ),
    (
        {"music", "practice", "metronome", "sheet", "pdf", "recording", "audio"},
        [
            "music practice app",
            "metronome app",
            "sheet music viewer",
            "pdf annotation music",
            "audio recorder web app",
            "looped playback audio",
        ],
    ),
]


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "repo"


def tokenize(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9][a-z0-9-]*", value.lower()))


def expanded_queries(query: str, enabled: bool) -> list[str]:
    if not enabled:
        return [query]
    tokens = tokenize(query)
    queries = [query]
    for triggers, variants in EXPANSION_PRESETS:
        if tokens & triggers:
            queries.extend(variants)
    important = [term for term in query_terms_for_mix(query) if len(term) > 2]
    if len(important) >= 2:
        queries.append(" ".join(important[:4]))
    if len(important) >= 4:
        queries.append(" ".join(important[-4:]))
    seen: set[str] = set()
    deduped: list[str] = []
    for item in queries:
        key = item.lower().strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(item)
    return deduped


def query_terms_for_mix(query: str) -> list[str]:
    stop = {
        "build",
        "make",
        "create",
        "me",
        "an",
        "a",
        "the",
        "with",
        "that",
        "can",
        "lets",
        "let",
        "and",
        "or",
        "to",
        "for",
        "where",
        "i",
        "it",
        "should",
        "app",
        "web",
    }
    return [term for term in re.findall(r"[a-z0-9][a-z0-9-]*", query.lower()) if term not in stop]


def gh_search(query: str, limit: int, language: str | None, sort: str) -> list[dict]:
    if shutil.which("gh") is None:
        raise SystemExit("gh CLI is required for public GitHub search.")
    fields = [
        "fullName",
        "name",
        "description",
        "url",
        "language",
        "license",
        "stargazersCount",
        "forksCount",
        "pushedAt",
        "updatedAt",
        "isFork",
        "isArchived",
        "visibility",
        "owner",
    ]
    query_terms = shlex.split(query)
    if not query_terms:
        query_terms = [query]
    cmd = [
        "gh",
        "search",
        "repos",
        *query_terms,
        "--visibility",
        "public",
        "--archived=false",
        "--include-forks=false",
        "--limit",
        str(limit),
        "--json",
        ",".join(fields),
    ]
    if sort != "best-match":
        cmd.extend(["--sort", sort, "--order", "desc"])
    if language:
        cmd.extend(["--language", language])
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return json.loads(completed.stdout)


def normalize_repo(item: dict, query: str) -> dict:
    license_info = item.get("license") or {}
    owner = item.get("owner") or {}
    return {
        "id": f"public:{item.get('fullName')}",
        "kind": "public-repo-candidate",
        "query": query,
        "repo": item.get("fullName") or item.get("name") or "",
        "title": item.get("fullName") or item.get("name") or "",
        "url": item.get("url") or "",
        "description": item.get("description") or "",
        "language": item.get("language") or "",
        "license": license_info.get("name", "") if isinstance(license_info, dict) else str(license_info or ""),
        "stars": item.get("stargazersCount"),
        "forks": item.get("forksCount"),
        "pushed_at": item.get("pushedAt") or "",
        "updated_at": item.get("updatedAt") or "",
        "is_fork": item.get("isFork"),
        "owner": owner.get("login", "") if isinstance(owner, dict) else "",
        "seen_at": datetime.now(timezone.utc).isoformat(),
        "text": " ".join(
            str(part or "")
            for part in [
                item.get("fullName"),
                item.get("description"),
                item.get("language"),
                license_info.get("name", "") if isinstance(license_info, dict) else "",
            ]
        ),
    }


def discover(query: str, limit: int, per_query_limit: int, language: str | None, sort: str, expand: bool) -> list[dict]:
    by_repo: dict[str, dict] = {}
    for variant in expanded_queries(query, expand):
        try:
            raw = gh_search(variant, per_query_limit, language, sort)
        except subprocess.CalledProcessError as exc:
            print(f"warn: query failed: {variant}: {exc.stderr.strip()}", flush=True)
            continue
        for item in raw:
            record = normalize_repo(item, variant)
            key = record["repo"].lower()
            existing = by_repo.get(key)
            if existing is None:
                record["matched_queries"] = [variant]
                by_repo[key] = record
            else:
                existing.setdefault("matched_queries", []).append(variant)
    records = list(by_repo.values())
    records.sort(key=lambda r: (int(r.get("stars") or 0), len(r.get("matched_queries") or [])), reverse=True)
    return records[:limit]


def wiki(value: str) -> str:
    return f"[[{value.replace('|', '-')}]]"


def write_note(record: dict, vault: Path) -> Path:
    public_dir = vault / "Public Candidates"
    public_dir.mkdir(parents=True, exist_ok=True)
    path = public_dir / f"{safe_name(record['repo'])}.md"
    language = record.get("language") or "Unknown"
    concepts = [language, "Public GitHub Candidate"]
    if "expo" in record["text"].lower():
        concepts.append("Expo")
    if "react native" in record["text"].lower() or "react-native" in record["text"].lower():
        concepts.append("React Native")
    if "chat" in record["text"].lower():
        concepts.append("Chatbot")
    lines = [
        "---",
        f"repo: {json.dumps(record['repo'])}",
        f"aliases: [{json.dumps(record['repo'])}]",
        f"url: {json.dumps(record['url'])}",
        f"language: {json.dumps(record['language'])}",
        f"license: {json.dumps(record['license'])}",
        f"stars: {record['stars'] if record['stars'] is not None else 'null'}",
        f"pushed_at: {json.dumps(record['pushed_at'])}",
        f"query: {json.dumps(record['query'])}",
        "---",
        "",
        f"# {record['repo']}",
        "",
        record["description"] or "No description returned by GitHub search.",
        "",
        "## Concepts",
        "",
        " ".join(wiki(c) for c in concepts),
        "",
        "## Assimilation Triage",
        "",
        "- Inspect README, license, package manifests, and examples before reuse.",
        "- Prefer this as a candidate pointer until cloned and inspected.",
        "",
        f"GitHub: {record['url']}",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    record["obsidian_note"] = str(path.resolve())
    return path


def append_jsonl(records: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_search_log(records: list[dict], args: argparse.Namespace) -> None:
    if args.no_log:
        return
    payload = {
        "candidates": records,
        "result_count": len(records),
        "limit": args.limit,
        "per_query_limit": args.per_query_limit,
        "language": args.language,
        "sort": args.sort,
        "expanded": not args.no_expand,
    }
    subprocess.run(
        [
            sys.executable,
            str(LOG_SCRIPT),
            "--target-root",
            str(args.target_root),
            "--request",
            args.request or args.query,
            "--phase",
            "public-search",
            "--source",
            "public-github",
            "--query",
            args.query,
            "--decision",
            "retrieved",
            "--reason",
            f"Retrieved {len(records)} public candidates from GitHub search.",
            "--payload",
            json.dumps(payload),
        ],
        check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="GitHub repository search query")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--per-query-limit", type=int, default=20)
    parser.add_argument("--language", help="Optional GitHub language filter")
    parser.add_argument(
        "--sort",
        default="stars",
        choices=["stars", "forks", "updated", "best-match"],
        help="GitHub result ordering. Defaults to stars.",
    )
    parser.add_argument("--no-expand", action="store_true", help="Disable automatic query expansion")
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--target-root", type=Path, default=Path.cwd(), help="Project root for ASSIMILATION_LOG files")
    parser.add_argument("--request", default="", help="Original user request to include in ASSIMILATION_LOG")
    parser.add_argument("--no-log", action="store_true", help="Do not append ASSIMILATION_LOG entries")
    args = parser.parse_args()

    records = discover(
        args.query,
        limit=args.limit,
        per_query_limit=args.per_query_limit,
        language=args.language,
        sort=args.sort,
        expand=not args.no_expand,
    )
    for record in records:
        write_note(record, args.vault)
    append_jsonl(records, args.index)
    append_search_log(records, args)

    for i, record in enumerate(records, start=1):
        print(f"{i}. {record['repo']} stars={record['stars']} lang={record['language']} license={record['license']}")
        print(f"   {record['url']}")
        if record["description"]:
            print(f"   {record['description'][:220]}")
    print(f"cached {len(records)} public candidates in {args.vault}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
