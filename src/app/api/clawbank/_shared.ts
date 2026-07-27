import { NextResponse } from "next/server";
import type { ClawbankResponse } from "@/lib/services/clawbank";

/**
 * Shared helpers for the /api/clawbank/* routes. (Underscore prefix keeps
 * Next.js from treating this as a route file.)
 */

/** Map a normalized ClawBank failure to an HTTP response. Missing credential ->
 *  400 with configured:false; upstream HTTP errors are passed through; network
 *  failures surface as 502. */
export function clawbankRouteError(result: ClawbankResponse): NextResponse {
  if (result.errorCode === "missing_credential") {
    return NextResponse.json(
      { ok: false, configured: false, error: result.error, code: result.errorCode },
      { status: 400 },
    );
  }
  const status = result.status >= 400 && result.status < 600 ? result.status : 502;
  return NextResponse.json(
    { ok: false, error: result.error, code: result.errorCode },
    { status },
  );
}

/** Confirmation-gate guard. Returns a 400 response when the supplied token does
 *  not match, else null (proceed). Comparison is exact (trimmed). */
export function requireConfirmation(supplied: unknown, expected: string, reason: string): NextResponse | null {
  const value = typeof supplied === "string" ? supplied.trim() : "";
  if (value === expected) return null;
  return NextResponse.json(
    { ok: false, error: `This action requires confirmation "${expected}". ${reason}`, requiresConfirmation: true, confirmation: expected },
    { status: 400 },
  );
}

/** Read a JSON body defensively (never throws). */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

export function numberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
