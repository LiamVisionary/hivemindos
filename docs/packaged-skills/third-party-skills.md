---
title: Third-Party Packaged Skills
description: Curated third-party and optional packaged skill policy.
---

# Third-Party Packaged Skills

Third-party packaged skills are externally sourced or optional skills that HivemindOS curates for the shared brain.

They can be auto-installed only when they are foundational and safe for a fresh install. Otherwise they live in the optional catalog until the user chooses them.

## Auto-Installed Third-Party Pack

The Obsidian Native Brain Pack is auto-installed because agents need reliable Obsidian-native writing skills immediately:

| Skill | Source | Purpose |
| --- | --- | --- |
| `obsidian-markdown` | `kepano/obsidian-skills` | Obsidian Flavored Markdown, wikilinks, embeds, callouts, properties, tags, math, Mermaid, and footnotes. |
| `obsidian-bases` | `kepano/obsidian-skills` | Native `.base` YAML views over vault notes. |
| `json-canvas` | `kepano/obsidian-skills` | Obsidian `.canvas` maps, boards, and flowcharts. |
| `defuddle` | `kepano/obsidian-skills` | Clean markdown extraction from web pages when the local Defuddle CLI is installed. |

HivemindOS does not auto-install the upstream `obsidian-cli` skill because the app already carries HivemindOS-aware Obsidian CLI and vault write policy.

## Optional Third-Party Skills

Optional skills live in:

```text
packaged-skills/optional/
```

Current optional catalog:

| Skill | Purpose |
| --- | --- |
| `design/` UI Skills pack | 109 optional UI and design-engineering skills from the UI Skills directory, grouped as `design/<source>/<skill>/` so duplicate upstream names remain distinct, and installable together through the `Design Optional Skills Directory` pack. |
| `design/nextlevelbuilder/ui-ux-pro-max` | UI/UX implementation guidance, design stack data, templates, and helper scripts for richer frontend work. |

Optional skills must be self-contained and installable without relying on any single machine's local runtime paths.

## Review Rules

Before promoting a third-party skill to auto-install:

1. Confirm license compatibility and record upstream source metadata.
2. Remove or adapt commands that could mutate user data unexpectedly.
3. Make sure the skill respects HivemindOS vault, shared env, and secret-handling rules.
4. Update this docs section, `packaged-skills/README.md`, and the whole-brain shared-skill docs.
