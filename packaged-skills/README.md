# Packaged Skills

This folder is the product-facing catalog for HivemindOS skills used by setup and future one-click install flows.

Use this folder only for skills intended to ship with HivemindOS as installable user content. Agent-only working skills should live in the shared Obsidian brain skill shelf, not in this repository.

Expected layout:

```text
packaged-skills/
  auto-install/
    <slug>/
      SKILL.md
      ...
  optional/
    <slug>/
      SKILL.md
      ...
    <category>/
      <source>/
        <slug>/
          SKILL.md
          ...
```

## Auto-Install

Skills in `auto-install/` are copied into the user's shared HivemindOS brain `Skills/` shelf during setup. Agents discover those skills from the shared brain after installation, not because they live in this repository folder.

Keep this folder small and foundational. These skills become part of the default shared context for HivemindOS users.

Current auto-install set:

- `hive-assimilate` for mandatory pre-build search across the shared brain, user projects, local/private indexes, and public GitHub before software creation.
- `hive-pulse` for built-in last-30-days signal briefs across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources. It bundles the pinned MIT licensed `mvanhorn/last30days-skill` engine with Hive-facing instructions, audit notes, a setup-installed command shim, and a local deterministic default path for out-of-the-box use.
- `hive-capability-search`, `hive-remote-capability-use`, `hive-skill-fusion`, `hive-workflow-fusion`, and `hive-aeon-fusion` for capability discovery, remote app execution, and reusable hive workflows.
- `hive-brain-memory` for typed Shared Brain Memory recall, durable writes, and memory evolution with superseded-history preservation.
- `hive-brain-compiled-wiki` for HivemindOS compiled-brain entity/concept/summary writes, compiled-wiki search, graph-native MCP reads, wiki health, and shared-brain contribution contracts.
- Obsidian Native Brain Pack: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills` so agents can write Obsidian-native notes, Bases, Canvas maps, and clean web-source markdown.

## Catalog Subdivisions

GitHub Pages docs split packaged skills into:

- **Hive skills:** HivemindOS-native skills under `docs/packaged-skills/hive-skills.md`.
- **Third-party packaged skills:** curated external or optional skills under `docs/packaged-skills/third-party-skills.md`.

Any packaged skill addition, removal, rename, install-policy change, or source relocation must update this README and the GitHub Pages docs in `docs/packaged-skills/`.

## Optional

Skills in `optional/` are a store/catalog for later one-click install. They must not be automatically copied into the shared brain, mirrored into runtime skill folders, or injected into agent context.

Optional skills may be flat (`packaged-skills/optional/<slug>/`) or grouped by catalog category (`packaged-skills/optional/<category>/<source>/<slug>/`). When a user installs an optional skill, the app should copy the selected package directory into the configured shared brain `Skills/<slug>/` folder and rebuild the shared skill index.

Capability search may surface optional packages as installable workflow playbooks so users and agents can discover them before install. That search result is catalog metadata only: the skill becomes an active shared-brain skill only after the user installs it.

Grouped optional directories can also expose a whole-directory pack in the Skill Browser's Packs tab. Installing that pack copies every packaged skill in the directory into the shared brain in one pass, still using local package files and audit checks instead of upstream installer commands.

Current optional catalog:

- `brand/hivemindos/brand-book-concept-page`: optional HivemindOS brand skill for creating multiple brand directions and compact brand-book concept artifacts with trademark and private-asset safety gates.
- `brand/hivemindos/out-of-home-subway-campaign`: optional HivemindOS brand skill for transit/out-of-home campaign mockups, with placement, endorsement, and transit-authority caveats.
- `crypto/hivemindos/b20-issuer-proof`: optional HivemindOS crypto skill for preparing deterministic Base B20 issuer proof cards, requiring confirmation, and creating B20 tokens through the encrypted local wallet route on Base Sepolia.
- `crypto/hivemindos/nansen-*`: optional HivemindOS crypto skills for Nansen simple and complex research — DeFi positions, Smart Money holdings, token top holders, token screener discovery, token tracking and Smart Money netflow, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring — all routed through the HivemindOS Nansen intelligence path with read-only/copytrade guardrails. They are optional workflow playbooks, not required for Nansen access through the built-in `nansen_intelligence` action or `/api/nansen` routes.
- `design/`: optional UI and design-engineering skills, including 109 skills imported from the UI Skills directory and 73 MIT-licensed skills from `MengTo/Skills`, preserving upstream source namespaces as `design/<source>/<skill>/` and available as the `Design Optional Skills Directory` pack.
- `design/mengto/`: optional MIT skills from `MengTo/Skills` for Codex design workflows, asset sourcing, design-first UI prompting, landing/pricing pages, motion systems, WebGL/canvas/3D patterns, and visual style recipes.
- `design/diffusionstudio/text-to-lottie`: optional MIT skill (vendored verbatim from `diffusionstudio/lottie` with its full `references/` library, `evals/`, and upstream LICENSE) for authoring/editing/fixing production-ready Lottie/Bodymovin JSON animations — logos, type, loaders/icons, UI microinteractions, lower thirds, diagrams, data/stat animations, product promos, and visual effects. Its in-player render/verify loop expects the upstream Skia Skottie player project (`npx skills add diffusionstudio/lottie`).
- `design/hivemindos/newsroom-data-visualization`: optional HivemindOS design skill for publication-grade chart choice, annotation, source/caveat handling, and responsive data-story graphics.
- `design/hivemindos/swiss-grid-editorial-page`: optional HivemindOS design skill for disciplined Swiss-grid editorial pages, reports, posters, and webpages.
- `design/hivemindos/vignelli-canon-design-system`: optional HivemindOS design-system skill for restrained identity, wayfinding, publication, and interface systems.
- `events/hivemindos/venue-activation-visualizer`: optional HivemindOS event skill for sponsor/venue activation before-and-after visuals, production checklists, and venue-permission caveats.
- `gtm/athm793/local-business-scraper`: optional, security-audited local business lead-research skill for the pinned MIT `athm793/local-business-scraper` Google Maps scraper, with consent gates for install, Playwright Chromium download, scraping scope, browser profiles, and lead-data handling.
- `gtm/hivemindos/home-service-design-quote`: optional HivemindOS GTM skill for home-service design concepts, estimated itemized quotes, before/after packages, and contractor-review disclaimers.
- `gtm/hivemindos/pluggable-analytics-connect`: optional HivemindOS GTM skill for a generic multi-provider analytics view — per-entity provider linking (PostHog/Plausible/GA4/self-funnel), shared-env credentials, a provider-adapter abstraction, and honest guided-setup/empty states.
- `gtm/hivemindos/posthog-provisioning-and-query`: optional HivemindOS GTM skill for provisioning PostHog projects and reading metrics/funnels over its REST API (org→project model, personal vs public keys, ingestion-vs-management hosts, HogQL queries).
- `gtm/hivemindos/self-serve-payment-funnel`: optional HivemindOS GTM skill for building an agent-drivable offer/checkout/preview funnel — per-client pages with a deliverable preview, custom Stripe-billed packages, Cal booking, an authorized create API, and a fail-closed webhook.
- `gtm/hivemindos/small-business-preview-engine`: optional HivemindOS GTM skill for consent-aware local business prospect discovery, preview-site concepts, and approval-gated outreach.
- `gtm/hivemindos/stripe-payment-integration`: optional HivemindOS GTM skill for SDK-free Stripe integration — server-side Checkout Sessions (price id or dynamic price_data), HMAC webhook verification with replay window, idempotent fulfillment, REST provisioning of products/prices/webhooks, and the account/billing-separation reality.
- `media/heygen-com/hyperframes`: optional Apache-2.0 HeyGen HyperFrames entry/router skill (read-first) that renders video from HTML and routes any make/edit-a-video request to the right HyperFrames workflow. Vendors only the router; the domain and workflow skills install on demand via `npx hyperframes init` or `npx skills add heygen-com/hyperframes --all`.
- `media/higgsfield/higgsfield-api-quirks`: optional Higgsfield API workaround skill for undocumented model-specific payload requirements, including Seedance 2.0 audio, aspect-ratio, and reference-slot constraints.
- `media/higgsfield/higgsfield-generate`: optional Higgsfield media-generation skill for Cloud API and standard consumer Higgsfield CLI/dashboard workflows. It keeps API-key/env usage separate from dashboard login, and asks which surface to use when unspecified.
- `media/hivemindos/ai-ugc-production-pipeline`: optional HivemindOS media-production skill for turning campaign research, visual anchors, Higgsfield/Seedance generation, batch UGC scripts, and metric-driven regeneration into one approval-gated short-form ad workflow.
- `media/hivemindos/claymation-explainer`: optional HivemindOS media skill for storyboarded claymation-style explainers with generation, voice, caption, assembly, and render-QA gates.
- `media/hivemindos/claymation-podcast-clip`: optional HivemindOS media skill for turning permitted podcast/audio clips into stylized claymation shorts while preserving original audio and likeness rights.
- `media/hivemindos/content-rewards-viral-app-campaign`: optional HivemindOS growth skill for turning an app's clippable aha moment into Content Rewards-style viral format banks, creator course briefs, influencer web versions, reward rules, and weekly optimization loops.
- `media/hivemindos/daily-briefing-trailer`: optional HivemindOS media skill for turning approved calendar, inbox, Work Board, or agenda context into a short private briefing trailer.
- `media/hivemindos/instagram-reel-growth-workflow`: optional HivemindOS media-growth skill for studying a public Instagram account, finding current short-form niche angles, writing retention-optimized Reel scripts, engineering stronger hooks, and structuring a human-approved daily AI video loop.
- `media/hivemindos/launch-video-hyperframes`: optional HivemindOS media skill for launch videos with text-safe shot composition, generated footage, motion overlays, and render QA.
- `media/hivemindos/video-shot-transcript`: optional HivemindOS media-analysis skill for local video shot/angle dissection with transcript or visible-caption alignment, using FFmpeg/Tesseract locally and requiring explicit approval before external transcription.
- `n8n/`: 8 optional n8n GTM-automation skills imported from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and available as the `N8N Optional Skills Directory` pack. The upstream pack ships flat fragment files without frontmatter, so the importer synthesizes `name`/`description` and records provenance.
- `ops/hivemindos/business-simulation-operator`: optional HivemindOS operations skill for founder/operator simulations that convert approved actions into Work Board tasks.
- `ops/hivemindos/work-board-airtable-bridge`: optional HivemindOS operations skill for importing, linking, or mirroring Airtable records while keeping the built-in Work Board canonical.

### Importing optional skills

`scripts/import-packaged-skills.mjs` vendors external `SKILL.md` repos into this folder repeatably. It clones the upstream repo at a pinned commit, normalizes each skill into `<category>/<source>/<slug>/SKILL.md` (synthesizing frontmatter when the upstream file has none), writes `.hivemind-skill-source.json` provenance (license, repo, commit, source URL), and records a `sha256` of each vendored `SKILL.md` in `skills-lock.json`.

- `node scripts/import-packaged-skills.mjs --list` — show configured sources.
- `node scripts/import-packaged-skills.mjs n8n` — import a source (use `--dry-run` first for unvalidated sources).
- `node scripts/import-packaged-skills.mjs mengto` — refresh the optional `design/mengto/` catalog from the pinned MIT upstream shape `agent-skills/<category>/<skill>/`.
- `node scripts/import-packaged-skills.mjs --verify` — re-hash every vendored skill against `skills-lock.json` and fail on drift.

Keep packaged skills self-contained, user-safe, and installable without relying on Liam's local agent runtime paths.
