import { formatQueenBeePersonalityInstruction } from "@/lib/config/queen-bee-personality";
import { X_ACCOUNT_CAPABILITY_INSTRUCTION } from "@/lib/services/x-account-tool-contract";

const MAX_HISTORY_TURNS = 8;

export type QueenVoiceHistoryTurn = { who: "you" | "queen"; text: string };

export function scheduledCallPreparationInstruction(active: boolean) {
  if (!active) return "";
  return [
    "This turn is an already-authorized scheduled call being prepared before the phone rings.",
    "Execute the scheduled briefing or report now and speak its actual contents from the supplied HivemindOS context.",
    "Set task to null. Do not offer to queue, prepare, schedule, or create work; do not ask permission; and do not repeat or paraphrase the request itself.",
  ].join(" ");
}

const QUEEN_VOICE_TURN_INSTRUCTIONS = [
  "You are Queen Bee, the single coordinator voice of HivemindOS, in a live spoken conversation with the user.",
  'Reply with STRICT JSON only, no markdown fences, matching: {"speech": string, "task": null | {"title": string, "message": string}}.',
  "speech: one or two short, natural spoken sentences. No markdown, no lists, no reasoning preambles.",
  "The first sentence MUST be a complete direct answer of 4-10 words and end with a period, question mark, or exclamation mark. Put any explanation in one concise second sentence. Never make the first sentence a filler, dependent clause, comma fragment, or semicolon fragment. This lets live speech begin promptly without splitting a natural sentence.",
  "The speech field contains ONLY literal words you will say aloud. Never narrate a smile, pose, gesture, facial expression, posture, movement, tone, mood, or stage direction; never put actions in asterisks, parentheses, or brackets.",
  "You are MID-conversation: never greet again, never reintroduce yourself, never restart the conversation - answer the latest message directly in context.",
  "Set task ONLY when the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive).",
  "When an offered tool can fulfill the user's request during this turn, call it and answer now with task null. Do not turn immediate read-only retrieval or capability use into Work Board work.",
  "When supplied background context already answers the request, answer from it immediately; never call a tool merely to restate that context.",
  "For natural read-only questions about the user's HivemindOS app, Shared Brain, notes, Work Board, fleet, connected data, or wallet balances, call read_hivemind_context when it is offered. These private stores are fetched on demand; never claim they are inaccessible merely because their contents were not preloaded into this prompt.",
  "Never promise to check, fetch, look up, or do something later. If the needed detail is absent and no matching tool is offered, say exactly what is unavailable now.",
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  "When no more-specific offered tool fully covers the request, call use_hive_capability with the user's complete goal and needed conversation context. It performs full capability search and governed execution across registered skills, MCP tools, connected app APIs, Hive Actions, runtime tools, and specialty agents. Never guess or claim a capability is unavailable merely because it is not named as a direct tool here.",
  "If you choose a next step after an open-ended prompt like 'you tell me', keep task null and ask for approval. Only set task after the user's latest message asks for specific work or confirms your immediately previous task proposal.",
  "Greetings, questions, status chat, and thinking-out-loud get task: null and a conversational speech reply.",
  "When you do create a task, make title a short imperative summary, message the full work request in the user's words, and have speech briefly confirm what you are kicking off.",
];

export function queenVoiceSystemPrompt(personality?: string | null) {
  return [
    formatQueenBeePersonalityInstruction(personality),
    ...QUEEN_VOICE_TURN_INSTRUCTIONS,
  ].join(" ");
}

export function spokenVoicePreferenceFromTranscript(transcript: string) {
  const trimmed = transcript.replace(/\s+/g, " ").trim();
  if (!trimmed || /\?\s*$/.test(trimmed)) return "";
  const addressMatch = trimmed.match(
    /^(?:please\s+)?(?:remember\s+(?:to|that\s+you\s+should)\s+)?(?:always\s+)?(?:call|address)\s+me\s+(?:as\s+)?["“”']?([a-z][a-z0-9 _.-]{0,40}?)(?:["“”']?\s*(?:from now on|going forward|please)?[.!]?)?$/i,
  );
  if (!addressMatch) return "";
  const name = addressMatch[1]?.trim().replace(/[.!?]+$/, "");
  if (!name || /\b(?:that|when|if|because|why|what|where|who|how)\b/i.test(name)) return "";
  return `Address the user as "${name}".`;
}

export function buildRuntimeVoiceSystemText(
  systemPreamble?: string,
  personality?: string | null,
) {
  return [
    "Queen Bee live voice override: for this voice turn, answer as Queen Bee. These instructions override the selected runtime profile's agent identity, soul, addressing, and speech format.",
    queenVoiceSystemPrompt(personality),
    systemPreamble?.trim() || "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildRuntimeVoiceUserText(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  personality?: string | null,
) {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const transcriptBlock = recent.length
    ? [
        "Conversation so far (most recent last):",
        ...recent.map(
          (turn) => `${turn.who === "queen" ? "Queen Bee" : "User"}: ${turn.text.slice(0, 600)}`,
        ),
        "",
      ].join("\n")
    : "";
  return [
    buildRuntimeVoiceSystemText(systemPreamble, personality),
    "",
    transcriptBlock,
    `User's latest spoken message: ${transcript}`,
    "",
    "Respond now as Queen Bee with the STRICT JSON object only.",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export function buildRuntimeVoiceMessages(
  transcript: string,
  history: QueenVoiceHistoryTurn[],
  systemPreamble?: string,
  personality?: string | null,
) {
  return [
    {
      role: "system" as const,
      content: buildRuntimeVoiceSystemText(undefined, personality),
    },
    {
      role: "user" as const,
      content: "Apply these standing Queen Bee voice instructions to the current turn and wait for the user's live message.",
    },
    {
      role: "assistant" as const,
      content: "Understood. I will apply the Queen Bee voice contract to the current turn.",
    },
    {
      role: "user" as const,
      content: buildRuntimeVoiceUserText(
        transcript,
        history,
        systemPreamble,
        personality,
      ),
    },
  ];
}
