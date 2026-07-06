"use client";

/**
 * Recorder-path fallback turn, extracted from use-queen-bee-voice.ts: the
 * committed utterance recording is uploaded to /api/queen-bee/voice for
 * Whisper transcription, then handed to the conversational turn. Used only
 * when realtime STT is unavailable AND no free local caption source
 * produced the transcript.
 */

type VoiceTurnResponseLike = {
  ok?: boolean;
  transcript?: string;
  error?: string;
};

export type RecordedTurnDeps = {
  abortSignal: AbortSignal;
  isCancelled: () => boolean;
  mimeType: string;
  utteranceFileName: (mimeType: string) => string;
  setPhase: (phase: "thinking") => void;
  setSpeechDetected: (detected: boolean) => void;
  addTurn: (who: "you", text: string, live: boolean) => number;
  updateTurn: (id: number, text: string) => void;
  dropTurn: (id: number) => void;
  failTurn: (message: string) => void;
  runConverseTurn: (transcript: string) => Promise<void>;
};

export async function runRecordedVoiceTurn(
  audio: Blob,
  deps: RecordedTurnDeps,
) {
  deps.setPhase("thinking");
  deps.setSpeechDetected(false);
  const youTurnId = deps.addTurn("you", "Transcribing...", true);
  // Session teardown must only drop a STILL-PENDING placeholder. Once the
  // transcript lands, this turn is conversation history — the unremoved
  // listener used to fire on End and silently delete the user's finalized
  // messages (the overlay bridge mirrors removals into the shared chat).
  let youTurnSettled = false;
  deps.abortSignal.addEventListener(
    "abort",
    () => {
      if (!youTurnSettled) deps.dropTurn(youTurnId);
    },
    { once: true },
  );
  try {
    const form = new FormData();
    form.set(
      "audio",
      new File([audio], deps.utteranceFileName(deps.mimeType), {
        type: audio.type || deps.mimeType || "audio/webm",
      }),
    );
    const transcribeResponse = await fetch("/api/queen-bee/voice", {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.any([deps.abortSignal, AbortSignal.timeout(60_000)]),
    });
    const transcribed = (await transcribeResponse
      .json()
      .catch(() => null)) as VoiceTurnResponseLike | null;
    if (deps.isCancelled()) return;
    if (
      !transcribeResponse.ok ||
      !transcribed?.ok ||
      !transcribed.transcript
    ) {
      deps.dropTurn(youTurnId);
      deps.failTurn(
        transcribed?.error ||
          `Queen Bee transcription returned HTTP ${transcribeResponse.status}.`,
      );
      return;
    }
    youTurnSettled = true;
    deps.updateTurn(youTurnId, transcribed.transcript);
    await deps.runConverseTurn(transcribed.transcript);
  } catch (turnError) {
    if (deps.isCancelled()) return;
    deps.dropTurn(youTurnId);
    youTurnSettled = true;
    deps.failTurn(
      turnError instanceof Error
        ? turnError.message
        : "Queen Bee voice turn failed.",
    );
  }
}
