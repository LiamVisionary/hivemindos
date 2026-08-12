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

Auto-install is reserved for foundational workflows that make a fresh HivemindOS install usable for agents immediately. This includes `create-zero-human-company`, which turns a business goal or linked repository into a verified company setup while keeping launch and external actions behind explicit operator intent, and the complete HyperFrames suite, which gives agents a ready-to-use HTML-video path after the user chooses it instead of cloud or local AI generation. All router, domain, and production workflow skills ship together, so agents never ask users to fetch a missing HyperFrames workflow.

## Optional Skills

Optional packaged skills live under:

```text
packaged-skills/optional/<slug>/
packaged-skills/optional/<category>/<source>/<slug>/
```

They are catalog content until a user installs them. Optional skills must not be silently copied into the shared brain or runtime homes.

Capability search can show optional packages as installable workflow playbooks. That helps agents explain that a reusable workflow exists, but it does not make the package an active shared-brain skill until the user installs it.

Grouped optional directories can appear as installable packs in the Skill Browser. Installing one of those packs copies every local packaged skill in the directory into the shared brain after audit; it does not run upstream installer commands.

HivemindOS also supports curated manifest packs that combine selected auto-install and optional packages without copying their content into a second source tree. The **HivemindOS Engineering Discipline** pack is the first of these: its HivemindOS-owned orchestrator remains the default source of truth, while 12 pinned `obra/superpowers` methods add planning, test-driven development, debugging, isolated work, review, and completion techniques. Installing it archives and refreshes older HivemindOS-managed adaptations, but preserves an unmanaged skill with the same name.

The engineering catalog lives alongside the brand, crypto, design, events, GTM, media, operations, and automation packages.

The optional catalog includes brand, crypto, design, events, GTM, media, operations, and automation packs. Brand helpers include `brand/hivemindos/brand-book-concept-page` and `brand/hivemindos/out-of-home-subway-campaign`. Crypto helpers include `crypto/hivemindos/b20-issuer-proof` for Base B20 issuer proof cards and confirmation-gated Sepolia token creation, plus the `crypto/hivemindos/nansen-*` skills for Nansen DeFi positions, Smart Money holdings, token top holders, token screener discovery, token tracking, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring through read-only HivemindOS Nansen intelligence. The Nansen packages are optional workflow playbooks and are not required for Nansen access through the built-in `nansen_intelligence` action or `/api/nansen` routes. Design helpers include the UI Skills directory, the MIT-licensed `design/mengto/` catalog for Codex workflows, asset sourcing, UI prompting, conversion pages, motion systems, WebGL/canvas/3D effects, and visual style recipes, plus HivemindOS-authored `design/hivemindos/newsroom-data-visualization`, `design/hivemindos/swiss-grid-editorial-page`, and `design/hivemindos/vignelli-canon-design-system`. Event helpers include `events/hivemindos/venue-activation-visualizer`. GTM helpers include `gtm/athm793/local-business-scraper` for consent-gated local business lead research with a pinned, audited Google Maps scraper, `gtm/mikefutia/reddit-voc-research` for pinned, source-linked Reddit customer-language research, plus HivemindOS-authored `gtm/hivemindos/small-business-preview-engine`, `gtm/hivemindos/home-service-design-quote`, `gtm/hivemindos/reddit-gtm` for a rules-respecting Reddit lead motion, `gtm/hivemindos/cold-email-gtm` for the full cold-email motion with a QA gate before sending, `gtm/hivemindos/linkedin-gtm` for a four-layer LinkedIn authority, warming, outreach, and full-funnel social-selling motion (70/20/10 content, buyer-signal capture) with human approval on all outbound, `gtm/hivemindos/b2b-social-gtm` for the voice-foundation, content-engine, and multi-channel repurposing system that feeds it, `gtm/hivemindos/outreach-brief-gtm` for the persistent-brief pattern that keeps every outbound artefact consistent with one evidence-based company brief, `gtm/hivemindos/x-warm-outreach-gtm` for the 14-day X/Twitter warm outreach ladder with human approval on every engagement, `gtm/hivemindos/organic-reach-gtm` for the organic content-to-pipeline engine with lead-magnet posts, the source-content method, a content team, and proof-library positioning, `gtm/hivemindos/tiktok-app-ads-growth-loop` for measured TikTok mobile-app acquisition with attribution, unit economics, creative testing, and authentic comment operations, and `gtm/hivemindos/event-marketing-gtm` for relationship-driven events with anchor attendees, +1 activation, and post-event warm-intro conversion. Media helpers include Higgsfield generation helpers and HivemindOS-authored growth, production, and analysis helpers, such as `media/higgsfield/higgsfield-api-quirks` for model-specific Higgsfield payload workarounds, `media/hivemindos/ai-ugc-production-pipeline` for public-ad research, five-beat scripting, storyboard-first AI UGC production, verified generator routing, controlled variants, and metric-driven regeneration, `media/hivemindos/minimax-h3-video-prompting` for exact MiniMax H3 base and full-reference prompt compilation, `media/hivemindos/video-generator-prompting` for exact-runtime model and endpoint routing before prompt compilation, `media/hivemindos/claymation-explainer`, `media/hivemindos/claymation-podcast-clip`, `media/hivemindos/content-rewards-viral-app-campaign`, `media/hivemindos/daily-briefing-trailer`, `media/hivemindos/instagram-reel-growth-workflow`, `media/hivemindos/launch-video-hyperframes`, and `media/hivemindos/video-shot-transcript`. Operations helpers include `ops/hivemindos/business-simulation-operator` and `ops/hivemindos/work-board-airtable-bridge`.

The HivemindOS brand catalog also includes `brand/hivemindos/hivemindos-brand-visuals`, a mark-first logo and identity workflow built around one concrete brand job and one sharp visual thesis.

## Current Guides

<div class="docGrid">
  <section class="docCard">
    <h3>Hive Skills</h3>
    <p>HivemindOS-owned skills for company creation, assimilation, capability search, skill fusion, workflow fusion, and AEON fusion.</p>
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
