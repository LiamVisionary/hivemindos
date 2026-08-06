import "server-only";

import { isIP } from "node:net";

import { optionalEnv } from "@/lib/config/env";
import { TRADING_BROKER_PACK_MATRIX } from "@/lib/config/trading-brokers";
import type { TradingBrokerConnection } from "@/lib/types/trading-control";

export type BrokerMarketQuote = {
  symbol: string;
  price: number;
  source: string;
  capturedAt: string;
};

export type BrokerPackProbe = {
  health: TradingBrokerConnection["health"];
  detail: string;
  checkedAt: string;
  quote?: BrokerMarketQuote;
  account?: Record<string, unknown>;
};

type FetchLike = typeof fetch;

function safeGatewayUrl(value: string) {
  if (!value) throw new Error("IBKR_GATEWAY_URL is not configured.");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("IBKR_GATEWAY_URL must use HTTPS, or HTTP on a loopback address.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function jsonResponse(response: Response, label: string) {
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return data;
}

async function probePublicExchange(connection: TradingBrokerConnection, fetcher: FetchLike): Promise<BrokerPackProbe> {
  const exchange = connection.settings.exchange === "kraken" ? "kraken" : "coinbase";
  const symbol = (connection.settings.symbol || "BTC/USD").trim().toUpperCase();
  const checkedAt = new Date().toISOString();
  if (exchange === "kraken") {
    const pair = symbol.replace(/[^A-Z0-9]/g, "") || "BTCUSD";
    const response = await fetcher(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await jsonResponse(response, "Kraken public ticker") as { error?: unknown[]; result?: Record<string, { c?: string[] }> };
    if (Array.isArray(body.error) && body.error.length) throw new Error(`Kraken public ticker: ${body.error.join(" ")}`);
    const row = Object.values(body.result ?? {})[0];
    const price = Number(row?.c?.[0]);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Kraken did not return a valid last price.");
    return { health: "healthy", detail: `Kraken public market data is reachable; ${symbol} last ${price}.`, checkedAt, quote: { symbol, price, source: "kraken-public", capturedAt: checkedAt } };
  }
  const product = symbol.replace("/", "-") || "BTC-USD";
  const response = await fetcher(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/ticker`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await jsonResponse(response, "Coinbase public ticker") as { price?: string };
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Coinbase did not return a valid last price.");
  return { health: "healthy", detail: `Coinbase public market data is reachable; ${symbol} last ${price}.`, checkedAt, quote: { symbol, price, source: "coinbase-public", capturedAt: checkedAt } };
}

async function probeIbkr(fetcher: FetchLike): Promise<BrokerPackProbe> {
  const gateway = safeGatewayUrl(optionalEnv("IBKR_GATEWAY_URL"));
  const checkedAt = new Date().toISOString();
  const statusUrl = new URL(`${gateway.toString().replace(/\/$/, "")}/v1/api/iserver/auth/status`);
  const response = await fetcher(statusUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await jsonResponse(response, "IBKR Client Portal Gateway") as { authenticated?: boolean; connected?: boolean; competing?: boolean };
  const ready = body.authenticated === true && body.connected !== false && body.competing !== true;
  return {
    health: ready ? "healthy" : "degraded",
    detail: ready
      ? "IBKR paper gateway is authenticated and reachable in read-only mode."
      : "IBKR gateway is reachable, but its paper session needs authentication or attention.",
    checkedAt,
    account: { authenticated: Boolean(body.authenticated), connected: body.connected !== false, competing: Boolean(body.competing) },
  };
}

export async function probeTradingBrokerPack(connection: TradingBrokerConnection, fetcher: FetchLike = fetch): Promise<BrokerPackProbe> {
  const definition = TRADING_BROKER_PACK_MATRIX[connection.packId];
  if (!definition) throw new Error("Unsupported broker pack.");
  if (!connection.readOnly) throw new Error(`${definition.label} must remain read-only in this release.`);
  try {
    return connection.packId === "ccxt" ? await probePublicExchange(connection, fetcher) : await probeIbkr(fetcher);
  } catch (error) {
    return {
      health: "offline",
      detail: error instanceof Error ? error.message : `${definition.label} probe failed.`,
      checkedAt: new Date().toISOString(),
    };
  }
}
