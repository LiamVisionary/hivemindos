export const BEAM_QUESTION_TYPES = [
  "abstention",
  "contradiction_resolution",
  "event_ordering",
  "information_extraction",
  "instruction_following",
  "knowledge_update",
  "multi_session_reasoning",
  "preference_following",
  "summarization",
  "temporal_reasoning",
];

const LOCOMO_DATE_PATTERN = /^(\d{1,2}):(\d{2})\s+(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),\s+(\d{4})$/i;
const LONGMEMEVAL_DATE_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})(?:\s+\([A-Za-z]+\))?\s+(\d{2}):(\d{2})$/;
const MONTHS = new Map([
  ["january", 0], ["jan", 0], ["february", 1], ["feb", 1], ["march", 2], ["mar", 2],
  ["april", 3], ["apr", 3], ["may", 4], ["june", 5], ["jun", 5], ["july", 6], ["jul", 6],
  ["august", 7], ["aug", 7], ["september", 8], ["sep", 8], ["october", 9], ["oct", 9],
  ["november", 10], ["nov", 10], ["december", 11], ["dec", 11],
]);

function validEpoch(value, fallback = Date.UTC(2023, 0, 1)) {
  return Number.isFinite(value) ? value : fallback;
}

export function parseLocomoDate(value) {
  const match = String(value ?? "").trim().match(LOCOMO_DATE_PATTERN);
  if (!match) return null;
  const month = MONTHS.get(match[5].toLowerCase());
  if (month === undefined) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return Date.UTC(Number(match[6]), month, Number(match[4]), hour, Number(match[2]));
}

export function parseLongMemEvalDate(value) {
  const match = String(value ?? "").trim().match(LONGMEMEVAL_DATE_PATTERN);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}

export function formatHumanDate(epoch) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(epoch));
}

function locomoTurnContent(turn) {
  const text = String(turn?.text ?? "").trim();
  const query = String(turn?.query ?? "").trim();
  const caption = String(turn?.blip_caption ?? "").trim();
  let photo = "";
  if (query && caption) photo = `[Sharing image - query: ${query}. The image shows: ${caption}]`;
  else if (query) photo = `[Sharing image - query for: ${query}]`;
  else if (caption) photo = `[Sharing image that shows: ${caption}]`;
  return [text, photo].filter(Boolean).join(" ");
}

export function locomoSessions(entry) {
  const conversation = entry?.conversation ?? {};
  const speakerA = String(conversation.speaker_a ?? "User");
  const speakerB = String(conversation.speaker_b ?? "Assistant");
  return Object.keys(conversation)
    .filter((key) => /^session_\d+$/.test(key) && Array.isArray(conversation[key]))
    .map((key) => {
      const date = String(conversation[`${key}_date_time`] ?? "");
      const fallbackIndex = Number(key.match(/\d+/)?.[0] ?? 0);
      const startedAt = validEpoch(parseLocomoDate(date), Date.UTC(2023, 0, Math.max(1, fallbackIndex)));
      const messages = conversation[key].map((turn) => ({
        role: turn?.speaker === speakerA ? "user" : "assistant",
        content: `${String(turn?.speaker ?? (turn?.speaker === speakerA ? speakerA : speakerB))}: ${locomoTurnContent(turn)}`.trim(),
      })).filter((message) => message.content.replace(/^[^:]+:\s*/, "").trim());
      return { id: key, date, startedAt, messages, speakerA, speakerB };
    })
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
}

export function longMemEvalSessions(question) {
  const sessions = Array.isArray(question?.haystack_sessions) ? question.haystack_sessions : [];
  const dates = Array.isArray(question?.haystack_dates) ? question.haystack_dates : [];
  const ids = Array.isArray(question?.haystack_session_ids) ? question.haystack_session_ids : [];
  return sessions.map((turns, index) => {
    const date = String(dates[index] ?? "");
    const startedAt = validEpoch(parseLongMemEvalDate(date), Date.UTC(2023, 0, 1 + index));
    return {
      id: String(ids[index] ?? `session_${index}`),
      date,
      startedAt,
      messages: (Array.isArray(turns) ? turns : []).map((turn) => ({
        role: turn?.role === "assistant" ? "assistant" : "user",
        content: String(turn?.content ?? "").trim(),
      })).filter((message) => message.content),
    };
  }).sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
}

function unwrapBeamBatchDicts(batchDicts) {
  return batchDicts.map((batch) => (Array.isArray(batch?.turns) ? batch.turns : []).flatMap((turn) => Array.isArray(turn) ? turn : [turn]).filter(Boolean));
}

export function parseBeamChat(chat) {
  if (!Array.isArray(chat) || !chat.length) return [];
  const first = chat[0];
  if (first && typeof first === "object" && !Array.isArray(first) && "turns" in first) {
    return unwrapBeamBatchDicts(chat);
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const sample = Object.values(first)[0];
    const planFormat = Array.isArray(sample) && sample[0] && typeof sample[0] === "object" && "turns" in sample[0];
    if (planFormat) {
      return chat.flatMap((session) => Object.keys(session).sort((left, right) => {
        const leftIndex = Number(left.split("-").at(-1));
        const rightIndex = Number(right.split("-").at(-1));
        return (Number.isFinite(leftIndex) ? leftIndex : 0) - (Number.isFinite(rightIndex) ? rightIndex : 0);
      }).flatMap((key) => unwrapBeamBatchDicts(Array.isArray(session[key]) ? session[key] : [])));
    }
    if ("role" in first || "content" in first) return [chat];
    return [];
  }
  if (Array.isArray(first)) return chat;
  return [];
}

export function beamBatchMessages(batch) {
  return (Array.isArray(batch) ? batch : []).map((turn) => {
    const rawRole = String(turn?.role ?? "user").toLowerCase();
    const role = rawRole === "user" || rawRole === "human" ? "user" : "assistant";
    return { role, content: String(turn?.content ?? "").trim() };
  }).filter((message) => message.content);
}

export function beamBatchStartedAt(batch, fallbackIndex = 0) {
  for (const turn of Array.isArray(batch) ? batch : []) {
    const parsed = Date.parse(String(turn?.time_anchor ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.UTC(2024, 0, 1) + fallbackIndex * 60_000;
}

function parseBeamQuestions(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("BEAM probing_questions must be normalized to JSON objects before retrieval.");
  }
}

export function extractBeamQuestions(conversation) {
  const probingQuestions = parseBeamQuestions(conversation?.probing_questions);
  const questions = [];
  for (const questionType of BEAM_QUESTION_TYPES) {
    const entries = probingQuestions[questionType];
    const normalized = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : [];
    for (const entry of normalized) {
      if (typeof entry === "string") questions.push({ question_type: questionType, question_text: entry, rubric: [] });
      else if (entry && typeof entry === "object") questions.push({ ...entry, question_type: questionType });
    }
  }
  return questions;
}

export function extractBeamRubricNuggets(question) {
  const rubric = question?.rubric;
  if (Array.isArray(rubric)) return rubric.map(String);
  if (rubric && typeof rubric === "object") {
    const nuggets = Array.isArray(rubric.nuggets) ? rubric.nuggets : [];
    return nuggets.map((nugget) => typeof nugget === "object" && nugget ? String(nugget.description ?? JSON.stringify(nugget)) : String(nugget));
  }
  return rubric ? [String(rubric)] : [];
}

export function splitMessagesForConversationNotes(messages, maxCharacters = 650_000) {
  const chunks = [];
  let current = [];
  let characters = 0;
  for (const message of messages) {
    const clippedCharacters = Math.min(String(message.content ?? "").length, 6_000);
    current.push(message);
    characters += clippedCharacters;
    if (characters >= maxCharacters && current.some((item) => item.role === "assistant")) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
  }
  if (current.length) {
    if (!current.some((item) => item.role === "assistant") && chunks.length) chunks[chunks.length - 1].push(...current);
    else chunks.push(current);
  }
  return chunks.filter((chunk) => chunk.length >= 2 && chunk.some((item) => item.role === "assistant"));
}

export function parseIndexSpec(spec, maximum) {
  const requested = new Set();
  for (const part of String(spec ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [rawStart, rawEnd] = part.split("-", 2);
      const start = Number(rawStart);
      const end = Number(rawEnd);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error(`Invalid index range: ${part}`);
      for (let index = start; index <= end; index += 1) requested.add(index);
    } else {
      const index = Number(part);
      if (!Number.isInteger(index)) throw new Error(`Invalid index: ${part}`);
      requested.add(index);
    }
  }
  return [...requested].filter((index) => index >= 0 && index < maximum).sort((left, right) => left - right);
}

export function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}
