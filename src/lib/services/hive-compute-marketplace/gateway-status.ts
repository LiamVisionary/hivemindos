import type {
  HiveComputeGatewayStatus,
  HiveComputeModelPerformance,
} from "@/lib/types/hive-compute-marketplace";

export function modelPerformanceLabel(performance?: HiveComputeModelPerformance) {
  if (!performance?.samples || !performance.tokensPerSecond) return "";
  if (performance.speedTier === "warming") return "Measuring speed";
  const tier = performance.speedTier === "fast"
    ? "Fast"
    : performance.speedTier === "balanced"
      ? "Balanced"
      : "Heavy";
  return `${tier} · ${performance.tokensPerSecond.toFixed(1)} tok/s`;
}

export function performanceBadge(performance?: HiveComputeModelPerformance) {
  if (!performance?.samples || !performance.speedTier || performance.speedTier === "unmeasured") return "";
  if (performance.speedTier === "warming") return "Measuring";
  if (performance.speedTier === "fast") return "Fast";
  if (performance.speedTier === "balanced") return "Balanced";
  return "Heavy";
}

export function capacityFromHealth(json: unknown): HiveComputeGatewayStatus["capacity"] {
  const marketplace = json && typeof json === "object" && "marketplace" in json
    ? (json as { marketplace?: unknown }).marketplace
    : undefined;
  const record = marketplace && typeof marketplace === "object" ? marketplace as Record<string, unknown> : {};
  const liveWorkers = positiveNumber(record.liveWorkers, 0);
  const totalSlots = positiveNumber(record.totalSlots, 0);
  const busySlots = positiveNumber(record.busySlots, 0);
  const availableSlots = positiveNumber(record.availableSlots, 0);
  const hardwareTeeWorkers = positiveNumber(record.hardwareTeeWorkers, 0);
  const confidentialWorkers = positiveNumber(record.confidentialWorkers, 0);
  const pendingJobs = positiveNumber(record.pendingJobs, 0);
  const pricingRecord = record.pricing && typeof record.pricing === "object" ? record.pricing as Record<string, unknown> : {};
  const boundsRecord = pricingRecord.providerBounds && typeof pricingRecord.providerBounds === "object"
    ? pricingRecord.providerBounds as Record<string, unknown>
    : {};
  const priceRange = (key: string, fallbackMin: number, fallbackMax: number) => {
    const range = boundsRecord[key] && typeof boundsRecord[key] === "object" ? boundsRecord[key] as Record<string, unknown> : {};
    return { min: positiveNumber(range.min, fallbackMin), max: positiveNumber(range.max, fallbackMax) };
  };
  const centralizedRecord = pricingRecord.centralizedCeiling && typeof pricingRecord.centralizedCeiling === "object"
    ? pricingRecord.centralizedCeiling as Record<string, unknown>
    : {};
  const pricing = Object.keys(pricingRecord).length ? {
    providerBounds: {
      inputUsdMicroPerMTok: priceRange("inputUsdMicroPerMTok", 10_000, 20_000_000),
      outputUsdMicroPerMTok: priceRange("outputUsdMicroPerMTok", 10_000, 30_000_000),
      minimumJobUsdMicro: { min: 0, max: positiveNumber(
        boundsRecord.minimumJobUsdMicro && typeof boundsRecord.minimumJobUsdMicro === "object"
          ? (boundsRecord.minimumJobUsdMicro as Record<string, unknown>).max
          : undefined,
        1_000_000,
      ) },
    },
    centralizedCeiling: {
      inputUsdMicroPerMTok: positiveNumber(centralizedRecord.inputUsdMicroPerMTok, 20_000_000),
      outputUsdMicroPerMTok: positiveNumber(centralizedRecord.outputUsdMicroPerMTok, 30_000_000),
    },
    platformFeeBps: positiveNumber(pricingRecord.platformFeeBps, 2_000),
  } : undefined;
  const liveModels = stringArray(record.liveModels);
  const confidentialModels = stringArray(record.confidentialModels);
  const keyRelayModels = stringArray(record.keyRelayModels);
  const modelPerformance = modelPerformanceArray(record.modelPerformance);
  const fallbackConfigured = record.fallbackConfigured === true;
  const statusLabel = liveWorkers > 0
    ? totalSlots > 0
      ? `${availableSlots}/${totalSlots} slot${totalSlots === 1 ? "" : "s"} open`
      : `${liveWorkers} worker${liveWorkers === 1 ? "" : "s"} live`
    : fallbackConfigured
      ? "Fallback only"
      : keyRelayModels.length
        ? `${keyRelayModels.length} relay model${keyRelayModels.length === 1 ? "" : "s"}`
        : "No live workers";
  return {
    liveWorkers,
    ...(totalSlots ? { totalSlots, busySlots, availableSlots } : {}),
    ...(hardwareTeeWorkers ? { hardwareTeeWorkers } : {}),
    ...(confidentialWorkers ? { confidentialWorkers } : {}),
    confidentialModels,
    liveModels,
    keyRelayModels,
    modelPerformance,
    fallbackConfigured,
    pendingJobs,
    ...(pricing ? { pricing } : {}),
    statusLabel,
    statusTone: liveWorkers > 0 ? "live" : fallbackConfigured || keyRelayModels.length ? "fallback" : "empty",
  };
}

export function probeJsonPayload(input: unknown) {
  return input && typeof input === "object" && "json" in input
    ? (input as { json?: unknown }).json
    : undefined;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function positiveFloat(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function modelPerformanceArray(value: unknown): HiveComputeModelPerformance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): HiveComputeModelPerformance[] => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const model = String(record.model || "").trim();
    if (!model) return [];
    const speedTier = String(record.speedTier || "").trim();
    return [{
      model,
      samples: positiveNumber(record.samples, 0),
      completionTokens: positiveNumber(record.completionTokens, 0),
      tokensPerSecond: positiveFloat(record.tokensPerSecond, 0),
      timeToFirstTokenMs: positiveNumber(record.timeToFirstTokenMs, 0),
      durationMs: positiveNumber(record.durationMs, 0),
      speedTier: speedTier === "warming" || speedTier === "heavy" || speedTier === "balanced" || speedTier === "fast"
        ? speedTier
        : "unmeasured",
      ...(String(record.updatedAt || "").trim() ? { updatedAt: String(record.updatedAt).trim() } : {}),
    }];
  });
}
