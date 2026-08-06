#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./token-edge/onchain-independent-frames.mjs";

const hourMs = 60 * 60_000;
const items = [
  fixture("2026-08-03T01:00:00.000Z", "solana:TokenA", -20),
  fixture("2026-08-03T01:10:00.000Z", "solana:TokenA", -5),
  fixture("2026-08-03T01:10:00.000Z", "solana:TokenB", 10),
  fixture("2026-08-03T02:00:00.000Z", "solana:TokenA", 15),
];
const frames = independentAssetFrames(items, {
  durationMs: hourMs,
  timestamp: (row) => Date.parse(row.createdAt),
  assetKey: (row) => row.asset,
});

assert.equal(frames.length, 2);
assert.deepEqual(frames[0].map((row) => [row.asset, row.returnPct]), [
  ["solana:TokenA", -20],
  ["solana:TokenB", 10],
]);
assert.deepEqual(frames[1].map((row) => [row.asset, row.returnPct]), [
  ["solana:TokenA", 15],
]);
assert.equal(overlappingAssetSignalCount(items, frames), 1);
assert.notEqual(
  tokenEdgeAssetKey({ chain: "solana", tokenAddress: "CaseSensitiveMint" }),
  tokenEdgeAssetKey({ chain: "solana", tokenAddress: "casesensitivemint" }),
);
assert.equal(
  tokenEdgeAssetKey({ chain: "ethereum", tokenAddress: "0xAbC" }),
  tokenEdgeAssetKey({ chain: "ETHEREUM", tokenAddress: "0xabc" }),
);

console.log("token-edge independent asset-frame checks passed.");

function fixture(createdAt, asset, returnPct) {
  return { createdAt, asset, returnPct };
}
