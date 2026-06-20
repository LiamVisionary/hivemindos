export const QUEEN_CLAP_WAKE_STORAGE_KEY = "hivemindos.queenVoice.clapWake";

export const QUEEN_CLAP_ANALYSER_FFT_SIZE = 1024;
export const QUEEN_CLAP_PROCESSOR_BUFFER_SIZE = 1024;
export const QUEEN_CLAP_LISTENING_SETTLE_MS = 850;
export const QUEEN_CLAP_DOUBLE_WINDOW_MS = 560;
export const QUEEN_CLAP_MIN_SPACING_MS = 170;
export const QUEEN_CLAP_PULSE_COOLDOWN_MS = 150;
export const QUEEN_CLAP_ACTIVATION_COOLDOWN_MS = 1_500;
export const QUEEN_CLAP_RMS_THRESHOLD = 0.045;
export const QUEEN_CLAP_PEAK_THRESHOLD = 0.42;
export const QUEEN_CLAP_REARM_RMS = 0.035;
export const QUEEN_CLAP_RMS_NOISE_MARGIN = 0.035;
export const QUEEN_CLAP_REARM_NOISE_MARGIN = 0.018;
export const QUEEN_CLAP_INITIAL_NOISE_FLOOR = 0.02;
export const QUEEN_CLAP_NOISE_FLOOR_BLEND = 0.04;
export const QUEEN_CLAP_RELATIVE_REARM_RATIO = 0.72;
export const QUEEN_CLAP_RELATIVE_REARM_MS = 80;
export const QUEEN_CLAP_HIGH_FREQUENCY_START_HZ = 2_500;
export const QUEEN_CLAP_HIGH_FREQUENCY_RATIO_THRESHOLD = 0.18;
export const QUEEN_CLAP_SPECTRAL_FLUX_THRESHOLD = 0.08;
export const QUEEN_CLAP_HIGH_FREQUENCY_FLUX_THRESHOLD = 0.035;
export const QUEEN_CLAP_INITIAL_FLUX_FLOOR = 0.01;
export const QUEEN_CLAP_FLUX_FLOOR_BLEND = 0.06;
export const QUEEN_CLAP_FLUX_FLOOR_MULTIPLIER = 2.8;
export const QUEEN_CLAP_FLUX_NOISE_MARGIN = 0.035;
export const QUEEN_CLAP_CREST_FACTOR_THRESHOLD = 4.2;
export const QUEEN_CLAP_TRANSIENT_SHARPNESS_THRESHOLD = 1.05;
export const QUEEN_CLAP_SECOND_PEAK_RATIO = 0.45;
export const QUEEN_CLAP_SECOND_FLUX_RATIO = 0.4;

export type QueenClapMetrics = {
  rms: number;
  peak: number;
  nowMs: number;
  crestFactor?: number;
  transientSharpness?: number;
  highFrequencyRatio?: number;
  spectralFlux?: number;
  highFrequencyFlux?: number;
};

export type QueenClapDetectorState = {
  firstClapAt: number;
  firstClapPeak: number;
  firstClapFlux: number;
  lastPulseAt: number;
  lastPulseRms: number;
  lastActivationAt: number;
  armed: boolean;
  noiseFloor: number;
  fluxFloor: number;
  valleyRmsSincePulse: number;
};

export const initialQueenClapDetectorState: QueenClapDetectorState = {
  firstClapAt: 0,
  firstClapPeak: 0,
  firstClapFlux: 0,
  lastPulseAt: 0,
  lastPulseRms: 0,
  lastActivationAt: 0,
  armed: true,
  noiseFloor: QUEEN_CLAP_INITIAL_NOISE_FLOOR,
  fluxFloor: QUEEN_CLAP_INITIAL_FLUX_FLOOR,
  valleyRmsSincePulse: Number.POSITIVE_INFINITY,
};

export function measureFloatTimeDomainClapFrame(data: Float32Array) {
  if (!data.length) {
    return { rms: 0, peak: 0, crestFactor: 0, transientSharpness: 0 };
  }
  let sum = 0;
  let peak = 0;
  let absoluteSum = 0;
  let diffSum = 0;
  let previous = 0;
  for (const sample of data) {
    const value = Math.max(-1, Math.min(1, sample));
    const absolute = Math.abs(value);
    sum += value * value;
    absoluteSum += absolute;
    if (absolute > peak) peak = absolute;
    diffSum += Math.abs(value - previous);
    previous = value;
  }
  const rms = Math.sqrt(sum / data.length);
  const averageAbsolute = absoluteSum / data.length;
  const averageDiff = diffSum / data.length;
  return {
    rms,
    peak,
    crestFactor: rms > 0 ? peak / rms : 0,
    transientSharpness: averageAbsolute > 0 ? averageDiff / averageAbsolute : 0,
  };
}

export function measureTimeDomainClapFrame(data: Uint8Array) {
  if (!data.length) {
    return { rms: 0, peak: 0, crestFactor: 0, transientSharpness: 0 };
  }
  let sum = 0;
  let peak = 0;
  let absoluteSum = 0;
  let diffSum = 0;
  let previous = 0;
  for (const sample of data) {
    const value = (sample - 128) / 128;
    const absolute = Math.abs(value);
    sum += value * value;
    absoluteSum += absolute;
    if (absolute > peak) peak = absolute;
    diffSum += Math.abs(value - previous);
    previous = value;
  }
  const rms = Math.sqrt(sum / data.length);
  const averageAbsolute = absoluteSum / data.length;
  const averageDiff = diffSum / data.length;
  return {
    rms,
    peak,
    crestFactor: rms > 0 ? peak / rms : 0,
    transientSharpness: averageAbsolute > 0 ? averageDiff / averageAbsolute : 0,
  };
}

export function measureFrequencyClapFrame(
  data: Uint8Array,
  sampleRate: number,
  previousData?: Uint8Array | null,
) {
  if (!data.length || sampleRate <= 0) {
    return {
      highFrequencyRatio: 0,
      spectralFlux: 0,
      highFrequencyFlux: 0,
    };
  }
  const hzPerBin = (sampleRate / 2) / data.length;
  let totalEnergy = 0;
  let highFrequencyEnergy = 0;
  let spectralFlux = 0;
  let highFrequencyFlux = 0;
  let highFrequencyBins = 0;
  const hasPrevious = previousData?.length === data.length;
  for (let index = 0; index < data.length; index += 1) {
    const magnitude = data[index] / 255;
    const energy = magnitude * magnitude;
    const highFrequency = index * hzPerBin >= QUEEN_CLAP_HIGH_FREQUENCY_START_HZ;
    totalEnergy += energy;
    if (highFrequency) {
      highFrequencyEnergy += energy;
      highFrequencyBins += 1;
    }
    if (hasPrevious) {
      const diff = magnitude - (previousData[index] ?? 0) / 255;
      if (diff > 0) {
        spectralFlux += diff;
        if (highFrequency) highFrequencyFlux += diff;
      }
    }
  }
  return {
    highFrequencyRatio: totalEnergy > 0 ? highFrequencyEnergy / totalEnergy : 0,
    spectralFlux: spectralFlux / data.length,
    highFrequencyFlux: highFrequencyBins > 0
      ? highFrequencyFlux / highFrequencyBins
      : 0,
  };
}

export function nextQueenClapDetectorState(
  state: QueenClapDetectorState,
  metrics: QueenClapMetrics,
): { state: QueenClapDetectorState; activated: boolean } {
  const spectralFlux = metrics.spectralFlux ?? 0;
  const highFrequencyFlux = metrics.highFrequencyFlux ?? 0;
  const fluxThreshold = Math.max(
    QUEEN_CLAP_SPECTRAL_FLUX_THRESHOLD,
    state.fluxFloor * QUEEN_CLAP_FLUX_FLOOR_MULTIPLIER +
      QUEEN_CLAP_FLUX_NOISE_MARGIN,
  );
  const onsetLike =
    spectralFlux >= fluxThreshold &&
    highFrequencyFlux >= QUEEN_CLAP_HIGH_FREQUENCY_FLUX_THRESHOLD;
  const clapShaped =
    (metrics.crestFactor ?? 0) >= QUEEN_CLAP_CREST_FACTOR_THRESHOLD &&
    (metrics.transientSharpness ?? 0) >=
      QUEEN_CLAP_TRANSIENT_SHARPNESS_THRESHOLD;
  const shouldSampleNoise = metrics.peak < QUEEN_CLAP_PEAK_THRESHOLD * 0.75;
  const noiseFloor = shouldSampleNoise
    ? state.noiseFloor * (1 - QUEEN_CLAP_NOISE_FLOOR_BLEND) +
      metrics.rms * QUEEN_CLAP_NOISE_FLOOR_BLEND
    : state.noiseFloor;
  const fluxFloor = !onsetLike && shouldSampleNoise
    ? state.fluxFloor * (1 - QUEEN_CLAP_FLUX_FLOOR_BLEND) +
      spectralFlux * QUEEN_CLAP_FLUX_FLOOR_BLEND
    : state.fluxFloor;
  const rmsThreshold = Math.max(
    QUEEN_CLAP_RMS_THRESHOLD,
    noiseFloor + QUEEN_CLAP_RMS_NOISE_MARGIN,
  );
  const rearmThreshold = Math.max(
    QUEEN_CLAP_REARM_RMS,
    noiseFloor + QUEEN_CLAP_REARM_NOISE_MARGIN,
  );
  const valleyRmsSincePulse = state.lastPulseAt > 0
    ? Math.min(state.valleyRmsSincePulse, metrics.rms)
    : state.valleyRmsSincePulse;
  const relativeRearmed =
    state.lastPulseAt > 0 &&
    metrics.nowMs - state.lastPulseAt >= QUEEN_CLAP_RELATIVE_REARM_MS &&
    valleyRmsSincePulse <=
      Math.max(rearmThreshold, state.lastPulseRms * QUEEN_CLAP_RELATIVE_REARM_RATIO);
  const quiet = metrics.rms <= rearmThreshold || relativeRearmed;
  let next: QueenClapDetectorState = {
    ...state,
    noiseFloor,
    fluxFloor,
    valleyRmsSincePulse,
    armed: quiet ? true : state.armed,
  };

  if (
    next.firstClapAt > 0 &&
    metrics.nowMs - next.firstClapAt > QUEEN_CLAP_DOUBLE_WINDOW_MS
  ) {
    next = { ...next, firstClapAt: 0, firstClapPeak: 0, firstClapFlux: 0 };
  }

  const loud =
    metrics.rms >= rmsThreshold &&
    metrics.peak >= QUEEN_CLAP_PEAK_THRESHOLD &&
    onsetLike &&
    clapShaped &&
    (metrics.highFrequencyRatio ?? 1) >=
      QUEEN_CLAP_HIGH_FREQUENCY_RATIO_THRESHOLD;
  if (!loud || !next.armed) return { state: next, activated: false };

  const sinceLastPulse = metrics.nowMs - next.lastPulseAt;
  if (sinceLastPulse < QUEEN_CLAP_PULSE_COOLDOWN_MS) {
    return { state: next, activated: false };
  }

  if (
    next.lastActivationAt > 0 &&
    metrics.nowMs - next.lastActivationAt < QUEEN_CLAP_ACTIVATION_COOLDOWN_MS
  ) {
    return {
      state: { ...next, lastPulseAt: metrics.nowMs, armed: false },
      activated: false,
    };
  }

  if (next.firstClapAt > 0) {
    const spacing = metrics.nowMs - next.firstClapAt;
    const comparablePeak =
      next.firstClapPeak <= 0 ||
      metrics.peak >= next.firstClapPeak * QUEEN_CLAP_SECOND_PEAK_RATIO;
    const comparableFlux =
      next.firstClapFlux <= 0 ||
      spectralFlux >= next.firstClapFlux * QUEEN_CLAP_SECOND_FLUX_RATIO;
    if (
      spacing >= QUEEN_CLAP_MIN_SPACING_MS &&
      spacing <= QUEEN_CLAP_DOUBLE_WINDOW_MS &&
      comparablePeak &&
      comparableFlux
    ) {
      return {
        state: {
          ...next,
          firstClapAt: 0,
          firstClapPeak: 0,
          firstClapFlux: 0,
          lastPulseAt: metrics.nowMs,
          lastPulseRms: metrics.rms,
          lastActivationAt: metrics.nowMs,
          armed: false,
          valleyRmsSincePulse: metrics.rms,
        },
        activated: true,
      };
    }
  }

  return {
    state: {
      ...next,
      firstClapAt: metrics.nowMs,
      firstClapPeak: metrics.peak,
      firstClapFlux: spectralFlux,
      lastPulseAt: metrics.nowMs,
      lastPulseRms: metrics.rms,
      armed: false,
      valleyRmsSincePulse: metrics.rms,
    },
    activated: false,
  };
}
