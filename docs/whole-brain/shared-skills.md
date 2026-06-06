---
title: Whole Brain Shared Skills
description: Shared skill shelf, runtime provider mirrors, and auto-sync policy.
---

# Shared Skills

The shared skill shelf is the reusable procedure layer for agents.

It lives in the shared vault. Not in one runtime home. That matters because the whole point is that every agent can learn from the same shelf.

```text
Skills/README.md
Skills/<slug>/SKILL.md
```

Agents should read `Skills/README.md` first, then the relevant `SKILL.md`.

## Provider Inventory

HivemindOS can inspect local and remote runtime skill providers, including common Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon locations.

Provider inventory and import logic live in:

```text
src/lib/services/obsidian/brain-skills.ts
```

## Auto-Sync

Auto sync policy is stored outside the vault:

```text
~/.hivemindos/skill-auto-sync.json
```

Policies can auto import, auto update, track removals, and optionally allow provider deletion handling.

Shared brain managed mirrors must not get imported again as brand new provider skills. That is how duplicate loops start.

## Auto-Installed Brain Skills

Setup copies a small default pack from `packaged-skills/auto-install/` into the shared vault `Skills/` shelf.

The Obsidian Native Brain Pack is included by default:

| Skill | Why it exists |
| --- | --- |
| `obsidian-markdown` | Write Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, tags, math, Mermaid, and footnotes. |
| `obsidian-bases` | Create and edit native `.base` YAML views over vault notes. |
| `json-canvas` | Create and edit Obsidian `.canvas` maps, boards, and flowcharts. |
| `defuddle` | Optionally extract clean markdown from web pages when the local Defuddle CLI is installed. |

These are curated from [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills). HivemindOS does not auto-install the upstream `obsidian-cli` skill because the shared vault already carries safer, HivemindOS-aware Obsidian CLI skills and write policy.

The native pack pairs with seeded vault views under `Operations/Brain Services/`:

- `Agent Memory.base`
- `Project Brain.base`
- `Secure References.base`
- `Whole Brain.canvas`

## AEON Mirror Rule

The hidden AEON runtime mirror belongs here:

```text
Operations/Runtime Mirrors/AEON/.aeon
```

Human AEON profile notes stay under `Agents/AEON/<profile>/`. A hidden runtime basename like `.aeon` must not become a visible profile folder.

## Test Skill Rule

Real fleet propagation tests create temporary `hive-e2e-*` skills. Tests must clean up their shared brain copies after proving import, update, and removal tracking.

`vault-doctor` also detects old active `hive-e2e-*` shared skills.

## Skill Hygiene

Use `vault-doctor` when the shared shelf looks noisy:

```bash
pnpm vault:doctor
pnpm vault:doctor -- --fix
```

The doctor reports duplicate active skill hashes, conflict artifacts, and test leftovers.
