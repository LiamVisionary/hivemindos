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
| `hive-pulse` | Built-in last-30-days signal briefs across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources, powered by a pinned MIT licensed `last30days` engine. |
| `hive-capability-search` | Discovers available tools, skills, apps, agents, credentials by key name, and delivery channels for a task. |
| `hive-skill-fusion` | Turns a capability request into a reusable shared-brain skill. |
| `hive-workflow-fusion` | Composes multi-step hive workflows from skills, apps, agents, and tools. |
| `hive-aeon-fusion` | Converts reusable hive workflows into AEON-ready agent duties when appropriate. |

## Supporting Hive Search Commands

There is no separate packaged skill named `hive-find` or `hive-search` in this repo. The canonical shared-brain search surface is the installed `hive-brain` CLI:

```bash
hive-brain answer "query"
hive-brain recall "query" --scope full-vault --limit 8
```

`hive-brain answer` returns a concise grounded answer. `hive-brain recall` returns a hit list. Both try the running HivemindOS brain API first and fall back to local vault/index search, so raw agents can use the same private brain without needing dashboard-routed context.

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

## Hive Pulse

`hive-pulse` is the default Hive research pulse for current public signal.

It ships in `packaged-skills/auto-install/hive-pulse/` with the pinned MIT licensed `mvanhorn/last30days-skill` engine bundled inside the skill. Fresh setup copies it into the shared brain, so agents do not need a separate upstream install before running a pulse brief.

Setup also installs the `hive-pulse` command shim. The shim loads shared Hive env keys, defaults browser-cookie reads off, uses the zero-config source set, supplies a deterministic query plan, and selects local deterministic judging unless the user explicitly configures an LLM provider.

The default posture is read-only research. Reddit public paths, Hacker News, Polymarket public odds, GitHub public search, and available web paths can work without extra setup. User-owned keys or browser sessions expand coverage for X, YouTube, TikTok, Instagram, Threads, Pinterest, and richer web providers. Agents must check credentials by key name only and must not print secret values.

Source provenance and audit notes live in:

```text
packaged-skills/auto-install/hive-pulse/.hivemind-skill-source.json
```

## Source Of Truth

The repository source is:

```text
packaged-skills/auto-install/hive-assimilate/SKILL.md
packaged-skills/auto-install/hive-pulse/SKILL.md
```

Setup mirrors it into the shared brain at:

```text
Skills/hive-assimilate/SKILL.md
Skills/hive-pulse/SKILL.md
```

The old shared-brain `Skills/github-assimilator/` folder should not be recreated. If an imported runtime still has that old name, import it only as a compatibility alias or replace it with `hive-assimilate`.

## Token Savings

Hive skills are also cost controls. See [Token And Cost Savings](../features/token-and-cost-savings.html) for the full loop: `hive-brain` recall, `hive-capability-search`, `hive-assimilate`, `karpathy-guidelines`, Hive Fusion, and runtime usage analytics.
