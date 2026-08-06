export function annualizedSharpe(returnsPct: number[]): number {
  if (returnsPct.length < 2) return 0;
  const average = mean(returnsPct);
  const deviation = sampleStandardDeviation(returnsPct);
  return deviation > 1e-12 ? average / deviation * Math.sqrt(252) : 0;
}

export function deflatedSharpe(returnsPct: number[], trialCount: number) {
  const observedSharpe = annualizedSharpe(returnsPct);
  const trials = Math.max(1, trialCount);
  const standardError = Math.sqrt(252 / Math.max(2, returnsPct.length - 1));
  const nullMaxSharpe = trials > 1
    ? Math.sqrt(2 * Math.log(trials)) * standardError
    : 0;
  return {
    observedSharpe: round(observedSharpe, 8),
    nullMaxSharpe: round(nullMaxSharpe, 8),
    probability: round(normalCdf(
      (observedSharpe - nullMaxSharpe) / Math.max(standardError, 1e-12),
    ), 8),
  };
}

export function probabilityBacktestOverfit(
  candidateReturns: number[][],
  requestedSegments = 8,
): {
  coverage: "complete" | "missing";
  segments: number;
  combinations: number;
  probability: number;
  reason?: string;
} {
  if (candidateReturns.length < 2) {
    return missingPbo("At least two candidate return series are required.");
  }
  const length = candidateReturns[0]?.length ?? 0;
  if (
    candidateReturns.some((values) => values.length !== length)
    || length < requestedSegments * 4
  ) {
    return missingPbo("Aligned candidate histories are required for CSCV.");
  }
  let segments = Math.min(requestedSegments, Math.floor(length / 4));
  if (segments % 2) segments -= 1;
  if (segments < 4) return missingPbo("At least four CSCV segments are required.");
  const boundaries = Array.from(
    { length: segments + 1 },
    (_, index) => Math.round(index * length / segments),
  );
  const segmentRows = Array.from({ length: segments }, (_, segment) =>
    Array.from(
      { length: boundaries[segment + 1] - boundaries[segment] },
      (_, offset) => boundaries[segment] + offset,
    )
  );
  let negativeLogits = 0;
  let combinations = 0;
  for (const selected of combinationsOf(
    Array.from({ length: segments }, (_, index) => index),
    segments / 2,
  )) {
    const selectedSet = new Set(selected);
    const inside = selected.flatMap((segment) => segmentRows[segment]);
    const outside = segmentRows.flatMap((rows, segment) =>
      selectedSet.has(segment) ? [] : rows
    );
    const insideScores = candidateReturns.map((values) =>
      annualizedSharpe(inside.map((index) => values[index]))
    );
    const winner = argmax(insideScores);
    const outsideScores = candidateReturns.map((values) =>
      annualizedSharpe(outside.map((index) => values[index]))
    );
    const selectedScore = outsideScores[winner];
    const ascendingRank = 1 + outsideScores.filter((score) => score < selectedScore).length;
    const relativeRank = ascendingRank / (outsideScores.length + 1);
    const logit = Math.log(relativeRank / (1 - relativeRank));
    if (logit <= 0) negativeLogits += 1;
    combinations += 1;
  }
  return {
    coverage: "complete",
    segments,
    combinations,
    probability: round(combinations ? negativeLogits / combinations : 1, 8),
  };
}

export function shiftedSignalPlacebo(input: {
  actualReturnsPct: number[];
  positions: number[];
  assetReturnsPct: number[];
  iterations?: number;
  seed?: number;
}) {
  const length = Math.min(
    input.actualReturnsPct.length,
    input.positions.length,
    input.assetReturnsPct.length,
  );
  const iterations = Math.max(100, input.iterations ?? 2_000);
  if (length < 20) {
    return {
      iterations,
      pValue: 1,
      candidateMeanPct: round(mean(input.actualReturnsPct), 8),
      placeboCi95Pct: [0, 0] as [number, number],
    };
  }
  const actual = input.actualReturnsPct.slice(-length);
  const positions = input.positions.slice(-length);
  const asset = input.assetReturnsPct.slice(-length);
  const candidateMeanPct = mean(actual);
  const rng = seededRandom(input.seed ?? 41);
  const placebo: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shift = 1 + Math.floor(rng() * (length - 1));
    const shifted = positions.slice(-shift).concat(positions.slice(0, -shift));
    placebo.push(mean(shifted.map((position, index) => position * asset[index])));
  }
  const exceedances = placebo.filter((value) => value >= candidateMeanPct).length;
  return {
    iterations,
    pValue: round((exceedances + 1) / (iterations + 1), 8),
    candidateMeanPct: round(candidateMeanPct, 8),
    placeboCi95Pct: [
      round(percentile(placebo, 0.025), 8),
      round(percentile(placebo, 0.975), 8),
    ] as [number, number],
  };
}

export function benjaminiHochberg(candidatePValue: number, trialPValues: number[]) {
  const values = [candidatePValue, ...trialPValues].map((value) =>
    Math.min(1, Math.max(0, value))
  );
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const adjusted = Array(values.length).fill(1);
  let running = 1;
  for (let reverseIndex = ordered.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
    const row = ordered[reverseIndex];
    const rank = reverseIndex + 1;
    running = Math.min(running, row.value * values.length / rank);
    adjusted[row.index] = Math.min(1, running);
  }
  return {
    familySize: values.length,
    candidatePValue: round(candidatePValue, 8),
    candidateQValue: round(adjusted[0], 8),
  };
}

export function oneSidedMeanPValue(values: number[]) {
  if (values.length < 3) return 1;
  const standardError = sampleStandardDeviation(values) / Math.sqrt(values.length);
  if (standardError <= 1e-12) return mean(values) > 0 ? 0 : 1;
  return round(1 - normalCdf(mean(values) / standardError), 8);
}

export function deterministicSample<T>(
  values: T[],
  count: number,
  seed: number,
): T[] {
  if (!values.length || count <= 0) return [];
  const rng = seededRandom(seed);
  return Array.from({ length: count }, () =>
    values[Math.floor(rng() * values.length)]
  );
}

export function percentile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

export function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function missingPbo(reason: string) {
  return {
    coverage: "missing" as const,
    segments: 0,
    combinations: 0,
    probability: 1,
    reason,
  };
}

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0)
    / (values.length - 1),
  );
}

function argmax(values: number[]) {
  let selected = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[selected]) selected = index;
  }
  return selected;
}

function combinationsOf(values: number[], count: number): number[][] {
  const result: number[][] = [];
  const visit = (start: number, selected: number[]) => {
    if (selected.length === count) {
      result.push(selected);
      return;
    }
    for (let index = start; index <= values.length - (count - selected.length); index += 1) {
      visit(index + 1, [...selected, values[index]]);
    }
  };
  visit(0, []);
  return result;
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (
    (
      (
        (
          (1.061405429 * t - 1.453152027) * t
          + 1.421413741
        ) * t
        - 0.284496736
      ) * t
      + 0.254829592
    ) * t
  ) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
