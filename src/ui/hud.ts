export class Hud {
  private readonly wodEl: HTMLElement
  private readonly powerModeEl: HTMLElement
  private readonly questLengthLineEl: HTMLElement
  private readonly resetButtonEl: HTMLButtonElement
  private readonly pauseButtonEl: HTMLButtonElement
  private readonly hardResetButtonEl: HTMLButtonElement
  private readonly menuToggleButtonEl: HTMLButtonElement
  private readonly actionsMenuEl: HTMLElement
  private readonly speedBoostButtonEl: HTMLButtonElement
  private readonly speedBoostFillEl: HTMLElement
  private readonly speedBoostStatusEl: HTMLElement
  private readonly scoreEl: HTMLElement
  private readonly wordsFoundEl: HTMLElement

  constructor() {
    const wodEl = document.getElementById('wod')
    const powerModeEl = document.getElementById('powerMode')
    const questLengthLineEl = document.getElementById('questLengthLine')
    const resetButtonEl = document.getElementById('resetTray') as HTMLButtonElement | null
    const pauseButtonEl = document.getElementById('pauseGame') as HTMLButtonElement | null
    const hardResetButtonEl = document.getElementById('hardResetGame') as HTMLButtonElement | null
    const menuToggleButtonEl = document.getElementById('hudMenuToggle') as HTMLButtonElement | null
    const actionsMenuEl = document.getElementById('hudActions')
    const speedBoostButtonEl = document.getElementById('speedBoostButton') as HTMLButtonElement | null
    const speedBoostFillEl = document.getElementById('speedBoostFill')
    const speedBoostStatusEl = document.getElementById('speedBoostStatus')
    const scoreEl = document.getElementById('score')
    const wordsFoundEl = document.getElementById('wordsFound')

    if (!wodEl) throw new Error('Missing #wod element')
    if (!powerModeEl) throw new Error('Missing #powerMode element')
    if (!questLengthLineEl) throw new Error('Missing #questLengthLine element')
    if (!resetButtonEl) throw new Error('Missing #resetTray button element')
    if (!pauseButtonEl) throw new Error('Missing #pauseGame button element')
    if (!hardResetButtonEl) throw new Error('Missing #hardResetGame button element')
    if (!menuToggleButtonEl) throw new Error('Missing #hudMenuToggle button element')
    if (!actionsMenuEl) throw new Error('Missing #hudActions element')
    if (!speedBoostButtonEl) throw new Error('Missing #speedBoostButton element')
    if (!speedBoostFillEl) throw new Error('Missing #speedBoostFill element')
    if (!speedBoostStatusEl) throw new Error('Missing #speedBoostStatus element')
    if (!scoreEl) throw new Error('Missing #score element')
    if (!wordsFoundEl) throw new Error('Missing #wordsFound element')

    this.wodEl = wodEl
    this.powerModeEl = powerModeEl
    this.questLengthLineEl = questLengthLineEl
    this.resetButtonEl = resetButtonEl
    this.pauseButtonEl = pauseButtonEl
    this.hardResetButtonEl = hardResetButtonEl
    this.menuToggleButtonEl = menuToggleButtonEl
    this.actionsMenuEl = actionsMenuEl
    this.speedBoostButtonEl = speedBoostButtonEl
    this.speedBoostFillEl = speedBoostFillEl
    this.speedBoostStatusEl = speedBoostStatusEl
    this.scoreEl = scoreEl
    this.wordsFoundEl = wordsFoundEl

    this.menuToggleButtonEl.addEventListener('click', (ev) => {
      ev.stopPropagation()
      this.actionsMenuEl.classList.toggle('open')
    })
    window.addEventListener('click', () => this.actionsMenuEl.classList.remove('open'))
    this.actionsMenuEl.addEventListener('click', (ev) => ev.stopPropagation())
  }

  setScore(score: number): void {
    this.scoreEl.textContent = score.toLocaleString()
  }

  setWordsFound(count: number): void {
    this.wordsFoundEl.textContent = Math.max(0, Math.floor(count)).toLocaleString()
  }

  setWordOfDay(word: string): void {
    this.wodEl.textContent = word.toUpperCase()
  }

  /** e.g. "4 LETTER WORD" — does not reveal the target spelling. */
  setQuestLengthLine(letterCount: number): void {
    const n = Math.max(1, Math.floor(letterCount))
    this.questLengthLineEl.textContent = `${n} LETTER WORD`
  }

  setPowerMode(active: boolean, remainingMs?: number): void {
    if (!active) {
      this.powerModeEl.textContent = ''
      this.powerModeEl.parentElement?.classList.add('hud-muted')
      return
    }
    const s = remainingMs != null ? Math.ceil(remainingMs / 1000) : undefined
    this.powerModeEl.textContent = s != null ? `POWER MODE: ${s}s` : 'POWER MODE'
    this.powerModeEl.parentElement?.classList.remove('hud-muted')
  }

  setOnResetTray(handler: () => void): void {
    this.resetButtonEl.addEventListener('click', () => {
      this.actionsMenuEl.classList.remove('open')
      handler()
    })
  }

  setOnPauseToggle(handler: () => void): void {
    this.pauseButtonEl.addEventListener('click', () => {
      this.actionsMenuEl.classList.remove('open')
      handler()
    })
  }

  setPauseButtonState(paused: boolean): void {
    this.pauseButtonEl.textContent = paused ? 'Resume' : 'Pause'
  }

  setOnHardReset(handler: () => void): void {
    this.hardResetButtonEl.addEventListener('click', () => {
      this.actionsMenuEl.classList.remove('open')
      handler()
    })
  }

  setOnSpeedBoost(handler: () => void): void {
    this.speedBoostButtonEl.addEventListener('click', () => handler())
  }

  setSpeedBoostState(progress01: number, ready: boolean, active: boolean, remainingMs?: number): void {
    const p = Math.max(0, Math.min(1, progress01))
    this.speedBoostFillEl.style.width = `${(p * 100).toFixed(1)}%`

    this.speedBoostButtonEl.classList.toggle('is-ready', ready)
    this.speedBoostButtonEl.classList.toggle('is-active', active)
    this.speedBoostButtonEl.disabled = !ready || active

    if (active) {
      const s = remainingMs != null ? Math.max(0, Math.ceil(remainingMs / 1000)) : 0
      this.speedBoostStatusEl.textContent = `ACTIVE ${s}s`
    } else if (ready) {
      this.speedBoostStatusEl.textContent = 'READY - TAP'
    } else {
      this.speedBoostStatusEl.textContent = 'Charging...'
    }
  }
}
