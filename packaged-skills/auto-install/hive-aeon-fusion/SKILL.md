---
name: hive-aeon-fusion
description: Convert a hive skill fusion or hive workflow fusion into an AEON-ready background, scheduled, or on-duty workflow by using hive-capability-search to discover available skills, agents, apps, credentials presence, cadence needs, safety gates, and AEON runtime readiness. Use when the user asks to put a fused capability on AEON, schedule it, make it run in the background, assign it to an agent, or turn a multi-step goal into an autonomous workflow.
---

# Hive AEON Fusion

Use this skill when a fused capability should become background work, scheduled duty, or an AEON-operated workflow.

## Capability Discovery

Use `hive-capability-search` before checking AEON readiness or designing the duty. Treat its capability map as the source of truth for selected parts, alternates, availability proof, credential-presence checks, side effects, gaps, and required clarifications.

Do not duplicate broad discovery here. If discovery would repeat, use the existing capability map and move to AEON conversion planning.

## Workflow

1. **Start from a fusion map**
   - If no map exists, run `hive-workflow-fusion` first to identify subtasks, components, side effects, and fallbacks.
   - If the result should be reusable as instructions, run `hive-skill-fusion` before AEON conversion.

2. **Check AEON readiness**
   - Run or consume `hive-capability-search` for the fused capability and AEON duty needs.
   - Use the returned AEON/runtime/app/credential signals to decide readiness.
   - Check required apps or collectors through app discovery/catalog surfaces only when the map marks them as selected but not yet reachable.
   - Record unresolved gaps instead of repeating identical checks.

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
