// Shared scoring/query logic for the hive-brain CLI local fallback.
// This module MIRRORS the app implementation in:
//   src/lib/services/obsidian/agent-memory/scoring.ts
//   src/lib/services/obsidian/agent-memory/query.ts
//   src/lib/services/search/bm25-lite.ts
// so recall quality does not silently degrade when the app API is down.
// scripts/test-hive-brain-scoring-parity.mjs asserts the two stay in sync —
// change them together.

export const LOW_SIGNAL_QUERY_WORDS = new Set(["agent", "agents", "brain", "hivemindos", "memory", "memories", "note", "notes", "shared", "vault"]);

export const RECALL_STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "all", "also", "and", "any", "are", "back", "because", "been",
  "before", "being", "below", "between", "both", "but", "can", "cannot", "could", "did", "does", "doing", "down",
  "during", "each", "either", "else", "ever", "every", "few", "for", "from", "further", "get", "gets", "getting",
  "got", "had", "has", "have", "having", "help", "helps", "her", "here", "hers", "him", "his", "how", "into", "its", "itself",
  "just", "least", "less", "let", "lets", "like", "made", "make", "makes", "many", "may", "might", "more", "most",
  "much", "must", "myself", "near", "need", "needs", "neither", "nor", "not", "now", "off", "once", "one", "ones",
  "only", "onto", "other", "others", "our", "ours", "out", "over", "own", "per", "please", "same", "she", "should",
  "since", "some", "still", "such", "sure", "than", "thank", "thanks", "that", "the", "their", "theirs", "them", "then", "there",
  "these", "they", "this", "those", "through", "too", "under", "until", "upon", "very", "want", "wants", "was",
  "way", "well", "were", "what", "when", "where", "whether", "which", "while", "who", "whom", "why", "will",
  "with", "within", "without", "would", "yes", "yet", "you", "your", "yours",
]);

export const AGENT_MEMORY_ANSWER_MIN_SCORE = 30;
export const SEMANTIC_SCORE_WEIGHT = 24;
export const SEMANTIC_MATCH_GATE = 0.6;
export const TIERED_MEMORY_STRONG_SCORE = 32;
export const TIERED_MEMORY_USABLE_SCORE = 24;
export const TIERED_MEMORY_HIGH_CONFIDENCE = 0.85;

const EXACT_TITLE_CAP = 32;
const EXACT_TAG_CAP = 12;
const EXACT_CONTENT_CAP = 16;
const EXACT_SOURCE_CAP = 6;
const MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const MAX_DIRECT_QUERY_CHARS = 240;
const MAX_DERIVED_TERMS = 32;
const MAX_DERIVED_PHRASES = 3;
const BOILERPLATE_SECTION_HEADINGS = /^##\s+(routing contract|queen bee delegation|loop contract)\s*$/i;
const BOILERPLATE_LEAD_LINES = [
  /^you are receiving an automated kanban assignment/i,
  /^treat existing notes as authoritative retry context/i,
  /^complete the task as far as your runtime\/tools allow/i,
];

export function redactSecrets(text) {
  return String(text ?? "")
    .replace(/\b(sk|pk|rk|ak)-[A-Za-z0-9]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, "[REDACTED_JWT]")
    .replace(/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]+?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/(password|passwd|secret|api_key|apikey|token)\s*[:=]\s*["']?[A-Za-z0-9!@#$%^&*\-_+]{8,}["']?/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}(?::\d+)?(?:\/[^\s"'`<>)\]]*)?/g, "[REDACTED_TAILNET_URL]")
    .replace(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/g, "[REDACTED_TAILNET_IP]");
}

export function queryWordsForRecall(value, extraStopWords) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length > 2 && !RECALL_STOP_WORDS.has(word) && !(extraStopWords && extraStopWords.has(word)));
}

// Mirrors the conservative suffix folding in agent-memory/query.ts. Keep
// this local fallback in parity with the app scorer so an unavailable API
// does not change which memory wins.
export function morphologicalTermVariants(word) {
  const variants = new Set();
  const add = (value, minLength) => {
    if (value.length >= minLength && value !== word) variants.add(value);
  };
  if (word.endsWith("ies") && word.length >= 5) add(`${word.slice(0, -3)}y`, 3);
  if (word.endsWith("es") && word.length >= 5) add(word.slice(0, -2), 3);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length >= 4) add(word.slice(0, -1), 3);
  if (word.endsWith("ed") && word.length >= 5) {
    add(word.slice(0, -2), 4);
    add(`${word.slice(0, -2)}e`, 4);
    if (word.length >= 6 && word[word.length - 3] === word[word.length - 4]) add(word.slice(0, -3), 4);
  }
  if (word.endsWith("ing") && word.length >= 6) {
    add(word.slice(0, -3), 4);
    add(`${word.slice(0, -3)}e`, 4);
    if (word.length >= 7 && word[word.length - 4] === word[word.length - 5]) add(word.slice(0, -4), 4);
  }
  return [...variants];
}

function stripBoilerplate(raw) {
  const withoutFences = raw.replace(/```[\s\S]*?```/g, " ");
  const lines = withoutFences.split("\n");
  const kept = [];
  const requestLines = [];
  let skippingSection = false;
  let inRequestSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      skippingSection = BOILERPLATE_SECTION_HEADINGS.test(trimmed);
      inRequestSection = /^##\s+request\s*$/i.test(trimmed);
      if (skippingSection) continue;
    }
    if (skippingSection) continue;
    if (BOILERPLATE_LEAD_LINES.some((pattern) => pattern.test(trimmed))) continue;
    kept.push(line);
    if (inRequestSection && !/^##\s+/.test(trimmed)) requestLines.push(line);
  }
  return { text: kept.join("\n"), requestText: requestLines.join("\n") };
}

function rankedTerms(text, limit) {
  const counts = new Map();
  const firstSeen = new Map();
  const words = queryWordsForRecall(text);
  words.forEach((word, index) => {
    counts.set(word, (counts.get(word) ?? 0) + 1);
    if (!firstSeen.has(word)) firstSeen.set(word, index);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || (firstSeen.get(left[0]) ?? 0) - (firstSeen.get(right[0]) ?? 0))
    .slice(0, limit)
    .map(([word]) => word);
}

export function extractRecallQuery(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { query: "", derived: false };
  if (trimmed.length <= MAX_DIRECT_QUERY_CHARS) return { query: trimmed, derived: false };
  const { text, requestText } = stripBoilerplate(trimmed);
  const phrases = [...text.matchAll(/"([^"\n]{4,80})"/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, MAX_DERIVED_PHRASES);
  const requestTerms = rankedTerms(requestText, 16);
  const remainingBudget = Math.max(8, MAX_DERIVED_TERMS - requestTerms.length);
  const bodyTerms = rankedTerms(text, MAX_DERIVED_TERMS + requestTerms.length)
    .filter((term) => !requestTerms.includes(term))
    .slice(0, remainingBudget);
  const parts = [
    ...phrases.map((phrase) => `"${phrase}"`),
    ...requestTerms,
    ...bodyTerms,
  ];
  const query = [...new Set(parts)].join(" ").trim();
  return query ? { query, derived: true } : { query: trimmed.slice(0, MAX_DIRECT_QUERY_CHARS), derived: true };
}

export function isSelectiveExactPhrase(query) {
  const trimmed = String(query ?? "").trim();
  if (trimmed.length < 12) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2 || trimmed.length >= 12;
}

export function containsPhraseWithBoundaries(haystackLower, phraseLower) {
  const escaped = phraseLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystackLower);
}

export function meaningfulMatchCount(matched) {
  return (matched ?? []).filter((term) => term !== "exact-query" && term !== "semantic" && !String(term).startsWith("entity:")).length;
}

// --- bm25-lite mirror --------------------------------------------------------

export const BM25_LITE_K1 = 1.2;
export const BM25_LITE_B = 0.75;

const BM25_DEFAULT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "but", "can", "for", "from",
  "has", "have", "into", "its", "not", "our", "that", "the", "their", "this",
  "use", "uses", "was", "were", "what", "when", "where", "with", "you", "your",
]);

export function bm25Tokens(value, stopWords = BM25_DEFAULT_STOP_WORDS) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((term) => term.length >= 3 && !stopWords.has(term));
}

export function bm25TermCounts(tokens, maxTerms = 900) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxTerms));
}

export function scoreBm25Terms(input) {
  let score = 0;
  for (const term of input.terms) {
    const frequency = input.documentTerms[term] ?? 0;
    if (!frequency) continue;
    const df = input.docFreq.get(term) ?? 1;
    const idf = Math.log(1 + (input.documentCount - df + 0.5) / (df + 0.5));
    const denominator = frequency + BM25_LITE_K1 * (1 - BM25_LITE_B + BM25_LITE_B * (input.documentLength / Math.max(1, input.averageLength)));
    score += idf * ((frequency * (BM25_LITE_K1 + 1)) / denominator);
  }
  return score;
}

export function normalizeBm25Score(rawScore, termCount) {
  const midpoint = termCount <= 3 ? 5 : termCount <= 6 ? 7 : termCount <= 9 ? 9 : termCount <= 15 ? 10 : 12;
  const steepness = termCount <= 3 ? 0.7 : termCount <= 6 ? 0.6 : 0.5;
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}

// --- entity matching mirror --------------------------------------------------

const GENERIC_ENTITY_WORDS = new Set([
  "agent", "agents", "brain", "critical", "fixed", "memory", "note", "notes", "service", "services", "shared", "vault", "verified",
]);

function normalizeEntity(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function entityKey(value) {
  return normalizeEntity(value).toLowerCase();
}

export function normalizeEntityList(values) {
  const output = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const normalized = normalizeEntity(value);
    const key = entityKey(normalized);
    if (!key || key.length < 2 || key.length > 96 || seen.has(key)) continue;
    if (/^[a-z]+$/.test(key) && GENERIC_ENTITY_WORDS.has(key)) continue;
    // ALL-CAPS stopwords ("AND", "THE", "NOT") are acronym-extractor artifacts,
    // not entities (mirrors entities.ts).
    if (/^[a-z]+$/.test(key) && RECALL_STOP_WORDS.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output.slice(0, 32);
}

function containsWithBoundaries(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

export function entityMatchesForQuery(query, record) {
  // Boundary-checked in both directions (mirrors entities.ts): raw substring
  // containment made short queries ("hi") match entities like "HivemindOS".
  const lower = String(query ?? "").toLowerCase().trim();
  if (lower.length < 3) return [];
  const matches = [...(record.entities ?? []), ...(record.aliases ?? [])]
    .filter((entity) => {
      const key = entityKey(entity);
      if (!key) return false;
      return containsWithBoundaries(lower, key) || containsWithBoundaries(key, lower);
    });
  return normalizeEntityList(matches);
}

// --- record scoring mirror ---------------------------------------------------

function textWords(value) {
  return queryWordsForRecall(value, LOW_SIGNAL_QUERY_WORDS);
}

function queryTypeIntent(query) {
  const lower = String(query ?? "").toLowerCase();
  if (/\b(artifact|proof|evidence|receipt|verification|verified|proven?|demonstrat(?:e|ed|ion))\b/.test(lower)) return "artifact";
  if (/\b(instruction|rule|guidance|must|required|require|should)\b/.test(lower) || /\bbefore\s+(?:calling|claiming|declaring|saying)\b/.test(lower)) return "instruction";
  if (/\b(decide|decision|choose|chosen|selected|set)\b/.test(lower)) return "decision";
  if (/\b(preference|prefer|favorite|favourite|likes?)\b/.test(lower)) return "preference";
  if (/\b(commitment|committed|promised?)\b/.test(lower)) return "commitment";
  if (/\b(goal|objective|aim)\b/.test(lower)) return "goal";
  if (/\b(lesson|learning|learned|learnt)\b/.test(lower)) return "learning";
  return undefined;
}

function temporalTopicPhrase(query) {
  return String(query ?? "").trim().replace(
    /^(?:(?:previously|formerly|historically|back then|at the time)|(?:(?:as of|before)\s+\d{4}-\d{2}-\d{2})|yesterday|last week|last month|last year)\s*[:,;-]?\s+/i,
    "",
  );
}

export function recencyScore(createdAt, now = Date.now()) {
  const ageDays = (now - Date.parse(createdAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 4;
  if (ageDays <= 1) return 10;
  if (ageDays <= 7) return 7;
  if (ageDays <= 30) return 4;
  if (ageDays <= 180) return 2;
  return 0;
}

export function temporalRecallMode(input) {
  const explicit = input.temporalMode;
  if (explicit === "current" || explicit === "historical" || explicit === "as-of") return explicit;
  if (input.asOf && String(input.asOf).trim()) return "as-of";
  const query = (input.query ?? "").toLowerCase();
  if (/\b(?:as of|before)\s+\d{4}-\d{2}-\d{2}\b/.test(query)) return "as-of";
  if (/\b(as of|last week|last month|last year|yesterday)\b/.test(query)) return "as-of";
  if (/\b(used to|previously|formerly|at the time|back then|old|older|history|historical)\b/.test(query)) return "historical";
  return "current";
}

function parseAsOfValue(value) {
  const trimmed = String(value).trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T23:59:59.999Z`)
    : Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function temporalAsOfMs(input, now = Date.now()) {
  if (input.asOf && String(input.asOf).trim()) {
    return parseAsOfValue(input.asOf);
  }
  const query = (input.query ?? "").toLowerCase();
  const iso = query.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso && new RegExp(`\\bbefore\\s+${iso.replace(/-/g, "\\-")}\\b`).test(query)) return Date.parse(iso) - 1;
  if (iso && new RegExp(`\\bas of(?:\\s+the end of)?\\s+${iso.replace(/-/g, "\\-")}\\b`).test(query)) return parseAsOfValue(iso);
  if (query.includes("yesterday")) return now - 86_400_000;
  if (query.includes("last week")) return now - 7 * 86_400_000;
  if (query.includes("last month")) return now - 30 * 86_400_000;
  if (query.includes("last year")) return now - 365 * 86_400_000;
  return undefined;
}

export function recordVisibleForRecall(record, input, referenceNow = Date.now()) {
  const explicitlyRequestsActions = String(input.type ?? "").trim().toLowerCase() === "action";
  if (record.type === "action" && !explicitlyRequestsActions && !input.includeOperational) return false;
  if (input.includeArchived) return true;
  if (record.status === "archived") return false;
  const mode = temporalRecallMode(input);
  if (mode === "current") return (record.status || "active") === "active";
  if (mode === "historical") return true;
  const asOf = temporalAsOfMs(input, referenceNow);
  if (asOf === undefined) return true;
  return Date.parse(record.createdAt) <= asOf;
}

function temporalScore(record, input, now = Date.now()) {
  const mode = temporalRecallMode(input);
  if (mode === "current") return (record.status || "active") === "active" ? 1 : -12;
  if (mode === "historical") return record.status === "superseded" ? 7 : 2;
  const asOf = temporalAsOfMs(input, now);
  if (asOf === undefined) return 2;
  const created = Date.parse(record.createdAt);
  if (!Number.isFinite(created) || created > asOf) return -20;
  const daysBefore = Math.max(0, (asOf - created) / 86_400_000);
  const ageFit = Math.max(1, 6 - Math.min(5, daysBefore / 30));
  return (record.status || "active") === "active" ? 8 + ageFit : 3 + ageFit;
}

function usageScore(record) {
  const retrievals = record.usage?.retrievalCount ?? 0;
  const finals = record.usage?.finalAnswerCount ?? 0;
  if (!retrievals && !finals) return 0;
  return Math.min(2, Math.log2(1 + retrievals) * 0.5) + Math.min(6, finals * 2);
}

function recordSearchText(record) {
  if (record.__searchText !== undefined) return record.__searchText;
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
    (record.tags ?? []).join(" "),
    (record.metaTags ?? []).join(" "),
    (record.entities ?? []).join(" "),
    (record.aliases ?? []).join(" "),
    (record.supersedes ?? []).join(" "),
    (record.supersededBy ?? []).join(" "),
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
  Object.defineProperty(record, "__searchText", { value: searchText, enumerable: false, configurable: true });
  return searchText;
}

export function bm25ScoresForRecords(records, input) {
  const terms = bm25Tokens(input.query ?? "").filter((term) => !LOW_SIGNAL_QUERY_WORDS.has(term) && !RECALL_STOP_WORDS.has(term));
  if (!terms.length) return new Map();
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
  const docFreq = new Map();
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

export function scoreAgentMemory(record, input, lexical, semantic, referenceNow = Date.now()) {
  const query = (input.query ?? "").trim();
  const queryWords = textWords(query);
  const haystack = recordSearchText(record);
  const contentText = (record.content ?? "").toLowerCase();
  const titleText = (record.title ?? "").toLowerCase();
  const matched = new Set();
  const scoreDetails = {};

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
    const forms = [word, ...morphologicalTermVariants(word)];
    if (forms.some((form) => titleText.includes(form))) {
      titlePoints += 8;
      matched.add(word);
    }
    if ((record.tags ?? []).some((tag) => forms.some((form) => tag.includes(form)))) {
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

  if (lexical?.matched?.length) {
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
  if (input.type && record.type === String(input.type).trim().toLowerCase()) scoreDetails.exact = (scoreDetails.exact ?? 0) + 10;
  if (record.searchScoreNormalized !== undefined) {
    scoreDetails.search = Math.min(30, Math.max(0, Math.round(record.searchScoreNormalized * 30)));
  } else if (record.searchScore) {
    scoreDetails.search = Math.min(30, Math.max(0, Math.round(record.searchScore)));
  }
  scoreDetails.confidence = Math.round((record.confidence ?? 0.7) * 10);
  scoreDetails.temporal = temporalScore(record, input, referenceNow);
  scoreDetails.usage = usageScore(record);
  scoreDetails.recency = recencyScore(record.createdAt, referenceNow);
  scoreDetails.status = (record.tags ?? []).includes("agent-memory") || String(record.notePath ?? "").startsWith(`${MEMORY_FOLDER}/`) ? 4 : (record.tags ?? []).includes("vault-note") ? 1 : 0;
  const score = Math.round(Object.values(scoreDetails).reduce((sum, value) => sum + (value ?? 0), 0) * 10) / 10;
  return { score, matched: [...matched], scoreDetails };
}

export function shouldUseDistilledMemoryOnly(input, hits) {
  if (!(input.query ?? "").trim()) return true;
  const topHit = hits[0];
  if (!topHit) return false;
  if (!topHit.matched.length) return false;
  if (topHit.score >= TIERED_MEMORY_STRONG_SCORE) return true;
  return topHit.score >= TIERED_MEMORY_USABLE_SCORE && (topHit.confidence ?? 0.7) >= TIERED_MEMORY_HIGH_CONFIDENCE && topHit.matched.length >= 2;
}
