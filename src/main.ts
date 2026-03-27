import './style.css'
import { Game } from './game/Game'

const BGM_FILE = 'viacheslavstarostin-retro-arcade-game-music-408074.mp3'
const BGM_URL = `${import.meta.env.BASE_URL}music/${BGM_FILE}`
const BGM_VOLUME = 0.2
const BGM_LAYER_VOLUMES = [0.08, 0.14, 0.2] as const

const bgm = new Audio(BGM_URL)
bgm.loop = true
bgm.volume = BGM_LAYER_VOLUMES[0]

const tryPlayBgm = () => {
  void bgm.play().catch(() => {})
}
tryPlayBgm()
window.addEventListener('pointerdown', tryPlayBgm, { once: true })
window.addEventListener('keydown', tryPlayBgm, { once: true })
window.addEventListener('audio-layer-step', (ev: Event) => {
  const step = (ev as CustomEvent<{ step?: number }>).detail?.step ?? 0
  const safeStep = Math.max(0, Math.min(BGM_LAYER_VOLUMES.length - 1, Math.floor(step)))
  const target = Math.min(BGM_VOLUME, BGM_LAYER_VOLUMES[safeStep] ?? BGM_LAYER_VOLUMES[0])
  bgm.volume = target
})

const app = document.getElementById('app')
if (!app) throw new Error('Missing #app element')

const gameEl = document.getElementById('game')
if (!gameEl) throw new Error('Missing #game element')

function isViewportPortrait(): boolean {
  return window.innerHeight > window.innerWidth
}

// Default mode only (no theme switching).
document.documentElement.dataset.theme = 'dark'

function applyOrientationState() {
  document.documentElement.dataset.orientation = isViewportPortrait() ? 'portrait' : 'landscape'
}

applyOrientationState()

// Keep the app fullscreen; Three.js will create the canvas inside #game.
app.style.width = '100vw'
app.style.height = '100vh'

const game = new Game({ container: gameEl })
game.start()

window.addEventListener('resize', () => {
  applyOrientationState()
})
