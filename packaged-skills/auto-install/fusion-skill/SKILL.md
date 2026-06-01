---
name: fusion-skill
description: Create or update a durable shared skill from a user's natural-language request by discovering and combining the best available HivemindOS skills, tools, apps, runtime agents, credentials presence, and delivery channels. Use when the user asks to "make a skill", "create a skill", "combine these capabilities into a skill", "make an agent able to do X", or gives a multi-part task that should become reusable operational knowledge.
---

# Fusion Skill

Use this skill to turn a user goal into a reusable `SKILL.md` that fuses existing HivemindOS capabilities instead of hand-rolling a one-off procedure.

## Bounded Retrieval Rule

- Do not loop on the skill index. Read `Skills/README.md` at most once, then load only directly relevant `SKILL.md` files.
- Use at most six targeted `/api/context-index` queries before drafting unless the user explicitly asks for deeper discovery.
- If retrieval is unavailable, repetitive, or internally inconsistent, stop discovery, state the gap, and produce the best capability map or draft from already observed evidence.
- Do not emit repeated thought/status text. If the same retrieval action would repeat, move to synthesis.

## Workflow

1. **Restate the job**
   - Identify the requested durable skill, its trigger phrases, expected output, safety boundaries, and success evidence.
   - If the user did not ask for a durable skill, use `fusion-workflow` instead.

2. **Discover available parts**
   - Query `/api/context-index` with the full task and subqueries for each capability intent: research, writing, image generation, messaging, scheduling, approvals, data sources, or app actions.
   - Search shared skills first, then runtime provider skills, then tool schemas/API routes, connected apps/endpoints, runtime capabilities, workspace docs, and existing specialty agents.
   - Check the shared hive env by variable name only. Use presence checks such as `hive-env-check KEY`; never read, print, copy, or summarize secret values.
   - Prefer configured specialty agents when they are clearly dominant for a subtask, but let retrieval decide the concrete component. Examples are non-binding: an X-native agent may be best for X research, a writing/style agent may be best for prose, and a discovered image generator may be best for image work.
   - Keep retrieval bounded: read `Skills/README.md` once, run at most one broad context-index query plus one targeted query per subtask, then decide from the ranked evidence. Do not loop on the same index/read step; if discovery is incomplete, record the gap and continue with the best verified component.

3. **Build a capability map**
   - List each required subtask.
   - For each subtask, name the selected component, any viable alternates, why it was chosen, and what proof shows it is available.
   - Ask only when the choice affects output quality, user identity, cost, or external side effects and there is no obvious winner. If exactly one viable channel/tool exists, infer it and proceed.

4. **Compose the skill**
   - Keep the new `SKILL.md` concise and agent-neutral.
   - Encode capability intents, not fixed providers. Use phrasing like "select a discovered image generator" or "select the user's configured delivery channel" unless the user explicitly requested a named app/channel.
   - Include discovery steps so the skill adapts to future installed apps, agents, and credentials.
   - Route external side effects through confirmation gates unless the user explicitly requested automation.
   - Do not hard-code Tailnet endpoints, local machine names, private IPs, secrets, one user's transient paths, or a specific app/channel as mandatory when the task only implies a capability.

5. **Verify**
   - Run a dry retrieval test: query `/api/context-index` for the new skill's intended task and confirm the chosen components rank or are reachable.
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
