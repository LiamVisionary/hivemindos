import "server-only";

import { createHash } from "node:crypto";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import {
  PLUME_PROTOCOL_SOURCE,
  PLUME_TESTNET_DEPLOYMENT,
  type PlumeMarketStatus,
  type PlumeOffer,
  type PlumeOptionsSnapshot,
  type PlumeOptionsStatus,
  type PlumePosition,
} from "@/lib/config/plume-options";
import { ROBINHOOD_CHAIN_TESTNET } from "@/lib/config/robinhood-chain";
import { appendSpend } from "@/lib/services/wallet/spend-ledger";
import { evaluateSpend, loadGovernanceWallet, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { PLUME_ERC20_ABI, PLUME_FEED_ABI, PLUME_MARKET_ABI } from "./plume-options-abi";
import {
  PLUME_ACTION_CONFIRMATIONS,
  preparePlumeAction,
  type PlumeActionReview,
  type PlumeOptionAction,
} from "./plume-options-domain";
import { findSettlementRound } from "./plume-options-feed";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const MAX_DISCOVERED_OFFERS_PER_MARKET = 250n;

export const plumeTestnet = defineChain({
  id: ROBINHOOD_CHAIN_TESTNET.chainId,
  name: ROBINHOOD_CHAIN_TESTNET.name,
  nativeCurrency: ROBINHOOD_CHAIN_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [ROBINHOOD_CHAIN_TESTNET.rpcUrl] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Testnet Explorer", url: ROBINHOOD_CHAIN_TESTNET.explorerUrl },
  },
  testnet: true,
});

function publicClient() {
  return createPublicClient({
    chain: plumeTestnet,
    transport: http(PLUME_TESTNET_DEPLOYMENT.rpcUrl, { retryCount: 1, timeout: 8_000 }),
  });
}

type PlumeClient = ReturnType<typeof publicClient>;
type DeploymentMarket = (typeof PLUME_TESTNET_DEPLOYMENT.markets)[number];

export type PreparedPlumeOptionAction = PlumeActionReview & {
  marketAddress: Address;
  approvalTokenAddress?: Address;
  approvalAmountAtomic?: string;
  approvalSymbol?: string;
  approvalDecimals?: number;
  spendUsd: number;
  network: typeof ROBINHOOD_CHAIN_TESTNET.network;
  reviewFingerprint: string;
};

export type PlumeExecutionResult = {
  ok: true;
  action: PlumeActionReview["action"];
  transactionHash: Hash;
  approvalTransactionHash?: Hash;
  explorerUrl: string;
  review: PreparedPlumeOptionAction;
};

function hasCode(code: `0x${string}` | undefined) {
  return Boolean(code && code !== "0x");
}

function marketFor(symbol: string, kind: string): DeploymentMarket {
  const market = PLUME_TESTNET_DEPLOYMENT.markets.find(
    (candidate) => candidate.symbol === symbol.trim().toUpperCase() && candidate.kind === kind,
  );
  if (!market) throw new Error("This market is not present in Plume's pinned testnet registry.");
  return market;
}

async function inspectMarket(client: PlumeClient, market: DeploymentMarket): Promise<PlumeMarketStatus> {
  try {
    const [
      code,
      premiumFeeBps,
      settlementFeeBps,
      totalLocked,
      maxCollateral,
      nextOfferId,
      underlyingDecimals,
      quoteDecimals,
      feedDecimals,
      latestRound,
    ] = await Promise.all([
      client.getBytecode({ address: market.address }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "premiumFeeBps" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "settlementFeeBps" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "totalLocked" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "maxCollateral" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "nextOfferId" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "underlyingDecimals" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "quoteDecimals" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "feedDecimals" }),
      client.readContract({ address: market.feed, abi: PLUME_FEED_ABI, functionName: "latestRoundData" }),
    ]);
    const collateralDecimals = market.kind === "call" ? Number(underlyingDecimals) : Number(quoteDecimals);
    return {
      symbol: market.symbol,
      kind: market.kind,
      address: market.address,
      underlyingAddress: market.underlying,
      quoteAddress: PLUME_TESTNET_DEPLOYMENT.quote,
      feedAddress: market.feed,
      contractStatus: hasCode(code) ? "verified" : "missing-code",
      collateralUnit: market.collateralUnit,
      collateralDecimals,
      quoteDecimals: Number(quoteDecimals),
      feedDecimals: Number(feedDecimals),
      spotPrice: latestRound[1] > 0n ? formatUnits(latestRound[1], Number(feedDecimals)) : null,
      spotUpdatedAt: latestRound[3] > 0n ? new Date(Number(latestRound[3]) * 1_000).toISOString() : null,
      lockedAmount: formatUnits(totalLocked, collateralDecimals),
      maxCollateral: formatUnits(maxCollateral, collateralDecimals),
      nextOfferId: nextOfferId.toString(),
      premiumFeeBps: Number(premiumFeeBps),
      settlementFeeBps: Number(settlementFeeBps),
    };
  } catch {
    return {
      symbol: market.symbol,
      kind: market.kind,
      address: market.address,
      underlyingAddress: market.underlying,
      quoteAddress: PLUME_TESTNET_DEPLOYMENT.quote,
      feedAddress: market.feed,
      contractStatus: "unreachable",
      collateralUnit: market.collateralUnit,
      collateralDecimals: null,
      quoteDecimals: null,
      feedDecimals: null,
      spotPrice: null,
      spotUpdatedAt: null,
      lockedAmount: null,
      maxCollateral: null,
      nextOfferId: null,
      premiumFeeBps: null,
      settlementFeeBps: null,
    };
  }
}

export async function inspectPlumeOptionsStatus(): Promise<PlumeOptionsStatus> {
  const client = publicClient();
  const [rpcChainId, blockNumber, factoryVerified, markets] = await Promise.all([
    client.getChainId().catch(() => null),
    client.getBlockNumber().then(String).catch(() => null),
    client.getBytecode({ address: PLUME_TESTNET_DEPLOYMENT.factory }).then(hasCode).catch(() => false),
    Promise.all(PLUME_TESTNET_DEPLOYMENT.markets.map((market) => inspectMarket(client, market))),
  ]);
  const issues: string[] = [];
  if (rpcChainId !== PLUME_TESTNET_DEPLOYMENT.chainId) issues.push("The configured RPC did not identify as Robinhood Chain testnet 46630.");
  if (!blockNumber) issues.push("The Robinhood Chain testnet block could not be read.");
  if (!factoryVerified) issues.push("The published Plume factory bytecode could not be verified.");
  for (const market of markets) {
    if (market.contractStatus !== "verified") issues.push(`${market.symbol} ${market.kind} contract verification failed.`);
  }
  const testnetExecutionEnabled = Boolean(rpcChainId === PLUME_TESTNET_DEPLOYMENT.chainId && blockNumber && factoryVerified && markets.every((market) => market.contractStatus === "verified"));
  return {
    checkedAt: new Date().toISOString(),
    executionEnabled: testnetExecutionEnabled,
    mainnet: {
      chainId: 4663,
      status: "rollout-pending",
      executionEnabled: false,
      reason: "Plume has not published a canonical 4663 registry and completed independent audit for review.",
    },
    testnet: {
      chainId: PLUME_TESTNET_DEPLOYMENT.chainId,
      executionEnabled: testnetExecutionEnabled,
      health: issues.length === 0 ? "verified" : "degraded",
      blockNumber,
      factoryAddress: PLUME_TESTNET_DEPLOYMENT.factory,
      factoryVerified,
      explorerUrl: PLUME_TESTNET_DEPLOYMENT.explorerUrl,
      markets,
      issues,
    },
    source: PLUME_PROTOCOL_SOURCE,
  };
}

async function readSeries(
  client: PlumeClient,
  market: DeploymentMarket,
  seriesId: Hash,
  walletAddress?: Address,
): Promise<PlumePosition | null> {
  try {
    const [series, token] = await Promise.all([
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "series", args: [seriesId] }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "seriesToken", args: [seriesId] }),
    ]);
    if (series[1] === 0) return null;
    const [underlyingDecimals, quoteDecimals, feedDecimals] = await Promise.all([
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "underlyingDecimals" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "quoteDecimals" }),
      client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "feedDecimals" }),
    ]);
    const payoutDecimals = market.kind === "call" ? Number(underlyingDecimals) : Number(quoteDecimals);
    let holderBalance = 0n;
    let writerState: readonly [bigint, bigint, bigint] = [0n, 0n, 0n];
    if (walletAddress) {
      [holderBalance, writerState] = await Promise.all([
        token === ZERO_ADDRESS
          ? Promise.resolve(0n)
          : client.readContract({ address: token, abi: PLUME_ERC20_ABI, functionName: "balanceOf", args: [walletAddress] }),
        client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "writerState", args: [seriesId, walletAddress] }),
      ]);
    }
    return {
      symbol: market.symbol,
      kind: market.kind,
      marketAddress: market.address,
      seriesId,
      seriesToken: token === ZERO_ADDRESS ? null : token,
      strikePrice: formatUnits(series[0], Number(feedDecimals)),
      expiry: Number(series[1]),
      settled: series[2],
      payoutPerOption: formatUnits(series[3], payoutDecimals),
      totalOutstanding: formatUnits(series[4], 18),
      holderBalance: formatUnits(holderBalance, 18),
      writerUnassigned: formatUnits(writerState[0], 18),
      writerAssigned: formatUnits(writerState[1], 18),
      writerReclaimable: formatUnits(writerState[2], payoutDecimals),
    };
  } catch {
    return null;
  }
}

async function discoverMarket(
  client: PlumeClient,
  market: DeploymentMarket,
  status: PlumeMarketStatus,
  walletAddress?: Address,
): Promise<{ offers: PlumeOffer[]; positions: PlumePosition[] }> {
  if (status.contractStatus !== "verified" || status.nextOfferId === null) return { offers: [], positions: [] };
  const nextOfferId = BigInt(status.nextOfferId);
  const firstOfferId = nextOfferId > MAX_DISCOVERED_OFFERS_PER_MARKET ? nextOfferId - MAX_DISCOVERED_OFFERS_PER_MARKET : 1n;
  const offerIds = Array.from(
    { length: Number(nextOfferId > firstOfferId ? nextOfferId - firstOfferId : 0n) },
    (_, index) => firstOfferId + BigInt(index),
  );
  const [seriesEvents, offerRows] = await Promise.all([
    client.getContractEvents({
      address: market.address,
      abi: PLUME_MARKET_ABI,
      eventName: "SeriesCreated",
      fromBlock: BigInt(PLUME_TESTNET_DEPLOYMENT.deployBlock),
    }).catch(() => []),
    Promise.all(offerIds.map(async (offerId) => {
      try {
        const offer = await client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "offers", args: [offerId] });
        return { offerId, offer };
      } catch {
        return null;
      }
    })),
  ]);
  const seriesIds = new Set<Hash>();
  for (const event of seriesEvents) if (event.args.seriesId) seriesIds.add(event.args.seriesId);
  for (const row of offerRows) if (row && row.offer[1] !== `0x${"0".repeat(64)}`) seriesIds.add(row.offer[1]);
  const positions = (await Promise.all([...seriesIds].map((seriesId) => readSeries(client, market, seriesId, walletAddress))))
    .filter((position): position is PlumePosition => Boolean(position));
  const bySeries = new Map(positions.map((position) => [position.seriesId, position]));
  const offers = offerRows.flatMap((row): PlumeOffer[] => {
    if (!row || row.offer[0] === ZERO_ADDRESS || row.offer[3] === 0n) return [];
    const series = bySeries.get(row.offer[1]);
    if (!series) return [];
    return [{
      symbol: market.symbol,
      kind: market.kind,
      marketAddress: market.address,
      offerId: row.offerId.toString(),
      writer: row.offer[0],
      seriesId: row.offer[1],
      strikePrice: series.strikePrice,
      expiry: series.expiry,
      settled: series.settled,
      premiumPerOption: formatUnits(row.offer[2], status.quoteDecimals ?? 6),
      premiumPerOptionAtomic: row.offer[2].toString(),
      remaining: formatUnits(row.offer[3], 18),
      remainingAtomic: row.offer[3].toString(),
      ownedByWallet: Boolean(walletAddress && row.offer[0].toLowerCase() === walletAddress.toLowerCase()),
    }];
  });
  return {
    offers: offers.sort((left, right) => left.expiry - right.expiry || Number(left.offerId) - Number(right.offerId)),
    positions: positions.filter((position) =>
      Number(position.holderBalance) > 0 || Number(position.writerUnassigned) > 0 || Number(position.writerAssigned) > 0 || Number(position.writerReclaimable) > 0,
    ),
  };
}

export async function inspectPlumeOptionsSnapshot(input: { walletAddress?: string; walletNetwork?: string } = {}): Promise<PlumeOptionsSnapshot> {
  const status = await inspectPlumeOptionsStatus();
  const client = publicClient();
  const walletAddress = /^0x[a-fA-F0-9]{40}$/.test(input.walletAddress ?? "") ? input.walletAddress as Address : undefined;
  const marketSnapshots = await Promise.all(PLUME_TESTNET_DEPLOYMENT.markets.map((market, index) =>
    discoverMarket(client, market, status.testnet.markets[index], walletAddress),
  ));
  return {
    status,
    wallet: walletAddress ? { address: walletAddress, network: input.walletNetwork ?? "", canSign: Boolean(input.walletNetwork?.startsWith("eip155:")) } : null,
    offers: marketSnapshots.flatMap((snapshot) => snapshot.offers),
    positions: marketSnapshots.flatMap((snapshot) => snapshot.positions),
  };
}

async function marketContext(client: PlumeClient, market: DeploymentMarket) {
  const [underlyingDecimals, quoteDecimals, feedDecimals, latestRound] = await Promise.all([
    client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "underlyingDecimals" }),
    client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "quoteDecimals" }),
    client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "feedDecimals" }),
    client.readContract({ address: market.feed, abi: PLUME_FEED_ABI, functionName: "latestRoundData" }),
  ]);
  return { underlyingDecimals: Number(underlyingDecimals), quoteDecimals: Number(quoteDecimals), feedDecimals: Number(feedDecimals), latestRound };
}

export async function preparePlumeOptionAction(action: PlumeOptionAction): Promise<PreparedPlumeOptionAction> {
  const market = marketFor(action.symbol, action.kind);
  const client = publicClient();
  const context = await marketContext(client, market);
  let authoritativeAction = action;
  let availableOfferAmount: bigint | undefined;
  if (action.action === "buy") {
    const offerId = BigInt(action.offerId);
    const offer = await client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "offers", args: [offerId] });
    if (offer[0] === ZERO_ADDRESS || offer[3] === 0n) throw new Error(`Plume offer #${offerId} is unavailable or exhausted.`);
    availableOfferAmount = offer[3];
    authoritativeAction = { ...action, listedPremiumPerOptionAtomic: offer[2].toString() };
  }
  let review = preparePlumeAction(authoritativeAction, {
    nowSeconds: Math.floor(Date.now() / 1_000),
    feedDecimals: context.feedDecimals,
    underlyingDecimals: context.underlyingDecimals,
    quoteDecimals: context.quoteDecimals,
  });
  if (action.action === "settle" && !review.roundId) {
    const series = await client.readContract({ address: market.address, abi: PLUME_MARKET_ABI, functionName: "series", args: [review.seriesId as Hash] });
    if (series[1] === 0) throw new Error("This option series does not exist in the selected Plume market.");
    const round = await findSettlementRound(client as PublicClient, market.feed, BigInt(series[1]));
    if (!round) throw new Error("The oracle has not published a valid post-expiry settlement round yet.");
    review = { ...review, roundId: round.roundId.toString() };
  }
  if (review.action === "buy" && availableOfferAmount !== undefined && BigInt(review.amountAtomic ?? "0") > availableOfferAmount) {
    throw new Error("The requested option amount is larger than the offer's remaining amount.");
  }

  let approvalTokenAddress: Address | undefined;
  let approvalAmountAtomic: string | undefined;
  let approvalSymbol: string | undefined;
  let approvalDecimals: number | undefined;
  let spendUsd = 0;
  if (review.action === "write") {
    approvalTokenAddress = market.kind === "call" ? market.underlying : PLUME_TESTNET_DEPLOYMENT.quote;
    approvalAmountAtomic = review.collateralAtomic;
    approvalSymbol = market.kind === "call" ? market.symbol : PLUME_TESTNET_DEPLOYMENT.quoteSymbol;
    approvalDecimals = market.kind === "call" ? context.underlyingDecimals : context.quoteDecimals;
    const collateral = Number(formatUnits(BigInt(review.collateralAtomic ?? "0"), approvalDecimals));
    const spot = Number(formatUnits(context.latestRound[1], context.feedDecimals));
    spendUsd = market.kind === "call" ? collateral * spot : collateral;
  } else if (review.action === "buy") {
    approvalTokenAddress = PLUME_TESTNET_DEPLOYMENT.quote;
    approvalAmountAtomic = review.premiumAtomic;
    approvalSymbol = PLUME_TESTNET_DEPLOYMENT.quoteSymbol;
    approvalDecimals = context.quoteDecimals;
    spendUsd = Number(formatUnits(BigInt(review.premiumAtomic ?? "0"), context.quoteDecimals));
  }
  const prepared = {
    ...review,
    marketAddress: market.address,
    approvalTokenAddress,
    approvalAmountAtomic,
    approvalSymbol,
    approvalDecimals,
    spendUsd,
    network: ROBINHOOD_CHAIN_TESTNET.network,
  };
  return {
    ...prepared,
    reviewFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(prepared)).digest("hex")}`,
  };
}

function evmAccount(secret: string) {
  const compact = secret.trim().replace(/^0x/i, "");
  if (/^[a-fA-F0-9]{64}$/.test(compact)) return privateKeyToAccount(`0x${compact}`);
  const mnemonic = secret.trim().toLowerCase().replace(/\s+/g, " ");
  if (validateMnemonic(mnemonic, englishWordlist)) return mnemonicToAccount(mnemonic, { path: EVM_DERIVATION_PATH });
  throw new Error("Stored wallet secret is not an EVM private key or BIP-39 recovery phrase.");
}

async function approveIfNeeded(input: {
  client: PlumeClient;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof evmAccount>;
  review: PreparedPlumeOptionAction;
}): Promise<Hash | undefined> {
  const token = input.review.approvalTokenAddress;
  const amount = BigInt(input.review.approvalAmountAtomic ?? "0");
  if (!token || amount === 0n) return undefined;
  const allowance = await input.client.readContract({
    address: token,
    abi: PLUME_ERC20_ABI,
    functionName: "allowance",
    args: [input.account.address, input.review.marketAddress],
  });
  if (allowance >= amount) return undefined;
  const simulation = await input.client.simulateContract({
    account: input.account,
    address: token,
    abi: PLUME_ERC20_ABI,
    functionName: "approve",
    args: [input.review.marketAddress, amount],
  });
  const hash = await input.walletClient.writeContract(simulation.request);
  const receipt = await input.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Collateral or premium token approval reverted.");
  return hash;
}

async function assertPinnedTestnetReady(client: PlumeClient, marketAddress: Address) {
  const [chainId, factoryCode, marketCode] = await Promise.all([
    client.getChainId(),
    client.getBytecode({ address: PLUME_TESTNET_DEPLOYMENT.factory }),
    client.getBytecode({ address: marketAddress }),
  ]);
  if (chainId !== PLUME_TESTNET_DEPLOYMENT.chainId) throw new Error("The RPC is not Robinhood Chain testnet 46630; execution was blocked before signing.");
  if (!hasCode(factoryCode) || !hasCode(marketCode)) throw new Error("Pinned Plume contract bytecode could not be verified; execution was blocked before signing.");
}

async function writeReviewedAction(input: {
  client: PlumeClient;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof evmAccount>;
  review: PreparedPlumeOptionAction;
}): Promise<Hash> {
  const base = { account: input.account, address: input.review.marketAddress, abi: PLUME_MARKET_ABI } as const;
  if (input.review.action === "write") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "writeAndList", args: [BigInt(input.review.strikeAtomic ?? "0"), input.review.expiry ?? 0, BigInt(input.review.amountAtomic ?? "0"), BigInt(input.review.premiumPerOptionAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "buy") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "buy", args: [BigInt(input.review.offerId ?? "0"), BigInt(input.review.amountAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "cancel") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "cancelOffer", args: [BigInt(input.review.offerId ?? "0"), BigInt(input.review.amountAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "buy-to-close") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "buyToClose", args: [input.review.seriesId as Hash, BigInt(input.review.amountAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "exercise") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "exercise", args: [input.review.seriesId as Hash, BigInt(input.review.amountAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "settle") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "settle", args: [input.review.seriesId as Hash, BigInt(input.review.roundId ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "settle-worthless") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "settleWorthlessFallback", args: [input.review.seriesId as Hash] });
    return input.walletClient.writeContract(simulation.request);
  }
  if (input.review.action === "redeem") {
    const simulation = await input.client.simulateContract({ ...base, functionName: "redeem", args: [input.review.seriesId as Hash, BigInt(input.review.amountAtomic ?? "0")] });
    return input.walletClient.writeContract(simulation.request);
  }
  const simulation = await input.client.simulateContract({ ...base, functionName: "reclaim", args: [input.review.seriesId as Hash] });
  return input.walletClient.writeContract(simulation.request);
}

export async function executePlumeOptionAction(input: {
  agentId: string;
  walletAddress: string;
  walletNetwork: string;
  secret: string;
  action: PlumeOptionAction;
  confirmation?: string;
  approvalToken?: string;
  approvalThresholdSatisfied?: boolean;
  reviewFingerprint?: string;
}): Promise<PlumeExecutionResult> {
  if (!input.walletNetwork.startsWith("eip155:")) throw new Error("Plume options require a local EVM wallet.");
  const account = evmAccount(input.secret);
  if (account.address.toLowerCase() !== input.walletAddress.toLowerCase()) throw new Error("The stored signer does not match the selected wallet address.");
  const review = await preparePlumeOptionAction(input.action);
  if (!input.reviewFingerprint || input.reviewFingerprint !== review.reviewFingerprint) {
    throw new Error("The prepared option review changed or expired. Prepare the action again before signing.");
  }
  if (input.confirmation !== review.confirmation) throw new Error(`This action requires exact confirmation: ${review.confirmation}.`);

  let companyId: string | undefined;
  if (review.spendUsd > 0) {
    const persisted = await loadGovernanceWallet(input.agentId);
    const hardCap = Number(persisted?.wallet.maxTradeUsd) || 0;
    if (hardCap > 0 && review.spendUsd > hardCap + 0.01) throw new Error(`This option action locks or spends about $${review.spendUsd.toFixed(2)}, above the wallet's $${hardCap.toFixed(2)} per-trade cap.`);
    const governance = await resolveSpendGovernance(input.agentId);
    if (governance) {
      const decision = await evaluateSpend({
        wallet: governance.wallet,
        agentName: governance.agentName,
        kind: "trade",
        asset: "USDG",
        amountUsd: review.spendUsd,
        assetAmount: Number(formatUnits(BigInt(review.amountAtomic ?? "0"), 18)),
        target: `plume-options:${review.symbol} ${review.action}`,
        approvalToken: input.approvalToken,
        approvalThresholdSatisfied: input.approvalThresholdSatisfied,
        explanation: {
          summary: review.summary,
          whyNow: "A Plume option action is ready to simulate and sign on Robinhood Chain testnet.",
          impact: `The action locks or spends approximately $${review.spendUsd.toFixed(2)} in testnet assets.`,
          requestedAction: "Approve only if the symbol, option type, amount, expiry, and collateral match the reviewed action.",
          evidence: [`Network: ${ROBINHOOD_CHAIN_TESTNET.name}`, `Contract: ${review.marketAddress}`, `Confirmation: ${review.confirmation}`],
          missingContext: [],
          source: "Plume options governance",
        },
      });
      if (decision.decision !== "allow") throw new Error(decision.reason);
      companyId = decision.companyId;
    }
  }

  const client = publicClient();
  await assertPinnedTestnetReady(client, review.marketAddress);
  const walletClient = createWalletClient({ account, chain: plumeTestnet, transport: http(PLUME_TESTNET_DEPLOYMENT.rpcUrl) });
  const approvalTransactionHash = await approveIfNeeded({ client, walletClient, account, review });
  const transactionHash = await writeReviewedAction({ client, walletClient, account, review });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("The Plume option transaction was mined but reverted.");
  await appendSpend({
    agentId: input.agentId,
    companyId,
    kind: "trade",
    asset: "USDG",
    amountUsd: review.spendUsd,
    assetAmount: Number(formatUnits(BigInt(review.amountAtomic ?? "0"), 18)),
    target: `plume-options:${review.symbol} ${review.action}`,
    status: "executed",
    transactionHash,
  }).catch(() => undefined);
  return {
    ok: true,
    action: review.action,
    transactionHash,
    approvalTransactionHash,
    explorerUrl: `${PLUME_TESTNET_DEPLOYMENT.explorerUrl}/tx/${transactionHash}`,
    review,
  };
}

export { PLUME_ACTION_CONFIRMATIONS };
