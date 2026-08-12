---
name: ai-ugc-production-pipeline
description: Use when a user wants to research, script, storyboard, generate, batch, or optimize AI UGC ads and short-form performance content. Covers paid-ad creative research, Meta Ad Library pattern coding, pain/reframe positioning, hook-problem-demo-proof-CTA scripts, storyboard-first production, verified MiniMax H3, Higgsfield, or Seedance video routing, controlled variants, platform captions, and closed-loop optimization. Trigger on "AI UGC pipeline", "AI UGC ads", "MiniMax H3 UGC", "Seedance UGC", "Meta Ads Library research", "performance creative", "storyboard this ad", "batch UGC ads", "30-second AI ad", "15 videos per day", "AI ad creative factory", or similar asset-production workflows. Do not use for creator recruitment/rewards or paid-campaign execution.
---

# AI UGC Production Pipeline

Turn a campaign category, product, offer, or creator brief into a repeatable short-form UGC production loop: research, visual anchors, scripts, runtime-specific video shots, platform variants, QA, and performance-driven iteration.

For direct-response or paid-social creative, read [`references/performance-creative.md`](references/performance-creative.md) before Phases 0-3. It adds the research ledger, five-beat script, storyboard approval, variant discipline, and claim controls. Keep creator recruitment, rewards, and distribution in `content-rewards-viral-app-campaign`; keep platform campaign setup, budgets, and bidding in the relevant paid-acquisition skill.

## Source And License Posture

This skill was augmented on 2026-08-11 from the user-supplied, untitled article beginning **“Which means anyone can run ads now.”** The supplied capture is 628 lines / 47,880 characters and ends mid-sentence. It promotes GenViral Studio and did not identify an author, publication date, or reproduction license, so the skill and public package paraphrase its useful operating mechanisms instead of reproducing its scripts or prompts.

Treat the article's competitor-ad counts, dates, impressions, duration-to-performance inference, model comparisons, research volume, generation count, costs, accuracy comparisons, and output-quality statements as source claims, not verified results. Current primary documentation confirms that Meta's Ad Library exposes active ads, but ad longevity alone does not prove profitability. Dreamina's current Seedance 2.5 pages describe 30-second standard generation, multimodal references, storyboards, and longer beta modes, while the model landing page also says availability is coming soon; verify the selected account, region, runtime, model version, and live controls before drafting or generating.

MiniMaxAI's official H3 repository and prompt guides currently describe native audiovisual generation, 4–15 second outputs, base T2VA/I2VA/FL2VA/L2VA modes, and full-reference Ref2VA. Its current Community License also defines excluded territories, including the United States, European Union, United Kingdom, and Republic of Korea. Use `minimax-h3-video-prompting` for H3 prompt authoring, but treat model access, hosted use, output use, territory, and provider authorization as unresolved until checked for the actual operator and runtime.

## Core Contract

- Treat this as a workflow recipe, not a promise of output volume, CPM, revenue, downloads, or virality.
- Use current sources for "top-performing", "trending", "last 7 days", "last 14 days", "last 30 days", and competitor claims when tools are available. Cite or summarize what was checked.
- Use public ad libraries, public creator pages, user-owned analytics, screenshots, exports, or explicitly supplied links. Do not bypass login walls or scrape private content.
- Treat a long-running or highly duplicated ad as a research lead, not a confirmed winner. Record what the library actually exposes and label performance inference separately.
- Keep concepts original. Analyze competitor patterns, but do not clone another creator's exact script, likeness, voice, visual identity, or proprietary assets.
- Reject copied news footage, invented accuracy comparisons, deceptive demonstrations, fabricated testimonials, and shame-based health/body claims. Translate a painful moment into an honest, non-degrading problem statement and use only approved proof.
- Do not publish, schedule, upload to social platforms, spend credits, or post affiliate/campaign links without explicit approval.
- Do not include campaign URLs, affiliate links, or network claims unless the user supplies them or they are verified for the current campaign.
- Treat generated media, product references, user analytics, and local footage as private by default. Ask before uploading private assets to external tools.

## Inputs

Ask only for missing essentials:

- Campaign category, product, offer, or target audience.
- Product references, brand constraints, claims that are legally approved, and forbidden claims.
- Competitors or example creators to study.
- Conversion event, buyer objection, approved proof ledger, and the painful before-state / desired after-state.
- Target platforms: TikTok, Instagram Reels, YouTube Shorts, X, ads manager, or other.
- Preferred generation surface: MiniMax H3 local/hosted runtime, Higgsfield MCP, Higgsfield Cloud API, consumer Higgsfield CLI/dashboard, or another discovered video generator.
- Output target: creative brief only, scripts only, asset prompts, generated videos, optimization brief, or full pipeline.

## Capability Discovery

Before executing beyond pure drafting, map capabilities by intent:

- Current-signal research: browser/search, `hive-pulse`, platform creative centers, public ad libraries, or user-provided exports.
- Performance-creative rows: when the HivemindOS repository is available, sample research fields, hook shapes, five-beat scripts, storyboard checks, controlled-variant dimensions, and claim gates from `workflows/gtm/performance-creative/templates.json`. The bank is authored starting material, not measured truth.
- Image anchors: a discovered image generator with strong identity, product, and typography support. If using Higgsfield, load `higgsfield-generate` and choose its image default unless the user specifies another model.
- Video generation: first load `video-generator-prompting` and verify the exact model, checkpoint, task mode, provider, duration, inputs, audio behavior, license/territory, and runtime. For MiniMax H3, load `minimax-h3-video-prompting` and resolve H3-Base-FL2VA versus H3-Base-Ref2VA plus T2VA/I2VA/FL2VA/L2VA/Ref2VA. For Dreamina/Jimeng Seedance 2.5 prompt authoring, load `seedance-prompt-optimizer`; it does not submit jobs. For Seedance 2.0 through MUAPI, use `muapi-seedance-video`; for Higgsfield, use `higgsfield-generate` and load `higgsfield-api-quirks` before building media/audio/aspect-ratio inputs. Use another discovered generator when it better matches the user's approved surface.
- Script and caption writing: this skill's templates, plus a short-form scripting or writing-style skill when relevant.
- Voice/audio: discovered TTS/voice tools, user-supplied voice assets, or a configured external voice provider. Ask before uploading private voice samples.
- Assembly and QA: `short-video-assembly`, `subtitle-timing`, `video-render-qa`, local FFmpeg checks, and platform preview checks when available.
- Publishing/scheduling: `social-video-publishing` or a configured channel with dry-run support, explicit approval, and provider receipts.

Required credential checks must use key names only, such as `HIGGSFIELD_API_KEY_ID` and `HIGGSFIELD_API_KEY_SECRET`. Never read, print, or store secret values.

## Phase 0: Parallel Research

Use parallel research only when tools or agents support it. Otherwise run the same lanes sequentially and state the constraint.

Research lanes:

1. Public ad library scan for recent UGC-style ads in the category.
2. Short-form trend scan from TikTok Creative Center, Instagram/Reels examples, YouTube Shorts, X, Reddit, or niche communities.
3. Competitor and landing-page scan for positioning shifts, hooks, proof points, and underserved pains.

For paid-ad research, code comparable ads into one evidence sheet before synthesizing. Capture source URL, active dates, variants visible, opening line, first visual, audience callout, pain, reframe, mechanism/demo, objection, proof, CTA, rights concerns, and what is observed versus inferred. A current active ad is confirmed as active; its profitability is not.

Return one unified creative brief:

- 5 strongest content angles.
- 3 hook frameworks with a clear first-frame visual.
- Underserved pain points.
- 10 content ideas with hook text under 12 words.
- Emotional trigger per idea.
- Source/evidence notes and confidence level.
- One pain-to-transformation brief and an approved-proof ledger.

Prompt template:

```text
Run a parallel research pass for [campaign category].

Lane 1: identify recent public UGC-style ads in [category]. For each: hook format, opening visual, pain framing, CTA structure, visible evidence, and why it may be working.
Lane 2: identify current short-form formats in [category] from the last [7/14/30] days. For each: format type, engagement signal, 3-second visual pattern, and emerging hooks that are not overused.
Lane 3: analyze [competitor 1, competitor 2, competitor 3] public content and landing pages. Identify positioning shifts, new hook frameworks, format changes, proof points, and underserved pain points.

Synthesize into one creative brief with 5 angles, 3 hook frameworks, 10 specific ideas, hook text under 12 words, emotional trigger, and source notes. Mark unverified or inaccessible evidence.
```

## Phase 1: Visual Anchors

Build visual anchors before final scripts so the opening frame and hook text reinforce the same trigger.

Generate or draft:

- Character reference sheet: 4 variations matched to the strongest angle and audience. Pick the most relatable, not automatically the most polished.
- Product mockup grid: front, side, top, three-quarter, label close-up, texture close-up, held in hand, on counter, lifestyle context.
- Overlay library: hook, pain acknowledgment, proof, mechanism, and CTA overlays with readable typography.
- Product-in-hand integration: same character holding or using the product naturally with matching lighting.

Prompt template:

```text
Based on the creative brief, create image prompts for:
1. Character reference sheet: 4 variations of [demographic/audience], authentic phone-selfie UGC style, 9:16.
2. Product mockup grid: [product] from front, side, top, three-quarter, label close-up, texture close-up, held naturally in hand, on counter, and lifestyle context.
3. Text overlay library: hook, pain acknowledgment, mechanism, proof, CTA; readable white text with black outline or a platform-native equivalent.
4. Product-in-hand integration: selected character holding [product] naturally, waist-level or in-use, matching environment and light.

Return exact prompts, model/tool recommendation, aspect ratio, and asset naming.
```

Verify generated anchor assets before continuing: product text legibility, no identity drift across references, no impossible hands/packaging, no unsupported claims, and mobile-safe overlay readability.

For a multi-beat direct-response ad, approve a storyboard before generating video. Each beat needs a timing budget, one visible action, shot size/camera role, spoken-to-camera versus insert mode, prop/hand assignment, continuity state, spoken line, and observable end state. Use the board to reject wrong casting, polished-ad texture, weak first frames, impossible blocking, and continuity errors while iteration is still cheap. Storyboard labels, arrows, frame numbers, and timing chrome are production notes and must not leak into the final footage.

## Phase 2: Six-Shot Video Production

Use this structure for 12-18 second vertical UGC unless the user asks otherwise:

1. 0-2.5s hook: direct-to-camera or immediate proof, hook overlay, specific emotion, handheld feel.
2. 2.5-5s pain: identity-level or situation-level problem, no forced product insert.
3. 5-7.5s mechanism: product enters naturally, specific mechanism or differentiator.
4. 7.5-10s evidence: specific result, timeframe, or proof. Use only approved/verified claims.
5. 10-12.5s resolution: genuine relief, identity-level shift, or social proof.
6. 12.5-15s CTA: peer recommendation, next step, or comment/save prompt without sounding like a hard sell.

For a 25-30 second direct-response ad, do not stretch the 15-second template mechanically. Use the approved five-beat spine from the reference: `hook -> problem -> demo -> proof -> CTA`. Give each stage one primary change and an observable end state, then route the shot plan through the exact model/runtime guidance. Keep the word count and timing derived from the chosen speaker's actual read, not a copied universal pace.

For MiniMax H3, the current official duration range cannot carry a 25–30 second ad in one output. Plan two or three 4–15 second clips, assign complete beats and terminal states to each clip, and carry the same approved character/product/voice references plus a continuity manifest across prompts. Use Ref2VA for reusable identity/product/voice guidance; use I2VA, FL2VA, or L2VA only when a supplied image is a true boundary-frame contract. Assemble only after every clip passes marketing, media, rights, audio, and continuity QA.

Higgsfield/Seedance prompt template:

```text
Using [Higgsfield MCP / selected video generator], generate a 6-shot AI UGC video.

Character reference: [asset 1].
Product reference: [asset 2].
Overlay library: [asset 3].
Aspect: 9:16 vertical.
Duration: [15s default].
Style: handheld phone-native UGC, realistic motion, platform-ready framing.

Shot 1 (0-2.5s) hook: [hook text] overlay, character direct to camera, expression [emotion], first frame [visual].
Shot 2 (2.5-5s) pain: character says [pain line], expression [vulnerable/frustrated], product not forced.
Shot 3 (5-7.5s) mechanism: product enters naturally, character says [mechanism line].
Shot 4 (7.5-10s) evidence: [approved specific proof], product visible.
Shot 5 (10-12.5s) resolution: expression shifts to relief, character says [resolution line].
Shot 6 (12.5-15s) CTA: warm peer recommendation, character says [CTA line].

Maintain character identity and product consistency across all shots. Keep lip sync and audio timing aligned if audio is used. Save output to [workspace/output folder].
```

When using Seedance 2.0 through an API-style payload, verify `aspect_ratio: "9:16"` and consult `higgsfield-api-quirks` for audio placement and reference-slot limits.

When using MiniMax H3, compile each approved clip through `minimax-h3-video-prompting`. Base modes must use `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music`; Ref2VA must use its six-section reference schema. Preserve approved dialogue exactly inside `<d>[Language] ...</d>`, keep speaker IDs stable, separate diegetic events from audience-only music, and record the prompt-guide/version plus live endpoint capabilities in the generation receipt. A valid prompt does not authorize a model call, private-reference upload, or spend.

## Phase 3: Batch Scripts And Platform Variants

Write scripts after the visual anchors exist. The script should support the first frame, not compete with it.

Get one control concept coherent before batching variants. A valid variant changes one named dimension—speaker, setting, hook, objection, proof treatment, CTA, or first-frame action—while holding the rest of the control stable. If several variables change at once, label it as a new concept rather than pretending it identifies a causal winner.

Return an explicit manifest row for every control and variant. Do not rely on “everything else stays the same” as a substitute for fields the operator must audit. Each row names: variant id, control asset, changed dimension, old value, new value, hypothesis, held-constant elements, claim/rights approval, generation approval, review metrics, and current status. The approval block must separately name private-reference upload; approving a concept or generation budget does not authorize transferring a private face, voice, product, analytics, or app asset to an external provider.

Batch prompt:

```text
Using the creative brief and visual anchors, write 10 AI UGC scripts.

For each script include:
- 6-shot structure matching the video template.
- Shot-by-shot spoken line.
- Shot 1 overlay under 12 words with an open loop.
- Emotional trigger and why it fits the audience.
- Visual cue for each shot.
- Voice direction: accent if specified, emotional register, pacing, delivery notes per shot.
- Platform captions for TikTok, Instagram Reels, YouTube Shorts, and X.
- CTA that sounds like a peer recommendation.

Use conversational language. Avoid em dashes. Do not invent proof, earnings, medical, legal, financial, or product claims that are not approved.
```

For performance ads, include compliance notes:

- Claim source or "user must approve".
- Risk flags: exaggerated result, regulated category, body-image sensitivity, financial promise, health promise, before/after implication.
- Required disclaimer or proof asset if relevant.

## Phase 4: Closed-Loop Optimization

Use user-owned metrics, platform exports, or supplied screenshots. Do not claim access to private analytics unless the user connected or pasted them.

Map measurement across the full available funnel: exposure/attention → click → install → activation → trial/paywall when applicable → paid conversion → refunds → retention → contribution or retained value. If monetization, refunds, or another stage is genuinely inapplicable, mark that stage `N/A` with a reason; do not silently omit it.

Optimization prompt:

```text
Analyze this week's performance data against the account history: [metrics or export].

Identify top 10% and bottom 10% by [primary metric]. For each group, compare:
- hook category
- first-frame visual
- emotional trigger
- platform
- posting time
- script structure
- product visibility timing
- retention drop points

State the single most specific actionable finding.

For videos with retention drop below [threshold] at [timestamp], diagnose the cause and draft a regeneration instruction from that point forward while preserving everything before the drop.

Write next week's production brief applying the finding.
```

If regeneration is approved, call the selected video generator only for the affected shot range when the tool supports partial regeneration. Preserve the original opening if the drop occurs later.

## Default Final Output

Use this shape unless the user asks for a narrower artifact:

```text
Capability Map
- Research:
- Image anchors:
- Video generation:
- Audio/voice:
- Assembly/QA:
- Publishing:
- Gaps:

Creative Brief
- Audience:
- Painful moment / desired transformation:
- Angles:
- Hook frameworks:
- Pain points:
- Approved proof / forbidden claims:
- Evidence confidence:

Asset Plan
- Character:
- Product:
- Overlay:
- Integration:
- Storyboard approval:

Production Batch
1. [script title]
   Hook:
   Trigger:
   Shots:
   Control or changed variable:
   Captions:
   QA notes:

Optimization Loop
- Metrics to capture:
- Decision rule:
- Regeneration rule:
- Approval gates: concept, claims/rights, private-reference upload, generation spend, publishing, and paid campaign execution
```

## Quality Bar

- First frame, hook text, and emotional trigger must point at the same idea.
- Separate observed ad-library facts from performance inference; never call longevity, variant count, or visibility proof of profitability.
- Every script needs a concrete shot list, not just narration.
- Proof must be specific and approved; if not, mark it as a placeholder.
- For health, body-image, financial, legal, dating, minors, or before/after creative, replace humiliation and unsupported causal claims with an honest problem, approved mechanism, and reviewable proof.
- Storyboards are preflight artifacts, not final-video frames; verify the final generation does not reproduce board chrome, labels, placeholder logos, or annotations.
- Confirm model/runtime/version and live availability before applying MiniMax H3, Seedance, or another provider's syntax or claiming duration, reference, audio, editing, resolution, or continuity behavior. For H3, also resolve current license/territory/provider authorization before execution.
- Repeat the complete control/variant manifest fields in every row so one exported row remains auditable out of context.
- Name private-reference upload as its own approval gate; neither storyboard approval nor permission to generate implies permission to transfer private assets.
- Make the measurement plan trace the full available funnel through paid conversion, refunds, retention, and contribution or retained value; mark genuinely inapplicable stages `N/A` with reasons.
- Output should be ready for a human operator or tool call: asset names, aspect ratio, duration, model/tool choice, and save location.
- Generated media requires artifact verification before saying it is done.
- Publishing requires explicit approval and a provider receipt such as a post URL, scheduled-post id, or `success: true`.
