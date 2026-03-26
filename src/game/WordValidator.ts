import { words as popularWords } from 'popular-english-words'
import { anagramSignature } from './WordSource'

/**
 * Offline English word multiset validation using the full popular-english-words list.
 * A tray is valid if its letter multiset matches at least one dictionary word.
 */
export class WordValidator {
  private readonly validSignatures = new Set<string>()

  constructor() {
    const raw = popularWords.getAll() as string[]
    for (const w of raw) {
      const lw = w.toLowerCase()
      if (!/^[a-z]+$/.test(lw)) continue
      this.validSignatures.add(anagramSignature(lw))
    }
  }

  /** True if the letters in `word` (any order) form a valid English word. */
  isValidMultiset(trayLetters: string): boolean {
    const sig = anagramSignature(trayLetters)
    return this.validSignatures.has(sig)
  }
}
