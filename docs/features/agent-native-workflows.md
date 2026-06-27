---
title: "Agent-Native Workflows"
---

# Agent-Native Workflows

Agent-native workflows make agent actions inspectable before, during, and after a run.

HivemindOS keeps these surfaces local-first: durable records live in the shared vault when available, otherwise in local HivemindOS state under `~/.hivemindos/`. The dashboard can show them, agents can reference them, and server routes remain authoritative for side effects.

## Action Metadata

The Hive action registry is the shared metadata spine for agent-facing powers.

Each registered action describes:

- stable id, title, description, tags, and aliases
- Zod input schema
- side effects such as read, write, filesystem, remote machine, wallet, payment, credential, or public message
- risk level
- read-only status
- MCP exposure
- context-index retrieval text
- explicit confirmation requirements when money movement or other high-risk execution is involved

The registry feeds:

- `/api/context-index` retrieval entries
- the HivemindOS MCP tool catalog
- static route/action drift checks
- high-risk tool metadata for wallet, payment, and trading flows

For wallet and trading MCP tools, the external MCP server performs a local metadata preflight before calling the dashboard route. `send_usdc`, `dex_swap`, and `stock_trade` must be registered as critical destructive wallet/payment actions and must receive their exact confirmation token. The dashboard route still performs the authoritative spend-policy, entitlement, wallet, and settlement checks.

## MCP Work Orchestration

The HivemindOS MCP server exposes the core coordinator surfaces as local-first tools:

- `work_board`: list, create, claim, heartbeat, comment, complete, fail, block, or promote Work Board tasks through `/api/kanban`.
- `queen_bee`: inspect Queen Bee state, queue coordinator work, decompose PRDs, or operate Queen Bee flow templates and runs.
- `work_event`: create local event triggers and publish event payloads that fan out into ordinary Work Board tasks.
- `request_human_approval`: create a Needs You card for a human decision without granting approval to the requesting agent.

These tools adapt external multi-agent queue patterns into HivemindOS rather than replacing the local task model. Work still lands in the Work Board, task state still lives in the shared vault or local fallback store, and Queen Bee remains the coordinator for routing and receipts.

## Dashboard Pins

Dashboard pins are a built-in feedback layer for the control room.

From any dashboard route, the operator can:

- open the pin overlay
- click a UI target to capture selector, text, bounding box, and route context
- write a note
- save the pin to local server-side state
- see open pin markers on that route
- resolve, archive, or delete the pin
- send the pin to the Work Board as an idempotent task

Pins are not stored in browser storage. They are persisted through `/api/dashboard/pins`, with local state under `~/.hivemindos/dashboard-pins.json`.

## Shared Brain Review Queue

Agents should not silently rewrite durable shared brain content.

The Shared Brain review queue gives agents a safe staging area for:

- new memory proposals
- memory evolution proposals
- skill edits
- instruction edits
- jobs

The Memory utility shows pending and approved proposals. An operator can approve, reject, and apply supported proposal types. Approved memory and memory-evolution proposals write through the existing Shared Brain Memory writer, including reviewed tags and proof behavior. Skill, instruction, and job proposals remain manual until a dedicated safe apply path exists.

The review API is dashboard-authenticated and exposed at `/api/brain/review`.

## Context X-Ray

Context X-Ray records what context an agent run could see.

It stores redacted manifests with:

- run id or thread id
- model label
- total estimated tokens
- source list
- source kind
- route or path
- status
- match reason
- source snippet
- redaction labels

Capability search can opt into Context X-Ray capture. Chat capability preflight records best-effort manifests tied to the runtime session and chat thread, so the Memory workbench can show why an agent saw a skill, tool, API route, connected app, runtime, doc, or workspace file.

Manifests are stored through `/api/context-xray` in local JSONL state under `~/.hivemindos/context-xray.jsonl`.

## Visual Plans And Recaps

Visual artifacts are structured plan and recap records for work that benefits from a quick map.

An artifact can include:

- summary markdown
- file-tree items
- Mermaid diagrams
- wireframe notes
- diff summaries
- risk notes

Queen Bee writes visual plan artifacts when it queues a Work Board task or decomposes a PRD. The artifact links to the Work Board task or PRD epic and carries the Queen Bee fingerprint or PRD run id. The route response returns a compact `visualPlan` receipt.

Local code work can also generate a visual recap from repository diff metadata. Recaps summarize changed files, high-risk areas, and review focus without using destructive git commands.

Artifacts are stored through `/api/visual-artifacts` in the shared vault under `Operations/Plans/Visual Artifacts/` when available, with `~/.hivemindos/visual-artifacts/` as fallback.

## Safety Model

Agent-native workflow records improve visibility, but they do not grant authority.

- Dashboard pins create feedback and Work Board tasks; they do not execute changes by themselves.
- MCP Work Board and event tools create or update local task records; they do not run arbitrary event handlers outside the HivemindOS API.
- Human approval request tools create review cards; they do not authorize the requesting agent to proceed.
- Review proposals stage durable brain changes; only approved memory proposals auto-apply through the typed memory writer.
- Context X-Ray manifests describe visible context; they do not become trusted source data.
- Visual plans and recaps describe work; they do not approve deployment, spending, credential access, or destructive changes.
- MCP confirmation metadata is a client-side guard; server routes still enforce official commercial, wallet, payment, quota, entitlement, and credential trust boundaries.

## Main Code Paths

- `src/lib/services/hive-actions/**`
- `scripts/hivemind-mcp`
- `src/app/api/context-index/route.ts`
- `src/app/api/work-events/route.ts`
- `src/app/api/dashboard/pins/route.ts`
- `src/app/api/brain/review/route.ts`
- `src/app/api/context-xray/route.ts`
- `src/app/api/visual-artifacts/route.ts`
- `src/app/api/queen-bee/route.ts`
- `src/lib/services/context-xray.ts`
- `src/lib/services/brain-review-queue.ts`
- `src/lib/services/dashboard-pins.ts`
- `src/lib/services/work-events.ts`
- `src/lib/services/visual-artifacts.ts`
- `src/lib/services/visual-plan.ts`
- `src/lib/services/visual-recap.ts`
- `src/features/dashboard/views/DashboardPinsOverlay.tsx`
- `src/features/dashboard/views/AgentNativeInsightsPanel.tsx`
