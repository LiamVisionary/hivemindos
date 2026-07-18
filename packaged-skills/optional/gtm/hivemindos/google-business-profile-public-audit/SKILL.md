---
name: google-business-profile-public-audit
description: Audit a local business's PUBLIC Google Business Profile against its top 3 map-pack competitors (categories, attributes, review velocity, posts, photos, services, description, NAP) using public data only, and emit a structured weak-signal report that sharpens your lead-gen pipeline's lead diagnosis and truthful cold-message personalization. Use for "GBP audit", "local SEO gap check", "map-pack visibility", "competitor GBP teardown", or enriching outbound lead scoring. Read-only — never edits any GBP.
---

# Google Business Profile — Public Audit (read-only)

Produce a structured, machine-checkable audit of a local business's **public** Google Business Profile (GBP) and its top map-pack competitors, then hand the result to your lead-gen pipeline's **diagnosis** step so lead scoring and cold-message personalization stop relying on the weak "no-website / OSM" signal alone.

This skill is the first slice of a larger local-SEO capability. It is deliberately **Bucket A: read-only, public-data audits**. See "Scope boundary" for what this skill must NOT do.

## Why this exists

A typical outbound lead-gen pipeline (e.g. the `small-business-preview-engine` skill) writes a *diagnosis, hero angle, tone, sharpness score, and personalized cold message* per lead. Weak-web signals (no website, social-only, stale Facebook, OSM presence) are unreliable for outbound by themselves. A public GBP audit adds far stronger, specific, truthful signals — missing categories, missing attributes, dead review velocity, no GBP posts, stale photos, thin services, NAP drift — that both **rank the lead** and **give the cold message something real and specific to say**.

## Scope boundary (read this before running)

- **Read-only.** This skill AUDITS public listings. It never changes a client's GBP. Every GBP *write* operation (editing categories/attributes, uploading photos, publishing posts, responding to reviews, rewriting the description) requires verified owner/manager access to that specific profile, which a zero-human pipeline cannot self-grant. Those are a separate, human-in-the-loop "Bucket C" capability — do not add them here.
- **Public data only.** No logged-in Ahrefs / SEMrush / Search Console sessions, and no automating those dashboards (their ToS forbids it; use official API seats if you hold them). This skill uses only publicly visible GBP/Maps data plus the Google Places API for identity.
- **Feeds, does not replace, your lead-gen pipeline** (e.g. the `small-business-preview-engine` skill). That pipeline owns candidate sourcing, preview generation, email ordering, compliance, and send QA. This skill produces one input to its diagnosis step and a case note. When both could apply, run this to enrich diagnosis, then continue in the pipeline.
- **This is procedural knowledge, not a code hook.** Unless your pipeline exposes one, there is no code-level "weak-site scorer" to call. Integration happens by (a) producing the `gbp_audit` artifact below, (b) contributing its rollup to your pipeline's lead-sharpness score, and (c) writing a case note. Do not claim a code wiring that does not exist.

## Required inputs

- Target business: name, city/market, and GBP/Maps URL or Google `place_id` if known.
- 1–3 target keywords (e.g. `"<service> in <city>"`) to identify the map-pack competitors, OR an explicit competitor list (names + public GBP URLs).
- Presence-only credential check for Places identity: verify one of `GOOGLE_CLOUD_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_API_KEY` exists (never print the value). Prefer `GOOGLE_CLOUD_API_KEY` if multiple are set.

If the Places API is unavailable (403 / billing / quota — a common blocker), do NOT substitute OSM/Overpass or generic Maps search URLs for identity. Fall back to reading the public listing via browser inspection, and mark `provenance.data_source: "public_listing_browser"` and `provenance.places_api_available: false` with a caveat. Never fabricate a field you could not read.

## Audit procedure

1. **Identify the map pack.** For each keyword, determine the businesses ranking in the local map pack for `"<service> in <city>"`. Record the target's own position (or "not ranking"). If the caller supplied competitors, use those and skip discovery.
2. **Capture each public listing** (target + up to 3 competitors), extracting only what is publicly visible:
   - **Categories** — primary + all secondary.
   - **Attributes** — every visible tag (e.g. "veteran-owned", "free estimates", "online appointments", "24/7", "wheelchair accessible").
   - **Reviews** — total count, average rating, and new-review counts in the last 30 / 60 / 90 days (review *velocity*, not just the total).
   - **GBP posts** — count in the last 90 days and rough cadence (none / sparse / active).
   - **Photos** — total count and how many added in the last ~90 days.
   - **Services section** — services listed and whether they carry descriptions.
   - **Description** — presence and rough character count.
   - **NAP** — name / address / phone exactly as shown (seed for a later citation-consistency audit).
3. **Diff target vs competitors** and classify each gap:
   - Missing on the target but present on **all 3** competitors → *table stakes* (non-negotiable).
   - Present on **2 of 3** → strong recommendation.
   - Present on **only 1** → differentiation opportunity.
4. **Compute the weak-signal rollup** (see contract) and **derive 2–4 personalization hooks**: truthful, specific, one line each, safe to paraphrase into a cold message ("your top 3 competitors all list 'water damage restoration' as a category and you don't — that's why you're invisible for those searches"). Hooks must be TRUE for this business; never assert "no website" for a business that has one, and never invent a gap.

## Output contract (`gbp_audit`)

Emit one JSON object. Leave any field you could not read as `null` and add a caveat rather than guessing.

```json
{
  "target": {
    "name": "", "gbp_url": "", "place_id": null, "city": "",
    "map_pack_position": null, "primary_category": "", "secondary_categories": [],
    "rating": null, "review_count": null
  },
  "competitors": [
    { "name": "", "gbp_url": "", "map_pack_position": null,
      "primary_category": "", "secondary_categories": [], "rating": null, "review_count": null }
  ],
  "signals": {
    "categories": {
      "missing_vs_all3": [], "missing_vs_2of3": [], "differentiation_only_1": []
    },
    "attributes": {
      "target": [], "missing_vs_all3": [], "missing_vs_2of3": []
    },
    "review_velocity": {
      "target_last_30_60_90": [null, null, null],
      "top_competitor_last_30_60_90": [null, null, null],
      "reviews_per_month_gap": null,
      "months_to_catch_top": null
    },
    "gbp_posts": { "target_posts_90d": null, "competitor_avg_posts_90d": null, "target_posting": "none|sparse|active" },
    "photos": { "target_total": null, "target_added_90d": null, "top_competitor_added_90d": null },
    "services_section": { "target_has_descriptions": null, "target_service_count": null, "competitor_avg_service_count": null },
    "nap_consistency_seed": { "name": "", "address": "", "phone": "", "listings_checked": ["google-gbp"] }
  },
  "weak_signal_rollup": {
    "score_0_100": null,
    "table_stakes_missing": [],
    "quick_wins": [],
    "top_gaps": []
  },
  "personalization_hooks": [],
  "provenance": {
    "data_source": "google_places_api | public_listing_browser",
    "places_api_available": true,
    "captured_by": "",
    "caveats": []
  }
}
```

**Scoring guidance (`score_0_100`, higher = weaker profile = stronger outbound target):** weight table-stakes category/attribute gaps and dead review velocity most heavily; treat "no GBP posts in 90d" and "no photos added in 90d" as reliable, common quick-win signals; do not let a single missing attribute dominate. State the weighting you used in `provenance.caveats` so the score is reproducible, not a black box.

## How it feeds your lead-gen pipeline

- **Lead ranking:** blend `weak_signal_rollup.score_0_100` into your pipeline's lead-sharpness score — a high GBP-gap score raises priority even when the website signal is ambiguous.
- **Cold message:** pass `personalization_hooks` into the cold-message step so the opener names a specific, verifiable gap. Keep copy truthful (your outbound skill's truthfulness rules — e.g. `small-business-preview-engine`'s — apply verbatim).
- **Citation follow-up:** `nap_consistency_seed` is the starting point for a future NAP/citation-consistency audit across directories.
- **Case note:** write the audit as a case note in your lead-gen pipeline's case library (e.g. `Cases/<vertical>/<business>.md` in your workspace), including the score, top gaps, hooks, and provenance/caveats — so agents do not re-audit the same business inside the dedup window.

## Constraints & compliance

- Read-only; public data only; no GBP writes; no logged-in third-party SEO tools.
- No unattended bulk scraping. Audit the handful of listings for a real lead, agent/human-initiated, inside Google Places API quotas. If you use a third-party scraper for discovery, honor its security audit's limits — no broad unattended, scheduled, or multi-machine scraping.
- Presence-check credentials only; never print or store secret values.
- Every personalization hook must be independently true for the audited business.
- If Places identity can't be verified, degrade to browser-read public data with an explicit caveat; never fabricate a field or spoof `google_places` verification.

## Common pitfalls

- **Auditing ≠ editing.** Producing a category gap list is fine; "add these categories" as an *action we take* is a GBP write we cannot perform without granted owner access. Frame write-side findings as recommendations the client applies, or as a Bucket-C human-onboarding step.
- **Star rating is a vanity signal.** Rank on *velocity* (reviews/month over 30/60/90d), not total count — a 200-review profile that got 180 two years ago is weaker than a 90-review profile adding 15/month.
- **A Places 403 (billing/quota) is a real blocker when it hits.** Do not paper over it with OSM/Overpass or generic `/maps/search/?api=1&query=...` links. Report the blocker and mark provenance.
- **Don't overclaim integration.** The `gbp_audit` object and case note are the integration surface; there is no code scorer to call. Say so.
- **Truthfulness beats a punchy hook.** A specific true gap ("no GBP posts since <month>") outperforms an impressive-sounding claim you can't stand behind.

## Verification checklist

- [ ] Target + up to 3 competitors captured from **public** listings only.
- [ ] Every populated field was actually read; unread fields are `null` with a caveat (nothing fabricated).
- [ ] Gaps classified as table-stakes (all 3) / recommended (2 of 3) / differentiation (1 of 3).
- [ ] `weak_signal_rollup.score_0_100` computed with the weighting stated in `provenance.caveats`.
- [ ] `personalization_hooks` are each independently true for this business.
- [ ] Provenance records `data_source`, `places_api_available`, and any Places/quota caveat.
- [ ] Result handed to your lead-gen pipeline's diagnosis step (sharpness + cold message) and a case note written.
- [ ] No GBP write was performed or implied as an action we take.

## Roadmap (the larger local-SEO capability)

This skill is **Bucket A** of a three-bucket split, kept separate on purpose:
- **Bucket A — read-only public audits** (this skill; also: NAP/citation consistency, search-intent map, competitor GBP posting-pattern analysis). Autonomous-safe; feeds internal targeting.
- **Bucket B — pure copy generation** (review-response templates, GBP post drafts, service/city page copy, review-sentiment→copy). Autonomous-safe; produces client-facing deliverables the client applies.
- **Bucket C — writes & paid-tool data** (GBP edits, Ahrefs/SEMrush keyword/backlink data, Search Console for sites you control). Requires per-client granted access, paid API seats, and recurring billing — human-assisted, **not** zero-human. Do not fold Bucket C behavior into Bucket A/B skills.
