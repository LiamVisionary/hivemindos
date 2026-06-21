---
name: ai-ugc-production-pipeline
description: Use when a user wants to run or design an AI UGC ad/content production pipeline with Claude, parallel research agents, image anchors, Higgsfield MCP or Seedance video generation, batch scripts, platform captions, and closed-loop optimization. Trigger on "AI UGC pipeline", "Claude Opus Higgsfield MCP", "Higgsfield UGC video", "Seedance UGC", "batch UGC ads", "15 videos per day", "AI ad creative factory", or similar short-form performance-content workflows.
---

# AI UGC Production Pipeline

Turn a campaign category, product, offer, or creator brief into a repeatable short-form UGC production loop: research, visual anchors, scripts, Higgsfield/Seedance video shots, platform variants, QA, and performance-driven iteration.

## Core Contract

- Treat this as a workflow recipe, not a promise of output volume, CPM, revenue, downloads, or virality.
- Use current sources for "top-performing", "trending", "last 7 days", "last 14 days", "last 30 days", and competitor claims when tools are available. Cite or summarize what was checked.
- Use public ad libraries, public creator pages, user-owned analytics, screenshots, exports, or explicitly supplied links. Do not bypass login walls or scrape private content.
- Keep concepts original. Analyze competitor patterns, but do not clone another creator's exact script, likeness, voice, visual identity, or proprietary assets.
- Do not publish, schedule, upload to social platforms, spend credits, or post affiliate/campaign links without explicit approval.
- Do not include campaign URLs, affiliate links, or network claims unless the user supplies them or they are verified for the current campaign.
- Treat generated media, product references, user analytics, and local footage as private by default. Ask before uploading private assets to external tools.

## Inputs

Ask only for missing essentials:

- Campaign category, product, offer, or target audience.
- Product references, brand constraints, claims that are legally approved, and forbidden claims.
- Competitors or example creators to study.
- Target platforms: TikTok, Instagram Reels, YouTube Shorts, X, ads manager, or other.
- Preferred generation surface: Higgsfield MCP, Higgsfield Cloud API, consumer Higgsfield CLI/dashboard, or another discovered video generator.
- Output target: creative brief only, scripts only, asset prompts, generated videos, optimization brief, or full pipeline.

## Capability Discovery

Before executing beyond pure drafting, map capabilities by intent:

- Current-signal research: browser/search, `hive-pulse`, platform creative centers, public ad libraries, or user-provided exports.
- Image anchors: a discovered image generator with strong identity, product, and typography support. If using Higgsfield, load `higgsfield-generate` and choose its image default unless the user specifies another model.
- Video generation: use connected Higgsfield MCP when available. If not available, use `higgsfield-generate` through the selected Higgsfield surface. For Seedance 2.0 or Cloud/API payloads, load `higgsfield-api-quirks` before building media/audio/aspect-ratio inputs.
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

Return one unified creative brief:

- 5 strongest content angles.
- 3 hook frameworks with a clear first-frame visual.
- Underserved pain points.
- 10 content ideas with hook text under 12 words.
- Emotional trigger per idea.
- Source/evidence notes and confidence level.

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

## Phase 2: Six-Shot Video Production

Use this structure for 12-18 second vertical UGC unless the user asks otherwise:

1. 0-2.5s hook: direct-to-camera or immediate proof, hook overlay, specific emotion, handheld feel.
2. 2.5-5s pain: identity-level or situation-level problem, no forced product insert.
3. 5-7.5s mechanism: product enters naturally, specific mechanism or differentiator.
4. 7.5-10s evidence: specific result, timeframe, or proof. Use only approved/verified claims.
5. 10-12.5s resolution: genuine relief, identity-level shift, or social proof.
6. 12.5-15s CTA: peer recommendation, next step, or comment/save prompt without sounding like a hard sell.

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

## Phase 3: Batch Scripts And Platform Variants

Write scripts after the visual anchors exist. The script should support the first frame, not compete with it.

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
- Angles:
- Hook frameworks:
- Pain points:
- Evidence confidence:

Asset Plan
- Character:
- Product:
- Overlay:
- Integration:

Production Batch
1. [script title]
   Hook:
   Trigger:
   Shots:
   Captions:
   QA notes:

Optimization Loop
- Metrics to capture:
- Decision rule:
- Regeneration rule:
- Approval gates:
```

## Quality Bar

- First frame, hook text, and emotional trigger must point at the same idea.
- Every script needs a concrete shot list, not just narration.
- Proof must be specific and approved; if not, mark it as a placeholder.
- Output should be ready for a human operator or tool call: asset names, aspect ratio, duration, model/tool choice, and save location.
- Generated media requires artifact verification before saying it is done.
- Publishing requires explicit approval and a provider receipt such as a post URL, scheduled-post id, or `success: true`.
