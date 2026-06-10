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
- Packaged auto-install skills and installed optional skills exposed through the context index or shared skill shelf.
- Runtime/provider skills, tool schemas, app schemas, API routes, and local CLI capabilities exposed to the agent.
- Connected apps/endpoints through the app discovery/catalog surfaces and app request proxy. Do not hard-code Tailnet endpoints, private IPs, local machine names, or transient URLs.
- Existing specialty agents and agent subclasses when the runtime exposes them.
- Workspace docs/files only when task-relevant.
- Shared hive env credential presence by key name only. Use approved presence/status checks such as `hive-env-check KEY`; never read, print, copy, summarize, or persist secret values.

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
- `credentials`: required env keys or status checks by name only, never values
- `side_effects`: publish/send/pay/deploy/mutate actions and required approval gates
- `gaps`: missing, ambiguous, or unavailable components
- `questions`: only the clarifications that are actually blocking or materially consequential

## Verification

For fusion callers, include enough proof that the selected parts are reachable:

- Retrieval hit, skill path, app catalog entry, route/tool schema, runtime capability, agent profile, or status endpoint.
- For media generation capabilities, require later artifact verification before claiming success.
- For external delivery capabilities, require later provider/tool receipts such as `success: true`, `message_id`, URL, transaction id, post id, or equivalent.
