#!/usr/bin/env python3
"""Write a manifest of concrete GitHub code assimilated into the target project."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
LOG_SCRIPT = SKILL_DIR / "scripts" / "log_assimilation_decision.py"
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
    parser.add_argument("--target-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--map",
        action="append",
        required=True,
        help=(
            "Mapping in the form source_repo:source_path=>target_path::reuse_type[::note]. "
            "Reuse type must be copied_code, adapted_code, translated_code, style_adapted, "
            "test_adapted, config_adapted, or asset_copied."
        ),
    )
    parser.add_argument(
        "--custom-code-assessment",
        required=True,
        choices=["mostly_assimilated", "balanced", "mostly_custom"],
        help="Whether the final implementation is mostly assimilated repo code, balanced, or mostly custom.",
    )
    parser.add_argument("--output", default="ASSIMILATION.json")
    parser.add_argument("--request", default="", help="Original user request to include in ASSIMILATION_LOG")
    parser.add_argument("--no-log", action="store_true", help="Do not append ASSIMILATION_LOG entries")
    args = parser.parse_args()

    if args.custom_code_assessment == "mostly_custom":
        raise SystemExit(
            "mostly_custom is not a successful Hive assimilation. Find stronger donor/backbone code before finalizing."
        )

    entries = []
    for item in args.map:
        if "=>" not in item or "::" not in item or ":" not in item.split("=>", 1)[0]:
            raise SystemExit(f"Invalid --map value: {item}")
        source, rest = item.split("=>", 1)
        target, reuse_type, *note_parts = rest.split("::")
        reuse_type = reuse_type.strip()
        if reuse_type in DISALLOWED_REUSE_TYPES:
            raise SystemExit(f"Disallowed reuse_type '{reuse_type}'. Reference-only use is not assimilation.")
        if reuse_type not in ALLOWED_REUSE_TYPES:
            allowed = ", ".join(sorted(ALLOWED_REUSE_TYPES))
            raise SystemExit(f"Invalid reuse_type '{reuse_type}'. Allowed: {allowed}")
        repo, source_path = source.split(":", 1)
        entries.append(
            {
                "source_repo": repo.strip(),
                "source_path": source_path.strip(),
                "target_path": target.strip(),
                "reuse_type": reuse_type,
                "note": "::".join(note_parts).strip() if note_parts else "",
            }
        )

    if not entries:
        raise SystemExit("At least one concrete source-to-target mapping is required.")

    output = args.target_root / args.output
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "custom_code_assessment": args.custom_code_assessment,
        "entries": entries,
    }
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if not args.no_log:
        subprocess.run(
            [
                sys.executable,
                str(LOG_SCRIPT),
                "--target-root",
                str(args.target_root),
                "--request",
                args.request,
                "--phase",
                "assimilation-manifest",
                "--source",
                "selected-github-code",
                "--decision",
                "assimilated",
                "--assimilated",
                ", ".join(f"{entry['source_repo']}:{entry['source_path']} => {entry['target_path']}" for entry in entries),
                "--verification",
                f"Wrote {args.output} with {len(entries)} entries and custom_code_assessment={args.custom_code_assessment}.",
            ],
            check=False,
        )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
