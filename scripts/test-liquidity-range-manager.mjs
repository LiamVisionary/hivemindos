import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const fixtureRoot = await mkdtemp(join(tmpdir(), "hivemindos-liquidity-range-"));
process.env.LIQUIDITY_RANGE_CONFIG_FILE = join(fixtureRoot, "config.json");
process.env.LIQUIDITY_RANGE_STATE_FILE = join(fixtureRoot, "state.json");

const types = await import("../src/lib/types/liquidity-range-manager.ts");
const viem = await import("viem");
const policy = await import("../src/lib/services/trading/liquidity-range-policy.ts");
const onchain = await import("../src/lib/services/trading/liquidity-range-onchain.ts");
const paper = await import("../src/lib/services/trading/liquidity-range-paper.ts");
const store = await import("../src/lib/services/trading/liquidity-range-store.ts");
const engine = await import("../src/lib/services/trading/liquidity-range-engine.ts");

function config(overrides = {}) {
  return { ...types.defaultLiquidityRangeConfig({ id: "range-test", tokenId: "42" }), ...overrides };
}

function snapshot(overrides = {}) {
  return {
    network: "eip155:8453",
    protocol: "uniswap-v3",
    tokenId: "42",
    owner: `0x${"1".repeat(40)}`,
    positionManagerAddress: `0x${"2".repeat(40)}`,
    factoryAddress: `0x${"3".repeat(40)}`,
    poolAddress: `0x${"4".repeat(40)}`,
    token0: { address: `0x${"5".repeat(40)}`, symbol: "WETH", decimals: 18 },
    token1: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
    fee: 500,
    feePercent: 0.05,
    tickSpacing: 10,
    currentTick: 0,
    tickLower: -200,
    tickUpper: 200,
    liquidity: "1000000000000000000",
    tokensOwed0: "0",
    tokensOwed1: "0",
    currentPrice: 1,
    lowerPrice: 0.98,
    upperPrice: 1.02,
    amount0: 1,
    amount1: 1,
    positionValueUsd: 10_000,
    quoteLabel: "USDC per WETH",
    blockNumber: "123",
    observedAt: 1_000,
    ...overrides,
  };
}

test("in-range positions hold while comfortably outside the trigger buffer", () => {
  const decision = policy.evaluateLiquidityRangePolicy({
    config: config({ triggerBufferBps: 25 }),
    currentTick: 0,
    tickLower: -500,
    tickUpper: 500,
    tickSpacing: 10,
    positionValueUsd: 10_000,
    lastRebalancedAt: null,
    now: 1_000,
  });
  assert.equal(decision.status, "in-range");
  assert.equal(decision.action, "hold");
  assert.equal(decision.expectedRecoveredFeesUsd, 0);
});

test("out-of-range positions propose only when modeled net benefit clears costs", () => {
  const decision = policy.evaluateLiquidityRangePolicy({
    config: config({ feeAprPct: 50, evaluationHorizonDays: 7, gasCostUsd: 1, estimatedIlCostUsd: 2, minNetBenefitUsd: 3 }),
    currentTick: 250,
    tickLower: -200,
    tickUpper: 200,
    tickSpacing: 10,
    positionValueUsd: 10_000,
    lastRebalancedAt: null,
    now: 1_000,
  });
  assert.equal(decision.status, "out-of-range");
  assert.equal(decision.action, "propose-rebalance");
  assert.equal(decision.economicGatePassed, true);
  assert.equal(decision.targetTickLower % 10, 0);
  assert.equal(decision.targetTickUpper % 10, 0);
  assert(decision.expectedNetBenefitUsd > 90);
});

test("unknown USD value and active cooldown both fail closed", () => {
  const unknownValue = policy.evaluateLiquidityRangePolicy({
    config: config(), currentTick: 250, tickLower: -200, tickUpper: 200, tickSpacing: 10,
    positionValueUsd: null, lastRebalancedAt: null, now: 10_000,
  });
  assert.equal(unknownValue.action, "watch");
  assert.equal(unknownValue.economicGatePassed, false);

  const cooldown = policy.evaluateLiquidityRangePolicy({
    config: config({ minHoursBetweenRebalances: 6, feeAprPct: 100 }),
    currentTick: 250, tickLower: -200, tickUpper: 200, tickSpacing: 10,
    positionValueUsd: 50_000, lastRebalancedAt: 9_000, now: 10_000,
  });
  assert.equal(cooldown.action, "watch");
  assert(cooldown.cooldownRemainingMs > 0);
});

test("paper ledger marks LP inventory, accrues modeled in-range fees, and preserves a HODL baseline", () => {
  const configured = config({ feeAprPct: 36.5, gasCostUsd: 0.05, estimatedIlCostUsd: 0.05 });
  const initial = paper.markLiquidityRangePaperState({
    previous: null,
    config: configured,
    snapshot: snapshot({ positionValueUsd: 10_000 }),
    tickLower: -200,
    tickUpper: 200,
    now: 1_000,
  });
  assert(initial);
  assert.equal(initial.initialUsd, 10_000);
  assert.equal(initial.normalizedReturnPct, 0);
  assert.equal(initial.modeledFeesUsd, 0);

  const next = paper.markLiquidityRangePaperState({
    previous: initial,
    config: configured,
    snapshot: snapshot({ positionValueUsd: 10_000, observedAt: 86_401_000 }),
    tickLower: -200,
    tickUpper: 200,
    now: 86_401_000,
  });
  assert(next);
  assert(Math.abs(next.modeledFeesUsd - 10) < 0.01);
  assert.equal(next.rebalanceCount, 0);
  assert(Number.isFinite(next.hodlUsd));
});

test("paper rebalance deducts modeled costs and changes only virtual inventory", () => {
  const configured = config({ feeAprPct: 0, gasCostUsd: 1, estimatedIlCostUsd: 2 });
  const initial = paper.markLiquidityRangePaperState({
    previous: null,
    config: configured,
    snapshot: snapshot({ positionValueUsd: 10_000 }),
    tickLower: -200,
    tickUpper: 200,
    now: 1_000,
  });
  assert(initial);
  const decision = policy.evaluateLiquidityRangePolicy({
    config: config({ feeAprPct: 100, gasCostUsd: 1, estimatedIlCostUsd: 2, minNetBenefitUsd: 1 }),
    currentTick: 300,
    tickLower: -200,
    tickUpper: 200,
    tickSpacing: 10,
    positionValueUsd: initial.totalUsd,
    lastRebalancedAt: null,
    now: 2_000,
  });
  assert.equal(decision.action, "propose-rebalance");
  const rebalanced = paper.applyLiquidityRangePaperDecision({
    state: initial,
    config: configured,
    snapshot: snapshot({ currentTick: 300, positionValueUsd: 10_000 }),
    decision,
    now: 2_000,
  });
  assert.equal(rebalanced.rebalanceCount, 1);
  assert.equal(rebalanced.cumulativeRebalanceCostsUsd, 3);
  assert.equal(rebalanced.tickLower, decision.targetTickLower);
  assert.equal(rebalanced.tickUpper, decision.targetTickUpper);
  assert.equal(rebalanced.lastRebalancedAt, 2_000);
  assert(Math.abs(rebalanced.totalUsd - (initial.totalUsd - 3)) < 0.01);
  assert.doesNotMatch(JSON.stringify(rebalanced), /transactionHash|calldata|privateKey|signature/i);
});

test("position reads retry one complete snapshot after a transient RPC failure", async () => {
  const owner = `0x${"1".repeat(40)}`;
  const weth = "0x4200000000000000000000000000000000000006";
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const pool = `0x${"4".repeat(40)}`;
  let positionsCalls = 0;
  const client = {
    getBlockNumber: async () => 123n,
    readContract: async ({ address, functionName }) => {
      if (functionName === "positions") {
        positionsCalls += 1;
        if (positionsCalls === 1) {
          throw new viem.HttpRequestError({ url: "https://rpc.invalid", cause: new Error("fetch failed") });
        }
        return [0n, `0x${"0".repeat(40)}`, weth, usdc, 500, -201240, -200830, 123456n, 0n, 0n, 0n, 0n];
      }
      if (functionName === "ownerOf") return owner;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") return [0n, -201000, 0, 0, 0, 0, true];
      if (functionName === "tickSpacing") return 10;
      if (functionName === "symbol") return String(address).toLowerCase() === weth.toLowerCase() ? "WETH" : "USDC";
      if (functionName === "decimals") return String(address).toLowerCase() === weth.toLowerCase() ? 18 : 6;
      throw new Error(`Unexpected contract read: ${functionName}`);
    },
  };

  const result = await onchain.readBaseUniswapV3Position("5709769", client);
  assert.equal(positionsCalls, 2);
  assert.equal(result.owner.toLowerCase(), owner.toLowerCase());
  assert.equal(result.poolAddress.toLowerCase(), pool.toLowerCase());
  assert.equal(result.currentTick, -201000);
});

test("position reads do not retry deterministic contract failures", async () => {
  let positionsCalls = 0;
  const client = {
    getBlockNumber: async () => 123n,
    readContract: async ({ functionName }) => {
      if (functionName === "positions") positionsCalls += 1;
      throw new Error("position does not exist");
    },
  };
  await assert.rejects(() => onchain.readBaseUniswapV3Position("5709769", client), /position does not exist/);
  assert.equal(positionsCalls, 1);
});

test("store clamps config and permanently forces shadow mode", async () => {
  const saved = await store.upsertLiquidityRangeConfig({
    ...config(),
    mode: "live",
    pollIntervalMs: 1,
    targetWidthBps: 999_999,
  });
  assert.equal(saved.mode, "shadow");
  assert.equal(saved.pollIntervalMs, 30_000);
  assert.equal(saved.targetWidthBps, 10_000);
  const disk = JSON.parse(await readFile(process.env.LIQUIDITY_RANGE_CONFIG_FILE, "utf8"));
  assert.equal(disk.configs[0].mode, "shadow");
});

test("engine turns a qualifying proposal into a virtual range without transaction fields", async () => {
  const saved = await store.upsertLiquidityRangeConfig({
    ...config({ enabled: true, feeAprPct: 100, gasCostUsd: 0.1, minNetBenefitUsd: 1 }),
    id: "engine-shadow",
  });
  const state = await engine.runLiquidityRangeConfig(saved, {
    readPosition: async () => snapshot({ currentTick: 300, tickLower: -200, tickUpper: 200 }),
    now: () => 50_000,
  });
  assert.equal(state.lastDecision.action, "propose-rebalance");
  assert(state.shadowRange);
  assert.equal(state.lastRebalancedAt, 50_000);
  assert.equal(state.events.at(-1).kind, "shadow-rebalance");
  assert.equal(state.paper.rebalanceCount, 1);
  assert.equal(state.paper.cumulativeRebalanceCostsUsd, saved.gasCostUsd + saved.estimatedIlCostUsd);
  assert.doesNotMatch(JSON.stringify(state), /transactionHash|calldata|privateKey|signature/i);
});

test("daemon and engine source have no signer or transaction submission path", async () => {
  const [engineSource, paperSource, daemonSource, installerSource] = await Promise.all([
    readFile(new URL("../src/lib/services/trading/liquidity-range-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/services/trading/liquidity-range-paper.ts", import.meta.url), "utf8"),
    readFile(new URL("./liquidity-range-manager-daemon.mjs", import.meta.url), "utf8"),
    readFile(new URL("./install-liquidity-range-manager.sh", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(`${engineSource}\n${paperSource}\n${daemonSource}\n${installerSource}`, /getWalletSecret|resolveEvmSigningAccount|sendTransaction|writeContract|private.?key/i);
  assert.match(installerSource, /if \[\[ "\$\{1:-\}" == "uninstall" \]\]/);
  assert.match(installerSource, /rm -f "\$BUNDLE"/);
  assert.match(installerSource, /for attempt in 1 2 3/);
  assert.match(installerSource, /launchctl bootstrap "\$domain" "\$plist"/);
});

test("API authenticates first, rejects malformed NFT ids, and uses canonical responses", async () => {
  const source = await readFile(new URL("../src/app/api/trading/liquidity-range/route.ts", import.meta.url), "utf8");
  assert.match(source, /const unauthorized = await requireAuth\(request\)/);
  assert.match(source, /Position NFT ID must be a positive uint256 integer/);
  assert.match(source, /okJson|errorJson|upstreamErrorJson/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|private.?key/i);
});

test.after(async () => {
  await engine.stopLiquidityRangeEngine().catch(() => undefined);
  await rm(fixtureRoot, { recursive: true, force: true });
});
