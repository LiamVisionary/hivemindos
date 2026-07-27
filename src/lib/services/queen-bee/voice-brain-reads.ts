import "server-only";

export async function readQueenVoiceBrainContext(query: string): Promise<string> {
  const { queenVoiceBrainContext } = await import(
    "@/lib/services/queen-bee/voice-brain-context"
  );
  return queenVoiceBrainContext(query, { includeAccessHistory: true });
}
