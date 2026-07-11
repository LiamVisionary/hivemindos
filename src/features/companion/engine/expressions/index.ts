/**
 * Expression System 2.0 — Public API
 *
 * Import everything from this barrel file.
 * Ported from ami-ai-companion `src/lib/expressions2/`.
 */

export { ExpressionSystem } from './expression-system';
export {
  VRMChannelBridge,
  type BlinkControllerLike,
  type LipSyncControllerLike,
  type ActivePresetWeight,
} from './vrm-channel-bridge';
export { EmotionalStateController } from './emotional-state-controller';
export { ExpressionIntentSystem } from './expression-intent-system';
export { ExpressionMixer } from './expression-mixer';
export { GazeController } from './gaze-controller';
export { HeadMotionController } from './head-motion-controller';
export { BlinkModulator } from './blink-modulator';
export { IdleLayer } from './idle-layer';
export { SpeechAlignmentController } from './speech-alignment';
export { PERSONALITY_PRESETS, createPersonalityProfile } from './personality-profiles';
export { EXPRESSION_RECIPE_MAP, TONE_TO_RECIPE, getRecipeForTone } from './expression-recipes';
export {
  type CharacterExpressionProfile,
  getCharacterExpressionProfileForUrl,
  isSaraTomcatModelUrl,
} from './character-expression-profile';

export type {
  IExpressionSystem,
  EmotionalState,
  ExpressionIntent,
  ExpressionRecipe,
  ExpressionPersonalityProfile,
  RelationshipExpressionContext,
  DialogueExpressionBeat,
  SpokenWordTiming,
  ChannelValues,
  GazeTarget,
  HeadPoseOffset,
  BlinkModulation,
  ExpressionRegion,
  ExpressionTone,
  IntentSource,
  IntentKind,
  Envelope,
  EnvelopeCurve,
  GazeMode,
  BaseAffect,
  SocialModifier,
  MomentaryReaction,
  EnergyModifier,
  ClauseTiming,
} from './types';

export {
  PRIORITY,
  EMOTIONAL_STATE_KEYS,
  ALL_REGIONS,
  createNeutralState,
  createNeutralChannels,
  createDefaultPersonality,
  createDefaultRelationship,
  intentDurationMs,
  intentEndTimeMs,
} from './types';
