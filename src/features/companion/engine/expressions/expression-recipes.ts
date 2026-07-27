/**
 * Expression Recipes — Channel-based preset definitions
 *
 * Replaces flat VRM blend shape presets with multi-channel recipes
 * that include gaze, head motion, blink modulation, and emotional influence.
 *
 * Head pose values are in DEGREES (converted to radians by the controller).
 * Values of 5-10° produce clearly visible movement.
 * Gaze intensity of 0.5+ is needed for visible eye movement.
 * Brows/mouth are mapped to individual morph targets (Fcl_BRW_*, Fcl_MTH_*)
 * by the VRM bridge for fine-grained control.
 */

import type {
  ExpressionRecipe,
  ExpressionTone,
} from './types';

// ---------------------------------------------------------------------------
// Base Affects
// ---------------------------------------------------------------------------

const neutral: ExpressionRecipe = {
  name: 'neutral',
  channels: {
    brows: { target: 0, weight: 0.5 },
    eyelids: { target: 0, weight: 0.5 },
    mouthCorners: { target: 0, weight: 0.6 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.3 },
    headPose: { pitch: 0, yaw: 0, roll: 0, weight: 0.3 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: {},
  defaultEnvelope: { attackMs: 200, sustainMs: 600, releaseMs: 300, curve: 'easeInOut' },
};

const warm: ExpressionRecipe = {
  name: 'warm',
  channels: {
    brows: { target: 0.15, weight: 0.5 },
    eyelids: { target: -0.08, weight: 0.4 },
    mouthCorners: { target: 0.3, weight: 0.6 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.5 },
    headPose: { pitch: -3, yaw: 0, roll: 5, weight: 0.4 },
    blinkMod: { intervalScale: 1.1, amplitudeScale: 1, durationScale: 1.05 },
  },
  emotionalInfluence: { warmth: 0.1, affection: 0.05 },
  defaultEnvelope: { attackMs: 250, sustainMs: 800, releaseMs: 400, curve: 'easeInOut' },
};

const relaxed: ExpressionRecipe = {
  name: 'relaxed',
  channels: {
    brows: { target: -0.05, weight: 0.4 },
    eyelids: { target: -0.15, weight: 0.5 },
    mouthCorners: { target: 0.12, weight: 0.4 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.3 },
    headPose: { pitch: -2, yaw: 0, roll: 3, weight: 0.3 },
    blinkMod: { intervalScale: 1.2, amplitudeScale: 1.1, durationScale: 1.1 },
  },
  emotionalInfluence: { tension: -0.05 },
  defaultEnvelope: { attackMs: 300, sustainMs: 700, releaseMs: 450, curve: 'easeInOut' },
};

const happy: ExpressionRecipe = {
  name: 'happy',
  channels: {
    brows: { target: 0.25, weight: 0.5 },
    eyelids: { target: -0.08, weight: 0.4 },
    mouthCorners: { target: 0.55, weight: 0.7 },
    jawBias: { target: 0.1, weight: 0.3 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.5 },
    headPose: { pitch: -2, yaw: 0, roll: 3, weight: 0.35 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { joy: 0.08 },
  defaultEnvelope: { attackMs: 180, sustainMs: 700, releaseMs: 350, curve: 'easeInOut' },
};

const low: ExpressionRecipe = {
  name: 'low',
  channels: {
    brows: { target: 0.1, weight: 0.4 },
    eyelids: { target: -0.2, weight: 0.5 },
    mouthCorners: { target: -0.2, weight: 0.5 },
    gaze: { mode: 'look_away_down', intensity: 0.5 },
    headPose: { pitch: 6, yaw: -3, roll: 0, weight: 0.4 },
    blinkMod: { intervalScale: 1.3, amplitudeScale: 1.2, durationScale: 1.2 },
  },
  emotionalInfluence: { sadness: 0.05, energy: -0.05 },
  defaultEnvelope: { attackMs: 350, sustainMs: 800, releaseMs: 500, curve: 'easeInOut' },
};

const tense: ExpressionRecipe = {
  name: 'tense',
  channels: {
    brows: { target: -0.28, weight: 0.6 },
    eyelids: { target: -0.12, weight: 0.45 },
    mouthCorners: { target: -0.12, weight: 0.4 },
    gaze: { mode: 'user_focus', intensity: 0.6 },
    headPose: { pitch: -2, yaw: 0, roll: 0, weight: 0.3 },
    blinkMod: { intervalScale: 0.7, amplitudeScale: 0.8, durationScale: 0.8 },
  },
  emotionalInfluence: { tension: 0.08 },
  defaultEnvelope: { attackMs: 150, sustainMs: 600, releaseMs: 300, curve: 'easeIn' },
};

const sad: ExpressionRecipe = {
  name: 'sad',
  channels: {
    brows: { target: 0.35, weight: 0.7 },
    eyelids: { target: -0.25, weight: 0.55 },
    mouthCorners: { target: -0.45, weight: 0.85 },
    gaze: { mode: 'look_away_down', intensity: 0.65 },
    headPose: { pitch: 7, yaw: -3, roll: -3, weight: 0.5 },
    blinkMod: { intervalScale: 1.4, amplitudeScale: 1.3, durationScale: 1.3 },
  },
  emotionalInfluence: { sadness: 0.1 },
  defaultEnvelope: { attackMs: 300, sustainMs: 900, releaseMs: 500, curve: 'easeInOut' },
};

const irritated: ExpressionRecipe = {
  name: 'irritated',
  channels: {
    brows: { target: -0.45, weight: 0.7 },
    eyelids: { target: -0.2, weight: 0.5 },
    mouthCorners: { target: -0.35, weight: 0.6 },
    gaze: { mode: 'user_focus', intensity: 0.7 },
    headPose: { pitch: -3, yaw: 0, roll: 0, weight: 0.3 },
    blinkMod: { intervalScale: 0.6, amplitudeScale: 0.7, durationScale: 0.7 },
  },
  emotionalInfluence: { irritation: 0.1, tension: 0.05 },
  defaultEnvelope: { attackMs: 120, sustainMs: 700, releaseMs: 350, curve: 'fastAttackSlowRelease' },
};

// ---------------------------------------------------------------------------
// Social Modifiers
// ---------------------------------------------------------------------------

const shy: ExpressionRecipe = {
  name: 'shy',
  channels: {
    brows: { target: 0.2, weight: 0.5 },
    eyelids: { target: -0.12, weight: 0.45 },
    mouthCorners: { target: 0.12, weight: 0.4 },
    gaze: { mode: 'look_away_down', intensity: 0.7 },
    headPose: { pitch: 7, yaw: -7, roll: 8, weight: 0.65 },
    blinkMod: { intervalScale: 1.1, amplitudeScale: 1.15, durationScale: 1.2 },
  },
  emotionalInfluence: { shyness: 0.12, warmth: 0.06 },
  defaultEnvelope: { attackMs: 200, sustainMs: 700, releaseMs: 400, curve: 'easeInOut' },
};

const teasing: ExpressionRecipe = {
  name: 'teasing',
  channels: {
    brows: { target: 0.25, weight: 0.5 },
    eyelids: { target: -0.1, weight: 0.4 },
    mouthCorners: { target: 0.35, weight: 0.6 },
    gaze: { mode: 'side_glance', intensity: 0.6 },
    headPose: { pitch: -3, yaw: 6, roll: -6, weight: 0.55 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { playfulness: 0.1, confidence: 0.06 },
  defaultEnvelope: { attackMs: 150, sustainMs: 600, releaseMs: 250, curve: 'fastAttackSlowRelease' },
};

const smug: ExpressionRecipe = {
  name: 'smug',
  channels: {
    brows: { target: 0.3, weight: 0.5 },
    eyelids: { target: -0.15, weight: 0.5 },
    mouthCorners: { target: 0.3, weight: 0.55 },
    gaze: { mode: 'side_glance', intensity: 0.55 },
    headPose: { pitch: -4, yaw: 4, roll: -4, weight: 0.45 },
    blinkMod: { intervalScale: 1.1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { confidence: 0.1, playfulness: 0.05 },
  defaultEnvelope: { attackMs: 180, sustainMs: 700, releaseMs: 300, curve: 'easeInOut' },
};

const lipBite: ExpressionRecipe = {
  name: 'lipBite',
  channels: {
    brows: { target: 0.16, weight: 0.45 },
    eyelids: { target: -0.05, weight: 0.25 },
    mouthCorners: { target: 0.18, weight: 0.45 },
    gaze: { mode: 'side_glance', intensity: 0.6 },
    headPose: { pitch: -2, yaw: 5, roll: -5, weight: 0.45 },
    blinkMod: { intervalScale: 1.1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { playfulness: 0.08, confidence: 0.05, affection: 0.03 },
  defaultEnvelope: { attackMs: 120, sustainMs: 650, releaseMs: 300, curve: 'fastAttackSlowRelease' },
};

const pucker: ExpressionRecipe = {
  name: 'pucker',
  channels: {
    brows: { target: 0.05, weight: 0.25 },
    eyelids: { target: -0.05, weight: 0.2 },
    mouthCorners: { target: 0, weight: 0.2 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.35 },
    headPose: { pitch: -1, yaw: 0, roll: 0, weight: 0.2 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { playfulness: 0.04, affection: 0.04 },
  defaultEnvelope: { attackMs: 100, sustainMs: 500, releaseMs: 260, curve: 'fastAttackSlowRelease' },
};

const pouty: ExpressionRecipe = {
  name: 'pouty',
  channels: {
    brows: { target: 0.15, weight: 0.5 },
    eyelids: { target: -0.1, weight: 0.4 },
    mouthCorners: { target: -0.3, weight: 0.6 },
    gaze: { mode: 'look_away_down', intensity: 0.5 },
    headPose: { pitch: 5, yaw: -5, roll: 5, weight: 0.5 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { irritation: 0.04, sadness: 0.03 },
  defaultEnvelope: { attackMs: 200, sustainMs: 800, releaseMs: 400, curve: 'easeInOut' },
};

const affectionate: ExpressionRecipe = {
  name: 'affectionate',
  channels: {
    brows: { target: 0.22, weight: 0.6 },
    eyelids: { target: 0, weight: 0.3 },
    mouthCorners: { target: 0.5, weight: 0.85 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.6 },
    headPose: { pitch: -3, yaw: 0, roll: 6, weight: 0.5 },
    blinkMod: { intervalScale: 1.15, amplitudeScale: 1.1, durationScale: 1.1 },
  },
  emotionalInfluence: { affection: 0.12, warmth: 0.08 },
  defaultEnvelope: { attackMs: 280, sustainMs: 900, releaseMs: 450, curve: 'easeInOut' },
};

const embarrassed: ExpressionRecipe = {
  name: 'embarrassed',
  channels: {
    brows: { target: 0.3, weight: 0.55 },
    eyelids: { target: -0.12, weight: 0.4 },
    mouthCorners: { target: 0.1, weight: 0.35 },
    gaze: { mode: 'look_away_down', intensity: 0.8 },
    headPose: { pitch: 8, yaw: -8, roll: 8, weight: 0.7 },
    blinkMod: { intervalScale: 0.9, amplitudeScale: 1.2, durationScale: 1.15 },
  },
  emotionalInfluence: { shyness: 0.15, warmth: 0.05 },
  defaultEnvelope: { attackMs: 150, sustainMs: 700, releaseMs: 400, curve: 'fastAttackSlowRelease' },
};

const guarded: ExpressionRecipe = {
  name: 'guarded',
  channels: {
    brows: { target: -0.15, weight: 0.5 },
    eyelids: { target: -0.1, weight: 0.4 },
    mouthCorners: { target: -0.08, weight: 0.3 },
    gaze: { mode: 'side_glance', intensity: 0.5 },
    headPose: { pitch: 2, yaw: -4, roll: 0, weight: 0.4 },
    blinkMod: { intervalScale: 0.8, amplitudeScale: 0.9, durationScale: 0.9 },
  },
  emotionalInfluence: { tension: 0.08, confidence: -0.03 },
  defaultEnvelope: { attackMs: 250, sustainMs: 800, releaseMs: 400, curve: 'easeIn' },
};

// ---------------------------------------------------------------------------
// Momentary Reactions
// ---------------------------------------------------------------------------

const curious: ExpressionRecipe = {
  name: 'curious',
  channels: {
    brows: { target: 0.35, weight: 0.7 },
    eyelids: { target: 0.2, weight: 0.5 },
    mouthCorners: { target: 0.15, weight: 0.4 },
    gaze: { mode: 'user_focus', intensity: 0.75 },
    headPose: { pitch: -3, yaw: 0, roll: 2, weight: 0.4 },
    blinkMod: { intervalScale: 1.3, amplitudeScale: 0.8, durationScale: 0.9 },
  },
  emotionalInfluence: { curiosity: 0.06, warmth: 0.04 },
  defaultEnvelope: { attackMs: 150, sustainMs: 2000, releaseMs: 600, curve: 'fastAttackSlowRelease' },
};

const surprised: ExpressionRecipe = {
  name: 'surprised',
  channels: {
    brows: { target: 0.75, weight: 0.95 },
    eyelids: { target: 0.75, weight: 0.9 },
    mouthCorners: { target: -0.15, weight: 0.6 },
    jawBias: { target: 0.5, weight: 0.75 },
    gaze: { mode: 'user_focus', intensity: 0.85 },
    headPose: { pitch: -5, yaw: 0, roll: 0, weight: 0.55 },
    blinkMod: { intervalScale: 2, amplitudeScale: 0.5, durationScale: 0.7 },
  },
  emotionalInfluence: { curiosity: 0.08 },
  defaultEnvelope: { attackMs: 80, sustainMs: 1500, releaseMs: 400, curve: 'fastAttackSlowRelease' },
};

const skeptical: ExpressionRecipe = {
  name: 'skeptical',
  channels: {
    brows: { target: 0.35, weight: 0.6 },
    eyelids: { target: -0.15, weight: 0.5 },
    mouthCorners: { target: -0.08, weight: 0.3 },
    gaze: { mode: 'side_glance', intensity: 0.6 },
    headPose: { pitch: -2, yaw: 5, roll: -3, weight: 0.45 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { curiosity: 0.05 },
  defaultEnvelope: { attackMs: 200, sustainMs: 600, releaseMs: 300, curve: 'easeInOut' },
};

const delighted: ExpressionRecipe = {
  name: 'delighted',
  channels: {
    brows: { target: 0.4, weight: 0.6 },
    eyelids: { target: -0.1, weight: 0.4 },
    mouthCorners: { target: 0.65, weight: 0.8 },
    jawBias: { target: 0.15, weight: 0.3 },
    gaze: { mode: 'user_focus', intensity: 0.6 },
    headPose: { pitch: -3, yaw: 0, roll: 5, weight: 0.45 },
    blinkMod: { intervalScale: 0.9, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { joy: 0.12, warmth: 0.06 },
  defaultEnvelope: { attackMs: 120, sustainMs: 500, releaseMs: 350, curve: 'fastAttackSlowRelease' },
};

const hurt: ExpressionRecipe = {
  name: 'hurt',
  channels: {
    brows: { target: 0.45, weight: 0.8 },
    eyelids: { target: -0.25, weight: 0.6 },
    mouthCorners: { target: -0.55, weight: 0.9 },
    gaze: { mode: 'look_away_down', intensity: 0.75 },
    headPose: { pitch: 7, yaw: -5, roll: -5, weight: 0.6 },
    blinkMod: { intervalScale: 1.3, amplitudeScale: 1.2, durationScale: 1.3 },
  },
  emotionalInfluence: { sadness: 0.1, tension: 0.05 },
  defaultEnvelope: { attackMs: 150, sustainMs: 700, releaseMs: 500, curve: 'fastAttackSlowRelease' },
};

const confused: ExpressionRecipe = {
  name: 'confused',
  channels: {
    brows: { target: 0.35, weight: 0.6 },
    eyelids: { target: 0.1, weight: 0.35 },
    mouthCorners: { target: -0.1, weight: 0.3 },
    gaze: { mode: 'thinking_up', intensity: 0.6 },
    headPose: { pitch: -3, yaw: 6, roll: 7, weight: 0.55 },
    blinkMod: { intervalScale: 0.9, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { curiosity: 0.06 },
  defaultEnvelope: { attackMs: 180, sustainMs: 500, releaseMs: 350, curve: 'easeInOut' },
};

const impressed: ExpressionRecipe = {
  name: 'impressed',
  channels: {
    brows: { target: 0.45, weight: 0.65 },
    eyelids: { target: 0.15, weight: 0.4 },
    mouthCorners: { target: 0.1, weight: 0.3 },
    jawBias: { target: 0.6, weight: 0.7 },
    gaze: { mode: 'user_focus', intensity: 0.6 },
    headPose: { pitch: -3, yaw: 0, roll: 3, weight: 0.4 },
    blinkMod: { intervalScale: 1.2, amplitudeScale: 1, durationScale: 1 },
  },
  emotionalInfluence: { curiosity: 0.08, warmth: 0.04 },
  defaultEnvelope: { attackMs: 150, sustainMs: 600, releaseMs: 350, curve: 'easeInOut' },
};

const laughing: ExpressionRecipe = {
  name: 'laughing',
  channels: {
    brows: { target: 0.3, weight: 0.5 },
    eyelids: { target: -0.35, weight: 0.6 },
    mouthCorners: { target: 0.7, weight: 0.85 },
    jawBias: { target: 0.7, weight: 0.8 },
    gaze: { mode: 'soft_eye_contact', intensity: 0.4 },
    headPose: { pitch: -4, yaw: 0, roll: 5, weight: 0.5 },
    blinkMod: { intervalScale: 1.5, amplitudeScale: 1.3, durationScale: 1.2 },
  },
  emotionalInfluence: { joy: 0.15, warmth: 0.08 },
  defaultEnvelope: { attackMs: 100, sustainMs: 600, releaseMs: 400, curve: 'fastAttackSlowRelease' },
};

// ---------------------------------------------------------------------------
// Paralinguistic-driven expressions (new — tied to vocal delivery tags)
// ---------------------------------------------------------------------------

/** Wistful — soft longing/melancholy. Far gaze, gentle downcast.
 *  Triggered by: [wistful] [longing] [melancholic] [trailing off] */
const wistful: ExpressionRecipe = {
  name: 'wistful',
  channels: {
    brows: { target: 0.18, weight: 0.45 },
    eyelids: { target: -0.2, weight: 0.55 },
    mouthCorners: { target: -0.15, weight: 0.45 },
    gaze: { mode: 'look_away_down', intensity: 0.75 },
    headPose: { pitch: 4, yaw: 8, roll: -2, weight: 0.5 },
    blinkMod: { intervalScale: 1.35, amplitudeScale: 1.15, durationScale: 1.2 },
  },
  emotionalInfluence: { sadness: 0.06, warmth: 0.04, energy: -0.03 },
  defaultEnvelope: { attackMs: 400, sustainMs: 1000, releaseMs: 600, curve: 'easeInOut' },
};

/** Scared — wide eyes, tension, scanning gaze.
 *  Triggered by: [panicking] [visibly shaken] [slightly nervous] [scared] */
const scared: ExpressionRecipe = {
  name: 'scared',
  channels: {
    brows: { target: 0.75, weight: 0.95 },
    eyelids: { target: 0.75, weight: 0.9 },
    mouthCorners: { target: -0.45, weight: 0.85 },
    jawBias: { target: 0.5, weight: 0.75 },
    gaze: { mode: 'scanning', intensity: 0.9 },
    headPose: { pitch: -5, yaw: 5, roll: -2, weight: 0.55 },
    blinkMod: { intervalScale: 0.35, amplitudeScale: 0.5, durationScale: 0.5 },
  },
  emotionalInfluence: { tension: 0.25, energy: 0.15, confidence: -0.2 },
  defaultEnvelope: { attackMs: 60, sustainMs: 2500, releaseMs: 350, curve: 'fastAttackSlowRelease' },
};

/** Determined — firm resolve, forward focus. Moderate brow furrow, neutral pressed mouth, unwavering gaze.
 *  Key diff from irritated: mouth stays near-neutral (set, not downturned). Intensity comes from gaze + blink.
 *  Triggered by: [suddenly serious] [tone darkens] [switching to serious] */
const determined: ExpressionRecipe = {
  name: 'determined',
  channels: {
    brows: { target: -0.35, weight: 0.72 },
    eyelids: { target: -0.2, weight: 0.62 },
    mouthCorners: { target: -0.06, weight: 0.5 },  // nearly neutral — lips set, not frowning
    gaze: { mode: 'user_focus', intensity: 1.0 },
    headPose: { pitch: -7, yaw: 0, roll: 0, weight: 0.62 },
    blinkMod: { intervalScale: 0.45, amplitudeScale: 0.65, durationScale: 0.75 },
  },
  emotionalInfluence: { confidence: 0.22, tension: 0.08 },
  defaultEnvelope: { attackMs: 140, sustainMs: 800, releaseMs: 450, curve: 'easeIn' },
};

/** Crying — active tears, more intense than `hurt`. Eyes squinted, jaw slightly open.
 *  Triggered by: [crying] [voice breaking] [sniffles] [quietly devastated] */
const crying: ExpressionRecipe = {
  name: 'crying',
  channels: {
    brows: { target: 0.55, weight: 0.85 },
    eyelids: { target: -0.5, weight: 0.8 },
    mouthCorners: { target: -0.65, weight: 0.9 },
    jawBias: { target: 0.25, weight: 0.4 },
    gaze: { mode: 'look_away_down', intensity: 0.85 },
    headPose: { pitch: 9, yaw: -4, roll: -5, weight: 0.65 },
    blinkMod: { intervalScale: 2.0, amplitudeScale: 1.5, durationScale: 1.4 },
  },
  emotionalInfluence: { sadness: 0.18, tension: 0.06 },
  defaultEnvelope: { attackMs: 200, sustainMs: 1200, releaseMs: 700, curve: 'easeInOut' },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EXPRESSION_RECIPE_MAP: Record<string, ExpressionRecipe> = {
  // Base affects
  neutral, warm, relaxed, happy, low, tense, sad, irritated,
  // Social modifiers
  shy, teasing, smug, lipBite, pucker, pouty, affectionate, embarrassed, guarded,
  // Momentary reactions
  curious, surprised, skeptical, delighted, hurt, confused, impressed, laughing,
  // Paralinguistic-driven
  wistful, scared, determined, crying,
};

/**
 * Map ExpressionTone (from LLM) to a recipe name.
 * Multiple tones can map to the same recipe.
 */
export const TONE_TO_RECIPE: Record<ExpressionTone, string> = {
  warm: 'warm',
  bashful: 'shy',
  teasing: 'teasing',
  sad: 'sad',
  playful: 'teasing',
  skeptical: 'skeptical',
  curious: 'curious',
  surprised: 'surprised',
  hurt: 'hurt',
  affectionate: 'affectionate',
  embarrassed: 'embarrassed',
  delighted: 'delighted',
  confused: 'confused',
  irritated: 'irritated',
  smug: 'smug',
  lipBite: 'lipBite',
  pucker: 'pucker',
  pouty: 'pouty',
  impressed: 'impressed',
  guarded: 'guarded',
  neutral: 'neutral',
  // Paralinguistic-driven tones
  wistful: 'wistful',
  scared: 'scared',
  determined: 'determined',
  crying: 'crying',
};

// Pre-computed direct tone → recipe map (avoids double lookup through TONE_TO_RECIPE then EXPRESSION_RECIPE_MAP)
const TONE_TO_RECIPE_DIRECT: Map<string, ExpressionRecipe> = new Map();
for (const [tone, recipeName] of Object.entries(TONE_TO_RECIPE)) {
  TONE_TO_RECIPE_DIRECT.set(tone, EXPRESSION_RECIPE_MAP[recipeName] ?? EXPRESSION_RECIPE_MAP.neutral);
}

export function getRecipeForTone(tone: ExpressionTone): ExpressionRecipe {
  return TONE_TO_RECIPE_DIRECT.get(tone) ?? EXPRESSION_RECIPE_MAP.neutral;
}
