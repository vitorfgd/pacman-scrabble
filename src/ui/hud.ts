export class Hud {
  private readonly scoreValueEl: HTMLElement
  private readonly coinValueEl: HTMLElement
  private readonly powerModeEl: HTMLElement
  readonly shopToggleEl: HTMLButtonElement
  readonly shopOverlayEl: HTMLElement
  readonly shopCloseEl: HTMLButtonElement
  readonly shopSkinListEl: HTMLElement

  constructor() {
    const scoreValueEl = document.getElementById('scoreValue')
    const coinValueEl = document.getElementById('coinValue')
    const powerModeEl = document.getElementById('powerMode')
    const shopToggleEl = document.getElementById('shopToggle') as HTMLButtonElement | null
    const shopOverlayEl = document.getElementById('shopOverlay')
    const shopCloseEl = document.getElementById('shopClose') as HTMLButtonElement | null
    const shopSkinListEl = document.getElementById('shopSkinList')

    if (!scoreValueEl) throw new Error('Missing #scoreValue element')
    if (!coinValueEl) throw new Error('Missing #coinValue element')
    if (!powerModeEl) throw new Error('Missing #powerMode element')
    if (!shopToggleEl) throw new Error('Missing #shopToggle button element')
    if (!shopOverlayEl) throw new Error('Missing #shopOverlay element')
    if (!shopCloseEl) throw new Error('Missing #shopClose button element')
    if (!shopSkinListEl) throw new Error('Missing #shopSkinList element')

    this.scoreValueEl = scoreValueEl
    this.coinValueEl = coinValueEl
    this.powerModeEl = powerModeEl
    this.shopToggleEl = shopToggleEl
    this.shopOverlayEl = shopOverlayEl
    this.shopCloseEl = shopCloseEl
    this.shopSkinListEl = shopSkinListEl
  }

  setScore(score: number): void {
    this.scoreValueEl.textContent = score.toLocaleString()
  }

  setCoins(coins: number): void {
    this.coinValueEl.textContent = Math.max(0, Math.floor(coins)).toLocaleString()
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

  setShopOpen(open: boolean): void {
    this.shopOverlayEl.classList.toggle('shop-overlay--open', open)
    this.shopOverlayEl.setAttribute('aria-hidden', open ? 'false' : 'true')
  }
}
