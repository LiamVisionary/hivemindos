/**
 * ExpressionMixer — Arbitration Layer (Layer C)
 *
 * Resolves multiple active intents + base emotional state into final
 * per-channel values using priority, region masks, envelope weights,
 * and personality modifiers.
 */

import {
  type ChannelValues,
  type ExpressionIntent,
  type ExpressionRegion,
  type EmotionalState,
  type ExpressionPersonalityProfile,
  type GazeTarget,
  type HeadPoseOffset,
  type BlinkModulation,
  ALL_REGIONS,
  createNeutralChannels,
} from './types';
import { EXPRESSION_RECIPE_MAP } from './expression-recipes';
import type { ExpressionIntentSystem } from './expression-intent-system';

interface RegionContribution {
  value: number;
  weight: number;
  priority: number;
}

export class ExpressionMixer {
  private output: ChannelValues = createNeutralChannels();

  /**
   * Mix base emotional state + active intents into final channel values.
   * Called once per frame.
   */
  mix(
    emotionalState: EmotionalState,
    intentSystem: ExpressionIntentSystem,
    personality: ExpressionPersonalityProfile,
  ): ChannelValues {
    const channels = createNeutralChannels();
    const activeIntents = intentSystem.getActiveIntents();

    // --- Step 1: Compute base channels from emotional state ---
    const base = this.emotionalStateToChannels(emotionalState, personality);

    // --- Step 2: Collect per-region contributions from intents ---
    const regionContribs: Record<ExpressionRegion, RegionContribution[]> = {
      brows: [], eyelids: [], gaze: [], mouthCorners: [],
      jawBias: [], headPose: [], blinkMod: [],
    };

    for (const intent of activeIntents) {
      const envelopeWeight = intentSystem.evaluateEnvelope(intent);
      if (envelopeWeight <= 0.001) continue;

      const recipe = intent.preset ? EXPRESSION_RECIPE_MAP[intent.preset] : null;
      if (!recipe) continue;

      const regions = intent.regionMask ?? ALL_REGIONS;
      const effectiveWeight = envelopeWeight * intent.intensity * personality.expressiveness;

      for (const region of regions) {
        const channelDef = recipe.channels[region];
        if (!channelDef) continue;

        if (region === 'gaze' || region === 'headPose' || region === 'blinkMod') {
          // These are handled separately below
          regionContribs[region].push({
            value: 0, // placeholder
            weight: effectiveWeight,
            priority: intent.priority,
          });
        } else {
          // Use the recipe target directly. The effectiveWeight (envelope * intensity
          // * expressiveness) controls how much this intent overrides the base.
          // Recipe per-channel weights are ignored — target values are already calibrated.
          const cv = channelDef as { target: number; weight: number };
          regionContribs[region].push({
            value: cv.target,
            weight: effectiveWeight,
            priority: intent.priority,
          });
        }
      }
    }

    // --- Step 3: Resolve scalar channels (brows, eyelids, mouthCorners, jawBias) ---
    channels.brows = this.resolveScalarChannel(base.brows, regionContribs.brows);
    channels.eyelids = this.resolveScalarChannel(base.eyelids, regionContribs.eyelids);
    channels.mouthCorners = this.resolveScalarChannel(base.mouthCorners, regionContribs.mouthCorners);
    channels.jawBias = this.resolveScalarChannel(base.jawBias, regionContribs.jawBias);

    // --- Step 4: Resolve gaze ---
    channels.gaze = this.resolveGaze(base.gaze, activeIntents, intentSystem, personality);

    // --- Step 5: Resolve head pose ---
    channels.headPose = this.resolveHeadPose(base.headPose, activeIntents, intentSystem, personality);

    // --- Step 6: Resolve blink modulation ---
    channels.blinkMod = this.resolveBlinkMod(base.blinkMod, activeIntents, intentSystem, personality);

    this.output = channels;
    return channels;
  }

  getCurrentOutput(): ChannelValues {
    return { ...this.output };
  }

  // -------------------------------------------------------------------------
  // Emotional state → base channel values
  // -------------------------------------------------------------------------

  private emotionalStateToChannels(
    state: EmotionalState,
    personality: ExpressionPersonalityProfile,
  ): ChannelValues {
    const ch = createNeutralChannels();
    const p = personality;

    // Brows: raised by surprise/curiosity, furrowed by irritation/tension
    ch.brows = (state.curiosity * 0.3 + state.joy * 0.15)
      - (state.irritation * 0.3 + state.tension * 0.2);

    // Eyelids: narrowed by tension/irritation/sleepiness, widened by curiosity
    ch.eyelids = (state.curiosity * 0.2)
      - (state.tension * 0.15 + state.irritation * 0.1 + (1 - state.energy) * 0.2);

    // Mouth corners: up from joy/warmth/playfulness, down from sadness/irritation
    // SmileBias is suppressed when negative emotions are active (no smiling while angry/sad)
    // Joy can partially override negative suppression — you can smile through sadness in a happy moment
    const negativeIntensity = state.sadness + state.irritation + state.tension * 0.5;
    const joyOverride = Math.min(1, state.joy * 1.5);
    const effectiveSmileBias = p.smileBias * Math.max(0, 1 - negativeIntensity * 2 * (1 - joyOverride * 0.5));
    ch.mouthCorners = (state.joy * 0.4 + state.warmth * 0.2 + state.playfulness * 0.15 + effectiveSmileBias * 0.2)
      - (state.sadness * 0.35 * (1 - joyOverride * 0.6) + state.irritation * 0.25);

    // Gaze: more aversion when shy/sad, more direct when confident
    const gazeAversion = state.shyness * 0.5 + state.sadness * 0.35;
    const gazeDirectness = state.confidence * 0.3 + state.curiosity * 0.2;
    const netGaze = gazeDirectness - gazeAversion;
    ch.gaze = {
      horizontal: netGaze < 0 ? gazeAversion * -0.5 * (1 - p.gazeStability * 0.6) : 0,
      vertical: netGaze < 0 ? gazeAversion * -0.35 : 0,
    };

    // Head pose from emotional state
    ch.headPose = {
      pitch: (state.shyness * 2 + state.sadness * 2 - state.confidence * 1) * p.headMotionAmount,
      yaw: (state.shyness * -2 + state.playfulness * 1.5) * p.headMotionAmount,
      roll: (state.warmth * 2 + state.shyness * 3 - state.irritation * 1) * p.headMotionAmount,
    };

    // Blink modulation from state
    ch.blinkMod = {
      intervalScale: 1 + (state.tension * -0.3) + ((1 - state.energy) * 0.3),
      amplitudeScale: 1 + (state.sadness * 0.2) + (p.blinkSoftness * 0.15),
      durationScale: 1 + ((1 - state.energy) * 0.2) + (state.shyness * 0.1),
    };

    return ch;
  }

  // -------------------------------------------------------------------------
  // Channel resolution helpers
  // -------------------------------------------------------------------------

  private resolveScalarChannel(base: number, contribs: RegionContribution[]): number {
    if (contribs.length === 0) return base;

    // Priority determines WHICH intent's value wins when multiple compete,
    // but does NOT reduce overall intent influence over the base.
    let priorityWeightedSum = 0;
    let priorityWeightTotal = 0;
    let rawWeightSum = 0;

    for (const c of contribs) {
      const priorityW = c.weight * (c.priority / 100);
      priorityWeightedSum += c.value * priorityW;
      priorityWeightTotal += priorityW;
      rawWeightSum += c.weight;
    }

    if (priorityWeightTotal <= 0) return base;

    // Intent value: priority-weighted average (higher priority = more say)
    const intentValue = priorityWeightedSum / priorityWeightTotal;
    // Intent influence over base: uses raw weight so intents can fully override
    const intentInfluence = Math.min(1, rawWeightSum);
    return base * (1 - intentInfluence) + intentValue * intentInfluence;
  }

  private resolveGaze(
    base: GazeTarget,
    intents: ExpressionIntent[],
    intentSystem: ExpressionIntentSystem,
    personality: ExpressionPersonalityProfile,
  ): GazeTarget {
    let h = base.horizontal;
    let v = base.vertical;
    let maxWeight = 0;

    for (const intent of intents) {
      if (!intent.preset) continue;
      const recipe = EXPRESSION_RECIPE_MAP[intent.preset];
      if (!recipe?.channels.gaze) continue;

      const regions = intent.regionMask ?? ALL_REGIONS;
      if (!regions.includes('gaze')) continue;

      const envW = intentSystem.evaluateEnvelope(intent);
      const w = envW * intent.intensity;
      if (w <= maxWeight) continue;

      maxWeight = w;
      const gp = recipe.channels.gaze;
      // Convert gaze mode to target values
      const [gh, gv] = gazeModeToTarget(gp.mode, gp.intensity, personality.gazeStability);
      h = lerp(h, gh, w);
      v = lerp(v, gv, w);
    }

    return { horizontal: clamp(h, -1, 1), vertical: clamp(v, -1, 1) };
  }

  private resolveHeadPose(
    base: HeadPoseOffset,
    intents: ExpressionIntent[],
    intentSystem: ExpressionIntentSystem,
    personality: ExpressionPersonalityProfile,
  ): HeadPoseOffset {
    let pitch = base.pitch;
    let yaw = base.yaw;
    let roll = base.roll;

    for (const intent of intents) {
      if (!intent.preset) continue;
      const recipe = EXPRESSION_RECIPE_MAP[intent.preset];
      if (!recipe?.channels.headPose) continue;

      const regions = intent.regionMask ?? ALL_REGIONS;
      if (!regions.includes('headPose')) continue;

      const envW = intentSystem.evaluateEnvelope(intent);
      const hp = recipe.channels.headPose;
      // Recipe weight scales the headPose blend to prevent bobblehead on expressive recipes
      const recipeWeight = hp.weight ?? 1;
      const w = envW * intent.intensity * personality.headMotionAmount * recipeWeight;

      pitch = lerp(pitch, hp.pitch, w);
      yaw = lerp(yaw, hp.yaw, w);
      roll = lerp(roll, hp.roll, w);
    }

    return {
      pitch: clamp(pitch, -8, 8),
      yaw: clamp(yaw, -10, 10),
      roll: clamp(roll, -10, 10),
    };
  }

  private resolveBlinkMod(
    base: BlinkModulation,
    intents: ExpressionIntent[],
    intentSystem: ExpressionIntentSystem,
    _personality: ExpressionPersonalityProfile,
  ): BlinkModulation {
    let interval = base.intervalScale;
    let amplitude = base.amplitudeScale;
    let duration = base.durationScale;

    for (const intent of intents) {
      if (!intent.preset) continue;
      const recipe = EXPRESSION_RECIPE_MAP[intent.preset];
      if (!recipe?.channels.blinkMod) continue;

      const regions = intent.regionMask ?? ALL_REGIONS;
      if (!regions.includes('blinkMod')) continue;

      const envW = intentSystem.evaluateEnvelope(intent);
      const w = envW * intent.intensity;
      const bm = recipe.channels.blinkMod;

      interval = lerp(interval, bm.intervalScale, w);
      amplitude = lerp(amplitude, bm.amplitudeScale, w);
      duration = lerp(duration, bm.durationScale, w);
    }

    return { intervalScale: interval, amplitudeScale: amplitude, durationScale: duration };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gazeModeToTarget(
  mode: string,
  intensity: number,
  gazeStability: number,
): [horizontal: number, vertical: number] {
  const i = intensity;
  const _drift = (1 - gazeStability) * 0.15;

  switch (mode) {
    case 'user_focus':      return [0, 0];
    case 'soft_eye_contact': return [0, 0]; // no directional bias — gaze breaks handle natural movement
    case 'look_away_down':  return [-0.5 * i, -0.6 * i];
    case 'side_glance':     return [0.6 * i, 0.08];
    case 'thinking_up':     return [-0.25 * i, 0.5 * i];
    case 'scanning':        return [0.2 * i, 0.1 * i];
    case 'defocused':       return [0.1, -0.05];
    case 'return_to_user':  return [0, 0];
    default:                return [0, 0];
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
