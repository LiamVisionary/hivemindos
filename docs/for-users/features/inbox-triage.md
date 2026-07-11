---
title: "Inbox Triage"
---

# Inbox Triage

Inbox Triage is a report-only brain service that keeps your vault's capture
folders from silently piling up. Once a day it reads everything in `Inbox/`
and your configured intake folder, classifies each note with fast local
heuristics — no AI model calls, no network — and writes a report proposing
where each item should go.

It never moves, edits, or deletes your notes. The report is the entire output.

## What the report contains

Every captured note gets a row with a proposed rail, a confidence level, and
the reasons behind the call:

- **Work Board task** — actionable items (checkbox lists, to-do notes) that
  belong on the Work Board.
- **Ideas folder** — idea and strategy sketches worth keeping visible.
- **Agent Memory** — short durable facts, decisions, or preferences that
  belong in typed Shared Brain Memory.
- **Syntho candidate** — long-form source material (articles, transcripts)
  worth staging into the Synthesis pipeline. Inbox Triage only lists these;
  it never writes inside the Synthesis folder. You decide what gets staged.
- **Needs review** — anything ambiguous. Low-signal notes are flagged
  honestly instead of guessed at.

Reports live in the vault under
`Operations/Brain Services/Inbox Triage/`, one Markdown report plus a JSON
audit per day. Each report also marks which items are new since the previous
report.

## Where to find it

Open **Brain → Brain Services → Overview**. The Inbox Triage card shows the
watched folders, the last report, and the service state, with buttons to run
a report on demand or disable the service.

## How it runs

The service starts with the dashboard server and checks in every few minutes.
After the configured report hour (20:00 by default) it generates the day's
report once, then stays quiet until tomorrow. If the vault has no capture
folders, it does nothing at all.

Configuration is stored in the vault itself
(`Operations/Brain Services/Inbox Triage.md`), so the toggle and report hour
travel with the vault across synced machines. To force the service off on one
machine regardless of the vault setting, set the environment variable
`HIVEMINDOS_INBOX_TRIAGE=0`.
