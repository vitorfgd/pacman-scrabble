export type QuestHudState = {
  targetLength: number
  /** Optional extra line (e.g. a tip). */
  subtitle?: string
}

export class Hud {
  private readonly questMultEl: HTMLElement
  private readonly powerModeEl: HTMLElement
  private readonly questPanelEl: HTMLElement
  private readonly resetButtonEl: HTMLButtonElement
  private readonly scoreEl: HTMLElement

  constructor() {
    const questMultEl = document.getElementById('questMult')
    const powerModeEl = document.getElementById('powerMode')
    const questPanelEl = document.getElementById('questPanel')
    const resetButtonEl = document.getElementById('resetTray') as HTMLButtonElement | null
    const scoreEl = document.getElementById('score')

    if (!questMultEl) throw new Error('Missing #questMult element')
    if (!powerModeEl) throw new Error('Missing #powerMode element')
    if (!questPanelEl) throw new Error('Missing #questPanel element')
    if (!resetButtonEl) throw new Error('Missing #resetTray button element')
    if (!scoreEl) throw new Error('Missing #score element')

    this.questMultEl = questMultEl
    this.powerModeEl = powerModeEl
    this.questPanelEl = questPanelEl
    this.resetButtonEl = resetButtonEl
    this.scoreEl = scoreEl
  }

  setScore(score: number): void {
    this.scoreEl.textContent = score.toLocaleString()
  }

  setQuestMultiplier(mult: number): void {
    this.questMultEl.textContent = `${mult.toFixed(2)}×`
  }

  setQuestPanel(state: QuestHudState): void {
    this.questPanelEl.innerHTML = ''

    const main = document.createElement('div')
    main.className = 'quest-line quest-line-main'
    main.textContent = `Spell a ${state.targetLength}-letter word`
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
}
