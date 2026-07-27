export type HiveComputePriceField =
  | "inputUsdMicroPerMTok"
  | "outputUsdMicroPerMTok"
  | "minimumJobUsdMicro";

export function hiveComputePriceDraftKey(modelId: string, field: HiveComputePriceField) {
  return `${modelId}:${field}`;
}

export function parseHiveComputePriceDraft(
  value: string,
  bounds: { min: number; max: number },
): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
