import { type NextRequest } from "next/server";

import {
  formatBrainAccessInsightsForAgent,
  readBrainAccessInsights,
} from "@/lib/services/obsidian/brain-access-insights";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      vaultPath?: unknown;
    };
    const insights = await readBrainAccessInsights({
      vaultPath:
        typeof body.vaultPath === "string" && body.vaultPath.trim()
          ? body.vaultPath.trim()
          : undefined,
    });
    return okJson({
      context: formatBrainAccessInsightsForAgent(insights),
      insights,
    });
  } catch (error) {
    return errorJson(
      error instanceof Error
        ? error.message
        : "Could not read Brain access history.",
      400,
    );
  }
}
