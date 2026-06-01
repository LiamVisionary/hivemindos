---
name: fusion-aeon
description: Convert a fusion skill or fusion workflow into an AEON-ready background, scheduled, or on-duty workflow by discovering available skills, agents, apps, credentials presence, cadence needs, safety gates, and AEON runtime readiness. Use when the user asks to put a fused capability on AEON, schedule it, make it run in the background, assign it to an agent, or turn a multi-step goal into an autonomous workflow.
---

# Fusion AEON

Use this skill when a fused capability should become background work, scheduled duty, or an AEON-operated workflow.

## Bounded Retrieval Rule

- Do not loop on the skill index. Read `Skills/README.md` at most once, then load only directly relevant `SKILL.md` files.
- Use at most six targeted `/api/context-index` queries before designing the AEON duty unless the user explicitly asks for deeper discovery.
- If retrieval is unavailable, repetitive, or internally inconsistent, stop discovery, state the gap, and produce the best AEON conversion plan from already observed evidence.
- Do not emit repeated thought/status text. If the same retrieval action would repeat, move to synthesis.

## Workflow

1. **Start from a fusion map**
   - If no map exists, run `fusion-workflow` first to identify subtasks, components, side effects, and fallbacks.
   - If the result should be reusable as instructions, run `fusion-skill` before AEON conversion.

2. **Check AEON readiness**
   - Retrieve AEON runtime capabilities and existing AEON skills through `/api/context-index`, `/api/runtimes/aeon/skills`, and the shared skill inventory.
   - Check required credentials by presence only. Do not read or expose secret values.
   - Confirm required apps or collectors are reachable through the app discovery/catalog surfaces rather than hard-coded endpoints.
   - Keep readiness checks bounded: one context-index query, one AEON skill/status query, and one app/status check for each chosen dependency. Do not repeat identical checks; record unresolved gaps.

3. **Design the duty**
   - Define trigger mode: manual, scheduled, event-driven, monitoring loop, or on-duty standby.
   - Define cadence, timeout, retry policy, artifact path, notification channel, and human approval gates.
   - Mark publish/send/trade/deploy actions as approval-required unless the user has explicitly granted that class of autonomous action.

4. **Convert and wire**
   - Prefer existing AEON conversion paths such as `aeon-skill-converter` or runtime skill sync APIs.
   - Mirror the selected shared skill into AEON, configure runtime variables, and attach any schedule/on-duty settings.
   - Preserve the discovery logic so AEON can adapt if a better app, agent, or skill becomes available later.

5. **Verify**
   - Run a dry-run or no-side-effect rehearsal.
   - Check AEON run logs/status.
   - Confirm artifacts, notification drafts, and approval gates are visible.
   - If AEON conversion cannot complete, return the exact skill/workflow draft plus missing readiness items rather than retrying the same failing action.

## Output

Report:
- AEON skill/workflow name
- selected components and fallbacks
- cadence/trigger mode
- approval gates
- verification evidence
- blocked setup or missing credentials
