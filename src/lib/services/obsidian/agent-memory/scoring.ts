import { entityMatchesForQuery } from "@/lib/services/obsidian/agent-memory/entities";
import {
  containsPhraseWithBoundaries,
  isSelectiveExactPhrase,
  queryWordsForRecall,
  RECALL_STOP_WORDS,
} from "@/lib/services/obsidian/agent-memory/query";
import type { AgentMemoryRecord, AgentMemoryScoreDetails, RecallAgentMemoryInput } from "@/lib/services/obsidian/agent-memory/types";
import { bm25TermCounts, bm25Tokens, normalizeBm25Score, scoreBm25Terms } from "@/lib/services/search/bm25-lite";

const MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const LOW_SIGNAL_QUERY_WORDS = new Set(["agent", "agents", "brain", "hivemindos", "memory", "memories", "note", "notes", "shared", "vault"]);
// Per-signal caps keep long derived queries (32-term keyword soups) from
// inflating scores linearly with query length.
const EXACT_TITLE_CAP = 24;
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

function textWords(value: string) {
  return queryWordsForRecall(value, LOW_SIGNAL_QUERY_WORDS);
}

function recencyScore(createdAt: string) {
  const ageDays = (Date.now() - Date.parse(createdAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 4;
  if (ageDays <= 1) return 10;
  if (ageDays <= 7) return 7;
  if (ageDays <= 30) return 4;
  if (ageDays <= 180) return 2;
  return 0;
}

function recordSearchText(record: AgentMemoryRecord) {
  const cached = recordSearchTextCache.get(record);
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
  recordSearchTextCache.set(record, searchText);
  return searchText;
}

function recordContentText(record: AgentMemoryRecord) {
  const cached = recordContentTextCache.get(record);
  if (cached !== undefined) return cached;
  const contentText = record.content.toLowerCase();
  recordContentTextCache.set(record, contentText);
  return contentText;
}

export function temporalRecallMode(input: RecallAgentMemoryInput) {
  const explicit = input.temporalMode;
  if (explicit === "current" || explicit === "historical" || explicit === "as-of") return explicit;
  if (input.asOf?.trim()) return "as-of";
  const query = input.query?.toLowerCase() ?? "";
  if (/\b(as of|before|used to|previously|formerly|at the time|back then|old|older|history|historical|last week|last month|last year|yesterday)\b/.test(query)) {
    return query.includes("as of") ? "as-of" : "historical";
  }
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(query)) return "as-of";
  return "current";
}

function temporalAsOfMs(input: RecallAgentMemoryInput) {
  if (input.asOf?.trim()) {
    const parsed = Date.parse(input.asOf);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const query = input.query?.toLowerCase() ?? "";
  const iso = query.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) return Date.parse(iso);
  const now = Date.now();
  if (query.includes("yesterday")) return now - 86_400_000;
  if (query.includes("last week")) return now - 7 * 86_400_000;
  if (query.includes("last month")) return now - 30 * 86_400_000;
  if (query.includes("last year")) return now - 365 * 86_400_000;
  return undefined;
}

export function recordVisibleForRecall(record: AgentMemoryRecord, input: RecallAgentMemoryInput) {
  if (input.includeArchived) return true;
  if (record.status === "archived") return false;
  const mode = temporalRecallMode(input);
  if (mode === "current") return record.status === "active";
  const asOf = temporalAsOfMs(input);
  if (asOf === undefined) return true;
  return Date.parse(record.createdAt) <= asOf;
}

export function bm25ScoresForRecords(records: AgentMemoryRecord[], input: RecallAgentMemoryInput) {
  const terms = bm25Tokens(input.query ?? "").filter((term) => !LOW_SIGNAL_QUERY_WORDS.has(term) && !RECALL_STOP_WORDS.has(term));
  if (!terms.length) return new Map<string, { score: number; matched: string[] }>();
  const docs = records.map((record) => {
    const tokens = bm25Tokens(recordSearchText(record)).filter((term) => !LOW_SIGNAL_QUERY_WORDS.has(term));
    return {
      id: record.id,
      terms: bm25TermCounts(tokens, 500),
      length: Math.max(tokens.length, 1),
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

function temporalScore(record: AgentMemoryRecord, input: RecallAgentMemoryInput) {
  const mode = temporalRecallMode(input);
  if (mode === "current") return record.status === "active" ? 1 : -12;
  if (mode === "historical") return record.status === "superseded" ? 7 : 2;
  const asOf = temporalAsOfMs(input);
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
) {
  const query = input.query?.trim() ?? "";
  const queryWords = textWords(query);
  const haystack = recordSearchText(record);
  const contentText = recordContentText(record);
  const titleText = record.title.toLowerCase();
  const matched = new Set<string>();
  const scoreDetails: AgentMemoryScoreDetails = {};

  if (!query) scoreDetails.exact = 1;
  const queryLower = query.toLowerCase();
  if (query && isSelectiveExactPhrase(query) && containsPhraseWithBoundaries(haystack, queryLower)) {
    scoreDetails.exact = (scoreDetails.exact ?? 0) + 30;
    matched.add("exact-query");
  }
  let titlePoints = 0;
  let tagPoints = 0;
  let contentPoints = 0;
  let sourcePoints = 0;
  for (const word of queryWords) {
    if (titleText.includes(word)) {
      titlePoints += 8;
      matched.add(word);
    }
    if (record.tags.some((tag) => tag.includes(word))) {
      tagPoints += 6;
      matched.add(word);
    }
    if (contentText.includes(word)) {
      contentPoints += 4;
      matched.add(word);
    }
    if ((record.project ?? "").toLowerCase().includes(word) || (record.source ?? "").toLowerCase().includes(word)) {
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
  if (input.type && record.type === input.type.trim().toLowerCase()) scoreDetails.exact = (scoreDetails.exact ?? 0) + 10;
  if (record.searchScore) scoreDetails.search = Math.min(30, Math.max(0, Math.round(record.searchScore)));
  scoreDetails.confidence = Math.round(record.confidence * 10);
  scoreDetails.temporal = temporalScore(record, input);
  scoreDetails.usage = usageScore(record);
  scoreDetails.recency = recencyScore(record.createdAt);
  scoreDetails.status = record.tags.includes("agent-memory") || record.notePath.startsWith(`${MEMORY_FOLDER}/`) ? 4 : record.tags.includes("vault-note") ? 1 : 0;
  const score = Math.round(Object.values(scoreDetails).reduce((sum, value) => sum + (value ?? 0), 0) * 10) / 10;
  return { score, matched: [...matched], scoreDetails };
}
