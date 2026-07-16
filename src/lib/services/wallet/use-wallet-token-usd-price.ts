"use client";

import { useEffect, useState } from "react";
import { fetchWalletTokenUsdPrice } from "./token-price-client";

const USD_STABLE_SYMBOLS = new Set(["USDC", "USDG"]);

export function useWalletTokenUsdPrice(symbolInput: string, snapshotPriceInput: number | null | undefined) {
  const symbol = symbolInput.trim().toUpperCase();
  const snapshotPrice = Number(snapshotPriceInput);
  const hasSnapshotPrice = Number.isFinite(snapshotPrice) && snapshotPrice > 0;
  const isUsdStable = USD_STABLE_SYMBOLS.has(symbol);
  const [marketPrice, setMarketPrice] = useState<{ symbol: string; price: number | null }>({
    symbol: "",
    price: null,
  });

  useEffect(() => {
    if (hasSnapshotPrice || isUsdStable) return;
    let ignore = false;
    void fetchWalletTokenUsdPrice(symbol).then((price) => {
      if (!ignore) setMarketPrice({ symbol, price });
    });
    return () => { ignore = true; };
  }, [hasSnapshotPrice, isUsdStable, symbol]);

  return {
    priceUsd: hasSnapshotPrice ? snapshotPrice : isUsdStable ? 1 : marketPrice.symbol === symbol ? marketPrice.price : null,
    loading: !hasSnapshotPrice && !isUsdStable && marketPrice.symbol !== symbol,
  };
}
