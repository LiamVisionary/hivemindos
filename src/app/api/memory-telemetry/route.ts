import { NextResponse } from "next/server";

import { collectMemoryTelemetry } from "@/lib/services/runtime-memory-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEMETRY_RESPONSE_BUDGET_MS = 1_800;
let inFlightTelemetry: Promise<Awaited<ReturnType<typeof collectMemoryTelemetry>>> | null = null;

export async function GET() {
  try {
    inFlightTelemetry ??= collectMemoryTelemetry().finally(() => {
      inFlightTelemetry = null;
    });
    return NextResponse.json(await withResponseBudget(inFlightTelemetry));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read memory telemetry.",
    });
  }
}

async function withResponseBudget<T>(promise: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Memory telemetry is still collecting; try again shortly.")), TELEMETRY_RESPONSE_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
