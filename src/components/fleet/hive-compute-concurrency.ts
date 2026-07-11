function positiveInteger(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function concurrencyAfterAdvertisedModelChange(
  currentConcurrency: number,
  previousEnabledCount: number,
  nextEnabledCount: number,
) {
  const current = positiveInteger(currentConcurrency);
  const previousLimit = positiveInteger(previousEnabledCount);
  const nextLimit = positiveInteger(nextEnabledCount);
  return current >= previousLimit ? nextLimit : Math.min(current, nextLimit);
}
