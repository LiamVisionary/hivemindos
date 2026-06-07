#!/usr/bin/env python3
"""Validate ASSIMILATION.json for concrete Hive code reuse."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ALLOWED_REUSE_TYPES = {
    "copied_code",
    "adapted_code",
    "translated_code",
    "style_adapted",
    "test_adapted",
    "config_adapted",
    "asset_copied",
}
DISALLOWED_REUSE_TYPES = {
    "inspiration",
    "pattern",
    "patterns",
    "api_shape",
    "design_reference",
    "reference",
    "idea",
    "ideas",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", default="ASSIMILATION.json")
    parser.add_argument("--target-root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    path = args.target_root / args.manifest
    if not path.exists():
        raise SystemExit(f"Missing manifest: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list) or not entries:
        raise SystemExit("ASSIMILATION.json must contain a non-empty entries list.")
    if data.get("custom_code_assessment") == "mostly_custom":
        raise SystemExit("Manifest says implementation is mostly_custom. This is not successful assimilation.")
    if data.get("custom_code_assessment") not in {"mostly_assimilated", "balanced"}:
        raise SystemExit("Manifest must set custom_code_assessment to mostly_assimilated or balanced.")

    valid_count = 0
    substantive_count = 0
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            raise SystemExit(f"Entry {index} must be an object.")
        for key in ("source_repo", "source_path", "target_path", "reuse_type"):
            if not str(entry.get(key, "")).strip():
                raise SystemExit(f"Entry {index} missing {key}.")
        reuse_type = entry["reuse_type"]
        if reuse_type in DISALLOWED_REUSE_TYPES:
            raise SystemExit(f"Entry {index} has disallowed reuse_type: {reuse_type}")
        if reuse_type not in ALLOWED_REUSE_TYPES:
            raise SystemExit(f"Entry {index} has invalid reuse_type: {reuse_type}")
        target = args.target_root / entry["target_path"]
        if not target.exists():
            raise SystemExit(f"Entry {index} target_path does not exist: {target}")
        valid_count += 1
        if reuse_type in {"copied_code", "adapted_code", "translated_code", "config_adapted"}:
            substantive_count += 1

    if substantive_count < 3:
        raise SystemExit(
            f"Need at least 3 substantive code/config reuse entries; found {substantive_count}. "
            "Search for stronger donors before finalizing."
        )

    print(f"ASSIMILATION manifest valid: {valid_count} concrete reuse entries, {substantive_count} substantive")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
