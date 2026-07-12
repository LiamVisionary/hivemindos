import { NextRequest } from "next/server";
import { okJson, errorJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { runPreferredOpenAiTextTurn } from "@/lib/services/openai-preferred-chat";

export const runtime = "nodejs";
export const maxDuration = 120;

type PodcastTurn = { speaker: "A" | "B"; name: string; text: string };

const MAX_SOURCE_CHARS = 24_000;

/**
 * NotebookLM-style podcast script generation. Turns arbitrary source material
 * into a grounded two-host "deep dive" dialogue. Script only — the client
 * synthesizes speech (two distinct voices) so no server TTS/credentials are
 * required for a first pass.
 */
export async function POST(request: NextRequest) {
  let sources = "";
  let title = "";
  let hostA = "Alex";
  let hostB = "Jordan";
  let style = "";
  try {
    const body = (await request.json()) as {
      sources?: unknown;
      title?: unknown;
      hostA?: unknown;
      hostB?: unknown;
      style?: unknown;
    };
    sources = typeof body.sources === "string" ? body.sources.trim().slice(0, MAX_SOURCE_CHARS) : "";
    title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (typeof body.hostA === "string" && body.hostA.trim()) hostA = body.hostA.trim().slice(0, 40);
    if (typeof body.hostB === "string" && body.hostB.trim()) hostB = body.hostB.trim().slice(0, 40);
    style = typeof body.style === "string" ? body.style.trim().slice(0, 400) : "";
  } catch {
    return errorJson("Expected a JSON body with { sources }.", 400);
  }
  if (sources.length < 40) {
    return errorJson("Add more source material to generate a podcast (at least a paragraph).", 400);
  }

  const system = [
    "You script short, engaging two-host audio podcasts (a NotebookLM-style \"deep dive\").",
    `The two hosts are ${hostA} (speaker A) and ${hostB} (speaker B). They are curious, warm, and conversational — they build on each other, ask real questions, and occasionally react, but never waste time.`,
    "Ground EVERYTHING strictly in the provided source material. Do not invent facts, statistics, names, or quotes that the sources do not support. If the sources are thin, keep the episode short rather than padding it with fabrication.",
    "Open with a quick hook, cover the most interesting substance, and close with a takeaway. Keep each turn to 1–4 sentences of natural spoken language — no stage directions, no markdown, no speaker labels inside the text.",
    "Return ONLY JSON of the exact shape {\"title\": string, \"turns\": [{\"speaker\": \"A\"|\"B\", \"text\": string}]} with 12–24 turns that alternate naturally between the two hosts.",
  ].join("\n");
  const user = [
    title ? `Requested title: ${title}` : "",
    style ? `Style notes: ${style}` : "",
    "Source material:",
    sources,
  ].filter(Boolean).join("\n\n");

  try {
    const result = await runPreferredOpenAiTextTurn({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      cacheScope: "podcast-generate",
      timeoutMs: 90_000,
      maxTokens: 2_400,
      temperature: 0.7,
      jsonMode: true,
      errorContext: "Podcast generation",
    });
    const parsed = parseScript(result.text, hostA, hostB);
    if (!parsed) {
      return errorJson("The model did not return a usable script. Try again or shorten the sources.", 502);
    }
    return okJson({
      title: parsed.title || title || "Untitled episode",
      hostA,
      hostB,
      turns: parsed.turns,
      model: result.model,
    });
  } catch (error) {
    return upstreamErrorJson("Podcast generation", error);
  }
}

function parseScript(raw: string, hostA: string, hostB: string): { title: string; turns: PodcastTurn[] } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const rawTurns = Array.isArray(obj.turns) ? obj.turns : [];
  const turns: PodcastTurn[] = [];
  for (const rawTurn of rawTurns) {
    if (!rawTurn || typeof rawTurn !== "object") continue;
    const turn = rawTurn as Record<string, unknown>;
    const speaker = String(turn.speaker ?? "").toUpperCase() === "B" ? "B" : "A";
    const content = typeof turn.text === "string"
      ? turn.text.trim()
      : typeof turn.line === "string"
        ? turn.line.trim()
        : "";
    if (!content) continue;
    turns.push({ speaker, name: speaker === "A" ? hostA : hostB, text: content });
  }
  if (!turns.length) return null;
  return { title: typeof obj.title === "string" ? obj.title.trim() : "", turns };
}
