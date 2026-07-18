---
name: apple-ads-revenuecat-growth-loop
description: "Design, audit, or operate an ethical Apple Search Ads + RevenueCat growth loop for iOS subscription apps. Use when the user mentions Apple Ads, Apple Search Ads, ASA, AdServices, RevenueCat attribution, App Store screenshots, competitor keyword campaigns, iOS subscription paywalls, or wants to find profitable country/campaign/keyword pockets from Apple ad spend and RevenueCat exports."
---

# Apple Ads RevenueCat Growth Loop

Use this skill to turn an iOS subscription app into a measured Apple Search Ads experiment: prepare the app page and funnel, set up attribution, run competitor-intent keyword campaigns, export spend and transaction data, then decide what to kill, hold, or scale.

## Core Contract

- Treat this as an experiment design and analysis skill, not a promise of MRR, profit, or ROAS.
- Do not spend money, create campaigns, change bids, change budgets, publish App Store assets, or alter subscriptions without explicit user approval.
- Verify current Apple Ads, App Store Connect, RevenueCat, and analytics UI paths before giving click-by-click instructions. These products change often.
- Use competitor research to understand demand, positioning, price anchoring, screenshot standards, onboarding structure, and keyword intent. Do not copy a competitor's exact product, brand, icons, screenshots, metadata, trade dress, or claims.
- Keep claims accurate. Avoid fake ratings, fake before/after results, deceptive screenshots, hidden subscription terms, or ads that imply affiliation with a competitor.
- Protect customer data. Work from aggregated exports where possible, redact customer identifiers when sharing results, and do not print API keys, tokens, or raw PII.
- If the app is in health, finance, minors, dating, gambling, body-image, medical, or regulated advice categories, flag policy and legal review before recommending aggressive paywalls or ad claims.

## Inputs

Ask only for missing essentials:

- App name, App Store URL, category, target customer, and core human desire it serves.
- Competitor list and why each competitor's users are likely to have intent.
- Current funnel: onboarding steps, paywall screenshots, subscription prices, trial policy, App Store product page assets, rating by country if available.
- Analytics stack: RevenueCat, PostHog or equivalent, App Store Connect, Apple Ads account access, and any existing export files.
- Budget guardrails: max daily spend, max CPT, target payback window, minimum ROAS/LTV:CAC threshold, and countries allowed or forbidden.
- Current numbers: impressions, taps, installs, trials, purchases, refunds, renewal rate, onboarding completion, paywall conversion, country ratings, and known tracking gaps.

## Readiness Check

Before campaign tactics, score the app from 0-2 on each item:

| Item | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Desire | Nice-to-have | Clear pain | Urgent identity, money, health, status, or habit desire |
| Differentiation | Clone/confusing | Similar but improved | Clear, original angle with proof |
| App page | Weak or generic | Acceptable | Strong screenshots, clear promise, credible ratings |
| Onboarding | Unmeasured or leaky | Mostly measured | Short, instrumented, high completion |
| Paywall | Unclear terms | Functional | Clear offer, tested prices, accurate subscription disclosure |
| Attribution | Missing | Partially connected | RevenueCat/Apple Ads/PostHog path verified |
| Data exports | Not ready | One side ready | Spend and transaction exports joinable |

If total score is below 9, recommend fixing readiness before increasing spend. Apple Search Ads users may be warm, but warm traffic still burns budget when the app page, paywall, or attribution is weak.

## Workflow

### 1. Shape The Product And Funnel

Start from a proven desire, not from a competitor to impersonate.

- Define the customer's job-to-be-done in one sentence.
- List 3-5 competitor apps that already educate the market.
- Identify what the user expected when they searched for each competitor.
- Write the app's original counter-positioning: faster, cheaper, more private, more aesthetic, more specific, more local, more expert, more fun, or more complete.
- Benchmark competitor onboarding and paywalls, then design an original flow that borrows the conversion lesson without copying screens or brand identity.
- Instrument onboarding events, paywall views, package selection, purchase attempts, purchase success, cancellation, refund, and meaningful activation.

Source-supplied benchmark targets can be useful starting points:

- Aim for onboarding completion above 80% before scaling.
- Treat paywall conversion above 4% as a useful early signal, but calculate by traffic source and country.
- Pricing patterns such as weekly, monthly, and yearly subscription options should be tested against the category, value delivered, and App Store policy. Do not hide terms.

### 2. Prepare Attribution

The minimum measurement path:

1. Connect RevenueCat to Apple Ads or Apple AdServices attribution.
2. Confirm RevenueCat receives campaign, keyword, country, and customer attribution fields for new installs.
3. Confirm product analytics has onboarding and paywall events tied to an anonymous or customer identifier that can be reconciled.
4. Set up RevenueCat Scheduled Data Exports or equivalent transaction-level exports.
5. Export Apple Ads campaign data with date, country, campaign, ad group, keyword/search term, match type, impressions, taps, installs if available, spend, CPT, and tap-through rate.

If any link is missing, label all ROAS/CAC conclusions as inferred. A common failure mode is optimizing Apple Ads spend while purchases are not tied back to the keyword or country that produced them.

### 3. Build The Campaign Architecture

Use separate campaigns or clean naming so spend can be analyzed by country tier and intent source.

Recommended initial structure:

- Tier 1: United States.
- Tier 2: high-value English or high-LTV markets such as UK, CA, AU, and other countries the user approves.
- Tier 3: lower-cost rest-of-world tests, only where the app page language, product value, reviews, and support make sense.

Within each tier:

- Use one theme per campaign or ad group: competitor brand terms, category intent terms, problem terms, and exact feature terms.
- For competitor-intent experiments, start with exact keywords for competitor names and close variations. In Apple Ads, exact match terms are represented with square brackets in keyword entry/export contexts.
- Keep Search Match or broad discovery separate from competitor-intent tests so Apple's exploration does not blur the signal.
- Use broad audience settings unless the app has a real age, gender, device, or regional constraint.
- Prefer iPhone-only when the app experience is iPhone-first.
- Set Customer Type to New Users for acquisition campaigns unless retargeting is intentional.
- Start with conservative max CPT bids and a budget that produces feedback without risking runaway spend. Increase bids only when the campaign does not spend and the user approves the new cap.
- Keep the default product page at first. Test custom product pages after baseline spend and conversion are understood.

Naming convention:

```text
ASA-[tier]-[country-or-region]-[intent]-[match]-[date]
Example: ASA-T1-US-competitor-exact-2026-06
```

### 4. Guard The Product Page

The product page has to win a comparison at search time.

Checklist:

- Screenshots make the app's result obvious in the first 1-2 images.
- First screenshot carries the strongest user outcome, not a generic dashboard.
- Copy is specific, verifiable, and original.
- Visual style fits the category while staying distinct from competitors.
- Ratings are healthy in each target country. Pause countries with very low or damaged ratings until reviews recover or localization improves.
- Subscription terms, trial terms, and in-app purchase value are clear.
- Custom product pages, if used, adapt the user promise to intent without implying affiliation with a competitor.

If the user asks to generate App Store screenshots, use image/design skills as needed, but require original assets and truthful UI states.

### 5. Run The Feedback Loop

Use complete days where possible. Do not overreact to the first few hours of spend.

Early spend loop:

1. Let new campaigns settle.
2. If there is no spend by the start of day 3, consider a small max CPT increase after approval.
3. If spend happens but taps are weak, revise keyword relevance, screenshots, icon, title/subtitle, or custom page.
4. If taps happen but installs are weak, inspect product page promise, ratings, locale, and device fit.
5. If installs happen but trials/purchases are weak, inspect onboarding, paywall, price, product promise, and RevenueCat configuration.
6. If purchases happen but renewal/refund quality is weak, do not scale until the product value and subscription expectations are fixed.

Country loop:

- Pull rating by country before expanding.
- Pause or exclude countries with materially poor ratings, bad localization, high refund pressure, unsupported language, or weak conversion.
- Reopen countries only after the app page, language, support, and review profile improve.

### 6. Analyze Exports

Ask the user for the two core files:

- Apple Ads spend/export file.
- RevenueCat transaction or scheduled data export file.

Join at the most specific reliable grain available:

```text
date + campaign + ad group + keyword/search term + country
```

If exact joins are impossible, degrade carefully:

1. date + campaign + country
2. campaign + country
3. country only

Never pretend a coarse join proves keyword-level profit.

Compute:

- Spend, taps, installs if available, CPT, tap-through rate, and conversion from tap to install.
- Trials, purchases, gross revenue, net revenue if available, refunds, renewals, and active subscriptions.
- CAC or cost per purchase.
- ROAS by cohort window: day 0, day 3, day 7, day 30, or the best available period.
- LTV:CAC using observed renewals or a conservative category estimate clearly labeled as inferred.
- Confidence: high, medium, or low based on sample size and join quality.

Decision labels:

| Label | Use when | Action |
| --- | --- | --- |
| Scale | Positive ROAS or strong LTV:CAC with enough sample and clean attribution | Increase budget/bid gradually |
| Hold | Promising but too little data or noisy join | Keep capped, collect more data |
| Fix funnel | Taps/installs work but trial/purchase fails | Improve onboarding/paywall/page before more spend |
| Kill | Expensive, poor conversion, poor ratings, or policy risk | Pause or exclude |
| Investigate | Data conflict or tracking gap | Fix instrumentation/export join |

Scaling rule of thumb: raise budgets and bids in steps, then wait for fresh complete-day data. Sudden large increases can change auction dynamics and hide the reason a pocket was working.

## Output Formats

### Campaign Plan

```text
Apple Ads Growth Plan

Confirmed:
- [facts with evidence: user file, export, screenshot, current docs, or API result]

Inferred:
- [assumptions and what would confirm them]

Readiness Score:
- Desire:
- Differentiation:
- App page:
- Onboarding:
- Paywall:
- Attribution:
- Exports:
- Total:

Campaign Architecture:
- Tier 1:
- Tier 2:
- Tier 3:
- Keyword themes:
- Budget guardrails:
- Bid guardrails:

Product Page / Funnel Fixes:
1.
2.
3.

Launch Checklist:
- RevenueCat attribution:
- Product analytics:
- Apple Ads settings:
- Country/rating review:
- Approval needed before spend:
```

### Export Analysis

```text
Apple Ads + RevenueCat Readout

Data Used:
- Apple Ads export:
- RevenueCat export:
- Join grain:
- Date range:
- Known gaps:

Winners:
1. [campaign/country/keyword] - spend, revenue, ROAS, confidence, why it worked

Holds:
1. [campaign/country/keyword] - what data is missing

Kills:
1. [campaign/country/keyword] - why to pause

Funnel Fixes:
1.

Next 7 Days:
- Scale:
- Pause:
- Test:
- Instrument:
```

## Prompt Templates

Campaign setup:

```text
Design an Apple Search Ads launch plan for this iOS subscription app: [app details].
Use RevenueCat attribution, competitor-intent keyword tests, country tiers, conservative bid/budget guardrails, and a kill/hold/scale feedback loop. Flag App Store, Apple Ads, copycat, privacy, and subscription-disclosure risks.
```

Export analysis:

```text
Analyze these Apple Ads and RevenueCat exports for an iOS app.
Join by the most specific reliable grain, calculate spend, purchases, revenue, CAC, ROAS, and confidence, then tell me which campaigns/countries/keywords to kill, hold, fix, or scale.
```

App page audit:

```text
Audit this App Store page before Apple Search Ads spend.
Compare against these competitors for clarity, desire, screenshot strength, rating by country, originality, subscription disclosure, and conversion risk. Return the top fixes before launch.
```

## Current Reference Checks

When executing the workflow, prefer current primary docs over memory:

- Apple Ads keyword match types and Search Match behavior:
  - https://ads.apple.com/app-store/help/keywords/0059-understand-keyword-match-types
  - https://ads.apple.com/app-store/help/campaigns/0006-understand-search-match
- Apple Ads campaign structure, keyword, bid, negative keyword, and policy docs:
  - https://ads.apple.com/app-store/help/campaigns/0056-structure-campaigns
  - https://ads.apple.com/app-store/help/bids-and-budget/0076-considerations-for-keyword-bids
  - https://ads.apple.com/app-store/help/keywords/0060-use-negative-keywords
  - https://ads.apple.com/policies
- RevenueCat Apple Search Ads or AdServices integration docs:
  - https://www.revenuecat.com/docs/integrations/attribution/apple-search-ads
- RevenueCat Scheduled Data Exports docs:
  - https://www.revenuecat.com/docs/integrations/scheduled-data-exports
  - https://www.revenuecat.com/docs/integrations/scheduled-data-exports/data-export-version-5
- App Store Connect subscription, product page, custom product page, app privacy, and analytics docs.

If current docs conflict with this skill, follow the docs and report the delta.
