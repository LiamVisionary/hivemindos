type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CryptoMarketResponse = {
  ok?: boolean;
  rows?: Array<{ symbol?: unknown; price?: unknown }>;
};

export async function fetchWalletTokenUsdPrice(symbolInput: string, request: FetchLike = fetch): Promise<number | null> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) return null;
  const response = await request("/api/trading/market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "crypto", symbols: [symbol], range: "24h" }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as CryptoMarketResponse | null;
  const row = data?.ok && Array.isArray(data.rows)
    ? data.rows.find((candidate) => String(candidate?.symbol || "").trim().toUpperCase() === symbol)
    : null;
  const price = Number(row?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}
