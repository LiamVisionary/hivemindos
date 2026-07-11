/**
 * Configuration types, defaults, and emotion-posture tables for the
 * ProceduralAnimationController. Ported from ami-ai-companion
 * (src/components/3d/ProceduralAnimationController.ts), split into its own
 * module to keep the controller under the repo file-size gate.
 */

export interface ProceduralAnimationConfig {
  breathing: {
    enabled: boolean;
    speed: number;      // Breaths per minute (default: 12-16)
    intensity: number;  // 0-1 scale
  };
  idleSway: {
    enabled: boolean;
    speed: number;      // Sway cycles per minute
    intensity: number;  // 0-1 scale
  };
  lookAround: {
    enabled: boolean;
    frequency: number;  // How often to look around (seconds between looks)
    range: number;      // 0-1 scale for look range
  };
  fidget: {
    enabled: boolean;
    frequency: number;  // Seconds between fidgets
    intensity: number;  // 0-1 scale
  };
  headTilt: {
    enabled: boolean;
    speed: number;      // Tilt cycles per minute
    intensity: number;  // 0-1 scale
  };
  microVariations: {
    enabled: boolean;
    intensity: number;  // 0-1 scale for subtle random variations
  };
  emotionPosture: {
    enabled: boolean;
    blendSpeed: number; // How fast to blend to new posture (0-1)
  };
  conversationalMotion: {
    enabled: boolean;
    nodIntensity: number;     // 0-1 scale for pitch nods
    tiltIntensity: number;    // 0-1 scale for roll tilts
    turnIntensity: number;    // 0-1 scale for yaw turns
    emphasisChance: number;   // 0-1 probability of emphasis nod per cycle
  };
}

export const DEFAULT_CONFIG: ProceduralAnimationConfig = {
  breathing: { enabled: false, speed: 14, intensity: 0.8 },  // Disabled - conflicts with Idle01_breathing.glb
  idleSway: { enabled: false, speed: 8, intensity: 0.6 },    // Disabled - conflicts with idle animation
  lookAround: { enabled: false, frequency: 4, range: 0.5 },  // Disabled by default - enable via UI
  fidget: { enabled: false, frequency: 5, intensity: 0.5 },  // Disabled by default - enable via UI
  headTilt: { enabled: false, speed: 5, intensity: 0.4 },    // Disabled by default - enable via UI
  microVariations: { enabled: true, intensity: 0.05 },       // Extremely subtle - barely perceptible
  emotionPosture: { enabled: true, blendSpeed: 0.02 },       // Emotion-based posture adjustments
  conversationalMotion: { enabled: true, nodIntensity: 0.7, tiltIntensity: 0.5, turnIntensity: 0.4, emphasisChance: 0.15 },
};

// Emotion posture presets - subtle body language adjustments
export type EmotionPosture = 'neutral' | 'happy' | 'sad' | 'excited' | 'shy' | 'confident' | 'thoughtful' | 'relaxed';

export interface PostureAdjustment {
  spineX: number;      // Forward/back lean
  spineZ: number;      // Side lean
  shoulderY: number;   // Shoulder raise/drop
  headX: number;       // Head tilt forward/back
  headZ: number;       // Head tilt side
  chestX: number;      // Chest expansion
}

export const EMOTION_POSTURES: Record<EmotionPosture, PostureAdjustment> = {
  neutral: { spineX: 0, spineZ: 0, shoulderY: 0, headX: 0, headZ: 0, chestX: 0 },
  happy: { spineX: -0.02, spineZ: 0, shoulderY: -0.02, headX: 0, headZ: 0.02, chestX: 0.02 },
  sad: { spineX: 0.05, spineZ: 0, shoulderY: 0.04, headX: 0.06, headZ: 0, chestX: -0.02 },
  excited: { spineX: -0.03, spineZ: 0, shoulderY: -0.03, headX: 0, headZ: 0, chestX: 0.03 },
  shy: { spineX: 0.03, spineZ: 0.02, shoulderY: 0.03, headX: 0.04, headZ: 0.04, chestX: -0.01 },
  confident: { spineX: -0.02, spineZ: 0, shoulderY: -0.02, headX: -0.02, headZ: 0, chestX: 0.03 },
  thoughtful: { spineX: 0.01, spineZ: 0.01, shoulderY: 0, headX: 0.02, headZ: 0.03, chestX: 0 },
  relaxed: { spineX: 0.02, spineZ: 0.01, shoulderY: 0.01, headX: 0.01, headZ: 0.02, chestX: -0.01 },
};

export interface ProceduralAnimationOptions {
  /**
   * Whether the idle-motion orchestrator starts enabled. Replaces ami's Dexie
   * device-settings lookup. Defaults to true.
   */
  idleAnimationsEnabled?: boolean;
}

export interface LookTarget {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

// Look at image state - for when user sends an image to analyze
export interface LookAtImageState {
  enabled: boolean;
  // Current interpolated values (0 = neutral, 1 = fully looking)
  progress: number;
  // Target rotation values when looking at image
  bodyRotationY: number;    // Body turns slightly left
  headRotationY: number;    // Head turns more left
  headRotationX: number;    // Head tilts down slightly
  eyeRotationY: number;     // Eyes look even more left
  // Dynamic screen target (normalized 0-1 coords) — when set, computes gaze from camera
  screenTarget: { x: number; y: number } | null;
}

export type FidgetType = 'shoulder' | 'weight' | 'headTilt' | 'none';

export interface FidgetState {
  type: FidgetType;
  startTime: number;
  duration: number;
  intensity: number;
  direction: number;
}

export type ManualMotionType = 'nod' | 'tilt' | 'turn' | 'emphasisNod';

/** Mapping from free-form emotion strings to posture presets. */
export const EMOTION_TO_POSTURE: Record<string, EmotionPosture> = {
  'happy': 'happy',
  'joy': 'happy',
  'excited': 'excited',
  'excitement': 'excited',
  'sad': 'sad',
  'sadness': 'sad',
  'grief': 'sad',
  'shy': 'shy',
  'embarrassed': 'shy',
  'nervous': 'shy',
  'confident': 'confident',
  'pride': 'confident',
  'thoughtful': 'thoughtful',
  'curious': 'thoughtful',
  'confusion': 'thoughtful',
  'relaxed': 'relaxed',
  'calm': 'relaxed',
  'neutral': 'neutral',
};
