/**
 * Personality Profiles — Per-character expression behavior presets
 *
 * Different character archetypes animate differently even with the same dialogue.
 * These profiles modify expression intensity, gaze behavior, head motion, etc.
 */

import type { ExpressionPersonalityProfile } from './types';
import { createDefaultPersonality } from './types';

/** Built-in personality archetypes */
export const PERSONALITY_PRESETS: Record<string, ExpressionPersonalityProfile> = {
  /** Default balanced personality */
  default: createDefaultPersonality(),

  /** Reserved / introverted — less expression, more gaze aversion */
  reserved: {
    expressiveness: 0.35,
    gazeStability: 0.35,
    headMotionAmount: 0.3,
    blinkSoftness: 0.6,
    smileBias: 0.1,
    shynessBias: 0.5,
    playfulnessBias: 0.15,
    recoverySpeed: 0.35,
  },

  /** Expressive / animated — bigger reactions, more motion */
  expressive: {
    expressiveness: 0.85,
    gazeStability: 0.6,
    headMotionAmount: 0.7,
    blinkSoftness: 0.4,
    smileBias: 0.4,
    shynessBias: 0.15,
    playfulnessBias: 0.5,
    recoverySpeed: 0.65,
  },

  /** Bubbly / energetic — high energy, lots of smiles */
  bubbly: {
    expressiveness: 0.9,
    gazeStability: 0.55,
    headMotionAmount: 0.75,
    blinkSoftness: 0.35,
    smileBias: 0.55,
    shynessBias: 0.1,
    playfulnessBias: 0.7,
    recoverySpeed: 0.7,
  },

  /** Stoic / calm — minimal expression, steady gaze */
  stoic: {
    expressiveness: 0.2,
    gazeStability: 0.8,
    headMotionAmount: 0.15,
    blinkSoftness: 0.45,
    smileBias: 0.05,
    shynessBias: 0.05,
    playfulnessBias: 0.05,
    recoverySpeed: 0.3,
  },

  /** Flirtatious — asymmetric expressions, teasing gaze */
  flirtatious: {
    expressiveness: 0.75,
    gazeStability: 0.5,
    headMotionAmount: 0.6,
    blinkSoftness: 0.55,
    smileBias: 0.35,
    shynessBias: 0.25,
    playfulnessBias: 0.65,
    recoverySpeed: 0.55,
  },

  /** Shy / timid — frequent gaze aversion, softer expressions */
  timid: {
    expressiveness: 0.4,
    gazeStability: 0.25,
    headMotionAmount: 0.35,
    blinkSoftness: 0.7,
    smileBias: 0.2,
    shynessBias: 0.7,
    playfulnessBias: 0.2,
    recoverySpeed: 0.4,
  },

  /** Confident / assertive — steady gaze, strong expressions */
  confident: {
    expressiveness: 0.7,
    gazeStability: 0.75,
    headMotionAmount: 0.45,
    blinkSoftness: 0.35,
    smileBias: 0.25,
    shynessBias: 0.05,
    playfulnessBias: 0.3,
    recoverySpeed: 0.6,
  },

  /** Giggly — high smile, high playfulness, bouncy motion */
  giggly: {
    expressiveness: 0.9,
    gazeStability: 0.5,
    headMotionAmount: 0.8,
    blinkSoftness: 0.4,
    smileBias: 0.65,
    shynessBias: 0.1,
    playfulnessBias: 0.8,
    recoverySpeed: 0.75,
  },
};

/**
 * Create a personality profile by merging a preset with custom overrides.
 */
export function createPersonalityProfile(
  preset: string = 'default',
  overrides?: Partial<ExpressionPersonalityProfile>,
): ExpressionPersonalityProfile {
  const base = PERSONALITY_PRESETS[preset] ?? PERSONALITY_PRESETS.default;
  return { ...base, ...overrides };
}
