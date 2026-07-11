/**
 * Expression System 2.0 — Type Definitions
 *
 * Layered facial expression system with continuous emotional state,
 * intent-based arbitration, regional channel control, and personality profiles.
 *
 * Ported from ami-ai-companion `src/lib/expressions2/types.ts`.
 */

// ---------------------------------------------------------------------------
// Emotional State (Layer A — persistent, slowly-changing internal affect)
// ---------------------------------------------------------------------------

export interface EmotionalState {
  warmth: number;       // affectionate / friendly          0..1
  joy: number;          // positive pleasure                0..1
  sadness: number;      // 0..1
  irritation: number;   // 0..1
  tension: number;      // stress / guardedness             0..1
  shyness: number;      // 0..1
  playfulness: number;  // 0..1
  confidence: number;   // 0..1
  energy: number;       // sleepy(0) <-> alert(1)           0..1
  affection: number;    // bond expression                  0..1
  curiosity: number;    // 0..1
}

export const EMOTIONAL_STATE_KEYS: (keyof EmotionalState)[] = [
  'warmth', 'joy', 'sadness', 'irritation', 'tension',
  'shyness', 'playfulness', 'confidence', 'energy', 'affection', 'curiosity',
];

export function createNeutralState(): EmotionalState {
  return {
    warmth: 0.3, joy: 0.2, sadness: 0, irritation: 0, tension: 0.1,
    shyness: 0.1, playfulness: 0.15, confidence: 0.4, energy: 0.5,
    affection: 0.2, curiosity: 0.2,
  };
}

/** How fast each dimension responds to target changes (per-second lerp factor) */
export const EMOTIONAL_SMOOTHING_RATES: Record<keyof EmotionalState, number> = {
  warmth: 1.2,
  joy: 1.8,
  sadness: 0.6,
  irritation: 0.8,
  tension: 1.2,
  shyness: 1.5,
  playfulness: 1.8,
  confidence: 0.8,
  energy: 0.5,
  affection: 0.6,
  curiosity: 2.5,
};

// ---------------------------------------------------------------------------
// Expression Regions (facial channel masks)
// ---------------------------------------------------------------------------

export type ExpressionRegion =
  | 'brows'
  | 'eyelids'
  | 'gaze'
  | 'mouthCorners'
  | 'jawBias'
  | 'headPose'
  | 'blinkMod';

export const ALL_REGIONS: ExpressionRegion[] = [
  'brows', 'eyelids', 'gaze', 'mouthCorners', 'jawBias', 'headPose', 'blinkMod',
];

// ---------------------------------------------------------------------------
// Expression Intents (Layer B — short-lived requests from any source)
// ---------------------------------------------------------------------------

export type IntentSource = 'dialogue' | 'vn' | 'emotion' | 'vision' | 'idle' | 'system';
export type IntentKind = 'reaction' | 'modifier' | 'base_override' | 'micro_expression';

export type EnvelopeCurve =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'fastAttackSlowRelease';

export interface Envelope {
  attackMs: number;
  sustainMs: number;
  releaseMs: number;
  curve: EnvelopeCurve;
}

export interface ExpressionIntent {
  id: string;
  source: IntentSource;
  kind: IntentKind;
  preset?: string;
  intensity: number;          // 0..1
  priority: number;           // higher wins when conflicting
  startTimeMs: number;
  envelope: Envelope;
  interruptible: boolean;
  regionMask?: ExpressionRegion[];
  decayToState?: Partial<EmotionalState>;
  metadata?: Record<string, unknown>;
}

/** Computed total duration from envelope */
export function intentDurationMs(e: Envelope): number {
  return e.attackMs + e.sustainMs + e.releaseMs;
}

export function intentEndTimeMs(intent: ExpressionIntent): number {
  return intent.startTimeMs + intentDurationMs(intent.envelope);
}

// Priority bands
export const PRIORITY = {
  SYSTEM_OVERRIDE: 100,
  VN_SCRIPTED: 90,
  SAFETY: 80,
  HIGH_DIALOGUE: 70,
  NORMAL_DIALOGUE: 60,
  CONVERSATIONAL_MOD: 50,
  BASE_EMOTION: 40,
  IDLE_AMBIENT: 20,
} as const;

// ---------------------------------------------------------------------------
// Channel values (mixer output per-region)
// ---------------------------------------------------------------------------

export interface GazeTarget {
  horizontal: number; // -1 (left) .. 1 (right)
  vertical: number;   // -1 (down) .. 1 (up)
}

export interface HeadPoseOffset {
  pitch: number; // degrees, ±4
  yaw: number;   // degrees, ±5
  roll: number;  // degrees, ±6
}

export interface BlinkModulation {
  intervalScale: number;   // multiplier on blink interval (>1 = slower, <1 = faster)
  amplitudeScale: number;  // multiplier on blink closure depth
  durationScale: number;   // multiplier on blink speed
}

export interface ChannelValues {
  brows: number;        // -1 (furrowed/angry) .. 0 (neutral) .. 1 (raised/surprised)
  eyelids: number;      // -1 (squinted) .. 0 (normal) .. 1 (wide open)
  gaze: GazeTarget;
  mouthCorners: number; // -1 (frown) .. 0 (neutral) .. 1 (smile)
  jawBias: number;      // 0 (closed) .. 1 (open bias)
  headPose: HeadPoseOffset;
  blinkMod: BlinkModulation;
}

export function createNeutralChannels(): ChannelValues {
  return {
    brows: 0,
    eyelids: 0,
    gaze: { horizontal: 0, vertical: 0 },
    mouthCorners: 0,
    jawBias: 0,
    headPose: { pitch: 0, yaw: 0, roll: 0 },
    blinkMod: { intervalScale: 1, amplitudeScale: 1, durationScale: 1 },
  };
}

// ---------------------------------------------------------------------------
// Expression Recipes (preset -> channel mappings)
// ---------------------------------------------------------------------------

export interface ChannelCurveValue {
  target: number;
  weight: number; // how much this recipe contributes (0..1)
}

export interface GazePattern {
  mode: GazeMode;
  intensity: number;
}

export interface HeadPattern {
  pitch: number;
  yaw: number;
  roll: number;
  weight: number;
}

export interface BlinkPattern {
  intervalScale: number;
  amplitudeScale: number;
  durationScale: number;
}

export interface ExpressionRecipe {
  name: string;
  channels: {
    brows?: ChannelCurveValue;
    eyelids?: ChannelCurveValue;
    gaze?: GazePattern;
    mouthCorners?: ChannelCurveValue;
    jawBias?: ChannelCurveValue;
    headPose?: HeadPattern;
    blinkMod?: BlinkPattern;
  };
  emotionalInfluence?: Partial<EmotionalState>;
  defaultEnvelope: Envelope;
}

// ---------------------------------------------------------------------------
// Gaze
// ---------------------------------------------------------------------------

export type GazeMode =
  | 'user_focus'
  | 'soft_eye_contact'
  | 'look_away_down'
  | 'side_glance'
  | 'thinking_up'
  | 'scanning'
  | 'defocused'
  | 'return_to_user';

// ---------------------------------------------------------------------------
// Personality Profile
// ---------------------------------------------------------------------------

export interface ExpressionPersonalityProfile {
  expressiveness: number;     // 0..1 — frequency/intensity multiplier
  gazeStability: number;      // 0..1 — steady eye contact vs more aversion
  headMotionAmount: number;   // 0..1
  blinkSoftness: number;      // 0..1 — heavier, softer blinks
  smileBias: number;          // 0..1 — resting smile tendency
  shynessBias: number;        // 0..1
  playfulnessBias: number;    // 0..1
  recoverySpeed: number;      // 0..1 — how fast expressions return to base
}

export function createDefaultPersonality(): ExpressionPersonalityProfile {
  return {
    expressiveness: 0.65,
    gazeStability: 0.55,
    headMotionAmount: 0.5,
    blinkSoftness: 0.5,
    smileBias: 0.15,
    shynessBias: 0.12,
    playfulnessBias: 0.35,
    recoverySpeed: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Relationship Context
// ---------------------------------------------------------------------------

export interface RelationshipExpressionContext {
  trust: number;       // 0..1
  affection: number;   // 0..1
  tension: number;     // 0..1
  comfort: number;     // 0..1
  flirtMode: boolean;
  supportMode: boolean;
}

export function createDefaultRelationship(): RelationshipExpressionContext {
  return {
    trust: 0.5,
    affection: 0.3,
    tension: 0.1,
    comfort: 0.4,
    flirtMode: false,
    supportMode: false,
  };
}

// ---------------------------------------------------------------------------
// LLM Output: Dialogue Expression Beat
// ---------------------------------------------------------------------------

export type ExpressionTone =
  | 'warm' | 'bashful' | 'teasing' | 'sad' | 'playful'
  | 'skeptical' | 'surprised' | 'hurt' | 'affectionate'
  | 'embarrassed' | 'delighted' | 'confused' | 'irritated'
  | 'smug' | 'pouty' | 'impressed' | 'guarded' | 'neutral' | 'curious'
  | 'lipBite' | 'pucker'
  // New expressions for paralinguistic tag mappings
  | 'wistful'     // longing/melancholic — [wistful] [longing] [melancholic]
  | 'scared'      // fear/panic — [panicking] [visibly shaken] [slightly nervous]
  | 'determined'  // firm resolve — [suddenly serious] [tone darkens]
  | 'crying';     // active tears — [crying] [voice breaking] [sniffles]

export interface DialogueExpressionBeat {
  tone: ExpressionTone;
  intensity: number;              // 0..1
  anchorText?: string;            // word or phrase to anchor timing
  anchorMode?: 'word' | 'phrase' | 'sentence';
  phase?: 'anticipate' | 'peak' | 'recover';
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Speech Timing
// ---------------------------------------------------------------------------

export interface SpokenWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface ClauseTiming {
  text: string;
  startMs: number;
  endMs: number;
  isEmotionalPeak: boolean;
}

// ---------------------------------------------------------------------------
// Expression System Public API
// ---------------------------------------------------------------------------

export interface IExpressionSystem {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;

  setEmotionalStateTarget(target: Partial<EmotionalState>, blendMs?: number): void;
  getEmotionalState(): EmotionalState;

  submitIntent(intent: Omit<ExpressionIntent, 'id'>): string;
  cancelIntent(intentId: string): void;
  clearSource(source: IntentSource): void;

  setPersonalityProfile(profile: Partial<ExpressionPersonalityProfile>): void;
  setRelationshipContext(context: Partial<RelationshipExpressionContext>): void;

  /** Process dialogue beats from LLM output */
  processDialogueBeats(beats: DialogueExpressionBeat[], wordTimings?: SpokenWordTiming[]): void;

  /** Called every frame by the render loop */
  update(deltaMs: number): ChannelValues;

  /** Get the current resolved channel values */
  getCurrentChannels(): ChannelValues;

  dispose(): void;
}

// ---------------------------------------------------------------------------
// Expression Taxonomy (replaces flat enum)
// ---------------------------------------------------------------------------

export type BaseAffect =
  | 'neutral' | 'warm' | 'relaxed' | 'happy' | 'low' | 'tense' | 'sad' | 'irritated';

export type SocialModifier =
  | 'shy' | 'teasing' | 'smug' | 'pouty' | 'affectionate'
  | 'embarrassed' | 'apologetic' | 'flirty' | 'guarded';

export type MomentaryReaction =
  | 'surprised' | 'startled' | 'impressed' | 'skeptical'
  | 'confused' | 'delighted' | 'hurt' | 'annoyed';

export type EnergyModifier =
  | 'sleepy' | 'alert' | 'excited' | 'drained';
