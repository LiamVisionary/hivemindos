---
name: local-review-response-templates
description: Generate a reusable review-response TEMPLATE SYSTEM for a local business (Google Business Profile / Yelp) — 3 human, non-robotic variations each for 5-star, 4-star, 3-star, and 1-2-star reviews, with truthful service + neighborhood keyword injection and safe negative-review handling. Pure copy generation, no privileged data, no auto-posting. Use for "review response templates", "reply to Google reviews", "review reply system", "handle negative reviews", or as the Bucket-B deliverable that fixes a low review-response signal found by google-business-profile-public-audit.
---

# Local Review-Response Templates (copy deliverable)

Produce a reusable **review-response template system** a local business can use to reply to every new review in under a minute — turning owner responses into keyword-rich, location-tagged GBP content and trust signals, while handling negative reviews without getting defensive.

This is the first **Bucket B: pure copy generation** slice. It needs no logged-in tools, no API keys, and no GBP ownership. It produces an artifact the client applies (or, only with separately-granted GBP manager access, a human/agent applies).

## Why this exists

Google has stated that responding to reviews supports local ranking, and owner responses are visible, keyword-eligible, trust-building real estate. Most local businesses either don't respond or paste one generic "Thanks for your review!" on everything — wasting the signal. A template system with real variations lets the client respond consistently and fast, and every 5-star reply that naturally names the service and neighborhood adds durable content to the profile.

This skill **composes with** `google-business-profile-public-audit`: that Bucket-A skill measures review velocity and whether the owner responds; a "no responses / thin responses" finding is the trigger to run this skill and deliver the fix.

## Scope boundary (read before running)

- **Copy generation only.** This skill writes templates. It does **not** post replies to any GBP or Yelp listing. Posting requires the client to paste them, or verified GBP manager access (a separate Bucket-C, human-assisted step) — never fold auto-posting into this skill.
- **No privileged data.** Business context is user-supplied; optional competitor analysis uses only publicly visible owner responses. No Ahrefs/SEMrush/GSC.
- **Truthful, brand-voiced copy.** Every template must be true for this business, in its real voice. Use your brand voice guide and the `humanizer` skill to keep replies human and free of AI slop.
- **Feeds, does not replace, your lead-gen pipeline** (e.g. the `small-business-preview-engine` skill). That pipeline owns the outbound product and send QA; this produces a copy deliverable for the SEO/Growth upsell and a case note.

## Required inputs

- Business: name, primary + secondary services, brand voice/tone (warm / professional / casual), owner or business first-name to sign as (optional).
- Service-area neighborhoods / cities to weave into replies (e.g. `Highland Park`, `Sarasota`, `Winter Park`).
- 3–5 target keywords / service phrases the business wants associated with it.
- Optional: `gbp_audit` object from `google-business-profile-public-audit` (for review-velocity context and competitor review themes), and up to 3 competitor GBP URLs to analyze public owner-response strategy.

## Procedure

1. **(Optional) Competitor response teardown — public data only.** For each competitor GBP, note from publicly visible owner responses: response rate, average length, tone, whether responses name services/locations, and how negative reviews are handled. Use this to calibrate — not copy — the target's style.
2. **Generate the template system.** Produce **3 distinct variations** for each tier:
   - **5-star** — warm thanks + naturally names the specific service and one neighborhood/city + soft forward-looking line. This tier carries the keyword/location value.
   - **4-star** — thanks + acknowledges the small gap graciously + invites them back.
   - **3-star** — takes accountability, thanks for honest feedback, offers to make it right, moves specifics to a private channel.
   - **1–2-star** — professional, empathetic, non-defensive; apologizes for the experience, offers a concrete resolution path, provides a direct private contact, never argues facts publicly.
   - Each template **40–80 words**, sounds like a real person, and uses `{{reviewer_first_name}}`, `{{specific_detail}}`, `{{service}}`, `{{neighborhood}}`, `{{contact}}` placeholders so each reply is quickly personalized, not pasted verbatim.
3. **Anti-robotic + truthfulness rules.**
   - The 3 variations per tier must differ in structure and opening, not just swap a word — reviewers and Google both notice identical boilerplate.
   - Keyword/location injection must read naturally and be **true**; never name a service the business doesn't offer or a neighborhood it doesn't serve to chase a keyword.
   - Negative-tier replies: accountability + resolution + move-to-private; never defensive, never disputing the customer's account publicly, never disclosing private customer details.
4. **Safety escalation.** If a review alleges something legal, safety-related, discriminatory, or potentially defamatory, do **not** ship an auto-generated public reply — flag it for human review with a suggested private-first approach.
5. **Add usage rules + insertion-variable guide** so the client can apply the system without you.

## Output contract (`review_response_system`)

```json
{
  "business": { "name": "", "voice": "", "sign_as": null },
  "insertion_variables": ["{{reviewer_first_name}}", "{{specific_detail}}", "{{service}}", "{{neighborhood}}", "{{contact}}"],
  "templates": {
    "five_star":  [{ "text": "", "keywords_used": [], "neighborhood_used": "" }],
    "four_star":  [{ "text": "" }],
    "three_star": [{ "text": "" }],
    "one_two_star": [{ "text": "", "resolution_offered": true }]
  },
  "usage_rules": [],
  "escalation_note": "When to route a review to a human instead of using a template.",
  "provenance": { "competitor_analysis": "none | public_owner_responses", "generated_by": "", "caveats": [] }
}
```

## How it feeds the product

- **Client deliverable:** hand `review_response_system` to the client as the artifact they apply, or (only with granted GBP manager access) a human/agent applies replies — that application step is outside this skill.
- **Composition:** consume the review-velocity / no-response finding from `google-business-profile-public-audit` as the trigger and context; if competitor review themes are available, mirror the true service/location phrases customers actually use.
- **Case note:** save the delivered system as a case note in your lead-gen pipeline's case library (e.g. `Cases/<vertical>/<business>.md` in your workspace), with provenance and any escalation flags.

## Constraints & compliance

- Never post replies from this skill; never impersonate the customer; never disclose private customer information in a public reply.
- Do not offer incentives, discounts, or gifts *in exchange for reviews* — that violates Google's review policies. (Thanking a reviewer and inviting them back is fine; paying for a rating is not.)
- Do not generate fake reviews or review content — only responses to genuine reviews.
- Keep every template truthful and in the business's real voice; run the `humanizer` skill to strip AI-isms.

## Common pitfalls

- A generic "Thanks for your review!" on every reply wastes the entire signal — the point is real, varied, keyword-and-location-aware copy.
- Keyword-stuffing reads robotic and undercuts trust; inject at most one service + one location per 5-star reply, naturally.
- Three "variations" that are the same sentence with one word changed still read as boilerplate — vary the structure.
- Getting defensive or arguing facts on a 1–2-star reply damages trust more than the original review; take accountability and move to private.
- Fabricating a `{{specific_detail}}` to sound personal — leave the placeholder and let the client fill the true detail.
- Treating this as a GBP write skill — it produces copy; applying it is a separate, access-gated step.

## Verification checklist

- [ ] 3 structurally-distinct variations exist for each of the 4 tiers.
- [ ] Each template is 40–80 words and reads as human (ran through the `humanizer` skill / your brand voice guide where voice matters).
- [ ] 5-star templates inject one **true** service + one **true** neighborhood, naturally.
- [ ] Negative-tier templates take accountability, offer a concrete resolution, and move specifics private — never defensive.
- [ ] Escalation note tells the client when to route a review to a human instead.
- [ ] No incentive-for-review language; no fabricated details; no private info in public replies.
- [ ] Delivered as `review_response_system` + a case note; no reply was auto-posted.

## Roadmap (the larger local-SEO capability)

Part of a three-bucket split kept deliberately separate:
- **Bucket A — read-only public audits** (`google-business-profile-public-audit`; also NAP/citations, search-intent map, competitor GBP posting patterns). Autonomous-safe; feeds internal targeting.
- **Bucket B — pure copy generation** (this skill; also GBP post drafts, service/city page copy, review-sentiment→copy, content-gap outlines). Autonomous-safe; client-facing deliverables the client applies.
- **Bucket C — writes & paid-tool data** (posting these replies to GBP, GBP edits, Ahrefs/SEMrush, Search Console for sites you control). Requires per-client granted access, paid API seats, and recurring billing — human-assisted, **not** zero-human. Do not fold Bucket-C behavior into Bucket A/B skills.
