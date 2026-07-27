---
name: local-gbp-posts-calendar
description: Build an 8-week Google Business Profile posting calendar for a local business — 2-3 posts/week mixing seasonal offers, before/after showcases, neighborhood-specific updates, review highlights, team spotlights, and educational posts — with full copy for weeks 1-4 (100-150 words, one target keyword, CTA button, image shot suggestion) and outlines for weeks 5-8. Pure copy generation, no privileged data, no auto-posting. Use for "GBP posts", "Google Business Profile posting calendar", "local content calendar", "GBP updates/offers/events", or as the Bucket-B deliverable that fixes a "no posts in 90 days" signal from google-business-profile-public-audit.
---

# Local GBP Posts — Content Calendar (copy deliverable)

Produce an 8-week Google Business Profile (GBP) posting calendar with ready-to-publish copy, so a local business posts consistently and builds neighborhood relevance — the two things that make GBP posts a ranking and engagement signal.

This is a **Bucket B: pure copy generation** slice. No logged-in tools, no API keys, no GBP ownership. It produces an artifact the client publishes (or, only with separately-granted GBP manager access, a human/agent publishes).

## Why this exists

GBP posts show on the listing, expire after ~7 days, and consistent posting signals an active business — which gets preferred placement. Most competitors don't post at all, so consistency is an immediate edge. The real compounding play is **neighborhood-specific** posts ("just finished a kitchen remodel in {{neighborhood}}") that associate the business with each area it serves.

Composes with `google-business-profile-public-audit`: that Bucket-A skill measures posting cadence; a "no posts in 90 days" or "sparse" finding triggers this skill to deliver the calendar.

## Scope boundary (read before running)

- **Copy generation only.** This skill writes posts. It does **not** publish to any GBP. Publishing requires the client to paste them, or verified GBP manager access (a separate Bucket-C, human-assisted step) — never fold auto-posting into this skill.
- **No privileged data.** Business context is user-supplied; optional competitor analysis uses only publicly visible posts.
- **Truthful, brand-voiced copy.** Never invent a completed job, before/after, offer, or price. Use `{{placeholders}}` the client fills with real details, and the `humanizer` skill or your brand voice guide to keep it human.
- **Feeds, does not replace, your lead-gen pipeline** (e.g. the `small-business-preview-engine` skill). That pipeline owns the outbound product; this is a copy deliverable for the SEO/Growth upsell plus a case note.

## Required inputs

- Business: name, primary + secondary services, brand voice/tone.
- Service-area neighborhoods / cities to feature (rotate across them).
- 3–5 target keywords / service phrases.
- Optional: seasonal offers/promotions and any real recent projects; `gbp_audit` from `google-business-profile-public-audit`; up to 3 competitor GBP URLs for a public posting teardown.

## Procedure

1. **(Optional) Competitor posting teardown — public data only.** For each competitor GBP, note cadence (posts/90d), post types used (offer / update / event / product), image use, CTA buttons, topics, and any gaps in their schedule you can exploit by posting when they don't.
2. **Build the 8-week calendar**, 2–3 posts/week, mixing these themes and rotating neighborhoods:
   - seasonal service promotions, before/after showcases, neighborhood-specific updates, review highlights, team spotlights, and educational "common problem we solve" posts.
3. **Write full copy for weeks 1–4** and **outlines for weeks 5–8**. Each full post:
   - 100–150 words (hard cap ~1,500 characters — GBP's limit).
   - naturally includes **one** target keyword (no stuffing).
   - features one real service-area neighborhood where relevant.
   - has exactly one CTA mapped to a GBP button: `Book`, `Order online`, `Buy`, `Learn more`, `Sign up`, or `Call now`.
   - includes an image **shot suggestion / prompt** so the client knows exactly what photo to attach.
   - uses `{{project_detail}}`, `{{neighborhood}}`, `{{offer}}`, `{{photo}}` placeholders for anything the client must make true.
4. **Truthfulness pass.** No fabricated projects, before/afters, offers, prices, or awards. Neighborhood claims must be genuine service areas. If a real detail isn't available, leave a placeholder — don't invent one.

## Output contract (`gbp_post_calendar`)

```json
{
  "business": { "name": "", "voice": "" },
  "cadence": "2-3 posts/week over 8 weeks",
  "placeholders": ["{{project_detail}}", "{{neighborhood}}", "{{offer}}", "{{photo}}"],
  "weeks": [
    {
      "week": 1,
      "posts": [
        {
          "type": "offer | update | event | product",
          "theme": "seasonal | before_after | neighborhood | review_highlight | team | educational",
          "copy": "",
          "outline": null,
          "keyword": "",
          "neighborhood": null,
          "cta_button": "Book | Order online | Buy | Learn more | Sign up | Call now",
          "image_prompt": ""
        }
      ]
    }
  ],
  "provenance": { "competitor_analysis": "none | public_posts", "generated_by": "", "caveats": [] }
}
```

Weeks 1–4 populate `copy`; weeks 5–8 populate `outline` and may leave `copy` null.

## How it feeds the product

- **Client deliverable:** hand `gbp_post_calendar` to the client to publish on cadence, or (only with granted GBP manager access) a human/agent publishes — that publishing step is outside this skill.
- **Composition:** consume the posting-cadence finding from `google-business-profile-public-audit` as the trigger; pair with `local-review-response-templates` as a combined "GBP activation" deliverable.
- **Case note:** save the delivered calendar as a case note in your lead-gen pipeline's case library (e.g. `Cases/<vertical>/<business>.md` in your workspace), with provenance and caveats.

## Constraints & compliance

- Never publish posts from this skill.
- Never fabricate projects, before/afters, offers, prices, or credentials.
- Keep each post within GBP's ~1,500-character limit and to a single CTA button.
- Truthful, brand-voiced copy; run the `humanizer` skill to strip AI-isms.

## Common pitfalls

- Bursting 20 posts in one day then going silent reads as inactive — consistency (2–3/week) beats volume.
- Generic posts with no neighborhood or keyword do nothing for local relevance.
- Fabricated before/after or "just completed" posts are dishonest and risky — use placeholders.
- Ignoring the ~7-day expiry: the value is in sustained cadence, not a one-time dump.
- Keyword-stuffing reads robotic — one keyword per post, naturally.
- Treating this as a GBP write skill — it produces copy; publishing is a separate, access-gated step.

## Verification checklist

- [ ] 8 weeks planned, 2–3 posts/week, themes and neighborhoods rotated.
- [ ] Weeks 1–4 have full copy (100–150 words, ≤1,500 chars); weeks 5–8 have outlines.
- [ ] Each full post has one **true**-able keyword, one CTA button, and an image shot suggestion.
- [ ] Neighborhoods referenced are genuine service areas; no fabricated projects/offers/prices.
- [ ] Ran voice/humanizer pass where tone matters.
- [ ] Delivered as `gbp_post_calendar` + a case note; nothing was auto-published.

## Roadmap (the larger local-SEO capability)

Part of a three-bucket split kept deliberately separate:
- **Bucket A — read-only public audits** (`google-business-profile-public-audit`; also NAP/citations, search-intent map, competitor GBP posting patterns). Autonomous-safe; feeds internal targeting.
- **Bucket B — pure copy generation** (this skill; `local-review-response-templates`; also service/city page copy, review-sentiment→copy, content-gap outlines). Autonomous-safe; client-facing deliverables the client applies.
- **Bucket C — writes & paid-tool data** (publishing these posts to GBP, GBP edits, Ahrefs/SEMrush, Search Console for sites you control). Requires per-client granted access, paid API seats, and recurring billing — human-assisted, **not** zero-human. Do not fold Bucket-C behavior into Bucket A/B skills.
