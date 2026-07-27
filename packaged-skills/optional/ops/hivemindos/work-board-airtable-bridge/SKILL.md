---
name: work-board-airtable-bridge
description: Use when a user wants to connect Airtable task records to the HivemindOS Work Board, import an Airtable board, mirror status back to Airtable, or keep one external stakeholder-facing Airtable board aligned with Queen Bee tasks. Do not use this as a replacement for the built-in Work Board.
---

# Work Board Airtable Bridge

Connect an Airtable task table to HivemindOS without making Airtable the source of truth for agent coordination.

## Rule

HivemindOS already has built-in work tracking: the dashboard Work Board, `/api/kanban`, Queen Bee routing, scheduler/history views, and the shared vault folder `Operations/Work Board/`. Use that as the canonical board for agent work. Airtable is only an external intake, reporting, or stakeholder mirror unless the user explicitly says the Airtable base is the authority.

## Use Cases

- Import Airtable records into Work Board tasks.
- Link an Airtable record to one Work Board card or Queen Bee run.
- Mirror Work Board status, assignee, verification notes, and artifact URLs back to Airtable.
- Create an Airtable-facing report for non-HivemindOS collaborators.
- Reconcile drift between Airtable and Work Board.

## Capability Map

- Work Board: use existing HivemindOS Kanban APIs, dashboard task actions, Queen Bee routing, and shared vault storage.
- Airtable: load the `airtable` skill if available, or use Airtable REST with credentials checked by key name only, such as `AIRTABLE_API_KEY`.
- Memory: record durable board conventions only when the user confirms them as reusable, then use Shared Brain Memory rather than comments in Airtable.
- Delivery: require receipts for external mutations, such as Airtable record IDs, Work Board task IDs, or API success responses.

## Workflow

1. Identify the direction: Airtable to Work Board, Work Board to Airtable, bidirectional sync, or one-time report.
2. Confirm the table schema without printing secrets. Required fields usually include task title, body, status, assignee, priority, due date, source URL, and Work Board task ID.
3. Map statuses explicitly. Prefer `ready`, `working`, `review`, `done`, and `blocked` on the HivemindOS side.
4. For imports, create or update Work Board tasks idempotently using a stable Airtable record ID in source metadata.
5. For exports, write only fields the user approved for Airtable. Do not leak private vault paths, local machine names, Tailnet URLs, raw logs, or secrets.
6. Attach verification evidence before moving a mirrored record to review or done.
7. Report both IDs: Work Board task ID and Airtable record ID.

## Safety

- Never run broad syncs until the user approves the table, field map, and direction.
- Do not overwrite Airtable notes with local agent scratchpads.
- Do not expose private Work Board details to Airtable if the table is shared outside the trusted team.
- If conflicts appear, prefer a reconciliation report over silent last-write-wins updates.

## Provenance

This is a HivemindOS-authored clean-room skill. It was prompted by a public Hyperagent skill catalog, but no unlicensed upstream text, JSON, or scripts are copied.
