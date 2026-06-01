---
name: fusion-workflow
description: Design and run a one-off or reusable HivemindOS workflow from a user's natural-language goal by discovering and combining available skills, tools, apps, agents, credentials presence, and delivery channels. Use when the user asks for a workflow, automation plan, "do X using whatever agents/tools we have", or gives a multi-step task that should be executed or rehearsed before being turned into a durable skill.
---

# Fusion Workflow

Use this skill to orchestrate a user's goal with the best currently available HivemindOS parts. It may produce a one-off run plan, execute a safe rehearsal, or become input for `fusion-skill` or `fusion-aeon`.

## Bounded Retrieval Rule

- Do not loop on the skill index. Read `Skills/README.md` at most once, then load only directly relevant `SKILL.md` files.
- Use at most six targeted `/api/context-index` queries before planning unless the user explicitly asks for deeper discovery.
- If retrieval is unavailable, repetitive, or internally inconsistent, stop discovery, state the gap, and produce the best workflow graph from already observed evidence.
- Do not emit repeated thought/status text. If the same retrieval action would repeat, move to synthesis.

## Workflow

1. **Parse the intent**
   - Break the request into atomic jobs: gather, transform, create, verify, deliver, schedule, or monitor.
   - Identify external side effects such as posting, sending messages, spending money, changing infrastructure, or publishing files.

2. **Retrieve the parts**
   - Call `/api/context-index` with the original request and with targeted subqueries for each atomic job.
   - Include shared/runtime skills, tool schemas, API routes, connected apps/endpoints, runtime capabilities, docs, workspace files, and existing specialty agents.
   - Query fresh app discovery when needed; do not hard-code app names, Tailnet endpoints, or machine URLs. A prompt that asks for "image generation" should retrieve and rank image-capable apps/tools; it should not require the user to name ComfyUI, Z-Image, or any other provider.
   - Check credentials by presence only through the shared hive env or approved status endpoints. Never reveal secret values.
   - Keep retrieval bounded: one broad query, one targeted query per atomic job, and one status check for each chosen external service. Do not repeat the same read/search step; mark uncertainty and move to the execution graph.

3. **Choose the operator**
   - Prefer a single configured specialist agent when it clearly covers the whole job.
   - Otherwise assign subtasks to the best specialists and make one coordinator responsible for state, approvals, and final delivery.
   - Ask a short clarification only when multiple viable choices are materially different and no policy/default makes the answer obvious.

4. **Plan the run**
   - Produce an execution graph with inputs, selected components, viable alternates, outputs, and confirmations.
   - Put read-only discovery and drafting before side-effectful actions.
   - Add checkpoints for user approval before publish/send/trade/deploy actions unless the user has pre-approved that exact class of action.

5. **Execute or package**
   - If the user wants action now, run the workflow and capture artifacts.
   - For generated media, verify real artifacts before claiming success: readable file, expected dimensions/duration, nonblank/nonempty content, and a path or delivery reference the user can actually use.
   - If the user wants reuse, hand the capability map to `fusion-skill`.
   - If the user wants background duty, hand the workflow to `fusion-aeon`.
   - If a runtime cannot execute or write safely, return the workflow graph and dry-run evidence instead of spinning on discovery.

## Output

Return:
- selected components and why
- execution graph
- clarifications or inferred defaults
- produced artifacts or dry-run outputs
- blocked/missing components
- recommended durable skill or AEON workflow, if useful
