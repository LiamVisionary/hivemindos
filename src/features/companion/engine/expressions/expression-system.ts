/**
 * ExpressionSystem — Main orchestrator for Expression System 2.0
 *
 * Coordinates all sub-controllers and implements IExpressionSystem.
 * This is the single entry point that the scene/render layer interacts with.
 *
 * Ported from ami-ai-companion `src/lib/expressions2/expression-system.ts`.
 * Port notes:
 * - ami pushed a natural-language "expression context" string into its session
 *   store for prompt building; here the host registers a callback via
 *   `setExpressionContextListener()` instead.
 * - ami synced music head-bob from its session store each frame; here the host
 *   calls `setMusicBobbing()` explicitly.
 */

import { logger } from '../logger';
import {
  type IExpressionSystem,
  type EmotionalState,
  type ExpressionIntent,
  type ExpressionPersonalityProfile,
  type RelationshipExpressionContext,
  type DialogueExpressionBeat,
  type SpokenWordTiming,
  type ChannelValues,
  type IntentSource,
  createNeutralChannels,
  createDefaultPersonality,
  PRIORITY,
} from './types';
import { EmotionalStateController } from './emotional-state-controller';
import { ExpressionIntentSystem } from './expression-intent-system';
import { ExpressionMixer } from './expression-mixer';
import { GazeController } from './gaze-controller';
import { HeadMotionController } from './head-motion-controller';
import { BlinkModulator } from './blink-modulator';
import { IdleLayer } from './idle-layer';
import { SpeechAlignmentController } from './speech-alignment';
import { getRecipeForTone, EXPRESSION_RECIPE_MAP } from './expression-recipes';

/** How many ms of clock drift before we reset timing (e.g., tab backgrounded) */
const MAX_FRAME_DELTA_MS = 200;

/** localStorage key for persisting the emotional target across reloads */
const PERSIST_KEY = 'companion_expr2_emotional_state';

export class ExpressionSystem implements IExpressionSystem {
  private _enabled: boolean = true;
  private systemTimeMs: number = 0;

  // Sub-controllers
  private emotionalState: EmotionalStateController;
  private intentSystem: ExpressionIntentSystem;
  private mixer: ExpressionMixer;
  private gazeController: GazeController;
  private headMotionController: HeadMotionController;
  private blinkModulator: BlinkModulator;
  private idleLayer: IdleLayer;
  private speechAlignment: SpeechAlignmentController;

  // Output
  private currentChannels: ChannelValues = createNeutralChannels();
  private personality: ExpressionPersonalityProfile;

  // Optional host hook: receives a short natural-language description of the
  // current emotional state (or null when neutral) whenever the target changes.
  private expressionContextListener: ((context: string | null) => void) | null = null;

  // Anti-robot: track recent beats to prevent over-expression
  private recentBeatCount: number = 0;
  private lastBeatResetMs: number = 0;
  private static readonly MAX_BEATS_PER_WINDOW = 4;
  private static readonly BEAT_WINDOW_MS = 5000;

  constructor(personality?: Partial<ExpressionPersonalityProfile>) {
    this.personality = { ...createDefaultPersonality(), ...personality };

    this.emotionalState = new EmotionalStateController();
    this.intentSystem = new ExpressionIntentSystem();
    this.mixer = new ExpressionMixer();
    this.gazeController = new GazeController(this.personality);
    this.headMotionController = new HeadMotionController(this.personality);
    this.blinkModulator = new BlinkModulator();
    this.idleLayer = new IdleLayer();
    this.speechAlignment = new SpeechAlignmentController();

    if (this.personality) {
      this.emotionalState.setPersonality(this.personality);
    }

    logger.debug('[Expressions2] System initialized');
  }

  // ---------------------------------------------------------------------------
  // IExpressionSystem implementation
  // ---------------------------------------------------------------------------

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.currentChannels = createNeutralChannels();
      this.intentSystem.clear();
    }
    logger.debug(`[Expressions2] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  setEmotionalStateTarget(target: Partial<EmotionalState>, _blendMs?: number): void {
    this.emotionalState.setTarget(target);
    this.persistEmotionalState();
    this.pushExpressionContext();
  }

  /**
   * Register a listener that receives a short natural-language description of
   * the current emotional state whenever it changes (null = nothing notable).
   * Hosts can feed this into prompt building so the LLM knows the character's
   * visible demeanor. Pass null to unregister.
   */
  setExpressionContextListener(listener: ((context: string | null) => void) | null): void {
    this.expressionContextListener = listener;
  }

  /**
   * Enable/disable the slow melodic head bob (e.g. while music plays).
   * In ami this was synced from the session store each frame; here the host
   * drives it explicitly.
   */
  setMusicBobbing(active: boolean): void {
    this.headMotionController.setMusicBobbing(active);
  }

  /** Build a short natural-language description of the current emotional state and notify the host */
  private pushExpressionContext(): void {
    if (!this.expressionContextListener) return;
    const s = this.emotionalState.getTarget();
    const parts: string[] = [];

    if ((s.irritation ?? 0) > 0.4) parts.push('irritated' + ((s.irritation ?? 0) > 0.7 ? ' (very)' : ''));
    if ((s.sadness ?? 0) > 0.4) parts.push('sad' + ((s.sadness ?? 0) > 0.7 ? ' (very)' : ''));
    if ((s.tension ?? 0) > 0.4) parts.push('tense');
    if ((s.warmth ?? 0) > 0.6) parts.push('warm / affectionate');
    if ((s.playfulness ?? 0) > 0.6) parts.push('playful');
    if ((s.energy ?? 0) > 0.7 && (s.joy ?? 0) > 0.5) parts.push('excited');

    const context = parts.length > 0
      ? `[Current facial expression: ${parts.join(', ')} — your visible demeanor should match this right now]`
      : null;

    try {
      this.expressionContextListener(context);
    } catch { /* listener errors must not break the render loop */ }
  }

  /** Save current emotional target to localStorage for persistence across reloads */
  private persistEmotionalState(): void {
    try {
      const target = this.emotionalState.getTarget();
      localStorage.setItem(PERSIST_KEY, JSON.stringify(target));
    } catch { /* ignore (non-browser env / storage denied) */ }
  }

  /** Restore emotional state from localStorage on init */
  restorePersistedState(): void {
    try {
      const saved = localStorage.getItem(PERSIST_KEY);
      if (saved) {
        const state = JSON.parse(saved) as Partial<EmotionalState>;
        this.emotionalState.restoreImmediate(state);

        logger.debug('[Expressions2] Restored persisted emotional state', {
          irritation: (state.irritation ?? 0).toFixed(2),
          sadness: (state.sadness ?? 0).toFixed(2),
          warmth: (state.warmth ?? 0).toFixed(2),
        });

        this.pushExpressionContext();
      }
    } catch { /* ignore */ }
  }

  getEmotionalState(): EmotionalState {
    return this.emotionalState.getCurrent();
  }

  submitIntent(intent: Omit<ExpressionIntent, 'id'>): string {
    return this.intentSystem.submit(intent);
  }

  /**
   * Convenience method for dev/test: trigger a recipe by tone name immediately.
   * Uses the system's internal clock so the envelope evaluates correctly.
   */
  triggerTone(tone: string, opts?: { sustainMs?: number; intensity?: number }): string {
    const recipe = EXPRESSION_RECIPE_MAP[tone];
    if (!recipe) return '';
    const envelope = opts?.sustainMs
      ? { ...recipe.defaultEnvelope, sustainMs: opts.sustainMs }
      : recipe.defaultEnvelope;
    return this.submitIntent({
      source: 'system',
      kind: 'reaction',
      preset: recipe.name,
      intensity: opts?.intensity ?? 1.0,
      priority: PRIORITY.HIGH_DIALOGUE,
      startTimeMs: this.systemTimeMs,
      envelope,
      interruptible: true,
    });
  }

  getActivePresetNames(): string[] {
    return this.intentSystem
      .getActiveIntents()
      .map((intent) => intent.preset)
      .filter((preset): preset is string => typeof preset === 'string' && preset.length > 0);
  }

  getActivePresetWeights(): Array<{ preset: string; weight: number }> {
    return this.intentSystem
      .getActiveIntents()
      .map((intent) => {
        const preset = intent.preset;
        if (!preset) return null;
        const weight = this.intentSystem.evaluateEnvelope(intent) * intent.intensity * this.personality.expressiveness;
        if (weight <= 0.001) return null;
        return { preset, weight: Math.min(1, weight) };
      })
      .filter((entry): entry is { preset: string; weight: number } => entry !== null);
  }

  cancelIntent(intentId: string): void {
    this.intentSystem.cancel(intentId);
  }

  clearSource(source: IntentSource): void {
    this.intentSystem.clearSource(source);
  }

  setPersonalityProfile(profile: Partial<ExpressionPersonalityProfile>): void {
    this.personality = { ...this.personality, ...profile };
    this.emotionalState.setPersonality(this.personality);
    this.gazeController.setPersonality(this.personality);
    this.headMotionController.setPersonality(this.personality);
  }

  setRelationshipContext(context: Partial<RelationshipExpressionContext>): void {
    this.emotionalState.setRelationship(context);
  }

  processDialogueBeats(
    beats: DialogueExpressionBeat[],
    wordTimings?: SpokenWordTiming[],
    dialogueText?: string,
    totalDurationMs?: number,
  ): void {
    if (!this._enabled || beats.length === 0) return;

    // Anti-robot: limit beats per window
    if (this.systemTimeMs - this.lastBeatResetMs > ExpressionSystem.BEAT_WINDOW_MS) {
      this.recentBeatCount = 0;
      this.lastBeatResetMs = this.systemTimeMs;
    }

    const allowedBeats = beats.slice(
      0, Math.max(1, ExpressionSystem.MAX_BEATS_PER_WINDOW - this.recentBeatCount)
    );
    this.recentBeatCount += allowedBeats.length;

    const text = dialogueText ?? '';
    const duration = totalDurationMs ?? 3000;

    // Clear previous dialogue intents
    this.intentSystem.clearSource('dialogue');
    this.intentSystem.clearSource('emotion');

    // Generate timed intents from beats
    const intents = this.speechAlignment.alignBeats(
      allowedBeats,
      text,
      duration,
      this.systemTimeMs,
      wordTimings,
    );

    for (const intent of intents) {
      this.intentSystem.submit(intent);
    }

    // Set base emotional tone from the first/dominant beat
    if (allowedBeats.length > 0) {
      const dominant = allowedBeats[0];
      const baseIntent = this.speechAlignment.createBaseEmotionalIntent(
        dominant.tone,
        dominant.intensity,
        this.systemTimeMs,
        duration,
      );
      this.intentSystem.submit(baseIntent);

      // Also nudge the emotional state
      const recipe = getRecipeForTone(dominant.tone);
      if (recipe.emotionalInfluence) {
        this.emotionalState.setTarget(
          scalePartial(recipe.emotionalInfluence, dominant.intensity)
        );
      }
    }

    logger.debug(`[Expressions2] Processed ${allowedBeats.length} beats → ${intents.length + 1} intents`);
  }

  /**
   * Main per-frame update. Called by the render loop.
   * @param deltaMs frame delta in milliseconds
   */
  update(deltaMs: number): ChannelValues {
    if (!this._enabled) return this.currentChannels;

    // Clamp delta to prevent huge jumps (e.g., tab was backgrounded)
    const clampedDelta = Math.min(deltaMs, MAX_FRAME_DELTA_MS);
    this.systemTimeMs += clampedDelta;
    const deltaSec = clampedDelta / 1000;

    // --- 1. Update intent system (expire old intents) ---
    this.intentSystem.update(this.systemTimeMs);

    // --- 2. Handle decaying intents → emotional residue ---
    const decaying = this.intentSystem.getDecayingIntents();
    for (const intent of decaying) {
      if (intent.decayToState) {
        this.emotionalState.applyResidue(intent.decayToState);
      }
    }

    // --- 3. Update emotional state ---
    const emotion = this.emotionalState.update(deltaSec);

    // --- 4. Generate idle micro-expressions ---
    const idleIntents = this.idleLayer.update(
      this.systemTimeMs,
      emotion,
      this.personality,
      this.intentSystem.getActiveIntents().length,
    );
    for (const idle of idleIntents) {
      this.intentSystem.submit(idle);
    }

    // --- 5. Mix everything into channel values ---
    const mixed = this.mixer.mix(emotion, this.intentSystem, this.personality);

    // --- 6. Post-process gaze with controller (adds breaks, saccades) ---
    mixed.gaze = this.gazeController.update(deltaSec, emotion, mixed.gaze);

    // --- 7. Post-process head motion (adds idle drift + music bob) ---
    // Music bob state is driven by the host via setMusicBobbing().
    mixed.headPose = this.headMotionController.update(deltaSec, emotion, mixed.headPose);

    // --- 8. Post-process blink modulation ---
    mixed.blinkMod = this.blinkModulator.update(deltaSec, emotion, this.personality, mixed.blinkMod);

    this.currentChannels = mixed;
    return mixed;
  }

  getCurrentChannels(): ChannelValues {
    return { ...this.currentChannels };
  }

  /** Get the current system time (for scheduling intents externally) */
  getSystemTimeMs(): number {
    return this.systemTimeMs;
  }

  /** Access the gaze controller (for idle motion overrides) */
  getGazeController(): GazeController {
    return this.gazeController;
  }

  dispose(): void {
    this.intentSystem.clear();
    this.idleLayer.reset();
    this.gazeController.reset();
    this.headMotionController.reset();
    this.blinkModulator.reset();
    this.emotionalState.reset();
    logger.debug('[Expressions2] Disposed');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scalePartial(
  state: Partial<EmotionalState>,
  scale: number,
): Partial<EmotionalState> {
  const result: Partial<EmotionalState> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'number') {
      (result as Record<string, number>)[key] = value * scale;
    }
  }
  return result;
}
