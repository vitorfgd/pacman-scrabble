import { words as popularWords } from 'popular-english-words'

const SCRABBLE_LETTER_POINTS: Record<string, number> = {
  a: 1,
  b: 3,
  c: 3,
  d: 2,
  e: 1,
  f: 4,
  g: 2,
  h: 4,
  i: 1,
  j: 8,
  k: 5,
  l: 1,
  m: 3,
  n: 1,
  o: 1,
  p: 3,
  q: 10,
  r: 1,
  s: 1,
  t: 1,
  u: 1,
  v: 4,
  w: 4,
  x: 8,
  y: 4,
  z: 10,
}

export function scrabbleWordScore(word: string): number {
  let sum = 0
  for (const ch of word.toLowerCase()) {
    sum += SCRABBLE_LETTER_POINTS[ch] ?? 0
  }
  return sum
}

type LengthRange = { min: number; max: number }

export class WordSource {
  private readonly topWords: string[]
  private readonly wordsByLength = new Map<number, string[]>()

  private readonly lengthRange: LengthRange = { min: 3, max: 6 }
  private readonly topWordCount: number

  private wodCache = new Map<string, string>()

  constructor(options?: { topWordCount?: number }) {
    this.topWordCount = options?.topWordCount ?? 1000

    // 100% offline: only use the `popular-english-words` dataset in this bundle.
    const raw = popularWords.getMostPopular(this.topWordCount) as string[]
    const filtered = raw
      .map((w) => w.toLowerCase())
      .filter((w) => /^[a-z]+$/.test(w))
      .filter((w) => w.length >= this.lengthRange.min && w.length <= this.lengthRange.max)

    // Keep order but ensure uniqueness to reduce duplicates.
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const w of filtered) {
      if (seen.has(w)) continue
      seen.add(w)
      deduped.push(w)
    }

    this.topWords = deduped

    for (const w of this.topWords) {
      const len = w.length
      const list = this.wordsByLength.get(len) ?? []
      list.push(w)
      this.wordsByLength.set(len, list)
    }
  }

  getRandomWord(lengthMin = 3, lengthMax = 6): string {
    const min = Math.max(this.lengthRange.min, lengthMin)
    const max = Math.min(this.lengthRange.max, lengthMax)
    const length = Math.floor(min + Math.random() * (max - min + 1))

    const list = this.wordsByLength.get(length)
    if (!list || !list.length) throw new Error(`No offline words available for length=${length}`)
    return list[Math.floor(Math.random() * list.length)]
  }

  getWordByLength(length: number): string {
    const pool = this.wordsByLength.get(length)
    if (!pool?.length) return this.getRandomWord(length, length)
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Deterministic, offline Word of the Day.
  getWordOfDay(lengthMin = 3, lengthMax = 6): string {
    const min = Math.max(this.lengthRange.min, lengthMin)
    const max = Math.min(this.lengthRange.max, lengthMax)

    const now = new Date()
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    const cached = this.wodCache.get(dayKey)
    if (cached) return cached

    const candidates = this.topWords.filter((w) => w.length >= min && w.length <= max)
    if (!candidates.length) throw new Error('No candidates for Word of the Day')

    // Prefer higher Scrabble-value words, but keep daily variation by scoring-rank slice.
    const scored = candidates.map((w) => ({ w, score: scrabbleWordScore(w) }))
    scored.sort((a, b) => b.score - a.score || a.w.localeCompare(b.w))

    const topN = Math.min(50, scored.length)
    const slice = scored.slice(0, topN).map((x) => x.w)

    const start = new Date(now.getFullYear(), 0, 0)
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    const idx = dayOfYear % slice.length

    const wod = slice[idx]
    this.wodCache.set(dayKey, wod)
    return wod
  }
}

