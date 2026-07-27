/**
 * SpeechAlignmentController — Better timing than char-count heuristic
 *
 * Converts DialogueExpressionBeats into timed ExpressionIntents,
 * using real word timestamps when available, or clause-based fallback.
 */

import type {
  DialogueExpressionBeat,
  SpokenWordTiming,
  ExpressionIntent,
  IntentSource,
  Envelope,
  ExpressionTone,
} from './types';
import { PRIORITY } from './types';
import { TONE_TO_RECIPE, getRecipeForTone } from './expression-recipes';

// Clause-splitting patterns
const CLAUSE_SEPARATORS = /[,;:.!?—–\-]+|\band\b|\bbut\b|\bso\b|\bthen\b/gi;

/**
 * Split dialogue text into clause windows with estimated timing.
 */
function splitIntoClauses(text: string, totalDurationMs: number): Array<{
  text: string;
  startMs: number;
  endMs: number;
}> {
  // Simple clause splitting by punctuation and conjunctions
  const parts = text.split(CLAUSE_SEPARATORS).filter(p => p.trim().length > 0);
  if (parts.length === 0) return [{ text, startMs: 0, endMs: totalDurationMs }];

  const totalChars = parts.reduce((sum, p) => sum + p.trim().length, 0);
  const clauses: Array<{ text: string; startMs: number; endMs: number }> = [];
  let currentMs = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const fraction = trimmed.length / totalChars;
    const durationMs = fraction * totalDurationMs;
    clauses.push({
      text: trimmed,
      startMs: currentMs,
      endMs: currentMs + durationMs,
    });
    currentMs += durationMs;
  }

  return clauses;
}

/**
 * Find the timing window for an anchor text within word timings.
 */
function findAnchorInWordTimings(
  anchorText: string,
  wordTimings: SpokenWordTiming[],
): { startMs: number; endMs: number } | null {
  const anchor = anchorText.toLowerCase().trim();
  const words = anchor.split(/\s+/);

  // Single word match
  if (words.length === 1) {
    const match = wordTimings.find(w => w.word.toLowerCase().includes(anchor));
    if (match) return { startMs: match.startMs, endMs: match.endMs };
  }

  // Multi-word: find the first word and take the span to the last
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  let startIdx = -1;
  for (let i = 0; i < wordTimings.length; i++) {
    if (wordTimings[i].word.toLowerCase().includes(firstWord)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;

  let endIdx = startIdx;
  for (let i = startIdx; i < wordTimings.length; i++) {
    if (wordTimings[i].word.toLowerCase().includes(lastWord)) {
      endIdx = i;
      break;
    }
  }

  return {
    startMs: wordTimings[startIdx].startMs,
    endMs: wordTimings[endIdx].endMs,
  };
}

/**
 * Find anchor text in clause-based timing (fallback when no word timings).
 */
function findAnchorInClauses(
  anchorText: string,
  clauses: Array<{ text: string; startMs: number; endMs: number }>,
): { startMs: number; endMs: number } | null {
  const anchor = anchorText.toLowerCase();

  for (const clause of clauses) {
    if (clause.text.toLowerCase().includes(anchor)) {
      // Position within clause proportionally
      const idx = clause.text.toLowerCase().indexOf(anchor);
      const fraction = idx / clause.text.length;
      const startMs = clause.startMs + (clause.endMs - clause.startMs) * fraction;
      return {
        startMs,
        endMs: Math.min(clause.endMs, startMs + (clause.endMs - clause.startMs) * 0.5),
      };
    }
  }

  return null;
}

export class SpeechAlignmentController {
  /**
   * Convert dialogue beats into timed expression intents.
   *
   * @param beats - High-level beats from LLM output
   * @param dialogueText - The full dialogue text
   * @param totalDurationMs - Estimated speech duration (from TTS or char estimate)
   * @param speechStartTimeMs - Absolute time when speech starts
   * @param wordTimings - Optional real word timestamps from TTS
   */
  alignBeats(
    beats: DialogueExpressionBeat[],
    dialogueText: string,
    totalDurationMs: number,
    speechStartTimeMs: number,
    wordTimings?: SpokenWordTiming[],
  ): Omit<ExpressionIntent, 'id'>[] {
    if (beats.length === 0) return [];

    const clauses = splitIntoClauses(dialogueText, totalDurationMs);
    const intents: Omit<ExpressionIntent, 'id'>[] = [];

    for (const beat of beats) {
      const recipe = getRecipeForTone(beat.tone);
      const recipeName = TONE_TO_RECIPE[beat.tone] ?? 'neutral';

      // Determine timing
      let anchorMs: { startMs: number; endMs: number } | null = null;

      if (beat.anchorText) {
        if (wordTimings && wordTimings.length > 0) {
          anchorMs = findAnchorInWordTimings(beat.anchorText, wordTimings);
        }
        if (!anchorMs) {
          anchorMs = findAnchorInClauses(beat.anchorText, clauses);
        }
      }

      // Fallback: distribute beats evenly across dialogue
      if (!anchorMs) {
        const beatIdx = beats.indexOf(beat);
        const fraction = beats.length > 1 ? beatIdx / (beats.length - 1) : 0.3;
        const midpoint = totalDurationMs * fraction;
        anchorMs = {
          startMs: Math.max(0, midpoint - 200),
          endMs: Math.min(totalDurationMs, midpoint + 300),
        };
      }

      // Apply phase offset
      let intentStartMs: number;
      const anticipationOffset = 150; // ms before anchor
      const phase = beat.phase ?? 'peak';

      switch (phase) {
        case 'anticipate':
          intentStartMs = Math.max(0, anchorMs.startMs - anticipationOffset * 2);
          break;
        case 'peak':
          intentStartMs = Math.max(0, anchorMs.startMs - anticipationOffset);
          break;
        case 'recover':
          intentStartMs = anchorMs.endMs;
          break;
      }

      // Use recipe default envelope, with beat duration override
      const envelope: Envelope = { ...recipe.defaultEnvelope };
      if (beat.durationMs) {
        // Distribute duration across sustain, keeping attack/release proportional
        const totalEnvelope = envelope.attackMs + envelope.sustainMs + envelope.releaseMs;
        const scale = beat.durationMs / totalEnvelope;
        envelope.attackMs = Math.round(envelope.attackMs * scale);
        envelope.sustainMs = Math.round(envelope.sustainMs * scale);
        envelope.releaseMs = Math.round(envelope.releaseMs * scale);
      }

      intents.push({
        source: 'dialogue' as IntentSource,
        kind: 'reaction',
        preset: recipeName,
        intensity: Math.max(0.1, Math.min(1, beat.intensity)),
        priority: PRIORITY.NORMAL_DIALOGUE,
        startTimeMs: speechStartTimeMs + intentStartMs,
        envelope,
        interruptible: true,
        regionMask: undefined, // use all regions from recipe
        decayToState: recipe.emotionalInfluence,
      });
    }

    return intents;
  }

  /**
   * Generate a simple base emotional intent for the overall dialogue tone.
   * This is a lower-priority intent that sets the emotional backdrop.
   */
  createBaseEmotionalIntent(
    tone: ExpressionTone,
    intensity: number,
    speechStartTimeMs: number,
    totalDurationMs: number,
  ): Omit<ExpressionIntent, 'id'> {
    const recipeName = TONE_TO_RECIPE[tone] ?? 'neutral';
    const recipe = getRecipeForTone(tone);

    return {
      source: 'emotion',
      kind: 'base_override',
      preset: recipeName,
      intensity: intensity * 0.6, // base is softer than specific beats
      priority: PRIORITY.BASE_EMOTION,
      startTimeMs: speechStartTimeMs,
      envelope: {
        attackMs: 300,
        sustainMs: totalDurationMs,
        releaseMs: 500,
        curve: 'easeInOut',
      },
      interruptible: true,
      decayToState: recipe.emotionalInfluence,
    };
  }
}
