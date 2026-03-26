import * as THREE from 'three'
import { Player } from './entities/Player'
import { Enemy } from './entities/Enemy'
import type { EnemyRole } from './entities/Enemy'
import { Fruit } from './entities/Fruit'
import { WordScrambler } from './WordScrambler'
import { WordSource, anagramSignature } from './WordSource'
import { WordValidator } from './WordValidator'
import { getLetterScore, isVowelLetter } from './LetterScoring'
import { Hud } from '../ui/hud'
import { playResetCelebration, playWordCelebration } from '../ui/wordCelebration'

export type GameOptions = { container: HTMLElement }

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const QUEST_SCHEDULE = [
  { length: 3, count: 2 },
  { length: 4, count: 2 },
  { length: 5, count: 1 },
] as const

function createGridTexture(gridSizePx = 512, lineEveryPx = 64): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = gridSizePx
  canvas.height = gridSizePx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for grid')

  ctx.fillStyle = '#0d0d16'
  ctx.fillRect(0, 0, gridSizePx, gridSizePx)

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1

  for (let x = 0; x <= gridSizePx; x += lineEveryPx) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, gridSizePx)
    ctx.stroke()
  }

  for (let y = 0; y <= gridSizePx; y += lineEveryPx) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(gridSizePx, y)
    ctx.stroke()
  }

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

  private readonly mapSize = 6000
  private bounds: Bounds = { minX: -3000, maxX: 3000, minY: -3000, maxY: 3000 }

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2(0, 0)
  private readonly pointerWorld = new THREE.Vector2(0, 0)
  private readonly pointerHit = new THREE.Vector3()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private readonly _projVec = new THREE.Vector3()

  private hud: Hud | null = null
  private wordSource: WordSource | null = null
  private wordScrambler: WordScrambler | null = null
  private wordValidator: WordValidator | null = null

  private wordOfDayByLength: Record<number, string> = { 3: '', 4: '', 5: '' }
  private currentWordOfDay = ''

  private questScheduleIndex = 0
  private questInPhaseDone = 0
  private questRandomMode = false
  private currentQuestLength = 3

  private gameStartMs = 0
  private enemyGlobalRamp = 1
  private readonly enemyRampMax = 2.2
  private readonly enemyRampPerSecond = 0.008

  // HTML tray element — positioned to follow player via world→screen projection
  private trayEl: HTMLDivElement | null = null
  private tray: string[] = []

  private wordCompletionInFlight = false

  private enemyPool: Enemy[] = []
  private enemySpeedScales: number[] = []
  private enemyLastHitMs: number[] = []
  private readonly enemyCollisionCooldownMs = 450

  private fruit: Fruit
  private fruitNextSpawnMs = 0

  // (Tips removed for now)

  private score = 0

  private powerModeUntilMs = 0
  private powerModeActive = false

  private resetting = false
  private wordCelebrationEl: HTMLDivElement | null = null

  // Player velocity — sampled each frame for interceptor enemy AI.
  private readonly playerPrevPos = new THREE.Vector2(0, 0)
  private readonly playerVelocity = new THREE.Vector2(0, 0)

  // Word-completion shockwave ring.
  private shockwaveMesh: THREE.Mesh | null = null
  private shockwaveActive = false
  private shockwaveStartMs = 0
  private readonly shockwaveMaxRadius = 440
  private readonly shockwaveDurationMs = 720

  private running = false
  private lastMs = 0
  private readonly initialPlayerSize = 28
  private readonly cameraViewHeightWorld = 1380
  private readonly cameraFollowSpeed = 4.5

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

    const gridTex = createGridTexture(512, 64)
    const gridMat = new THREE.MeshStandardMaterial({ map: gridTex, roughness: 1, metalness: 0 })
    gridTex.repeat.set(8, 8)
    this.gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(this.mapSize, this.mapSize), gridMat)
    this.scene.add(this.gridPlane)

    this.player = new Player()
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
  }

  private recomputeBounds() {
    const half = this.mapSize / 2
    this.bounds = { minX: -half, maxX: half, minY: -half, maxY: half }
  }

  private setupInput() {
    this.renderer.domElement.addEventListener('pointermove', (ev: PointerEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointerNdc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
      )
    })

    window.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.code === 'Space') { ev.preventDefault(); void this.tryCompleteWord() }
      if (ev.code === 'KeyR') this.resetTray()
    })
  }

  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w <= 0 || h <= 0) return
    this.renderer.setSize(w, h, false)
    const aspect = w / h
    const halfY = this.cameraViewHeightWorld / 2
    const halfX = halfY * aspect
    this.camera.left = -halfX
    this.camera.right = halfX
    this.camera.top = halfY
    this.camera.bottom = -halfY
    this.camera.updateProjectionMatrix()
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

      // Cache DOM refs
      this.trayEl = document.getElementById('tray') as HTMLDivElement | null
      this.wordCelebrationEl = document.getElementById('wordCelebration') as HTMLDivElement | null

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
        bounds: this.bounds,
        letterRadius: 42,
        maxLetters: 300,
      })
      this.wordScrambler.initRandomFill(3)
      const starterWord = this.wordSource.getWordByLength(3)
      this.wordScrambler.spawnStarterWord(starterWord, new THREE.Vector2(0, 0))
      this.resetQuestState()
      this.updateQuestHud()

      this.score = 0
      this.hud.setScore(0)
      this.gameStartMs = performance.now()
      this.enemyGlobalRamp = 1

      this.setupEnemyPool()
      this.spawnInitialEnemies()
      this.fruitNextSpawnMs = performance.now() + 3500 + Math.random() * 2500
    } catch (err) {
      console.error('initGameAsync failed', err)
    }
  }

  private setupEnemyPool() {
    const poolSize = 28
    for (let i = 0; i < poolSize; i++) {
      const e = new Enemy()
      this.scene.add(e.mesh)
      e.setActive(false, new THREE.Vector2(0, 0), 10)
      this.enemyPool.push(e)
      this.enemySpeedScales.push(1.05 + Math.random() * 0.9)
      this.enemyLastHitMs.push(0)
    }
  }

  // Role distribution: weighted random (mostly chasers, some interceptors, pins).
  private pickEnemyRole(index: number): EnemyRole {
    const r = Math.random()
    // Slight bias by index so early enemies are simpler (closer spawn = chaser).
    if (index < 4 || r < 0.45) return 'chaser'
    if (r < 0.77) return 'interceptor'
    return 'pin'
  }

  private spawnInitialEnemies() {
    const count = 22
    const tmp = new THREE.Vector2()
    // Keep spawns outside this ring so the player can grab the starter word first.
    const minSpawnDist = 1180
    const maxSpawnDist = Math.min(2600, this.mapSize / 2 - 80)
    for (const e of this.enemyPool) e.setActive(false, tmp, 10)
    for (let i = 0; i < count; i++) {
      const r = 18 + Math.random() * 20
      const margin = r * 2
      let placed = false
      for (let attempt = 0; attempt < 55; attempt++) {
        const angle = Math.random() * Math.PI * 2
        const dist = minSpawnDist + Math.random() * (maxSpawnDist - minSpawnDist)
        tmp.set(Math.cos(angle) * dist, Math.sin(angle) * dist)
        if (
          tmp.x >= this.bounds.minX + margin &&
          tmp.x <= this.bounds.maxX - margin &&
          tmp.y >= this.bounds.minY + margin &&
          tmp.y <= this.bounds.maxY - margin
        ) {
          placed = true
          break
        }
      }
      if (!placed) {
        const angle = Math.random() * Math.PI * 2
        tmp.set(Math.cos(angle) * minSpawnDist, Math.sin(angle) * minSpawnDist)
        tmp.x = THREE.MathUtils.clamp(tmp.x, this.bounds.minX + margin, this.bounds.maxX - margin)
        tmp.y = THREE.MathUtils.clamp(tmp.y, this.bounds.minY + margin, this.bounds.maxY - margin)
      }
      this.enemyPool[i].setActive(true, tmp, r, this.pickEnemyRole(i))
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
    if (!this.resetting && this.gameStartMs > 0) {
      const t = (nowMs - this.gameStartMs) / 1000
      this.enemyGlobalRamp = Math.min(this.enemyRampMax, 1 + t * this.enemyRampPerSecond)
    }

    this.updateCamera(deltaSeconds)
    this.recomputePointerWorld()
    this.player.update(deltaSeconds, { pointerWorld: this.pointerWorld, bounds: this.bounds })

    // Sample player velocity for interceptor AI.
    const pp = this.player.mesh.position
    this.playerVelocity.set(
      (pp.x - this.playerPrevPos.x) / Math.max(0.001, deltaSeconds),
      (pp.y - this.playerPrevPos.y) / Math.max(0.001, deltaSeconds),
    )
    this.playerPrevPos.set(pp.x, pp.y)

    // Move HTML tray to follow player on screen
    this.updateTrayPosition()
    this.updateShockwave(nowMs)

    if (!this.wordScrambler || !this.hud || !this.wordSource || !this.wordValidator) return
    if (this.resetting) return

    this.handlePowerMode(nowMs)

    if (!this.wordCompletionInFlight) {
      this.handleLetterCollisions()
    }

    this.wordScrambler?.updateStarterLetters(nowMs)
    this.updateEnemies(deltaSeconds, nowMs)
    this.maybeSpawnFruit(nowMs)
    this.fruit.update(nowMs)
    this.handleFruitCollision(nowMs)
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(deltaSeconds: number) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    const halfY = this.cameraViewHeightWorld / 2
    const halfX = halfY * aspect

    const targetX = THREE.MathUtils.clamp(this.player.mesh.position.x, this.bounds.minX + halfX, this.bounds.maxX - halfX)
    const targetY = THREE.MathUtils.clamp(this.player.mesh.position.y, this.bounds.minY + halfY, this.bounds.maxY - halfY)

    const t = 1 - Math.exp(-this.cameraFollowSpeed * deltaSeconds)
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, t)
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, t)
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0)
  }

  private recomputePointerWorld() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.pointerHit)
    if (hit) this.pointerWorld.set(hit.x, hit.y)
  }

  // Project a world position to CSS screen coords
  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    this._projVec.set(wx, wy, 0)
    this._projVec.project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: (this._projVec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-this._projVec.y * 0.5 + 0.5) * rect.height + rect.top,
    }
  }

  // ── HTML tray (follows player) ────────────────────────────────────────────

  private updateTrayPosition() {
    if (!this.trayEl) return
    const { x, y } = this.worldToScreen(
      this.player.mesh.position.x,
      this.player.mesh.position.y - this.player.getRadius() * 2.0,
    )
    this.trayEl.style.left = `${x}px`
    this.trayEl.style.top = `${y}px`
  }

  private updateTrayContent() {
    if (!this.trayEl) return
    this.trayEl.innerHTML = ''
    for (const ch of this.tray) {
      const span = document.createElement('span')
      span.className = `tray-letter ${isVowelLetter(ch) ? 'tray-vowel' : 'tray-consonant'}`
      span.textContent = ch.toUpperCase()
      this.trayEl.appendChild(span)
    }
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
    const playerPos = this.player.mesh.position
    const playerRadius = this.player.getRadius()
    let changed = false
    for (const letter of this.wordScrambler.getActiveLetters()) {
      const dx = playerPos.x - letter.sprite.position.x
      const dy = playerPos.y - letter.sprite.position.y
      const r = playerRadius + letter.radius
      if (dx * dx + dy * dy <= r * r) {
        this.tray.push(letter.char)
        letter.setActive(false)
        this.wordScrambler.spawnReplacementLetter()
        changed = true
      }
    }
    if (changed) {
      this.updateTrayContent()
      this.updateQuestHud()
    }
  }

  // ── Word completion ───────────────────────────────────────────────────────

  private async tryCompleteWord() {
    if (!this.wordValidator || this.wordCompletionInFlight || !this.tray.length) return
    if (this.tray.length !== this.currentQuestLength) return
    const joined = this.tray.join('').toLowerCase()
    if (!this.wordValidator.isValidMultiset(joined)) return
    await this.completeWord(joined)
  }

  private getQuestMultiplier(): number {
    if (this.questRandomMode) return 2.5
    return 1.2 + this.questScheduleIndex * 0.35
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
      const questMult = this.getQuestMultiplier()
      const letters = word.toLowerCase().split('')

      const perLetterPoints = letters.map((ch) => getLetterScore(ch))
      const basePoints = perLetterPoints.reduce((a, b) => a + b, 0)

      let pts = Math.round(basePoints * questMult)
      let grow = pts * 0.006

      const wodWord = this.currentWordOfDay
      const isWordOfDay =
        wodWord.length > 0 && anagramSignature(word) === anagramSignature(wodWord)

      if (isWordOfDay) {
        // Massive bonus for the daily target.
        pts = Math.round(pts * 8 + 600)
        grow = grow * 1.25 + 8
        this.player.setWordOfDayGlow(true, performance.now())
      }

      this.player.setSize(this.player.getRadius() + grow)
      this.score += pts
      this.hud?.setScore(this.score)
      this.triggerWordShockwave(performance.now())
      this.advanceQuestAfterCompletion()
      this.updateQuestHud()
      playWordCelebration(this.wordCelebrationEl, {
        letters,
        pointsPerLetter: Math.max(1, Math.round(pts / Math.max(1, letters.length))),
        perLetterPoints,
        totalPoints: pts,
        questComplete: true,
        wordOfDayComplete: isWordOfDay,
      })

      this.tray = []
      this.updateTrayContent()
    } finally {
      this.wordCompletionInFlight = false
    }
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  private updateEnemies(deltaSeconds: number, nowMs: number) {
    const tmpOff = new THREE.Vector2()
    const tmpPP = new THREE.Vector2()

    for (let i = 0; i < this.enemyPool.length; i++) {
      const enemy = this.enemyPool[i]
      if (!enemy.isActive()) continue

      const pp = this.player.mesh.position
      const pr = this.player.getRadius()
      tmpPP.set(pp.x, pp.y)

      const dx = pp.x - enemy.mesh.position.x
      const dy = pp.y - enemy.mesh.position.y
      const dSq = dx * dx + dy * dy
      const chaseR = 1100
      const speedScale = this.enemySpeedScales[i] * this.enemyGlobalRamp
      enemy.update(deltaSeconds, tmpPP, this.playerVelocity, this.bounds, speedScale, dSq <= chaseR * chaseR, nowMs, this.powerModeActive)

      const r = pr + enemy.getRadius()
      if (dSq > r * r * 0.92) continue
      if (nowMs - this.enemyLastHitMs[i] < this.enemyCollisionCooldownMs) continue
      this.enemyLastHitMs[i] = nowMs

      if (this.powerModeActive) {
        this.enemySpeedScales[i] = 1.05 + Math.random() * 0.9
        enemy.setActive(false, tmpOff, 10)
      } else {
        // Outside power mode enemies always deal damage — size doesn't help.
        this.player.setSize(pr - enemy.getRadius() * 0.22)
        if (this.player.getRadius() <= 10) { this.requestReset(); return }
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

  // ── Reset on death ────────────────────────────────────────────────────────

  private requestReset() {
    if (this.resetting) return
    this.resetting = true
    this.powerModeActive = false
    this.hud?.setPowerMode(false)

    playResetCelebration(
      this.wordCelebrationEl,
      'OUCH! RESET!',
      `Quest target: ${this.currentQuestLength}-letter word. Spell to grow.`,
    )
    this.tray = []
    this.updateTrayContent()
    this.player.setSize(this.initialPlayerSize)
    this.player.mesh.position.set(0, 0, 1)

    const tmp = new THREE.Vector2(0, 0)
    for (const e of this.enemyPool) e.setActive(false, tmp, 10)
    this.fruit.setActive(false, tmp, 22)
    if (this.shockwaveMesh) { this.shockwaveMesh.visible = false; this.shockwaveActive = false }

    this.score = 0
    this.hud?.setScore(0)
    this.resetQuestState()
    this.updateQuestHud()
    this.gameStartMs = performance.now()
    this.enemyGlobalRamp = 1
    this.spawnInitialEnemies()
    this.fruitNextSpawnMs = performance.now() + 3000
    this.resetting = false
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────

  private updateQuestHud() {
    if (!this.hud) return
    this.hud.setQuestMultiplier(this.getQuestMultiplier())

    // Word of the day is length-specific so the bonus is always achievable.
    this.currentWordOfDay = this.wordOfDayByLength[this.currentQuestLength] ?? ''
    if (this.currentWordOfDay) this.hud.setWordOfDay(this.currentWordOfDay)

    this.hud.setQuestPanel({
      targetLength: this.currentQuestLength,
      subtitle: `Spell a valid ${this.currentQuestLength}-letter word. Press Space to submit.`,
    })
  }

  // ── Word shockwave ────────────────────────────────────────────────────────

  private triggerWordShockwave(nowMs: number): void {
    if (!this.shockwaveMesh) return
    this.shockwaveMesh.position.set(this.player.mesh.position.x, this.player.mesh.position.y, 2)
    this.shockwaveMesh.scale.setScalar(1)
    this.shockwaveMesh.visible = true
    this.shockwaveActive = true
    this.shockwaveStartMs = nowMs
    // Brief slow on all active enemies — reward for spelling under pressure.
    for (const e of this.enemyPool) {
      if (e.isActive()) e.applySlowFor(1600, nowMs)
    }
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
    const r = 22
    const pos = new THREE.Vector2(
      THREE.MathUtils.lerp(this.bounds.minX + r, this.bounds.maxX - r, Math.random()),
      THREE.MathUtils.lerp(this.bounds.minY + r, this.bounds.maxY - r, Math.random()),
    )
    this.fruit.setActive(true, pos, r)
    this.fruitNextSpawnMs = nowMs + 14000 + Math.random() * 9000
  }

  private handleFruitCollision(nowMs: number) {
    if (!this.fruit.isActive()) return
    const pp = this.player.mesh.position
    const fp = this.fruit.mesh.position
    const dx = pp.x - fp.x
    const dy = pp.y - fp.y
    const r = this.player.getRadius() + this.fruit.getRadius()
    if (dx * dx + dy * dy > r * r * 0.92) return

    this.fruit.setActive(false, new THREE.Vector2(0, 0), 22)
    const dur = 10000
    this.powerModeActive = true
    this.powerModeUntilMs = nowMs + dur
    this.hud?.setPowerMode(true, dur)
    for (const e of this.enemyPool) if (e.isActive()) e.setPowerMode(true)
  }

}
