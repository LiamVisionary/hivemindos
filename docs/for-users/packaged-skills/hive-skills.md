---
title: Hive Skills
description: HivemindOS-owned packaged skills that ship with the shared brain.
---

# Hive Skills

Hive skills are HivemindOS-native procedures. They teach agents how to use the hive's own memory, tools, apps, runtimes, projects, and workflows.

These skills are auto-installed into the shared brain because they are foundational.

| Skill | Purpose |
| --- | --- |
| `hive-assimilate` | Mandatory pre-build search across shared brain, user projects, local/private indexes, and public GitHub before software creation. |
| `hive-pulse` | Built-in last-30-days signal briefs across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources, powered by a pinned MIT licensed `last30days` engine. |
| `hive-capability-search` | Discovers available tools, shared skills, optional packaged workflow playbooks, apps, agents, credentials by key name, and delivery channels such as slash commands, API routes, MCP tools, CLIs, and dashboard surfaces for a task. |
| `hive-remote-capability-use` | Executes remote connected apps and fleet capabilities selected by capability search, including fresh discovery, Hivemind Link app-proxy routing, private file transfer, artifact verification, and side-effect gates. |
| `hive-skill-fusion` | Turns a capability request into a reusable shared-brain skill. |
| `hive-workflow-fusion` | Composes multi-step hive workflows from skills, apps, agents, and tools. |
| `hive-aeon-fusion` | Converts reusable hive workflows into AEON-ready agent duties when appropriate. |
| `hive-brain-memory` | Teaches agents how to recall canonical typed memory, keep operational receipts separate, review mined patterns, and evolve stale memories while preserving superseded history. |
| `hive-brain-compiled-wiki` | Teaches agents how to compile durable findings into HivemindOS entity/concept/summary wiki pages, search/query the compiled graph through MCP, repair wiki health, and respect human collective shared-brain mirrors without restricting normal agent-to-agent work. |

## Supporting Hive Search Commands

There is no separate packaged skill named `hive-find` or `hive-search` in this repo. The canonical shared-brain memory search surface is the installed `hive-brain` CLI:

```bash
hive-brain answer "query"
hive-brain recall "query" --scope full-vault --limit 8
hive-brain evolve --memory-id mem-... --content "Updated durable memory"
```

`hive-brain answer` returns a concise grounded answer. `hive-brain recall` returns a hit list. Both try the running HivemindOS brain API first and fall back to local vault/index search, so raw agents can use the same private brain without needing dashboard-routed context. `hive-brain record-operation` keeps routine receipts in a bounded local journal, while `hive-brain mine-patterns` dry-runs recurring-learning, skill, and routine proposals before an explicit Brain Review enqueue. Durable writes use canonical memory heads, and `hive-brain evolve` replaces reviewed stale memory while preserving superseded history. Use the auto-installed `hive-brain-memory` skill for the full policy.

For durable synthesized wiki knowledge, use the auto-installed `hive-brain-compiled-wiki` skill instead of broad recall. It teaches agents to call `brain_search_knowledge` first for compiled entity, concept, and summary pages, then follow up with `brain_get_node`, `brain_get_backlinks`, or `brain_graph_overview` when they need graph detail.

For capability routing, setup also installs:

```bash
hive-capability-search "task or goal"
hive-capability-search --json --kinds skill,tool-schema "task or goal"
hive-capability-search --live "task or goal"
```

The command searches the local Context Index without needing a running dashboard. `--live` asks the authenticated dashboard `/api/context-index` route first so connected-app endpoint freshness can be included, then falls back to the local index unless `--require-api` is set.

Agents without shell access, including app-routed or phone-hosted agents, should not treat a missing CLI as a failed skill. They should use already-injected capability-search context, an authenticated `/api/context-index` bridge, or an exposed MCP/context-index tool. If none are available, they should build the map from visible skills/tools and record the retrieval gap.

## Hive Assimilate

`hive-assimilate` is the default build gate for software work.

Agents using it should search in this order:

1. User-pinned sources, such as a repo, path, PR, note, or shared skill.
2. Shared brain recall with `hive-brain answer "<query>" --scope full-vault`.
3. Relevant current workspace files, docs, tests, and conventions.
4. User project roots when relevant and bounded.
5. Local/private assimilation indexes.
6. Public GitHub candidates, star-sorted for broad discovery.

The skill writes `ASSIMILATION_LOG.md`, `ASSIMILATION_LOG.jsonl`, and optional `ASSIMILATION.json` in the target project so agents can review what was searched, reused, or rejected.

Existing local candidate caches remain valid so project references do not break.

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
packaged-skills/auto-install/hive-capability-search/SKILL.md
packaged-skills/auto-install/hive-remote-capability-use/SKILL.md
packaged-skills/auto-install/hive-skill-fusion/SKILL.md
packaged-skills/auto-install/hive-workflow-fusion/SKILL.md
packaged-skills/auto-install/hive-aeon-fusion/SKILL.md
packaged-skills/auto-install/hive-brain-memory/SKILL.md
packaged-skills/auto-install/hive-brain-compiled-wiki/SKILL.md
```

Setup mirrors it into the shared brain at:

```text
Skills/hive-assimilate/SKILL.md
Skills/hive-pulse/SKILL.md
Skills/hive-capability-search/SKILL.md
Skills/hive-remote-capability-use/SKILL.md
Skills/hive-skill-fusion/SKILL.md
Skills/hive-workflow-fusion/SKILL.md
Skills/hive-aeon-fusion/SKILL.md
Skills/hive-brain-memory/SKILL.md
Skills/hive-brain-compiled-wiki/SKILL.md
```

Do not create duplicate shared-brain copies of the same Hive skill. If an imported runtime carries an equivalent workflow under another name, keep `hive-assimilate` as the canonical shared-brain skill.

## Token Savings

Hive skills are also cost controls. See [Token And Cost Savings](../features/token-and-cost-savings.html) for the full loop: `hive-brain` recall, `hive-capability-search`, `hive-assimilate`, `karpathy-guidelines`, Hive Fusion, and runtime usage analytics.
