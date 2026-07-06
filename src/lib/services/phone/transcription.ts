import { readManagedVoiceConfig } from "@/lib/services/phone/realtime-voice";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
// Turn-taking sessions (the Queen voice loop): server-side VAD ends each
// utterance. Measured with identical spoken audio (2026-07-06): final
// transcript 614ms after speech end vs 1376ms for the continuous model behind
// a client VAD — and the server VAD replaces the client energy heuristics
// (noise floors, rAF loops) entirely.
const TURN_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
// Continuous sessions (live captions for the speech-to-speech overlay, the
// agent call modal): gpt-realtime-whisper streams transcript deltas WHILE the
// user speaks (~0.6s behind), but rejects ANY turn_detection config (the
// client_secrets mint 400s — verified live 2026-07-05), so callers run their
// own end-of-speech and commit manually.
const REALTIME_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

export type RealtimeTranscriptionMode = "turns" | "continuous";

export async function transcriptionApiKey() {
  return await hiveEnvValue("OPENAI_TRANSCRIBE_KEY")
    || await hiveEnvValue("OPENAI_REALTIME_KEY")
    || readManagedVoiceConfig().keys["openai-realtime"]
    || await hiveEnvValue("OPENAI_API_KEY");
}

async function transcriptionBaseUrl() {
  return await hiveEnvValue("WHISPER_BASE_URL")
    || await hiveEnvValue("LOCAL_WHISPER_BASE_URL")
    || await hiveEnvValue("OPENAI_TRANSCRIBE_BASE_URL")
    || "https://api.openai.com";
}

async function localWhisperApiKey() {
  return await hiveEnvValue("WHISPER_API_KEY")
    || await hiveEnvValue("LOCAL_WHISPER_API_KEY")
    || await hiveEnvValue("OPENAI_TRANSCRIBE_KEY");
}

export async function createRealtimeTranscriptionClientSecret(
  mode: RealtimeTranscriptionMode = "turns",
) {
  const apiKey = await transcriptionApiKey();
  if (!apiKey) throw new Error("Realtime STT requires OPENAI_TRANSCRIBE_KEY, OPENAI_REALTIME_KEY, or an OpenAI voice key.");
  const model =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
    (mode === "turns" ? TURN_TRANSCRIPTION_MODEL : REALTIME_TRANSCRIPTION_MODEL);
  // gpt-realtime-whisper hard-rejects turn_detection (and is the only model
  // taking the `delay` knob), so the VAD choice follows the resolved model —
  // an env override to it still works, it just puts end-of-speech back on
  // the client.
  const continuousModel = /realtime-whisper/i.test(model);
  const serverVad = mode === "turns" && !continuousModel;
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: {
              model,
              language: "en",
              ...(continuousModel ? { delay: "minimal" } : {}),
            },
            turn_detection: serverVad
              ? {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 450,
                }
              : null,
          },
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as {
    value?: unknown;
    expires_at?: unknown;
    client_secret?: { value?: unknown; expires_at?: unknown };
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const error = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(error || `Realtime STT client secret returned HTTP ${response.status}.`);
  }
  const value = typeof data?.value === "string" ? data.value : typeof data?.client_secret?.value === "string" ? data.client_secret.value : "";
  const expiresAt = typeof data?.expires_at === "number" ? data.expires_at : typeof data?.client_secret?.expires_at === "number" ? data.client_secret.expires_at : undefined;
  if (!value) throw new Error("Realtime STT client secret response did not include a secret value.");
  return {
    ok: true,
    clientSecret: value,
    expiresAt,
    model,
    sampleRate: 24_000,
    // Who ends an utterance in this session: "server" = the session's VAD
    // auto-commits (client listens for speech_started/stopped/completed);
    // "client" = the caller runs its own VAD and commits manually.
    turnDetection: serverVad ? ("server" as const) : ("client" as const),
  };
}

export async function transcribeAudioWithWhisper(audio: Blob, signal: AbortSignal) {
  if (!audio.size) throw new Error("A non-empty audio recording is required.");
  const baseUrl = (await transcriptionBaseUrl()).replace(/\/+$/, "");
  const isOpenAi = /^https:\/\/api\.openai\.com$/i.test(baseUrl);
  const apiKey = isOpenAi ? await transcriptionApiKey() : await localWhisperApiKey();
  if (isOpenAi && !apiKey) throw new Error("Whisper STT requires OPENAI_TRANSCRIBE_KEY, OPENAI_REALTIME_KEY, or OPENAI_API_KEY in the shared env.");
  const audioName = typeof (audio as { name?: unknown }).name === "string"
    ? (audio as { name: string }).name
    : "utterance.webm";
  const form = new FormData();
  form.set("file", audio, audioName);
  form.set("model", process.env.OPENAI_TRANSCRIBE_MODEL || TRANSCRIPTION_MODEL);
  form.set("language", "en");
  form.set("response_format", "json");
  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form,
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => null) as { text?: unknown; error?: { message?: string } | string } | null;
  if (!response.ok) {
    const error = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(error || `Whisper STT returned HTTP ${response.status}.`);
  }
  const transcript = typeof data?.text === "string" ? data.text.trim() : "";
  if (!transcript) throw new Error("Whisper STT returned an empty transcript.");
  return transcript;
}
