import { morphologicalTermVariants, queryWordsForRecall } from "@/lib/services/obsidian/agent-memory/query";

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
  relevanceScore: number;
  text: string;
  anchorText: string;
  anchorScore: number;
  responseText?: string;
  responseScore: number;
  durableGuidance: boolean;
};

type ConversationTurn = {
  speaker: string;
  speakerTerms: string[];
  text: string;
  scoringText: string;
};

// Alternate surface forms of one query term (single credit per term slot):
// substring matching covers base → inflected for free, and the memoized stem
// variants close the inflected-query → base-content direction.
const termFormsCache = new Map<string, string[]>();
function termForms(term: string): string[] {
  const cached = termFormsCache.get(term);
  if (cached) return cached;
  if (termFormsCache.size >= 4096) termFormsCache.clear();
  const forms = [term, ...morphologicalTermVariants(term)];
  termFormsCache.set(term, forms);
  return forms;
}

function matchingOffsets(value: string, terms: string[]) {
  const offsets: number[] = [];
  for (const term of terms) {
    for (const form of termForms(term)) {
      let from = 0;
      for (let count = 0; count < 24; count += 1) {
        const index = value.indexOf(form, from);
        if (index < 0) break;
        offsets.push(index);
        from = index + form.length;
      }
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

function lexicalExcerptWindowScore(value: string, terms: string[], expandedTerms: string[], start: number, length: number) {
  const window = value.slice(start, start + length);
  const termScore = (term: string, base: number) => {
    // One credit per term slot: the best-positioned surface form wins, so an
    // inflected match never stacks with its own stem variant.
    let best = -1;
    for (const form of termForms(term)) {
      const index = window.indexOf(form);
      if (index >= 0 && (best < 0 || index < best)) best = index;
    }
    if (best < 0) return 0;
    const position = 1 - 0.4 * Math.min(1, best / Math.max(1, length));
    return base * position;
  };
  const primary = terms.reduce((score, term) => score + termScore(term, 100), 0);
  const expanded = expandedTerms.reduce((score, term) => score + termScore(term, 75), 0);
  return primary + expanded;
}

function scoreExcerptWindow(value: string, terms: string[], expandedTerms: string[], start: number, length: number) {
  const window = value.slice(start, start + length);
  const lexical = lexicalExcerptWindowScore(value, terms, expandedTerms, start, length);
  const specificity = /(?:[$€£]\s?\d|\b\d+(?:[.,:-]\d+)*\b|["“][^"”]{3,80}["”])/u.test(window) ? 35 : 0;
  return lexical + specificity;
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
  // A half caption ("[Sharing image - query: trans...") is worse than none:
  // if the cut lands inside a bracketed segment, retreat to just before it.
  const lastOpen = snippet.lastIndexOf("[");
  if (lastOpen >= 0 && snippet.indexOf("]", lastOpen) < 0 && alignedStart + snippet.length < value.length) {
    const beforeSegment = snippet.slice(0, lastOpen).trimEnd();
    if (beforeSegment.length >= available * 0.4) snippet = beforeSegment;
  }
  const suffix = alignedStart + snippet.length < value.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

const BROAD_CONVERSATION_QUERY = /\b(summary|summarize|overall progress|over time|throughout|across|all sessions|all conversations|in order|journey|develop(?:ed|ment)?|evolv(?:e|ed|ing))\b/i;
const ASSISTANT_GROUNDED_QUERY = /\b(?:you|your)\s+(?:recommend(?:ed|ation)?|suggest(?:ed|ion)?|told|said|advis(?:e|ed|ing)|answer(?:ed)?|response)\b/i;
const EXTERNAL_SOURCE_EVIDENCE_QUERY = /(?:\b(?:article|report|document|paper|book|video|podcast|email|message)\b.*\b(?:read|watched|heard|received|covered|main points?|contents?|details?)\b|\b(?:main points?|contents?|details?)\b.*\b(?:article|report|document|paper|book|video|podcast|email|message)\b|\b(?:specific\s+)?feedback\b.*\b(?:team|reviewers?|colleagues?|client)\b.*\b(?:provide|give|gave|share|offer))/i;
const USER_FACT_AGGREGATION_QUERY = /(?:\bhow (?:many|much)\b[^,;]*\b(?:i|my|we|our)\b|\b(?:have|did) i ever\b|\b(?:summary|summarize|overall progress|over time|throughout|across|in order|journey|develop(?:ed|ment)?|evolv(?:e|ed|ing))\b.*\b(?:i|my|me|we|our|us)\b)/i;
const USER_MEASUREMENT_QUERY = /(?:\b(?:what|when|how (?:many|much|long|far))\b[^?]{0,180}\b(?:i|my|we|our)\b[^?]{0,180}\b(?:accuracy|percentage|percent|count|number|score|distance|duration|time|hours?|minutes?|days?|weight|height|version|date)\b|\b(?:i|my|we|our)\b[^?]{0,180}\b(?:accuracy|percentage|percent|count|number|score|distance|duration|time|hours?|minutes?|days?|weight|height|version|date)\b)/i;
const USER_LOCAL_CONTEXT_QUERY = /\b(?:how much|what(?:'s| is)?|which)\b[^?]{0,180}\b(?:i|my|we|our)\b/i;
const DURABLE_USER_GUIDANCE = /(?:\b(?:i|we)\s+(?:strongly\s+)?prefer\b|\b(?:my|our)\s+preference\b|\b(?:always|never)\s+(?:include|mention|show|provide|use|avoid|exclude|remember|recommend|suggest)\b|\bplease\s+(?:always|never|remember)\b)/i;
const COMPOUND_CONVERSATION_QUERY = /,\s*(?:and|then)\s+(?:what|which|who|when|where|why|how)\b/i;
const MAX_TURN_AWARE_TRANSCRIPT_CHARS = 512_000;

function userGroundedTranscript(value: string, query?: string) {
  if (!(EXTERNAL_SOURCE_EVIDENCE_QUERY.test(query ?? "") || USER_FACT_AGGREGATION_QUERY.test(query ?? "") || USER_MEASUREMENT_QUERY.test(query ?? "")) || ASSISTANT_GROUNDED_QUERY.test(query ?? "")) {
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conversationTurns(value: string): ConversationTurn[] {
  const marker = /\*\*([^*\n]{1,80}):\*\*\s*/g;
  const matches = [...value.matchAll(marker)];
  return matches.flatMap((match, index) => {
    const speaker = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    const content = value.slice(start, end).replace(/\s+/g, " ").trim();
    if (!content) return [];
    const scoringText = content.replace(new RegExp(`^${escapeRegExp(speaker)}\\s*:\\s*`, "i"), "").trim();
    return [{
      speaker,
      speakerTerms: queryWordsForRecall(speaker),
      text: `**${speaker}:** ${content}`,
      scoringText,
    }];
  });
}

function rankedConversationPassages(value: string, query: string, terms: string[], expandedTerms: string[]) {
  const turns = conversationTurns(value);
  if (turns.length < 2) return [];
  const speakerTerms = new Set(turns.flatMap((turn) => turn.speakerTerms));
  const contentTerms = terms.filter((term) => !speakerTerms.has(term));
  const contentExpandedTerms = expandedTerms.filter((term) => !speakerTerms.has(term));
  const scoringTerms = contentTerms.length || contentExpandedTerms.length ? contentTerms : terms;
  const scoringExpandedTerms = contentTerms.length || contentExpandedTerms.length ? contentExpandedTerms : expandedTerms;
  const queryNumbers = new Set(query.match(/\b\d+(?:[.,:-]\d+)*\b/g) ?? []);
  const quantitativeQuery = /\b(?:how many|how much|how long|when|date|version|percentage|percent)\b/i.test(query);
  const currentValueQuery = /\b(?:current|currently|latest|now|recent|recently|updated)\b/i.test(query);
  return turns.map((turn, index): ConversationPassage => {
    const previousTurn = turns[index - 1];
    const nextTurn = turns[index + 1];
    const response = nextTurn && turn.speaker.toLowerCase() !== nextTurn.speaker.toLowerCase() ? nextTurn : undefined;
    // User-grounded transcripts intentionally remove assistant prose. When a
    // short factual update uses a pronoun ("it is worth triple"), retain the
    // immediately preceding user turn so the entity and answer stay linked.
    const previousUserContext = USER_LOCAL_CONTEXT_QUERY.test(query)
      && previousTurn
      && turn.speaker.toLowerCase() === "user"
      && previousTurn.speaker.toLowerCase() === "user"
      ? previousTurn
      : undefined;
    const text = [previousUserContext?.text, turn.text, response?.text].filter(Boolean).join(" ");
    const anchorLower = turn.scoringText.toLowerCase();
    const responseLower = response?.scoringText.toLowerCase() ?? "";
    const anchorLexical = lexicalExcerptWindowScore(anchorLower, scoringTerms, scoringExpandedTerms, 0, anchorLower.length);
    const responseLexical = response
      ? lexicalExcerptWindowScore(responseLower, scoringTerms, scoringExpandedTerms, 0, responseLower.length)
      : 0;
    const responseHasQuotedAnswer = Boolean(response && response.text.length <= 600 && /["“][^"”]{3,80}["”]/u.test(response.text));
    const responseHasNewNumber = Boolean(response && quantitativeQuery && (response.text.match(/\b\d+(?:[.,:-]\d+)*\b/g) ?? []).some((value) => !queryNumbers.has(value)));
    const anchorHasNewNumber = quantitativeQuery && (turn.text.match(/\b\d+(?:[.,:-]\d+)*\b/g) ?? []).some((value) => !queryNumbers.has(value));
    const anchorStatesCompletedUpdate = /(?:\b(?:i|we|it|they|he|she)(?:'ve|'s)?\s+(?:have\s+|has\s+|had\s+)?(?:increased|improved|reached|raised|reduced|dropped|changed)|\b(?:now|currently|latest|updated)\b)/i.test(turn.scoringText);
    // A quote or number is only evidence-specific when the surrounding pair
    // also matches the query. Otherwise any unrelated ISBN, price, date, or
    // quoted title can overwhelm the real passage.
    const responseSpecificity = (anchorLexical > 0 || responseLexical > 0) && (responseHasQuotedAnswer || responseHasNewNumber) ? 220 : 0;
    const updateSpecificity = currentValueQuery && anchorHasNewNumber && anchorStatesCompletedUpdate ? 220 : 0;
    const updateRecency = currentValueQuery && turns.length > 1 ? 30 * index / (turns.length - 1) : 0;
    const speakerBonus = turn.speakerTerms.some((term) => terms.includes(term)) ? 24 : 0;
    // Explicit user preferences and standing instructions are durable control
    // signals. A short "always" or "I prefer" turn should outrank a long,
    // generic assistant answer that happens to repeat more query vocabulary.
    // Assistant-grounded lookups ("what did you recommend?") are the exception:
    // there the asked-for content is the assistant's own words, and a standing
    // instruction must not hijack the passage ranking or its render budget.
    const durableGuidance = (anchorLexical > 0 || responseLexical > 0)
      && !ASSISTANT_GROUNDED_QUERY.test(query)
      && turn.speaker.toLowerCase() === "user"
      && DURABLE_USER_GUIDANCE.test(turn.scoringText);
    const durableGuidanceSpecificity = durableGuidance ? 480 : 0;
    const anchorScore = scoreExcerptWindow(anchorLower, scoringTerms, scoringExpandedTerms, 0, anchorLower.length)
      + speakerBonus
      + updateSpecificity
      + updateRecency
      + durableGuidanceSpecificity;
    const responseScore = response
      ? scoreExcerptWindow(responseLower, scoringTerms, scoringExpandedTerms, 0, responseLower.length) + responseSpecificity
      : 0;
    return {
      startTurn: previousUserContext ? index - 1 : index,
      endTurn: response ? Math.min(turns.length - 1, index + 1) : index,
      score: anchorScore + responseScore * 0.55,
      relevanceScore: anchorLexical + responseLexical,
      text,
      anchorText: turn.text,
      anchorScore,
      responseText: response?.text,
      responseScore,
      durableGuidance,
    };
  }).sort((left, right) => right.score - left.score || left.startTurn - right.startTurn);
}

/**
 * Durable "always/never/I prefer" user turns govern any later request in the
 * conversation's scope, but rarely share vocabulary with the topical query
 * ("what should I cook?" never mentions "calorie content"). Surface the most
 * recent short standing-guidance turns query-independently so downstream
 * consumers can honor them.
 */
function standingGuidanceTurns(turns: ConversationTurn[], limit: number) {
  const guidance = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.speaker.toLowerCase() === "user"
      && turn.scoringText.length <= 400
      && DURABLE_USER_GUIDANCE.test(turn.scoringText));
  // Most recent guidance wins (knowledge-update semantics).
  return guidance.slice(-limit);
}

function distinctConversationPassages(candidates: ConversationPassage[], limit: number) {
  const selected: ConversationPassage[] = [];
  for (const candidate of candidates) {
    const overlaps = selected.some((current) => candidate.startTurn <= current.endTurn && candidate.endTurn >= current.startTurn);
    if (!overlaps) selected.push(candidate);
    if (selected.length >= limit) return selected;
  }
  return selected;
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
  if (passage.durableGuidance) {
    const separator = " ";
    const anchorLength = Math.min(Math.max(120, Math.floor(maxLength * 0.32)), passage.anchorText.length);
    const responseLength = Math.max(80, maxLength - anchorLength - separator.length);
    const anchor = renderFocusedPassage(passage.anchorText, terms, expandedTerms, anchorLength);
    const guidanceTerms = [...new Set([...terms, ...queryWordsForRecall(passage.anchorText)])];
    const response = renderFocusedPassage(passage.responseText, guidanceTerms, expandedTerms, responseLength);
    return `${anchor}${separator}${response}`.slice(0, maxLength);
  }
  if (passage.responseText.length >= maxLength * 0.7) {
    const focus = passage.responseScore >= passage.anchorScore ? passage.responseText : passage.anchorText;
    return renderFocusedPassage(focus, terms, expandedTerms, maxLength);
  }
  const separator = " ";
  const anchorLength = Math.max(80, maxLength - passage.responseText.length - separator.length);
  const anchor = renderFocusedPassage(passage.anchorText, terms, expandedTerms, anchorLength);
  return `${anchor}${separator}${passage.responseText}`.slice(0, maxLength);
}

/**
 * Counting/summary/journey questions ("how many weddings have I attended",
 * "what is the total number of days…") are answered by aggregating instances
 * scattered across sessions, so recall should favor coverage over precision.
 */
export function isAggregationRecallQuery(query?: string) {
  return BROAD_CONVERSATION_QUERY.test(query ?? "")
    || USER_FACT_AGGREGATION_QUERY.test(query ?? "")
    || /\btotal\s+(?:number|amount|count|cost|time|days?|hours?|pages?|times)\b/i.test(query ?? "");
}

const TEMPORAL_RECALL_QUERY = /\b(?:when\b|what (?:date|day|time)\b|how long\b|which\b.{0,40}\bfirst\b|in what (?:month|year)\b|how many (?:days?|weeks?|months?|years?)\b)/i;

// Global per-question context budgets in characters. A small corpus affords
// fuller sessions: counting, ordering, and relative-date answers routinely die
// in fixed keyholes even when every relevant session is retrieved.
const ADAPTIVE_CONTEXT_BUDGET_CHARS = 84_000;
const ADAPTIVE_CONTEXT_BUDGET_CHARS_COVERAGE = 168_000;
const ADAPTIVE_PER_HIT_CAP = 4_800;

/**
 * Per-hit conversation excerpt budget scaled by how many hits will share the
 * context. Never shrinks below the fixed base budget; coverage-hungry queries
 * (aggregation/counting and temporal reasoning) get the larger global budget.
 */
export function adaptiveConversationExcerptBudget(query: string | undefined, hitCount: number) {
  const base = conversationMemoryExcerptBudget(query);
  const global = isAggregationRecallQuery(query) || TEMPORAL_RECALL_QUERY.test(query ?? "")
    ? ADAPTIVE_CONTEXT_BUDGET_CHARS_COVERAGE
    : ADAPTIVE_CONTEXT_BUDGET_CHARS;
  const share = Math.floor(global / Math.max(1, hitCount));
  return Math.max(base, Math.min(ADAPTIVE_PER_HIT_CAP, share));
}

export function conversationMemoryExcerptBudget(query?: string) {
  // Conversation transcripts routinely run multiple kilobytes per session, so a
  // sub-600-character keyhole misses the answering turn even when the right
  // session ranks first. Give conversation-note hits a budget that covers
  // several distinct passages; aggregation/summary queries get the most room.
  return BROAD_CONVERSATION_QUERY.test(query ?? "") || USER_FACT_AGGREGATION_QUERY.test(query ?? "") ? 1800 : 1200;
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
  const passageCandidates = turnAware
    ? rankedConversationPassages(groundedTranscript, query ?? "", terms, expandedTerms).filter((passage) => passage.relevanceScore > 0)
    : [];
  // Standing user guidance is merged query-independently: it governs any later
  // request in this conversation's scope. Assistant-grounded lookups keep their
  // focused single-passage semantics.
  const guidanceSelected = turnAware && !ASSISTANT_GROUNDED_QUERY.test(query ?? "")
    ? standingGuidanceTurns(conversationTurns(groundedTranscript), maxLength >= 1500 ? 2 : 1)
    : [];
  const guidanceSeparator = " … ";
  const renderGuidance = (available: number) => guidanceSelected
    .map(({ turn }) => renderFocusedPassage(turn.text, queryWordsForRecall(turn.scoringText), [], Math.min(300, Math.max(120, available))))
    .join(guidanceSeparator);
  if (passageCandidates.length) {
    const separator = " … ";
    // A single fact ("who performed", "how many wins") can sit in any turn of a
    // long session, and list/aggregation answers are scattered across several.
    // Spend the budget on distinct relevant passages instead of one window, but
    // never shrink a passage below a useful size. Counting/aggregation answers
    // need every scattered instance, so they trade passage width for coverage.
    const aggregationQuery = BROAD_CONVERSATION_QUERY.test(query ?? "")
      || COMPOUND_CONVERSATION_QUERY.test(query ?? "")
      || USER_FACT_AGGREGATION_QUERY.test(query ?? "");
    const minPassageLength = aggregationQuery ? 200 : 240;
    const passageLimit = ASSISTANT_GROUNDED_QUERY.test(query ?? "")
      ? 1
      : Math.max(
        maxLength >= 320 ? 2 : 1,
        Math.min(
          aggregationQuery ? 6 : 3,
          Math.floor((maxLength + separator.length) / (minPassageLength + separator.length)),
        ),
      );
    const selected = distinctConversationPassages(passageCandidates, passageLimit);
    // Guidance turns already covered by a selected relevance passage need no
    // second copy; the rest reserve a bounded slice of the budget.
    const uncoveredGuidance = guidanceSelected.filter(({ index }) =>
      !selected.some((passage) => index >= passage.startTurn && index <= passage.endTurn));
    const guidanceText = uncoveredGuidance.length
      ? uncoveredGuidance
        .map(({ turn }) => renderFocusedPassage(turn.text, queryWordsForRecall(turn.scoringText), [], 300))
        .join(guidanceSeparator)
      : "";
    const passageBudget = guidanceText ? Math.max(320, maxLength - guidanceText.length - separator.length) : maxLength;
    const passageLength = selected.length === 1
      ? passageBudget
      : Math.floor((passageBudget - separator.length * (selected.length - 1)) / selected.length);
    const relevanceText = selected
      .sort((left, right) => left.startTurn - right.startTurn)
      .map((passage) => renderConversationPassage(passage, terms, expandedTerms, passageLength))
      .join(separator);
    return (guidanceText ? `${guidanceText}${separator}${relevanceText}` : relevanceText).slice(0, maxLength);
  }
  const fallbackGuidance = guidanceSelected.length ? renderGuidance(300) : "";
  const withGuidance = (body: string) => (fallbackGuidance
    ? `${fallbackGuidance}${guidanceSeparator}${body}`.slice(0, maxLength)
    : body);
  const fallbackBudget = fallbackGuidance ? Math.max(320, maxLength - fallbackGuidance.length - guidanceSeparator.length) : maxLength;
  const offsets = matchingOffsets(lower, passageTerms);
  if (!offsets.length) return withGuidance(compactContent(compacted, fallbackBudget));

  const clusterDistance = Math.max(180, Math.floor(maxLength * 0.55));
  const clusters: number[][] = [];
  for (const offset of offsets) {
    const latest = clusters.at(-1);
    if (!latest || offset - latest.at(-1)! > clusterDistance) clusters.push([offset]);
    else latest.push(offset);
  }
  const useMultiplePassages = BROAD_CONVERSATION_QUERY.test(query ?? "")
    || COMPOUND_CONVERSATION_QUERY.test(query ?? "")
    || USER_FACT_AGGREGATION_QUERY.test(query ?? "");
  const windowCount = useMultiplePassages ? Math.min(3, clusters.length) : Math.min(2, clusters.length);
  const separator = " … ";
  const windowLength = windowCount === 1
    ? fallbackBudget
    : Math.floor((fallbackBudget - separator.length) / windowCount);
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
  return withGuidance(selected.map((window) => renderExcerptWindow(compacted, window.start, windowLength)).join(separator)).slice(0, maxLength);
}
