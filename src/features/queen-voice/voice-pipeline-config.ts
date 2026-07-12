import { BARGE_IN_TUNING } from "./barge-in-detector";

export const ECHO_CANCELLED_AUDIO: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

export const LOCAL_TTS_PREWARM_INTERVAL_MS = 45_000;
export const ACK_PLAY_DELAY_MS = 4_500;
export const TURN_PROGRESS_POLL_MS = 650;
export const PRE_ROLL_MAX_MS = 8_000;
export const BARGE_IN_FLUSH_LOOKBACK_MS = BARGE_IN_TUNING.sustainMs + 480;
export const BARGE_IN_BACKSTOP_INTERVAL_MS = 33;
export const BARGE_IN_RAF_STALL_MS = 66;
export const POST_PLAYBACK_FLUSH_LOOKBACK_MS = 800;
export const STT_COMMIT_FALLBACK_MS = 4_000;
export const STT_PREWARM_MAX_AGE_MS = 20_000;
export const STT_ARM_TIMEOUT_MS = 6_000;
export const IDLE_RECORDER_RESTART_MS = 10_000;
export const IDLE_BUFFER_CLEAR_MS = 12_000;
export const ERROR_RESUME_DELAY_MS = 3_500;

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    RECORDER_MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? ""
  );
}

export function utteranceFileName(mimeType: string) {
  return mimeType.includes("mp4") ? "utterance.mp4" : "utterance.webm";
}
