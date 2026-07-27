/**
 * Shared IPA phoneme → VRM viseme index mapping.
 * Ported from ami-ai-companion src/lib/animations/viseme-mapping.ts.
 *
 * VRM Viseme Indices:
 *   0 = aa  (open mouth)
 *   1 = ih  (slight open)
 *   2 = ou  (rounded)
 *   3 = ee  (wide)
 *   4 = oh  (open rounded)
 *  -1 = silent / neutral
 */
export const IPA_TO_VISEME_INDEX: Record<string, number> = {
  // Bilabial (lips together) → 0
  'p': 0, 'b': 0, 'm': 0,

  // Labiodental (teeth on lip) → 1
  'f': 1, 'v': 1,

  // Interdental / Rounded → 2
  'θ': 2, 'ð': 2, 'w': 2, 'ʊ': 2, 'u': 2, 'oʊ': 2,

  // Alveolar / Wide → 3
  't': 3, 'd': 3, 's': 3, 'z': 3, 'n': 3, 'l': 3,
  'i': 3, 'ɪ': 3, 'e': 3, 'ɛ': 3, 'eɪ': 3,

  // Postalveolar / Open-rounded → 4
  'ʃ': 4, 'ʒ': 4, 'tʃ': 4, 'dʒ': 4,
  'o': 4, 'ɔ': 4, 'ɔɪ': 4,

  // Velar / Open → 0
  'k': 0, 'g': 0, 'ŋ': 0,
  'a': 0, 'ɑ': 0, 'æ': 0, 'ʌ': 0, 'aɪ': 0, 'aʊ': 0,

  // Approximants
  'r': 1, 'j': 3, 'h': 1,

  // Central vowels
  'ə': 1, 'ɝ': 1, 'ɚ': 1,

  // Diphthongs (mapped to starting position)
  'ɪə': 3, 'eə': 3, 'ʊə': 2,

  // Silent / neutral
  'sil': -1, '<': -1, '>': -1,
};

export const VISEME_COUNT = 5;

export function getVisemeIndex(phoneme: string): number {
  return IPA_TO_VISEME_INDEX[phoneme] ?? 0;
}
