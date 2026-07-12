import type { ChatTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import {
  captureObsidianNoteFromDashboard,
  type CaptureObsidianNoteResponse,
} from "@/lib/native/obsidian";

export const TRANSCRIPT_BRAIN_INTAKE_FOLDER = "Intake/Sources";

function singleLine(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function transcriptDurationLabel(seconds: number | undefined) {
  if (!seconds || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function buildTranscriptBrainNoteContent(card: ChatTranscriptCard) {
  const transcript = card.transcript?.replace(/\r\n?/g, "\n").trim();
  if (!transcript) throw new Error("This transcript has no text to send to the brain.");

  const authorHandle = singleLine(card.author?.handle).replace(/^@+/, "");
  const title = singleLine(card.title)
    || (authorHandle ? `X transcript — @${authorHandle}` : "X transcript");
  const sourceUrl = singleLine(card.canonicalUrl || card.url);
  const duration = transcriptDurationLabel(card.durationSec);

  return [
    `Transcript: ${title}`,
    "",
    "## Source",
    "",
    sourceUrl ? `Source: ${sourceUrl}` : "",
    authorHandle ? `Author: @${authorHandle}` : "",
    duration ? `Duration: ${duration}` : "",
    card.source ? `Transcript source: ${singleLine(card.source)}` : "",
    "",
    "## Transcript",
    "",
    transcript,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

export function sendTranscriptToBrain(input: {
  card: ChatTranscriptCard;
  vaultPath?: string;
}): Promise<CaptureObsidianNoteResponse> {
  return captureObsidianNoteFromDashboard({
    vaultPath: input.vaultPath,
    inboxFolder: TRANSCRIPT_BRAIN_INTAKE_FOLDER,
    content: buildTranscriptBrainNoteContent(input.card),
  });
}
