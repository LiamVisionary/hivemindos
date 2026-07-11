/**
 * Text → timed phoneme data for lip sync (fallback when the TTS provider
 * doesn't supply real phoneme timings).
 *
 * Ported from ami-ai-companion src/lib/services/tts/phonemeGenerator.ts with
 * its dependency src/lib/services/multilingual-phonemes.ts inlined so the
 * module is self-contained (the multilingual maps aren't needed elsewhere in
 * this engine).
 *
 * The character→IPA mappings don't need to be phonetically perfect — they
 * just need to produce plausible mouth shapes (5 visemes: aa, ih, ou, ee, oh)
 * so lip sync looks natural for text-only / fallback mode.
 */
import type { PhonemeInfo } from './lip-sync-controller';

// ═══════════════════════════════════════════════════════════════════════════
// Inlined multilingual character → IPA phoneme mappings
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Japanese Hiragana → IPA
// ---------------------------------------------------------------------------
const HIRAGANA_TO_IPA: Record<string, string[]> = {
  // Vowels
  'あ': ['a'], 'い': ['i'], 'う': ['u'], 'え': ['ɛ'], 'お': ['ɔ'],
  // K-row
  'か': ['k', 'a'], 'き': ['k', 'i'], 'く': ['k', 'u'], 'け': ['k', 'ɛ'], 'こ': ['k', 'ɔ'],
  // S-row
  'さ': ['s', 'a'], 'し': ['ʃ', 'i'], 'す': ['s', 'u'], 'せ': ['s', 'ɛ'], 'そ': ['s', 'ɔ'],
  // T-row
  'た': ['t', 'a'], 'ち': ['tʃ', 'i'], 'つ': ['t', 's', 'u'], 'て': ['t', 'ɛ'], 'と': ['t', 'ɔ'],
  // N-row
  'な': ['n', 'a'], 'に': ['n', 'i'], 'ぬ': ['n', 'u'], 'ね': ['n', 'ɛ'], 'の': ['n', 'ɔ'],
  // H-row
  'は': ['h', 'a'], 'ひ': ['h', 'i'], 'ふ': ['f', 'u'], 'へ': ['h', 'ɛ'], 'ほ': ['h', 'ɔ'],
  // M-row
  'ま': ['m', 'a'], 'み': ['m', 'i'], 'む': ['m', 'u'], 'め': ['m', 'ɛ'], 'も': ['m', 'ɔ'],
  // Y-row
  'や': ['j', 'a'], 'ゆ': ['j', 'u'], 'よ': ['j', 'ɔ'],
  // R-row
  'ら': ['r', 'a'], 'り': ['r', 'i'], 'る': ['r', 'u'], 'れ': ['r', 'ɛ'], 'ろ': ['r', 'ɔ'],
  // W-row + N
  'わ': ['w', 'a'], 'を': ['ɔ'], 'ん': ['n'],
  // Dakuten
  'が': ['g', 'a'], 'ぎ': ['g', 'i'], 'ぐ': ['g', 'u'], 'げ': ['g', 'ɛ'], 'ご': ['g', 'ɔ'],
  'ざ': ['z', 'a'], 'じ': ['dʒ', 'i'], 'ず': ['z', 'u'], 'ぜ': ['z', 'ɛ'], 'ぞ': ['z', 'ɔ'],
  'だ': ['d', 'a'], 'ぢ': ['dʒ', 'i'], 'づ': ['z', 'u'], 'で': ['d', 'ɛ'], 'ど': ['d', 'ɔ'],
  'ば': ['b', 'a'], 'び': ['b', 'i'], 'ぶ': ['b', 'u'], 'べ': ['b', 'ɛ'], 'ぼ': ['b', 'ɔ'],
  // Handakuten
  'ぱ': ['p', 'a'], 'ぴ': ['p', 'i'], 'ぷ': ['p', 'u'], 'ぺ': ['p', 'ɛ'], 'ぽ': ['p', 'ɔ'],
  // Small kana (used in combinations)
  'ゃ': ['j', 'a'], 'ゅ': ['j', 'u'], 'ょ': ['j', 'ɔ'],
  'っ': ['sil'],
};

// ---------------------------------------------------------------------------
// Japanese Katakana → IPA  (mirrors hiragana via codepoint offset)
// ---------------------------------------------------------------------------
const KATAKANA_TO_IPA: Record<string, string[]> = {};
for (const [hiragana, ipa] of Object.entries(HIRAGANA_TO_IPA)) {
  const code = hiragana.codePointAt(0)!;
  // Katakana block is 0x60 higher than hiragana (0x3041→0x30A1)
  if (code >= 0x3041 && code <= 0x3096) {
    KATAKANA_TO_IPA[String.fromCodePoint(code + 0x60)] = ipa;
  }
}
// Extra katakana-only characters
KATAKANA_TO_IPA['ー'] = ['sil']; // long vowel mark
KATAKANA_TO_IPA['ヴ'] = ['v', 'u']; // vu

// ---------------------------------------------------------------------------
// Korean Hangul → IPA via jamo decomposition
// ---------------------------------------------------------------------------
const HANGUL_INITIAL: string[][] = [
  ['g'],  ['k'],  ['n'],  ['d'],  ['t'],  // ㄱㄲㄴㄷㄸ
  ['r'],  ['m'],  ['b'],  ['p'],  ['s'],  // ㄹㅁㅂㅃㅅ
  ['s'],  ['sil'],['dʒ'],['tʃ'],['tʃ'], // ㅆㅇㅈㅉㅊ
  ['k'],  ['t'],  ['p'],  ['h'],          // ㅋㅌㅍㅎ
];
const HANGUL_MEDIAL: string[][] = [
  ['a'],    ['ɛ'],    ['j','a'],  ['j','ɛ'], ['ɔ'],     // ㅏㅐㅑㅒㅓ
  ['ɛ'],    ['j','ɔ'],['j','ɛ'], ['ɔ'],     ['w','a'],  // ㅔㅕㅖㅗㅘ
  ['w','ɛ'],['w','ɛ'],['u'],     ['w','ɔ'], ['w','ɛ'],  // ㅙㅚㅛㅜㅝ
  ['w','i'],['w','i'],['u'],     ['ɪ'],     ['i'],      // ㅞㅟㅠㅡㅢ
  ['i'],                                                  // ㅣ
];

function decomposeHangul(char: string): string[] {
  const code = char.codePointAt(0)!;
  if (code < 0xAC00 || code > 0xD7A3) return [];
  const index = code - 0xAC00;
  const initialIdx = Math.floor(index / (21 * 28));
  const medialIdx = Math.floor((index % (21 * 28)) / 28);
  const phonemes: string[] = [];
  if (HANGUL_INITIAL[initialIdx]) phonemes.push(...HANGUL_INITIAL[initialIdx]);
  if (HANGUL_MEDIAL[medialIdx]) phonemes.push(...HANGUL_MEDIAL[medialIdx]);
  return phonemes;
}

// ---------------------------------------------------------------------------
// Cyrillic → IPA
// ---------------------------------------------------------------------------
const CYRILLIC_TO_IPA: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'е': 'ɛ', 'ё': 'j', 'ж': 'ʒ', 'з': 'z', 'и': 'i',
  'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'ɔ', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
  'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 't', 'ч': 'tʃ',
  'ш': 'ʃ', 'щ': 'ʃ', 'ъ': 'sil', 'ы': 'ɪ', 'ь': 'sil',
  'э': 'ɛ', 'ю': 'u', 'я': 'a',
};

// ---------------------------------------------------------------------------
// Arabic → approximate IPA
// ---------------------------------------------------------------------------
const ARABIC_TO_IPA: Record<string, string> = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'θ', 'ج': 'dʒ',
  'ح': 'h', 'خ': 'h', 'د': 'd', 'ذ': 'ð', 'ر': 'r',
  'ز': 'z', 'س': 's', 'ش': 'ʃ', 'ص': 's', 'ض': 'd',
  'ط': 't', 'ظ': 'ð', 'ع': 'a', 'غ': 'g', 'ف': 'f',
  'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'j', 'ء': 'sil',
  'آ': 'a', 'أ': 'a', 'إ': 'i', 'ؤ': 'u', 'ئ': 'i',
  'ة': 'a',
};

// ---------------------------------------------------------------------------
// Thai → approximate IPA (consonant classes)
// ---------------------------------------------------------------------------
const THAI_TO_IPA: Record<string, string> = {
  'ก': 'k', 'ข': 'k', 'ฃ': 'k', 'ค': 'k', 'ฅ': 'k', 'ฆ': 'k',
  'ง': 'ŋ', 'จ': 'tʃ', 'ฉ': 'tʃ', 'ช': 'tʃ', 'ซ': 's', 'ฌ': 'tʃ',
  'ญ': 'j', 'ฎ': 'd', 'ฏ': 't', 'ฐ': 't', 'ฑ': 't', 'ฒ': 't',
  'ณ': 'n', 'ด': 'd', 'ต': 't', 'ถ': 't', 'ท': 't', 'ธ': 't',
  'น': 'n', 'บ': 'b', 'ป': 'p', 'ผ': 'p', 'ฝ': 'f', 'พ': 'p',
  'ฟ': 'f', 'ภ': 'p', 'ม': 'm', 'ย': 'j', 'ร': 'r', 'ล': 'l',
  'ว': 'w', 'ศ': 's', 'ษ': 's', 'ส': 's', 'ห': 'h', 'ฬ': 'l',
  'อ': 'ɔ', 'ฮ': 'h',
  // Vowel marks
  'ะ': 'a', 'า': 'a', 'ิ': 'i', 'ี': 'i', 'ึ': 'ɪ', 'ื': 'ɪ',
  'ุ': 'u', 'ู': 'u', 'เ': 'ɛ', 'แ': 'ɛ', 'โ': 'ɔ', 'ใ': 'a',
  'ไ': 'a',
};

// ---------------------------------------------------------------------------
// Devanagari → approximate IPA
// ---------------------------------------------------------------------------
const DEVANAGARI_TO_IPA: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u',
  'ए': 'ɛ', 'ऐ': 'ɛ', 'ओ': 'ɔ', 'औ': 'ɔ',
  'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'ङ': 'ŋ',
  'च': 'tʃ', 'छ': 'tʃ', 'ज': 'dʒ', 'झ': 'dʒ', 'ञ': 'n',
  'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd', 'ण': 'n',
  'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n',
  'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'b', 'म': 'm',
  'य': 'j', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'ʃ',
  'ष': 'ʃ', 'स': 's', 'ह': 'h',
  // Vowel marks (matras)
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'े': 'ɛ', 'ै': 'ɛ', 'ो': 'ɔ', 'ौ': 'ɔ',
  'ं': 'n', 'ः': 'h', '्': 'sil',
};

// ---------------------------------------------------------------------------
// CJK fallback vowel cycle (produces natural-looking mouth movement)
// ---------------------------------------------------------------------------
const CJK_VOWEL_CYCLE = ['a', 'ɔ', 'i', 'ɛ', 'u'];
let cjkCycleIndex = 0;

function cjkFallbackPhonemes(): string[] {
  const vowel = CJK_VOWEL_CYCLE[cjkCycleIndex % CJK_VOWEL_CYCLE.length];
  cjkCycleIndex++;
  // Pair a consonant with the vowel for more realistic mouth shape
  const consonants = ['m', 'n', 't', 's', 'k'];
  const cons = consonants[cjkCycleIndex % consonants.length];
  return [cons, vowel];
}

// ---------------------------------------------------------------------------
// Accented Latin normalization  (é→e, ü→u, ñ→n, etc.)
// ---------------------------------------------------------------------------
function normalizeAccentedChar(char: string): string {
  return char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Unicode range helpers
// ---------------------------------------------------------------------------
function isHiragana(code: number): boolean {
  return code >= 0x3041 && code <= 0x3096;
}
function isKatakana(code: number): boolean {
  return (code >= 0x30A1 && code <= 0x30FA) || code === 0x30FC || code === 0x30F4;
}
function isHangulSyllable(code: number): boolean {
  return code >= 0xAC00 && code <= 0xD7A3;
}
function isCyrillic(code: number): boolean {
  return code >= 0x0400 && code <= 0x04FF;
}
function isArabic(code: number): boolean {
  return code >= 0x0600 && code <= 0x06FF;
}
function isThai(code: number): boolean {
  return code >= 0x0E01 && code <= 0x0E5B;
}
function isDevanagari(code: number): boolean {
  return code >= 0x0900 && code <= 0x097F;
}
function isCJKIdeograph(code: number): boolean {
  return (code >= 0x4E00 && code <= 0x9FFF)   // CJK Unified
      || (code >= 0x3400 && code <= 0x4DBF)   // CJK Extension A
      || (code >= 0xF900 && code <= 0xFAFF);  // CJK Compatibility
}

/**
 * Convert a single character to IPA phoneme(s).
 * Returns empty array if the character should be skipped (whitespace, punctuation).
 */
export function charToPhonemes(char: string, letterToPhoneme: Record<string, string>): string[] {
  // Check Japanese kana first (most common non-Latin case)
  if (HIRAGANA_TO_IPA[char]) return HIRAGANA_TO_IPA[char];
  if (KATAKANA_TO_IPA[char]) return KATAKANA_TO_IPA[char];

  const code = char.codePointAt(0)!;

  // Hangul syllable decomposition
  if (isHangulSyllable(code)) return decomposeHangul(char);

  // Cyrillic
  if (isCyrillic(code)) {
    const lower = char.toLowerCase();
    const ipa = CYRILLIC_TO_IPA[lower];
    return ipa ? [ipa] : [];
  }

  // Arabic
  if (isArabic(code)) {
    const ipa = ARABIC_TO_IPA[char];
    return ipa ? [ipa] : [];
  }

  // Thai
  if (isThai(code)) {
    const ipa = THAI_TO_IPA[char];
    return ipa ? [ipa] : [];
  }

  // Devanagari
  if (isDevanagari(code)) {
    const ipa = DEVANAGARI_TO_IPA[char];
    return ipa ? [ipa] : [];
  }

  // CJK ideographs → cycling vowel+consonant pairs
  if (isCJKIdeograph(code)) return cjkFallbackPhonemes();

  // Accented Latin → normalize and use English mapping
  const normalized = normalizeAccentedChar(char);
  if (normalized.length === 1 && letterToPhoneme[normalized]) {
    return [letterToPhoneme[normalized]];
  }

  return [];
}

/**
 * Reset CJK cycle index (call at start of each new phoneme generation).
 */
export function resetCJKCycle(): void {
  cjkCycleIndex = 0;
}

/**
 * Estimate character count for non-space-delimited languages.
 * CJK ideographs, Hangul syllables, and Thai consonants each count
 * as roughly one "syllable" for duration estimation.
 */
export function countSpeechUnits(text: string): number {
  let units = 0;
  const spaceWords = text.split(/\s+/).filter(w => w.length > 0);

  for (const word of spaceWords) {
    let hasNonLatinChars = false;
    for (const char of word) {
      const code = char.codePointAt(0)!;
      if (isCJKIdeograph(code) || isHangulSyllable(code) || isHiragana(code)
          || isKatakana(code) || isThai(code)) {
        units++;
        hasNonLatinChars = true;
      }
    }
    if (!hasNonLatinChars) {
      units++; // count as one word
    }
  }
  return Math.max(1, units);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phoneme generation (port of phonemeGenerator.ts)
// ═══════════════════════════════════════════════════════════════════════════

const PHONEME_RULES: Record<string, string[]> = {
  'the': ['ð', 'ə'], 'and': ['æ', 'n', 'd'],
  'you': ['j', 'u'], 'are': ['ɑ', 'r'],
  'that': ['ð', 'æ', 't'], 'this': ['ð', 'ɪ', 's'],
  'with': ['w', 'ɪ', 'θ'], 'have': ['h', 'æ', 'v'],
  'will': ['w', 'ɪ', 'l'], 'your': ['j', 'ʊ', 'r'],
  'from': ['f', 'r', 'ʌ', 'm'], 'they': ['ð', 'eɪ'],
  'know': ['n', 'oʊ'], 'want': ['w', 'ɑ', 'n', 't'],
};

const LETTER_TO_PHONEME: Record<string, string> = {
  'a': 'æ', 'b': 'b', 'c': 'k', 'd': 'd', 'e': 'ɛ',
  'f': 'f', 'g': 'g', 'h': 'h', 'i': 'ɪ', 'j': 'dʒ',
  'k': 'k', 'l': 'l', 'm': 'm', 'n': 'n', 'o': 'ɔ',
  'p': 'p', 'q': 'k', 'r': 'r', 's': 's', 't': 't',
  'u': 'ʌ', 'v': 'v', 'w': 'w', 'x': 'k', 'y': 'j', 'z': 'z',
};

const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ɑ', 'ɛ', 'ɪ', 'ɔ', 'ʊ', 'æ', 'ə', 'ʌ'];
const PLOSIVES = ['p', 'b', 't', 'd', 'k', 'g'];

function textToPhonemes(text: string): string[] {
  const allPhonemes: string[] = [];
  const segments = text.split(/([.!?,;:])/);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    if (/^[.!?,;:]$/.test(trimmed)) {
      const silenceCount = (trimmed === '.' || trimmed === '!' || trimmed === '?') ? 2 : 1;
      for (let i = 0; i < silenceCount; i++) {
        allPhonemes.push('sil');
      }
      continue;
    }

    const words = trimmed.split(/\s+/);

    for (const word of words) {
      if (!word) continue;

      const lower = word.toLowerCase();
      const asciiKey = lower.replace(/[^a-z]/g, '');
      if (asciiKey && PHONEME_RULES[asciiKey]) {
        allPhonemes.push(...PHONEME_RULES[asciiKey]);
      } else {
        for (const char of lower) {
          const phonemes = charToPhonemes(char, LETTER_TO_PHONEME);
          if (phonemes.length > 0) {
            allPhonemes.push(...phonemes);
          }
        }
      }
    }
  }

  return allPhonemes;
}

function filterPhonemes(phonemes: string[]): string[] {
  const filtered: string[] = [];
  let lastPhoneme = '';
  let consecutiveSilenceCount = 0;

  for (const phoneme of phonemes) {
    if (phoneme === lastPhoneme && phoneme !== 'sil') continue;

    if (phoneme === 'sil') {
      consecutiveSilenceCount++;
      if (consecutiveSilenceCount <= 2) filtered.push(phoneme);
    } else {
      consecutiveSilenceCount = 0;
      filtered.push(phoneme);
    }

    lastPhoneme = phoneme;
  }

  return filtered;
}

function calculatePhonemeDuration(phoneme: string, baseDuration: number): number {
  if (VOWELS.includes(phoneme)) return baseDuration * 1.2;
  if (PLOSIVES.includes(phoneme)) return baseDuration * 0.6;
  return baseDuration * 0.9;
}

export function generatePhonemeData(text: string, durationSeconds: number): PhonemeInfo[] {
  resetCJKCycle();
  const allPhonemes = textToPhonemes(text);
  const filteredPhonemes = filterPhonemes(allPhonemes);
  const phonemeData: PhonemeInfo[] = [];

  if (filteredPhonemes.length === 0) return phonemeData;

  const nonSilentPhonemes = filteredPhonemes.filter((p) => p !== 'sil');
  const totalPhonemeTime = durationSeconds * 0.95;
  const avgPhonemeTime = totalPhonemeTime / Math.max(nonSilentPhonemes.length, durationSeconds * 10);

  let currentTime = 0.02;

  for (const phoneme of filteredPhonemes) {
    if (phoneme === 'sil') {
      phonemeData.push({ phoneme: 'sil', startOffsetS: currentTime });
      currentTime += avgPhonemeTime * 2.0;
      continue;
    }

    const phonemeDuration = calculatePhonemeDuration(phoneme, avgPhonemeTime);
    phonemeData.push({ phoneme, startOffsetS: currentTime });
    currentTime += phonemeDuration;
  }

  if (currentTime > 0) {
    const scaleFactor = durationSeconds / currentTime;
    for (const p of phonemeData) {
      p.startOffsetS = (p.startOffsetS || 0) * scaleFactor;
    }
  }

  return phonemeData;
}

export function estimateDurationFromText(text: string, wordsPerMinute = 150): number {
  const units = countSpeechUnits(text);
  return Math.max(0.4, (units / wordsPerMinute) * 60);
}
