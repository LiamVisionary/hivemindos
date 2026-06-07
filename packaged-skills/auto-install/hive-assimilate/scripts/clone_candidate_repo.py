#!/usr/bin/env python3
"""Clone a Hive candidate repo into an inert local cache without installing anything."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


DEFAULT_CACHE = Path.home() / ".codex" / "hive-assimilate" / "candidates"


def safe_name(repo: str) -> str:
    return repo.replace("/", "-").replace(":", "-")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", help="GitHub repo in owner/name form")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--refresh", action="store_true", help="Delete and re-clone if already cached")
    args = parser.parse_args()

    if shutil.which("gh") is None:
        raise SystemExit("gh CLI is required.")

    args.cache.mkdir(parents=True, exist_ok=True)
    dest = args.cache / safe_name(args.repo)
    if dest.exists() and args.refresh:
        shutil.rmtree(dest)
    if not dest.exists():
        subprocess.run(
            ["gh", "repo", "clone", args.repo, str(dest), "--", "--depth", "1"],
            check=True,
            text=True,
            timeout=args.timeout,
        )

    print(dest)
    print("Inert clone ready. Do not run install/build/start commands until audited.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
