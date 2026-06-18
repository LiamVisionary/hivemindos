export const BM25_LITE_K1 = 1.2;
export const BM25_LITE_B = 0.75;

const DEFAULT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "but", "can", "for", "from",
  "has", "have", "into", "its", "not", "our", "that", "the", "their", "this",
  "use", "uses", "was", "were", "what", "when", "where", "with", "you", "your",
]);

export function bm25Tokens(value: string, stopWords: Set<string> = DEFAULT_STOP_WORDS) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((term) => term.length >= 3 && !stopWords.has(term));
}

export function bm25TermCounts(tokens: string[], maxTerms = 900) {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxTerms));
}

export function scoreBm25Terms(input: {
  terms: string[];
  documentTerms: Record<string, number>;
  documentLength: number;
  documentCount: number;
  docFreq: Map<string, number>;
  averageLength: number;
}) {
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

export function normalizeBm25Score(rawScore: number, termCount: number) {
  const midpoint = termCount <= 3 ? 5 : termCount <= 6 ? 7 : termCount <= 9 ? 9 : termCount <= 15 ? 10 : 12;
  const steepness = termCount <= 3 ? 0.7 : termCount <= 6 ? 0.6 : 0.5;
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}
