#!/usr/bin/env python3
"""Append Hive Assimilate retrieval, triage, and reuse decisions to local logs."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MARKDOWN = "ASSIMILATION_LOG.md"
DEFAULT_JSONL = "ASSIMILATION_LOG.jsonl"
MAX_TEXT_FIELD = 500
MAX_NOTE_CHARS = 800

DECISION_ALIASES = {
    "selected_donor": "selected-donor",
    "donor": "selected-donor",
    "donor-only": "selected-donor",
    "inspect": "inspected",
    "inspecting": "inspected",
    "reviewed": "inspected",
    "audited": "inspected",
    "adapted": "adapted_code",
    "not_assimilated": "not-assimilated",
    "reference_only": "reference-only",
}


def compact_text(value: Any, limit: int = MAX_TEXT_FIELD) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def normalize_decision(value: str) -> str:
    normalized = value.strip()
    return DECISION_ALIASES.get(normalized, normalized)


def split_candidate(value: str) -> dict[str, str]:
    parts = value.split("::", 3)
    if len(parts) == 1:
        return {"repo": parts[0].strip(), "decision": "", "reason": "", "path": ""}
    if len(parts) == 2:
        return {"repo": parts[0].strip(), "decision": normalize_decision(parts[1]), "reason": "", "path": ""}
    if len(parts) == 3:
        return {
            "repo": parts[0].strip(),
            "decision": normalize_decision(parts[1]),
            "reason": compact_text(parts[2]),
            "path": "",
        }
    return {
        "repo": parts[0].strip(),
        "decision": normalize_decision(parts[1]),
        "reason": compact_text(parts[2]),
        "path": parts[3].strip(),
    }


def parse_json_payload(value: str | None) -> Any:
    if not value:
        return None
    stripped = value.strip()
    if stripped.startswith(("{", "[")):
        return json.loads(stripped)
    if "\n" not in value and len(value) < os.pathconf("/", "PC_PATH_MAX"):
        try:
            path = Path(value)
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        except OSError:
            pass
    raw = value
    return json.loads(raw)


def compact_candidate(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "repo": record.get("repo") or record.get("fullName") or record.get("name") or "",
        "url": record.get("url") or "",
        "stars": record.get("stars") if record.get("stars") is not None else record.get("stargazersCount"),
        "language": record.get("language") or "",
        "license": record.get("license") or "",
        "query": record.get("query") or "",
        "matched_queries": record.get("matched_queries") or [],
        "score": record.get("score") or record.get("fit_score"),
        "decision": normalize_decision(str(record.get("decision") or "")),
        "reason": compact_text(record.get("reason")),
        "path": record.get("path") or "",
        "description": compact_text(record.get("description") or record.get("snippet") or ""),
    }


def compact_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return None
    compacted = {
        key: value
        for key, value in payload.items()
        if key not in {"candidates", "records", "items", "results"}
    }
    if "result_count" not in compacted:
        candidates = payload.get("candidates")
        if isinstance(candidates, list):
            compacted["result_count"] = len(candidates)
    return compacted


def event_from_args(args: argparse.Namespace) -> dict[str, Any]:
    payload = parse_json_payload(args.payload)
    candidates = [split_candidate(item) for item in args.candidate]
    if isinstance(payload, list):
        candidates.extend(compact_candidate(item) for item in payload if isinstance(item, dict))
    elif isinstance(payload, dict):
        payload_candidates = payload.get("candidates")
        if isinstance(payload_candidates, list):
            candidates.extend(compact_candidate(item) for item in payload_candidates if isinstance(item, dict))
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "request": args.request,
        "phase": args.phase,
        "source": args.source,
        "query": args.query,
        "decision": args.decision,
        "reason": args.reason,
        "selected_backbone": args.selected_backbone,
        "assimilated": args.assimilated,
        "not_assimilated": args.not_assimilated,
        "verification": args.verification,
        "notes": [compact_text(note, MAX_NOTE_CHARS) for note in args.note],
        "payload": compact_payload(payload),
        "candidates": candidates,
    }


def append_jsonl(event: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def markdown_lines(event: dict[str, Any]) -> list[str]:
    lines = [
        f"## {event['timestamp']} - {event['phase']}",
        "",
        f"- Request: {event['request'] or '(not provided)'}",
        f"- Source: {event['source'] or '(not provided)'}",
    ]
    if event["query"]:
        lines.append(f"- Query: `{event['query']}`")
    if event["decision"]:
        lines.append(f"- Decision: {event['decision']}")
    if event["reason"]:
        lines.append(f"- Reason: {event['reason']}")
    if event["selected_backbone"]:
        lines.append(f"- Selected backbone: {event['selected_backbone']}")
    if event["assimilated"]:
        lines.append(f"- Assimilated: {event['assimilated']}")
    if event["not_assimilated"]:
        lines.append(f"- Not assimilated: {event['not_assimilated']}")
    if event["verification"]:
        lines.append(f"- Verification: {event['verification']}")
    for note in event["notes"]:
        lines.append(f"- Note: {note}")
    candidates = event["candidates"]
    if candidates:
        lines.extend(["", "### Candidates"])
        for candidate in candidates:
            repo = candidate.get("repo") or "(unknown)"
            details = []
            if candidate.get("stars") is not None:
                details.append(f"{candidate['stars']} stars")
            if candidate.get("language"):
                details.append(str(candidate["language"]))
            if candidate.get("license"):
                details.append(str(candidate["license"]))
            suffix = f" ({', '.join(details)})" if details else ""
            lines.append(f"- {repo}{suffix}")
            if candidate.get("url"):
                lines.append(f"  - URL: {candidate['url']}")
            if candidate.get("decision"):
                lines.append(f"  - Decision: {candidate['decision']}")
            if candidate.get("reason"):
                lines.append(f"  - Reason: {candidate['reason']}")
            if candidate.get("path"):
                lines.append(f"  - Path: `{candidate['path']}`")
            if candidate.get("description"):
                lines.append(f"  - Description: {str(candidate['description'])[:240]}")
    lines.append("")
    return lines


def append_markdown(event: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("# GitHub Assimilation Log\n\n", encoding="utf-8")
    with path.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(markdown_lines(event)))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-root", type=Path, default=Path.cwd())
    parser.add_argument("--markdown", default=DEFAULT_MARKDOWN)
    parser.add_argument("--jsonl", default=DEFAULT_JSONL)
    parser.add_argument("--request", default="")
    parser.add_argument("--phase", default="triage")
    parser.add_argument("--source", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--decision", default="")
    parser.add_argument("--reason", default="")
    parser.add_argument("--selected-backbone", default="")
    parser.add_argument("--assimilated", default="")
    parser.add_argument("--not-assimilated", default="")
    parser.add_argument("--verification", default="")
    parser.add_argument("--note", action="append", default=[])
    parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help="Candidate as repo[::decision[::reason[::path]]]. May be repeated.",
    )
    parser.add_argument("--payload", help="JSON string or JSON file with candidate/event details")
    args = parser.parse_args()

    event = event_from_args(args)
    append_jsonl(event, args.target_root / args.jsonl)
    append_markdown(event, args.target_root / args.markdown)
    print(args.target_root / args.markdown)
    print(args.target_root / args.jsonl)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
