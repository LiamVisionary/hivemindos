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

- `harness-engineering`, an attributed HivemindOS adaptation of Ryan Lopopolo's CC BY 4.0 method for fixed-worker baseline/treatment experiments, context lifecycle evidence, outcome-and-proof grading, and explicit retain/revise/remove decisions.
- `engineering-discipline` for a risk-scoped HivemindOS engineering workflow: design when needed, real baselines, red/green evidence, systematic implementation, verification, independent review, and safe handoff. It is the canonical orchestrator for the optional Engineering Discipline pack.
- `bankr-skill-deployment` for choosing between a Bankr skill, app, x402 Cloud endpoint, direct Wallet/Agent API integration, and an external always-on backend; then packaging, publishing, installing, updating, and verifying the result without leaking wallet credentials or commercial authority into the client.
- `create-zero-human-company` for turning a business goal or existing repository into a durable, approval-gated HivemindOS company with a verified crew, apex metric, products, budgets, and setup state—without silently launching autonomy.
- `operate-zero-human-company` for running an already-created company through a strict highest-leverage triage order—setup blockers, expiring spend approvals, genuine ACTION NEEDED decisions, retryable infrastructure noise, budget and burn review, directive hygiene, and launch/pause/freeze posture with approval-count backpressure—without bypassing approval gates or clearing queues dishonestly.
- `hive-assimilate` for mandatory pre-build search across the shared brain, user projects, local/private indexes, and public GitHub before software creation.
- `hive-pulse` for built-in last-30-days signal briefs across Reddit, X, YouTube, TikTok, Hacker News, Polymarket, GitHub, and web sources. It bundles the pinned MIT licensed `mvanhorn/last30days-skill` engine with Hive-facing instructions, audit notes, a setup-installed command shim, and a local deterministic default path for out-of-the-box use.
- `hive-quant-research` for research-only hypothesis swarms with lagged Rust backtests, independent Python validation, hard overfitting gates, durable experiment lineage, and approved Scheduler runs from reviewed request files.
- `hive-capability-search`, `hive-remote-capability-use`, `hive-skill-fusion`, `hive-workflow-fusion`, and `hive-aeon-fusion` for capability discovery, remote app execution, and reusable hive workflows.
- `hive-brain-memory` for typed Shared Brain Memory recall, durable writes, and memory evolution with superseded-history preservation.
- `hive-brain-compiled-wiki` for HivemindOS compiled-brain entity/concept/summary writes, compiled-wiki search, graph-native MCP reads, wiki health, and shared-brain contribution contracts.
- `hive-skill-autoresearch` for the built-in, review-gated skill-improvement loop: measure the installed baseline, test four independent variants, keep regression floors, and return a winning diff without silently replacing the skill. Evo is an optional execution backend, not a prerequisite.
- `notebooklm` for safe discovery and use of the optional local NotebookLM integration: pinned native MCP tools, browser-based machine-local authentication, explicit notebook IDs, and confirmation gates for deletion, downloads, generation, and sharing.
- `wrapup` for explicit end-of-session capture: deduplicated/evolved typed Shared Brain Memory plus a concise redacted session-summary source in the user's verified NotebookLM AI Brain notebook.
- The Apache-2.0 HeyGen HyperFrames suite: `hyperframes` plus all 18 domain and workflow siblings. Agents distinguish concrete creation requests from ordinary discussion; when an actionable request leaves the method open, they ask about cloud AI, local AI, or HTML / HyperFrames. The HTML branch resolves only bundled sibling skills and never runs an upstream skills installer. The suite is pinned to one audited commit; mutable installer commands are disabled, and only the 40 MB demo-only animation asset bundle is excluded.
- Obsidian Native Brain Pack: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills` so agents can write Obsidian-native notes, Bases, Canvas maps, and clean web-source markdown.

## Catalog Subdivisions

GitHub Pages docs split packaged skills into:

- **Hive skills:** HivemindOS-native skills under `docs/for-users/packaged-skills/hive-skills.md`.
- **Third-party packaged skills:** curated external or optional skills under `docs/for-users/packaged-skills/third-party-skills.md`.

Any packaged skill addition, removal, rename, install-policy change, or source relocation must update this README and the GitHub Pages docs in `docs/for-users/packaged-skills/`.

## Optional

Skills in `optional/` are a store/catalog for later one-click install. They must not be automatically copied into the shared brain, mirrored into runtime skill folders, or injected into agent context.

Optional skills may be flat (`packaged-skills/optional/<slug>/`) or grouped by catalog category (`packaged-skills/optional/<category>/<source>/<slug>/`). When a user installs an optional skill, the app should copy the selected package directory into the configured shared brain `Skills/<slug>/` folder and rebuild the shared skill index.

Capability search may surface optional packages as installable workflow playbooks so users and agents can discover them before install. That search result is catalog metadata only: the skill becomes an active shared-brain skill only after the user installs it.

Grouped optional directories can also expose a whole-directory pack in the Skill Browser's Packs tab. Installing that pack copies every packaged skill in the directory into the shared brain in one pass, still using local package files and audit checks instead of upstream installer commands.

Current optional catalog:

- `brand/hivemindos/brand-book-concept-page`: optional HivemindOS brand skill for creating multiple brand directions and compact brand-book concept artifacts with trademark and private-asset safety gates.
- `brand/hivemindos/hivemindos-brand-visuals`: optional HivemindOS identity skill for art-directing logos, sigils, emblems, and brand imagery around one sharp visual thesis, structurally distinct directions, and mark-first review instead of stacked hive/AI clichés.
- `brand/hivemindos/out-of-home-subway-campaign`: optional HivemindOS brand skill for transit/out-of-home campaign mockups, with placement, endorsement, and transit-authority caveats.
- `crypto/hivemindos/b20-issuer-proof`: optional HivemindOS crypto skill for preparing deterministic Base B20 issuer proof cards, requiring confirmation, and creating B20 tokens through the encrypted local wallet route on Base Sepolia.
- `crypto/hivemindos/nansen-*`: optional HivemindOS crypto skills for Nansen simple and complex research — DeFi positions, Smart Money holdings, token top holders, token screener discovery, token tracking and Smart Money netflow, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring — all routed through the HivemindOS Nansen intelligence path with read-only/copytrade guardrails. They are optional workflow playbooks, not required for Nansen access through the built-in `nansen_intelligence` action or `/api/nansen` routes.
- `design/`: optional UI and design-engineering skills, including 109 skills imported from the UI Skills directory and 73 MIT-licensed skills from `MengTo/Skills`, preserving upstream source namespaces as `design/<source>/<skill>/` and available as the `Design Optional Skills Directory` pack.
- `design/mengto/`: optional MIT skills from `MengTo/Skills` for Codex design workflows, asset sourcing, design-first UI prompting, landing/pricing pages, motion systems, WebGL/canvas/3D patterns, and visual style recipes.
- `design/emilkowalski/`: optional MIT design-engineering skills from `emilkowalski/skills` (Emil Kowalski, ex-Vercel/Linear, author of Sonner/Vaul) — `emil-design-eng` (UI polish, animation decisions, component craft), `review-animations` (strict animation/motion code review with a companion `STANDARDS.md` rule catalog; ships `disable-model-invocation: true`), `animation-vocabulary` (reverse-lookup glossary for motion terms), and `apple-design` (Apple's fluid-motion and interface principles translated for the web).
- `design/diffusionstudio/text-to-lottie`: optional MIT skill (vendored verbatim from `diffusionstudio/lottie` with its full `references/` library, `evals/`, and upstream LICENSE) for authoring/editing/fixing production-ready Lottie/Bodymovin JSON animations — logos, type, loaders/icons, UI microinteractions, lower thirds, diagrams, data/stat animations, product promos, and visual effects. Its in-player render/verify loop expects the upstream Skia Skottie player project (`npx skills add diffusionstudio/lottie`).
- `design/hivemindos/newsroom-data-visualization`: optional HivemindOS design skill for publication-grade chart choice, annotation, source/caveat handling, and responsive data-story graphics.
- `design/hivemindos/swiss-grid-editorial-page`: optional HivemindOS design skill for disciplined Swiss-grid editorial pages, reports, posters, and webpages.
- `design/hivemindos/vignelli-canon-design-system`: optional HivemindOS design-system skill for restrained identity, wayfinding, publication, and interface systems.
- `events/hivemindos/venue-activation-visualizer`: optional HivemindOS event skill for sponsor/venue activation before-and-after visuals, production checklists, and venue-permission caveats.
- `engineering/obra-superpowers/`: 12 pinned MIT-licensed engineering methods from `obra/superpowers` v6.1.1, augmented with HivemindOS task, authorization, Work Board, and evidence policy. The upstream global bootstrap, hooks, skill-authoring system, and brainstorming web server are excluded. Install the coherent set through the `HivemindOS Engineering Discipline` manifest pack.
- `gtm/athm793/local-business-scraper`: optional, security-audited local business lead-research skill for the pinned MIT `athm793/local-business-scraper` Google Maps scraper, with consent gates for install, Playwright Chromium download, scraping scope, browser profiles, and lead-data handling.
- `gtm/mikefutia/google-ads-builder`: optional, security-audited MIT skill for turning a public website into a reviewable Google Search campaign draft with tightly grouped keywords, negative keywords, responsive ad copy, extensions, recommended settings, a Google Ads Editor CSV, and a local dashboard. It does not connect to Google Ads or spend money; claims, keywords, conversion tracking, budgets, and policy still require review before import or launch.
- `gtm/mikefutia/reddit-voc-research`: optional, security-audited MIT skill for bounded public Reddit voice-of-customer research. It collects source-linked threads and comments, removes author identity, and guides evidence-validated synthesis of pains, desires, objections, verbatim phrases, competitor signals, and ad angles. Local/BYOK use is separate from the paid hosted Reddit VOC Hivemind Mini app.
- `gtm/hivemindos/apple-ads-revenuecat-growth-loop`: optional HivemindOS GTM skill for an ethical Apple Search Ads + RevenueCat growth loop on iOS subscription apps — readiness scoring, attribution verification, country-tier competitor-intent campaigns, spend/transaction export joins, and kill/hold/fix/scale decisions with approval gates on all spend, bid, and App Store asset changes.
- `gtm/hivemindos/b2b-social-gtm`: optional HivemindOS GTM skill for a B2B social content-to-pipeline system — voice foundation files every generator reads first, a content engine (hook-first drafting, 90-day content matrix, carousels, scoring against the account's own history, pinned-comment link placement), network mining, and multi-channel repurposing — pairing with linkedin-gtm for the outreach core.
- `gtm/hivemindos/cold-email-gtm`: optional HivemindOS GTM skill for the full cold-email motion — ICP and objection mapping, verified signal research, five first-touch frameworks, a 6-touch sequence with a breakup email, two-tier personalisation, an 80+ QA score gate before sending, deliverability/DNS/domain-warming setup, CAN-SPAM and GDPR checks, and metric-driven diagnosis.
- `gtm/hivemindos/event-marketing-gtm`: optional HivemindOS GTM skill for relationship-driven event marketing as a pipeline engine — anchor attendees from real existing relationships, the +1 activation framework that compounds a room from 5 anchors to 35–40 ICP guests without cold outreach, invite/activation/follow-up scripts, room design for introductions, and post-event warm-intro conversion inside the 72-hour window.
- `gtm/hivemindos/google-business-profile-public-audit`: optional HivemindOS GTM skill for read-only public Google Business Profile audits against the top 3 map-pack competitors — categories, attributes, review velocity, posts, photos, services, description, and NAP — emitting a structured `gbp_audit` weak-signal report and truthful personalization hooks for a lead-gen pipeline; never edits any GBP.
- `gtm/hivemindos/home-service-design-quote`: optional HivemindOS GTM skill for home-service design concepts, estimated itemized quotes, before/after packages, and contractor-review disclaimers.
- `gtm/hivemindos/instagram-growth-system`: optional HivemindOS GTM skill for evidence-led Instagram growth and monetization — account baselines, audience research, positioning and pillars, idea and sales-content banks, Reel hooks, content optimization, format-aware repurposing, and a measurable 60-day solo-creator operating system.
- `gtm/hivemindos/linkedin-gtm`: optional HivemindOS GTM skill for a four-layer LinkedIn motion — content and authority (hook shapes, four content types, profile-conversion layer, lead-magnet posts, niche openers), warming before outreach, outreach (connection requests, a 4-message DM sequence, sell-by-chat, inbox triage), and full-funnel social selling (audience-building-before-publishing, the 70/20/10 TOFU/MOFU/BOFU content ratio, buyer-signal contact capture, conversion channels) — with human approval on all outbound and explicit LinkedIn-terms caution on automation.
- `gtm/hivemindos/local-gbp-posts-calendar`: optional HivemindOS GTM skill for an 8-week Google Business Profile posting calendar — 2-3 posts/week rotating seasonal, before/after, neighborhood, review-highlight, team, and educational themes, with full copy for weeks 1-4 and outlines for weeks 5-8; pure copy generation with truthfulness placeholders, no auto-posting.
- `gtm/hivemindos/local-review-response-templates`: optional HivemindOS GTM skill for a reusable review-response template system — three structurally distinct, human variations per rating tier (5-star through 1-2-star) with truthful service/neighborhood keyword injection, non-defensive negative-review handling, and a human-escalation rule; pure copy generation, no auto-posting.
- `gtm/hivemindos/organic-reach-gtm`: optional HivemindOS GTM skill for an organic content-to-pipeline engine — 3-pillar weekly mix, five post-type skeletons, lead-magnet posts with comment-keyword CTAs, the source-content method (write once, distribute across a 7-day run), 3 convert-buckets, a 60-min/day rhythm, CTA-by-goal frameworks and a weekly posting schedule, a 3-person content team on a Friday-ready cycle, signature-framework + proof-library positioning, a 4-channel distribution flywheel, and Instagram as B2B top-of-funnel — with a hard no-fabricated-proof rule and no third-party scrapers.
- `gtm/hivemindos/outreach-brief-gtm`: optional HivemindOS GTM skill for the persistent-brief outbound pattern — build one canonical brief from real deal evidence (positioning, value props, offer, ICP, persona, competitors, market size, pains), keep it loaded across sessions, and run first-touch/follow-up/DM/cold-call copywriting, pipeline health reviews, and reply-rate audits against it.
- `gtm/hivemindos/pluggable-analytics-connect`: optional HivemindOS GTM skill for a generic multi-provider analytics view — per-entity provider linking (PostHog/Plausible/GA4/self-funnel), shared-env credentials, a provider-adapter abstraction, and honest guided-setup/empty states.
- `gtm/hivemindos/posthog-provisioning-and-query`: optional HivemindOS GTM skill for provisioning PostHog projects and reading metrics/funnels over its REST API (org→project model, personal vs public keys, ingestion-vs-management hosts, HogQL queries).
- `gtm/hivemindos/reddit-gtm`: optional HivemindOS GTM skill for a rules-respecting Reddit motion — subreddit research and ICP validation, value-first comments without links, four community-tested post shapes, fast keyword-alert response to buying-intent threads, and inbound lead scoring/routing, with a human-approval gate on all posting.
- `gtm/hivemindos/self-serve-payment-funnel`: optional HivemindOS GTM skill for building an agent-drivable offer/checkout/preview funnel — per-client pages with a deliverable preview, custom Stripe-billed packages, Cal booking, an authorized create API, and a fail-closed webhook.
- `gtm/hivemindos/small-business-preview-engine`: optional HivemindOS GTM skill for consent-aware local business prospect discovery, preview-site concepts, and approval-gated outreach.
- `gtm/hivemindos/startup-customer-acquisition-sprint`: optional HivemindOS GTM skill for a seven-lane weekly customer-acquisition sprint — launch-max across many surfaces, competitor backlink/directory cloning, warm outbound from social engagement, UGC creator seeding, video-first build-in-public, customer watering holes, and trend capture — with quotas, a scoreboard, and consent/disclosure/anti-spam guardrails.
- `gtm/hivemindos/stripe-payment-integration`: optional HivemindOS GTM skill for SDK-free Stripe integration — server-side Checkout Sessions (price id or dynamic price_data), HMAC webhook verification with replay window, idempotent fulfillment, REST provisioning of products/prices/webhooks, and the account/billing-separation reality.
- `gtm/hivemindos/tiktok-app-ads-growth-loop`: optional HivemindOS GTM skill for attribution-ready TikTok mobile-app acquisition — MMP/app-event verification, contribution-LTV economics, Smart+ versus manual campaign selection, six-creative tests, Spark Ads, authentic comment operations, and evidence-based kill/hold/scale decisions.
- `gtm/hivemindos/viral-product-landing-page`: optional HivemindOS GTM skill for auditing, writing, or redesigning product landing pages with a conversion and shareability lens — hero-first critique, specific copy rewrites, pricing/CTA/proof checks, OG-image recommendations, and a distilled principles reference for deep teardowns.
- `gtm/hivemindos/x-warm-outreach-gtm`: optional HivemindOS GTM skill for a 14-day warm outreach ladder on X/Twitter — ICP lead research, thoughtful likes/replies/quote-tweets until the sender's name is familiar, then a short 3-line DM with one low-friction question and a single follow-up; manual/human-approved only, with explicit X automation-rules caution.
- `media/higgsfield/higgsfield-api-quirks`: optional Higgsfield API workaround skill for undocumented model-specific payload requirements, including Seedance 2.0 audio, aspect-ratio, and reference-slot constraints.
- `media/higgsfield/higgsfield-generate`: optional Higgsfield media-generation skill for Cloud API and standard consumer Higgsfield CLI/dashboard workflows. It keeps API-key/env usage separate from dashboard login, and asks which surface to use when unspecified.
- `media/hivemindos/ai-ugc-production-pipeline`: optional HivemindOS performance-creative and media-production skill for turning public-ad research and honest pain/reframe positioning into five-beat scripts, approved storyboards, verified MiniMax H3/Higgsfield/Seedance generation, controlled variants, and metric-driven regeneration.
- `media/hivemindos/minimax-h3-video-prompting`: optional HivemindOS-authored MiniMax H3 prompt compiler for T2VA, I2VA, FL2VA, L2VA, and Ref2VA schemas, with boundary-frame, reference-label, dialogue/audio, license/territory, approval, and artifact-QA gates. It links to but does not redistribute MiniMaxAI's upstream guides or examples.
- `media/hivemindos/video-generator-prompting`: optional HivemindOS exact-runtime video prompt router. It resolves the provider, model, endpoint, mode, duration, anchors, and audio surface before loading MiniMax H3, LTX 2.3, Seedance, Higgsfield, or another reviewed guide, and fails closed when the runtime is unregistered.
- `media/hivemindos/claymation-explainer`: optional HivemindOS media skill for storyboarded claymation-style explainers with generation, voice, caption, assembly, and render-QA gates.
- `media/hivemindos/claymation-podcast-clip`: optional HivemindOS media skill for turning permitted podcast/audio clips into stylized claymation shorts while preserving original audio and likeness rights.
- `media/hivemindos/content-rewards-viral-app-campaign`: optional HivemindOS growth skill for operating performance-paid faceless AI UGC creator campaigns from app-readiness and format discovery through roster scoring, verified-view rewards, full-funnel diagnosis, cohort/format-decay loops, and a rights-cleared organic-to-paid handoff.
- `media/hivemindos/daily-briefing-trailer`: optional HivemindOS media skill for turning approved calendar, inbox, Work Board, or agenda context into a short private briefing trailer.
- `media/hivemindos/instagram-reel-growth-workflow`: optional HivemindOS media-growth skill for studying a public Instagram account, finding current short-form niche angles, writing retention-optimized Reel scripts, engineering stronger hooks, and structuring a human-approved daily AI video loop.
- `media/hivemindos/launch-video-hyperframes`: optional HivemindOS media skill for launch videos with text-safe shot composition, generated footage, motion overlays, and render QA.
- `media/hivemindos/script-to-short`: optional HivemindOS media skill for turning a topic into structured short-form video inputs — spoken-delivery narration, concrete visual search terms, title, caption, hashtags, and duration targets in renderer-friendly structured fields.
- `media/hivemindos/social-video-publishing`: optional HivemindOS media skill for explicitly requested social video publishing — a hard no-auto-post gate, presence-only credential checks, render QA first, dry-run/private-visibility testing modes, and platform result URLs or explicit failures.
- `media/hivemindos/video-shot-transcript`: optional HivemindOS media-analysis skill for local video shot/angle dissection with transcript or visible-caption alignment, using FFmpeg/Tesseract locally and requiring explicit approval before external transcription.
- `media/hivemindos/viral-startup-launch-video`: optional HivemindOS media skill for startup launch videos that win the first three seconds — outcome-first hooks, the Hook→Problem→Solution→Proof→CTA structure, a 0-2 scorecard, timecoded shot lists, alternate hooks, and truthful-proof rules that mark missing evidence instead of fabricating it.
- `media/mikefutia/video-analyzer`: optional, security-audited Claude Vision skill for sending one explicitly approved local video to Google Gemini and returning a structured scene, audio, visual-detail, and key-moment report. It pins the audited SDK, never prints credential values, requires a per-video upload confirmation, and deletes large temporary Gemini Files API uploads when possible.
- `n8n/`: 8 optional n8n GTM-automation skills imported from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and available as the `N8N Optional Skills Directory` pack. The upstream pack ships flat fragment files without frontmatter, so the importer synthesizes `name`/`description` and records provenance.
- `ops/hivemindos/business-simulation-operator`: optional HivemindOS operations skill for founder/operator simulations that convert approved actions into Work Board tasks.
- `ops/hivemindos/cloudflare-email-service`: optional HivemindOS operations skill for Cloudflare Email Service — Workers `send_email` binding and REST-API sending, Email Routing handlers, wrangler/MCP domain setup, SPF/DKIM/DMARC deliverability, and a common-mistake table, with retrieval-first source discipline and five bundled reference files.
- `ops/hivemindos/google-api-budget-guardrails`: optional HivemindOS operations skill for hard cost guardrails on any Google Cloud API — the three-layer defense (app-level meter, per-day quota caps that make Google refuse runaway calls, billing budget alerts), billing-project identification, worst-case sizing math, gcloud gotcha fixes, and a bundled cap-and-budget helper script.
- `ops/hivemindos/square-billing-setup`: optional HivemindOS operations skill for Square hosted Payment Links billing — the credential taxonomy (App ID vs access token, sandbox vs production), Vercel env scope traps, webhook signature setup, sandbox test cards and real-card-and-refund verification, and the `pre_populated_data` retry fix.
- `ops/hivemindos/work-board-airtable-bridge`: optional HivemindOS operations skill for importing, linking, or mirroring Airtable records while keeping the built-in Work Board canonical.
- `productivity/madslorentzen/ai-job-search`: optional, security-audited MIT workflow for a private local-first job search from profile onboarding and bounded job discovery through ranking, grounded CV and cover-letter drafting, PDF/ATS verification, tracking, interview preparation, outcomes, read-only Gmail review, and approval-gated Notion reporting. It includes six upstream portal clients and never submits applications or sends messages automatically.
- `research/hivemindos/kill-my-thesis`: optional HivemindOS research skill for a cross-family adversarial thesis gate — a bundled Node script sends the thesis to a non-Anthropic reviewer (Grok/Gemini via OpenRouter or Google direct, keys via the shared hive env), refuses Anthropic-family model ids, and returns a fail-closed PUBLISHABLE / NEEDS WORK / DO NOT PUBLISH verdict file before anything drafted from the thesis ships.
- `research/hivemindos/product-analytics-audit`: optional HivemindOS research skill for product growth/funnel/retention/monetization audits over PostHog (HogQL) and RevenueCat v2 APIs — secret-safe credential discovery, complete-day discipline, instrumentation-health checks before product conclusions, and a cross-domain PostHog identity-handoff reference.
- `research/hivemindos/research-call-tracker`: optional HivemindOS research skill for publish-time outcome accountability — maintains Call Tracker and Trade Journal ledgers under the shared brain's `Operations/Research/` (seeded from bundled templates), enforces the no-row-not-published rule, and computes win rate from closed rows only.
- `research/hivemindos/storm-research`: optional HivemindOS research skill for STORM-style multi-perspective research briefs — mode selection (quick source check, STORM brief, full swarm), expert lenses, contradiction maps, synthesis with confidence review, source discipline, and the exact-heading output contract HivemindOS renders as tabs.
- `research/hivemindos/wiki-first-research`: optional HivemindOS research skill for the wiki-first project discipline — scaffolded research/process split, raw sources before synthesis, the kill-my-thesis gate before drafting, versioned never-overwritten drafts, tracker logging at publish, and distilling durable findings back into the shared brain at session close.
- `writing/petergyang/no-ai-slop`: optional, security-audited MIT writing skill for editing drafts with the minimum effective change, preserving the writer's voice, detecting named AI-slop patterns without guessing authorship, and checking rewrites against the bundled evaluation rubric.

### Importing optional skills

Coherent cross-directory packs use versioned manifests under `packaged-skills/packs/`. A manifest references canonical auto-install and optional package directories; it does not duplicate skill bodies. Pack installation can refresh a HivemindOS-managed copy after archiving the prior directory, while an unmanaged colliding skill is preserved.

`scripts/import-packaged-skills.mjs` vendors external `SKILL.md` repos into this folder repeatably. It clones the upstream repo at a pinned commit, normalizes each skill into `<category>/<source>/<slug>/SKILL.md` (synthesizing frontmatter when the upstream file has none), writes `.hivemind-skill-source.json` provenance (license, repo, commit, source URL), and records a `sha256` of each vendored `SKILL.md` in `skills-lock.json`.

- `node scripts/import-packaged-skills.mjs --list` — show configured sources.
- `node scripts/import-packaged-skills.mjs n8n` — import a source (use `--dry-run` first for unvalidated sources).
- `node scripts/import-packaged-skills.mjs mengto` — refresh the optional `design/mengto/` catalog from the pinned MIT upstream shape `agent-skills/<category>/<skill>/`.
- `node scripts/import-packaged-skills.mjs --verify` — re-hash every vendored skill against `skills-lock.json` and fail on drift.

Keep packaged skills self-contained, user-safe, and installable without relying on Liam's local agent runtime paths.
