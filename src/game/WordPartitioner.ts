import { words as popularWords } from 'popular-english-words'
import { getTotalLetterScore } from './LetterScoring'

export type PartitionWord = { word: string; points: number }

type Counts = Record<string, number>

/** Smaller than full dictionary: faster load + greedy inner loop stays cheap. */
const PARTITION_WORD_CAP = 14_000

function toCounts(letters: string[]): Counts {
  const c: Counts = {}
  for (const ch of letters) {
    const k = ch.toLowerCase()
    if (!/^[a-z]$/.test(k)) continue
    c[k] = (c[k] ?? 0) + 1
  }
  return c
}

function countsToLetterArray(c: Counts): string[] {
  const out: string[] = []
  for (let ci = 0; ci < 26; ci++) {
    const ch = String.fromCharCode(97 + ci)
    const n = c[ch] ?? 0
    for (let i = 0; i < n; i++) out.push(ch)
  }
  return out
}

type WordEntry = {
  word: string
  points: number
  len: number
  /** Letter counts a-z — fixed size for zero-allocation embed checks */
  counts: Uint8Array
}

function buildCounts26(word: string): Uint8Array {
  const a = new Uint8Array(26)
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i) - 97
    if (c >= 0 && c < 26) a[c]++
  }
  return a
}

function sumBag(bag: number[]): number {
  let s = 0
  for (let i = 0; i < 26; i++) s += bag[i]
  return s
}

function canEmbed(bag: number[], counts: Uint8Array): boolean {
  for (let i = 0; i < 26; i++) {
    if (counts[i] > bag[i]) return false
  }
  return true
}

function subtractEmbed(bag: number[], counts: Uint8Array): void {
  for (let i = 0; i < 26; i++) bag[i] -= counts[i]
}

/**
 * Greedy max-score extraction using a capped popular-word list and
 * precomputed letter vectors (no per-candidate allocations in the hot loop).
 */
export class WordPartitioner {
  private readonly entries: WordEntry[]

  constructor() {
    const raw = popularWords.getMostPopular(PARTITION_WORD_CAP) as string[]
    const list: WordEntry[] = []
    const seen = new Set<string>()
    for (const wRaw of raw) {
      const w = wRaw.toLowerCase()
      if (!/^[a-z]+$/.test(w) || w.length < 3) continue
      if (seen.has(w)) continue
      seen.add(w)
      list.push({
        word: w,
        points: getTotalLetterScore(w),
        len: w.length,
        counts: buildCounts26(w),
      })
    }
    list.sort((a, b) => b.points - a.points || b.len - a.len)
    this.entries = list
  }

  greedyPartition(letters: string[]): {
    words: PartitionWord[]
    totalPoints: number
    remaining: string[]
  } {
    const bag = new Array(26).fill(0)
    for (const ch of letters) {
      const i = ch.toLowerCase().charCodeAt(0) - 97
      if (i >= 0 && i < 26) bag[i]++
    }

    const words: PartitionWord[] = []
    let totalPoints = 0
    let guard = 0
    while (guard++ < 400) {
      let total = sumBag(bag)
      if (total < 3) break

      let found: WordEntry | null = null
      for (const e of this.entries) {
        if (e.len > total) continue
        if (canEmbed(bag, e.counts)) {
          found = e
          break
        }
      }
      if (!found) break

      subtractEmbed(bag, found.counts)
      words.push({ word: found.word, points: found.points })
      totalPoints += found.points
    }

    const rem: Counts = {}
    for (let i = 0; i < 26; i++) {
      const n = bag[i]
      if (n > 0) rem[String.fromCharCode(97 + i)] = n
    }
    return { words, totalPoints, remaining: countsToLetterArray(rem) }
  }
}

/** Remove multiset for `words` from `tray` order-preserving (first matching chars removed). */
export function removeWordsFromTray(tray: string[], words: string[]): string[] {
  const need = toCounts(words.join('').split(''))
  const next: string[] = []
  for (const ch of tray) {
    const k = ch.toLowerCase()
    if (!/^[a-z]$/.test(k)) {
      next.push(ch)
      continue
    }
    if ((need[k] ?? 0) > 0) {
      need[k]--
      continue
    }
    next.push(ch)
  }
  return next
}
