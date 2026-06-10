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


DEFAULT_VAULT = Path.home() / "Documents" / "hive-assimilate-vault"
DEFAULT_INDEX = Path.home() / ".codex" / "hive-assimilate" / "index" / "public-candidates.jsonl"
LEGACY_VAULT = Path.home() / "Documents" / "github-assimilator-vault"
LEGACY_INDEX = Path.home() / ".codex" / "github-assimilator" / "index" / "public-candidates.jsonl"
SKILL_DIR = Path(__file__).resolve().parents[1]
LOG_SCRIPT = SKILL_DIR / "scripts" / "log_assimilation_decision.py"

STOP_TERMS = {
    "a",
    "add",
    "agent",
    "and",
    "app",
    "build",
    "create",
    "dashboard",
    "existing",
    "fix",
    "for",
    "hive",
    "hivemind",
    "hivemindos",
    "implement",
    "in",
    "into",
    "make",
    "me",
    "our",
    "the",
    "to",
    "ui",
    "update",
    "with",
}

STACK_TERMS = {
    "base",
    "cloudflare",
    "d1",
    "evm",
    "next",
    "next.js",
    "react",
    "rust",
    "tauri",
    "typescript",
    "vite",
}

PROJECT_TERMS = {
    "aeon",
    "fleet",
    "hermes",
    "honey",
    "miroshark",
    "usepod",
}

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
    (
        {"toast", "snackbar", "notification", "notifications"},
        [
            "react toast notification queue",
            "react snackbar notification system",
            "shadcn toast notification",
            "radix toast react",
        ],
    ),
    (
        {"syncthing", "rescan", "reconnect", "paused", "folder"},
        [
            "syncthing rest api client",
            "syncthing api rescan folder",
            "syncthing device reconnect",
            "syncthing paused folder api",
        ],
    ),
    (
        {"collector", "telemetry", "port", "stale", "health"},
        [
            "node local service discovery port health",
            "typescript local port discovery health check",
            "telemetry collector health endpoint",
            "local agent telemetry collector",
        ],
    ),
    (
        {"x402", "usdc", "eip-3009", "paid", "payment"},
        [
            "x402 fetch typescript",
            "x402 evm usdc eip-3009",
            "cloudflare worker x402 payment",
            "base usdc eip-3009 typescript",
        ],
    ),
    (
        {"tts", "audio", "pcm", "voice", "realtime"},
        [
            "web audio pcm stream player",
            "typescript audio worklet pcm playback",
            "realtime tts websocket web audio",
            "react voice chat tts streaming",
        ],
    ),
    (
        {"wallet", "seed", "phrase", "recovery", "erc20", "token", "balance"},
        [
            "react crypto wallet seed phrase import",
            "typescript erc20 token balance base",
            "viem erc20 balance wallet",
            "react wallet dashboard token balance",
        ],
    ),
    (
        {"billing", "credits", "ledger", "hmac", "signed", "debit"},
        [
            "credits ledger hmac signed receipts typescript",
            "cloudflare d1 credits ledger",
            "prepaid credits usage billing",
            "usage metering ledger typescript",
        ],
    ),
    (
        {"tauri", "next", "desktop", "static", "native"},
        [
            "tauri nextjs static export",
            "tauri react native command bridge",
            "tauri nextjs desktop app",
            "tauri sidecar nextjs",
        ],
    ),
    (
        {"chat", "modal", "lottie", "animation", "composer"},
        [
            "react chat modal",
            "nextjs chat ui modal",
            "lottie react animation",
            "framer motion chat ui",
        ],
    ),
]


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "repo"


def tokenize(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9][a-z0-9-]*", value.lower()))


def should_include_original_query(query: str) -> bool:
    terms = query_terms_for_mix(query)
    tokens = tokenize(query)
    return len(terms) <= 6 and not (tokens & PROJECT_TERMS)


def preset_matches(tokens: set[str], triggers: set[str]) -> bool:
    if "tauri" in triggers:
        return "tauri" in tokens or ({"next", "desktop"} <= tokens) or ({"next.js", "desktop"} <= tokens)
    return bool(tokens & triggers)


def expanded_queries(query: str, enabled: bool, max_queries: int | None = None, include_original: bool | None = None) -> list[str]:
    if not enabled:
        queries = [query]
        return queries[:max_queries] if max_queries else queries
    tokens = tokenize(query)
    if include_original is None:
        include_original = should_include_original_query(query)
    queries = [query] if include_original else []
    for triggers, variants in EXPANSION_PRESETS:
        if preset_matches(tokens, triggers):
            queries.extend(variants)
    important = [term for term in query_terms_for_mix(query) if len(term) > 2]
    stack = [term for term in important if term in STACK_TERMS]
    distinctive = [term for term in important if term not in STACK_TERMS and term not in PROJECT_TERMS]
    if len(distinctive) >= 2:
        queries.append(" ".join((stack[:2] + distinctive[:4])[:6]))
    if len(distinctive) >= 4:
        queries.append(" ".join((stack[:1] + distinctive[-4:])[:5]))
    if stack and distinctive:
        queries.append(" ".join(stack[:2] + distinctive[:2]))
    if len(distinctive) >= 2:
        queries.append(" ".join(distinctive[:3]))
        queries.append(" ".join(distinctive[-3:]))
    seen: set[str] = set()
    deduped: list[str] = []
    for item in queries:
        key = item.lower().strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(item)
    return deduped[:max_queries] if max_queries else deduped


def query_terms_for_mix(query: str) -> list[str]:
    return [
        term
        for term in re.findall(r"[a-z0-9][a-z0-9_.-]*", query.lower())
        if term not in STOP_TERMS and len(term) > 1
    ]


def candidate_fit(record: dict, request: str) -> tuple[float, list[str]]:
    query_variants = list(dict.fromkeys(record.get("matched_queries") or [])) or [request]
    text_terms = tokenize(record.get("text", ""))
    best_score = 0.0
    best_matched: set[str] = set()
    for variant in query_variants:
        terms = set(query_terms_for_mix(variant))
        if not terms:
            continue
        matched = terms & text_terms
        distinctive = matched - STACK_TERMS - PROJECT_TERMS
        score = len(matched) * 0.5 + len(distinctive) * 2.0
        if matched and not distinctive:
            score *= 0.45
        if score > best_score:
            best_score = score
            best_matched = matched
    score = best_score
    score += min(len(set(record.get("matched_queries") or [])) * 0.25, 1.0)
    score += min(math_log_stars(record.get("stars")) * 0.25, 2.5)
    return round(score, 3), sorted(best_matched)


def math_log_stars(value: object) -> float:
    try:
        stars = int(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if stars <= 0 else len(str(stars)) + min(stars, 1000) / 1000


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


def discover(
    query: str,
    limit: int,
    per_query_limit: int,
    language: str | None,
    sort: str,
    expand: bool,
    fallback_best_match: bool = True,
    max_queries: int | None = None,
    min_fit_score: float = 5.5,
) -> list[dict]:
    by_repo: dict[str, dict] = {}
    variants = expanded_queries(query, expand, max_queries=max_queries)
    sorts = [sort]
    if fallback_best_match and sort != "best-match":
        sorts.append("best-match")
    rate_limited = False
    for active_sort in sorts:
        for variant in variants:
            try:
                raw = gh_search(variant, per_query_limit, language, active_sort)
            except subprocess.CalledProcessError as exc:
                print(f"warn: query failed: {variant}: {exc.stderr.strip()}", file=sys.stderr, flush=True)
                if "rate limit exceeded" in exc.stderr.lower():
                    rate_limited = True
                    break
                continue
            for item in raw:
                record = normalize_repo(item, variant)
                key = record["repo"].lower()
                existing = by_repo.get(key)
                if existing is None:
                    record["matched_queries"] = [variant]
                    record["matched_sorts"] = [active_sort]
                    by_repo[key] = record
                else:
                    existing.setdefault("matched_queries", []).append(variant)
                    existing.setdefault("matched_sorts", []).append(active_sort)
        if by_repo or rate_limited:
            break
    records = list(by_repo.values())
    for record in records:
        fit_score, matched_terms = candidate_fit(record, query)
        record["fit_score"] = fit_score
        record["matched_terms"] = matched_terms
    records = [record for record in records if float(record.get("fit_score") or 0) >= min_fit_score]
    records.sort(
        key=lambda r: (
            float(r.get("fit_score") or 0),
            len(set(r.get("matched_queries") or [])),
            int(r.get("stars") or 0),
        ),
        reverse=True,
    )
    return records[:limit]


def default_vault() -> Path:
    return DEFAULT_VAULT if DEFAULT_VAULT.exists() or not LEGACY_VAULT.exists() else LEGACY_VAULT


def default_index() -> Path:
    return DEFAULT_INDEX if DEFAULT_INDEX.exists() or not LEGACY_INDEX.exists() else LEGACY_INDEX


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
        "queries": expanded_queries(args.query, not args.no_expand, max_queries=args.max_queries),
    }
    completed = subprocess.run(
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
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit(f"failed to write public-search assimilation log: {completed.stderr.strip()}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="GitHub repository search query")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--per-query-limit", type=int, default=8)
    parser.add_argument("--language", help="Optional GitHub language filter")
    parser.add_argument(
        "--sort",
        default="stars",
        choices=["stars", "forks", "updated", "best-match"],
        help="GitHub result ordering. Defaults to stars.",
    )
    parser.add_argument("--no-expand", action="store_true", help="Disable automatic query expansion")
    parser.add_argument("--no-best-match-fallback", action="store_true", help="Do not retry planned queries with best-match when star search is empty.")
    parser.add_argument("--max-queries", type=int, default=4, help="Maximum expanded GitHub query variants to run.")
    parser.add_argument("--min-fit-score", type=float, default=5.5, help="Minimum lightweight fit score required for returned candidates.")
    parser.add_argument("--print-queries", action="store_true", help="Print planned GitHub query variants and exit.")
    parser.add_argument("--json", action="store_true", help="Emit compact JSON search results.")
    parser.add_argument("--no-cache", action="store_true", help="Do not write candidate notes or public-candidate index rows.")
    parser.add_argument("--vault", type=Path, default=default_vault())
    parser.add_argument("--index", type=Path, default=default_index())
    parser.add_argument("--target-root", type=Path, default=Path.cwd(), help="Project root for ASSIMILATION_LOG files")
    parser.add_argument("--request", default="", help="Original user request to include in ASSIMILATION_LOG")
    parser.add_argument("--no-log", action="store_true", help="Do not append ASSIMILATION_LOG entries")
    args = parser.parse_args()

    planned_queries = expanded_queries(args.query, not args.no_expand, max_queries=args.max_queries)
    if args.print_queries:
        print(json.dumps(planned_queries, ensure_ascii=False, indent=2) if args.json else "\n".join(planned_queries))
        return 0

    records = discover(
        args.query,
        limit=args.limit,
        per_query_limit=args.per_query_limit,
        language=args.language,
        sort=args.sort,
        expand=not args.no_expand,
        fallback_best_match=not args.no_best_match_fallback,
        max_queries=args.max_queries,
        min_fit_score=args.min_fit_score,
    )
    if not args.no_cache:
        for record in records:
            write_note(record, args.vault)
        append_jsonl(records, args.index)
    append_search_log(records, args)

    if args.json:
        print(json.dumps({"query": args.query, "planned_queries": planned_queries, "candidates": records}, ensure_ascii=False))
        return 0
    for i, record in enumerate(records, start=1):
        print(
            f"{i}. {record['repo']} score={record.get('fit_score')} "
            f"stars={record['stars']} lang={record['language']} license={record['license']}"
        )
        print(f"   {record['url']}")
        print(f"   matched queries: {', '.join(dict.fromkeys(record.get('matched_queries') or []))}")
        if record.get("matched_terms"):
            print(f"   matched terms: {', '.join(record['matched_terms'])}")
        if record["description"]:
            print(f"   {record['description'][:220]}")
    cache_note = "not cached" if args.no_cache else f"cached in {args.vault}"
    print(f"cached {len(records)} public candidates ({cache_note})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
