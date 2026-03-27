import * as THREE from 'three'
import { Player } from './entities/Player'
import { Enemy } from './entities/Enemy'
import type { EnemyRole } from './entities/Enemy'
import { Fruit } from './entities/Fruit'
import { WordScrambler } from './WordScrambler'
import { WordSource } from './WordSource'
import { WordValidator } from './WordValidator'
import { getLetterScore, isVowelLetter } from './LetterScoring'
import { Grid, type Dir } from './Grid'
import { Hud } from '../ui/hud'
import { playEnemyHitEffect, playInfoCelebration, playResetCelebration, playSubmissionFail, playWordCelebration } from '../ui/wordCelebration'

export type GameOptions = { container: HTMLElement }

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type ThemeMode = 'dark' | 'light'
type ViewportProfile = {
  cameraViewHeightWorld: number
  playerSize: number
  letterRadius: number
  starterScale: number
  starterSpacing: number
  enemyCount: number
  enemyMinSpawnDist: number
  enemyMaxSpawnDist: number
}

const QUEST_SCHEDULE = [
  { length: 3, count: 2 },
  { length: 4, count: 2 },
  { length: 5, count: 1 },
] as const

const SPEED_BOOST_CHARGE_MS = 18000
const SPEED_BOOST_ACTIVE_MS = 2000
const INTRO_MINI_BOOST_MS = 1200
const INTRO_MINI_BOOST_READY_MS = 4500
const INTRO_WINDOW_MS = 10000
const SPEED_BOOST_MULT = 1.6
const ENEMY_BASE_SPEED_MULT = 0.78
const GRID_CELL_SCALE = 1.25
const BASE_GRID_DIVISIONS = 64
const RANDOM_LETTER_FREQUENCY = 'eeeeeeeeeeeeeeeeetttttttttaaaaaaaaooooooooooiiiiiiiiinnnnnnnnssssssssrrrrrrrrrrhhhhhhhhddddlllllluuuuuuuuuuccccccuummmmmmwwwwwwwwffggggggyyypppbbvvkjxqz'

/** Enemies chase only inside this radius (grid cells, Euclidean). */
const CHASE_ENTER_CELLS = 4
/** Hysteresis: stop chasing only after player is farther than this (reduces chase/patrol flicker). */
const CHASE_EXIT_CELLS = 7

/** One tile = one walkable cell; L-shaped edges tile seamlessly so lines match world grid. */
function createGridCellTileTexture(gridSizePx = 512, themeMode: ThemeMode): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = gridSizePx
  canvas.height = gridSizePx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for grid')

  if (themeMode === 'dark') {
    ctx.fillStyle = '#0d0d16'
  } else {
    ctx.fillStyle = '#eef2ff'
  }
  ctx.fillRect(0, 0, gridSizePx, gridSizePx)

  ctx.strokeStyle = themeMode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(27,31,48,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, gridSizePx)
  ctx.moveTo(0, 0)
  ctx.lineTo(gridSizePx, 0)
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class Game {
  private readonly container: HTMLElement

  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private renderer: THREE.WebGLRenderer

  private player: Player
  private gridPlane: THREE.Mesh
  private readonly grid: Grid

  private readonly mapSize = 6000
  private bounds: Bounds = { minX: -3000, maxX: 3000, minY: -3000, maxY: 3000 }

  // UI is rendered in fixed-position DOM (quest slots), no world->screen projection needed.

  private hud: Hud | null = null
  private wordSource: WordSource | null = null
  private wordValidator: WordValidator | null = null
  private wordScrambler: WordScrambler | null = null
  private wordOfDayByLength: Record<number, string> = { 3: '', 4: '', 5: '' }
  private currentWordOfDay = ''

  private questScheduleIndex = 0
  private questInPhaseDone = 0
  private questRandomMode = false
  private currentQuestLength = 3
  /** Random word used only for starter-letter tiles on the map (quest accepts any valid word of that length). */
  private questTargetWord = ''

  private gameStartMs = 0

  // HTML tray element
  private trayEl: HTMLDivElement | null = null
  private tray: string[] = []

  private wordCompletionInFlight = false

  private enemyPool: Enemy[] = []
  private enemyLastHitMs: number[] = []
  /** True while this enemy is in "aggro" chase mode (distance hysteresis). */
  private enemyChaseAggro: boolean[] = []
  private readonly enemyCollisionCooldownMs = 450

  private fruit: Fruit
  private fruitNextSpawnMs = 0

  private score = 0
  private wordsFound = 0

  private powerModeUntilMs = 0
  private powerModeActive = false

  private speedBoostChargeProgressMs = 0
  private speedBoostActiveUntilMs = 0
  private introMiniBoostAvailable = true
  private introMiniBoostGranted = false
  private introFirstMoveJuiced = false
  private audioLayerStep = 0
  private pickupAudioCtx: AudioContext | null = null

  private cameraJuiceOffset = new THREE.Vector2()

  private resetting = false
  private paused = false
  private pauseStartedMs = 0
  private wordCelebrationEl: HTMLDivElement | null = null
  private startInstructionEl: HTMLDivElement | null = null
  private startSwipeGestureEl: HTMLDivElement | null = null

  // Word-completion shockwave ring.
  private shockwaveMesh: THREE.Mesh | null = null
  private shockwaveActive = false
  private shockwaveStartMs = 0
  private readonly shockwaveMaxRadius = 440
  private readonly shockwaveDurationMs = 720

  private running = false
  private lastMs = 0
  private initialPlayerSize = 28
  private cameraViewHeightWorld = 1380
  private readonly cameraFollowSpeed = 4.5
  private viewportProfile: ViewportProfile = this.computeViewportProfile()

  /** Until the first directional input, enemies (and fruit) stay idle. */
  private awaitingFirstMove = true
  private inputBound = false

  constructor(options: GameOptions) {
    this.container = options.container

    this.scene = new THREE.Scene()

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio ?? 1))
    this.container.appendChild(this.renderer.domElement)

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000)
    this.camera.position.set(0, 0, 400)
    this.camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    this.scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(0.3, 0.4, 1)
    this.scene.add(dir)

    const themeMode: ThemeMode = 'dark'
    const gridDivisions = Math.max(10, Math.round(BASE_GRID_DIVISIONS / GRID_CELL_SCALE))
    this.grid = new Grid(this.bounds, gridDivisions)
    const gridTex = createGridCellTileTexture(512, themeMode)
    gridTex.repeat.set(this.grid.divisions, this.grid.divisions)
    const gridMat = new THREE.MeshStandardMaterial({ map: gridTex, roughness: 1, metalness: 0 })
    this.gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(this.mapSize, this.mapSize), gridMat)
    this.scene.add(this.gridPlane)

    this.player = new Player(this.grid)
    this.player.setSize(this.initialPlayerSize)
    this.scene.add(this.player.mesh)

    this.fruit = new Fruit()
    this.scene.add(this.fruit.mesh)

    // Expanding ring for word-completion shockwave feedback.
    const swGeo = new THREE.RingGeometry(0.80, 1, 56)
    const swMat = new THREE.MeshBasicMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    this.shockwaveMesh = new THREE.Mesh(swGeo, swMat)
    this.shockwaveMesh.renderOrder = 60
    this.shockwaveMesh.visible = false
    this.scene.add(this.shockwaveMesh)

    this.recomputeBounds()
    this.setupInput()
    this.onResize()
    this.camera.position.set(this.player.mesh.position.x, this.player.mesh.position.y, 400)
    this.camera.lookAt(this.player.mesh.position.x, this.player.mesh.position.y, 0)
  }

  private setStartInstructionVisible(visible: boolean): void {
    this.startInstructionEl?.classList.toggle('start-instruction--hidden', !visible)
    this.startSwipeGestureEl?.classList.toggle('start-swipe-gesture--hidden', !visible)
  }

  private recomputeBounds() {
    const half = this.mapSize / 2
    this.bounds = { minX: -half, maxX: half, minY: -half, maxY: half }
  }

  private readonly onKeyDown = (ev: KeyboardEvent) => {
      const set = (dir: Dir) => {
        ev.preventDefault()
        if (this.awaitingFirstMove) {
          this.awaitingFirstMove = false
          this.setStartInstructionVisible(false)
          this.triggerFirstMoveJuice(dir)
        }
        this.player.setDesiredDir(dir)
      }

      // Desktop: WASD / arrows steer the next grid step direction.
      if (ev.code === 'ArrowUp' || ev.code === 'KeyW') return set({ x: 0, y: 1 })
      if (ev.code === 'ArrowDown' || ev.code === 'KeyS') return set({ x: 0, y: -1 })
      if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') return set({ x: -1, y: 0 })
      if (ev.code === 'ArrowRight' || ev.code === 'KeyD') return set({ x: 1, y: 0 })
      if (ev.code === 'KeyR') this.resetTray()
      if (ev.code === 'Backspace') {
        ev.preventDefault()
        this.putBackLastTrayLetter()
      }
      if (ev.code === 'KeyP') this.togglePause()
      if (ev.code === 'KeyH') this.hardResetGame()
    }

  private readonly onTouchStart = (ev: TouchEvent) => {
    if (!this.isPortraitMode()) return
    if (ev.touches.length !== 1) return
    this.swipeStart.active = true
    this.swipeStart.x = ev.touches[0]?.clientX ?? 0
    this.swipeStart.y = ev.touches[0]?.clientY ?? 0
  }

  private readonly onTouchEnd = (ev: TouchEvent) => {
    if (!this.swipeStart.active) return
    this.swipeStart.active = false
    if (!this.isPortraitMode()) return
    if (ev.changedTouches.length !== 1) return
    const endX = ev.changedTouches[0]?.clientX ?? 0
    const endY = ev.changedTouches[0]?.clientY ?? 0
    const dx = endX - this.swipeStart.x
    const dy = endY - this.swipeStart.y
    const dist = Math.hypot(dx, dy)
    if (dist < 24) return

    if (Math.abs(dx) > Math.abs(dy)) {
      if (this.awaitingFirstMove) {
        this.awaitingFirstMove = false
        this.setStartInstructionVisible(false)
        this.triggerFirstMoveJuice({ x: Math.sign(dx) as -1 | 0 | 1, y: 0 })
      }
      this.player.setDesiredDir({ x: Math.sign(dx) as -1 | 0 | 1, y: 0 })
    } else {
      // Screen Y grows down; world Y grows up.
      if (this.awaitingFirstMove) {
        this.awaitingFirstMove = false
        this.setStartInstructionVisible(false)
        this.triggerFirstMoveJuice({ x: 0, y: (-Math.sign(dy)) as -1 | 0 | 1 })
      }
      this.player.setDesiredDir({ x: 0, y: (-Math.sign(dy)) as -1 | 0 | 1 })
    }
  }

  private readonly swipeStart = { x: 0, y: 0, active: false }

  private setupInput() {
    if (this.inputBound) return
    this.inputBound = true
    window.addEventListener('keydown', this.onKeyDown)
    this.renderer.domElement.addEventListener('touchstart', this.onTouchStart, { passive: true })
    window.addEventListener('touchend', this.onTouchEnd, { passive: true })
  }

  private teardownInput() {
    if (!this.inputBound) return
    this.inputBound = false
    window.removeEventListener('keydown', this.onKeyDown)
    this.renderer.domElement.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('touchend', this.onTouchEnd)
  }

  private reconcileViewportRuntimeState(): void {
    if (!this.wordScrambler) return
    this.spawnInitialEnemies()
    this.wordScrambler.initRandomFill(this.currentQuestLength)
    if (this.questTargetWord) this.wordScrambler.spawnStarterWord(this.questTargetWord, new THREE.Vector2(0, 0))
  }

  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w <= 0 || h <= 0) return
    this.viewportProfile = this.computeViewportProfile()
    this.cameraViewHeightWorld = this.viewportProfile.cameraViewHeightWorld
    // updateStyle true so canvas CSS size matches the container (avoids off-center / wrong framing).
    this.renderer.setSize(w, h, true)
    const aspect = w / h
    const halfY = this.cameraViewHeightWorld / 2
    const halfX = halfY * aspect
    this.camera.left = -halfX
    this.camera.right = halfX
    this.camera.top = halfY
    this.camera.bottom = -halfY
    this.camera.updateProjectionMatrix()
    this.applyViewportProfileRuntime()
    if (this.running) this.reconcileViewportRuntimeState()
  }

  private isPortraitMode(): boolean {
    const forced = document.documentElement.dataset.orientation
    if (forced === 'portrait') return true
    if (forced === 'landscape') return false
    return this.container.clientHeight > this.container.clientWidth
  }

  private computeViewportProfile(): ViewportProfile {
    const s = GRID_CELL_SCALE
    const portrait = this.isPortraitMode()
    if (!portrait) {
      return {
        cameraViewHeightWorld: 1380 * s,
        playerSize: 28 * s,
        letterRadius: 42 * s,
        starterScale: 58 * s,
        starterSpacing: 92 * s,
        enemyCount: 36,
        enemyMinSpawnDist: 1050 * s,
        enemyMaxSpawnDist: Math.min(2680 * s, this.mapSize / 2 - 80),
      }
    }
    return {
      cameraViewHeightWorld: 1700 * s,
      playerSize: 34 * s,
      letterRadius: 56 * s,
      starterScale: 72 * s,
      starterSpacing: 104 * s,
      enemyCount: 30,
      enemyMinSpawnDist: 1100 * s,
      enemyMaxSpawnDist: Math.min(2620 * s, this.mapSize / 2 - 80),
    }
  }

  private applyViewportProfileRuntime(): void {
    this.initialPlayerSize = this.viewportProfile.playerSize
    if (this.player.getRadius() <= this.initialPlayerSize + 0.01) {
      this.player.setSize(this.initialPlayerSize)
    }
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastMs = performance.now()
    window.addEventListener('resize', this.onResize)
    void this.initGameAsync()
    this.loop()
  }

  private async initGameAsync() {
    try {
      this.hud = new Hud()
      this.hud.setOnResetTray(() => this.resetTray())
      this.hud.setOnPauseToggle(() => this.togglePause())
      this.hud.setOnHardReset(() => this.hardResetGame())
      this.hud.setOnSpeedBoost(() => this.activateSpeedBoost(performance.now()))
      this.hud.setOnPutBackLetter(() => this.putBackLastTrayLetter())
      this.hud.setPauseButtonState(false)

      // Cache DOM refs
      this.trayEl = document.getElementById('tray') as HTMLDivElement | null
      this.wordCelebrationEl = document.getElementById('wordCelebration') as HTMLDivElement | null
      this.startInstructionEl = document.getElementById('startInstruction') as HTMLDivElement | null
      this.startSwipeGestureEl = document.getElementById('startSwipeGesture') as HTMLDivElement | null
      this.setStartInstructionVisible(true)

      this.wordSource = new WordSource({ topWordCount: 1000 })
      this.wordValidator = new WordValidator()
      this.wordOfDayByLength = {
        3: this.wordSource.getWordOfDay(3, 3),
        4: this.wordSource.getWordOfDay(4, 4),
        5: this.wordSource.getWordOfDay(5, 5),
      }
      this.hud.setPowerMode(false)

      // Tips removed for now.

      this.wordScrambler = new WordScrambler({
        scene: this.scene,
        grid: this.grid,
        letterRadius: this.viewportProfile.letterRadius,
        maxLetters: 300,
        starterScale: this.viewportProfile.starterScale,
        themeMode: 'dark',
      })
      this.resetQuestState()
      this.pickNewQuestTargetWord()
      this.wordScrambler.initRandomFill(3)
      this.wordScrambler.spawnStarterWord(this.questTargetWord, new THREE.Vector2(0, 0))
      this.updateQuestHud()
      this.updateTrayContent()

      this.score = 0
      this.wordsFound = 0
      this.hud.setScore(0)
      this.hud.setWordsFound(0)
      this.speedBoostChargeProgressMs = 0
      this.speedBoostActiveUntilMs = 0
      this.introMiniBoostAvailable = true
      this.introMiniBoostGranted = false
      this.introFirstMoveJuiced = false
      this.audioLayerStep = 0
      window.dispatchEvent(new CustomEvent('audio-layer-step', { detail: { step: 0 } }))
      this.player.setSpeedMultiplier(1)
      this.gameStartMs = performance.now()
      this.updateSpeedBoostHud(this.gameStartMs)

      this.setupEnemyPool()
      this.spawnInitialEnemies()
      // "Cherries": spawn more frequently so power mode opportunities are common.
      this.fruitNextSpawnMs = performance.now() + (3500 + Math.random() * 2500) / 3
    } catch (err) {
      console.error('initGameAsync failed', err)
    }
  }

  private setupEnemyPool() {
    const poolSize = 48
    for (let i = 0; i < poolSize; i++) {
      const e = new Enemy(this.grid)
      this.scene.add(e.mesh)
      e.setActive(false, { x: 0, y: 0 }, 10)
      this.enemyPool.push(e)
      this.enemyLastHitMs.push(0)
      this.enemyChaseAggro.push(false)
    }
  }

  // Role distribution: weighted random across the three gameplay behaviors.
  private pickEnemyRole(index: number): EnemyRole {
    const r = Math.random()
    // Slight bias so early nearby enemies are often "giver" to ease onboarding.
    if (index < 4 || r < 0.34) return 'giver'
    if (r < 0.67) return 'shuffler'
    return 'stealer'
  }

  private spawnInitialEnemies() {
    const count = this.viewportProfile.enemyCount
    const tmp = new THREE.Vector2()
    const minSpawnDist = this.viewportProfile.enemyMinSpawnDist
    const maxSpawnDist = this.viewportProfile.enemyMaxSpawnDist
    // Golden-angle spiral: even spread in angle + staggered radius (avoids clumping on map edges).
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < this.enemyPool.length; i++) {
      this.enemyChaseAggro[i] = false
      this.enemyLastHitMs[i] = 0
      this.enemyPool[i].setActive(false, { x: 0, y: 0 }, 10)
    }
    const spawnCount = Math.min(count, this.enemyPool.length)
    for (let i = 0; i < spawnCount; i++) {
      const r = this.viewportProfile.playerSize
      const margin = r * 2
      const t = (i + 0.5) / Math.max(1, count)
      const dist = minSpawnDist + t * (maxSpawnDist - minSpawnDist)
      const angle = i * goldenAngle + (Math.random() - 0.5) * 0.35
      tmp.set(Math.cos(angle) * dist, Math.sin(angle) * dist)
      tmp.x = THREE.MathUtils.clamp(tmp.x, this.bounds.minX + margin, this.bounds.maxX - margin)
      tmp.y = THREE.MathUtils.clamp(tmp.y, this.bounds.minY + margin, this.bounds.maxY - margin)
      this.enemyPool[i].setActive(true, this.grid.worldToCell(tmp.x, tmp.y), r, this.pickEnemyRole(i))
    }
  }

  private loop = () => {
    if (!this.running) return
    const nowMs = performance.now()
    const deltaSeconds = Math.min(0.05, (nowMs - this.lastMs) / 1000)
    this.lastMs = nowMs
    this.update(deltaSeconds, nowMs)
    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(this.loop)
  }

  private update(deltaSeconds: number, nowMs: number) {
    if (this.paused) return
    this.updateCamera(deltaSeconds)
    this.player.update(deltaSeconds)

    this.updateShockwave(nowMs)

    if (!this.wordScrambler || !this.hud || !this.wordSource || !this.wordValidator) return
    if (this.resetting) return

    this.handlePowerMode(nowMs)
    this.handleSpeedBoost(nowMs, deltaSeconds)

    if (!this.wordCompletionInFlight) {
      this.handleLetterCollisions()
    }

    this.wordScrambler.updatePickupReadability(
      new THREE.Vector2(this.player.mesh.position.x, this.player.mesh.position.y),
      nowMs,
    )

    this.wordScrambler?.updateStarterLetters(nowMs)
    if (!this.awaitingFirstMove) {
      this.updateEnemies(deltaSeconds, nowMs)
      this.maybeSpawnFruit(nowMs)
      this.fruit.update(nowMs)
      this.handleFruitCollision(nowMs)
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(deltaSeconds: number) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    const halfY = this.cameraViewHeightWorld / 2
    const halfX = halfY * aspect

    const targetX = THREE.MathUtils.clamp(this.player.mesh.position.x, this.bounds.minX + halfX, this.bounds.maxX - halfX)
    const targetY = THREE.MathUtils.clamp(this.player.mesh.position.y, this.bounds.minY + halfY, this.bounds.maxY - halfY)

    if (this.awaitingFirstMove) {
      this.camera.position.x = targetX
      this.camera.position.y = targetY
    } else {
      this.cameraJuiceOffset.multiplyScalar(Math.max(0, 1 - deltaSeconds * 8))
      const t = 1 - Math.exp(-this.cameraFollowSpeed * deltaSeconds)
      this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX + this.cameraJuiceOffset.x, t)
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY + this.cameraJuiceOffset.y, t)
    }
    this.camera.position.z = 400
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0)
  }

  private updateTrayContent() {
    if (!this.trayEl) return
    this.trayEl.innerHTML = ''
    for (let i = 0; i < this.currentQuestLength; i++) {
      const slot = document.createElement('span')
      slot.className = 'tray-slot'
      if (i < this.tray.length) {
        const ch = this.tray[i] ?? ''
        const pts = getLetterScore(ch)
        slot.className += ` tray-tile tray-tile-filled ${isVowelLetter(ch) ? 'tray-vowel' : 'tray-consonant'}`
        const letterEl = document.createElement('span')
        letterEl.className = 'tray-tile-char'
        letterEl.textContent = ch.toUpperCase()
        const ptsEl = document.createElement('span')
        ptsEl.className = 'tray-tile-points'
        ptsEl.textContent = String(pts)
        slot.appendChild(letterEl)
        slot.appendChild(ptsEl)
      } else {
        slot.className += ' tray-tile tray-tile-empty'
        const q = document.createElement('span')
        q.className = 'tray-tile-hidden'
        q.textContent = '?'
        slot.appendChild(q)
      }
      this.trayEl.appendChild(slot)
    }
    this.hud?.setBackspaceEnabled(this.tray.length > 0)
  }

  // ── Power Mode ────────────────────────────────────────────────────────────

  private handlePowerMode(nowMs: number) {
    if (!this.powerModeActive || !this.hud) return
    const remaining = this.powerModeUntilMs - nowMs
    if (remaining <= 0) {
      this.powerModeActive = false
      this.hud.setPowerMode(false)
      for (const e of this.enemyPool) if (e.isActive()) e.setPowerMode(false)
    } else {
      this.hud.setPowerMode(true, remaining)
    }
  }

  // ── Letter collection ────────────────────────────────────────────────────

  private handleLetterCollisions() {
    if (!this.wordScrambler) return
    const playerCell = this.player.getCell()
    let changed = false
    for (const letter of this.wordScrambler.getActiveLetters()) {
      if (this.tray.length >= this.currentQuestLength) break
      const lc = letter.getCell()
      const nearForAssist = this.grid.cellDistance(playerCell, lc) <= 0.95
      if ((lc.x === playerCell.x && lc.y === playerCell.y) || nearForAssist) {
        this.tray.push(letter.char)
        letter.setActive(false)
        this.wordScrambler.spawnReplacementLetter()
        changed = true
      }
    }
    if (changed) {
      this.playPickupTone()
      this.maybeAdvanceAudioLayer(1)
      this.updateTrayContent()
      this.updateQuestHud()
      if (this.tray.length === this.currentQuestLength && !this.wordCompletionInFlight) {
        void this.tryCompleteWord()
      }
    }
  }

  // ── Word completion ───────────────────────────────────────────────────────

  private async tryCompleteWord() {
    if (!this.wordValidator || this.wordCompletionInFlight || !this.tray.length) return
    if (this.paused) return
    if (this.tray.length !== this.currentQuestLength) return
    const joined = this.tray.join('').toLowerCase()
    if (!this.wordValidator.isValidExactWord(joined)) {
      this.handleInvalidSubmission()
      return
    }
    await this.completeWord(joined)
  }

  private handleInvalidSubmission(): void {
    if (!this.wordScrambler) return
    const returned = [...this.tray]
    this.tray = []
    this.updateTrayContent()
    if (returned.length > 0) this.wordScrambler.spawnLettersFromTray(returned)
    playSubmissionFail(this.wordCelebrationEl, 'NOT A WORD', `Spell a real ${this.currentQuestLength}-letter word.`)
  }

  private pickNewQuestTargetWord(): void {
    if (!this.wordSource) return
    this.questTargetWord = this.wordSource.getWordByLength(this.currentQuestLength)
  }

  private resetQuestState(): void {
    this.questScheduleIndex = 0
    this.questInPhaseDone = 0
    this.questRandomMode = false
    this.currentQuestLength = QUEST_SCHEDULE[0].length
  }

  private advanceQuestAfterCompletion(): void {
    if (this.questRandomMode) {
      this.currentQuestLength = [3, 4, 5][Math.floor(Math.random() * 3)]
      return
    }
    const ph = QUEST_SCHEDULE[this.questScheduleIndex]
    this.questInPhaseDone++
    if (this.questInPhaseDone >= ph.count) {
      this.questScheduleIndex++
      this.questInPhaseDone = 0
      if (this.questScheduleIndex >= QUEST_SCHEDULE.length) {
        this.questRandomMode = true
        this.currentQuestLength = [3, 4, 5][Math.floor(Math.random() * 3)]
        return
      }
    }
    this.currentQuestLength = QUEST_SCHEDULE[this.questScheduleIndex].length
  }

  private async completeWord(word: string) {
    if (!this.wordScrambler || !this.hud || this.wordCompletionInFlight) return
    this.wordCompletionInFlight = true
    try {
      const letters = word.toLowerCase().split('')

      const perLetterPoints = letters.map((ch) => getLetterScore(ch))
      const basePoints = perLetterPoints.reduce((a, b) => a + b, 0)

      let pts = basePoints
      let grow = pts * 0.006

      const wodWord = this.currentWordOfDay
      const isWordOfDay =
        wodWord.length > 0 && word.toLowerCase() === wodWord.toLowerCase()

      if (isWordOfDay) {
        // Massive bonus for the daily target.
        pts = Math.round(pts * 8 + 600)
        grow = grow * 1.25 + 8
        this.player.setWordOfDayGlow(true, performance.now())
      }

      playWordCelebration(this.wordCelebrationEl, {
        letters,
        pointsPerLetter: Math.max(1, Math.round(pts / Math.max(1, letters.length))),
        perLetterPoints,
        totalPoints: pts,
        questComplete: true,
        wordOfDayComplete: isWordOfDay,
        nextWordOfDayInLabel: isWordOfDay ? this.getTimeUntilNextWordOfDayLabel() : undefined,
      })

      this.player.setSize(this.player.getRadius() + grow)
      this.score += pts
      this.wordsFound += 1
      if (this.wordsFound >= 1) this.maybeAdvanceAudioLayer(2)
      this.hud?.setScore(this.score)
      this.hud?.setWordsFound(this.wordsFound)
      this.triggerWordShockwave(performance.now())
      this.advanceQuestAfterCompletion()
      this.pickNewQuestTargetWord()
      this.updateQuestHud()
      this.tray = []
      this.updateTrayContent()
    } finally {
      this.wordCompletionInFlight = false
    }
  }

  private getTimeUntilNextWordOfDayLabel(): string {
    const now = new Date()
    const next = new Date(now)
    next.setHours(24, 0, 0, 0)
    const ms = Math.max(0, next.getTime() - now.getTime())
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  private updateEnemies(deltaSeconds: number, nowMs: number) {
    for (let i = 0; i < this.enemyPool.length; i++) {
      const enemy = this.enemyPool[i]
      if (!enemy.isActive()) continue

      const playerCell = this.player.getCell()
      const playerLastDir = this.player.getLastMoveDir()
      const enemyCellBefore = enemy.getCell()
      const dSq = this.grid.cellDistanceSq(enemyCellBefore, playerCell)
      const enterSq = CHASE_ENTER_CELLS * CHASE_ENTER_CELLS
      const exitSq = CHASE_EXIT_CELLS * CHASE_EXIT_CELLS

      if (!this.enemyChaseAggro[i]) {
        if (dSq <= enterSq) this.enemyChaseAggro[i] = true
      } else {
        if (dSq >= exitSq) this.enemyChaseAggro[i] = false
      }

      const shouldChase = this.enemyChaseAggro[i]

      enemy.update(
        deltaSeconds,
        playerCell,
        playerLastDir,
        shouldChase,
        this.powerModeActive,
        ENEMY_BASE_SPEED_MULT,
      )

      const enemyCellAfter = enemy.getCell()
      const hitNow =
        (enemyCellBefore.x === playerCell.x && enemyCellBefore.y === playerCell.y) ||
        (enemyCellAfter.x === playerCell.x && enemyCellAfter.y === playerCell.y)
      if (!hitNow) continue
      if (nowMs - this.enemyLastHitMs[i] < this.enemyCollisionCooldownMs) continue
      this.enemyLastHitMs[i] = nowMs

      if (this.powerModeActive) {
        this.enemyChaseAggro[i] = false
        enemy.setActive(false, { x: 0, y: 0 }, 10)
      } else {
        const role = enemy.getRole()
        if (role === 'stealer') {
          if (this.tray.length > 0) {
            const stealIndex = Math.floor(Math.random() * this.tray.length)
            this.tray.splice(stealIndex, 1)
            this.updateTrayContent()
            this.updateQuestHud()
          }
          playEnemyHitEffect(this.wordCelebrationEl, 'stealer')
        } else if (role === 'giver') {
          if (this.tray.length < this.currentQuestLength) {
            this.tray.push(this.pickRandomLetter())
            this.updateTrayContent()
            this.updateQuestHud()
            if (this.tray.length === this.currentQuestLength && !this.wordCompletionInFlight) {
              void this.tryCompleteWord()
            }
          }
          playEnemyHitEffect(this.wordCelebrationEl, 'giver')
        } else {
          if (this.tray.length > 1) {
            this.shuffleInPlace(this.tray)
            this.updateTrayContent()
            this.updateQuestHud()
          }
          playEnemyHitEffect(this.wordCelebrationEl, 'shuffler')
        }
        this.enemyChaseAggro[i] = false
        enemy.setActive(false, { x: 0, y: 0 }, 10)
      }
    }
  }

  // ── Tray / tip controls ───────────────────────────────────────────────────

  private resetTray() {
    if (!this.wordScrambler) {
      this.tray = []
      this.updateTrayContent()
      return
    }
    const returned = [...this.tray]
    this.tray = []
    this.updateTrayContent()
    if (returned.length > 0) {
      this.wordScrambler.spawnLettersFromTray(returned)
      this.updateQuestHud()
    }
  }

  private putBackLastTrayLetter(): void {
    if (!this.wordScrambler || this.tray.length === 0) return
    const letter = this.tray.pop()
    if (!letter) return
    this.wordScrambler.spawnLettersFromTray([letter])
    this.updateTrayContent()
    this.updateQuestHud()
  }

  private pickRandomLetter(): string {
    const idx = Math.floor(Math.random() * RANDOM_LETTER_FREQUENCY.length)
    return RANDOM_LETTER_FREQUENCY[idx] ?? 'e'
  }

  private shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }

  // ── Reset on death ────────────────────────────────────────────────────────

  private requestReset() {
    if (this.resetting) return
    this.resetting = true
    this.powerModeActive = false
    this.hud?.setPowerMode(false)
    this.speedBoostChargeProgressMs = 0
    this.speedBoostActiveUntilMs = 0
    this.player.setSpeedMultiplier(1)

    playResetCelebration(
      this.wordCelebrationEl,
      'OUCH! RESET!',
      `Quest target: ${this.currentQuestLength} letters. Spell to grow.`,
    )
    this.tray = []
    this.updateTrayContent()
    this.player.setSize(this.initialPlayerSize)
    this.player.setCell(this.grid.worldToCell(0, 0))

    for (let i = 0; i < this.enemyPool.length; i++) {
      this.enemyChaseAggro[i] = false
      this.enemyLastHitMs[i] = 0
      this.enemyPool[i].setActive(false, { x: 0, y: 0 }, 10)
    }
    this.fruit.setActive(false, new THREE.Vector2(0, 0), 22 * GRID_CELL_SCALE)
    if (this.shockwaveMesh) { this.shockwaveMesh.visible = false; this.shockwaveActive = false }

    this.score = 0
    this.wordsFound = 0
    this.hud?.setScore(0)
    this.hud?.setWordsFound(0)
    this.resetQuestState()
    this.pickNewQuestTargetWord()
    if (this.wordScrambler && this.questTargetWord) {
      this.wordScrambler.initRandomFill(this.questTargetWord.length)
      this.wordScrambler.spawnStarterWord(this.questTargetWord, new THREE.Vector2(0, 0))
    }
    this.player.setDesiredDir({ x: 0, y: 0 })
    this.awaitingFirstMove = true
    this.setStartInstructionVisible(true)
    this.updateSpeedBoostHud(performance.now())
    this.updateQuestHud()
    this.gameStartMs = performance.now()
    this.spawnInitialEnemies()
    this.fruitNextSpawnMs = performance.now() + 3000 / 3
    this.resetting = false
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────

  private updateQuestHud() {
    if (!this.hud) return

    // Word of the day is length-specific so the bonus is always achievable.
    this.currentWordOfDay = this.wordOfDayByLength[this.currentQuestLength] ?? ''
    if (this.currentWordOfDay) this.hud.setWordOfDay(this.currentWordOfDay)

    this.hud.setQuestLengthLine(this.currentQuestLength)
  }

  private togglePause(): void {
    this.paused = !this.paused
    this.hud?.setPauseButtonState(this.paused)

    if (this.paused) {
      this.pauseStartedMs = performance.now()
      playInfoCelebration(this.wordCelebrationEl, 'PAUSED', 'Press P or click Resume', 1200)
      return
    }

    const now = performance.now()
    const pausedFor = Math.max(0, now - this.pauseStartedMs)
    this.lastMs = now
    this.gameStartMs += pausedFor
    this.fruitNextSpawnMs += pausedFor
    this.powerModeUntilMs += pausedFor
    this.speedBoostActiveUntilMs += pausedFor
  }

  private handleSpeedBoost(nowMs: number, deltaSeconds: number): void {
    // Pre-run state behaves like paused: no charging before first movement input.
    if (this.awaitingFirstMove) {
      this.player.setSpeedMultiplier(1)
      this.updateSpeedBoostHud(nowMs)
      return
    }

    if (
      !this.introMiniBoostGranted &&
      this.introMiniBoostAvailable &&
      nowMs - this.gameStartMs >= INTRO_MINI_BOOST_READY_MS
    ) {
      this.introMiniBoostGranted = true
      this.speedBoostChargeProgressMs = SPEED_BOOST_CHARGE_MS
    }

    if (this.speedBoostActiveUntilMs > nowMs) {
      this.player.setSpeedMultiplier(SPEED_BOOST_MULT)
    } else {
      this.speedBoostActiveUntilMs = 0
      this.player.setSpeedMultiplier(1)
      this.speedBoostChargeProgressMs = Math.min(
        SPEED_BOOST_CHARGE_MS,
        this.speedBoostChargeProgressMs + deltaSeconds * 1000,
      )
    }
    this.updateSpeedBoostHud(nowMs)
  }

  private activateSpeedBoost(nowMs: number): void {
    if (this.paused || this.awaitingFirstMove) return
    if (this.speedBoostActiveUntilMs > nowMs) return
    if (this.speedBoostChargeProgressMs < SPEED_BOOST_CHARGE_MS) return
    const introBoost = this.introMiniBoostAvailable && nowMs - this.gameStartMs <= INTRO_WINDOW_MS
    this.speedBoostChargeProgressMs = 0
    this.speedBoostActiveUntilMs = nowMs + (introBoost ? INTRO_MINI_BOOST_MS : SPEED_BOOST_ACTIVE_MS)
    if (introBoost) this.introMiniBoostAvailable = false
    this.player.setSpeedMultiplier(SPEED_BOOST_MULT)
    this.updateSpeedBoostHud(nowMs)
  }

  private updateSpeedBoostHud(nowMs: number): void {
    if (!this.hud) return
    const active = this.speedBoostActiveUntilMs > nowMs
    const ready = !active && this.speedBoostChargeProgressMs >= SPEED_BOOST_CHARGE_MS
    const progress = active ? 1 : this.speedBoostChargeProgressMs / SPEED_BOOST_CHARGE_MS
    const remaining = active ? this.speedBoostActiveUntilMs - nowMs : undefined
    this.hud.setSpeedBoostState(progress, ready, active, remaining)
  }

  private hardResetGame(): void {
    if (this.paused) this.togglePause()
    this.requestReset()
    playInfoCelebration(this.wordCelebrationEl, 'HARD RESET', 'Everything restarted.', 1700)
  }

  private triggerFirstMoveJuice(dir: Dir): void {
    if (this.introFirstMoveJuiced) return
    this.introFirstMoveJuiced = true
    playInfoCelebration(this.wordCelebrationEl, 'GO!', 'Collect letters and build a word.', 900)
    this.triggerWordShockwave(performance.now())
    this.cameraJuiceOffset.set(dir.x * 56, dir.y * 56)
  }

  private maybeAdvanceAudioLayer(step: number): void {
    if (step <= this.audioLayerStep) return
    this.audioLayerStep = step
    window.dispatchEvent(new CustomEvent('audio-layer-step', { detail: { step } }))
  }

  private playPickupTone(): void {
    try {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      if (!this.pickupAudioCtx) this.pickupAudioCtx = new Ctx()
      const ctx = this.pickupAudioCtx
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(560, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.05)
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.09)
    } catch {
      // best effort
    }
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.teardownInput()
    window.removeEventListener('resize', this.onResize)
  }

  // ── Word shockwave ────────────────────────────────────────────────────────

  private triggerWordShockwave(nowMs: number): void {
    if (!this.shockwaveMesh) return
    this.shockwaveMesh.position.set(this.player.mesh.position.x, this.player.mesh.position.y, 2)
    this.shockwaveMesh.scale.setScalar(1)
    this.shockwaveMesh.visible = true
    this.shockwaveActive = true
    this.shockwaveStartMs = nowMs
  }

  private updateShockwave(nowMs: number): void {
    if (!this.shockwaveActive || !this.shockwaveMesh) return
    const t = Math.min(1, (nowMs - this.shockwaveStartMs) / this.shockwaveDurationMs)
    if (t >= 1) {
      this.shockwaveActive = false
      this.shockwaveMesh.visible = false
      return
    }
    this.shockwaveMesh.scale.setScalar(this.shockwaveMaxRadius * t)
    const mat = this.shockwaveMesh.material as THREE.MeshBasicMaterial
    mat.opacity = (1 - t) * 0.72
  }

  // ── Fruit ────────────────────────────────────────────────────────────────

  private maybeSpawnFruit(nowMs: number) {
    if (this.fruit.isActive() || nowMs < this.fruitNextSpawnMs) return
    const r = 22 * GRID_CELL_SCALE
    const raw = new THREE.Vector2(
      THREE.MathUtils.lerp(this.bounds.minX + r, this.bounds.maxX - r, Math.random()),
      THREE.MathUtils.lerp(this.bounds.minY + r, this.bounds.maxY - r, Math.random()),
    )
    const snapped = this.grid.snapWorldToCell(raw.x, raw.y)
    const pos = new THREE.Vector2(snapped.world.x, snapped.world.y)
    this.fruit.setActive(true, pos, r)
    this.fruitNextSpawnMs = nowMs + (14000 + Math.random() * 9000) / 3
  }

  private handleFruitCollision(nowMs: number) {
    if (!this.fruit.isActive()) return
    const playerCell = this.player.getCell()
    const fruitCell = this.grid.worldToCell(this.fruit.mesh.position.x, this.fruit.mesh.position.y)
    if (fruitCell.x !== playerCell.x || fruitCell.y !== playerCell.y) return

    this.fruit.setActive(false, new THREE.Vector2(0, 0), 22 * GRID_CELL_SCALE)
    const dur = 10000
    this.powerModeActive = true
    this.powerModeUntilMs = nowMs + dur
    this.hud?.setPowerMode(true, dur)
    for (const e of this.enemyPool) if (e.isActive()) e.setPowerMode(true)
  }

}
