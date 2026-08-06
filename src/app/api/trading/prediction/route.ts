import type { NextRequest } from "next/server";

import {
  calculatePredictionCalibration,
  fetchCurrentBtcComplementArbitrageQuotes,
  fetchPredictionEvents,
  fetchPredictionOrderBook,
  fetchPredictionPriceHistory,
  fetchPredictionTraderProfile,
  simulatePredictionPaperOrder,
  weatherBucketProbability,
  type PredictionMarket,
  type PredictionOrderBook,
  type PredictionOutcome,
} from "@/lib/services/trading/prediction-markets";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PredictionPostBody =
  | {
    action?: "paper-order";
    market?: PredictionMarket;
    outcome?: PredictionOutcome;
    side?: "buy" | "sell";
    notionalUsd?: number;
    book?: PredictionOrderBook;
    slippageBps?: number;
  }
  | {
    action?: "calibration";
    samples?: Array<{ probability: number; outcome: 0 | 1 }>;
  }
  | {
    action?: "weather-probability";
    forecast?: number;
    low?: number;
    high?: number;
    uncertainty?: number;
  }
  | {
    action?: "btc-complement-arbitrage";
    bankrollUsd?: number;
  };

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const action = request.nextUrl.searchParams.get("action") || "events";
  try {
    if (action === "events") {
      const query = request.nextUrl.searchParams.get("q")?.trim();
      const events = await fetchPredictionEvents({ query, limit: Number(request.nextUrl.searchParams.get("limit")) || 12 });
      return okJson({ events, source: "Polymarket public Gamma API" });
    }
    if (action === "book") {
      const outcomeId = request.nextUrl.searchParams.get("outcomeId")?.trim() || "";
      return okJson({ book: await fetchPredictionOrderBook(outcomeId) });
    }
    if (action === "history") {
      const outcomeId = request.nextUrl.searchParams.get("outcomeId")?.trim() || "";
      return okJson({ history: await fetchPredictionPriceHistory(outcomeId) });
    }
    if (action === "trader") {
      const address = request.nextUrl.searchParams.get("address")?.trim() || "";
      return okJson({ trader: await fetchPredictionTraderProfile(address) });
    }
    return errorJson("Unknown prediction-market read action.");
  } catch (error) {
    return upstreamErrorJson("Prediction-market read failed", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => ({})) as PredictionPostBody;
    if (body.action === "paper-order") {
      if (!body.market || !body.outcome || !body.side) return errorJson("Market, outcome, and side are required.");
      const order = simulatePredictionPaperOrder({
        market: body.market,
        outcome: body.outcome,
        side: body.side,
        notionalUsd: Number(body.notionalUsd),
        book: body.book,
        slippageBps: Number(body.slippageBps) || undefined,
      });
      return okJson({ order, execution: "paper", liveFundsMoved: false }, { status: 201 });
    }
    if (body.action === "calibration") {
      return okJson({ calibration: calculatePredictionCalibration(Array.isArray(body.samples) ? body.samples : []) });
    }
    if (body.action === "btc-complement-arbitrage") {
      const quotes = await fetchCurrentBtcComplementArbitrageQuotes({
        bankrollUsd: body.bankrollUsd === undefined ? undefined : Number(body.bankrollUsd),
        maxDepthFraction: 0.25,
      });
      return okJson({
        quotes,
        execution: "paper",
        liveFundsMoved: false,
        depthAssumption: "At most 25% of each displayed ask level.",
      });
    }
    if (body.action === "weather-probability") {
      return okJson({
        probability: weatherBucketProbability({
          forecast: Number(body.forecast),
          low: body.low == null ? undefined : Number(body.low),
          high: body.high == null ? undefined : Number(body.high),
          uncertainty: body.uncertainty == null ? undefined : Number(body.uncertainty),
        }),
      });
    }
    return errorJson("Unknown prediction-market action.");
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Prediction-market action failed.");
  }
}
