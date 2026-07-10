import { queryWordsForRecall } from "@/lib/services/obsidian/agent-memory/query";

function compactContent(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function queryCenteredMemoryExcerpt(value: string, query?: string, maxLength = 320) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  const terms = [...new Set(queryWordsForRecall(query ?? ""))].filter((term) => term.length >= 3);
  if (!terms.length) return compactContent(compacted, maxLength);
  const lower = compacted.toLowerCase();
  const candidates: number[] = [];
  for (const term of terms) {
    let from = 0;
    for (let count = 0; count < 12; count += 1) {
      const index = lower.indexOf(term, from);
      if (index < 0) break;
      candidates.push(index);
      from = index + term.length;
    }
  }
  if (!candidates.length) return compactContent(compacted, maxLength);
  let bestStart = 0;
  let bestScore = -1;
  for (const candidate of candidates) {
    const start = Math.max(0, Math.min(compacted.length - maxLength, candidate - Math.floor(maxLength * 0.35)));
    const window = lower.slice(start, start + maxLength);
    const matched = terms.filter((term) => window.includes(term)).length;
    const occurrences = terms.reduce((sum, term) => sum + window.split(term).length - 1, 0);
    const score = matched * 100 + occurrences;
    if (score > bestScore || (score === bestScore && start < bestStart)) {
      bestScore = score;
      bestStart = start;
    }
  }
  if (bestStart > 0) {
    const nextSpace = compacted.indexOf(" ", bestStart);
    if (nextSpace >= 0 && nextSpace - bestStart < 32) bestStart = nextSpace + 1;
  }
  const prefix = bestStart > 0 ? "..." : "";
  const trailingEllipsisLength = bestStart + maxLength < compacted.length ? 3 : 0;
  const available = Math.max(1, maxLength - prefix.length - trailingEllipsisLength);
  let snippet = compacted.slice(bestStart, bestStart + available).trim();
  const lastSpace = snippet.lastIndexOf(" ");
  if (lastSpace > available * 0.8) snippet = snippet.slice(0, lastSpace);
  const suffix = bestStart + snippet.length < compacted.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

type ExcerptWindow = {
  start: number;
  score: number;
};

type ConversationPassage = {
  startTurn: number;
  endTurn: number;
  score: number;
  text: string;
  anchorText: string;
  anchorScore: number;
  responseText?: string;
  responseScore: number;
};

function matchingOffsets(value: string, terms: string[]) {
  const offsets: number[] = [];
  for (const term of terms) {
    let from = 0;
    for (let count = 0; count < 24; count += 1) {
      const index = value.indexOf(term, from);
      if (index < 0) break;
      offsets.push(index);
      from = index + term.length;
    }
  }
  return offsets.sort((left, right) => left - right);
}

const CONVERSATION_QUERY_EXPANSIONS: Record<string, string[]> = {
  bought: ["got", "purchase", "purchased", "scored"],
  buy: ["got", "purchase", "purchased", "scored"],
  collectible: ["autograph", "autographs", "keepsake", "memorabilia", "signed"],
  composer: ["soundtrack", "theme"],
  feedback: ["comment", "comments", "review"],
  fruit: ["fruity", "mango"],
  gave: ["give", "gift", "present", "received", "signed"],
  give: ["gave", "gift", "present", "received", "signed"],
};

function expandedConversationTerms(terms: string[]) {
  return [...new Set(terms.flatMap((term) => CONVERSATION_QUERY_EXPANSIONS[term] ?? []))]
    .filter((term) => !terms.includes(term));
}

function scoreExcerptWindow(value: string, terms: string[], expandedTerms: string[], start: number, length: number) {
  const window = value.slice(start, start + length);
  const termScore = (term: string, base: number) => {
    const index = window.indexOf(term);
    if (index < 0) return 0;
    const position = 1 - 0.4 * Math.min(1, index / Math.max(1, length));
    return base * position;
  };
  const primary = terms.reduce((score, term) => score + termScore(term, 100), 0);
  const expanded = expandedTerms.reduce((score, term) => score + termScore(term, 75), 0);
  const specificity = /(?:[$€£]\s?\d|\b\d+(?:[.,:-]\d+)*\b|["“][^"”]{3,80}["”])/u.test(window) ? 35 : 0;
  return primary + expanded + specificity;
}

function alignExcerptStart(value: string, start: number) {
  if (start <= 0) return 0;
  const previousSpace = value.lastIndexOf(" ", start);
  if (previousSpace >= 0 && start - previousSpace < 32) return previousSpace + 1;
  const nextSpace = value.indexOf(" ", start);
  return nextSpace >= 0 && nextSpace - start < 32 ? nextSpace + 1 : start;
}

function renderExcerptWindow(value: string, start: number, length: number) {
  const alignedStart = alignExcerptStart(value, start);
  const prefix = alignedStart > 0 ? "..." : "";
  const suffixLength = alignedStart + length < value.length ? 3 : 0;
  const available = Math.max(1, length - prefix.length - suffixLength);
  let snippet = value.slice(alignedStart, alignedStart + available).trim();
  const lastSpace = snippet.lastIndexOf(" ");
  if (lastSpace > available * 0.8) snippet = snippet.slice(0, lastSpace);
  const suffix = alignedStart + snippet.length < value.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

const BROAD_CONVERSATION_QUERY = /\b(summary|summarize|overall progress|over time|throughout|across|all sessions|all conversations|in order|journey|develop(?:ed|ment)?|evolv(?:e|ed|ing))\b/i;
const ASSISTANT_GROUNDED_QUERY = /\b(?:you|your)\s+(?:recommend(?:ed|ation)?|suggest(?:ed|ion)?|told|said|advis(?:e|ed|ing)|answer(?:ed)?|response)\b/i;
const EXTERNAL_SOURCE_EVIDENCE_QUERY = /(?:\b(?:article|report|document|paper|book|video|podcast|email|message)\b.*\b(?:read|watched|heard|received|covered|main points?|contents?|details?)\b|\b(?:main points?|contents?|details?)\b.*\b(?:article|report|document|paper|book|video|podcast|email|message)\b|\b(?:specific\s+)?feedback\b.*\b(?:team|reviewers?|colleagues?|client)\b.*\b(?:provide|give|gave|share|offer))/i;
const USER_FACT_AGGREGATION_QUERY = /(?:\bhow (?:many|much)\b[^,;]*\b(?:i|my|we|our)\b|\b(?:have|did) i ever\b|\b(?:summary|summarize|overall progress|over time|throughout|across|in order|journey|develop(?:ed|ment)?|evolv(?:e|ed|ing))\b.*\b(?:i|my|me|we|our|us)\b)/i;
const COMPOUND_CONVERSATION_QUERY = /,\s*(?:and|then)\s+(?:what|which|who|when|where|why|how)\b/i;
const MAX_TURN_AWARE_TRANSCRIPT_CHARS = 512_000;

function userGroundedTranscript(value: string, query?: string) {
  if (!(EXTERNAL_SOURCE_EVIDENCE_QUERY.test(query ?? "") || USER_FACT_AGGREGATION_QUERY.test(query ?? "")) || ASSISTANT_GROUNDED_QUERY.test(query ?? "")) {
    return value;
  }
  const marker = /\*\*([^*\n]{1,80}):\*\*\s*/g;
  const turns = [...value.matchAll(marker)];
  if (!turns.length) return value;
  const userTurns = turns.flatMap((turn, index) => {
    if (turn[1].trim().toLowerCase() !== "user") return [];
    const start = (turn.index ?? 0) + turn[0].length;
    const end = turns[index + 1]?.index ?? value.length;
    const content = value.slice(start, end).trim();
    return content ? [`**User:**\n\n${content}`] : [];
  });
  return userTurns.length ? userTurns.join("\n\n") : value;
}

function conversationTurns(value: string) {
  const marker = /\*\*([^*\n]{1,80}):\*\*\s*/g;
  const matches = [...value.matchAll(marker)];
  return matches.flatMap((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    const content = value.slice(start, end).replace(/\s+/g, " ").trim();
    if (!content) return [];
    return [`**${match[1].trim()}:** ${content}`];
  });
}

function rankedConversationPassages(value: string, query: string, terms: string[], expandedTerms: string[]) {
  const turns = conversationTurns(value);
  if (turns.length < 2) return [];
  const corpus = turns.join(" ").toLowerCase();
  const queryNumbers = new Set(query.match(/\b\d+(?:[.,:-]\d+)*\b/g) ?? []);
  const quantitativeQuery = /\b(?:how many|how much|how long|when|date|version|percentage|percent)\b/i.test(query);
  return turns.map((turn, index): ConversationPassage => {
    const nextTurn = turns[index + 1];
    const speaker = turn.match(/^\*\*([^:]+):\*\*/)?.[1]?.toLowerCase();
    const nextSpeaker = nextTurn?.match(/^\*\*([^:]+):\*\*/)?.[1]?.toLowerCase();
    const response = nextTurn && speaker !== nextSpeaker ? nextTurn : undefined;
    const text = [turn, response].filter(Boolean).join(" ");
    const turnStart = corpus.indexOf(turn.toLowerCase());
    const responseStart = response ? corpus.indexOf(response.toLowerCase(), turnStart + turn.length) : -1;
    const responseHasQuotedAnswer = Boolean(response && response.length <= 600 && /["“][^"”]{3,80}["”]/u.test(response));
    const responseHasNewNumber = Boolean(response && quantitativeQuery && (response.match(/\b\d+(?:[.,:-]\d+)*\b/g) ?? []).some((value) => !queryNumbers.has(value)));
    const responseSpecificity = responseHasQuotedAnswer || responseHasNewNumber ? 600 : 0;
    const anchorScore = scoreExcerptWindow(corpus, terms, expandedTerms, turnStart, turn.length);
    const responseScore = response ? scoreExcerptWindow(corpus, terms, expandedTerms, responseStart, response.length) + responseSpecificity : 0;
    return {
      startTurn: index,
      endTurn: response ? Math.min(turns.length - 1, index + 1) : index,
      score: anchorScore + responseScore * 0.55,
      text,
      anchorText: turn,
      anchorScore,
      responseText: response,
      responseScore,
    };
  }).sort((left, right) => right.score - left.score || left.startTurn - right.startTurn);
}

function renderFocusedPassage(value: string, terms: string[], expandedTerms: string[], maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  const lower = compacted.toLowerCase();
  const offsets = matchingOffsets(lower, [...terms, ...expandedTerms]);
  let best: ExcerptWindow = { start: 0, score: -1 };
  for (const offset of offsets) {
    const start = Math.max(0, Math.min(compacted.length - maxLength, offset - Math.floor(maxLength * 0.2)));
    const score = scoreExcerptWindow(lower, terms, expandedTerms, start, maxLength);
    if (score > best.score || (score === best.score && start < best.start)) best = { start, score };
  }
  return renderExcerptWindow(compacted, best.start, maxLength);
}

function renderConversationPassage(passage: ConversationPassage, terms: string[], expandedTerms: string[], maxLength: number) {
  if (passage.text.length <= maxLength) return passage.text;
  if (!passage.responseText) return renderFocusedPassage(passage.text, terms, expandedTerms, maxLength);
  if (passage.responseText.length >= maxLength * 0.7) {
    const focus = passage.responseScore >= passage.anchorScore ? passage.responseText : passage.anchorText;
    return renderFocusedPassage(focus, terms, expandedTerms, maxLength);
  }
  const separator = " ";
  const anchorLength = Math.max(80, maxLength - passage.responseText.length - separator.length);
  const anchor = renderFocusedPassage(passage.anchorText, terms, expandedTerms, anchorLength);
  return `${anchor}${separator}${passage.responseText}`.slice(0, maxLength);
}

export function conversationMemoryExcerptBudget(query?: string) {
  return BROAD_CONVERSATION_QUERY.test(query ?? "") ? 800 : 520;
}

/**
 * Conversation notes often contain the matching question near one answer and
 * a second supporting fact much later. Preserve up to two distinct, ranked
 * passages instead of spending the whole prompt budget on the first match.
 */
export function queryFocusedConversationExcerpt(value: string, query?: string, maxLength = 800) {
  const transcriptMarker = value.match(/(?:^|\n)## Transcript\s*(?:\n|$)/i);
  const transcript = transcriptMarker?.index === undefined
    ? value
    : value.slice(transcriptMarker.index + transcriptMarker[0].length);
  const turnAware = transcript.length <= MAX_TURN_AWARE_TRANSCRIPT_CHARS;
  const groundedTranscript = turnAware ? userGroundedTranscript(transcript, query) : transcript;
  const compacted = groundedTranscript.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  const terms = [...new Set(queryWordsForRecall(query ?? ""))].filter((term) => term.length >= 3);
  if (!terms.length) return compactContent(compacted, maxLength);
  const expandedTerms = expandedConversationTerms(terms);
  const passageTerms = [...terms, ...expandedTerms];
  const lower = compacted.toLowerCase();
  const passageCandidates = turnAware ? rankedConversationPassages(groundedTranscript, query ?? "", terms, expandedTerms) : [];
  if (passageCandidates.length) {
    const primary = passageCandidates[0];
    const secondary = passageCandidates.find((passage) => passage.startTurn !== primary.startTurn);
    const useMultiplePassages = !ASSISTANT_GROUNDED_QUERY.test(query ?? "") && (
      BROAD_CONVERSATION_QUERY.test(query ?? "")
      || COMPOUND_CONVERSATION_QUERY.test(query ?? "")
      || Boolean(secondary && maxLength >= 320)
    );
    const selected = useMultiplePassages && secondary ? [primary, secondary] : [primary];
    const separator = " … ";
    const passageLength = selected.length === 1 ? maxLength : Math.floor((maxLength - separator.length) / 2);
    return selected
      .sort((left, right) => left.startTurn - right.startTurn)
      .map((passage) => renderConversationPassage(passage, terms, expandedTerms, passageLength))
      .join(separator)
      .slice(0, maxLength);
  }
  const offsets = matchingOffsets(lower, passageTerms);
  if (!offsets.length) return compactContent(compacted, maxLength);

  const clusterDistance = Math.max(180, Math.floor(maxLength * 0.55));
  const clusters: number[][] = [];
  for (const offset of offsets) {
    const latest = clusters.at(-1);
    if (!latest || offset - latest.at(-1)! > clusterDistance) clusters.push([offset]);
    else latest.push(offset);
  }
  const useMultiplePassages = BROAD_CONVERSATION_QUERY.test(query ?? "") || COMPOUND_CONVERSATION_QUERY.test(query ?? "");
  const windowCount = useMultiplePassages ? Math.min(2, clusters.length) : 1;
  const separator = " … ";
  const windowLength = windowCount === 1
    ? maxLength
    : Math.floor((maxLength - separator.length) / windowCount);
  const candidates: ExcerptWindow[] = clusters.map((cluster) => {
    let best: ExcerptWindow = { start: 0, score: -1 };
    for (const offset of cluster) {
      const start = Math.max(0, Math.min(compacted.length - windowLength, offset - Math.floor(windowLength * 0.2)));
      const score = scoreExcerptWindow(lower, terms, expandedTerms, start, windowLength);
      if (score > best.score || (score === best.score && start < best.start)) best = { start, score };
    }
    return best;
  });
  const selected = candidates
    .sort((left, right) => right.score - left.score || left.start - right.start)
    .slice(0, windowCount)
    .sort((left, right) => left.start - right.start);
  return selected.map((window) => renderExcerptWindow(compacted, window.start, windowLength)).join(separator).slice(0, maxLength);
}
