---
title: "Inbox Triage"
---

# Inbox Triage

Inbox Triage combines immediate Brain Drop processing with a report-only daily
audit. New notes in `Inbox/` and the configured intake folder are preserved as
raw captures. HivemindOS creates a separate cleaned note, classifies it, adds
structured tags and links to relevant notes that already exist, and routes the
result to the appropriate part of the vault.

Tasks and reminders also become idempotent Work Board tasks. Ideas go to
`Ideas/`, projects to `Projects/`, resources to `Memory/Imported Sources/`, and
general notes to `Memory/Brain Drops/`. Ambiguous captures go to
`Intake/Review/` instead of being confidently misrouted. Processing receipts
prevent duplicate notes and tasks when a capture is retried.

The original capture is never moved, edited, or deleted. Classification uses
strong local signals first. Only ambiguous captures use the configured OpenAI
route; if that route is unavailable or remains uncertain, the item goes to
review.

The daily Inbox Triage report remains a separate, read-only audit. It uses only
local heuristics and no network calls, and it ignores Brain Drop's managed
`Processed/` and `Review/` folders.

## What the daily report contains

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

Capture routes process immediately. The service also checks the inbox on its
regular interval so notes written by native or manual vault paths are picked
up and interrupted processing can retry safely.

After the configured report hour (20:00 by default), the daily report runs
once and then stays quiet until tomorrow. If the vault has no capture folders,
it does nothing at all.

When a daily report completes, HivemindOS also creates one Alert with the
number of items reviewed, the number that are new, and the number that need
manual review. On macOS, the same useful summary appears in Notification
Center. This notification describes the completed analysis; it does not mean
the report moved or deleted captured notes.

Configuration is stored in the vault itself
(`Operations/Brain Services/Inbox Triage.md`), so the toggle and report hour
travel with the vault across synced machines. To force the service off on one
machine regardless of the vault setting, set the environment variable
`HIVEMINDOS_INBOX_TRIAGE=0`. To keep the daily report but suppress its Alerts
and macOS banners on one machine, set `HIVEMINDOS_INBOX_TRIAGE_NOTIFY=0`.
