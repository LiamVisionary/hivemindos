/**
 * xStocks (Backed Finance) tokenized-equity allowlist for the on-chain buy rail.
 *
 * SAFETY: this is a HARD allowlist of Jupiter-verified SPL Token-2022 mints. The
 * agent buy-stock tool resolves a ticker to a mint ONLY through this map — it
 * never resolves by live symbol search, because Solana has dozens of scam
 * copycats reusing each "AAPLx"-style symbol. Every mint below was confirmed via
 * Jupiter's token API carrying both the `verified` and `xstocks` tags, and all
 * share the official xStocks `Xs` vanity-address prefix.
 *
 * To add a symbol: confirm the mint on Jupiter
 *   https://lite-api.jup.ag/tokens/v2/search?query=<SYMBOL>
 * and only accept the entry tagged ["verified","xstocks","rwa","token-2022"].
 */

/** Native USDC mint on Solana mainnet — the funding asset for every swap. */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type XStockToken = {
  /** On-chain ticker, e.g. "AAPLx". */
  symbol: string;
  /** Underlying equity ticker the user would say, e.g. "AAPL". */
  underlying: string;
  /** Verified SPL Token-2022 mint address. */
  mint: string;
  name: string;
};

/** Verified mints (confirmed live against Jupiter token API, 2026-06-13). */
export const XSTOCKS: readonly XStockToken[] = [
  { symbol: "AAPLx", underlying: "AAPL", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", name: "Apple xStock" },
  { symbol: "NVDAx", underlying: "NVDA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", name: "NVIDIA xStock" },
  { symbol: "TSLAx", underlying: "TSLA", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", name: "Tesla xStock" },
  { symbol: "MSFTx", underlying: "MSFT", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", name: "Microsoft xStock" },
  { symbol: "AMZNx", underlying: "AMZN", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", name: "Amazon xStock" },
  { symbol: "GOOGLx", underlying: "GOOGL", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", name: "Alphabet xStock" },
  { symbol: "METAx", underlying: "META", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", name: "Meta xStock" },
  { symbol: "COINx", underlying: "COIN", mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", name: "Coinbase xStock" },
  { symbol: "QQQx", underlying: "QQQ", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", name: "Nasdaq 100 xStock" },
  { symbol: "MSTRx", underlying: "MSTR", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", name: "MicroStrategy xStock" },
  { symbol: "AMDx", underlying: "AMD", mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF", name: "AMD xStock" },
  { symbol: "HOODx", underlying: "HOOD", mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", name: "Robinhood xStock" },
  { symbol: "CRCLx", underlying: "CRCL", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", name: "Circle xStock" },
  { symbol: "SPYx", underlying: "SPY", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", name: "S&P 500 xStock" },
] as const;

/**
 * Resolve a user-supplied ticker to a verified xStock. Accepts both the
 * underlying ("AAPL") and the on-chain symbol ("AAPLx"), case-insensitively.
 * Returns null when the ticker is not on the allowlist — the caller must refuse
 * the trade rather than fall back to symbol search.
 */
export function resolveXStock(ticker: string): XStockToken | null {
  const raw = ticker.trim().toUpperCase();
  const withoutX = raw.endsWith("X") ? raw.slice(0, -1) : raw;
  return (
    XSTOCKS.find((t) => t.symbol.toUpperCase() === raw || t.underlying.toUpperCase() === raw || t.underlying.toUpperCase() === withoutX) ??
    null
  );
}

/** Sorted list of supported underlying tickers, for error messages and UI. */
export function supportedXStockTickers(): string[] {
  return XSTOCKS.map((t) => t.underlying).sort();
}
