import { ROBINHOOD_CHAIN_TESTNET } from "@/lib/config/robinhood-chain";

export type PlumeOptionKind = "call" | "put";
export type PlumeContractStatus = "verified" | "missing-code" | "unreachable";

export type PlumeMarketStatus = {
  symbol: string;
  kind: PlumeOptionKind;
  address: `0x${string}`;
  underlyingAddress: `0x${string}`;
  quoteAddress: `0x${string}`;
  feedAddress: `0x${string}`;
  contractStatus: PlumeContractStatus;
  collateralUnit: string;
  collateralDecimals: number | null;
  quoteDecimals: number | null;
  feedDecimals: number | null;
  spotPrice: string | null;
  spotUpdatedAt: string | null;
  lockedAmount: string | null;
  maxCollateral: string | null;
  nextOfferId: string | null;
  premiumFeeBps: number | null;
  settlementFeeBps: number | null;
};

export type PlumeOffer = {
  symbol: string;
  kind: PlumeOptionKind;
  marketAddress: `0x${string}`;
  offerId: string;
  writer: `0x${string}`;
  seriesId: `0x${string}`;
  strikePrice: string;
  expiry: number;
  settled: boolean;
  premiumPerOption: string;
  premiumPerOptionAtomic: string;
  remaining: string;
  remainingAtomic: string;
  ownedByWallet: boolean;
};

export type PlumePosition = {
  symbol: string;
  kind: PlumeOptionKind;
  marketAddress: `0x${string}`;
  seriesId: `0x${string}`;
  seriesToken: `0x${string}` | null;
  strikePrice: string;
  expiry: number;
  settled: boolean;
  payoutPerOption: string;
  totalOutstanding: string;
  holderBalance: string;
  writerUnassigned: string;
  writerAssigned: string;
  writerReclaimable: string;
};

export type PlumeOptionsStatus = {
  checkedAt: string;
  executionEnabled: boolean;
  mainnet: {
    chainId: 4663;
    status: "rollout-pending";
    executionEnabled: false;
    reason: string;
  };
  testnet: {
    chainId: 46630;
    executionEnabled: boolean;
    health: "verified" | "degraded";
    blockNumber: string | null;
    factoryAddress: `0x${string}`;
    factoryVerified: boolean;
    explorerUrl: string;
    markets: PlumeMarketStatus[];
    issues: string[];
  };
  source: typeof PLUME_PROTOCOL_SOURCE;
};

export type PlumeOptionsSnapshot = {
  status: PlumeOptionsStatus;
  wallet: {
    address: `0x${string}`;
    network: string;
    canSign: boolean;
  } | null;
  offers: PlumeOffer[];
  positions: PlumePosition[];
};

/**
 * Plume's public testnet registry, pinned to the exact upstream revision we
 * reviewed. Mainnet execution must not reuse these addresses.
 */
export const PLUME_PROTOCOL_SOURCE = {
  repositoryUrl: "https://github.com/PlumeTrade/Plume",
  docsUrl: "https://www.plume.trade/docs",
  commit: "48782a23278ff07c065b1420a827d1a4661853e8",
  registryUrl:
    "https://github.com/PlumeTrade/Plume/blob/48782a23278ff07c065b1420a827d1a4661853e8/deployments/46630.json",
  mainnetStatus: "rollout-pending",
  auditStatus: "in-progress",
  jurisdictionRestrictions: ["United States", "Canada", "United Kingdom", "Switzerland"],
} as const;

export const PLUME_TESTNET_DEPLOYMENT = {
  chainId: ROBINHOOD_CHAIN_TESTNET.chainId,
  rpcUrl: ROBINHOOD_CHAIN_TESTNET.rpcUrl,
  explorerUrl: ROBINHOOD_CHAIN_TESTNET.explorerUrl,
  factory: "0xe62f181563e413bfc8e8eb8a55dc44d47fd8a88b",
  quote: "0xbf3a48af8645e2dafd67070204c7e9403edff9e9",
  quoteSymbol: "USDG",
  deployBlock: 88_805_024,
  markets: [
    {
      symbol: "TSLA",
      kind: "call",
      address: "0xD1E3aFaeCaA514A33eeCF6F8781432c655873226",
      underlying: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
      feed: "0x2a70add445b877583b3354e9014387d966d95e57",
      collateralUnit: "TSLA",
    },
    {
      symbol: "TSLA",
      kind: "put",
      address: "0xe62c047878110A088C0313AF344F1aA37e3d6315",
      underlying: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
      feed: "0x2a70add445b877583b3354e9014387d966d95e57",
      collateralUnit: "USDG",
    },
    {
      symbol: "AMD",
      kind: "call",
      address: "0xd6CB0D1E4eFb5E862Eb89024b75dd76519525ffb",
      underlying: "0x71178BAc73cBeb415514eB542a8995b82669778d",
      feed: "0x2a70add445b877583b3354e9014387d966d95e57",
      collateralUnit: "AMD",
    },
    {
      symbol: "AMD",
      kind: "put",
      address: "0x44aFc68ef17799683F044EFDd0021a9E78d200be",
      underlying: "0x71178BAc73cBeb415514eB542a8995b82669778d",
      feed: "0x2a70add445b877583b3354e9014387d966d95e57",
      collateralUnit: "USDG",
    },
  ],
} as const;
