#!/usr/bin/env python3
"""Hive Company Daily Report: a per-operator business digest for the daily brief.

Writes a COMPANY_DAILY_REPORT marker block into the operator's shared vault
(DAILY-BRIEF.md + Memory/Daily Briefings/<date>.md) so the Queen has a standing,
read-aloud business summary of THIS operator's own companies every morning —
revenue, spend-free activity, and apex-goal progress.

Design mirrors src/lib/services/company-daily-report.ts, but reads the same
on-disk source-of-truth files DIRECTLY so the daily brief is produced even when
the app is not running (no HTTP, no auth, no app dependency — same robustness as
daily_hive_pulse.py). Both sides read the same files with the same numeric-`at`
guard, so the written brief agrees with the live /api/hive-daily-report numbers.

Multi-tenant by construction: it only reads the LOCAL machine's company store
(the operator's own vault + ~/.hivemindos), so each user gets only their own
companies. No company ids or user paths are hardcoded — paths come from env.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

HOME = Path(os.environ.get("HIVEMINDOS_HOME", str(Path.home() / ".hivemindos")))
VAULT = Path(
    os.environ.get("HIVE_COMPANY_REPORT_VAULT")
    or os.environ.get("HIVE_PULSE_VAULT")
    or (Path.home() / "Documents" / "Obsidian" / "hivemindos-vault")
)
DAILY_BRIEF = VAULT / "DAILY-BRIEF.md"
DAILY_DIR = VAULT / "Memory" / "Daily Briefings"
MARKER = "COMPANY_DAILY_REPORT"

NOW = dt.datetime.now().astimezone()
NOW_MS = NOW.timestamp() * 1000
H24_MS = 24 * 60 * 60 * 1000
D7_MS = 7 * H24_MS


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def read_companies() -> list[dict[str, Any]]:
    """Mirror companies-store.readCompanies: vault definitions + runtime overlay,
    falling back to the legacy local file. Only apexGoal hot state is merged."""
    vault_defs = load_json(VAULT / "Operations" / "Companies" / "companies.json")
    if isinstance(vault_defs, list):
        overlay = (load_json(HOME / "companies-runtime.json") or {}).get("companies", {}) or {}
        merged = []
        for company in vault_defs:
            if not isinstance(company, dict):
                continue
            hot = overlay.get(company.get("id"), {}) or {}
            goal = company.get("apexGoal")
            if goal and hot.get("apexGoal"):
                goal = {**goal, **hot["apexGoal"]}
            merged.append({**company, "apexGoal": goal, "revenue": hot.get("revenue", company.get("revenue"))})
        return merged
    local = load_json(HOME / "companies.json")
    return [c for c in local if isinstance(c, dict)] if isinstance(local, list) else []


def revenue_by_company() -> dict[str, dict[str, Any]]:
    ledger = load_json(HOME / "company-revenue-ledger.json")
    rollup: dict[str, dict[str, Any]] = {}
    if isinstance(ledger, list):
        for record in ledger:
            if not isinstance(record, dict):
                continue
            cid = record.get("companyId")
            amount = record.get("amountUsd")
            if not cid or not isinstance(amount, (int, float)):
                continue
            entry = rollup.setdefault(cid, {"total": 0.0, "count": 0, "last": None})
            entry["total"] += float(amount)
            entry["count"] += 1
            received = record.get("receivedAt") or record.get("recordedAt")
            if received and (entry["last"] is None or received > entry["last"]):
                entry["last"] = received
    return rollup


def to_ms(value: Any) -> float | None:
    """Epoch ms from a number or ISO string (mirrors the TS toEpochMs), so a
    legacy string-`at` line is counted once, not dropped and not re-counted."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None
    return None


def activity(company_id: str) -> dict[str, dict[str, int]]:
    """Count company-memory events in the 24h/7d windows. Dedupes exact-duplicate
    ledger lines and coerces string `at` to ms, matching the TS reader."""
    path = HOME / "company-memory" / f"{re.sub(r'[^a-zA-Z0-9_-]+', '-', company_id)[:80] or 'company'}.jsonl"
    win24: Counter[str] = Counter()
    win7d: Counter[str] = Counter()
    seen: set[str] = set()
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line in seen:
                continue
            seen.add(line)
            try:
                record = json.loads(line)
            except Exception:
                continue
            at = to_ms(record.get("at"))
            kind = record.get("kind")
            if at is None or not kind:
                continue
            if at >= NOW_MS - D7_MS:
                win7d[kind] += 1
            if at >= NOW_MS - H24_MS:
                win24[kind] += 1
    except FileNotFoundError:
        pass
    return {"h24": dict(win24), "d7": dict(win7d)}


def usd(value: float) -> str:
    return f"${value:,.2f}"


def activity_phrase(counts: dict[str, int]) -> str:
    parts = []
    if counts.get("task-completed"):
        parts.append(f"{counts['task-completed']} done")
    if counts.get("task-blocked"):
        parts.append(f"{counts['task-blocked']} blocked")
    if counts.get("dispatch"):
        parts.append(f"{counts['dispatch']} dispatched")
    if counts.get("metric"):
        n = counts["metric"]
        parts.append(f"{n} metric update{'' if n == 1 else 's'}")
    return ", ".join(parts) if parts else "no logged activity"


def apex_line(company: dict[str, Any]) -> str | None:
    goal = company.get("apexGoal") or {}
    label = goal.get("metric") or goal.get("title")
    if not label:
        return None
    target = f" → target {goal['target']}" if goal.get("target") else ""
    current = f", at {goal['current']}" if goal.get("current") not in (None, "") else ""
    pct = f" ({goal['progress']}%)" if isinstance(goal.get("progress"), (int, float)) else ""
    return f"{label}{target}{current}{pct}"


def build_block(companies: list[dict[str, Any]], revenue: dict[str, dict[str, Any]]) -> str:
    date_key = NOW.strftime("%Y-%m-%d")
    lines = [f"## Business — {date_key}", f"Generated: {NOW.isoformat()}", ""]
    if not companies:
        lines.append("No companies configured on this machine yet.")
        return "\n".join(lines)
    for company in sorted(companies, key=lambda c: (c.get("name") or "").lower()):
        name = company.get("name") or "Company"
        tag = f" ({company['ticker']})" if company.get("ticker") else ""
        flags = ", ".join(f for f in (["frozen"] if company.get("frozen") else []) + (["autonomous"] if company.get("autonomy") else []))
        lines.append(f"### {name}{tag}" + (f" — {flags}" if flags else ""))
        apex = apex_line(company)
        if apex:
            lines.append(f"- Goal: {apex}")
        rev = revenue.get(company.get("id"), {"total": 0.0, "count": 0, "last": None})
        last = f" (last {str(rev['last'])[:10]})" if rev.get("last") else ""
        lines.append(f"- Revenue: {usd(rev['total'])} across {rev['count']} event{'' if rev['count'] == 1 else 's'}{last}")
        act = activity(company.get("id", ""))
        lines.append(f"- Last 24h: {activity_phrase(act['h24'])} · last 7d: {activity_phrase(act['d7'])}")
        lines.append("")
    return "\n".join(lines).rstrip()


def write_marker_block(path: Path, marker: str, block: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    start, end = f"<!-- BEGIN {marker} -->", f"<!-- END {marker} -->"
    old = path.read_text() if path.exists() else ""
    new_block = f"{start}\n{block.rstrip()}\n{end}"
    if start in old and end in old:
        old = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _m: new_block, old, flags=re.S)
        path.write_text(old.rstrip() + "\n")
    else:
        prefix = old.rstrip() + "\n\n" if old.strip() else ""
        path.write_text(prefix + new_block + "\n")


def main() -> int:
    companies = read_companies()
    revenue = revenue_by_company()
    block = build_block(companies, revenue)
    date_key = NOW.strftime("%Y-%m-%d")
    write_marker_block(DAILY_BRIEF, MARKER, block)
    write_marker_block(DAILY_DIR / f"{date_key}.md", MARKER, block)
    print(block)
    print(f"\nWrote {MARKER} block to {DAILY_BRIEF} and {DAILY_DIR / f'{date_key}.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
