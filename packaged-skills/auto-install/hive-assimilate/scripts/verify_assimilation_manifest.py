#!/usr/bin/env python3
"""Validate ASSIMILATION.json for concrete Hive code reuse."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


LOG_SCRIPT = Path(__file__).resolve().parent / "log_assimilation_decision.py"

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


def log_verification(target_root: Path, request: str, decision: str, reason: str) -> None:
    subprocess.run(
        [
            sys.executable,
            str(LOG_SCRIPT),
            "--target-root",
            str(target_root),
            "--request",
            request,
            "--phase",
            "verification",
            "--source",
            "verify-assimilation-manifest",
            "--decision",
            decision,
            "--reason",
            reason,
        ],
        check=False,
    )


def validate(manifest: str, target_root: Path) -> tuple[int, int]:
    path = target_root / manifest
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
        target = target_root / entry["target_path"]
        if not target.exists():
            raise SystemExit(f"Entry {index} target_path does not exist: {target}")
        valid_count += 1
        if reuse_type in {"copied_code", "adapted_code", "translated_code", "config_adapted"}:
            substantive_count += 1

    if substantive_count < 3:
        raise SystemExit(
            f"below-threshold: need at least 3 substantive code/config reuse entries; found {substantive_count}. "
            "Search for stronger donors before finalizing."
        )

    return valid_count, substantive_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", default="ASSIMILATION.json")
    parser.add_argument("--target-root", type=Path, default=Path.cwd())
    parser.add_argument("--request", default="", help="Original user request so the verification event joins the run's log")
    parser.add_argument("--no-log", action="store_true", help="Do not append the verification result to ASSIMILATION_LOG")
    args = parser.parse_args()

    # Fall back to the manifest's own request so the log event stays attributable.
    request = args.request.strip()
    if not request:
        try:
            request = str(json.loads((args.target_root / args.manifest).read_text(encoding="utf-8")).get("request", "")).strip()
        except (OSError, json.JSONDecodeError):
            request = ""

    try:
        valid_count, substantive_count = validate(args.manifest, args.target_root)
    except SystemExit as error:
        reason = str(error)
        if not args.no_log:
            decision = "below-threshold" if reason.startswith("below-threshold") else "failed"
            log_verification(args.target_root, request, decision, f"{args.manifest}: {reason}")
        raise

    if not args.no_log:
        log_verification(
            args.target_root,
            request,
            "passed",
            f"{args.manifest}: {valid_count} concrete reuse entries, {substantive_count} substantive",
        )
    print(f"ASSIMILATION manifest valid: {valid_count} concrete reuse entries, {substantive_count} substantive")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
