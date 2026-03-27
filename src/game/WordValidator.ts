import { words as popularWords } from 'popular-english-words'

/**
 * Offline English word validation using the full popular-english-words list.
 * Quest submissions use exact spelling order (not anagram multiset).
 */
export class WordValidator {
  private readonly validWords = new Set<string>()

  constructor() {
    const raw = popularWords.getAll() as string[]
    for (const w of raw) {
      const lw = w.toLowerCase()
      if (!/^[a-z]+$/.test(lw)) continue
      this.validWords.add(lw)
    }
  }

  /** True if `word` is a valid English word with this exact spelling. */
  isValidExactWord(word: string): boolean {
    const lw = word.toLowerCase()
    if (!/^[a-z]+$/.test(lw)) return false
    return this.validWords.has(lw)
  }

}
