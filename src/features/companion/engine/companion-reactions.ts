/* companion-reactions.ts — map a Queen reply's text onto Sara's face + body.
 *
 * HivemindOS chat turns carry no emotion metadata (unlike ami, whose LLM
 * emits expression/animation tags), so reactions are derived from the reply
 * text with a lightweight keyword heuristic: an expression tone + emotional
 * lean for expressions2, and an optional one-shot gesture clip key from the
 * downloaded manifest. Deliberately conservative — a wrong neutral beats a
 * wrong laugh.
 */

import type { EmotionalState, ExpressionTone } from "./expressions";

export type CompanionReaction = {
  tone: ExpressionTone;
  /** Lean applied via ExpressionSystem.setEmotionalStateTarget. */
  emotion: Partial<EmotionalState>;
  /** Gesture asset key (companion-assets.ts) or null for none. */
  gestureKey: string | null;
};

const NEUTRAL: CompanionReaction = {
  tone: "neutral",
  emotion: { warmth: 0.45, energy: 0.4, confidence: 0.5 },
  gestureKey: null,
};

type Rule = {
  pattern: RegExp;
  reaction: CompanionReaction;
};

// First match wins — order roughly by specificity/strength of the signal.
const RULES: Rule[] = [
  {
    // laughter
    pattern: /\b(haha+|lol|lmao)\b|😂|🤣|\bthat's (hilarious|funny)\b/i,
    reaction: {
      tone: "delighted",
      emotion: { joy: 0.9, playfulness: 0.8, energy: 0.7, warmth: 0.6 },
      gestureKey: "gesture-laugh",
    },
  },
  {
    // greetings / welcomes
    pattern: /^(hey|hi|hello|welcome back|good (morning|afternoon|evening))\b/i,
    reaction: {
      tone: "warm",
      emotion: { warmth: 0.85, joy: 0.6, energy: 0.55 },
      gestureKey: "gesture-wave",
    },
  },
  {
    // celebration / big success
    pattern: /\b(congrats|congratulations|amazing|fantastic|excellent|woo+|🎉|nailed it)\b/i,
    reaction: {
      tone: "delighted",
      emotion: { joy: 0.9, energy: 0.8, confidence: 0.7, warmth: 0.6 },
      gestureKey: "gesture-yay",
    },
  },
  {
    // task success / confirmation
    pattern: /\b(done|complete[d]?|fixed|shipped|deployed|passing|succeeded|all set|✅)\b/i,
    reaction: {
      tone: "impressed",
      emotion: { joy: 0.7, confidence: 0.75, energy: 0.55 },
      gestureKey: "gesture-thumbs-up",
    },
  },
  {
    // pointing the user somewhere
    pattern: /\b(take a look|check out|look at|see the|over (here|there)|open the)\b/i,
    reaction: {
      tone: "curious",
      emotion: { curiosity: 0.8, energy: 0.6, confidence: 0.6 },
      gestureKey: "gesture-pointing",
    },
  },
  {
    // failures / errors / warnings
    pattern: /\b(failed|failing|error|broken|crash(ed)?|down|offline|unable|couldn't|can't reach|⚠️|❌)\b/i,
    reaction: {
      tone: "guarded",
      emotion: { tension: 0.7, irritation: 0.3, energy: 0.55, confidence: 0.4 },
      gestureKey: null,
    },
  },
  {
    // apologies / bad news
    pattern: /\b(sorry|unfortunately|sadly|regret)\b/i,
    reaction: {
      tone: "sad",
      emotion: { sadness: 0.6, warmth: 0.5, energy: 0.3 },
      gestureKey: null,
    },
  },
  {
    // questions back at the user
    pattern: /\?\s*$/,
    reaction: {
      tone: "curious",
      emotion: { curiosity: 0.75, warmth: 0.5, energy: 0.5 },
      gestureKey: null,
    },
  },
  {
    // surprise
    pattern: /\b(whoa|wow|surprising(ly)?|unexpected|interesting)\b/i,
    reaction: {
      tone: "surprised",
      emotion: { curiosity: 0.7, energy: 0.65, joy: 0.4 },
      gestureKey: null,
    },
  },
];

export function deriveCompanionReaction(text: string): CompanionReaction {
  const trimmed = text.trim();
  if (!trimmed) return NEUTRAL;
  // Only scan the reply's head and tail — long agent reports bury the
  // emotional signal, and mid-report keyword hits are mostly false positives.
  const head = trimmed.slice(0, 280);
  const tail = trimmed.length > 280 ? trimmed.slice(-120) : "";
  const scannable = tail ? `${head}\n${tail}` : head;
  for (const rule of RULES) {
    if (rule.pattern.test(scannable)) return rule.reaction;
  }
  return NEUTRAL;
}
