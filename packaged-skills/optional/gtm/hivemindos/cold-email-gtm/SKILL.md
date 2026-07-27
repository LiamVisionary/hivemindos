---
name: cold-email-gtm
description: Run the full cold-email motion end to end — ICP and objection mapping, verified signal research, five first-touch frameworks, a 6-touch sequence with a breakup email, two-tier personalisation, subject-line formulas, a QA score gate before sending, deliverability/DNS/domain-warming setup, CAN-SPAM and GDPR checks, and metric-driven performance diagnosis. Use for "cold email", "outbound sequence", "email deliverability", "why is my open rate low", or any B2B outbound campaign.
---

# Cold Email GTM

The rule above all rules: **write like a peer, not a vendor** — the moment an email reads as marketing copy, it is deleted. Test every draft: would you send it to a smart colleague at another company? Every sentence must create curiosity, establish relevance, build credibility, or drive to the ask; cut any sentence that does none.

**Hard rules that override everything below:** never fabricate a signal, fact, or proof point; drafts are queued for human approval before sending unless the operator has explicitly authorized an automated send path; the compliance section is a checklist, not legal advice; benchmark numbers are rules of thumb, not measured guarantees — do not present them as proven.

## 1. Before writing: ICP, framework, signals

**ICP gate — no mapping, no email.** Before drafting anything, interview the user for: the target persona (title, company type, size, seniority), the specific problem the offer solves for them, their top three objections, the desired next step (call / reply / referral), and persona-specific proof points. Keep the resulting map next to every email in the campaign.

**Pick one of five frameworks:**

| Framework | Use when | Shape |
| --- | --- | --- |
| Problem-first | Visible pain point | Problem observation → relevance → ask |
| Trigger-based | Recent event: funding, hiring, news, job change | Trigger → connection to problem → ask |
| Mutual connection | Referral or shared network | Name drop → context → ask |
| Value-first | Something genuinely useful to share | Insight/resource → brief context → ask |
| Direct ask | High-intent or very senior prospect | Brief context → one direct question, under 80 words |

**Signal gate — at least two verified signals from the last 90 days** before personalising a Tier 1 email. Signal families: job changes (best outreach window: two to six weeks in), hiring posts (budget + pain), funding announcements (two to four weeks after), content the prospect published, company news, tech-stack changes. Verify each signal is real and recent; never assume beyond what it shows.

## 2. The first-touch email

Structure, top to bottom: a 2–4 word subject that looks like an internal email; an opener about *their* world (never starting with "I" or "We"); one or two sentences of relevance connecting their situation to the offer; one sentence of proof with a real number or named customer; one low-friction question as the only CTA; sign-off.

Pre-send checklist: under 150 words · opener about them · no sentence starts with "I"/"We" · exactly one CTA phrased as a question · no jargon · every sentence earns its place · a friend could have sent it.

**Signal-led opener pattern:** state the verified signal, what it implies about their situation, and the tie to the offer — in that order, in one or two sentences. The prospect can tell real research from a mail-merge; that recognition is what earns the reply.

**Positioning spectrum:** every line also sits on a spectrum of how close it feels to the reader's desired outcome. Process language ("we can build a system for you") makes them believe in your work before feeling any result; sender-centered language ("we run campaigns for companies like yours") is credible but about you; the target zone is a truthful active position ("we're already talking to the kind of buyers you want more of"); past that, claim density collapses believability. Move as close to the outcome as credibility allows — and never fabricate an "already". Ban setup verbs (build, set up, install, create, launch, implement); prefer in-motion phrasing (already working with, already running, already seeing) only where true.

**Length by seniority:** C-suite/VP under 80 words leading with a business outcome and one option-free question; director/manager under 120 leading with the team's specific problem; IC under 150, more technical detail acceptable.

## 3. The 6-touch sequence

| Touch | Day | Angle | Cap |
| --- | --- | --- | --- |
| 1 | 1 | Problem-first or trigger opener | 150 words |
| 2 | 4 | New evidence: case study, data point, result | 120 |
| 3 | 9 | A different but related pain point | 120 |
| 4 | 16 | Industry insight tied to the problem | 100 |
| 5 | 25 | One direct question, no context or recap | 60 |
| 6 | 35 | Breakup: professional close + referral ask | 60 |

Every follow-up stands alone, brings a new angle, and is shorter than the last. Never "just checking in", never "circling back", never a recap of previous emails. The breakup email says plainly it is the last note, invites a reply if the problem becomes a priority, asks whether someone else at the company is the better contact, and closes with a genuine, specific well-wish.

## 4. Personalisation: two paths and a QA gate

Personalisation only works when it connects to the problem — a biography fact followed by an unrelated pitch is worse than no personalisation.

- **Path A (signal-led):** build the opener entirely on one verified 90-day signal. Highest reply rate, slowest. Always use for Tier 1 accounts.
- **Path B (persona-led):** no custom signal; open with a problem specific to the persona's role and day-to-day reality, avoiding list-scraper phrases. Use for volume campaigns (500+ contacts) with segment-level personalisation.

For sequences at scale, define merge variables (first name, company, title, signal, customer type, result metric, reference customer, industry) and write one base template that reads naturally whichever signal type fills the slot.

**QA gate before every send:** score the draft 0–100 across five equal dimensions — signal relevance, message-market fit, clarity of the ask, proof quality, and length/tone. Rewrite any dimension scoring low. **Below 80 total: do not send; rewrite first.**

## 5. Subject lines

The subject line is a colleague's message, not a headline: two to four words, lowercase after the first, no exclamation marks or all-caps, and it never names the product or company. Photograph principle: it should form one clear mental picture — clarity beats curiosity, curiosity beats clever. No question marks by default; question-mark subjects are a known A/B variant, not a house rule. Never fake a RE:/FWD: thread prefix on a first touch — that is a deceptive subject line (a compliance violation) regardless of what it does to open rates. Five working shapes: a specific observation about their world ("growing the sales team"), a single problem keyword ("pipeline"), first name + topic ("Sarah, onboarding time"), company + observation ("Acme and SDR ramp time"), and a referrer's name + "suggested". Dead on arrival: "following up", "partnership opportunity", the overused "quick question", anything past six words.

## 5b. Scaling: volume infrastructure

To scale, go horizontal — more sending domains and inboxes, never more volume per mailbox. Send from dedicated secondary domains (never the primary; 10+ is a normal footprint), ~3 inboxes per domain, ~30 emails/day/inbox, on reputable mailbox providers only. Never send cold email through newsletter/marketing ESPs (they land cold mail in Promotions and lack sequence mechanics) — use a cold-email sequencer. At volume: don't track opens (the tracking pixel hurts delivery; reply rate becomes the primary metric), vary copy per recipient so filters can't fingerprint identical bodies, and verify every address before sending. The offer matters more than the copy at scale: specific and measurable beats generic, and a free credibility demonstration (audit, mockup, trial) makes the first yes easy.

**Sequence-length fork:** high-personalisation low-volume motions run the 6-touch sequence; high-volume broad motions cap at 2–3 touches and spend remaining capacity on new prospects.

**Escalation loops:** push sequence non-responders to a LinkedIn connection touch (under the linkedin-gtm caps and human-approval rules — never rented or borrowed sender identities, which are identity deception); retarget pixeled site visitors with case-study ads to stay present cheaply between touches; and qualify with AI *before* sending (score each prospect's site against explicit fit criteria) so no volume is wasted on non-fits. AI reply tools may triage and draft responses; autonomous reply-sending requires the operator's explicit authorization.

## 6. Deliverability, warming, compliance

Deliverability is infrastructure — set it up once, before any campaign.

- **DNS, all three:** SPF (which servers may send for the domain), DKIM (tamper-evident signature), DMARC (receiver policy on failure). Verify with the sending tool before launch.
- **Warm new domains:** week 1: 5–10 real emails/day; week 2: 20–30; week 3: ~50; week 4+: up to ~100/day per inbox. Never spike volume; filters flag sudden jumps. Use an inbox-warming tool for the first month.
- **Triage table:** bounces over ~5% → verify the list with an email-verification service; landing in spam → check DNS records, cut volume, re-warm; opens under ~15% → test subject lines and run a seed-list placement test; a sudden open-rate collapse → stop sending immediately and re-warm from lower volume.
- **CAN-SPAM (US):** honest subject lines, a physical mailing address in every email, a working unsubscribe honored promptly, and never mailing opted-out addresses.
- **GDPR (EU):** B2B prospecting generally rests on legitimate interest — the email must be relevant to the recipient's professional role, include an opt-out, avoid personal addresses without consent, and the legitimate-interest basis should be documented.

## 7. Diagnose performance one element at a time

Change one variable per experiment, send at least ~100 per variant, and wait several days before concluding. Rule-of-thumb targets: opens 35–50% (under ~25% → fix subject lines), replies 3–8% (under ~2% → body relevance or a lower-friction CTA), positive replies 1–3% (under ~1% → offer or ICP mismatch), bounces under 3% (over 5% → verify the list), unsubscribes under 0.5% (over 1% → wrong personas or too much volume).

**Anti-patterns to strip from every draft:** opening with your own name and company; "I wanted to reach out"; "I came across your profile"; "I hope this finds you well"; "we help companies like yours"; personalisation disconnected from the problem; multiple CTAs; bodies over 200 words; corporate buzzwords (disruptive, innovative, synergy, leverage, cutting-edge, game-changing); em dashes; setup verbs describing your process instead of their outcome; fake RE:/FWD: prefixes; word-swapping a flagged line instead of rewriting its underlying idea (a synonym keeps the same weak idea — re-derive the line from what it was trying to say); personalization carrying weak positioning (a researched opener cannot rescue process-first body copy).

## 8. End-to-end order of operations

Map ICP and objections → research the prospect (two verified signals for Tier 1) → pick the framework → write the email within its word cap → QA-score and rewrite until 80+ → generate five subject variants → strip anti-patterns → build the five follow-ups with a new angle per touch → verify SPF/DKIM/DMARC and warming → queue for human approval.

Reusable slot-based rows for all of this — the first-touch skeleton, framework picker, sequence spine, subject formulas, anti-patterns, seniority caps, warming ramp, and metric triage — live in this repository's `workflows/gtm/cold-email/templates.json` bank.
