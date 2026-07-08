---
title: Packaged Skills
description: HivemindOS packaged skill catalog, auto-install policy, and optional skill boundaries.
---

# Packaged Skills

Packaged skills are repository-shipped agent procedures that HivemindOS can install into the shared brain `Skills/` shelf.

They are different from one-off runtime skills. A packaged skill is product content: it can be copied into the user's vault, indexed by the shared brain, mirrored to compatible runtimes, and documented for GitHub Pages.

## Catalog Split

| Subdivision | Location | Install behavior |
| --- | --- | --- |
| Hive skills | `packaged-skills/auto-install/` | Installed into the shared brain during setup because they teach HivemindOS-native workflows. |
| Third-party packaged skills | `packaged-skills/auto-install/` or `packaged-skills/optional/` | Curated external or optional skills. Auto-install only when foundational; otherwise install on demand. |

## Auto-Install Skills

Setup copies auto-install skills into:

```text
<shared-vault>/Skills/<slug>/SKILL.md
```

Agents should discover them from the shared brain index, not from the repository folder directly.

Auto-install is reserved for foundational workflows that make a fresh HivemindOS install usable for agents immediately.

## Optional Skills

Optional packaged skills live under:

```text
packaged-skills/optional/<slug>/
packaged-skills/optional/<category>/<source>/<slug>/
```

They are catalog content until a user installs them. Optional skills must not be silently copied into the shared brain or runtime homes.

Grouped optional directories can appear as installable packs in the Skill Browser. Installing one of those packs copies every local packaged skill in the directory into the shared brain after audit; it does not run upstream installer commands.

The optional catalog includes brand, crypto, design, events, GTM, media, operations, and automation packs. Brand helpers include `brand/hivemindos/brand-book-concept-page` and `brand/hivemindos/out-of-home-subway-campaign`. Crypto helpers include `crypto/hivemindos/b20-issuer-proof` for Base B20 issuer proof cards and confirmation-gated Sepolia token creation, plus the `crypto/hivemindos/nansen-*` skills for Nansen DeFi positions, Smart Money holdings, token top holders, token screener discovery, token tracking, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring through read-only HivemindOS Nansen intelligence. Design helpers include the UI Skills directory, the MIT-licensed `design/mengto/` catalog for Codex workflows, asset sourcing, UI prompting, conversion pages, motion systems, WebGL/canvas/3D effects, and visual style recipes, plus HivemindOS-authored `design/hivemindos/newsroom-data-visualization`, `design/hivemindos/swiss-grid-editorial-page`, and `design/hivemindos/vignelli-canon-design-system`. Event helpers include `events/hivemindos/venue-activation-visualizer`. GTM helpers include `gtm/athm793/local-business-scraper` for consent-gated local business lead research with a pinned, audited Google Maps scraper, plus HivemindOS-authored `gtm/hivemindos/small-business-preview-engine` and `gtm/hivemindos/home-service-design-quote`. Media helpers include Higgsfield generation helpers and HivemindOS-authored growth, production, and analysis helpers, such as `media/higgsfield/higgsfield-api-quirks` for model-specific Higgsfield payload workarounds, `media/hivemindos/ai-ugc-production-pipeline` for campaign-to-UGC video production loops, `media/hivemindos/claymation-explainer`, `media/hivemindos/claymation-podcast-clip`, `media/hivemindos/content-rewards-viral-app-campaign`, `media/hivemindos/daily-briefing-trailer`, `media/hivemindos/instagram-reel-growth-workflow`, `media/hivemindos/launch-video-hyperframes`, and `media/hivemindos/video-shot-transcript`. Operations helpers include `ops/hivemindos/business-simulation-operator` and `ops/hivemindos/work-board-airtable-bridge`.

## Current Guides

<div class="docGrid">
  <section class="docCard">
    <h3>Hive Skills</h3>
    <p>HivemindOS-owned skills for assimilation, capability search, skill fusion, workflow fusion, and AEON fusion.</p>
    <a href="hive-skills.html">Open Hive skills</a>
  </section>
  <section class="docCard">
    <h3>Third-Party Skills</h3>
    <p>Curated external and optional skills, including the Obsidian Native Brain Pack and optional UI, media, and automation skill packs.</p>
    <a href="third-party-skills.html">Open third-party skills</a>
  </section>
</div>

## Maintenance Rule

Any packaged skill addition, removal, rename, install-policy change, or source relocation must update:

- `packaged-skills/README.md`
- this docs section
- `docs/for-users/whole-brain/shared-skills.md` when shared brain behavior changes
- `AGENTS.md` so future agents know the docs contract
- `scripts/test-vault-structure-contract.mjs` when the skill affects required brain setup or docs navigation
