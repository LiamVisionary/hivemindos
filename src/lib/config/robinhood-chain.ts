/**
 * Robinhood Chain stock-token metadata for the governed stock-trade rail.
 *
 * Source of truth: Robinhood Chain documentation, "Connecting to Robinhood
 * Chain" and "Token Contracts", checked 2026-07-02. These addresses are a hard
 * allowlist: a matching ticker at any other contract address is not a canonical
 * Robinhood Stock Token.
 */

export const ROBINHOOD_CHAIN_NETWORK = "eip155:4663" as const;
export const ROBINHOOD_CHAIN_TESTNET_NETWORK = "eip155:46630" as const;

export const ROBINHOOD_CHAIN = {
  name: "Robinhood Chain",
  network: ROBINHOOD_CHAIN_NETWORK,
  chainId: 4663,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com/",
  websocketUrl: "wss://feed.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  recommendedRpcProvider: "Alchemy",
} as const;

export const ROBINHOOD_CHAIN_TESTNET = {
  name: "Robinhood Chain Testnet",
  network: ROBINHOOD_CHAIN_TESTNET_NETWORK,
  chainId: 46630,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.testnet.chain.robinhood.com/",
  websocketUrl: "wss://feed.testnet.chain.robinhood.com",
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  recommendedRpcProvider: "Alchemy",
} as const;

export type RobinhoodStockTokenKind = "stock" | "etf";

export type RobinhoodStockToken = {
  /** Underlying ticker and ERC-20 symbol, e.g. "AAPL". */
  symbol: string;
  /** Canonical Robinhood Stock Token contract on Robinhood Chain. */
  address: `0x${string}`;
  name: string;
  kind: RobinhoodStockTokenKind;
  /** Robinhood Stock Tokens are documented as standard 18-decimal ERC-20s. */
  decimals: 18;
};

export const ROBINHOOD_CORE_TOKENS = {
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
} as const;

export const ROBINHOOD_STOCK_TOKENS: readonly RobinhoodStockToken[] = [
  { symbol: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", name: "Apple", kind: "stock", decimals: 18 },
  { symbol: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", name: "AMD", kind: "stock", decimals: 18 },
  { symbol: "AMZN", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", name: "Amazon", kind: "stock", decimals: 18 },
  { symbol: "BABA", address: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4", name: "Alibaba", kind: "stock", decimals: 18 },
  { symbol: "BE", address: "0x822CC93fFD030293E9842c30BBD678F530701867", name: "Bloom Energy", kind: "stock", decimals: 18 },
  { symbol: "COIN", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", name: "Coinbase", kind: "stock", decimals: 18 },
  { symbol: "CRCL", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", name: "Circle", kind: "stock", decimals: 18 },
  { symbol: "CRWV", address: "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3", name: "CoreWeave", kind: "stock", decimals: 18 },
  { symbol: "GOOGL", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", name: "Alphabet", kind: "stock", decimals: 18 },
  { symbol: "INTC", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", name: "Intel", kind: "stock", decimals: 18 },
  { symbol: "META", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", name: "Meta", kind: "stock", decimals: 18 },
  { symbol: "MSFT", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", name: "Microsoft", kind: "stock", decimals: 18 },
  { symbol: "MU", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", name: "Micron", kind: "stock", decimals: 18 },
  { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", name: "NVIDIA", kind: "stock", decimals: 18 },
  { symbol: "ORCL", address: "0xb0992820E760d836549ba69BC7598b4af75dEE03", name: "Oracle", kind: "stock", decimals: 18 },
  { symbol: "PLTR", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", name: "Palantir", kind: "stock", decimals: 18 },
  { symbol: "SNDK", address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", name: "SanDisk", kind: "stock", decimals: 18 },
  { symbol: "SPCX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", name: "SPCX", kind: "stock", decimals: 18 },
  { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", name: "Tesla", kind: "stock", decimals: 18 },
  { symbol: "USAR", address: "0xd917B029C761D264c6A312BBbcDA868658eF86a6", name: "USAR", kind: "stock", decimals: 18 },
  { symbol: "QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", name: "Nasdaq 100 ETF", kind: "etf", decimals: 18 },
  { symbol: "SGOV", address: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", name: "iShares 0-3 Month Treasury Bond ETF", kind: "etf", decimals: 18 },
  { symbol: "SLV", address: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", name: "iShares Silver Trust", kind: "etf", decimals: 18 },
  { symbol: "SPY", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", name: "S&P 500 ETF", kind: "etf", decimals: 18 },
  { symbol: "CUSO", address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", name: "CUSO", kind: "etf", decimals: 18 },
] as const;

export function resolveRobinhoodStockToken(ticker: string): RobinhoodStockToken | null {
  const raw = ticker.trim().toUpperCase();
  return ROBINHOOD_STOCK_TOKENS.find((token) => token.symbol === raw) ?? null;
}

export function supportedRobinhoodStockTickers(): string[] {
  return ROBINHOOD_STOCK_TOKENS.map((token) => token.symbol).sort();
}
