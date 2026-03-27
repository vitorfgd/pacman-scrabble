import { words as popularWords } from 'popular-english-words'
import { anagramSignature } from './WordSource'

/**
 * Offline English word validation using the full popular-english-words list.
 * Quest submissions use exact spelling order (not anagram multiset).
 */
export class WordValidator {
  private readonly validSignatures = new Set<string>()
  private readonly validWords = new Set<string>()

  constructor() {
    const raw = popularWords.getAll() as string[]
    for (const w of raw) {
      const lw = w.toLowerCase()
      if (!/^[a-z]+$/.test(lw)) continue
      this.validWords.add(lw)
      this.validSignatures.add(anagramSignature(lw))
    }
  }

  /** True if `word` is a valid English word with this exact spelling. */
  isValidExactWord(word: string): boolean {
    const lw = word.toLowerCase()
    if (!/^[a-z]+$/.test(lw)) return false
    return this.validWords.has(lw)
  }

  /** True if the letters in `word` (any order) form a valid English word. */
  isValidMultiset(trayLetters: string): boolean {
    const sig = anagramSignature(trayLetters)
    return this.validSignatures.has(sig)
  }
}
