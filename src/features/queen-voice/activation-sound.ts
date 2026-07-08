export const QUEEN_VOICE_ACTIVATION_SOUND_SRC = "/audio/sfx/scifi-ping.wav";

const QUEEN_VOICE_ACTIVATION_VOLUME = 0.72;
const QUEEN_VOICE_ACTIVATION_START_DELAY_SECONDS = 0.035;
export const QUEEN_VOICE_ACTIVATION_SESSION_START_DELAY_MS = 2700;

let activationContext: AudioContext | null = null;
let activationBuffer: AudioBuffer | null = null;
let activationBufferPromise: Promise<AudioBuffer | null> | null = null;
let fallbackActivationAudio: HTMLAudioElement | null = null;

function queenVoiceActivationContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (activationContext) return activationContext;
  const audioWindow = window as Window &
    typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextClass =
    audioWindow.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    activationContext = new AudioContextClass({ latencyHint: "interactive" });
  } catch {
    try {
      activationContext = new AudioContextClass();
    } catch {
      activationContext = null;
    }
  }
  return activationContext;
}

function fallbackAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (fallbackActivationAudio) return fallbackActivationAudio;
  const audio = new Audio(QUEEN_VOICE_ACTIVATION_SOUND_SRC);
  audio.preload = "auto";
  audio.volume = QUEEN_VOICE_ACTIVATION_VOLUME;
  fallbackActivationAudio = audio;
  return audio;
}

async function decodeActivationSound(): Promise<AudioBuffer | null> {
  const context = queenVoiceActivationContext();
  if (!context) return null;
  if (activationBuffer) return activationBuffer;
  if (activationBufferPromise) return activationBufferPromise;
  activationBufferPromise = fetch(QUEEN_VOICE_ACTIVATION_SOUND_SRC, {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const encoded = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(encoded);
      activationBuffer = buffer;
      return buffer;
    })
    .catch(() => null)
    .finally(() => {
      activationBufferPromise = null;
    });
  return activationBufferPromise;
}

export function preloadQueenVoiceActivationSound(): void {
  void decodeActivationSound();
  fallbackAudio()?.load();
}

export function primeQueenVoiceActivationSound(): void {
  const context = queenVoiceActivationContext();
  if (!context) return;
  void context.resume().catch(() => undefined);
}

function playDecodedActivationSound(context: AudioContext, buffer: AudioBuffer): void {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = QUEEN_VOICE_ACTIVATION_VOLUME;
  source.connect(gain);
  gain.connect(context.destination);
  source.start(context.currentTime + QUEEN_VOICE_ACTIVATION_START_DELAY_SECONDS);
}

function playFallbackActivationSound(): void {
  const audio = fallbackAudio();
  if (!audio) return;
  try {
    audio.currentTime = 0;
  } catch {
    // Some browsers reject seeking before metadata is ready; play best-effort.
  }
  void audio.play().catch(() => undefined);
}

export function playQueenVoiceActivationSound(): void {
  preloadQueenVoiceActivationSound();
  const context = queenVoiceActivationContext();
  if (!context) {
    playFallbackActivationSound();
    return;
  }
  const play = (buffer: AudioBuffer | null) => {
    if (!buffer) {
      playFallbackActivationSound();
      return;
    }
    void context.resume()
      .then(() => playDecodedActivationSound(context, buffer))
      .catch(() => playFallbackActivationSound());
  };
  if (activationBuffer) play(activationBuffer);
  else void decodeActivationSound().then(play);
}
