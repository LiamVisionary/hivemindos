#!/usr/bin/env python3
"""Search the Hive Assimilate JSONL index with lightweight hybrid scoring."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path


DEFAULT_INDEX = Path.home() / ".codex" / "github-assimilator" / "index" / "chunks.jsonl"


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9][a-z0-9_.-]*", text.lower())


def load_records(path: Path) -> list[dict]:
    records = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def score(query: str, record: dict, doc_freq: Counter[str], total_docs: int) -> float:
    q_terms = tokenize(query)
    text = " ".join(str(record.get(k, "")) for k in ("title", "repo", "path", "text")).lower()
    tokens = tokenize(text)
    counts = Counter(tokens)
    if not tokens:
        return 0.0
    value = 0.0
    for term in q_terms:
        tf = counts[term]
        if tf:
            idf = math.log((1 + total_docs) / (1 + doc_freq[term])) + 1
            value += (1 + math.log(tf)) * idf
        elif term in text:
            value += 0.35
    title = str(record.get("title", "")).lower()
    if any(term in title for term in q_terms):
        value *= 1.25
    if record.get("kind") == "manifest":
        value *= 1.1
    value += math.log1p(float(record.get("stars") or 0)) * 0.75
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Build request or search query")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args()

    if not args.index.exists():
        raise SystemExit(f"Index not found: {args.index}. Run index_github_repos.py first.")

    records = load_records(args.index)
    doc_freq: Counter[str] = Counter()
    for record in records:
        doc_freq.update(set(tokenize(str(record.get("text", "")))))

    ranked = sorted(
        ((score(args.query, record, doc_freq, len(records)), record) for record in records),
        key=lambda item: item[0],
        reverse=True,
    )
    for rank, (value, record) in enumerate(ranked[: args.top], start=1):
        if value <= 0:
            continue
        print(f"{rank}. score={value:.2f} {record.get('repo')} [{record.get('kind')}]")
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
