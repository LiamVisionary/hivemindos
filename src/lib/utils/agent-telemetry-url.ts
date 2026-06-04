export function isPlaceholderTelemetryUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    const { hostname } = new URL(trimmed);
    const normalized = hostname.toLowerCase();
    return normalized === "invalid"
      || normalized.endsWith(".invalid")
      || normalized === "capture.invalid"
      || normalized.endsWith(".capture.invalid");
  } catch {
    return false;
  }
}

export function normalizeAgentTelemetryUrl(value?: string) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed || isPlaceholderTelemetryUrl(trimmed)) return undefined;
  return trimmed;
}
