import "server-only";

import { optionalEnv } from "@/lib/config/env";
import { runPreferredOpenAiTextTurn } from "@/lib/services/openai-preferred-chat";

// A short, tool-less chat completion over the transcript we already have —
// same OpenAI key/model the Queen chat overlay and issue-explainer ride, so no
// extra configuration is needed. Read-only, no fleet tools, no mutation.
const SUMMARY_FALLBACK_MODEL = "gpt-4o-mini";
const SUMMARY_TIMEOUT_MS = 30_000;
const MAX_TRANSCRIPT_CHARS = 24_000;

export type TranscriptSummary = {
  summary: string;
  followUpQuestion: string;
};

export type SummarizeInput = {
  transcript: string;
  kind: "video" | "thread" | "single";
  author?: string;
  title?: string;
};

function summaryModel(): string {
  return optionalEnv("OPENAI_VOICE_CHAT_MODEL") || SUMMARY_FALLBACK_MODEL;
}

const SYSTEM_PROMPT =
  "You are a sharp research assistant. You are given the transcript of an X (Twitter) video or the text of an X thread. " +
  "Write a tight, high-signal summary of the actual insight — the claims, arguments, and takeaways — in 2 to 4 sentences. " +
  "No preamble, no 'this video is about', no filler. Ground every claim in the transcript; never invent facts the transcript does not contain. " +
  "Then write ONE specific follow-up question that would help the reader go deeper or apply the insight. " +
  'Respond with STRICT JSON only, no markdown fences, matching exactly: {"summary": string, "followUpQuestion": string}.';

/**
 * Generate the agent's short summary + one follow-up question for a transcript.
 * Throws when no provider is configured or the model call fails, so the caller can
 * fall back to showing the transcript without a fabricated summary.
 */
export async function summarizeTranscript(input: SummarizeInput): Promise<TranscriptSummary> {
  const transcript = (input.transcript ?? "").trim();
  if (!transcript) throw new Error("A transcript is required to summarize.");

  const model = summaryModel();

  const clipped = transcript.length > MAX_TRANSCRIPT_CHARS
    ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[transcript truncated for summary]`
    : transcript;
  const header = [
    input.kind === "thread" ? "Source: X thread" : "Source: X video",
    input.author ? `Author: @${input.author.replace(/^@/, "")}` : "",
    input.title ? `Title: ${input.title}` : "",
  ].filter(Boolean).join("\n");

  const result = await runPreferredOpenAiTextTurn({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${header}\n\nTranscript:\n${clipped}` },
    ],
    cacheScope: "x-transcript-summary",
    timeoutMs: SUMMARY_TIMEOUT_MS,
    maxTokens: 500,
    temperature: 0.3,
    jsonMode: true,
    errorContext: "Transcript summary model",
  });
  const content = result.text;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { summary: content.trim(), followUpQuestion: "" };
  }
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const followUpQuestion = typeof record.followUpQuestion === "string" ? record.followUpQuestion.trim() : "";
  if (!summary) throw new Error("The summary model returned an unusable response.");
  return { summary, followUpQuestion };
}
