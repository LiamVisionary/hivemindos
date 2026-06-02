---
name: hive-workflow-fusion
description: Design and run a one-off or reusable HivemindOS workflow from a user's natural-language goal by using hive-capability-search to discover and combine available skills, tools, apps, agents, credentials presence, and delivery channels. Use when the user asks for a workflow, automation plan, "do X using whatever agents/tools we have", or gives a multi-step task that should be executed or rehearsed before being turned into a durable skill.
---

# Hive Workflow Fusion

Use this skill to orchestrate a user's goal with the best currently available HivemindOS parts. It may produce a one-off run plan, execute a safe rehearsal, or become input for `hive-skill-fusion` or `hive-aeon-fusion`.

## Capability Discovery

Use `hive-capability-search` before choosing operators or planning the run. Treat its capability map as the source of truth for selected parts, alternates, availability proof, credential-presence checks, side effects, gaps, and required clarifications.

Do not duplicate broad discovery here. If discovery would repeat, use the existing capability map and move to workflow planning.

## Workflow

1. **Parse the intent**
   - Break the request into atomic jobs: gather, transform, create, verify, deliver, schedule, or monitor.
   - Identify external side effects such as posting, sending messages, spending money, changing infrastructure, or publishing files.

2. **Retrieve the parts**
   - Run or consume `hive-capability-search` for the original request and atomic jobs.
   - Preserve the returned selected components, alternates, proof, side-effect gates, and gaps.
   - Query fresh app/status surfaces only when the capability map marks an app or external service as selected but not yet reachable.

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
   - For external delivery, do not infer success from an intent, prepared file, target name, or exit code alone. Capture the platform/tool result and require concrete evidence such as `success: true`, a returned `message_id`, upload URL, transaction id, post id, or equivalent provider receipt before reporting "sent" or "delivered".
   - If the user wants reuse, hand the capability map to `hive-skill-fusion`.
   - If the user wants background duty, hand the workflow to `hive-aeon-fusion`.
   - If a runtime cannot execute or write safely, return the workflow graph and dry-run evidence instead of spinning on discovery.

## Output

Return:
- selected components and why
- execution graph
- clarifications or inferred defaults
- produced artifacts or dry-run outputs
- blocked/missing components
- recommended durable skill or AEON workflow, if useful
