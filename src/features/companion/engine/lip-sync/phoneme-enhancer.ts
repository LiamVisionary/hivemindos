/**
 * Rhubarb-inspired phoneme enhancement pipeline.
 * Ported from ami-ai-companion src/lib/animations/phoneme-enhancer.ts.
 *
 * Preprocesses a PhonemeInfo[] array to produce more natural lip sync by:
 *   1. Splitting diphthongs into two-phase mouth shapes
 *   2. Inserting brief mouth closures before plosive consonants
 *   3. Adding transition tweens between distant viseme shapes
 *   4. Scaling intensity based on phoneme duration
 *
 * All functions are pure — no side effects, no mutations.
 * Enhancement 5 (long-hold relaxation) lives in LipSyncController's
 * per-frame computation since it depends on real-time playback progress.
 *
 * Reference: github.com/DanielSWolf/rhubarb-lip-sync (animationRules.cpp, tweening.cpp)
 */
import type { PhonemeInfo } from './lip-sync-controller';
import { getVisemeIndex } from './viseme-mapping';

// ── Constants ──

const DEFAULT_LAST_PHONEME_DURATION_S = 0.5;
const DIPHTHONG_FIRST_RATIO = 0.6;

const MIN_OCCLUSION_S = 0.04;
const MAX_OCCLUSION_S = 0.12;

const MIN_TWEEN_DURATION_S = 0.04;
const MAX_TWEEN_DURATION_S = 0.08;

const SHORT_PHONEME_THRESHOLD_S = 0.08;
const SHORT_PHONEME_INTENSITY = 0.7;

// ── Diphthong splitting ──

/**
 * IPA diphthongs → two simple IPA phonemes whose viseme indices
 * represent the mouth's start and end positions.
 *
 * Only includes pairs where start/end map to DIFFERENT VRM visemes;
 * diphthongs like eɪ (both halves → viseme 3) are skipped since
 * splitting them produces no visible change in our 5-viseme system.
 */
const DIPHTHONG_SPLITS: Readonly<Record<string, readonly [string, string]>> = {
  'aɪ': ['a', 'i'],   // aa(0) → ee(3)
  'oʊ': ['o', 'u'],   // oh(4) → ou(2)
  'aʊ': ['a', 'o'],   // aa(0) → oh(4)
  'ɔɪ': ['o', 'i'],   // oh(4) → ee(3)
  'ɪə': ['i', 'ə'],   // ee(3) → ih(1)
  'eə': ['e', 'ə'],   // ee(3) → ih(1)
  'ʊə': ['u', 'ə'],   // ou(2) → ih(1)
};

function splitDiphthongs(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  const result: PhonemeInfo[] = [];

  for (let i = 0; i < phonemes.length; i++) {
    const current = phonemes[i];
    const split = DIPHTHONG_SPLITS[current.phoneme];

    if (!split) {
      result.push(current);
      continue;
    }

    const start = current.startOffsetS ?? 0;
    const nextStart = phonemes[i + 1]?.startOffsetS
      ?? (start + DEFAULT_LAST_PHONEME_DURATION_S);
    const splitPoint = start + (nextStart - start) * DIPHTHONG_FIRST_RATIO;

    result.push(
      { phoneme: split[0], startOffsetS: start, intensity: current.intensity },
      { phoneme: split[1], startOffsetS: splitPoint, intensity: current.intensity },
    );
  }

  return result;
}

// ── Plosive pre-closure ──

const PLOSIVE_PHONEMES = new Set(['p', 'b', 't', 'd', 'k', 'g']);

function insertPlosiveClosures(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  const result: PhonemeInfo[] = [];

  for (let i = 0; i < phonemes.length; i++) {
    const current = phonemes[i];

    if (!PLOSIVE_PHONEMES.has(current.phoneme)) {
      result.push(current);
      continue;
    }

    const currentStart = current.startOffsetS ?? 0;
    const prevStart = phonemes[i - 1]?.startOffsetS ?? 0;
    const prevDuration = currentStart - prevStart;
    const occlusionDuration = clamp(prevDuration / 2, MIN_OCCLUSION_S, MAX_OCCLUSION_S);
    const closureStart = currentStart - occlusionDuration;

    // Only insert if there's room (don't stomp on the previous phoneme)
    if (i === 0 || closureStart > prevStart + 0.02) {
      result.push({ phoneme: 'sil', startOffsetS: closureStart });
    }

    result.push(current);
  }

  return result;
}

// ── Transition tweens ──

/**
 * Viseme-index pairs that benefit from an intermediate mouth shape.
 * Key format: "fromIndex,toIndex" → IPA phoneme that maps to the tween viseme.
 *
 * Ported from Rhubarb's getTween() rules, translated to our 5-viseme system:
 *   - Open(aa) ↔ Rounded(ou): tween through oh
 *   - Open(aa) ↔ Wide(ee):    tween through ih
 *   - Rounded(ou) ↔ Wide(ee):  tween through oh
 *   - Open(aa) ↔ OpenRound(oh): tween through ih
 */
const TWEEN_MAP = new Map<string, string>([
  ['0,2', 'o'],  // aa → ou: through oh(4)
  ['2,0', 'o'],  // ou → aa: through oh(4)
  ['0,3', 'ə'],  // aa → ee: through ih(1)
  ['3,0', 'ə'],  // ee → aa: through ih(1)
  ['2,3', 'o'],  // ou → ee: through oh(4)
  ['3,2', 'o'],  // ee → ou: through oh(4)
  ['0,4', 'ə'],  // aa → oh: through ih(1)
  ['4,0', 'ə'],  // oh → aa: through ih(1)
]);

function insertTransitionTweens(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  const result: PhonemeInfo[] = [];

  for (let i = 0; i < phonemes.length; i++) {
    result.push(phonemes[i]);

    const next = phonemes[i + 1];
    if (!next) continue;

    const fromViseme = getVisemeIndex(phonemes[i].phoneme);
    const toViseme = getVisemeIndex(next.phoneme);

    if (fromViseme < 0 || toViseme < 0) continue;
    if (fromViseme === toViseme) continue;

    const tweenPhoneme = TWEEN_MAP.get(`${fromViseme},${toViseme}`);
    if (!tweenPhoneme) continue;

    const currentStart = phonemes[i].startOffsetS ?? 0;
    const nextStart = next.startOffsetS ?? 0;
    const gap = nextStart - currentStart;

    if (gap < MIN_TWEEN_DURATION_S * 2) continue;

    const tweenDuration = clamp(gap * 0.3, MIN_TWEEN_DURATION_S, MAX_TWEEN_DURATION_S);
    const tweenStart = nextStart - tweenDuration;

    result.push({ phoneme: tweenPhoneme, startOffsetS: tweenStart });
  }

  return result;
}

// ── Duration-aware intensity ──

function applyDurationIntensity(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  return phonemes.map((phoneme, i) => {
    const start = phoneme.startOffsetS ?? 0;
    const nextStart = phonemes[i + 1]?.startOffsetS
      ?? (start + DEFAULT_LAST_PHONEME_DURATION_S);
    const duration = nextStart - start;

    if (duration >= SHORT_PHONEME_THRESHOLD_S) return phoneme;

    const intensity = (phoneme.intensity ?? 1.0) * SHORT_PHONEME_INTENSITY;
    return { ...phoneme, intensity };
  });
}

// ── Helpers ──

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sortByOffset(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  return [...phonemes].sort(
    (a, b) => (a.startOffsetS ?? 0) - (b.startOffsetS ?? 0),
  );
}

// ── Public API ──

/**
 * Runs all Rhubarb-inspired enhancements on a phoneme array.
 * Each step operates on the sorted output of the previous step.
 * Returns a new array — the input is never mutated.
 */
export function enhancePhonemes(phonemes: PhonemeInfo[]): PhonemeInfo[] {
  if (phonemes.length === 0) return phonemes;

  let result = splitDiphthongs(phonemes);
  result = sortByOffset(result);

  result = insertPlosiveClosures(result);
  result = sortByOffset(result);

  result = insertTransitionTweens(result);
  result = sortByOffset(result);

  result = applyDurationIntensity(result);

  return result;
}
