// guard:allow-hive-action-route - Monid discovery is read-only; paid runs are price-bound and confirmation-gated.
import { NextRequest } from "next/server";

import {
  MONID_RUN_CONFIRMATION,
  MonidApiError,
  inspectMonidEndpoint,
  monidPriceSnapshot,
  monidPricesMatch,
  monidReadSchema,
  monidRunSchema,
  readMonid,
  runMonid,
} from "@/lib/services/integrations/monid";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const mode = typeof body?.mode === "string" ? body.mode : "";

  try {
    if (mode === "read") {
      const parsed = monidReadSchema.safeParse(body);
      if (!parsed.success) return errorJson(parsed.error.issues[0]?.message || "Invalid Monid read request.", 400);
      const result = await readMonid(parsed.data);
      return okJson({ data: result.data, readOnly: true, upstreamStatus: result.status });
    }

    if (mode === "run") {
      const parsed = monidRunSchema.safeParse(body);
      if (!parsed.success) return errorJson(parsed.error.issues[0]?.message || "Invalid Monid run request.", 400);
      if (parsed.data.confirmation !== MONID_RUN_CONFIRMATION) {
        return errorJson(
          `Running a paid Monid endpoint requires confirmation ${MONID_RUN_CONFIRMATION}.`,
          409,
          { requiresConfirmation: true, confirmation: MONID_RUN_CONFIRMATION },
        );
      }

      const inspection = await inspectMonidEndpoint(parsed.data.provider, parsed.data.endpoint);
      const currentPrice = inspection.data && typeof inspection.data === "object"
        ? monidPriceSnapshot((inspection.data as Record<string, unknown>).price)
        : null;
      if (!currentPrice) {
        return errorJson("Monid did not return verifiable pricing for this endpoint, so the paid run was refused.", 502);
      }
      if (!monidPricesMatch(parsed.data.confirmedPrice, currentPrice)) {
        return errorJson(
          "Monid pricing changed since inspection. Inspect the endpoint again and confirm the current price before running it.",
          409,
          { requiresReinspection: true, currentPrice },
        );
      }

      const result = await runMonid(parsed.data);
      return okJson(
        { data: result.data, readOnly: false, upstreamStatus: result.status, confirmedPrice: currentPrice },
        { status: result.status === 202 ? 202 : 200 },
      );
    }

    return errorJson('Monid mode must be "read" or "run".', 400);
  } catch (error) {
    if (error instanceof MonidApiError) {
      const status = error.status === 401 || error.status === 402 || error.status === 429 ? error.status : 502;
      return errorJson(error.message, status, { upstreamStatus: error.status });
    }
    return errorJson(error instanceof Error ? error.message : "Monid request failed.", 502);
  }
}
