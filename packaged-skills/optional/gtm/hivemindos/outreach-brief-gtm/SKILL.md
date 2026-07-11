---
name: outreach-brief-gtm
description: Run the persistent-brief B2B outreach pattern — build one canonical outreach brief from real deal evidence (company positioning, value props, offer, ICP, persona, competitors, market size, buyer pains), load it into every session automatically, and run all copywriting (first-touch under 75 words, follow-ups, LinkedIn DMs, cold-call scripts), pipeline health reviews, reply-rate audits, and weekly strategy against that brief instead of re-explaining context. Use for "outreach brief", "onboard my company context", "cold call script", "pipeline analysis", "reply rate audit", or keeping outbound artefacts consistent across sessions.
---

# Persistent-Brief B2B Outreach

The problem: B2B outbound re-explains the same company every session — ICP, persona, value props, competitors — and the artefacts drift out of sync. The pattern: build **one canonical brief** from real deal evidence, load it automatically at session start, and make every copywriting and analysis step read it instead of asking again. It is not orchestration magic; it is a file the session loads — simple and reliable. Update the brief once and everything downstream uses the new version.

**Hard rules:** the brief holds honest competitive weaknesses, pricing, and deal history — it is private context, never published and never quoted in outbound copy. Metric thresholds below are rules of thumb, not measured guarantees. Sends and any automation that enrolls prospects stay human-approved. Evidence in, aspiration out: every brief section is built from won/lost-deal data and real buyer language, not from what the company wishes were true.

## Step 1 — Onboard: build the brief's 8 sections from evidence

Interview the user section by section; each answer set becomes a brief section:

1. **Company** — what they actually sell, the honest case for buying, where positioning is generic, and what a sceptical buyer challenges first.
2. **Value props** — ranked by frequency in won deals (not the marketing page), split rational vs emotional, mapped to the persona each resonates with, each with the phrase a customer would actually use.
3. **Offer** — one-sentence offer, a specific outcome promise, the proof that makes it believable, a risk reversal, and a low-friction CTA. An offer is not a product.
4. **ICP** — firmographic/technographic/behavioural criteria plus disqualifiers, derived from won, lost, and churned deals, ending in the one qualifying question that filters in 60 seconds.
5. **Persona** — the individual, not the company: title range, top pressures, the buyer's own problem language, what they distrust in cold outreach, and the tone to use.
6. **Competitors** — per competitor: their self-positioning, where each side is genuinely stronger, the landmine discovery question, and the response when a prospect prefers them.
7. **Market size** — TAM/SAM/SOM with methodology, sources, key assumptions, and the assumption most likely to be wrong.
8. **Pains** — the 5 pains most frequent in won deals, each in the buyer's words, what they tried before, and the question that makes a prospect feel understood; ranked by urgency × frequency × ability to relieve.

Persist the brief where every session reads it (in HivemindOS, a shared-brain note recalled by the memory hook serves the same role as a per-repo brief file). Review and correct it by hand after generation — the user's corrections are the most valuable content in it.

## Step 2 — Copywriting against the brief

- **First-touch email:** opener references a specific buying signal; body under 75 words with one pain and one outcome, no feature list; one low-friction CTA that is not "book a call"; subject under 7 words. **Quality gate: if the email could have been sent to any company, rewrite it.**
- **Follow-ups (touches 2–5):** each a completely different angle, standing alone as if earlier touches never existed; never "following up" or "circling back"; last touch is the break-up; all under 75 words.
- **LinkedIn:** connection request under 200 characters referencing something specific, no pitch; first DM under 150 characters that adds value or opens conversation; a second DM after five silent days takes a new angle, not a follow-up. Draft two variants of each and mark one to send.
- **Cold-call script, five parts:** a one-sentence specific reason for calling → a thirty-second permission ask → one pain question that opens without pitching → a two-sentence value bridge → a specific next-step ask (never "can I send you some info"), plus the three likeliest objections with exact responses.

## Step 3 — Analysis against the brief

- **Pipeline health:** flag deals with no activity in 7+ days, no dated next step, or a passed close date; root-cause each (ICP fit, wrong stakeholder, no pain, price, timing, competitor); return the top 5 deals to work this week with exact next actions, the top 3 to drop, and the one systemic problem the operator probably isn't seeing.
- **Reply-rate audit:** triage against rule-of-thumb thresholds — opens 40%+, replies 3%+ (below 3% triggers a rewrite of the worst touch), meetings 1%+ — diagnose the root cause per underperforming touch (subject, hook, offer, or ICP fit), rewrite the worst performer, and recommend one A/B test.
- **Weekly strategist review:** assess the outbound motion honestly, name the three highest-leverage changes, sequence them, and define what good looks like in 30 days.

## The first week

Day 1: onboard and hand-correct the brief. Day 2: first-touch plus follow-ups for the top ten accounts, loaded into the sequencer. Day 3: LinkedIn DMs for the same accounts plus the cold-call script. Day 7: reply-rate audit and pipeline review, folding the week's lessons back into the brief. Ongoing: the weekly strategist review.

Reusable rows — the 8 brief sections with their evidence sources, copy-constraint rows, the cold-call spine, pipeline flags, metric triage, and the first-week ramp — live in this repository's `workflows/gtm/outreach-brief/templates.json` bank. For deliverability, domain warming, and the pre-send QA gate, pair with the `cold-email-gtm` skill; for LinkedIn caps and warming, pair with `linkedin-gtm`.
