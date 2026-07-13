import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { deriveFreeMeter } from "../src/features/dashboard/views/chat/hivemindos-free-meter.ts";

const route = await readFile(new URL("../src/app/api/hivemindos/models/chat/completions/route.ts", import.meta.url), "utf8");
const allowance = await readFile(new URL("../src/lib/services/hivemindos-free-allowance.ts", import.meta.url), "utf8");
const stakingDocs = await readFile(new URL("../docs/for-investors/hive-staking-and-community-tiers.md", import.meta.url), "utf8");

assert.equal(
  (route.match(/getHoneyWorkspaceId\(\)\.catch\(\(\) => ""\)/g) ?? []).length,
  2,
  "workspace identity failures should preserve the base Scout path",
);
assert.match(route, /"X-HivemindOS-Free-Workspace": workspaceId/g, "GET and POST should send the workspace capability");
assert.equal((route.match(/"X-HivemindOS-Free-Workspace": workspaceId/g) ?? []).length, 2);
assert.match(route, /x-hivemindos-free-quota-multiplier-bps/, "the proxy should forward the hosted multiplier");
assert.match(allowance, /quotaMultiplierBps: number \| null/, "the allowance snapshot should persist the verified multiplier");
for (const term of ["1.10×", "1.20×", "1.35×", "1.50×", "1.75×", "2.00×"]) {
  assert.ok(stakingDocs.includes(term), `staking docs should publish Scout quota tier ${term}`);
}
assert.match(stakingDocs, /cannot be transferred, redeemed, withdrawn, sold, or converted/i);
assert.match(stakingDocs, /IP and platform-wide safety limits remain unchanged/i);

const queenSnapshot = {
  remainingRequests: 799,
  remainingTokens: 1_999_000,
  resetAt: "2026-07-14T00:00:00.000Z",
  observedAt: "2026-07-13T12:00:00.000Z",
  highWaterRequests: 799,
  highWaterTokens: 1_999_000,
  stakeTierId: "visionary",
  stakeTierLabel: "Queen Bee",
  quotaMultiplierBps: 20_000,
};
assert.deepEqual(
  deriveFreeMeter(queenSnapshot, Date.parse("2026-07-13T12:00:01.000Z")),
  {
    fraction: 1,
    label: "799 requests · 2M tokens left today · Queen Bee 2× stake quota",
    exhausted: false,
  },
);

const baseSnapshot = {
  ...queenSnapshot,
  remainingRequests: 399,
  remainingTokens: 999_000,
  highWaterRequests: 399,
  highWaterTokens: 999_000,
  stakeTierId: null,
  stakeTierLabel: null,
  quotaMultiplierBps: 10_000,
};
assert.equal(
  deriveFreeMeter(baseSnapshot, Date.parse("2026-07-13T12:00:01.000Z"))?.label,
  "399 requests · 999k tokens left today",
  "unstaked users retain the existing meter and allowance semantics",
);

console.log("Swarm Scout staking quota client contract passed.");
