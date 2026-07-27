import "server-only";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const ZEROX_BASE = process.env.ZEROX_API_BASE || "https://api.0x.org";

export async function zeroExFetch(path: string, purpose = "0x swaps"): Promise<Record<string, unknown>> {
  const key = await hiveEnvValue("ZEROX_API_KEY");
  if (!key) throw new Error(`${purpose} need ZEROX_API_KEY. Add it with \`hive-env-add ZEROX_API_KEY\`.`);
  const response = await fetch(`${ZEROX_BASE}${path}`, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error(`0x API error (HTTP ${response.status}): ${zeroExErrorMessage(data)}.`);
  }
  return data;
}

export function zeroExErrorMessage(data: Record<string, unknown> | null | undefined): string {
  const reason = stringField(data?.reason);
  if (reason) return reason;
  const message = stringField(data?.message);
  if (message) return message;
  const validationErrors = data?.validationErrors;
  if (Array.isArray(validationErrors) && validationErrors.length) {
    return validationErrors.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const field = stringField(record.field);
      const issue = stringField(record.reason) || stringField(record.message);
      return [field, issue].filter(Boolean).join(": ");
    }).filter(Boolean).join("; ");
  }
  const details = data?.data && typeof data.data === "object" ? (data.data as Record<string, unknown>).details : undefined;
  if (Array.isArray(details) && details.length) {
    return details.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const field = stringField(record.field);
      const issue = stringField(record.reason) || stringField(record.message);
      return [field, issue].filter(Boolean).join(": ");
    }).filter(Boolean).join("; ");
  }
  return "request failed";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
