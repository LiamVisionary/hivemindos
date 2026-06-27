---
name: hive-brain-compiled-wiki
description: Use when saving source material, research findings, chat conclusions, or durable project knowledge into the HivemindOS compiled brain; searching or querying compiled knowledge as a graph; repairing compiled-wiki health; or contributing to a human collective shared brain without breaking normal agent-to-agent collaboration.
---

# Hive Brain Compiled Wiki

HivemindOS can compile important source material into an Obsidian-native wiki under `Synthesis/Compiled Knowledge/<domain>/`. This is for durable synthesized knowledge, not every transient thought.

Use the compiled wiki when the user asks to save research, compile findings, turn a conversation into brain pages, search synthesized wiki knowledge, build an entity/concept map, query the shape of compiled knowledge, or clean wiki links.

## Model

Each compiled domain has:

```text
Synthesis/Compiled Knowledge/<domain>/
├── raw/
└── wiki/
    ├── entities/
    ├── concepts/
    ├── summaries/
    ├── index.md
    └── log.md
```

Pages use YAML frontmatter and Obsidian wikilinks. Entity and concept links use bare slugs such as `[[hivemindos]]`; summary links use `[[summaries/<slug>]]`.

## Write Workflow

Before writing, choose the domain. If the user does not name one, use `shared-brain` for general durable HivemindOS knowledge or ask when multiple project domains could be right.

When MCP is available, prefer `compile_brain_knowledge` from `hivemind-mcp`. Provide:

- `title`
- `content`
- optional `summary`
- optional `tags`
- optional `entities` and `concepts` with known slugs, descriptions, facts, and related links
- `collaborationMode: "agent-to-agent"` for normal agent/internal HivemindOS contributions

Ground links in known or newly created slugs. Do not make a wikilink if you do not want a page or know the page exists.

## Search And Reading Workflow

For synthesized entity/concept/summary knowledge, search the compiled wiki before doing broad full-vault recall:

- `brain_search_knowledge` for weighted title, slug, tags, frontmatter, and markdown body matches.
- Use `query`, optional `domain`, optional `limit`, and optional `types` (`entity`, `concept`, `summary`).
- Prefer this when the user is asking "what do we know about <compiled topic>?" or looking for a durable synthesized page.

Use graph-shaped tools before pulling huge text:

- `brain_graph_overview` for counts, hubs, and orphan shape.
- `brain_get_node` for a specific entity, concept, or summary.
- `brain_get_backlinks` to trace every page that mentions a node.

For ordinary preference, decision, instruction, commitment, credential-status, or project-context recall, still use `hive-brain answer` or `/api/brain/memory` first. The compiled wiki complements Shared Brain Memory; it does not replace typed memory.

## Health Workflow

Use `scan_brain_wiki_health` to find broken links, orphans, duplicate slugs, and missing backlinks.

Safe issues may be fixed with `fix_brain_wiki_issue`. Review-only issues should be summarized for the user unless they explicitly asked for maintenance and the fix is obvious. Destructive duplicate merges are not auto-fixed by this surface.

## Human Collective Shared Brain

For multiple-human shared brains, follow the Curator-style contract:

- Each person keeps private/personal domains.
- Opted-in personal domains produce contributions.
- The synthesized `shared-*` mirror is read-oriented.
- To add to a human collective, write to the contributor's opted-in personal domain first, then push/synthesize/pull through the shared-brain workflow.

This human collective rule must not make normal HivemindOS agent-to-agent work stricter. For internal agent collaboration, use `collaborationMode: "agent-to-agent"` and keep using shared vault writes, handoffs, Kanban, and Shared Brain Memory according to normal HivemindOS policy. A `shared-*` name alone is not a write ban for agents; explicit read-only policy or `human-collective` mode is what blocks direct writes.

Use `shared_brain_contract` when unsure.
