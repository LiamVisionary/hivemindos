---
title: Hive Skills
description: HivemindOS-owned packaged skills that ship with the shared brain.
---

# Hive Skills

Hive skills are HivemindOS-native procedures. They teach agents how to use the hive's own memory, tools, apps, runtimes, projects, and workflows.

These skills are auto-installed into the shared brain because they are foundational.

| Skill | Purpose |
| --- | --- |
| `hive-assimilate` | Mandatory pre-build search across shared brain, user projects, local/private indexes, and public GitHub before software creation. Replaces the older `github-assimilator` name and expands it beyond GitHub. |
| `hive-capability-search` | Discovers available tools, skills, apps, agents, credentials by key name, and delivery channels for a task. |
| `hive-skill-fusion` | Turns a capability request into a reusable shared-brain skill. |
| `hive-workflow-fusion` | Composes multi-step hive workflows from skills, apps, agents, and tools. |
| `hive-aeon-fusion` | Converts reusable hive workflows into AEON-ready agent duties when appropriate. |

## Hive Assimilate

`hive-assimilate` is the default build gate for software work.

Agents using it should search in this order:

1. User-pinned sources, such as a repo, path, PR, note, or shared skill.
2. Shared brain recall with `hive-brain answer "<query>" --scope full-vault`.
3. Relevant current workspace files, docs, tests, and conventions.
4. User project roots when relevant and bounded.
5. Local/private assimilation indexes.
6. Public GitHub candidates, star-sorted for broad discovery.

The skill still writes `ASSIMILATION_LOG.md`, `ASSIMILATION_LOG.jsonl`, and optional `ASSIMILATION.json` in the target project. Those names stay compatible with the older GitHub-only workflow.

Legacy candidate caches under `~/.codex/github-assimilator/` remain valid so existing project references do not break.

## Source Of Truth

The repository source is:

```text
packaged-skills/auto-install/hive-assimilate/SKILL.md
```

Setup mirrors it into the shared brain at:

```text
Skills/hive-assimilate/SKILL.md
```

The old shared-brain `Skills/github-assimilator/` folder should not be recreated. If an imported runtime still has that old name, import it only as a compatibility alias or replace it with `hive-assimilate`.
