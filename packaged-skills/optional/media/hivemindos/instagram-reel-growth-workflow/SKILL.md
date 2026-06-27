---
name: instagram-reel-growth-workflow
description: Use when a user wants to analyze or grow an Instagram account with short-form video, especially AI-generated animated stories, Reels/TikToks/Shorts niche research, retention-optimized reel scripts, hook engineering, captions, hashtags, or a repeatable daily content automation loop. Trigger on Instagram handle/profile analysis, "study my account", "find what's working", "write a reel script", "make hooks", "daily posting workflow", "AI generated animated stories", "Reels growth", or similar short-form growth tasks.
---

# Instagram Reel Growth Workflow

Build a personalized short-form content loop from a public Instagram account and fresh niche signal.

## Core Contract

- Start with the user's account when they provide a handle or profile URL. The account study is what makes the workflow specific instead of generic niche advice.
- Use public pages and user-provided exports, screenshots, analytics, or links. Do not bypass login walls, scrape private content, or use another creator's non-public data.
- For "last 30 days", "trending", "highest-performing", "latest", or "today", browse or search current sources when tools are available and cite what was checked. If live access is unavailable, say so and continue from supplied evidence with clear uncertainty.
- Treat visible metrics as directional unless they come from the user's own analytics. Avoid guaranteeing virality.
- Do not auto-post, schedule, DM, follow, comment, or modify accounts without explicit user approval. For publishing or scheduling, use a dedicated social publishing workflow if available and default to dry-run.
- Keep concepts original. Do not clone another creator's exact script, character, voice, or visual identity.

## Inputs

Ask only for missing essentials:

- Instagram handle or public profile URL.
- Niche, audience, or desired account position if it is not obvious.
- Topic or goal for the next reel.
- Constraints: voice, length, offer/CTA, do-not-say topics, asset style, preferred video generation tools, and posting cadence.

## Capability Discovery

When the request goes beyond prompt drafting, identify available capabilities before choosing tools:

- Current-signal research: browser/search, a recent-signal skill such as `hive-pulse`, or user-provided evidence.
- Public profile/account analysis: browser, agentic browsing, Firecrawl-style extraction, or user-provided exports/screenshots.
- Script/caption structuring: this skill's structure, or a dedicated short-form script helper when available.
- Visual/video creation: discovered image/video generators, animation workflows, stock-media search, or the user's preferred tool.
- Assembly and QA: discovered short-video assembly, subtitle timing, and render QA workflows.
- Publishing/scheduling: a dedicated social-video publishing workflow with credential presence checks, dry-run support, explicit approval, and provider receipts.

Choose by capability fit and confirmed availability. Mention gaps by capability, not provider blame.

## Setup: Account DNA

When the handle or URL is available:

1. Inspect the last 30 public Reels/posts, or as many as are publicly accessible.
2. For each item, record the URL/date, format, topic, opening hook, visual style, length if visible, caption pattern, visible metrics, comment themes, and CTA.
3. Identify top performers relative to the account baseline, not only absolute view count.
4. Summarize recurring topics, top-performing hooks, formats, visual styles, engagement patterns, actual audience segments, and what the audience consistently responds to.
5. Note gaps, inaccessible posts, missing metrics, and confidence level.

If the profile cannot be browsed, ask for screenshots, exports, or links to recent posts and continue from that evidence.

## Prompt 1: Niche Research

Find what is going viral in the niche now, then compare it with the Account DNA.

Research high-performing public Instagram Reels, TikToks, YouTube Shorts when relevant, Reddit posts, niche forums, and creator examples from the last 30 days.

Return:

- 5 content angles optimized for AI-generated short videos.
- Repeating hooks, visual styles, emotional triggers, and content formats.
- An evidence table with source, date, metric, and why it matters when available.
- A fit note for each angle: why it matches or conflicts with the user's account.

## Prompt 2: Reel Script

Write a script under 30 seconds unless the user asks for another length.

Use this structure:

- 0-2s: aggressive hook with curiosity, tension, contradiction, stakes, or surprise.
- 2-8s: fast setup of the problem, scene, or premise.
- 8-22s: escalation, twist, reveal, or story-beat progression.
- 22-28s: satisfying payoff.
- Final seconds: subtle CTA for comments, saves, shares, or follows without sounding spammy.

Optimize for watch time, replays, comments, and shares. For AI-generated animated stories, include visual beats and prompt cues beside the narration. Keep spoken lines easy to read aloud; mark pauses, cuts, onscreen text, and sound cues when useful.

## Prompt 3: Hook Engineering

Study winning hooks from the Account DNA and niche research, especially the first 3 seconds.

Generate 5 hook variations. For each, include:

- Hook line.
- Trigger used: surprise, fear, ego, urgency, desire, status, mystery, taboo, or contradiction.
- Visual opening.
- Pacing note.
- Why it should beat the baseline hook.
- Risk: clickbait, too broad, off-brand, insensitive, or platform-sensitive.

## Prompt 4: Daily Loop

Build a repeatable workflow:

1. Trend scan.
2. Account-fit filter.
3. Angle selection.
4. Script draft.
5. Hook swap tests.
6. Visual prompt or storyboard.
7. Voice, music, SFX, and subtitle brief.
8. Video assembly plan.
9. Caption and hashtag package.
10. Human review gate.
11. Schedule or publish only after approval.
12. Results capture for the next Account DNA refresh.

Deliver a simple daily checklist, optional automation architecture, tool choices, and a fallback manual path. Keep the system realistic for the user's current tools and available credentials.

## Ready-To-Run Prompt Templates

Account setup:

```text
Browse instagram.com/[your_handle] and pull the last 30 reels and posts that are publicly accessible. Analyze recurring topics, top-performing hooks, formats, and engagement patterns. Then map out the actual audience and what they consistently respond to. Be explicit about inaccessible posts or uncertain metrics.
```

Niche research:

```text
Analyze the highest-performing Instagram Reels, TikToks, YouTube Shorts, and Reddit posts in the [niche] niche from the last 30 days. Identify repeating hooks, visual styles, emotional triggers, and content formats that consistently generate high engagement. Then summarize the 5 strongest content angles optimized for AI-generated content and short-form videos, cross-checked against my account patterns.
```

Reel script:

```text
Write a short-form Instagram Reel script about [topic] with an aggressive hook in the first 2 seconds. Create immediate curiosity, tension, or controversy to stop scrolling, then deliver a fast and satisfying payoff. Keep it under 30 seconds and optimize the structure for watch time, replays, comments, and shares. Finish with a subtle CTA.
```

Hook variants:

```text
Study the top-performing Reels in [niche] and my account's best posts. Break down hook structure, pacing, and emotional triggers used in the first 3 seconds. Then generate 5 new hook variations that are more curiosity-driven, emotionally charged, and optimized to stop scrolling instantly. Focus on triggers like surprise, fear, ego, urgency, or desire.
```

Daily workflow:

```text
Build a complete AI-powered content workflow for Instagram in the [niche] niche. The system should identify trending topics daily, generate high-retention scripts, create matching AI visuals, turn them into short-form videos, and generate optimized captions and hashtags. Structure everything as a repeatable workflow designed for consistent daily posting and growth, with human approval before publishing.
```

## Default Final Output

Use this shape unless the user asks for something narrower:

```text
Account DNA
- Topics:
- Best hooks:
- Best formats:
- Audience:
- Engagement pattern:
- Confidence:

5 Viral Angles
1. [angle] - evidence, account fit, suggested visual style

Selected Reel
- Topic:
- Hook:
- Script:
- Visual beats:
- Caption:
- Hashtags:
- CTA:

Hook Bench
1. [hook] - trigger, visual open, risk

Daily Loop
- Daily checklist:
- Automation architecture:
- Manual fallback:
- Review/publish gate:
- Metrics to capture:
```

## Quality Bar

- Make every recommendation trace back to either the user's account, current niche evidence, or a clearly labeled creative hypothesis.
- Prefer specific visual/story choices over generic advice like "make it engaging".
- Make the first 2 seconds concrete: exact line, exact frame, exact motion or cut.
- Include at least one comment-bait question that is genuine to the story, not engagement spam.
- Keep daily automation practical: include what can be automated, what should remain human-reviewed, and what metrics feed the next iteration.
