import type { PublicClient } from "viem";

import { PLUME_FEED_ABI } from "./plume-options-abi";

// Settlement search is adapted from Plume's MIT-licensed script/lib/feed.ts
// at the registry commit pinned in plume-options.ts/config.

type Address = `0x${string}`;

export type PlumeFeedRound = {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
};

const PHASE_OFFSET = 64n;
const AGGREGATOR_ROUND_MASK = (1n << PHASE_OFFSET) - 1n;

function phaseOf(roundId: bigint) {
  return roundId >> PHASE_OFFSET;
}

function aggregatorRoundOf(roundId: bigint) {
  return roundId & AGGREGATOR_ROUND_MASK;
}

function proxyRoundId(phase: bigint, round: bigint) {
  return (phase << PHASE_OFFSET) | round;
}

async function tryRound(client: PublicClient, feed: Address, roundId: bigint): Promise<PlumeFeedRound | undefined> {
  try {
    const [id, answer, , updatedAt] = await client.readContract({
      address: feed,
      abi: PLUME_FEED_ABI,
      functionName: "getRoundData",
      args: [roundId],
    });
    if (updatedAt === 0n) return undefined;
    return { roundId: id, answer, updatedAt };
  } catch {
    return undefined;
  }
}

async function latestRound(client: PublicClient, feed: Address): Promise<PlumeFeedRound> {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: PLUME_FEED_ABI,
    functionName: "latestRoundData",
  });
  return { roundId, answer, updatedAt };
}

async function phaseTail(client: PublicClient, feed: Address, phase: bigint): Promise<PlumeFeedRound | undefined> {
  let low = 1n;
  let high = 2n;
  let last = await tryRound(client, feed, proxyRoundId(phase, low));
  if (!last) return undefined;
  while (await tryRound(client, feed, proxyRoundId(phase, high))) {
    low = high;
    high *= 2n;
    if (high > 1n << 40n) break;
  }
  while (low <= high) {
    const middle = (low + high) / 2n;
    const candidate = await tryRound(client, feed, proxyRoundId(phase, middle));
    if (candidate) {
      last = candidate;
      low = middle + 1n;
    } else {
      high = middle - 1n;
    }
  }
  return last;
}

/** Earliest oracle print at or after expiry, matching Plume's settlement rule. */
export async function findSettlementRound(client: PublicClient, feed: Address, expiry: bigint): Promise<PlumeFeedRound | undefined> {
  const latest = await latestRound(client, feed);
  if (latest.updatedAt < expiry) return undefined;

  // Testnet's MockFeed uses plain sequential ids (phase zero).
  if (phaseOf(latest.roundId) === 0n) {
    let low = 1n;
    let high = latest.roundId;
    let best: PlumeFeedRound | undefined;
    while (low <= high) {
      const middle = (low + high) / 2n;
      const candidate = await tryRound(client, feed, middle);
      if (!candidate || candidate.updatedAt < expiry) low = middle + 1n;
      else {
        best = candidate;
        high = middle - 1n;
      }
    }
    return best;
  }

  let phase = phaseOf(latest.roundId);
  let upperRound = aggregatorRoundOf(latest.roundId);
  while (phase > 1n) {
    const first = await tryRound(client, feed, proxyRoundId(phase, 1n));
    if (!first || first.updatedAt < expiry) break;
    const previous = await phaseTail(client, feed, phase - 1n);
    if (!previous || previous.updatedAt < expiry) return first;
    phase -= 1n;
    upperRound = aggregatorRoundOf(previous.roundId);
  }

  let low = 1n;
  let high = phase === phaseOf(latest.roundId) ? upperRound : aggregatorRoundOf((await phaseTail(client, feed, phase))?.roundId ?? 0n);
  let best: PlumeFeedRound | undefined;
  while (low <= high) {
    const middle = (low + high) / 2n;
    const candidate = await tryRound(client, feed, proxyRoundId(phase, middle));
    if (!candidate || candidate.updatedAt < expiry) low = middle + 1n;
    else {
      best = candidate;
      high = middle - 1n;
    }
  }
  return best;
}
