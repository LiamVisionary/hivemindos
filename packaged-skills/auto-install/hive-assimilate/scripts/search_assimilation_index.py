#!/usr/bin/env python3
"""Search the Hive Assimilate JSONL index with lightweight hybrid scoring."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path


DEFAULT_INDEX = Path.home() / ".codex" / "hive-assimilate" / "index" / "chunks.jsonl"
LEGACY_INDEX = Path.home() / ".codex" / "github-assimilator" / "index" / "chunks.jsonl"

STOP_TERMS = {
    "a",
    "add",
    "agent",
    "an",
    "and",
    "app",
    "build",
    "create",
    "existing",
    "fix",
    "for",
    "hive",
    "hivemind",
    "hivemindos",
    "implement",
    "in",
    "into",
    "local",
    "make",
    "me",
    "of",
    "our",
    "the",
    "to",
    "update",
    "with",
}
GENERIC_STACK_TERMS = {
    "app",
    "css",
    "dashboard",
    "html",
    "javascript",
    "next",
    "next.js",
    "react",
    "service",
    "typescript",
    "ui",
    "web",
}


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9][a-z0-9_.-]*", text.lower())


def query_terms(query: str) -> list[str]:
    terms = []
    seen: set[str] = set()
    for term in tokenize(query):
        if len(term) < 3 or term in STOP_TERMS or term in seen:
            continue
        seen.add(term)
        terms.append(term)
    return terms


def load_records(path: Path) -> list[dict]:
    records = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def score_record(query: str, record: dict, doc_freq: Counter[str], total_docs: int) -> tuple[float, list[str], int]:
    q_terms = query_terms(query)
    text = " ".join(str(record.get(k, "")) for k in ("title", "repo", "path", "text")).lower()
    tokens = tokenize(text)
    counts = Counter(tokens)
    if not tokens:
        return 0.0, [], 0
    value = 0.0
    matched: list[str] = []
    for term in q_terms:
        tf = counts[term]
        if tf:
            idf = math.log((1 + total_docs) / (1 + doc_freq[term])) + 1
            value += (1 + math.log(tf)) * idf
            matched.append(term)
        elif term in text:
            value += 0.35
            matched.append(term)
    distinctive_matches = sum(1 for term in matched if term not in GENERIC_STACK_TERMS)
    title = str(record.get("title", "")).lower()
    if matched and any(term in title for term in matched):
        value *= 1.25
    if record.get("kind") == "manifest":
        value *= 1.1
    if matched:
        value += min(math.log1p(float(record.get("stars") or 0)) * 0.25, 2.0)
    if matched and not distinctive_matches:
        value *= 0.35
    return value, matched, distinctive_matches


def default_index() -> Path:
    return DEFAULT_INDEX if DEFAULT_INDEX.exists() or not LEGACY_INDEX.exists() else LEGACY_INDEX


def compact_record(record: dict, value: float, matched: list[str]) -> dict:
    return {
        "repo": record.get("repo") or "",
        "kind": record.get("kind") or "",
        "score": round(value, 2),
        "matched_terms": matched,
        "path": record.get("path") or "",
        "url": record.get("url") or "",
        "obsidian_note": record.get("obsidian_note") or "",
        "stars": record.get("stars"),
        "snippet": re.sub(r"\s+", " ", str(record.get("text", ""))).strip()[:280],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Build request or search query")
    parser.add_argument("--index", type=Path, default=default_index())
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--min-score", type=float, default=1.5)
    parser.add_argument("--min-distinctive-terms", type=int, default=1)
    parser.add_argument("--include-weak", action="store_true")
    parser.add_argument("--json", action="store_true", help="Emit compact JSON records for machine logging.")
    args = parser.parse_args()

    if not args.index.exists():
        raise SystemExit(f"Index not found: {args.index}. Run index_github_repos.py first.")

    records = load_records(args.index)
    doc_freq: Counter[str] = Counter()
    for record in records:
        doc_freq.update(set(tokenize(str(record.get("text", "")))))

    ranked = sorted(
        (
            (*score_record(args.query, record, doc_freq, len(records)), record)
            for record in records
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    filtered = []
    for value, matched, distinctive_matches, record in ranked:
        if value <= 0:
            continue
        if not args.include_weak and (value < args.min_score or distinctive_matches < args.min_distinctive_terms):
            continue
        filtered.append((value, matched, record))
        if len(filtered) >= args.top:
            break
    if args.json:
        print(json.dumps([compact_record(record, value, matched) for value, matched, record in filtered], ensure_ascii=False))
        return 0
    for rank, (value, matched, record) in enumerate(filtered, start=1):
        print(f"{rank}. score={value:.2f} {record.get('repo')} [{record.get('kind')}]")
        print(f"   matched: {', '.join(matched) if matched else '(none)'}")
        if record.get("path"):
            print(f"   path: {record.get('path')}")
        if record.get("url"):
            print(f"   url: {record.get('url')}")
        if record.get("obsidian_note"):
            print(f"   note: {record.get('obsidian_note')}")
        snippet = re.sub(r"\s+", " ", str(record.get("text", ""))).strip()[:240]
        if snippet:
            print(f"   {snippet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
