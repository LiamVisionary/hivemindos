---
title: Whole Brain Services
description: GBrain, Syntho, Brain Graph, context index, and optional service layers.
---

# Brain Services

Brain services add retrieval, graphing, synthesis, and domain tools around the vault.

They should treat the vault like durable source material. Not cache. Not scratch space. Not a place to dump every half thought forever.

## Context Index

The context index is the lightweight retrieval surface for code, tools, runtime capabilities, docs, connected apps, and shared skills.

It helps agents find the right surface before they load huge files or schemas.

Primary source: `src/lib/services/context-index.ts`

## Brain Graph

The Brain Graph reads vault markdown and access logs. It shows note relationships and records what agents looked at, so later work has context instead of mystery.

Primary sources:

- `src/lib/services/obsidian/brain-graph.ts`
- `/api/obsidian/graph`
- `/api/obsidian/access`

## GBrain

GBrain is optional semantic retrieval and graph/MCP support for the vault. HivemindOS can install or connect it, import vault content, refresh embeddings, run dream cycles, and query it.

Service note:

```text
Operations/Brain Services/GBrain.md
```

Primary sources:

- `src/lib/services/brain/gbrain.ts`
- `/api/brain/gbrain/*`

## Syntho

Syntho compiles reviewed `Synthesis/` material. It is not the raw vault. Raw source MCP access stays denied unless the user explicitly changes the policy.

Service note:

```text
Operations/Brain Services/Syntho.md
```

Primary sources:

- `src/lib/services/brain/synto.ts`
- `/api/brain/synto/*`

## Trading Brain

Trading Brain is optional and domain specific. It can attach status and install notes to selected runtimes without changing the general vault routing.

Primary sources:

- `src/lib/services/brain/trading-brain.ts`
- `/api/brain/trading-brain/*`

## Service Note Rule

Service notes may identify:

- service status
- install mode
- CLI path or command name
- policy settings
- required credential key names
- repair guidance

They must not contain provider secrets, private keys, bearer tokens, Tailnet IPs, or exact private machine-only paths unless the note is explicitly an encrypted artifact reference.
