export function formatModelCreditAmount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const maximumFractionDigits = safe >= 100 ? 0 : safe >= 1 ? 2 : 3;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(safe);
}

export function formatModelCredits(value: number): string {
  return `${formatModelCreditAmount(value)} credits`;
}

export function modelCreditsForRetailAmount(value: number): number {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.round(safe * 500 * 1_000) / 1_000;
}
