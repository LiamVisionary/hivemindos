export type RealtimeTranscriptionEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: {
    type?: string;
    code?: string;
    message?: string;
  };
};

export function realtimeTranscriptionFailureMessage(
  event: RealtimeTranscriptionEvent | null,
): string {
  if (event?.type !== "conversation.item.input_audio_transcription.failed") {
    return "";
  }
  return event.error?.message || "The microphone audio could not be transcribed.";
}
