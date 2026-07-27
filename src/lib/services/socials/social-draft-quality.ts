const GENERIC_AI_COPY = [
  /\bat its core\b/i,
  /\b(?:unlock|unlocking) (?:the |new |your |its )?(?:power|potential|future|possibilities|value)\b/i,
  /\brevolutioniz(?:e|es|ing)\b/i,
  /\btransformative (?:power|potential|technology|experience)\b/i,
  /\bthe future of\b/i,
  /\bgame[ -]?changer\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bin today'?s (?:fast-paced|rapidly changing|digital)\b/i,
  /\b(?:ever-evolving|rapidly evolving) landscape\b/i,
  /\bdelve (?:into|deeper)\b/i,
  /\bparadigm shift\b/i,
  /\bserves as a testament\b/i,
];

const TOKEN_STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "because",
  "been", "before", "being", "but", "by", "can", "could", "did", "do", "does", "doing", "for", "from", "get", "gets",
  "got", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "me", "more", "most", "my", "no", "not", "of", "on", "once", "one", "only", "or", "other",
  "our", "out", "over", "really", "she", "should", "so", "some", "still", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "to", "too", "up", "us", "very", "was", "we", "were", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your",
  "agent", "agents", "ai", "hivemindos", "system", "systems", "thing", "things",
]);

const TARGET_ANCHOR_STOP_WORDS = new Set([
  ...TOKEN_STOP_WORDS,
  "best", "build", "building", "company", "companies", "execution", "framework", "future", "idea", "ideas", "important",
  "platform", "platforms", "product", "products", "project", "projects", "real", "technology", "useful", "work", "working",
]);

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$#'@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(value: string): string {
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function meaningfulTokens(value: string, stopWords = TOKEN_STOP_WORDS): Set<string> {
  return new Set(normalized(value)
    .split(" ")
    .map((token) => stem(token.replace(/^[@#]/, "")))
    .filter((token) => token.length >= 3 && !stopWords.has(token)));
}

/** A containment-oriented similarity score that catches rewrites of the same post without punishing shared account vocabulary. */
export function socialDraftSimilarity(left: string, right: string): number {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (!leftTokens.size || !rightTokens.size) return normalized(left) === normalized(right) ? 1 : 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

/** Broad rhetorical families are intentionally coarse so a queue cannot fill with noun-swapped versions of one manifesto template. */
export function socialDraftCadenceFamily(value: string): string | undefined {
  const opener = normalized(value.split(/\n\s*\n|[.!?]\s/)[0] ?? value).slice(0, 220);
  if (/^(?:an? |your |the )?(?:ai )?agents?\b.{0,130}\b(?:without|cannot|can't|dont|don't|do not|need|needs)\b/.test(opener)) {
    return "abstract-agent-thesis";
  }
  if (/^the (?:best|useful|hard|real|interesting|important|problem|thing)\b/.test(opener)) return "evaluative-the-thesis";
  if (/^(?:most|too many|a lot of)\b.{0,100}\b(?:stop|start|end)\b/.test(opener)) return "demo-contrast-thesis";
  if (/\b(?:is|are) (?:still )?just (?:a |an |one )?\w+(?: \w+){0,3}$/.test(opener)) return "reductive-aphorism";
  return undefined;
}

export function socialDraftHasGenericAiCopy(value: string): boolean {
  return GENERIC_AI_COPY.some((pattern) => pattern.test(value));
}

export function socialDraftQualityIssues(input: {
  text: string;
  maxCharacters: number;
  priorTexts: string[];
}): string[] {
  const issues: string[] = [];
  if (input.text.length > input.maxCharacters) issues.push("over-character-limit");
  if (socialDraftHasGenericAiCopy(input.text)) issues.push("generic-ai-copy");
  if (input.priorTexts.some((prior) => socialDraftSimilarity(input.text, prior) >= 0.72)) issues.push("near-duplicate");
  const family = socialDraftCadenceFamily(input.text);
  if (family && input.priorTexts.some((prior) => socialDraftCadenceFamily(prior) === family)) issues.push(`repeated-cadence:${family}`);
  return issues;
}

export function sourceAnchorIsSupported(anchor: string, groundingText: string): boolean {
  const cleanAnchor = normalized(anchor);
  return cleanAnchor.length >= 4 && normalized(groundingText).includes(cleanAnchor);
}

/** Replies must carry a non-generic word from an exact parent-post anchor into the public reply. */
export function targetAnchorIsSupported(anchor: string, targetText: string, replyText: string): boolean {
  const cleanAnchor = normalized(anchor);
  if (cleanAnchor.length < 3 || !normalized(targetText).includes(cleanAnchor)) return false;
  const anchorTokens = meaningfulTokens(anchor, TARGET_ANCHOR_STOP_WORDS);
  if (!anchorTokens.size) return false;
  const targetTokens = meaningfulTokens(targetText, TARGET_ANCHOR_STOP_WORDS);
  const replyTokens = meaningfulTokens(replyText, TARGET_ANCHOR_STOP_WORDS);
  for (const token of anchorTokens) {
    if (targetTokens.has(token) && replyTokens.has(token)) return true;
  }
  return false;
}
