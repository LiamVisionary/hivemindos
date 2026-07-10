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

assert.equal(conversationMemoryExcerptBudget("What snapper dish has fruit in it?"), 520);
assert.equal(conversationMemoryExcerptBudget("What Jamaican dish did you recommend with snapper and fruit?"), 520);
assert.equal(conversationMemoryExcerptBudget("Summarize how my rental-property decisions developed over time"), 800);
assert.equal(conversationMemoryExcerptBudget("How many projects did I work on across all sessions?"), 800);

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
  assert.ok(recalled.hits[0].excerpt.length <= 800);

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
  assert.ok(multiSpanRecall.hits[0].excerpt.length <= 800);

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
