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

const FAIL_PARTICLE_COLORS = ['#ff3b3b', '#ff6b6b', '#ff2e2e', '#ff4d4d']
const ENEMY_HIT_COLORS: Record<'stealer' | 'giver' | 'shuffler', string[]> = {
  stealer: ['#ff6b6b', '#ff8b8b', '#ff4d6d', '#ffc2c2'],
  giver: ['#39d98a', '#5af7a8', '#65e572', '#bcffd8'],
  shuffler: ['#ad7bff', '#c79dff', '#7a82ff', '#e1d2ff'],
}

export type WordCelebrationDetails = {
  letters: string[]
  pointsPerLetter: number
  perLetterPoints?: number[]
  totalPoints: number
  questComplete?: boolean
  wordOfDayComplete?: boolean
  nextWordOfDayInLabel?: string
}

function getCelebrationTiming(details?: WordCelebrationDetails): { clearMs: number } {
  const questMode = details?.questComplete === true
  const wodMode = details?.wordOfDayComplete === true
  const clearMs = wodMode ? 3600 : questMode ? 2800 : 2200
  return { clearMs }
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
  const { clearMs } = getCelebrationTiming(details)

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
    ? (details?.nextWordOfDayInLabel
      ? `NEXT WORD OF THE DAY IN ${details.nextWordOfDayInLabel}`
      : 'WORD OF THE DAY!')
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

export function playEnemyHitEffect(
  container: HTMLElement | null,
  role: 'stealer' | 'giver' | 'shuffler',
): void {
  if (!container) return
  container.innerHTML = ''

  let title = 'HIT!'
  let subtitle = ''
  if (role === 'stealer') subtitle = 'Stealer ghost removed 1 letter.'
  if (role === 'giver') subtitle = 'Giver ghost added 1 random letter.'
  if (role === 'shuffler') subtitle = 'Shuffler ghost mixed your tray.'
  if (role === 'stealer') title = 'LETTER STOLEN'
  if (role === 'giver') title = 'LETTER GIFT'
  if (role === 'shuffler') title = 'TRAY SHUFFLED'

  const colors = ENEMY_HIT_COLORS[role]
  const count = 52
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'confetti-piece confetti-piece-late'
    p.style.left = `${Math.random() * 100}%`
    p.style.top = `${-4 + Math.random() * 18}%`
    p.style.width = `${4 + Math.random() * 9}px`
    p.style.height = `${4 + Math.random() * 12}px`
    p.style.setProperty('--drift', `${-90 + Math.random() * 180}px`)
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff'
    p.style.animationDelay = `${Math.random() * 0.12}s`
    p.style.animationDuration = `${0.75 + Math.random() * 0.45}s`
    p.style.borderRadius = Math.random() > 0.45 ? '2px' : '50%'
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
  }, 1200)
}

let errorAudioCtx: AudioContext | null = null

function playErrorTone(): void {
  try {
    errorAudioCtx ??= new AudioContext()
    const ctx = errorAudioCtx
    if (ctx.state === 'suspended') void ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.16)

    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.19)
  } catch {
    // Audio is best-effort.
  }
}

export function playSubmissionFail(
  container: HTMLElement | null,
  title = 'INCORRECT',
  subtitle = 'Word not recognized.',
): void {
  if (!container) return
  container.innerHTML = ''

  // Error sound.
  playErrorTone()

  // Red fail particles (short, punchy burst).
  const count = 105
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'confetti-piece confetti-piece-late'

    const w = 4 + Math.random() * 10
    const h = 5 + Math.random() * 14
    const left = Math.random() * 100
    const delay = Math.random() * 0.08
    const dur = 0.7 + Math.random() * 0.35
    const drift = -90 + Math.random() * 180

    p.style.left = `${left}%`
    p.style.top = `${-2 + Math.random() * 16}%`
    p.style.width = `${w}px`
    p.style.height = `${h}px`
    p.style.setProperty('--drift', `${drift}px`)
    p.style.backgroundColor = FAIL_PARTICLE_COLORS[Math.floor(Math.random() * FAIL_PARTICLE_COLORS.length)]
    p.style.animationDelay = `${delay}s`
    p.style.animationDuration = `${dur}s`
    p.style.borderRadius = Math.random() > 0.45 ? '2px' : '50%'
    container.appendChild(p)
  }

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
  }, 2200)
}
