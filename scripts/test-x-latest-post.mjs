#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  formatLatestXCommentReply,
  formatLatestXPostReply,
  latestCommentOnOwnLatestXPostFromXurl,
  latestOwnXPostFromXurl,
  parseXurlIdentity,
  parseXurlLatestReply,
  parseXurlTimeline,
  parseXurlTimelinePosts,
  runXAccountReadTool,
} = await import("../src/lib/services/x-latest-post.ts");
const {
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  X_ACCOUNT_READ_OPERATIONS,
  X_ACCOUNT_READ_TOOL_DEF,
} = await import(
  "../src/lib/services/x-account-tool-contract.ts"
);

assert.ok(X_ACCOUNT_READ_OPERATIONS.includes("own_posts"));
assert.match(X_ACCOUNT_CAPABILITY_INSTRUCTION, /latest_post only when exactly the newest post/i);
assert.match(X_ACCOUNT_CAPABILITY_INSTRUCTION, /own_posts for any ordinal, rank, count/i);
assert.match(
  X_ACCOUNT_READ_TOOL_DEF.parameters.properties.operation.description,
  /another rank, an ordinal, multiple posts/i,
);

const identityFixture = {
  data: { id: "123456789", name: "Liam", username: "0xLiamVisionary" },
};
assert.deepEqual(parseXurlIdentity(identityFixture), {
  id: "123456789",
  username: "0xLiamVisionary",
});

const timelineFixture = {
  data: [
    {
      id: "2075254211223404810",
      text: "the new fleet graph view + local text-to-speech",
      created_at: "2026-07-09T16:22:14.000Z",
    },
    {
      id: "2075092802988564904",
      text: "how did it happen? ZHC in @TheHivemindOS operates 24/7 unless you pause it.",
      created_at: "2026-07-09T05:40:52.000Z",
    },
  ],
};
const repliesFixture = {
  data: [
    {
      id: "2075268412742242584",
      text: "@0xLiamVisionary Looks amazing good job",
      author_id: "1360604470699307009",
      conversation_id: "2075254211223404810",
      created_at: "2026-07-09T17:18:40.000Z",
      referenced_tweets: [{ id: "2075254211223404810", type: "replied_to" }],
    },
  ],
  includes: {
    users: [
      { id: "1360604470699307009", name: "Lukisbmw", username: "lukisbmw" },
    ],
  },
};
assert.deepEqual(parseXurlTimeline(timelineFixture, "0xLiamVisionary"), {
  id: "2075254211223404810",
  text: "the new fleet graph view + local text-to-speech",
  createdAt: "2026-07-09T16:22:14.000Z",
  username: "0xLiamVisionary",
  url: "https://x.com/0xLiamVisionary/status/2075254211223404810",
});
assert.deepEqual(
  parseXurlTimelinePosts(timelineFixture, "0xLiamVisionary").map((post) => post.id),
  ["2075254211223404810", "2075092802988564904"],
);
assert.deepEqual(
  parseXurlLatestReply(repliesFixture, {
    conversationId: "2075254211223404810",
    ownUserId: "123456789",
  }),
  {
    id: "2075268412742242584",
    text: "@0xLiamVisionary Looks amazing good job",
    createdAt: "2026-07-09T17:18:40.000Z",
    authorId: "1360604470699307009",
    authorName: "Lukisbmw",
    authorUsername: "lukisbmw",
    url: "https://x.com/lukisbmw/status/2075268412742242584",
  },
);

const calls = [];
const result = await latestOwnXPostFromXurl({
  runXurl: async (args) => {
    calls.push(args);
    if (args[0] === "whoami") return identityFixture;
    return timelineFixture;
  },
});
assert.equal(result?.id, "2075254211223404810");
assert.deepEqual(calls[0], ["whoami"]);
assert.equal(calls[1].length, 1);
assert.match(calls[1][0], /^\/2\/users\/123456789\/tweets\?/);
assert.match(calls[1][0], /exclude=retweets,replies/);
assert.match(calls[1][0], /tweet.fields=created_at/);
assert.doesNotMatch(calls[1][0], /token|verbose|secret/i);

const reply = formatLatestXPostReply(result);
assert.match(reply, /the new fleet graph view/);
assert.match(reply, /https:\/\/x\.com\/0xLiamVisionary\/status\/2075254211223404810/);

const commentCalls = [];
const commentResult = await latestCommentOnOwnLatestXPostFromXurl({
  runXurl: async (args) => {
    commentCalls.push(args);
    if (args[0] === "whoami") return identityFixture;
    if (args[0].startsWith("/2/users/")) return timelineFixture;
    return repliesFixture;
  },
});
assert.equal(commentResult?.post.id, "2075254211223404810");
assert.equal(commentResult?.reply?.id, "2075268412742242584");
assert.equal(commentCalls.length, 3);
assert.match(commentCalls[2][0], /^\/2\/tweets\/search\/recent\?/);
assert.match(commentCalls[2][0], /conversation_id%3A2075254211223404810/);
assert.match(commentCalls[2][0], /-from%3A0xLiamVisionary/);
assert.match(commentCalls[2][0], /sort_order=recency/);

const commentReply = formatLatestXCommentReply(commentResult);
assert.match(commentReply, /@lukisbmw/);
assert.match(commentReply, /Looks amazing good job/);
assert.match(commentReply, /2075268412742242584/);

const toolLatestReply = await runXAccountReadTool(
  { operation: "latest_reply_to_latest_post" },
  {
    runXurl: async (args) => {
      if (args[0] === "whoami") return identityFixture;
      if (args[0].startsWith("/2/users/")) return timelineFixture;
      return repliesFixture;
    },
  },
);
assert.match(toolLatestReply, /@lukisbmw/);
assert.match(toolLatestReply, /Looks amazing good job/);

const ownPostCalls = [];
const ownPostsPayload = await runXAccountReadTool(
  { operation: "own_posts", limit: 2 },
  {
    runXurl: async (args) => {
      ownPostCalls.push(args);
      if (args[0] === "whoami") return identityFixture;
      return timelineFixture;
    },
  },
);
assert.deepEqual(ownPostCalls[0], ["whoami"]);
assert.match(ownPostCalls[1][0], /max_results=5/);
const ownPosts = JSON.parse(ownPostsPayload);
assert.deepEqual(ownPosts.data.map((post) => post.id), [
  "2075254211223404810",
  "2075092802988564904",
]);

const beforeCalls = [];
const beforePayload = await runXAccountReadTool(
  {
    operation: "own_posts",
    beforePostId: "https://x.com/0xLiamVisionary/status/2075254211223404810",
    limit: 1,
  },
  {
    runXurl: async (args) => {
      beforeCalls.push(args);
      if (args[0] === "whoami") return identityFixture;
      return { data: [timelineFixture.data[1]] };
    },
  },
);
assert.match(beforeCalls[1][0], /until_id=2075254211223404810/);
const beforePosts = JSON.parse(beforePayload);
assert.deepEqual(beforePosts.data.map((post) => post.id), ["2075092802988564904"]);

const searchCalls = [];
const toolSearch = await runXAccountReadTool(
  { operation: "search", query: "from:0xLiamVisionary caching", limit: 7 },
  {
    runXurl: async (args) => {
      searchCalls.push(args);
      return { data: [{ id: "42", text: "cache post" }] };
    },
  },
);
assert.deepEqual(searchCalls, [["search", "from:0xLiamVisionary caching", "-n", "10"]]);
assert.match(toolSearch, /cache post/);

const listCalls = [];
for (const [operation, limit, expected] of [
  ["mentions", 1, "5"],
  ["search", 1, "10"],
  ["timeline", 1, "1"],
]) {
  await runXAccountReadTool(
    operation === "search"
      ? { operation, query: "cache", limit }
      : { operation, limit },
    {
      runXurl: async (args) => {
        listCalls.push(args);
        return { data: [] };
      },
    },
  );
  assert.equal(listCalls.at(-1)?.at(-1), expected);
}

await assert.rejects(
  () => runXAccountReadTool({ operation: "search", query: "", limit: 5 }),
  /search query/i,
);

console.log("X account tool contract ok");
