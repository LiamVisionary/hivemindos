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
| `crypto/hivemindos/b20-issuer-proof` | HivemindOS-authored optional crypto skill for creating Base B20 token issuer proof cards, defaulting live tests to Base Sepolia, requiring explicit confirmation, and executing only through the encrypted local wallet route. |
| `design/` UI Skills pack | 109 optional UI and design-engineering skills from the UI Skills directory, grouped as `design/<source>/<skill>/` so duplicate upstream names remain distinct, and installable together through the `Design Optional Skills Directory` pack. |
| `design/nextlevelbuilder/ui-ux-pro-max` | UI/UX implementation guidance, design stack data, templates, and helper scripts for richer frontend work. |
| `media/higgsfield/higgsfield-api-quirks` | Higgsfield API workaround skill for undocumented model-specific failures and payload requirements, including Seedance 2.0 audio placement, aspect-ratio enforcement, reference-slot limits, and Kling 3.0 matchcut caveats. |
| `media/higgsfield/higgsfield-generate` | Higgsfield media-generation skill for images, video, 3D, audio, Marketing Studio, and Virality Predictor. It supports both Higgsfield Cloud API via shared env keys and the standard consumer CLI/dashboard, asks which surface to use when unspecified, and forbids procedural fallback for Higgsfield requests. |
| `media/hivemindos/ai-ugc-production-pipeline` | HivemindOS-authored optional media-production skill for turning current-signal research, visual anchors, Higgsfield/Seedance video generation, batch UGC scripts, and performance-regeneration rules into one approval-gated ad workflow. |
| `media/hivemindos/content-rewards-viral-app-campaign` | HivemindOS-authored optional growth skill for turning an app's clippable aha moment into Content Rewards-style viral format banks, creator course briefs, influencer web version specs, reward rules, and weekly optimization loops. |
| `media/hivemindos/instagram-reel-growth-workflow` | HivemindOS-authored optional media-growth skill for studying a public Instagram profile, researching current short-form niche patterns, drafting retention-optimized Reel scripts, engineering hooks, and designing a human-approved daily AI video workflow. |
| `media/hivemindos/video-shot-transcript` | HivemindOS-authored optional media-analysis skill for breaking a local video into unique camera/pose/angle segments and aligning each segment with visible captions, embedded subtitles, local ASR, or user-approved transcription. |
| `n8n/` n8n GTM pack | 8 optional n8n GTM-automation skills from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and installable together through the `N8N Optional Skills Directory` pack. Covers lead ingestion/enrichment, outreach orchestration, CRM sync, lead scoring/routing, workflow reliability guardrails, observability/cost control, Clay integration, and self-hosting. |

Optional third-party skills are vendored by `scripts/import-packaged-skills.mjs`, which pins each skill to an upstream commit and `sha256` in `skills-lock.json`; run `node scripts/import-packaged-skills.mjs --verify` to detect drift.

Optional skills must be self-contained and installable without relying on any single machine's local runtime paths.

## Review Rules

Before promoting a third-party skill to auto-install:

1. Confirm license compatibility and record upstream source metadata.
2. Remove or adapt commands that could mutate user data unexpectedly.
3. Make sure the skill respects HivemindOS vault, shared env, and secret-handling rules.
4. Update this docs section, `packaged-skills/README.md`, and the whole-brain shared-skill docs.
