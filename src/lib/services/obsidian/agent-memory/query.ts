// Query preparation shared by typed-memory recall paths. Long prompts (hook /
// chat preflight pass raw user prompts) are reduced to salient terms so
// boilerplate and function words stop matching every memory.

export const RECALL_STOP_WORDS = new Set([
  // English function words (superset of bm25-lite defaults).
  "about", "above", "after", "again", "against", "all", "also", "and", "any", "are", "back", "because", "been",
  "before", "being", "below", "between", "both", "but", "can", "cannot", "could", "did", "does", "doing", "down",
  "during", "each", "either", "else", "ever", "every", "few", "for", "from", "further", "get", "gets", "getting",
  "got", "had", "has", "have", "having", "help", "helps", "her", "here", "hers", "him", "his", "how", "into", "its", "itself",
  "just", "least", "less", "let", "lets", "like", "made", "make", "makes", "many", "may", "might", "more", "most",
  "much", "must", "myself", "near", "need", "needs", "neither", "nor", "not", "now", "off", "once", "one", "ones",
  "only", "onto", "other", "others", "our", "ours", "out", "over", "own", "per", "please", "same", "she", "should",
  "since", "some", "still", "such", "sure", "than", "that", "the", "their", "theirs", "them", "then", "there",
  "thank", "thanks", "these", "they", "this", "those", "through", "too", "under", "until", "upon", "very", "want", "wants", "was",
  "way", "well", "were", "what", "when", "where", "whether", "which", "while", "who", "whom", "why", "will",
  "with", "within", "without", "would", "yes", "yet", "you", "your", "yours",
]);

const MAX_DIRECT_QUERY_CHARS = 240;
const MAX_DERIVED_TERMS = 32;
const MAX_DERIVED_PHRASES = 3;
// App-generated wrapper sections in orchestrator prompts; their boilerplate
// terms otherwise dominate salience for every delegated task.
const BOILERPLATE_SECTION_HEADINGS = /^##\s+(routing contract|queen bee delegation|loop contract)\s*$/i;
const BOILERPLATE_LEAD_LINES = [
  /^you are receiving an automated kanban assignment/i,
  /^treat existing notes as authoritative retry context/i,
  /^complete the task as far as your runtime\/tools allow/i,
];

export function queryWordsForRecall(value: string, extraStopWords?: Set<string>) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length > 2 && !RECALL_STOP_WORDS.has(word) && !extraStopWords?.has(word));
}

/**
 * Conservative stem variants for an already-lowercased query term. Substring
 * matching handles base-query → inflected-content for free ("win" is inside
 * "winning"), but an inflected query silently misses base content ("weddings"
 * is not inside "wedding"). Variants strip common suffixes so both directions
 * match; junk variants are harmless because they simply never occur.
 */
export function morphologicalTermVariants(word: string): string[] {
  const variants = new Set<string>();
  // Plural folds tolerate 3-char stems ("wins" → "win"); verb-suffix folds
  // require 4 so junk like "mining" → "min" never substring-matches "framing".
  const add = (value: string, minLength: number) => {
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

function stripBoilerplate(raw: string) {
  const withoutFences = raw.replace(/```[\s\S]*?```/g, " ");
  const lines = withoutFences.split("\n");
  const kept: string[] = [];
  const requestLines: string[] = [];
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

function rankedTerms(text: string, limit: number) {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
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

// Reduce an arbitrarily long prompt to a compact recall query. Short queries
// pass through untouched so explicit lookups keep exact-phrase behavior.
export function extractRecallQuery(raw?: string): { query: string; derived: boolean } {
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

// Exact-substring credit only applies to genuinely selective phrases; short
// fragments ("hi") substring-match nearly every memory body.
export function isSelectiveExactPhrase(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 12) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2 || trimmed.length >= 12;
}

export function containsPhraseWithBoundaries(haystackLower: string, phraseLower: string) {
  const escaped = phraseLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystackLower);
}

// Matched-term entries that represent real query evidence (not structural
// markers) — used by injection floors and the duplicate gate.
export function meaningfulMatchCount(matched: string[]) {
  return matched.filter((term) => term !== "exact-query" && term !== "semantic" && !term.startsWith("entity:")).length;
}
