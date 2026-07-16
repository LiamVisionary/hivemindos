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
| `gtm/mikefutia/reddit-voc-research` | Security-audited optional MIT skill for collecting bounded public Reddit threads and comments, then synthesizing pains, desires, objections, verbatim customer phrases, competitor signals, and ad angles with exact Reddit citations. The collector omits author names, reads its provider key from the shared environment, and remains read-only. |
| `gtm/hivemindos/b2b-social-gtm` | HivemindOS-authored optional GTM skill for a B2B social content-to-pipeline system: voice foundation files, a content engine with hook-first drafting and a 90-day matrix, network mining, and multi-channel repurposing across LinkedIn, X, video, and email — pairing with linkedin-gtm for the outreach core. |
| `gtm/hivemindos/cold-email-gtm` | HivemindOS-authored optional GTM skill for the full cold-email motion: ICP and objection mapping, verified signal research, five first-touch frameworks, a 6-touch sequence with a breakup email, a QA score gate before sending, deliverability and domain-warming setup, compliance checks, and metric-driven diagnosis. |
| `gtm/hivemindos/event-marketing-gtm` | HivemindOS-authored optional GTM skill for relationship-driven event marketing: anchor attendees from real existing relationships, the +1 activation framework that fills a room without cold outreach, invite and activation scripts, room design for introductions, and post-event warm-intro conversion inside the 72-hour window. |
| `gtm/hivemindos/home-service-design-quote` | HivemindOS-authored optional GTM skill for home-service concepts, estimated itemized quotes, before/after packages, and contractor-review disclaimers. |
| `gtm/hivemindos/linkedin-gtm` | HivemindOS-authored optional GTM skill for a three-layer LinkedIn motion: content and authority, warming before outreach, and outreach with a 4-message DM sequence, sell-by-chat, and inbox triage — human approval on all outbound and LinkedIn-terms caution on automation. |
| `gtm/hivemindos/organic-reach-gtm` | HivemindOS-authored optional GTM skill for an organic content-to-pipeline engine: 3-pillar weekly mix, post-type skeletons, lead-magnet posts with comment-keyword CTAs, a 3-person content team, signature-framework + proof-library positioning, and Instagram as B2B top-of-funnel — with a hard no-fabricated-proof rule. |
| `gtm/hivemindos/outreach-brief-gtm` | HivemindOS-authored optional GTM skill for the persistent-brief outbound pattern: one canonical brief built from real deal evidence and kept loaded across sessions, with first-touch/follow-up/DM/cold-call copywriting, pipeline health reviews, and reply-rate audits run against it. |
| `gtm/hivemindos/reddit-gtm` | HivemindOS-authored optional GTM skill for a rules-respecting Reddit motion: subreddit research and validation, value-first comments without links, four post shapes, fast keyword-alert response to buying-intent threads, and inbound lead scoring, with human approval on all posting. |
| `gtm/hivemindos/small-business-preview-engine` | HivemindOS-authored optional GTM skill for consent-aware local business prospect discovery, preview-site concepts, and approval-gated outreach. |
| `gtm/hivemindos/tiktok-app-ads-growth-loop` | HivemindOS-authored optional GTM skill for attribution-ready TikTok mobile-app acquisition: MMP/app-event verification, contribution-LTV economics, Smart+ versus manual campaign selection, six-creative tests, Spark Ads, authentic comment operations, and evidence-based kill/hold/scale decisions. |
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
| `media/hivemindos/video-shot-transcript` | HivemindOS-authored optional media-analysis skill for breaking a local video into unique camera/pose/angle segments and aligning each segment with visible captions, embedded subtitles, local ASR, or user-approved transcription. |
| `n8n/` n8n GTM pack | 8 optional n8n GTM-automation skills from `forma-norden/n8n-gtm-workflow-pack` (MIT), grouped as `n8n/forma-norden/<skill>/` and installable together through the `N8N Optional Skills Directory` pack. Covers lead ingestion/enrichment, outreach orchestration, CRM sync, lead scoring/routing, workflow reliability guardrails, observability/cost control, Clay integration, and self-hosting. |
| `ops/hivemindos/business-simulation-operator` | HivemindOS-authored optional operations skill for founder/operator simulations that convert approved actions into Work Board tasks. |
| `ops/hivemindos/work-board-airtable-bridge` | HivemindOS-authored optional operations skill for importing, linking, or mirroring Airtable records while keeping the built-in Work Board canonical. |
| `research/hivemindos/kill-my-thesis` | HivemindOS-authored optional research skill for a cross-family adversarial thesis gate: a bundled script routes the thesis to a non-Anthropic reviewer model, refuses same-family review, and returns a fail-closed PUBLISHABLE / NEEDS WORK / DO NOT PUBLISH verdict file before a research note ships. |
| `research/hivemindos/research-call-tracker` | HivemindOS-authored optional research skill for publish-time call accountability: Call Tracker and Trade Journal ledgers in the shared brain, a no-row-not-published rule, stop discipline for open positions, and win rate computed from closed rows only. |
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
