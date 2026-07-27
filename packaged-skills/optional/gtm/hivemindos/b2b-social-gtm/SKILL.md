---
name: b2b-social-gtm
description: Run a B2B social content-to-pipeline system — build voice foundation files every generator reads first, run the content engine (hook-first drafting, a 90-day content matrix, carousels, scoring drafts against the account's own post history, pinned-comment link placement, niche research), mine existing connections for ICP matches, and repurpose one newsletter section across LinkedIn, X, video, and email. Use for "B2B social system", "build my voice files", "content matrix", "repurpose this post", "score this draft", or multi-channel B2B content. Pairs with the linkedin-gtm skill for the outreach core.
---

# B2B Social GTM

A content-to-pipeline system in five layers: build the voice foundation once → run the content engine weekly → warm the ICP through engagement → convert attention into outreach → extend the same content across email, newsletter, and video. This skill carries the voice foundation, content engine, and multi-channel layers; the LinkedIn warming/outreach core (DM sequences, sell-by-chat, connection caps) lives in the companion `linkedin-gtm` skill.

**Hard rules:** platform terms prohibit unauthorized automation and scraping — every outbound item is a human-approved draft and caps are ceilings, not targets. Voice and brand-brief files contain the user's private positioning and history; never publish them. Reach multipliers and reply figures are rules of thumb, not measured guarantees. Never fabricate proof points.

**Voice rules for everything produced:** no em dashes; no AI vocabulary (leverage, delve, streamline, harness, unlock, foster, synergy); specific numbers beat adjectives; capitalize names; comments 200–350 characters, posts 900–1,300; at most 2 hashtags per post or none; sound like a peer, never pitch in a first message; everything is a draft until approved.

## Layer 1 — Voice foundation (run once; everything reads it)

Interview the user and produce four foundation files that every later generator must read before writing anything:

1. **about-me** — 1-of-1 positioning: who they help, what outcome they drive, why them specifically.
2. **voice** — writing patterns from 3–5 of their best samples: sentence length, vocabulary, rhythm, banned phrases.
3. **newsletter-voice** — email-specific structure layered on top: opening, section format, CTA patterns. The newsletter is the system's center of gravity: every piece of content starts as a newsletter section and flows outward, and a prospect who has read it for weeks has self-qualified before any DM.
4. **brand-brief** — offer, exact ICP titles and signals, proof points with real numbers, and outreach history (what worked, what didn't).

Also rebuild the profile as a landing page (see `linkedin-gtm` for the section-by-section formula) and map the niche: the 10–15 thought leaders the ICP already follows, the 5 highest-engagement topics, and 3 content gaps nobody owns.

## Layer 2 — The content engine (weekly)

- **Hook-first drafting:** generate ~10 hook candidates for a topic before writing any body; pick the strongest, then draft. The first two lines are the only thing deciding whether anyone reads on.
- **Content matrix:** cross the user's topic areas with formats to bank ~90 post ideas, each tagged with a track — proof (client results with numbers), framework (a process the ICP can apply), or story (experience turned into a lesson) — and a format (text, carousel, document).
- **Visual formats:** carousels and document posts tend to out-reach text-only posts by a wide margin; produce the asset (rendered graphic or generated infographic) per post.
- **Score against own history:** before a high-stakes post, score the draft against the account's own top performers — hook strength, track performance, CTA, length — not generic best practices.
- **Pinned-comment link placement:** links in a post body suppress reach. Put the lead-magnet or CTA link in a pinned comment (under 150 characters) posted immediately after publishing.
- **Pipeline analytics, not likes:** review weekly which posts generated profile visits, connection requests, and DM conversations; double down on the two best.

## Layers 3–4 — Warming and outreach (delta over linkedin-gtm)

- **Network mining first:** most operators already have hundreds of ICP-matching connections. Scan existing connections against the brand-brief ICP — name, title, company, last interaction, ever-messaged — sorted by fit, before hunting cold contacts.
- **Outreach tooling caps:** ~20 connection requests, ~100 profile fetches, ~15 searches per day; dedupe enrichment lookups against the last 30 days so no profile is paid for twice.
- Everything else — warming stages, connection notes, the 4-message DM sequence, sell-by-chat — follows `linkedin-gtm`.

## Layer 5 — Multi-channel repurposing

One newsletter section fans out into five channel-shaped assets, all written in the user's voice files: a LinkedIn post (900–1,300 chars, hook/body/CTA, no links in body), an X thread (5–7 tweets, hook tweet first, one unit of value per tweet), a short-form video script (30–60 seconds: cold open, three points, CTA), the pinned comment carrying the lead-magnet link, and five email subject-line variants. For full cold-email sequences with a QA gate and deliverability setup, use the companion `cold-email-gtm` skill.

## The weekly rhythm (60–90 minutes)

- **Monday (~25 min):** generate hooks → draft the week's 3 posts → score each against history → produce visuals → schedule Tue/Thu/Sat.
- **Tue–Thu (~10 min/day):** human-approved comments on 5–10 ICP accounts; reply to positive DMs; send 3–5 approved connection requests.
- **Friday (~15 min):** pipeline analytics review → mine the best post's engagers for ICP matches → draft connection notes → repurpose the best post to email/newsletter.

Reusable rows — foundation assets, content plays, pinned-comment and video-script skeletons, repurposing targets, the weekly rhythm, and tooling caps — live in this repository's `workflows/gtm/b2b-social/templates.json` bank, which deliberately does not duplicate the hook shapes and DM spine in `workflows/gtm/linkedin/templates.json`.
