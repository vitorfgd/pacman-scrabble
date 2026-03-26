export type QuestHudState = {
  targetLength: number
  /** Optional extra line (e.g. a tip). */
  subtitle?: string
}

export class Hud {
  private readonly questMultEl: HTMLElement
  private readonly wodEl: HTMLElement
  private readonly powerModeEl: HTMLElement
  private readonly questPanelEl: HTMLElement
  private readonly resetButtonEl: HTMLButtonElement
  private readonly pauseButtonEl: HTMLButtonElement
  private readonly hardResetButtonEl: HTMLButtonElement
  private readonly scoreEl: HTMLElement
  private readonly speedEl: HTMLElement

  constructor() {
    const questMultEl = document.getElementById('questMult')
    const wodEl = document.getElementById('wod')
    const powerModeEl = document.getElementById('powerMode')
    const questPanelEl = document.getElementById('questPanel')
    const resetButtonEl = document.getElementById('resetTray') as HTMLButtonElement | null
    const pauseButtonEl = document.getElementById('pauseGame') as HTMLButtonElement | null
    const hardResetButtonEl = document.getElementById('hardResetGame') as HTMLButtonElement | null
    const scoreEl = document.getElementById('score')
    const speedEl = document.getElementById('speed')

    if (!questMultEl) throw new Error('Missing #questMult element')
    if (!wodEl) throw new Error('Missing #wod element')
    if (!powerModeEl) throw new Error('Missing #powerMode element')
    if (!questPanelEl) throw new Error('Missing #questPanel element')
    if (!resetButtonEl) throw new Error('Missing #resetTray button element')
    if (!pauseButtonEl) throw new Error('Missing #pauseGame button element')
    if (!hardResetButtonEl) throw new Error('Missing #hardResetGame button element')
    if (!scoreEl) throw new Error('Missing #score element')
    if (!speedEl) throw new Error('Missing #speed element')

    this.questMultEl = questMultEl
    this.wodEl = wodEl
    this.powerModeEl = powerModeEl
    this.questPanelEl = questPanelEl
    this.resetButtonEl = resetButtonEl
    this.pauseButtonEl = pauseButtonEl
    this.hardResetButtonEl = hardResetButtonEl
    this.scoreEl = scoreEl
    this.speedEl = speedEl
  }

  setScore(score: number): void {
    this.scoreEl.textContent = score.toLocaleString()
  }

  setSpeed(speed: number): void {
    this.speedEl.textContent = `SPEED ${Math.round(speed).toLocaleString()}`
  }

  setQuestMultiplier(mult: number): void {
    this.questMultEl.textContent = `${mult.toFixed(2)}×`
  }

  setWordOfDay(word: string): void {
    this.wodEl.textContent = word.toUpperCase()
  }

  setQuestPanel(state: QuestHudState): void {
    this.questPanelEl.innerHTML = ''

    const main = document.createElement('div')
    main.className = 'quest-line quest-line-main'
    main.textContent = `Spell a word with at least ${state.targetLength} letters`
    this.questPanelEl.appendChild(main)

    const subText = state.subtitle?.trim()
    if (subText) {
      const sub = document.createElement('div')
      sub.className = 'quest-line quest-line-sub'
      sub.textContent = subText
      this.questPanelEl.appendChild(sub)
    }
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
    this.resetButtonEl.addEventListener('click', () => handler())
  }

  setOnPauseToggle(handler: () => void): void {
    this.pauseButtonEl.addEventListener('click', () => handler())
  }

  setPauseButtonState(paused: boolean): void {
    this.pauseButtonEl.textContent = paused ? 'Resume (P)' : 'Pause (P)'
  }

  setOnHardReset(handler: () => void): void {
    this.hardResetButtonEl.addEventListener('click', () => handler())
  }
}
