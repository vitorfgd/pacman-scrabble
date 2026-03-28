import './style.css'
import { Game } from './game/Game'

const BGM_URL = '/music/viacheslavstarostin-retro-arcade-game-music-408074.mp3'
const BGM_VOLUME = 0.2

const bgm = new Audio(BGM_URL)
bgm.loop = true
bgm.volume = BGM_VOLUME

const tryPlayBgm = () => {
  void bgm.play().catch(() => {})
}
tryPlayBgm()
window.addEventListener('pointerdown', tryPlayBgm, { once: true })
window.addEventListener('keydown', tryPlayBgm, { once: true })

const app = document.getElementById('app')
if (!app) throw new Error('Missing #app element')

const gameEl = document.getElementById('game')
if (!gameEl) throw new Error('Missing #game element')

// Default mode only (no theme switching).
document.documentElement.dataset.theme = 'dark'

/** Game layout + logic always use portrait (9:16 stage is letterboxed in CSS). */
function applyOrientationState() {
  document.documentElement.dataset.orientation = 'portrait'
}

applyOrientationState()

function tryLockPortraitOrientation(): void {
  const o = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> }
  if (o?.lock) {
    void o.lock('portrait').catch(() => {})
  }
}

const game = new Game({ container: gameEl })
game.start()

window.addEventListener('resize', () => {
  applyOrientationState()
})

window.addEventListener('pointerdown', tryLockPortraitOrientation, { once: true, passive: true })
window.addEventListener('keydown', tryLockPortraitOrientation, { once: true })
