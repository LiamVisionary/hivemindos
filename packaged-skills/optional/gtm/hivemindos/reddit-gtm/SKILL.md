---
name: reddit-gtm
description: Run a Reddit go-to-market motion end to end — pick and validate subreddits, earn credibility with value-first comments instead of links, post with four community-tested post shapes, catch buying-intent threads within minutes via keyword monitoring, and score + route the inbound leads. Use for "Reddit GTM", "get leads from Reddit", "promote on Reddit without getting banned", subreddit research, or Reddit lead-gen automation.
---

# Reddit GTM

Reddit punishes advertising and rewards helpfulness. This skill turns that constraint into a pipeline: pick the right communities → earn credibility with comments, not links → post what the community values → catch buying-intent threads while they are fresh → score and route the leads that come in.

**Hard rules that override everything below:** each subreddit's own rules win over this skill; never post or comment autonomously without human review; never fabricate experience or results; these tactics are operator heuristics, not measured guarantees — do not present them to users as "proven".

## Phase 1 — Pick and validate subreddits

1. **Find:** search the user's industry terms on Reddit; favor subreddits with roughly 50,000+ members for reach.
2. **Validate the ICP is there:** sort by Top → This Week and look for posts from the target personas. Treat the subreddit as validated only when several recent posts show decision-makers asking questions the user's offer answers.
3. **Read the rules first:** copy the subreddit rules into the campaign doc and note every restriction on self-promotion, links, and brand mentions. Assume "no advertising" is enforced.
4. **Decode the culture:** sort by Top → This Month, open the top posts, study the highest-voted comment in each (tone, length, use of examples/screenshots), and save a handful as style references.

## Phase 2 — Convert with comments, not links

Comments on existing threads beat new posts for building credibility: they answer a real question, they build karma (which unlocks communities and ranks future comments higher), and some communities require karma before posting at all.

**Profile first.** Before commenting, make the profile convert: a casual one-line bio naming role and company, plus website and social links. The conversion path is: useful comment → profile click → credible bio → site visit → form or booked call. The reader makes every step of that decision themselves.

**The comment shape.** Answer the thread's question with a short numbered list of genuinely useful suggestions, and mention the user's product once, mid-list, as one option among several ("there are also tools like X for this"). Most of the list must help the reader regardless of the product.

**Link discipline.** No links in comments — they read as spam and get downvoted. Name the tool; interested readers will search it or click the profile.

**Context without selling.** Establishing credibility is fine ("for context, I run an agency; here's what we tell clients: …"); a call-to-action or booking link is not.

## Phase 3 — Post with four shapes

Golden rule: post what the community itself finds valuable; visibility compounds from upvotes.

1. **Relatable frustration** — a shared pain, brief context, then an open question inviting advice or war stories.
2. **Experiment write-up** — what you tried, what actually happened with real numbers, what you'd change. Vague write-ups get called out; specifics are the entry fee.
3. **Opinion collector** — "what's the best X you've used for Y?" plus a line of context. Comment volume compounds reach, and these threads rank in search engines and AI answers.
4. **Problem-to-lesson story** — the problem, one or two failed attempts, the approach that worked with a concrete result, then numbered advice. An optional product mention gets at most one sentence, and the lesson must stand alone without it.

Reusable slot-based skeletons for all four shapes (plus the comment shape) live in this repository's `workflows/gtm/reddit/templates.json` bank.

## Phase 4 — Catch buying-intent threads fast

Timing is the edge: answering within the first half hour of a "what tool should I use for…" post is worth far more than answering the next day.

- **Keyword list (5–10):** category + "tool"/"software", "best <category> software", "<competitor> alternative", "<category> alternative to <competitor>".
- **Manual loop (15–20 min/day):** for each keyword, save a Reddit search bookmarked as posts-only, sorted by New, filtered to the past day or week; sweep the bookmarks every morning and reply where the ICP is asking.
- **Automated alerts:** a free keyword-alert service (e.g. F5 Bot) can email every Reddit mention of each keyword in near-real-time, with the post title, snippet, link, and subreddit. Monitoring may be automated; replies are drafted for human approval.

## Phase 5 — Score and route the inbound

When Reddit traffic converts on a form, enrich and route automatically instead of leaving blank lead records: classify the email domain (business/personal/educational), classify seniority from the job title, enrich company data from the CRM's own record, compute a lead score against the user's ICP criteria, then route — qualified leads get a lifecycle-stage update and a sales-channel alert; the rest go to nurture. Any workflow tool + CRM + LLM step can implement this; keep the scoring rubric in one editable prompt so the user can retune point values without code.

## Operating cadence

- Once per subreddit: the Phase 1 research.
- Once: profile optimization, keyword list, alert setup, routing automation.
- Daily (15–20 min): sweep alerts and bookmarks; comment on fresh buying-intent threads.
- Ongoing: comment for karma before posting; post one of the four shapes once or twice a week.
