---
name: hive-capability-search
description: Discover, rank, and return a bounded capability map across HivemindOS shared skills, packaged skills, runtime skills, tool schemas, API routes, connected apps/endpoints, runtime capabilities, workspace context, existing specialty agents, and safe credential-presence signals. Use whenever an agent must choose which available tools, skills, apps, agents, or delivery channels can satisfy a task, especially before hive skill fusion, hive workflow fusion, hive AEON fusion, or any adaptive multi-step run.
---

# Hive Capability Search

Use this skill to answer: "What can this hive currently do for this task, and which parts should the agent use?"

Return a capability map. Do not execute side effects unless a calling skill explicitly asks for a status check or no-side-effect rehearsal.

## Search Boundary

Search only surfaces available to the current agent/runtime:

- Shared brain skill index: read `Skills/README.md` at most once, then load only directly relevant `Skills/<slug>/SKILL.md` files.
- Packaged auto-install skills, installed optional skills, and optional packaged catalog metadata exposed through the context index as installable workflow playbooks. Optional catalog hits are not active runtime skills until the user installs them into the shared brain.
- Runtime/provider skills, tool schemas, slash commands, app schemas, API routes, and local CLI capabilities exposed to the agent.
- Connected apps/endpoints through the app discovery/catalog surfaces and app request proxy. Do not hard-code Tailnet endpoints, private IPs, local machine names, or transient URLs.
- Existing specialty agents and agent subclasses when the runtime exposes them.
- Workspace docs/files only when task-relevant.
- Shared hive env credential presence by key name only. Use approved presence/status checks such as `hive-env-check KEY`; never read, print, copy, summarize, or persist secret values.

## Discovery Surfaces

Use the best surface available in the current runtime; do not assume every agent has shell access.

1. If the runtime already injected "Hive capability search" hits or context-index evidence, consume that first and avoid rerunning discovery.
2. If an authenticated dashboard/app/phone bridge, MCP tool, or route tool exposes `/api/context-index`, call it with the task query. This is the preferred no-shell path, especially for phone-hosted or app-routed agents.
3. If shell access exists, run `hive-capability-search "<task>"`. Use `--json` for machine-readable output, and `--live` only when fresh connected-app/endpoints matter and dashboard auth is available.
4. If none of those surfaces are available, build the map from visible shared skills, runtime tool schemas, app context, and current workspace evidence, then mark `gaps` with the missing capability-search surface instead of claiming the route was verified.

The CLI is a delivery channel for this skill, not the skill itself. A missing CLI is a gap only for shell-based agents; it is not a failure when another verified context-index or injected-context surface is available.

## Bounded Retrieval

- Start with one broad query using the user's full goal.
- Add at most one targeted query per capability intent, such as research, writing, image generation, code execution, messaging, scheduling, approvals, wallet/payment, data source, app action, or deployment.
- Use at most six targeted `/api/context-index` queries by default. If the task has more intents, combine adjacent intents or state that deeper search is needed.
- Stop if the same search/read step would repeat. Move to synthesis with the evidence already collected.
- If retrieval is unavailable, stale, or inconsistent, state the gap and produce the best map from observed evidence.

## Ranking Rules

Rank candidate parts by:

1. Task fit and exact capability match.
2. Confirmed availability in the current runtime or shared brain.
3. Safety and side-effect controls.
4. User preference or configured default. Connected apps can carry user routing preferences: a priority pin, prose usage notes such as "use this app for anime images", and preferred models per task type. When a usage note matches the requested style or task, that app wins over name-pattern matches, and its preferred model for the task type should be passed in the generation request.
5. Cost policy, including whether paid fallback is configured or allowed.
6. Quality and freshness for current-information tasks.
7. Worker-class fit: hits marked class-preferred or agent task preference match the active agent's specialization; prefer them on ties. The class is a prior, not a gate — any listed capability remains usable, and strongly mismatched work should be routed back through Queen Bee instead of ground through with weak priors.
8. Simplicity: prefer one capable specialist when it truly covers the job; otherwise compose specialists.

Ask a short clarification only when multiple viable choices materially affect output quality, identity, cost, or external side effects and no configured default makes the choice obvious. If exactly one viable channel/tool exists, infer it and continue.

## Output Format

Return a compact capability map:

- `task`: the user's goal in one sentence
- `intents`: atomic jobs such as gather, transform, create, verify, deliver, schedule, monitor
- `selected`: one selected component per intent, with proof of availability
- `alternates`: viable fallback components and when to use them
- `agents`: specialty agents or subclasses that should own work, if any
- `apps`: discovered app/endpoints selected through catalog logic, not hard-coded endpoints
- `delivery`: slash commands, API routes, MCP tools, CLIs, or dashboard surfaces that should carry the selected capability when relevant
- `credentials`: required env keys or status checks by name only, never values
- `side_effects`: publish/send/pay/deploy/mutate actions and required approval gates
- `gaps`: missing, ambiguous, or unavailable components
- `questions`: only the clarifications that are actually blocking or materially consequential

If the selected component is a remote connected app, remote collector, Hivemind Link endpoint, or fleet machine capability, include enough handoff detail for `hive-remote-capability-use`: app or service name, machine identity, fresh catalog URL fields when available, required route/schema endpoints, transfer needs, verification expectations, and side-effect gates.

## Build-Task Approval Handoff

For a user-requested build or implementation task, classify every selected component as either `available` or `setup-required` and include the strongest alternatives. Capability approval governs selection, installation, and ordinary setup only; it never replaces spend, secret, deploy, destructive-action, payment, or external-send approvals.

- In the HivemindOS Chat route, return the structured capability map to the chat approval surface and pause. Setup-required items default to approve; available items expose Browse so the user can select an alternative, supply a GitHub repository, or attach an instruction. The user may remove an entire capability intent; when they do, redesign the task so that whole step and its output are absent while the remaining task stays coherent. Continue only after the submitted plan returns to the agent.
- In Codex, Claude Code, terminals, and other chat surfaces without dynamic controls, present the same information as a compact natural-language list. Mark each item `available` or `setup required`, state the proposed default, include material alternatives, then end with one final question: "I've drafted the capability list. Is this okay, and may I continue?" Wait for the answer before capability setup or task execution.
- In autonomous Work Board and Zero Human Company runs, select and set up capabilities automatically by default so the work does not pause. If the task's or company's capability policy is `ask`, use its normal Needs You / `ACTION NEEDED:` path, present the capability list in natural language, and wait. Removing a capability still removes that task step; rejecting setup means use an available route or omit only the unsupported output when no coherent available route exists.

## Verification

For fusion callers, include enough proof that the selected parts are reachable:

- Retrieval hit, skill path, slash-command metadata, app catalog entry, route/tool schema, runtime capability, agent profile, or status endpoint.
- For media generation capabilities, require later artifact verification before claiming success.
- For external delivery capabilities, require later provider/tool receipts such as `success: true`, `message_id`, URL, transaction id, post id, or equivalent.
- For remote connected apps or fleet capabilities, load `hive-remote-capability-use` before execution so the agent refreshes discovery, avoids stale Tailnet URLs, transfers sensitive local inputs privately, and verifies receipts.
