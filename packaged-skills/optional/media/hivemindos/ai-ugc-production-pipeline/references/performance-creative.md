# Performance-Creative Research And Storyboard Loop

Read this reference when the deliverable is a direct-response AI UGC ad, a paid-social creative brief, a competitor-ad research sheet, or a storyboarded 25-30 second asset. It strengthens the marketing work before generation; it does not replace provider-specific prompting or paid-campaign execution.

## 1. Define The Honest Transformation

Start with the buyer's lived situation rather than the product's feature list.

```text
Audience: [AUDIENCE]
Painful moment: [OBSERVABLE MOMENT]
Cost of the current state: [PRACTICAL OR EMOTIONAL COST]
Desired after-state: [HONEST TRANSFORMATION]
Product mechanism: [WHAT THE PRODUCT ACTUALLY DOES]
Approved proof: [PROOF ASSET OR NONE]
Forbidden claims: [FORBIDDEN CLAIMS]
Primary conversion event: [CONVERSION EVENT]
```

The painful moment should be specific enough to film. The after-state should be plausible and supported by the product. Human desires can help explain why a moment matters, but never use them as permission to humiliate, diagnose, threaten, sexualize, or exploit a protected or vulnerable audience.

For health and body-image products, describe the measurement, routine, information, or behavior problem without declaring that a person is defective. Weight loss, medical accuracy, mental-health outcomes, and before/after imagery require approved evidence and category review.

## 2. Build A Competitor Evidence Sheet

Use public sources such as Meta Ad Library, platform creative centers, public landing pages, and the user's own analytics. Record one row per ad or variant:

| Field | Record |
| --- | --- |
| Evidence | Source URL, capture date, advertiser, platform, geography if exposed |
| Delivery | Active/inactive status and start date as shown; visible variant count |
| Opening | First spoken line and first visible action, paraphrased in deliverables |
| Audience | Who the opener appears to call out |
| Pain and reframe | Existing belief, blamed cause, proposed alternative cause |
| Value | Product mechanism stated or demonstrated |
| Objection | Need, price, urgency, desire, trust, or another explicit doubt |
| Proof | Demonstration, data, testimonial, authority, comparison, or none |
| CTA | Qualification and requested next action |
| Format | Confessional, challenge, demo, transformation, interview, news-like, silent visual, or other |
| Rights/risk | Likeness, music, footage, trademark, testimonial, category, or claim concern |
| Confidence | Observed fact, user-supplied result, or analyst inference |

Use roughly comparable ads and code enough rows for patterns to repeat. Do not force a fixed sample when the library is sparse.

### Evidence rules

- An active ad is confirmed as active at the capture time.
- A visible start date is confirmed only when the library exposes it.
- Longevity, many variants, or repeated copy can prioritize research, but cannot prove spend, profit, conversion, or winner status.
- Paid and organic sources answer different questions. Paid shows what an advertiser chose to run; organic engagement shows what audiences visibly interacted with. Neither reveals downstream business value without owned attribution.
- Keep source links and paraphrase the transferable structure. Do not copy another advertiser's script, footage, voice, likeness, brand devices, news segment, or proof.

## 3. Synthesize Patterns Without Cloning

Cluster rows by:

- painful moment and proposed reframe
- first-frame action
- audience callout shape
- format family
- mechanism sentence
- objection and proof type
- product reveal timing
- CTA structure

Return:

1. Three to five recurrent, evidence-linked patterns.
2. One underserved audience, objection, setting, speaker, or first-frame action.
3. One control concept that combines a validated structure with original expression.
4. A proof ledger listing what the ad may say, what needs approval, and what is forbidden.

If the strongest idea depends on an unsupported comparison, an unlicensed clip, fabricated authority, or a degrading accusation, reject it and keep the structural lesson only.

## 4. Write The Five-Beat Ad

Use three functional parts—callout, value, action—expanded into five visible beats:

```text
Hook -> Problem -> Demo -> Proof -> CTA
```

### Hook

Stop the intended viewer with one line, one performance, and one first-frame action that point at the same problem. Useful shapes:

- audience label, used only when lawful and respectful
- yes-question grounded in a recognizable moment
- if-then reframe
- counterintuitive result that the ad can honestly explain

### Problem

Show the concrete moment and the cost of the current workaround. Do not turn a hypothesis into a diagnosis.

### Demo

State or show the implementation clearly. Prefer a concrete action and result over “it just works.” If the product interface or result must be legible, use prepared screen assets or post-production rather than trusting generated text.

### Proof

Answer one major doubt with the strongest approved proof available. Proof can be an owned demonstration, measured result with scope, licensed testimonial, or clearly sourced comparison. If no proof exists, mark the beat as a proof gap and do not invent one.

### CTA

Qualify the intended user and name one next action. Avoid false urgency and disguised navigation.

Use the shortest duration that lets the beats land. A five-beat spine can fit several shot counts; six scenes are not mandatory. Read the final script aloud or generate a timing read before locking beat windows.

## 5. Approve The Storyboard Before Video

The storyboard is a cheap creative and continuity gate. It should make every decision reviewable before video credits are spent.

For each beat, record:

```text
Beat: [BEAT NAME]
Timing budget: [TIMING BUDGET]
Mode: [SPOKEN TO CAMERA OR INSERT]
Shot and camera: [SHOT AND CAMERA]
First visible action: [VISIBLE ACTION]
Spoken line: [SPOKEN LINE]
Props and hands: [PROP AND HAND JOBS]
Continuity in: [CONTINUITY IN]
End state: [OBSERVABLE END STATE]
Risk or proof note: [RISK OR PROOF NOTE]
```

Review the board for:

- the first frame communicates before dialogue begins
- the character feels credible for the audience and does not copy a real creator
- the room, styling, skin, camera, and performance fit native phone footage when that is the concept
- every visible hand and prop has one clear job
- inserts and talking-head beats are unambiguous
- time of day, wardrobe, identity, geography, prop counts, and ownership remain consistent
- board chrome, labels, arrows, timing strips, logos, and annotations are explicitly excluded from final footage
- generated UI, packaging text, subtitles, or numeric displays are moved to controlled post-production when accuracy matters

Approve or revise the still board before generation. A beautiful board with a weak ad idea still fails.

## 6. Route The Video Prompt By Runtime

Do not treat one video generator's prompt grammar as portable to another.

- MiniMax H3: load `minimax-h3-video-prompting`; resolve H3-Base-FL2VA versus H3-Base-Ref2VA and T2VA/I2VA/FL2VA/L2VA/Ref2VA. Verify the current model license/territory, provider authorization, live endpoint, duration, inputs, and audio behavior before execution.
- Dreamina/Jimeng Seedance 2.5: load `seedance-prompt-optimizer`, verify the model is available in the user's selected account/region, and use its current reference, timing, storyboard, and limitation guidance.
- MUAPI Seedance 2.0: load `muapi-seedance-video` and verify the live endpoint schema.
- Higgsfield Seedance or another Higgsfield model: load `higgsfield-generate` and `higgsfield-api-quirks`, then validate live limits.
- Another generator: discover and verify its own prompt/runtime contract rather than translating Seedance syntax by analogy.

The supplied source proposes a long block-labeled prompt. Treat the labels as an optional planning checklist, not a universal syntax:

1. reference roles and exclusions
2. camera and phone-native imperfections
3. look, lighting, color, and skin treatment
4. performance mode: spoken-to-camera versus insert/voiceover
5. voice, language, pace, and delivery
6. character identity and wardrobe
7. setting and allowed locations
8. time-coded stages with one change and one end state each
9. brand pronunciation and placement
10. physical audio and music decision
11. continuity facts and numeric counts
12. final constraints

Only include blocks that add useful control. Prefer positive, observable directions; use a short ban list for high-risk failure modes. Prompt order and negative-constraint behavior vary by model/runtime and must be tested rather than presented as universal facts.

For H3, translate the approved storyboard into the selected H3 schema rather than pasting this checklist as labels. A 25–30 second five-beat control becomes two or three 4–15 second prompts under the currently documented limit. Ref2VA defines reusable character, product, scene, interface, and voice sources; boundary-frame modes are reserved for actual opening/ending compositions. Preserve approved dialogue exactly in `<d>[Language] ...</d>`, keep `(Sx)` speaker IDs stable inside each prompt, and separate the integrated/detailed timeline, whole-video soundscape, and audience-only music. Carry a continuity manifest across clips and assemble only after clip-level QA.

## 7. QA The Control Before Batching

Review the rendered control at normal speed, muted, audio-only, and frame samples around every cut.

### Marketing QA

- hook, first frame, and audience agree
- problem is specific and honest
- demo makes the mechanism understandable
- proof matches the approved ledger
- CTA is clear and lawful

### Media QA

- identity, wardrobe, voice, prop counts, and location continuity hold
- hands, food/product interaction, lip sync, and physics are plausible
- spoken-to-camera beats are not replaced by unwanted narration
- no generated captions, UI, brand text, board chrome, watermark, or fabricated authority appears
- the product is not morphed and no unsupported feature is demonstrated
- duration, aspect ratio, audio, and export are correct for the selected destination

### Rights And Policy QA

- user owns or licensed every supplied reference
- synthetic likeness and voice have consent
- music, footage, logos, testimonials, news-like framing, and comparisons are cleared
- AI/sponsorship disclosure and regulated-category review are current

## 8. Create Controlled Variants

After the control passes, change one dimension at a time:

| Dimension | Examples |
| --- | --- |
| Hook | label, yes-question, if-then reframe, counterintuitive result |
| First frame | action, object state, insert, direct-to-camera performance |
| Speaker | audience segment or delivery style, using original/consented identity |
| Setting | kitchen, desk, car, street, bedroom, workplace where credible |
| Objection | need, trust, effort, urgency, price |
| Proof | demo, scoped data, testimonial, comparison, authority |
| CTA | install, try, learn, calculate, compare, save |

Record one self-contained row per control or variant with: variant id, control asset, changed dimension, old value, new value, hypothesis, held-constant elements, claim/rights approval, generation approval, review metrics, generated asset, and current status. Repeat the fields in every row instead of making the reviewer recover them from surrounding prose. If two or more dimensions change, call it a new concept. Do not infer a creative winner from views alone; connect hook and watch metrics to clicks, installs, activation, paid conversion, refunds, and retained value.

The measurement plan should explicitly map exposure/attention → click → install → activation → trial/paywall when applicable → paid conversion → refunds → retention → contribution or retained value. Mark any genuinely inapplicable stage `N/A` with a reason rather than dropping it from the plan.

Approvals are separable. A concept approval does not approve claims or rights; claims/rights approval does not approve generation spend; generation approval does not approve uploading private references. Name private-reference upload explicitly whenever a face, voice, product master, analytics export, unreleased UI, or other private asset may leave the local workspace. Publishing and paid-campaign execution remain separate approvals again.

## Deliverable Shape

```text
Transformation Brief
Competitor Evidence Sheet
Pattern Synthesis
Proof Ledger
Five-Beat Control Script
Storyboard Cards
Runtime And Capability Check
Generation Prompt Or Handoff
QA Report
Controlled Variant Matrix
Measurement Plan
Approval Gates: concept, claims/rights, private-reference upload, generation spend, publishing, paid execution
```
