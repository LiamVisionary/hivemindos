---
name: hive-skill-fusion
description: Create or update a durable shared skill from a user's natural-language request by using hive-capability-search to discover and combine the best available HivemindOS skills, tools, apps, runtime agents, credentials presence, and delivery channels. Use when the user asks to "make a skill", "create a skill", "combine these capabilities into a skill", "make an agent able to do X", or gives a multi-part task that should become reusable operational knowledge.
---

# Hive Skill Fusion

Use this skill to turn a user goal into a reusable `SKILL.md` that fuses existing HivemindOS capabilities instead of hand-rolling a one-off procedure.

## Capability Discovery

Use `hive-capability-search` before selecting components. Treat its capability map as the source of truth for selected parts, alternates, availability proof, credential-presence checks, side effects, gaps, and required clarifications.

Do not duplicate broad discovery here. If discovery would repeat, use the existing capability map and move to skill synthesis.

## Workflow

1. **Restate the job**
   - Identify the requested durable skill, its trigger phrases, expected output, safety boundaries, and success evidence.
   - If the user did not ask for a durable skill, use `hive-workflow-fusion` instead.

2. **Discover available parts**
   - Run or consume `hive-capability-search` for the user's goal and required capability intents.
   - Preserve the returned selected components, alternates, proof, side-effect gates, and gaps.
   - If the map is incomplete, record the missing surface and continue with the best verified component instead of looping.

3. **Build a capability map**
   - List each required subtask.
   - For each subtask, name the selected component, any viable alternates, why it was chosen, and what proof shows it is available.
   - Ask only when the choice affects output quality, user identity, cost, or external side effects and there is no obvious winner. If exactly one viable channel/tool exists, infer it and proceed.

4. **Compose the skill**
   - Keep the new `SKILL.md` concise and agent-neutral.
   - Encode capability intents, not fixed providers. Use phrasing like "select a discovered image generator" or "select the user's configured delivery channel" unless the user explicitly requested a named app/channel.
   - Include discovery steps so the skill adapts to future installed apps, agents, and credentials.
   - Route external side effects through confirmation gates unless the user explicitly requested automation.
   - Require external delivery proof. A fused skill must tell agents to capture the actual platform/tool result and only report "sent", "posted", "uploaded", or "delivered" when there is concrete evidence such as `success: true`, a returned `message_id`, post id, URL, transaction id, or equivalent provider receipt.
   - Do not hard-code Tailnet endpoints, local machine names, private IPs, secrets, one user's transient paths, or a specific app/channel as mandatory when the task only implies a capability.

5. **Verify**
   - Run a dry capability-search test for the new skill's intended task and confirm the chosen components rank or are reachable.
   - Run a no-side-effect rehearsal of the skill on one realistic prompt.
   - Record gaps: missing agents, missing env keys, unavailable apps, unclear delivery channel, or permissions needed.
   - If a runtime cannot write files safely, return a complete `SKILL.md` draft and capability map rather than retrying the same failed operation.

## Output

Create or update the shared skill in `Skills/<slug>/SKILL.md`. If the skill should ship as user-installable app content, mirror the same skill into `packaged-skills/<slug>/SKILL.md`.

Report:
- created/updated paths
- capability map
- clarifications asked or inferred defaults
- verification performed
- remaining setup gaps
