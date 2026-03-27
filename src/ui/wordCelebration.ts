const PRAISE = [
  'AWESOME!',
  'AMAZING!',
  'BRILLIANT!',
  'FANTASTIC!',
  'NICE!',
  'LEGENDARY!',
  'SUPERB!',
  'OUTSTANDING!',
  'WOOHOO!',
  'YES!',
  'CRUSHED IT!',
  'PERFECT!',
  'EPIC!',
  'STELLAR!',
]

const PRAISE_QUEST = [
  'QUEST CRUSHED!',
  'QUEST COMPLETE!',
  'LEGENDARY QUEST!',
  'BOOM! NEXT!',
  'YOU DID IT!',
  'UNSTOPPABLE!',
  'QUEST DOMINATED!',
  'NEXT LEVEL!',
]

const CONFETTI_COLORS = [
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#c084fc',
  '#ff9ff3',
  '#54a0ff',
  '#feca57',
  '#48dbfb',
  '#ff9f43',
]

export type WordCelebrationDetails = {
  letters: string[]
  pointsPerLetter: number
  perLetterPoints?: number[]
  totalPoints: number
  questComplete?: boolean
  wordOfDayComplete?: boolean
}

/**
 * Confetti + praise + per-letter score breakdown. Clears after the animation.
 */
export function playWordCelebration(
  container: HTMLElement | null,
  details?: WordCelebrationDetails,
): void {
  if (!container) return
  container.innerHTML = ''

  const questMode = details?.questComplete === true
  const wodMode = details?.wordOfDayComplete === true
  const count = wodMode ? 180 : questMode ? 110 : 56
  const durScale = wodMode ? 1.65 : questMode ? 1.45 : 1
  const clearMs = wodMode ? 6400 : questMode ? 5200 : 3800

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'confetti-piece'
    const w = 5 + Math.random() * 11
    const h = 6 + Math.random() * 16
    const left = Math.random() * 100
    const delay = Math.random() * 0.35
    const dur = (1.85 + Math.random() * 0.95) * durScale
    const drift = -120 + Math.random() * 240
    p.style.left = `${left}%`
    p.style.top = `${-5 + Math.random() * 25}%`
    p.style.width = `${w}px`
    p.style.height = `${h}px`
    p.style.setProperty('--drift', `${drift}px`)
    p.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    p.style.animationDelay = `${delay}s`
    p.style.animationDuration = `${dur}s`
    p.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'
    container.appendChild(p)
  }

  if (questMode) {
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div')
      p.className = 'confetti-piece confetti-piece-late'
      const w = 4 + Math.random() * 9
      const h = 5 + Math.random() * 14
      p.style.left = `${Math.random() * 100}%`
      p.style.top = `${-8 + Math.random() * 30}%`
      p.style.width = `${w}px`
      p.style.height = `${h}px`
      p.style.setProperty('--drift', `${-100 + Math.random() * 200}px`)
      p.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      p.style.animationDelay = `${0.45 + Math.random() * 0.4}s`
      p.style.animationDuration = `${(1.6 + Math.random() * 0.9) * durScale}s`
      p.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'
      container.appendChild(p)
    }
  }

  const stack = document.createElement('div')
  stack.className = 'word-cele-stack'

  const praise = document.createElement('div')
  praise.className = wodMode ? 'word-praise word-praise-wod' : questMode ? 'word-praise word-praise-quest' : 'word-praise'
  praise.textContent = wodMode
    ? 'WORD OF THE DAY!'
    : questMode
      ? PRAISE_QUEST[Math.floor(Math.random() * PRAISE_QUEST.length)]
      : PRAISE[Math.floor(Math.random() * PRAISE.length)]
  stack.appendChild(praise)

  if (details && details.letters.length > 0) {
    const row = document.createElement('div')
    row.className = 'word-cele-letters'
    for (let i = 0; i < details.letters.length; i++) {
      const ch = details.letters[i] ?? ''
      const cell = document.createElement('div')
      cell.className = 'word-cele-cell'
      const L = document.createElement('span')
      L.className = 'word-cele-char'
      L.textContent = ch.toUpperCase()
      const pts = document.createElement('span')
      pts.className = 'word-cele-pt'
      const v = details.perLetterPoints?.[i]
      pts.textContent = `+${v ?? details.pointsPerLetter}`
      cell.appendChild(L)
      cell.appendChild(pts)
      row.appendChild(cell)
    }
    stack.appendChild(row)

    const total = document.createElement('div')
    total.className = 'word-cele-total'
    const bonuses = [
      wodMode ? ' · WORD OF THE DAY' : '',
      !wodMode && questMode ? ' · Quest' : '',
    ].filter(Boolean)
    total.textContent = `TOTAL +${details.totalPoints}${bonuses.length ? bonuses.join('') : ''}`
    stack.appendChild(total)
  }

  container.appendChild(stack)

  window.setTimeout(() => {
    container.innerHTML = ''
  }, clearMs)
}

export function playResetCelebration(
  container: HTMLElement | null,
  title = 'RESET!',
  subtitle = 'Spell your way back to grow.',
): void {
  if (!container) return
  container.innerHTML = ''

  const count = 95
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'confetti-piece confetti-piece-late'
    const w = 4 + Math.random() * 10
    const h = 5 + Math.random() * 16
    const left = Math.random() * 100
    const delay = Math.random() * 0.3
    const dur = 1.65 + Math.random() * 0.95
    const drift = -140 + Math.random() * 280
    p.style.left = `${left}%`
    p.style.top = `${-7 + Math.random() * 28}%`
    p.style.width = `${w}px`
    p.style.height = `${h}px`
    p.style.setProperty('--drift', `${drift}px`)
    p.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    p.style.animationDelay = `${delay}s`
    p.style.animationDuration = `${dur}s`
    p.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'
    container.appendChild(p)
  }

  const stack = document.createElement('div')
  stack.className = 'word-cele-stack'

  const headline = document.createElement('div')
  headline.className = 'reset-cele-title'
  headline.textContent = title
  stack.appendChild(headline)

  const sub = document.createElement('div')
  sub.className = 'reset-cele-subtitle'
  sub.textContent = subtitle
  stack.appendChild(sub)

  container.appendChild(stack)

  window.setTimeout(() => {
    container.innerHTML = ''
  }, 3200)
}

export type WordSequencePop = { word: string; points: number }

export type WordSequenceOptions = {
  wordOfDayComplete?: boolean
  staggerMs?: number
  totalLabel?: string
}

/**
 * Rapid one-word-at-a-time popups with light confetti at start.
 */
export function playWordSequenceCelebration(
  container: HTMLElement | null,
  pops: WordSequencePop[],
  options?: WordSequenceOptions,
): void {
  if (!container || pops.length === 0) return

  const staggerMs = options?.staggerMs ?? 90
  const wodMode = options?.wordOfDayComplete === true
  const clearMs = Math.min(9000, 1200 + pops.length * staggerMs + 2200)

  container.innerHTML = ''

  const count = wodMode ? 140 : 70
  const durScale = wodMode ? 1.4 : 1
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'confetti-piece'
    const w = 4 + Math.random() * 10
    const h = 5 + Math.random() * 14
    p.style.left = `${Math.random() * 100}%`
    p.style.top = `${-5 + Math.random() * 22}%`
    p.style.width = `${w}px`
    p.style.height = `${h}px`
    p.style.setProperty('--drift', `${-100 + Math.random() * 200}px`)
    p.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    p.style.animationDelay = `${Math.random() * 0.2}s`
    p.style.animationDuration = `${(1.5 + Math.random() * 0.8) * durScale}s`
    p.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%'
    container.appendChild(p)
  }

  const stack = document.createElement('div')
  stack.className = 'word-cele-stack word-cele-stack-sequence'

  const praise = document.createElement('div')
  praise.className = wodMode ? 'word-praise word-praise-wod' : 'word-praise'
  praise.textContent = wodMode ? 'WORD OF THE DAY!' : 'WORDS!'
  stack.appendChild(praise)

  const row = document.createElement('div')
  row.className = 'word-cele-sequence-row'

  pops.forEach((pop, idx) => {
    window.setTimeout(() => {
      const line = document.createElement('div')
      line.className = 'word-cele-pop-line'
      const wEl = document.createElement('span')
      wEl.className = 'word-cele-pop-word'
      wEl.textContent = pop.word.toUpperCase()
      const pEl = document.createElement('span')
      pEl.className = 'word-cele-pop-pts'
      pEl.textContent = ` +${pop.points}`
      line.appendChild(wEl)
      line.appendChild(pEl)
      row.appendChild(line)
      line.animate(
        [{ opacity: 0, transform: 'translateY(12px) scale(0.92)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)', fill: 'forwards' },
      )
    }, idx * staggerMs)
  })

  stack.appendChild(row)

  if (options?.totalLabel) {
    window.setTimeout(() => {
      const total = document.createElement('div')
      total.className = 'word-cele-total word-cele-total-sequence'
      total.textContent = options.totalLabel ?? ''
      stack.appendChild(total)
    }, pops.length * staggerMs + 80)
  }

  container.appendChild(stack)

  window.setTimeout(() => {
    container.innerHTML = ''
  }, clearMs)
}

export function playInfoCelebration(
  container: HTMLElement | null,
  title: string,
  subtitle = '',
  clearMs = 1700,
): void {
  if (!container) return
  container.innerHTML = ''

  const stack = document.createElement('div')
  stack.className = 'word-cele-stack'

  const headline = document.createElement('div')
  headline.className = 'reset-cele-title'
  headline.textContent = title
  stack.appendChild(headline)

  if (subtitle.trim().length > 0) {
    const sub = document.createElement('div')
    sub.className = 'reset-cele-subtitle'
    sub.textContent = subtitle
    stack.appendChild(sub)
  }

  container.appendChild(stack)

  window.setTimeout(() => {
    container.innerHTML = ''
  }, clearMs)
}
