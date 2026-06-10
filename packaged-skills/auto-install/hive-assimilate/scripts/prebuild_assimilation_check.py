#!/usr/bin/env python3
"""Blocking pre-build Hive discovery for Hive Assimilate."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
PUBLIC_SEARCH = SKILL_DIR / "scripts" / "search_github_public.py"
LOCAL_SEARCH = SKILL_DIR / "scripts" / "search_assimilation_index.py"
LOG_SCRIPT = SKILL_DIR / "scripts" / "log_assimilation_decision.py"


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True)


def write_log(
    args: argparse.Namespace,
    phase: str,
    source: str,
    decision: str,
    reason: str,
    note: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    cmd = [
        sys.executable,
        str(LOG_SCRIPT),
        "--target-root",
        str(args.target_root),
        "--request",
        args.request,
        "--phase",
        phase,
        "--source",
        source,
        "--query",
        args.request,
        "--decision",
        decision,
        "--reason",
        reason,
    ]
    if note:
        cmd.extend(["--note", note])
    if payload is not None:
        cmd.extend(["--payload", json.dumps(payload)])
    completed = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        raise SystemExit(f"failed to write assimilation log: {completed.stderr.strip()}")


def print_local_results(records: list[dict[str, Any]]) -> None:
    for rank, record in enumerate(records, start=1):
        print(f"{rank}. score={record.get('score')} {record.get('repo')} [{record.get('kind')}]")
        if record.get("matched_terms"):
            print(f"   matched: {', '.join(record['matched_terms'])}")
        if record.get("path"):
            print(f"   path: {record.get('path')}")
        if record.get("url"):
            print(f"   url: {record.get('url')}")
        if record.get("obsidian_note"):
            print(f"   note: {record.get('obsidian_note')}")
        if record.get("snippet"):
            print(f"   {record.get('snippet')}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", help="The user's build request")
    parser.add_argument("--public-limit", type=int, default=15)
    parser.add_argument("--per-query-limit", type=int, default=10)
    parser.add_argument("--local-top", type=int, default=8)
    parser.add_argument("--target-root", type=Path, default=Path.cwd(), help="Project root for ASSIMILATION_LOG files")
    parser.add_argument("--no-log", action="store_true", help="Do not append ASSIMILATION_LOG entries")
    args = parser.parse_args()

    print("=== Local/private-visible corpus ===")
    local = run(
        [
            sys.executable,
            str(LOCAL_SEARCH),
            args.request,
            "--top",
            str(args.local_top),
            "--json",
        ]
    )
    local_records: list[dict[str, Any]] = []
    if local.returncode == 0 and local.stdout.strip():
        local_records = json.loads(local.stdout)
        if local_records:
            print_local_results(local_records)
        else:
            print("No relevant local index hits after threshold filtering.")
        if not args.no_log:
            write_log(
                args,
                "local-search",
                "local-index",
                "retrieved" if local_records else "no-results",
                "Retrieved local/private-visible index hits." if local_records else "No relevant local index hits after threshold filtering.",
                payload={"candidates": local_records, "result_count": len(local_records)},
            )
    else:
        print("No local index hits or local index unavailable.")
        if not args.no_log:
            write_log(args, "local-search", "local-index", "no-results", "No local index hits or local index unavailable.", local.stderr)
        if local.stderr.strip():
            print(local.stderr.strip())

    print("\n=== Public Hive candidates, star-sorted ===")
    public = run(
        [
            sys.executable,
            str(PUBLIC_SEARCH),
            args.request,
            "--limit",
            str(args.public_limit),
            "--per-query-limit",
            str(args.per_query_limit),
            "--sort",
            "stars",
            "--target-root",
            str(args.target_root),
            "--request",
            args.request,
            *(["--no-log"] if args.no_log else []),
        ]
    )
    if public.returncode != 0:
        print(public.stdout.rstrip())
        print(public.stderr.rstrip(), file=sys.stderr)
        return public.returncode
    if not public.stdout.strip() or "cached 0 public candidates" in public.stdout:
        print(public.stdout.rstrip())
        print("Result: BLOCK. Broaden queries before implementing.")
        if not args.no_log:
            write_log(args, "prebuild-gate", "public-github", "blocked", "Public search returned no usable candidates; broaden queries before implementing.", public.stdout)
        return 2
    print(public.stdout.rstrip())
    if not args.no_log:
        write_log(args, "prebuild-gate", "public-github", "passed", "Public search returned candidates; choose and audit backbone/donors before implementation.")

    print("\n=== Required next step ===")
    print("Choose the highest-star directionally compatible repo as backbone.")
    print("Choose lower-star donors for missing features.")
    print("Run audit_candidate_repo.py on the backbone and every donor before using code.")
    print("Do not scaffold from scratch until this backbone/donor decision is made.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
