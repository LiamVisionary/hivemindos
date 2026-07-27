import { entityMatchesForQuery } from "@/lib/services/obsidian/agent-memory/entities";
import {
  containsPhraseWithBoundaries,
  isSelectiveExactPhrase,
  morphologicalTermVariants,
  queryWordsForRecall,
  RECALL_STOP_WORDS,
} from "@/lib/services/obsidian/agent-memory/query";
import type { AgentMemoryRecord, AgentMemoryScoreDetails, RecallAgentMemoryInput } from "@/lib/services/obsidian/agent-memory/types";
import { bm25TermCounts, bm25Tokens, normalizeBm25Score, scoreBm25Terms } from "@/lib/services/search/bm25-lite";

const MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const LOW_SIGNAL_QUERY_WORDS = new Set(["agent", "agents", "brain", "hivemindos", "memory", "memories", "note", "notes", "shared", "vault"]);
// Per-signal caps keep long derived queries (32-term keyword soups) from
// inflating scores linearly with query length.
const EXACT_TITLE_CAP = 32;
const EXACT_TAG_CAP = 12;
const EXACT_CONTENT_CAP = 16;
const EXACT_SOURCE_CAP = 6;
// Hits below this are noise for context injection (answer mode/hook/preflight).
export const AGENT_MEMORY_ANSWER_MIN_SCORE = 30;
// Semantic similarity (0..1) blends in at this weight; hits at or above the
// gate count as matched even without lexical overlap.
export const SEMANTIC_SCORE_WEIGHT = 24;
export const SEMANTIC_MATCH_GATE = 0.6;
const recordSearchTextCache = new WeakMap<AgentMemoryRecord, string>();
const recordContentTextCache = new WeakMap<AgentMemoryRecord, string>();
const recordBm25DocumentCache = new WeakMap<AgentMemoryRecord, { terms: Record<string, number>; length: number }>();
const RECORD_CACHE_SOURCE = Symbol("agent-memory-cache-source");

type CacheLinkedAgentMemoryRecord = AgentMemoryRecord & { [RECORD_CACHE_SOURCE]?: AgentMemoryRecord };

function cacheSourceRecord(record: AgentMemoryRecord) {
  return (record as CacheLinkedAgentMemoryRecord)[RECORD_CACHE_SOURCE] ?? record;
}

export function withAgentMemorySearchMetadata(
  record: AgentMemoryRecord,
  metadata: Pick<AgentMemoryRecord, "searchScore" | "searchScoreNormalized" | "searchCollection">,
) {
  const clone = { ...record, ...metadata } as CacheLinkedAgentMemoryRecord;
  Object.defineProperty(clone, RECORD_CACHE_SOURCE, { value: cacheSourceRecord(record), enumerable: false });
  return clone;
}

function textWords(value: string) {
  return queryWordsForRecall(value, LOW_SIGNAL_QUERY_WORDS);
}

function queryTypeIntent(query: string) {
  const lower = query.toLowerCase();
  if (/\b(artifact|proof|evidence|receipt|verification|verified|proven?|demonstrat(?:e|ed|ion))\b/.test(lower)) return "artifact";
  if (/\b(instruction|rule|guidance|must|required|require|should)\b/.test(lower) || /\bbefore\s+(?:calling|claiming|declaring|saying)\b/.test(lower)) return "instruction";
  if (/\b(decide|decision|choose|chosen|selected|set)\b/.test(lower)) return "decision";
  if (/\b(preference|prefer|favorite|favourite|likes?)\b/.test(lower)) return "preference";
  if (/\b(commitment|committed|promised?)\b/.test(lower)) return "commitment";
  if (/\b(goal|objective|aim)\b/.test(lower)) return "goal";
  if (/\b(lesson|learning|learned|learnt)\b/.test(lower)) return "learning";
  return undefined;
}

function temporalTopicPhrase(query: string) {
  return query.trim().replace(
    /^(?:(?:previously|formerly|historically|back then|at the time)|(?:(?:as of|before)\s+\d{4}-\d{2}-\d{2})|yesterday|last week|last month|last year)\s*[:,;-]?\s+/i,
    "",
  );
}

function recencyScore(createdAt: string, referenceNow = Date.now()) {
  const ageDays = (referenceNow - Date.parse(createdAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 4;
  if (ageDays <= 1) return 10;
  if (ageDays <= 7) return 7;
  if (ageDays <= 30) return 4;
  if (ageDays <= 180) return 2;
  return 0;
}

function recordSearchText(record: AgentMemoryRecord) {
  const cacheRecord = cacheSourceRecord(record);
  const cached = recordSearchTextCache.get(cacheRecord);
  if (cached !== undefined) return cached;
  const searchText = [
    record.title,
    record.content,
    record.type,
    record.cognitiveStage,
    record.evolutionType,
    record.evolutionReason,
    record.sourceType,
    record.actorRole,
    record.memoryOrigin,
    record.tags.join(" "),
    record.metaTags?.join(" "),
    record.entities?.join(" "),
    record.aliases?.join(" "),
    record.supersedes?.join(" "),
    record.supersededBy?.join(" "),
    record.evolutionRootId,
    record.source,
    record.project,
    record.agentName,
    record.agentId,
    record.runtime,
    record.machineName,
    record.machineId,
    record.tailnetId,
    record.tailnetName,
    record.tailnetDnsName,
    record.collectorUrl,
  ].filter(Boolean).join(" ").toLowerCase();
  recordSearchTextCache.set(cacheRecord, searchText);
  return searchText;
}

function recordContentText(record: AgentMemoryRecord) {
  const cacheRecord = cacheSourceRecord(record);
  const cached = recordContentTextCache.get(cacheRecord);
  if (cached !== undefined) return cached;
  const contentText = record.content.toLowerCase();
  recordContentTextCache.set(cacheRecord, contentText);
  return contentText;
}

function recordBm25Document(record: AgentMemoryRecord) {
  const cacheRecord = cacheSourceRecord(record);
  const cached = recordBm25DocumentCache.get(cacheRecord);
  if (cached) return cached;
  const tokens = bm25Tokens(recordSearchText(record)).filter((term) => !LOW_SIGNAL_QUERY_WORDS.has(term));
  const document = { terms: bm25TermCounts(tokens, 500), length: Math.max(tokens.length, 1) };
  recordBm25DocumentCache.set(cacheRecord, document);
  return document;
}

export function temporalRecallMode(input: RecallAgentMemoryInput) {
  const explicit = input.temporalMode;
  if (explicit === "current" || explicit === "historical" || explicit === "as-of") return explicit;
  if (input.asOf?.trim()) return "as-of";
  const query = input.query?.toLowerCase() ?? "";
  if (/\b(?:as of|before)\s+\d{4}-\d{2}-\d{2}\b/.test(query)) return "as-of";
  if (/\b(as of|last week|last month|last year|yesterday)\b/.test(query)) return "as-of";
  if (/\b(used to|previously|formerly|at the time|back then|old|older|history|historical)\b/.test(query)) return "historical";
  return "current";
}

function parseAsOfValue(value: string) {
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T23:59:59.999Z`)
    : Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function temporalAsOfMs(input: RecallAgentMemoryInput, referenceNow = Date.now()) {
  if (input.asOf?.trim()) {
    return parseAsOfValue(input.asOf);
  }
  const query = input.query?.toLowerCase() ?? "";
  const iso = query.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso && new RegExp(`\\bbefore\\s+${iso.replace(/-/g, "\\-")}\\b`).test(query)) return Date.parse(iso) - 1;
  if (iso && new RegExp(`\\bas of(?:\\s+the end of)?\\s+${iso.replace(/-/g, "\\-")}\\b`).test(query)) return parseAsOfValue(iso);
  if (query.includes("yesterday")) return referenceNow - 86_400_000;
  if (query.includes("last week")) return referenceNow - 7 * 86_400_000;
  if (query.includes("last month")) return referenceNow - 30 * 86_400_000;
  if (query.includes("last year")) return referenceNow - 365 * 86_400_000;
  return undefined;
}

export function recordVisibleForRecall(record: AgentMemoryRecord, input: RecallAgentMemoryInput, referenceNow = Date.now()) {
  const explicitlyRequestsActions = input.type?.trim().toLowerCase() === "action";
  if (record.type === "action" && !explicitlyRequestsActions && !input.includeOperational) return false;
  if (input.includeArchived) return true;
  if (record.status === "archived") return false;
  const mode = temporalRecallMode(input);
  if (mode === "current") return record.status === "active";
  if (mode === "historical") return true;
  const asOf = temporalAsOfMs(input, referenceNow);
  if (asOf === undefined) return true;
  return Date.parse(record.createdAt) <= asOf;
}

export function bm25ScoresForRecords(records: AgentMemoryRecord[], input: RecallAgentMemoryInput) {
  const terms = bm25Tokens(input.query ?? "").filter((term) => !LOW_SIGNAL_QUERY_WORDS.has(term) && !RECALL_STOP_WORDS.has(term));
  if (!terms.length) return new Map<string, { score: number; matched: string[] }>();
  const docs = records.map((record) => {
    const document = recordBm25Document(record);
    return {
      id: record.id,
      terms: document.terms,
      length: document.length,
    };
  });
  const documentCount = Math.max(docs.length, 1);
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / documentCount;
  const docFreq = new Map<string, number>();
  for (const term of terms) docFreq.set(term, docs.reduce((count, doc) => count + (doc.terms[term] ? 1 : 0), 0));
  return new Map(docs.map((doc) => {
    const raw = scoreBm25Terms({
      terms,
      documentTerms: doc.terms,
      documentLength: doc.length,
      documentCount,
      docFreq,
      averageLength,
    });
    const matched = terms.filter((term) => doc.terms[term]);
    return [doc.id, { score: normalizeBm25Score(raw, terms.length), matched }];
  }));
}

// Retrieval counts are a weak signal (they reflect whatever the ranker
// returned, not usefulness) so they nudge at most +2; explicit final-answer
// usage is the strong signal and earns up to +6.
function usageScore(record: AgentMemoryRecord) {
  const retrievals = record.usage?.retrievalCount ?? 0;
  const finals = record.usage?.finalAnswerCount ?? 0;
  if (!retrievals && !finals) return 0;
  return Math.min(2, Math.log2(1 + retrievals) * 0.5) + Math.min(6, finals * 2);
}

function temporalScore(record: AgentMemoryRecord, input: RecallAgentMemoryInput, referenceNow = Date.now()) {
  const mode = temporalRecallMode(input);
  if (mode === "current") return record.status === "active" ? 1 : -12;
  if (mode === "historical") return record.status === "superseded" ? 7 : 2;
  const asOf = temporalAsOfMs(input, referenceNow);
  if (asOf === undefined) return 2;
  const created = Date.parse(record.createdAt);
  if (!Number.isFinite(created) || created > asOf) return -20;
  const daysBefore = Math.max(0, (asOf - created) / 86_400_000);
  const ageFit = Math.max(1, 6 - Math.min(5, daysBefore / 30));
  return record.status === "active" ? 8 + ageFit : 3 + ageFit;
}

export function scoreAgentMemory(
  record: AgentMemoryRecord,
  input: RecallAgentMemoryInput,
  lexical?: { score: number; matched: string[] },
  semantic?: number,
  referenceNow = Date.now(),
) {
  const query = input.query?.trim() ?? "";
  const queryWords = textWords(query);
  const haystack = recordSearchText(record);
  const contentText = recordContentText(record);
  const titleText = record.title.toLowerCase();
  const matched = new Set<string>();
  const scoreDetails: AgentMemoryScoreDetails = {};

  if (!query) scoreDetails.exact = 1;
  const exactPhrase = temporalTopicPhrase(query);
  if (exactPhrase && isSelectiveExactPhrase(exactPhrase) && containsPhraseWithBoundaries(haystack, exactPhrase.toLowerCase())) {
    scoreDetails.exact = (scoreDetails.exact ?? 0) + 30;
    matched.add("exact-query");
  }
  let titlePoints = 0;
  let tagPoints = 0;
  let contentPoints = 0;
  let sourcePoints = 0;
  for (const word of queryWords) {
    // Substring matching already covers base-query → inflected-content; stem
    // variants close the reverse direction ("weddings" query, "wedding" text).
    const forms = [word, ...morphologicalTermVariants(word)];
    if (forms.some((form) => titleText.includes(form))) {
      titlePoints += 8;
      matched.add(word);
    }
    if (record.tags.some((tag) => forms.some((form) => tag.includes(form)))) {
      tagPoints += 6;
      matched.add(word);
    }
    if (forms.some((form) => contentText.includes(form))) {
      contentPoints += 4;
      matched.add(word);
    }
    if (forms.some((form) => (record.project ?? "").toLowerCase().includes(form) || (record.source ?? "").toLowerCase().includes(form))) {
      sourcePoints += 2;
      matched.add(word);
    }
  }
  const overlap = Math.min(titlePoints, EXACT_TITLE_CAP)
    + Math.min(tagPoints, EXACT_TAG_CAP)
    + Math.min(contentPoints, EXACT_CONTENT_CAP)
    + Math.min(sourcePoints, EXACT_SOURCE_CAP);
  if (overlap) scoreDetails.exact = (scoreDetails.exact ?? 0) + overlap;

  if (lexical?.matched.length) {
    scoreDetails.lexical = Math.round(lexical.score * 18);
    for (const term of lexical.matched) matched.add(term);
  }
  const entityMatches = query ? entityMatchesForQuery(query, record) : [];
  if (entityMatches.length) {
    scoreDetails.entity = 10 + Math.min(10, entityMatches.length * 3);
    for (const entity of entityMatches) matched.add(`entity:${entity}`);
  }
  if (semantic !== undefined && semantic > 0) {
    scoreDetails.semantic = Math.round(semantic * SEMANTIC_SCORE_WEIGHT);
    if (semantic >= SEMANTIC_MATCH_GATE) matched.add("semantic");
  }
  const uniqueQueryWords = [...new Set(queryWords)];
  const coveredQueryWords = uniqueQueryWords.filter((word) => matched.has(word)).length;
  if (uniqueQueryWords.length >= 2 && coveredQueryWords) {
    scoreDetails.coverage = Math.round((coveredQueryWords / uniqueQueryWords.length) * 12);
  }
  const intendedType = input.type ? undefined : queryTypeIntent(query);
  if (intendedType && record.type === intendedType) scoreDetails.intent = 15;
  if (input.type && record.type === input.type.trim().toLowerCase()) scoreDetails.exact = (scoreDetails.exact ?? 0) + 10;
  if (record.searchScoreNormalized !== undefined) {
    scoreDetails.search = Math.min(30, Math.max(0, Math.round(record.searchScoreNormalized * 30)));
  } else if (record.searchScore) {
    scoreDetails.search = Math.min(30, Math.max(0, Math.round(record.searchScore)));
  }
  scoreDetails.confidence = Math.round(record.confidence * 10);
  scoreDetails.temporal = temporalScore(record, input, referenceNow);
  scoreDetails.usage = usageScore(record);
  scoreDetails.recency = recencyScore(record.createdAt, referenceNow);
  scoreDetails.status = record.tags.includes("agent-memory") || record.notePath.startsWith(`${MEMORY_FOLDER}/`) ? 4 : record.tags.includes("vault-note") ? 1 : 0;
  const score = Math.round(Object.values(scoreDetails).reduce((sum, value) => sum + (value ?? 0), 0) * 10) / 10;
  return { score, matched: [...matched], scoreDetails };
}
