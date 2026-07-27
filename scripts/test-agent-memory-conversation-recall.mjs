import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { answerFromAgentMemory, recallAgentMemory } = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const {
  conversationMemoryExcerptBudget,
  queryFocusedConversationExcerpt,
} = await import("../src/lib/services/obsidian/agent-memory/excerpt.ts");
const { rebuildFullVaultSearchIndex } = await import("../src/lib/services/obsidian/full-vault-search-index.ts");

const separatedEvidence = `
**User:** Can you remind me how much was allocated for influencer marketing in the campaign plan?

**Assistant:** The campaign uses several channels. The influencer marketing allocation was $2,000.

${"Unrelated implementation notes and scheduling details. ".repeat(30)}

**User:** What play did I attend at the local community theater?

**Assistant:** You attended The Glass Menagerie at the local community theater.
`;
const focusedExcerpt = queryFocusedConversationExcerpt(
  separatedEvidence,
  "How much was allocated for influencer marketing, and what play did I attend at the local community theater?",
  960,
);
assert.match(focusedExcerpt, /influencer marketing allocation was \$2,000/i);
assert.match(focusedExcerpt, /attended The Glass Menagerie/i);
assert.ok(focusedExcerpt.length <= 960);

const transcriptPriorityExcerpt = queryFocusedConversationExcerpt(`
**Asked:** What Jamaican dishes contain fruit?
**Last reply:** Ackee is a fruit used in Jamaica's national dish.
**Topics:** Jamaican, dishes, fruit, snapper

## Transcript

**User:** What Caribbean dishes feature snapper?

**Assistant:** Try Grilled Snapper with Mango Salsa, where the fish is topped with a fruity and spicy salsa.

${"Later unrelated restaurant discussion. ".repeat(30)}
`, "What snapper dish has fruit in it?", 420);
assert.match(transcriptPriorityExcerpt, /Grilled Snapper with Mango Salsa/i);
assert.doesNotMatch(transcriptPriorityExcerpt, /Ackee is a fruit/i);

const semanticSpecificityExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** What Caribbean dishes feature snapper?

**Assistant:** 1. Escovitch Fish is fried snapper with pickled vegetables. 2. Fish Curry is snapper with curry and aromatics. 3. Conch and Snapper Stew combines seafood with tomato and peppers. 4. Grilled Snapper with Mango Salsa tops the fish with a fruity and spicy salsa. 5. Fish and Fungi serves snapper with cornmeal. ${"More general Caribbean cooking discussion. ".repeat(20)}
`, "What snapper dish has fruit in it?", 260);
assert.match(semanticSpecificityExcerpt, /Grilled Snapper with Mango Salsa/i);

const assistantGroundedSpecificityExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** What dishes feature snapper?

**Assistant:** Grilled Snapper with Mango Salsa tops the fish with fruit and spice.

${"Unrelated Caribbean restaurant planning. ".repeat(20)}

**Assistant:** Escovitch Fish is a classic Jamaican dish with pickled vegetables.
`, "What dish did you recommend with snapper and fruit?", 320);
assert.match(assistantGroundedSpecificityExcerpt, /Grilled Snapper with Mango Salsa/i);
assert.doesNotMatch(assistantGroundedSpecificityExcerpt, /Escovitch Fish/i);

const adjacentSpecificAnswer = queryFocusedConversationExcerpt(`
## Transcript

**User:** Tim enjoys watching Harry Potter movies with family and plays the movie theme on piano.

**User:** Tim: Do you have any favorite Thanksgiving traditions?

**John:** John: We love preparing the feast and watching movies afterwards.

**User:** Tim: Which movies do you watch together?

**John:** John: We love "Home Alone" because it always brings lots of laughs.

**User:** Later unrelated discussion follows.

${"Unrelated discussion about sports and books. ".repeat(30)}
`, "Which movie does John enjoy watching during Thanksgiving?", 520);
assert.match(adjacentSpecificAnswer, /Home Alone/i);

const predicateFocusedExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**John:** John practices yoga poses that challenge his body and mind.

${"Tim and John discuss yoga, exercise, and poses. ".repeat(10)}

**User:** Tim: How long do you usually hold that pose?

**John:** John: Usually 30 to 60 seconds.
`, "How long does John usually hold the yoga pose he shared with Tim?", 320);
assert.match(predicateFocusedExcerpt, /Usually 30 to 60 seconds/i);

const eventObjectExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**John:** I met my teammates on August 15 and they gave me a warm welcome back.

${"We talked about basketball, the team, and the memorable reunion. ".repeat(12)}

**John:** My teammates gave me a basketball covered in autographs as a sign of friendship.
`, "What did John's teammates give him when they met on August 15?", 360);
assert.match(eventObjectExcerpt, /basketball covered in autographs/i);

const unrelatedQuoteMustNotWin = `
## Transcript

**John:** John: I held a benefit basketball game last week. [Sharing image - query: charity basketball tournament for children.]

**User:** Tim: Wow! How did the game go?

**John:** John: The game was a total success and raised money for charity.

**User:** Tim: Great job organizing the event. That's really making a difference!

**John:** John: Thanks, Tim! By the way, what book are you currently reading?

**User:** Tim: I'm reading "The Name of the Wind" by Patrick Rothfuss.

**John:** John: "The Name of the Wind" sounds cool. I'll add it to my list.
`;
const charityEventExcerpt = queryFocusedConversationExcerpt(
  unrelatedQuoteMustNotWin,
  "What charity event did John organize recently in 2024?",
  520,
);
assert.match(charityEventExcerpt, /benefit basketball game/i);
assert.doesNotMatch(charityEventExcerpt, /Name of the Wind/i);

const latestQuantitativeUpdateExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** How should I track my shooting accuracy percentage during practice?

**Assistant:** Track every attempt and set future milestones such as reaching 55% or 65%.

${"Generic shooting drills and practice advice without a measured result. ".repeat(20)}

**User:** I've increased my shooting accuracy to 60% by April 12 based on my recent practice.

**Assistant:** Maintaining that progress requires consistent drills and recording each session.
`, "What is my shooting accuracy percentage based on my recent practice?", 520);
assert.match(latestQuantitativeUpdateExcerpt, /increased my shooting accuracy to 60%/i);
assert.doesNotMatch(latestQuantitativeUpdateExcerpt, /future milestones such as reaching 55% or 65%/i);

const durablePreferenceExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I prefer practicing shooting on Sundays because that schedule works best for me.

**Assistant:** Track each attempt and review your progress after every Sunday session.

${"Generic weekly shooting advice about drills, routines, and steady improvement. ".repeat(20)}

**User:** What is a good general practice plan for improving my shooting accuracy?

**Assistant:** Practice twice each week and rotate through several common shooting drills.
`, "What would be a good routine for practicing shooting each week to help me improve steadily?", 520);
assert.match(durablePreferenceExcerpt, /prefer practicing shooting on Sundays/i);

const durableInstructionExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** Always include nutritional details when I ask about health and wellness updates.

**Assistant:** I will include food and nutrient details in future health updates.

${"Generic discussion of the latest healthy lifestyle trends, exercise, sleep, and staying active. ".repeat(20)}
`, "What should I know about the latest trends in staying healthy?", 520);
assert.match(durableInstructionExcerpt, /Always include nutritional details/i);
assert.match(durableInstructionExcerpt, /food and nutrient details/i);

const vocabularyBridgeExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** Tim and John chatted about sports and their favorite games for a long time. ${"Sports are fun. ".repeat(20)}

**John:** My teammates gave me a basketball covered in autographs. It is my favorite keepsake.

${"Later they repeatedly discussed sports, games, exercise, and teams. ".repeat(25)}
`, "What similar sports collectible did John's teammates give him?", 520);
assert.match(vocabularyBridgeExcerpt, /basketball covered in autographs/i);

const eventVerbExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I got my iPhone 13 Pro from Best Buy on Black Friday for $800.

${"Unrelated personal planning notes. ".repeat(30)}

**Assistant:** ${"Here are many iPhone 13 Pro cases and accessories. ".repeat(30)}
`, "When did I buy the iPhone 13 Pro?", 520);
assert.match(eventVerbExcerpt, /got my iPhone 13 Pro.*Black Friday/i);

const userGroundedExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I read an article on June 1 about hydration strategies for athletes in hot climates. Can you help me apply it?

**Assistant:** The article's main points were drinking before, during, and after exercise, replacing electrolytes, and monitoring urine color.

${"Unrelated assistant advice about recovery and nutrition. ".repeat(20)}
`, "What were the main points in the article I read on June 1?", 520);
assert.match(userGroundedExcerpt, /I read an article on June 1/i);
assert.doesNotMatch(userGroundedExcerpt, /drinking before, during, and after|replacing electrolytes|urine color/i);

const userCountExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I am working on a database group project and a visualization course project alongside my thesis.

**Assistant:** You are juggling three additional projects: a database project, a visualization project, and an invented deployment project.
`, "How many projects have I been working on simultaneously, excluding my thesis?", 520);
assert.match(userCountExcerpt, /database group project.*visualization course project/i);
assert.doesNotMatch(userCountExcerpt, /invented deployment project/i);

const userMeasurementExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I dedicate about two hours to coding exercises each day.

**Assistant:** A generic beginner might practice for thirty minutes daily.
`, "How much time do I dedicate to coding exercises each day?", 520);
assert.match(userMeasurementExcerpt, /about two hours/i);
assert.doesNotMatch(userMeasurementExcerpt, /thirty minutes/i);

const measurementContextExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** ${"Earlier unrelated planning and recommendation questions. ".repeat(30)}

**Assistant:** General advice.

**User:** What is the general rule for determining the value of a piece of art?

**Assistant:** ${"Long generic art appraisal guidance. ".repeat(20)}

**User:** My flea market find is actually worth triple what I paid for it.
`, "How much is the painting worth in terms of the amount I paid for it?", 520);
assert.match(measurementContextExcerpt, /value of a piece of art/i);
assert.match(measurementContextExcerpt, /worth triple what I paid/i);

// Bracketed segments (image captions, attachments) carry answers; an excerpt
// must never end mid-segment and strand half a caption.
const captionIntegrityExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**Melanie:** Melanie: The poetry reading was so moving last night, everyone brought their own work.

${"Filler chatter about weekend plans and recipes. ".repeat(6)}

**Melanie:** Melanie: Here is a photo from the event. [Sharing image - query: poetry reading posters. The image shows: posters that say "Trans Lives Matter" hanging behind the stage.] It felt powerful.

**User:** Caroline: That looks wonderful, thanks for sharing.
`, "What did the posters at the poetry reading say?", 360);
assert.match(captionIntegrityExcerpt, /Trans Lives Matter/i);

// Small corpora afford fuller sessions: the same budget helper scales with the
// hit count so a 10-note conversation archive is not excerpted through the
// same keyhole as a 10,000-note vault.
const { adaptiveConversationExcerptBudget } = await import("../src/lib/services/obsidian/agent-memory/excerpt.ts");
const fewHitsBudget = adaptiveConversationExcerptBudget("What did John cook last week?", 10);
const manyHitsBudget = adaptiveConversationExcerptBudget("What did John cook last week?", 120);
assert.ok(fewHitsBudget > conversationMemoryExcerptBudget("What did John cook last week?"),
  `few-hit budget should exceed the base budget, got ${fewHitsBudget}`);
assert.ok(manyHitsBudget <= conversationMemoryExcerptBudget("What did John cook last week?") * 1.01,
  `many-hit budget should not exceed the base budget, got ${manyHitsBudget}`);
const aggregationAdaptive = adaptiveConversationExcerptBudget("How many tournaments have I won across our conversations?", 40);
assert.ok(aggregationAdaptive >= 3000, `aggregation small-corpus budget should widen substantially, got ${aggregationAdaptive}`);

// Counting/aggregation queries need every scattered instance, not the top few:
// "how many tournaments" is only answerable if all five wins are visible.
const aggregationCoverageExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** I won the regional tournament in January, such a great start.

${"Filler about practice schedules and travel plans. ".repeat(8)}

**User:** I won the city tournament in March after a tough final.

${"Filler about practice schedules and travel plans. ".repeat(8)}

**User:** I won the spring tournament in May against strong rivals.

${"Filler about practice schedules and travel plans. ".repeat(8)}

**User:** I won the charity tournament in August for a good cause.

${"Filler about practice schedules and travel plans. ".repeat(8)}

**User:** I won the winter tournament in December to end the year.

${"Filler about practice schedules and travel plans. ".repeat(8)}
`, "How many tournaments have I won across our conversations?", conversationMemoryExcerptBudget("How many tournaments have I won across our conversations?"));
for (const month of ["January", "March", "May", "August", "December"]) {
  assert.match(aggregationCoverageExcerpt, new RegExp(month, "i"));
}

// Standing user guidance must surface even when the query shares no vocabulary
// with the instruction turn: a durable "always/never" instruction governs any
// later request in that conversation's scope.
const standingGuidanceExcerpt = queryFocusedConversationExcerpt(`
## Transcript

**User:** Please always mention the calorie content when recommending meals.

**Assistant:** Understood, I will include calorie details from now on.

${"Unrelated chatter about weekend plans and travel logistics. ".repeat(30)}

**User:** What should I cook for dinner tonight?

**Assistant:** A quick stir-fry with vegetables and rice is a great weeknight dinner choice.
`, "What should I cook for dinner tonight?", 1200);
assert.match(standingGuidanceExcerpt, /calorie content/i);
assert.match(standingGuidanceExcerpt, /stir-fry/i);
assert.ok(standingGuidanceExcerpt.length <= 1200);

// Assistant-grounded queries keep their focused single-passage semantics.
const assistantGroundedNoGuidance = queryFocusedConversationExcerpt(`
## Transcript

**User:** Please always mention the calorie content when recommending meals.

**Assistant:** Understood, I will include calorie details from now on.

${"Unrelated chatter about weekend plans and travel logistics. ".repeat(30)}

**User:** Which restaurant did you recommend for my anniversary?

**Assistant:** I recommended Chez Panisse for your anniversary dinner.
`, "Which restaurant did you recommend for my anniversary?", 1200);
assert.match(assistantGroundedNoGuidance, /Chez Panisse/i);

assert.equal(conversationMemoryExcerptBudget("What snapper dish has fruit in it?"), 1200);
assert.equal(conversationMemoryExcerptBudget("What Jamaican dish did you recommend with snapper and fruit?"), 1200);
assert.equal(conversationMemoryExcerptBudget("Summarize how my rental-property decisions developed over time"), 1800);
assert.equal(conversationMemoryExcerptBudget("How many projects did I work on across all sessions?"), 1800);

const oversizedTranscript = `
## Transcript

**User:** The protocol currently covers 50 agents at 90% reliability.

**Assistant:** Thanks, I recorded that update.

${"Large archived transcript filler without the target vocabulary. ".repeat(12_000)}
`;
const oversizedStartedAt = performance.now();
const oversizedExcerpt = queryFocusedConversationExcerpt(oversizedTranscript, "How many agents does the protocol cover?", 520);
assert.match(oversizedExcerpt, /50 agents/i);
assert.ok(performance.now() - oversizedStartedAt < 1_000, "oversized conversation excerpt should stay bounded");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-conversation-recall-"));
try {
  const notePath = join(vaultPath, "Memory/Conversations/test/archived-chat.md");
  await mkdir(dirname(notePath), { recursive: true });
  const filler = "We discussed ordinary errands, books, recipes, weather, and weekend plans. ".repeat(12);
  await writeFile(notePath, `---
type: conversation
title: "Archived support conversation"
startedAt: "2023-05-08T13:56:00.000Z"
tags: [conversation, support]
---
# Archived support conversation

${filler}

**User:** Caroline said she went to the LGBTQ support group yesterday evening and felt welcomed.

**Assistant:** I am glad the support group helped.
`, "utf8");
  await writeFile(join(vaultPath, "Memory/Conversations/test/separated-evidence.md"), `---
type: conversation
title: "Campaign and theater follow-up"
startedAt: "2023-05-09T13:56:00.000Z"
tags: [conversation, campaign, theater]
---
# Campaign and theater follow-up

${separatedEvidence}
`, "utf8");
  await rebuildFullVaultSearchIndex({ root: vaultPath });

  const recalled = await recallAgentMemory({
    vaultPath,
    query: "When did Caroline go to the LGBTQ support group?",
    scope: "full-vault",
    limit: 10,
    trackUsage: false,
  });
  assert.equal(recalled.hits.length, 1);
  assert.equal(recalled.hits[0].createdAt, "2023-05-08T13:56:00.000Z");
  assert.match(recalled.hits[0].excerpt, /Caroline said she went to the LGBTQ support group yesterday/i);
  // Small hit counts widen to the adaptive per-hit cap.
  assert.ok(recalled.hits[0].excerpt.length <= 4800);

  const multiSpanRecall = await recallAgentMemory({
    vaultPath,
    query: "How much was allocated for influencer marketing, and what play did I attend at the local community theater?",
    scope: "full-vault",
    limit: 10,
    trackUsage: false,
  });
  assert.equal(multiSpanRecall.hits[0].notePath, "Memory/Conversations/test/separated-evidence.md");
  assert.match(multiSpanRecall.hits[0].excerpt, /influencer marketing allocation was \$2,000/i);
  assert.match(multiSpanRecall.hits[0].excerpt, /attended The Glass Menagerie/i);
  assert.ok(multiSpanRecall.hits[0].excerpt.length <= 4800);

  // Aggregation/counting recall must reach paraphrase sessions that share no
  // vocabulary with the query ("Emma's ceremony" answers "how many weddings"),
  // while unsupported aggregation questions still return nothing.
  await writeFile(join(vaultPath, "Memory/Conversations/test/wedding-march.md"), `---
type: conversation
title: "March celebration chat"
startedAt: "2023-03-12T10:00:00.000Z"
tags: [conversation]
---
# March celebration chat

**User:** I attended Tom's wedding in March and the reception ran late.

**Assistant:** That sounds like a lovely celebration.
`, "utf8");
  await writeFile(join(vaultPath, "Memory/Conversations/test/ceremony-june.md"), `---
type: conversation
title: "June celebration chat"
startedAt: "2023-06-20T10:00:00.000Z"
tags: [conversation]
---
# June celebration chat

**User:** Emma's ceremony in June was beautiful and the toasts were heartfelt.

**Assistant:** What a memorable day for Emma.
`, "utf8");
  await rebuildFullVaultSearchIndex({ root: vaultPath });

  const aggregationRecall = await recallAgentMemory({
    vaultPath,
    query: "How many weddings have I attended this year?",
    scope: "full-vault",
    limit: 10,
    trackUsage: false,
  });
  const aggregationPaths = aggregationRecall.hits.map((hit) => hit.notePath);
  // Morphology folding: the plural query "weddings" must reach the singular
  // "wedding" session and rank it first (it matches both "wedding" and
  // "attended" while the theater session only matches "attend").
  assert.equal(aggregationPaths[0], "Memory/Conversations/test/wedding-march.md");
  assert.ok(aggregationPaths.includes("Memory/Conversations/test/wedding-march.md"),
    `term-matched session should be recalled, got: ${aggregationPaths.join(", ")}`);
  assert.ok(aggregationPaths.includes("Memory/Conversations/test/ceremony-june.md"),
    `paraphrase session should be included for aggregation queries, got: ${aggregationPaths.join(", ")}`);
  assert.ok(
    aggregationPaths.indexOf("Memory/Conversations/test/wedding-march.md") < aggregationPaths.indexOf("Memory/Conversations/test/ceremony-june.md"),
    "term-matched sessions must rank above padded paraphrase sessions",
  );

  const unsupportedAggregation = await recallAgentMemory({
    vaultPath,
    query: "How many rockets have I launched from my backyard?",
    scope: "full-vault",
    limit: 10,
    trackUsage: false,
  });
  assert.equal(unsupportedAggregation.hits.length, 0);

  const answered = await answerFromAgentMemory({
    vaultPath,
    query: "When did Caroline go to the LGBTQ support group?",
    scope: "full-vault",
    limit: 10,
    minScore: 0,
    trackUsage: false,
  });
  assert.match(answered.context, /Created: 2023-05-08T13:56:00.000Z/);
  assert.match(answered.context, /Caroline said she went to the LGBTQ support group yesterday/i);

  console.log("agent memory conversation recall: ok");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
