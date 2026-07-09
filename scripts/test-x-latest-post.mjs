#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  formatLatestXPostReply,
  isLatestOwnXPostRequest,
  latestOwnXPostFromXurl,
  parseXurlIdentity,
  parseXurlTimeline,
} = await import("../src/lib/services/x-latest-post.ts");

assert.equal(isLatestOwnXPostRequest("grab my latest x post"), true);
assert.equal(isLatestOwnXPostRequest("what's the latest thing I posted on Twitter?"), true);
assert.equal(isLatestOwnXPostRequest("find the latest post about caching"), false);
assert.equal(isLatestOwnXPostRequest("post this on X"), false);

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
  ],
};
assert.deepEqual(parseXurlTimeline(timelineFixture, "0xLiamVisionary"), {
  id: "2075254211223404810",
  text: "the new fleet graph view + local text-to-speech",
  createdAt: "2026-07-09T16:22:14.000Z",
  username: "0xLiamVisionary",
  url: "https://x.com/0xLiamVisionary/status/2075254211223404810",
});

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

console.log("exact latest-X timeline contract ok");
