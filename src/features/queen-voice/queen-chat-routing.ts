"use client";

export type QueenChatRoute = "text" | "voice";

export type QueenChatRoutingTurn = {
  id?: string;
  who: "you" | "queen";
  text: string;
  live?: boolean;
  pending?: boolean;
};

export type QueenVoiceHistoryTurn = {
  who: "you" | "queen";
  text: string;
};

export const QUEEN_TEXT_CHAT_API_PATH = "/api/queen-bee/chat";
export const QUEEN_VOICE_CHAT_API_PATH = "/api/queen-bee/voice";

const MAX_VOICE_HISTORY_TURNS = 8;

export function queenChatRouteForSend(voiceChatActive: boolean): QueenChatRoute {
  return voiceChatActive ? "voice" : "text";
}

export function queenVoiceHistoryFromTurns(
  turns: QueenChatRoutingTurn[],
): QueenVoiceHistoryTurn[] {
  return turns
    .filter((turn) => !turn.live && !turn.pending && turn.text.trim())
    .map((turn) => ({
      who: turn.who,
      text: turn.text.trim(),
    }))
    .slice(-MAX_VOICE_HISTORY_TURNS);
}

export function queenVoiceHistoryBeforeTurn(
  turns: QueenChatRoutingTurn[],
  turnId: string,
): QueenVoiceHistoryTurn[] {
  const index = turns.findIndex((turn) => turn.id === turnId);
  return queenVoiceHistoryFromTurns(index >= 0 ? turns.slice(0, index) : turns);
}
