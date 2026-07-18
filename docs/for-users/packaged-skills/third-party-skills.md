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
| `notebooklm` | `teng-lin/notebooklm-py` | Safe use of the optional local NotebookLM integration through a pinned native MCP preview, machine-local browser authentication, explicit notebook IDs, and confirmation gates for destructive or outward actions. The Python package remains opt-in from Integrations. |
| HyperFrames suite (`hyperframes` + 18 sibling skills) | `heygen-com/hyperframes` | HTML-native video routing and production workflows. Agents distinguish creation from discussion. A concrete request with no method opens the Cloud AI / Local AI / HTML-HyperFrames decision control; only the explicit HTML branch uses HyperFrames. Every referenced workflow is already bundled at one pinned, audited commit, with mutable installer commands disabled and demo-only binary showcase assets excluded. |

HivemindOS does not auto-install the upstream `obsidian-cli` skill because the app already carries HivemindOS-aware Obsidian CLI and vault write policy.

## Optional Third-Party Skills

### HivemindOS Engineering Discipline

The **HivemindOS Engineering Discipline** pack combines the built-in `engineering-discipline` orchestrator with 12 selected methods from [`obra/superpowers`](https://github.com/obra/superpowers), pinned to v6.1.1 / commit `d884ae04edebef577e82ff7c4e143debd0bbec99` under the MIT license.

The donor set covers scoped brainstorming, plan writing and execution, test-driven development, systematic debugging, worktree isolation, optional parallel/subagent workflows, giving and receiving review, verification before completion, and branch handoff. HivemindOS adds an authority preface to every donor skill: upstream “always” language applies only when that method has been selected for suitable work, and it never grants permission for commits, pushes, merges, deletion, deployment, external actions, or agent fan-out.

The package intentionally excludes the upstream plugin bootstrap, hooks, `using-superpowers`, `writing-skills`, and the brainstorming web server. Installation copies audited local files only. It does not run an upstream installer or start a service.

Optional skills live in:

```text
packaged-skills/optional/
```

Capability search can surface optional packages as installable workflow playbooks. Those results are catalog metadata until the user installs the package into the shared brain.

Current optional catalog:

| Skill | Purpose |
| --- | --- |
| `brand/hivemindos/brand-book-concept-page` | HivemindOS-authored optional brand skill for generating multiple brand directions and compact concept artifacts with trademark, originality, and private-asset safety gates. |
| `brand/hivemindos/out-of-home-subway-campaign` | HivemindOS-authored optional brand skill for transit/out-of-home campaign mockups, using generated or rights-cleared assets and avoiding false placement or endorsement claims. |
| `crypto/hivemindos/b20-issuer-proof` | HivemindOS-authored optional crypto skill for creating Base B20 token issuer proof cards, defaulting live tests to Base Sepolia, requiring explicit confirmation, and executing only through the encrypted local wallet route. |
| `crypto/hivemindos/nansen-*` | HivemindOS-authored optional crypto skills for Nansen simple and complex research: DeFi positions, Smart Money holdings, token top holders, token screener discovery, token tracking and Smart Money netflow, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring. They route through HivemindOS Nansen intelligence, keep copytrade-named workflows read-only, and are not required for Nansen access through the built-in `nansen_intelligence` action or `/api/nansen` routes. |
| `design/` UI Skills pack | 109 optional UI and design-engineering skills from the UI Skills directory, grouped as `design/<source>/<skill>/` so duplicate upstream names remain distinct, and installable together through the `Design Optional Skills Directory` pack. |
| `design/mengto/` MengTo Skills pack | 73 optional MIT-licensed skills from `MengTo/Skills`, grouped as `design/mengto/<skill>/`, covering Codex design workflows, asset sourcing, design-first UI prompting, landing/pricing pages, motion systems, WebGL/canvas/3D patterns, and visual style recipes. |
| `design/emilkowalski/` Design Engineering pack | 4 optional MIT-licensed design-engineering skills from `emilkowalski/skills`, grouped as `design/emilkowalski/<skill>/`: `emil-design-eng` (UI polish, animation decisions, component craft), `review-animations` (strict animation/motion code review with a companion `STANDARDS.md` rule catalog), `animation-vocabulary` (reverse-lookup glossary for motion terms), and `apple-design` (Apple's fluid-motion and interface principles for the web). |
| `design/hivemindos/newsroom-data-visualization` | HivemindOS-authored optional design skill for publication-grade chart choice, annotation, source/caveat handling, and responsive data-story graphics. |
| `design/hivemindos/swiss-grid-editorial-page` | HivemindOS-authored optional design skill for disciplined Swiss-grid editorial pages, reports, posters, and webpages. |
| `design/hivemindos/vignelli-canon-design-system` | HivemindOS-authored optional design-system skill for restrained identity, wayfinding, publication, and interface systems. |
| `design/nextlevelbuilder/ui-ux-pro-max` | UI/UX implementation guidance, design stack data, templates, and helper scripts for richer frontend work. |
| `events/hivemindos/venue-activation-visualizer` | HivemindOS-authored optional event skill for sponsor and venue activation before/after visuals, production checklists, and venue-permission caveats. |
| `gtm/athm793/local-business-scraper` | Security-audited optional GTM skill for the pinned MIT `athm793/local-business-scraper` Google Maps scraper. It is conditionally approved only for consent-gated local installs, fresh browser profiles, scoped scraping, and careful lead-data handling. |
| `gtm/mikefutia/google-ads-builder` | Security-audited optional MIT skill for turning a public website into a reviewable Google Search campaign draft, Google Ads Editor CSV, and local dashboard. It does not connect to Google Ads or spend money; review claims, keywords, conversion tracking, budgets, and Google policy before import or launch. |
| `gtm/mikefutia/reddit-voc-research` | Security-audited optional MIT skill for collecting bounded public Reddit threads and comments, then synthesizing pains, desires, objections, verbatim customer phrases, competitor signals, and ad angles with exact Reddit citations. The collector omits author names, reads its provider key from the shared environment, and remains read-only. |
| `gtm/hivemindos/apple-ads-revenuecat-growth-loop` | HivemindOS-authored optional GTM skill for an ethical Apple Search Ads + RevenueCat growth loop on iOS subscription apps: readiness scoring, attribution verification, country-tier competitor-intent campaigns, spend/transaction export analysis, and kill/hold/fix/scale decisions — with approval required before any spend, bid, budget, or App Store asset change. |
| `gtm/hivemindos/b2b-social-gtm` | HivemindOS-authored optional GTM skill for a B2B social content-to-pipeline system: voice foundation files, a content engine with hook-first drafting and a 90-day matrix, network mining, and multi-channel repurposing across LinkedIn, X, video, and email — pairing with linkedin-gtm for the outreach core. |
| `gtm/hivemindos/cold-email-gtm` | HivemindOS-authored optional GTM skill for the full cold-email motion: ICP and objection mapping, verified signal research, five first-touch frameworks, a 6-touch sequence with a breakup email, a QA score gate before sending, deliverability and domain-warming setup, compliance checks, and metric-driven diagnosis. |
| `gtm/hivemindos/event-marketing-gtm` | HivemindOS-authored optional GTM skill for relationship-driven event marketing: anchor attendees from real existing relationships, the +1 activation framework that fills a room without cold outreach, invite and activation scripts, room design for introductions, and post-event warm-intro conversion inside the 72-hour window. |
| `gtm/hivemindos/google-business-profile-public-audit` | HivemindOS-authored optional GTM skill for read-only public Google Business Profile audits against the top map-pack competitors: categories, attributes, review velocity, posts, photos, services, description, and NAP diffs, rolled into a structured weak-signal report with truthful personalization hooks for a lead-gen pipeline. It never edits a profile and never fabricates a field it could not read. |
| `gtm/hivemindos/home-service-design-quote` | HivemindOS-authored optional GTM skill for home-service concepts, estimated itemized quotes, before/after packages, and contractor-review disclaimers. |
| `gtm/hivemindos/linkedin-gtm` | HivemindOS-authored optional GTM skill for a four-layer LinkedIn motion: content and authority (with a profile-conversion layer, lead-magnet posts, and niche openers), warming before outreach, outreach with a 4-message DM sequence and sell-by-chat, and full-funnel social selling (audience-building-before-publishing, a 70/20/10 TOFU/MOFU/BOFU content ratio, buyer-signal contact capture, conversion channels) — human approval on all outbound and LinkedIn-terms caution on automation. |
| `gtm/hivemindos/local-gbp-posts-calendar` | HivemindOS-authored optional GTM skill for an 8-week Google Business Profile posting calendar: 2-3 posts per week rotating seasonal, before/after, neighborhood, review-highlight, team, and educational themes, with full copy for the first four weeks and outlines after. Pure copy generation with truthfulness placeholders — it never auto-posts. |
| `gtm/hivemindos/local-review-response-templates` | HivemindOS-authored optional GTM skill for a reusable review-response template system: three structurally distinct, human variations per rating tier with truthful service and neighborhood keyword injection, non-defensive negative-review handling, and a human-escalation rule for legal or safety allegations. Pure copy generation — it never auto-posts replies. |
| `gtm/hivemindos/organic-reach-gtm` | HivemindOS-authored optional GTM skill for an organic content-to-pipeline engine: 3-pillar weekly mix, post-type skeletons, lead-magnet posts with comment-keyword CTAs, the source-content method (write once, distribute across a 7-day run), 3 convert-buckets, a 60-min/day rhythm, CTA-by-goal frameworks, a weekly posting schedule, a 3-person content team, signature-framework + proof-library positioning, and Instagram as B2B top-of-funnel — with a hard no-fabricated-proof rule and no third-party scrapers. |
| `gtm/hivemindos/outreach-brief-gtm` | HivemindOS-authored optional GTM skill for the persistent-brief outbound pattern: one canonical brief built from real deal evidence and kept loaded across sessions, with first-touch/follow-up/DM/cold-call copywriting, pipeline health reviews, and reply-rate audits run against it. |
| `gtm/hivemindos/reddit-gtm` | HivemindOS-authored optional GTM skill for a rules-respecting Reddit motion: subreddit research and validation, value-first comments without links, four post shapes, fast keyword-alert response to buying-intent threads, and inbound lead scoring, with human approval on all posting. |
| `gtm/hivemindos/small-business-preview-engine` | HivemindOS-authored optional GTM skill for consent-aware local business prospect discovery, preview-site concepts, and approval-gated outreach. |
| `gtm/hivemindos/startup-customer-acquisition-sprint` | HivemindOS-authored optional GTM skill for a seven-lane weekly customer-acquisition sprint: repeated launches with distinct angles, competitor backlink and directory cloning, warm outbound from social engagement, UGC creator seeding, video-first build-in-public, customer watering holes, and trend capture — with quotas, a scoreboard, and consent, disclosure, and anti-spam guardrails. |
| `gtm/hivemindos/tiktok-app-ads-growth-loop` | HivemindOS-authored optional GTM skill for attribution-ready TikTok mobile-app acquisition: MMP/app-event verification, contribution-LTV economics, Smart+ versus manual campaign selection, six-creative tests, Spark Ads, authentic comment operations, and evidence-based kill/hold/scale decisions. |
| `gtm/hivemindos/viral-product-landing-page` | HivemindOS-authored optional GTM skill for auditing, writing, or redesigning product landing pages with a conversion and shareability lens: hero-first critique, specific replacement copy, pricing and CTA clarity, proof before traffic, OG-image recommendations, and a distilled principles reference for deep teardowns. |
| `gtm/hivemindos/x-warm-outreach-gtm` | HivemindOS-authored optional GTM skill for a 14-day warm outreach ladder on X/Twitter: ICP lead research, thoughtful engagement until the sender's name is familiar, then a short DM with one low-friction question and a single follow-up — manual/human-approved only, with X automation-rules caution. |
| `media/higgsfield/higgsfield-api-quirks` | Higgsfield API workaround skill for undocumented model-specific failures and payload requirements, including Seedance 2.0 audio placement, aspect-ratio enforcement, reference-slot limits, and Kling 3.0 matchcut caveats. |
| `media/higgsfield/higgsfield-generate` | Higgsfield media-generation skill for images, video, 3D, audio, Marketing Studio, and Virality Predictor. It supports both Higgsfield Cloud API via shared env keys and the standard consumer CLI/dashboard, asks which surface to use when unspecified, and forbids procedural fallback for Higgsfield requests. |
| `media/hivemindos/ai-ugc-production-pipeline` | HivemindOS-authored optional media-production skill for turning current-signal research, visual anchors, Higgsfield/Seedance video generation, batch UGC scripts, and performance-regeneration rules into one approval-gated ad workflow. |
| `media/hivemindos/claymation-explainer` | HivemindOS-authored optional media skill for storyboarded claymation-style explainers with generation, voice, caption, assembly, and render-QA gates. |
| `media/hivemindos/claymation-podcast-clip` | HivemindOS-authored optional media skill for turning permitted podcast/audio clips into stylized claymation shorts while preserving original audio and likeness rights. |
| `media/hivemindos/content-rewards-viral-app-campaign` | HivemindOS-authored optional growth skill for turning an app's clippable aha moment into Content Rewards-style viral format banks, creator course briefs, influencer web version specs, reward rules, and weekly optimization loops. |
| `media/hivemindos/daily-briefing-trailer` | HivemindOS-authored optional media skill for turning approved calendar, inbox, Work Board, or agenda context into a short private briefing trailer. |
| `media/hivemindos/instagram-reel-growth-workflow` | HivemindOS-authored optional media-growth skill for studying a public Instagram profile, researching current short-form niche patterns, drafting retention-optimized Reel scripts, engineering hooks, and designing a human-approved daily AI video workflow. |
| `media/hivemindos/launch-video-hyperframes` | HivemindOS-authored optional media skill for launch videos with text-safe shot composition, generated footage, motion overlays, and render QA. |
| `media/hivemindos/script-to-short` | HivemindOS-authored optional media skill for turning a topic into structured short-form video inputs: spoken-delivery narration, concrete visual search terms, title, caption, hashtags, and duration targets returned as renderer-friendly structured fields. |
| `media/hivemindos/social-video-publishing` | HivemindOS-authored optional media skill for explicitly requested social video publishing: a hard no-auto-post gate, presence-only credential checks, render QA before upload, dry-run and private-visibility testing modes, and platform result URLs or explicit failure messages. |
| `media/hivemindos/video-shot-transcript` | HivemindOS-authored optional media-analysis skill for breaking a local video into unique camera/pose/angle segments and aligning each segment with visible captions, embedded subtitles, local ASR, or user-approved transcription. |
| `media/hivemindos/viral-startup-launch-video` | HivemindOS-authored optional media skill for startup launch videos that win the first three seconds: outcome-first hooks, the Hook→Problem→Solution→Proof→CTA structure, a scorecard, timecoded shot lists, alternate hooks for testing, and truthful-proof rules that mark missing evidence instead of fabricating it. |
| `media/mikefutia/video-analyzer` | Security-audited Claude Vision skill for sending one explicitly approved local video to Google Gemini and returning a structured scene-by-scene, audio, visual-detail, and key-moment report. It uses a pinned SDK, requires per-video upload confirmation, never prints credential values, and deletes large temporary Gemini Files API uploads when possible. |
| `n8n/` n8n GTM pack | 8 optional n8n GTM-automation skills from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and installable together through the `N8N Optional Skills Directory` pack. Covers lead ingestion/enrichment, outreach orchestration, CRM sync, lead scoring/routing, workflow reliability guardrails, observability/cost control, Clay integration, and self-hosting. |
| `ops/hivemindos/business-simulation-operator` | HivemindOS-authored optional operations skill for founder/operator simulations that convert approved actions into Work Board tasks. |
| `ops/hivemindos/cloudflare-email-service` | HivemindOS-authored optional operations skill for Cloudflare Email Service: Workers `send_email` binding and REST-API sending, Email Routing handlers, wrangler/MCP domain setup, SPF/DKIM/DMARC deliverability, and a common-mistake table, with retrieval-first source discipline and five bundled reference files. |
| `ops/hivemindos/google-api-budget-guardrails` | HivemindOS-authored optional operations skill for hard cost guardrails on any Google Cloud API: a three-layer defense (app-level meter, per-day quota caps that make Google itself refuse runaway calls, billing budget alerts), billing-project identification, worst-case sizing math, gcloud gotcha fixes, and a bundled cap-and-budget helper script. |
| `ops/hivemindos/square-billing-setup` | HivemindOS-authored optional operations skill for Square hosted Payment Links billing: the credential taxonomy (App ID versus access token, sandbox versus production), deployment env-scope traps, webhook signature setup, sandbox test cards and real-card-and-refund verification, and a retry fix that keeps pre-fill validation from blocking checkout. |
| `ops/hivemindos/work-board-airtable-bridge` | HivemindOS-authored optional operations skill for importing, linking, or mirroring Airtable records while keeping the built-in Work Board canonical. |
| `research/hivemindos/kill-my-thesis` | HivemindOS-authored optional research skill for a cross-family adversarial thesis gate: a bundled script routes the thesis to a non-Anthropic reviewer model, refuses same-family review, and returns a fail-closed PUBLISHABLE / NEEDS WORK / DO NOT PUBLISH verdict file before a research note ships. |
| `research/hivemindos/product-analytics-audit` | HivemindOS-authored optional research skill for product growth, funnel, retention, and monetization audits over PostHog (HogQL) and RevenueCat v2 APIs: secret-safe credential discovery, complete-day discipline, instrumentation-health checks before product conclusions, and a cross-domain analytics identity-handoff reference. |
| `research/hivemindos/research-call-tracker` | HivemindOS-authored optional research skill for publish-time call accountability: Call Tracker and Trade Journal ledgers in the shared brain, a no-row-not-published rule, stop discipline for open positions, and win rate computed from closed rows only. |
| `research/hivemindos/storm-research` | HivemindOS-authored optional research skill for STORM-style multi-perspective research briefs: mode selection from quick source check to full research swarm, expert lenses, contradiction maps, synthesis with confidence review, source discipline, and an exact-heading output contract HivemindOS renders as tabs. |
| `research/hivemindos/wiki-first-research` | HivemindOS-authored optional research skill for the wiki-first project discipline: recall the shared brain first, raw sources before synthesis, an adversarial gate before drafting, versioned never-overwritten drafts, and durable findings distilled back into the shared brain at session close. |

Optional third-party skills are vendored by `scripts/import-packaged-skills.mjs`, which pins each skill to an upstream commit and `sha256` in `skills-lock.json`; run `node scripts/import-packaged-skills.mjs --verify` to detect drift.

The auto-installed HyperFrames suite follows the same provenance lock. Its package records the pinned upstream commit and source-archive hash for every sibling skill; setup preserves that shipped provenance in the Shared Brain instead of replacing it with machine-local metadata.

Optional skills must be self-contained and installable without relying on any single machine's local runtime paths.

The `hivemindos` optional skills above are clean-room HivemindOS-authored packages. Some were prompted by public skill catalogs, but unlicensed upstream text, JSON, and scripts are not vendored into the repository.

## Review Rules

Before promoting a third-party skill to auto-install:

1. Confirm license compatibility and record upstream source metadata.
2. Remove or adapt commands that could mutate user data unexpectedly.
3. Make sure the skill respects HivemindOS vault, shared env, and secret-handling rules.
4. Update this docs section, `packaged-skills/README.md`, and the whole-brain shared-skill docs.
