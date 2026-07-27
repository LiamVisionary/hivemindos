---
name: tiktok-app-ads-growth-loop
description: "Plan, audit, or optimize an attribution-ready TikTok Ads growth loop for B2C mobile apps: MMP or app-event setup, unit economics, Smart+ versus manual campaign selection, six-creative testing, Spark Ads, funnel diagnosis, and evidence-based kill/hold/scale decisions. Use whenever the user mentions TikTok app-install ads, TikTok app promotion, Smart+ App, mobile-app paid acquisition, TikTok MMP setup, AppsFlyer with TikTok, Spark Ads for an app, TikTok CPA/LTV, or scaling an iOS or Android consumer app with paid TikTok creatives."
---

# TikTok App Ads Growth Loop

Turn a B2C mobile app into a measured TikTok acquisition experiment: prove attribution, define the economic ceiling, choose the campaign mode, launch a controlled creative matrix, and diagnose the full funnel before scaling.

## Core Contract

- Treat this as experiment design and analysis, not a promise of revenue, profit, ROAS, or a repeatable 41-day outcome.
- Do not create or publish campaigns, post videos, authorize Spark Ads, spend money, change bids or budgets, upload private media, or alter comment settings without explicit user approval for that action.
- Verify current TikTok Ads Manager, MMP, store, and analytics instructions from official documentation before giving click-by-click steps. Labels, eligibility, placements, bidding, and learning guidance change frequently.
- Do not optimize paid acquisition until install and meaningful in-app events are reaching TikTok through a verified attribution path. An MMP such as AppsFlyer, Adjust, Airbridge, Branch, Kochava, Singular, or Tenjin is usually the best cross-channel path; use TikTok's App Events SDK/API only when current availability and implementation are verified.
- Never fabricate engagement, testimonials, customer identities, comments, ratings, results, or before/after evidence. Do not operate alt accounts to praise the app or coordinate fake comment seeding.
- Moderate abuse, spam, threats, doxxing, and irrelevant bot comments. Do not hide legitimate criticism or indiscriminately block terms such as `AI`, `scam`, or `money` merely to suppress material disclosures or customer concerns.
- Label materially AI-generated or significantly edited ads when required. Use a person's face, voice, testimonial, or creator post only with documented permission; do not face-swap a real person without consent.
- Keep claims, price, trial terms, subscription terms, screenshots, and the app-store experience consistent. Treat body-image transformations, health claims, financial claims, and dramatic before/after ads as high-risk and verify category-specific policy before use.
- Treat supplied anecdotes as hypotheses, not defaults. Figures such as `$50/day`, `$100 in two days`, `$20 CPA`, `$500-$1,000 of expected learning loss`, `40% margin`, or creative replacement every `3-7 days` must be recalculated for the app.

## Inputs

Ask only for missing essentials:

- App name, store URLs, OS, category, target customer, target countries, and the app's clearest paid outcome.
- Monetization model, price, trial terms, store fee, refunds, variable costs, renewal/retention data, and desired payback window.
- Current funnel counts by source: impressions, clicks, store visits, installs, onboarding completions, activations, trials, purchases/subscriptions, renewals, refunds, and revenue.
- Attribution stack and status: MMP or direct app-event path, TikTok Events Manager, subscription system, product analytics, and store analytics.
- Available ad account, business/creator account, authorized creator posts, existing ads, brand assets, customer permissions, and AI-generation preferences.
- Hard budget cap, maximum acceptable CPA, approval policy, restricted markets, and any regulated-category constraints.

If the user supplies screenshots or exports, read those before asking them to retype values. Never request secret values; refer to credentials by key name and set/missing status only.

## 1. Establish Readiness And Unit Economics

Score each item from 0-2:

| Item | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Product promise | Vague or novelty-only | Clear use case | Clear outcome with truthful proof |
| Store page | Weak or inconsistent | Functional | Message-matched, credible, fast |
| Onboarding | Unmeasured or leaky | Partly measured | Short, instrumented, healthy |
| Paywall/purchase | Confusing or unmeasured | Functional | Clear terms and measured conversion |
| Attribution | Missing | Events appear on one side | Test install and revenue event verified end to end |
| Economics | Unknown | Price known | Conservative contribution LTV and payback known |
| Creative supply | Fewer than 3 usable ads | 3-5 concepts | 6+ rights-cleared variants and refill plan |

Below 10/14, recommend fixing readiness before meaningful scale. Never assume paid traffic will repair weak onboarding, unclear subscription terms, or missing product value.

Calculate the ceiling from contribution economics, not top-line revenue:

```text
net revenue = gross revenue - store fees - refunds - taxes collected by the app - variable delivery costs
contribution LTV = net revenue over a stated cohort window
target CPA = contribution LTV / required LTV:CAC ratio
payback = cumulative cohort contribution / acquisition spend over time
```

Use a conservative observed cohort when available. If retention is immature, show low/base/high cases and label target CPA as inferred. `CPA < LTV` is necessary but not sufficient when cash payback is slow, refunds are high, or the LTV estimate is speculative.

## 2. Prove Attribution Before Buying Traffic

1. Select the measurement route. Prefer a discovered MMP for cross-network attribution; AppsFlyer is one option, not a required vendor or affiliation.
2. Instrument the smallest useful funnel: install/first open, registration, onboarding complete, meaningful activation, trial start, purchase or subscribe, revenue and currency, renewal, cancellation, and refund where supported.
3. Map app events to TikTok's current standard optimization events. Custom events can aid reporting but may not be eligible optimization events.
4. Connect the app in TikTok Events Manager and complete the MMP or direct-integration steps from current official docs.
5. Run a test-device install and test conversion. Confirm the MMP/app analytics receives it, the event is mapped, TikTok records it, revenue/currency are correct, and no duplicate SDK/server events appear.
6. Record attribution windows, time zones, OS privacy path, lookback logic, and reporting grain. Compare equivalent dates, time zones, attribution models, and TikTok-attributed traffic when reconciling dashboards.
7. Save a pre-launch evidence table:

| Event | App fires | Measurement layer receives | TikTok records | Revenue/currency | Verified at |
| --- | --- | --- | --- | --- | --- |

If purchase/subscription events are not verified, do not claim purchase-optimized delivery or trustworthy CPA. A traffic-only app connection can report store traffic without proving downstream conversion.

## 3. Choose Smart+ Or Manual Deliberately

Verify the current account UI, then use this branch:

### Smart+ App

Choose Smart+ when automated exploration is acceptable and the app has enough budget, conversion history, and creative volume to support learning.

- Start with one clean campaign and one ad group when one OS, geography, optimization event, and offer are being tested. Split only when a material variable must be isolated.
- Current setup begins from `App promotion` and an app-install/app-promotion goal, but confirm the exact labels shown to the user.
- Keep iOS and Android separate when their attribution, bidding, event availability, or economics differ.
- Use 4-6 or more creative assets at launch; this skill defaults to six.
- Do not promise TikTok-only delivery in Smart+. Current official guidance says manual placement selection is unavailable for Smart+ App: iOS can include TikTok and Lemon8 where available, while Android automatic placement can also include Pangle. If TikTok-only placement is a hard requirement, evaluate a current manual campaign instead.
- Do not mix Spark and non-Spark creatives in one Smart+ App campaign when the current product disallows it.
- Treat seven days and up to roughly 50 conversion events as TikTok's current learning guidance, not a guarantee. Avoid repeated edits during learning.

### Manual App Campaign

Choose a manual campaign when the user needs strict placement control, fixed creative-to-copy pairing, a cleaner single-variable test, or account features unavailable in Smart+.

- Verify that the required objective, optimization event, placements, targeting, bidding, and identity options are available in the current account.
- Select TikTok-only placement only when the UI actually supports it. Do not claim that disabling Lemon8/Pangle is possible in Smart+.
- Use one campaign and one ad group as a controlled starting point, not a universal law.

### Shared Settings

- Use US-only targeting only when the user approves it and US economics, store page, support, language, rating, and policy eligibility are ready. Otherwise select markets from evidence.
- Choose purchase or subscription optimization when enough verified signal exists. With sparse volume, start at the deepest event likely to produce learnable volume, then migrate deeper after evidence accumulates.
- Decide whether the App Profile Page improves message match; do not dismiss it as irrelevant without testing the click destination and store experience.
- Derive budget from target CPA, learning needs, and the hard loss cap. A fixed `$50` is not inherently sufficient. Check TikTok's current bid-to-budget guidance and show the user the maximum planned test loss before launch.

## 4. Build A Six-Creative Test Matrix

Create at least three distinct concepts with one controlled variation each:

| Creative | Concept | Hook | Proof/demo | CTA | Changed variable |
| --- | --- | --- | --- | --- | --- |
| A1 | Story + product transformation | Baseline hook | Real app use/result | Baseline CTA | Baseline |
| A2 | Story + product transformation | Variant hook | Same proof | Same CTA | Hook only |
| B1 | Problem → demo → outcome | Baseline | Screen recording or acted use case | Baseline CTA | New concept |
| B2 | Problem → demo → outcome | Same | Same proof | Stronger truthful CTA | CTA only |
| C1 | Before/after workflow | Baseline | Old workflow vs app workflow | Baseline CTA | New concept |
| C2 | Before/after workflow | Variant framing | Same workflow proof | Same CTA | Framing only |

`Before/after workflow` means a truthful change in process, time, organization, or output—not a misleading body, health, wealth, or identity transformation.

Creative rules:

- Mine current public TikTok ads, Creative Center results, the user's feed, and rights-cleared creator work for patterns. Reuse structural lessons—hook rhythm, shot order, proof type, CTA position—not exact scripts, footage, likeness, branding, or claims.
- Make the app's use case visible. Viral curiosity without product intent can raise CTR while producing poor installs or purchases.
- Use discovered AI/video capabilities or a paid creator/college student based on consent, cost, quality, and user preference. Never assume a named generator is installed.
- When using AI motion, face replacement, voice cloning, or synthetic people, secure rights, preserve truthful representation, and use TikTok's current AI disclosure control when required.
- Plan a refill batch before launch. Add new creatives when fatigue evidence appears; do not replace winners on an arbitrary clock.
- If installed, use `ai-ugc-production-pipeline` for production, `video-shot-transcript` for shot-level analysis, and a discovered media generator for assets. Keep the campaign brief canonical across those skills.

## 5. Prepare Spark Ads And Launch

Use a real brand-owned account or an authorized creator post—not a disposable account created to simulate legitimacy.

For Spark Ads:

1. Finalize the caption before authorization; authorized post captions may not be editable.
2. Confirm the account/post owner has granted advertising permission and the authorization period covers the test.
3. Generate or retrieve the post authorization code through the current TikTok post Ad settings, or use a linked/Business Center-authorized identity.
4. Confirm whether a private post will become public when promoted.
5. Add the authorized post in the correct Spark Ads flow for Smart+ or manual campaigns.

Before publishing, show the user one approval card containing:

- Account, app, OS, countries, objective, optimization event, campaign mode, placements, identity, and destination.
- Daily/lifetime budget, bid strategy, start/end dates, maximum test loss, and who may change spend.
- Six creative thumbnails/titles, captions, CTAs, permissions, AI disclosures, and policy review status.
- Verified attribution events and timestamped evidence.
- Kill, hold, scale, and delayed-conversion rules.

Publish only after explicit approval. Capture the platform receipt, campaign/ad-group/ad identifiers, final settings, and timestamp before reporting that the campaign is live.

## 6. Run Authentic Comment Operations

Do not comment-seed with fake users. Replace that tactic with authentic conversion support:

- Reply from the disclosed brand/creator identity with concise answers about price, trial terms, privacy, AI use, and the app's actual limits.
- Pin a factual FAQ or clarification when the format supports it.
- Invite real customers or contracted creators to share their honest experience, with required commercial disclosure and no scripted false praise.
- Use Comments Manager to hide/report abuse, spam, impersonation, threats, personal data, and irrelevant automation. Preserve good-faith negative feedback and answer it.
- Feed recurring objections into the next creative and onboarding batch. Comment sentiment is diagnostic evidence, not merely a number to suppress.

## 7. Review, Diagnose, And Repeat

Use complete days and account for delayed postbacks. Separate an early health check from a final decision:

- Manual test: inspect delivery and tracking after two complete days, but do not declare a winner solely because 48 hours elapsed.
- Smart+ test: respect the current learning guidance—presently at least seven days/up to about 50 conversions—unless a hard safety, policy, tracking, or loss-cap trigger requires pausing sooner.
- Candidate kill rule: verified attribution, the relevant conversion delay elapsed, spend above `2 × target CPA`, and zero conversions. Apply at the correct creative/ad/ad-group grain and consider whether the platform has actually delivered enough impressions.
- Scale only when CPA is below a conservative contribution-LTV ceiling, conversion quality and retention are acceptable, attribution is clean, and sample size is adequate. Increase budget gradually—often 10-20% at a time—then observe before changing again. Every increase needs approval unless the user explicitly authorized a bounded automation rule.
- For Smart+, keep existing creatives and add 2-5 new assets when fatigue appears; avoid deleting winners during corrective iterations.

Primary metrics: conversions, contribution CPA, conversion volume, cohort payback, ROAS, refunds, and retention. Secondary diagnostics: impressions, thumb-stop/hold rate, CTR, CPC, store-view-to-install rate, activation, onboarding completion, trial rate, and purchase rate.

| Evidence pattern | Likely bottleneck | Next test |
| --- | --- | --- |
| Low delivery | Eligibility, bid/budget, audience, placement, or learning constraint | Check diagnostics before blaming creative |
| Adequate impressions + low CTR | Hook, audience-message fit, or weak first seconds | Test a new concept/hook |
| Strong CTR + weak store installs | Low-intent curiosity, destination mismatch, store page, rating, or load issue | Align ad promise and store page |
| Installs + weak activation | Onboarding, permissions, performance, or promise mismatch | Fix and instrument activation |
| Activation + weak trial/purchase | Value demonstration, paywall, price, trust, or terms | Test funnel/offer, not just ads |
| Purchases + poor renewal/refund quality | Product value or expectation mismatch | Stop scaling and improve retention |

Do not treat `CTR ≈ 1%` as a universal pass/fail threshold. Compare against the app's own creatives, market, placement, optimization mode, and downstream CPA.

## Capability Discovery

Before executing a campaign task, use `hive-capability-search` for the required intents:

- Current TikTok/MMP research and official documentation.
- Creative research, shot analysis, AI/media generation, and render QA.
- Analytics/export analysis and subscription or product-event data.
- Publishing or browser operation when the user explicitly requests it.

Choose capability intents rather than hard-coded providers. Record credentials by key name/status only, paid-generation or ad-spend side effects, approval gates, and delivery receipts.

## Required Output

Return a compact campaign operating brief:

1. Verified current controls and dated source links.
2. Assumptions, missing evidence, and readiness score.
3. Attribution/event map and test evidence.
4. Unit economics, target CPA range, payback window, and hard loss cap.
5. Smart+ versus manual decision with placement consequences.
6. Six-row creative matrix and refill plan.
7. Launch approval card.
8. Day-2 health check, day-7 review, and delayed-postback caveats.
9. Kill/hold/fix/scale decisions with calculations.
10. Policy, consent, disclosure, privacy, and remaining setup gaps.

## Official References

Recheck these before operational instructions:

- [TikTok: Smart+ App Campaigns](https://ads.tiktok.com/help/article/about-smart-plus-app-campaigns?lang=en)
- [TikTok: Smart+ App best practices](https://ads.tiktok.com/help/article/best-practices-for-smart-plus-app-campaigns?lang=en)
- [TikTok: Set up app attribution](https://ads.tiktok.com/help/article/set-up-app-attribution-tiktok-ads-manager)
- [TikTok: Attribution and MMP reporting differences](https://ads.tiktok.com/help/article/commonly-asked-questions-in-app-events?lang=en)
- [TikTok: Spark Ads creation](https://ads.tiktok.com/help/article/spark-ads-creation-guide?lang=en)
- [TikTok: Misleading, false, edited, and AI-generated ad content](https://ads.tiktok.com/help/article/tiktok-ads-policy-misleading-and-false-content?lang=en)
- [TikTok: Comment management](https://ads.tiktok.com/help/article/how-to-view-and-manage-comments-in-tiktok-ads-manager?lang=en)
- [AppsFlyer: TikTok for Business Advanced SRN](https://support.appsflyer.com/hc/en-us/articles/7925111265041-Bulletin-TikTok-for-Business-advanced-SRN)

Current-product facts in this draft were checked on 2026-07-13. Treat that date as a freshness marker, not permanent truth.
