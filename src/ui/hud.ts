export class Hud {
  private readonly scoreValueEl: HTMLElement
  private readonly boostFillEl: HTMLElement
  private readonly submitGateStatusEl: HTMLElement
  private readonly powerModeEl: HTMLElement
  private readonly resetButtonEl: HTMLButtonElement
  private readonly pauseButtonEl: HTMLButtonElement
  private readonly hardResetButtonEl: HTMLButtonElement
  private readonly lastRunValueEl: HTMLElement

  constructor() {
    const scoreValueEl = document.getElementById('scoreValue')
    const boostFillEl = document.getElementById('boostBarFill')
    const submitGateStatusEl = document.getElementById('submitGateStatus')
    const powerModeEl = document.getElementById('powerMode')
    const lastRunValueEl = document.getElementById('lastRunValue')
    const resetButtonEl = document.getElementById('resetTray') as HTMLButtonElement | null
    const pauseButtonEl = document.getElementById('pauseGame') as HTMLButtonElement | null
    const hardResetButtonEl = document.getElementById('hardResetGame') as HTMLButtonElement | null

    if (!scoreValueEl) throw new Error('Missing #scoreValue element')
    if (!boostFillEl) throw new Error('Missing #boostBarFill element')
    if (!submitGateStatusEl) throw new Error('Missing #submitGateStatus element')
    if (!powerModeEl) throw new Error('Missing #powerMode element')
    if (!lastRunValueEl) throw new Error('Missing #lastRunValue element')
    if (!resetButtonEl) throw new Error('Missing #resetTray button element')
    if (!pauseButtonEl) throw new Error('Missing #pauseGame button element')
    if (!hardResetButtonEl) throw new Error('Missing #hardResetGame button element')

    this.scoreValueEl = scoreValueEl
    this.boostFillEl = boostFillEl
    this.submitGateStatusEl = submitGateStatusEl
    this.powerModeEl = powerModeEl
    this.lastRunValueEl = lastRunValueEl
    this.resetButtonEl = resetButtonEl
    this.pauseButtonEl = pauseButtonEl
    this.hardResetButtonEl = hardResetButtonEl
  }

  /** Highlight when player head is inside the scoring rectangle. */
  setSubmitZoneInside(inside: boolean): void {
    this.submitGateStatusEl.textContent = inside ? 'In scoring zone' : 'Enter the rainbow zone below spawn to score'
    this.submitGateStatusEl.classList.toggle('submit-gate-ready', inside)
  }

  setScore(score: number): void {
    this.scoreValueEl.textContent = score.toLocaleString()
  }

  /** Score from the previous completed run (shown for comparison). */
  setLastRunDisplay(score: number): void {
    this.lastRunValueEl.textContent = score.toLocaleString()
  }

  /** `fill` in 0..1 — width of the boost bar. */
  setBoostFill(fill: number): void {
    const f = Math.max(0, Math.min(1, fill))
    this.boostFillEl.style.width = `${(f * 100).toFixed(1)}%`
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
