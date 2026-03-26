import { words as popularWords } from 'popular-english-words'

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

function normalizeWord(w: string): string | null {
  const lw = w.toLowerCase()
  if (!/^[a-z]+$/.test(lw)) return null
  return lw
}

// Compute letter frequency from the bundled word list once.
const LETTER_COUNTS: Record<string, number> = {}
let totalLetters = 0

for (const wRaw of popularWords.getAll() as string[]) {
  const w = normalizeWord(wRaw)
  if (!w) continue
  for (const ch of w) {
    LETTER_COUNTS[ch] = (LETTER_COUNTS[ch] ?? 0) + 1
    totalLetters++
  }
}

const MAX_COUNT = Math.max(1, ...Object.values(LETTER_COUNTS))

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function isVowelLetter(ch: string): boolean {
  return VOWELS.has((ch ?? '').toLowerCase())
}

/**
 * Rarity-based per-letter score:
 * - Vowels and consonants have different bases.
 * - Letters that are less common in the word list get a higher multiplier.
 *
 * Target scale: averages work well with ~50-200 total points per quest word
 * (before quest multipliers and Word-of-the-Day bonus).
 */
export function getLetterScore(ch: string): number {
  const c = (ch ?? '').toLowerCase()
  if (!/^[a-z]$/.test(c)) return 0

  const count = LETTER_COUNTS[c] ?? 1
  // Rare letters -> bigger factor. Clamp so it stays fun.
  const rarityFactor = clamp(MAX_COUNT / count, 1, 6)

  // Consonants slightly higher base than vowels.
  const base = isVowelLetter(c) ? 26 : 30
  return Math.round(base * rarityFactor)
}

export function getTotalLetterScore(word: string): number {
  let sum = 0
  for (const ch of word.toLowerCase()) sum += getLetterScore(ch)
  return sum
}

