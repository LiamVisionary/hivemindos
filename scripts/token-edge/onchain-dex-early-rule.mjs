export const DEX_EARLY_SURFACE_RULE = Object.freeze({
  version: "dexscreener-early-surface-v1",
  minimumPairAgeMinutesInclusive: 15,
  maximumPairAgeHoursInclusive: 72,
  minimumLiquidityUsdInclusive: 10_000,
  maximumMarketCapUsdInclusive: 5_000_000,
  minimumMarketCapUsdInclusive: 50_000,
  minimumHourlyVolumeUsdInclusive: 1_000,
  minimumHourlyPriceChangePctInclusive: -20,
  maximumHourlyPriceChangePctInclusive: 25,
  minimumDailyPriceChangePctInclusive: -50,
  maximumDailyPriceChangePctInclusive: 150,
  maximumCandidates: 8,
  orderBy: "surface-breadth-desc-boost-desc-turnover-desc-age-asc",
  purpose: "Acquire candidates before slower social and smart-money rankers; outcomes remain prospective and paper-only.",
});

export function satisfiesDexEarlySurfaceRule(candidate, rule = DEX_EARLY_SURFACE_RULE) {
  return candidate?.ruleVersion === rule.version
    && candidate?.sourceBreadth >= 1
    && candidate?.pairAgeMinutes >= rule.minimumPairAgeMinutesInclusive
    && candidate?.pairAgeMinutes <= rule.maximumPairAgeHoursInclusive * 60
    && candidate?.liquidityUsd >= rule.minimumLiquidityUsdInclusive
    && candidate?.marketCapUsd >= rule.minimumMarketCapUsdInclusive
    && candidate?.marketCapUsd <= rule.maximumMarketCapUsdInclusive
    && candidate?.volumeH1Usd >= rule.minimumHourlyVolumeUsdInclusive
    && within(candidate?.priceChangeH1Pct, rule.minimumHourlyPriceChangePctInclusive, rule.maximumHourlyPriceChangePctInclusive)
    && within(candidate?.priceChangeH24Pct, rule.minimumDailyPriceChangePctInclusive, rule.maximumDailyPriceChangePctInclusive);
}

function within(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
