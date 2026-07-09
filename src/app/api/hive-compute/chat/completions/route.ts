import { NextRequest, NextResponse } from "next/server";

import {
  HiveComputeMarketplaceError,
  proxyHiveComputeChatCompletion,
} from "@/lib/services/hive-compute-marketplace";
import { errorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

type OpenAIChatCompletionBody = {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({
    ok: true,
    provider: "hive-compute",
    chatPath: "/api/hive-compute/chat/completions",
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as OpenAIChatCompletionBody | null;
  if (!body || typeof body !== "object") return errorJson("OpenAI-compatible chat completion JSON is required.", 400);
  if (!Array.isArray(body.messages)) return errorJson("messages must be an array.", 400);
  try {
    const upstream = await proxyHiveComputeChatCompletion(body, request.signal, request.headers);
    return proxyResponse(upstream);
  } catch (error) {
    const status = error instanceof HiveComputeMarketplaceError ? error.status : 502;
    return errorJson(error instanceof Error ? error.message : "Hive Compute marketplace request failed.", status);
  }
}

function proxyResponse(upstream: Response) {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  for (const name of [
    "cache-control",
    "x-request-id",
    "x-hivemindos-compute-job-id",
    "x-hivemindos-compute-worker",
    "x-hivemindos-compute-price-usd",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
