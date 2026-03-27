import * as THREE from 'three'
import { Player } from './entities/Player'
import { Enemy } from './entities/Enemy'
import { Fruit } from './entities/Fruit'
import { WordScrambler } from './WordScrambler'
import { WordSource } from './WordSource'
import { WordPartitioner } from './WordPartitioner'
import { SnakeTrail } from './SnakeTrail'
import { Letter } from './entities/Letter'
import { isVowelLetter } from './LetterScoring'
import { Hud } from '../ui/hud'
import { playInfoCelebration, playResetCelebration, playWordSequenceCelebration } from '../ui/wordCelebration'

export type GameOptions = { container: HTMLElement }

const LAST_RUN_SCORE_STORAGE_KEY = 'pacmanscrabble_last_run_score_v1'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type ThemeMode = 'dark' | 'light'
type ViewportProfile = {
  cameraViewHeightWorld: number
  playerSize: number
  letterRadius: number
  starterScale: number
  starterSpacing: number
  /** Active enemies at game start (more spawn over time up to enemyMaxCount). */
  enemyStartCount: number
  enemyMaxCount: number
  enemyBaseRadiusScale: number
  enemyMinSpawnDist: number
  enemyMaxSpawnDist: number
}

function createGridTexture(gridSizePx = 512, lineEveryPx = 64, themeMode: ThemeMode): THREE.Texture {
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

  ctx.strokeStyle = themeMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(27,31,48,0.06)'
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

  /** World span (smaller arena = more pressure + shorter chases). */
  private readonly mapSize = 3600
  private bounds: Bounds = { minX: -1800, maxX: 1800, minY: -1800, maxY: 1800 }

  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2(0, 0)
  private readonly pointerWorld = new THREE.Vector2(0, 0)
  private readonly pointerHit = new THREE.Vector3()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private readonly _projVec = new THREE.Vector3()

  private hud: Hud | null = null
  private wordSource: WordSource | null = null
  private wordScrambler: WordScrambler | null = null
  private wordPartitioner: WordPartitioner | null = null
  private playerSnakeTrail: SnakeTrail | null = null
  private playerBodyLetters: Letter[] = []
  /** Slither-style rings under letter sprites (same segment indices). */
  private playerBodyRings: THREE.Mesh[] = []
  private readonly bodyRingPoolSize = 56

  private gameStartMs = 0
  /** Patrol speed multiplier — ramps from min→max over the run. */
  private enemyGlobalRamp = 1
  private readonly enemyRampMin = 0.72
  private readonly enemyRampMax = 2.65
  private readonly enemyRampPerSecond = 0.0145
  /** Ms between spawning one extra enemy until enemyMaxCount. */
  private enemyNextSpawnMs = 0
  private readonly enemySpawnIntervalMs = 13500

  // HTML tray element — positioned to follow player via world→screen projection
  private trayEl: HTMLDivElement | null = null
  private tray: string[] = []

  private wordCompletionInFlight = false

  private enemyPool: Enemy[] = []
  private enemySpeedScales: number[] = []
  private enemyLastHitMs: number[] = []
  private readonly enemyCollisionCooldownMs = 450
  private playerSpillImmuneUntilMs = 0

  private fruit: Fruit
  private fruitNextSpawnMs = 0

  // (Tips removed for now)

  private score = 0
  private playerBoostHeld = false
  /** 0..1 — refills slowly, drains fast while boosting (Shift). */
  private boostEnergy = 1
  private readonly boostFillPerSecond = 0.11
  private readonly boostDrainPerSecond = 0.88
  /** Single small rectangle below spawn (0,0); entering with your head auto-submits words. */
  private readonly submitZone: { minX: number; maxX: number; minY: number; maxY: number } = {
    minX: -52,
    maxX: 52,
    minY: -340,
    maxY: -268,
  }

  /** Patrol enemies avoid this padded box around the submit gate (world units). */
  private submitGateAvoidBounds(): Bounds {
    const pad = 260
    const z = this.submitZone
    return {
      minX: z.minX - pad,
      maxX: z.maxX + pad,
      minY: z.minY - pad,
      maxY: z.maxY + pad,
    }
  }

  private static pointInRect(x: number, y: number, r: Bounds): boolean {
    return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY
  }
  private submitZoneMaterial: THREE.MeshBasicMaterial | null = null
  /** Canvas texture for the submit gate (redrawn each frame for animation). */
  private submitGateCanvas: HTMLCanvasElement | null = null
  private submitGateCtx: CanvasRenderingContext2D | null = null
  private submitGateTexture: THREE.CanvasTexture | null = null
  /** Throttle expensive canvas redraws (full redraw every frame was tanking FPS). */
  private submitGateTexLastDrawMs = 0
  private submitGateLastInside: boolean | null = null
  private readonly submitGateRedrawMinMs = 110
  /** Previous frame: head inside zone (for edge-triggered auto submit). */
  private submitZoneWasInside = false

  private powerModeUntilMs = 0
  private powerModeActive = false

  private resetting = false
  private paused = false
  private pauseStartedMs = 0
  private wordCelebrationEl: HTMLDivElement | null = null


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
  private readonly cameraFollowSpeed = 5.2
  private viewportProfile: ViewportProfile = this.computeViewportProfile()

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
    const gridTex = createGridTexture(512, 64, themeMode)
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
    const updatePointer = (clientX: number, clientY: number) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointerNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
    }

    this.renderer.domElement.addEventListener('pointermove', (ev: PointerEvent) => {
      updatePointer(ev.clientX, ev.clientY)
    })
    window.addEventListener('pointermove', (ev: PointerEvent) => {
      if (!this.isPortraitMode()) return
      updatePointer(ev.clientX, ev.clientY)
    }, { passive: true })

    window.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.code === 'KeyR') this.resetTray()
      if (ev.code === 'KeyP') this.togglePause()
      if (ev.code === 'KeyH') this.hardResetGame()
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
        ev.preventDefault()
        this.playerBoostHeld = true
      }
    })
    window.addEventListener('keyup', (ev: KeyboardEvent) => {
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
        this.playerBoostHeld = false
      }
    })
  }

  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w <= 0 || h <= 0) return
    this.viewportProfile = this.computeViewportProfile()
    this.cameraViewHeightWorld = this.viewportProfile.cameraViewHeightWorld
    this.renderer.setSize(w, h, false)
    const aspect = w / h
    const halfY = this.cameraViewHeightWorld / 2
    const halfX = halfY * aspect
    this.camera.left = -halfX
    this.camera.right = halfX
    this.camera.top = halfY
    this.camera.bottom = -halfY
    this.camera.updateProjectionMatrix()
    this.applyViewportProfileRuntime()
    this.refreshHudScore()
  }

  private isPortraitMode(): boolean {
    const forced = document.documentElement.dataset.orientation
    if (forced === 'portrait') return true
    if (forced === 'landscape') return false
    return this.container.clientHeight > this.container.clientWidth
  }

  private computeViewportProfile(): ViewportProfile {
    const portrait = this.isPortraitMode()
    if (!portrait) {
      return {
        cameraViewHeightWorld: 1280,
        playerSize: 28,
        letterRadius: 54,
        starterScale: 58,
        starterSpacing: 92,
        enemyStartCount: 8,
        enemyMaxCount: 18,
        enemyBaseRadiusScale: 1,
        enemyMinSpawnDist: Math.round(this.mapSize * 0.2),
        enemyMaxSpawnDist: Math.min(1580, this.mapSize / 2 - 100),
      }
    }
    return {
      cameraViewHeightWorld: 1500,
      playerSize: 34,
      letterRadius: 70,
      starterScale: 72,
      starterSpacing: 104,
      enemyStartCount: 6,
      enemyMaxCount: 15,
      enemyBaseRadiusScale: 0.92,
      enemyMinSpawnDist: Math.round(this.mapSize * 0.22),
      enemyMaxSpawnDist: Math.min(1520, this.mapSize / 2 - 100),
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
      this.hud.setPauseButtonState(false)

      // Cache DOM refs
      this.trayEl = document.getElementById('tray') as HTMLDivElement | null
      if (this.trayEl) this.trayEl.style.display = 'none'
      this.wordCelebrationEl = document.getElementById('wordCelebration') as HTMLDivElement | null

      this.wordSource = new WordSource({ topWordCount: 1000 })
      this.wordPartitioner = new WordPartitioner()
      this.hud.setPowerMode(false)

      this.playerSnakeTrail = new SnakeTrail(this.viewportProfile.letterRadius * 0.82)
      this.setupPlayerBodyRings()
      this.setupSubmitZones()
      this.wordScrambler = new WordScrambler({
        scene: this.scene,
        bounds: this.bounds,
        letterRadius: this.viewportProfile.letterRadius,
        maxLetters: 240,
        starterScale: this.viewportProfile.starterScale,
        starterSpacing: this.viewportProfile.starterSpacing,
        themeMode: 'dark',
      })
      this.wordScrambler.initRandomFill(0)

      this.setupEnemyPool()
      this.score = 0
      this.boostEnergy = 1
      this.hud.setScore(0)
      this.hud.setBoostFill(1)
      this.hud.setLastRunDisplay(Game.loadLastRunScore())
      this.resetSubmitZones()
      const start = performance.now()
      this.gameStartMs = start
      this.enemyGlobalRamp = this.enemyRampMin
      this.enemyNextSpawnMs = start + this.enemySpawnIntervalMs

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
      this.enemySpeedScales.push(1.22 + Math.random() * 0.95)
      this.enemyLastHitMs.push(0)
    }
  }

  private setupPlayerBodyRings(): void {
    const geo = new THREE.CircleGeometry(1, 14)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a66cc,
      emissive: new THREE.Color(0x1144aa),
      emissiveIntensity: 0.35,
      metalness: 0.08,
      roughness: 0.45,
    })
    for (let i = 0; i < this.bodyRingPoolSize; i++) {
      const m = new THREE.Mesh(geo, mat)
      m.visible = false
      m.position.z = 0.45
      m.renderOrder = -2
      this.scene.add(m)
      this.playerBodyRings.push(m)
    }
  }

  private static drawSubmitGateRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rw: number,
    rh: number,
    r: number
  ): void {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + rw, y, x + rw, y + rh, r)
    ctx.arcTo(x + rw, y + rh, x, y + rh, r)
    ctx.arcTo(x, y + rh, x, y, r)
    ctx.arcTo(x, y, x + rw, y, r)
    ctx.closePath()
  }

  private ensureSubmitGateCanvas(): void {
    if (this.submitGateCanvas) return
    const cw = 256
    const ch = Math.round((cw * (this.submitZone.maxY - this.submitZone.minY)) / (this.submitZone.maxX - this.submitZone.minX))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = Math.max(120, ch)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d')
    this.submitGateCanvas = canvas
    this.submitGateCtx = ctx
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    this.submitGateTexture = tex
  }

  /**
   * Rainbow submit gate — kept cheap: no canvas shadowBlur (was killing FPS), few strokes,
   * small texture (256px wide). Paired with throttled redraw in refreshSubmitZoneMesh.
   */
  private drawSubmitGateTexture(nowMs: number, playerInside: boolean): void {
    this.ensureSubmitGateCanvas()
    const ctx = this.submitGateCtx!
    const canvas = this.submitGateCanvas!
    const w = canvas.width
    const h = canvas.height
    const pad = 8
    const cornerR = 16
    const rw = w - pad * 2
    const rh = h - pad * 2
    const x0 = pad
    const y0 = pad
    const t = nowMs * 0.001
    const hueSpin = (nowMs * 0.0028) % 360
    const pulse = 0.5 + 0.5 * Math.sin(t * 4)

    ctx.clearRect(0, 0, w, h)

    // Few rainbow rings — stroke only, never shadowBlur (very expensive on 2D canvas).
    const layers = 4
    for (let i = layers; i >= 0; i--) {
      const o = i * 4
      const hue = (hueSpin + i * 38) % 360
      const alpha = 0.35 + (i / layers) * 0.45 + (playerInside ? 0.1 : 0)
      ctx.save()
      Game.drawSubmitGateRoundedRect(ctx, x0 - o, y0 - o, rw + o * 2, rh + o * 2, cornerR + o * 0.4)
      ctx.strokeStyle = `hsla(${hue}, 100%, 58%, ${alpha * (0.8 + pulse * 0.2)})`
      ctx.lineWidth = 2 + i * 0.5
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    Game.drawSubmitGateRoundedRect(ctx, x0, y0, rw, rh, cornerR)
    ctx.fillStyle = 'rgba(8, 4, 18, 0.96)'
    ctx.fill()
    ctx.restore()

    ctx.save()
    Game.drawSubmitGateRoundedRect(ctx, x0 + 2, y0 + 2, rw - 4, rh - 4, Math.max(6, cornerR - 3))
    ctx.clip()

    const cx = x0 + rw * 0.5
    const cy = y0 + rh * 0.45
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rw, rh) * 0.9)
    rg.addColorStop(0, playerInside ? 'rgba(255, 60, 200, 0.28)' : 'rgba(80, 120, 255, 0.08)')
    rg.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
    ctx.fillStyle = rg
    ctx.fillRect(x0, y0, rw, rh)

    const wash = ctx.createLinearGradient(x0, y0, x0 + rw, y0 + rh)
    for (let s = 0; s <= 6; s++) {
      const hueW = (hueSpin + s * 50) % 360
      wash.addColorStop(s / 6, `hsla(${hueW}, 90%, 52%, ${0.05 + (playerInside ? 0.1 : 0)})`)
    }
    ctx.fillStyle = wash
    ctx.globalCompositeOperation = 'screen'
    ctx.fillRect(x0, y0, rw, rh)
    ctx.globalCompositeOperation = 'source-over'

    ctx.restore()

    for (let ring = 0; ring < 2; ring++) {
      const inset = 4 + ring * 2
      const hue = (hueSpin + ring * 70 + 140) % 360
      Game.drawSubmitGateRoundedRect(ctx, x0 + inset, y0 + inset, rw - inset * 2, rh - inset * 2, Math.max(5, cornerR - inset))
      ctx.strokeStyle = `hsla(${hue}, 100%, 62%, ${0.55 - ring * 0.12})`
      ctx.lineWidth = 1.8 - ring * 0.35
      ctx.stroke()
    }

    const seed = Math.floor(nowMs / 120)
    for (let k = 0; k < 8; k++) {
      const sx = x0 + ((Math.sin(seed * 0.1 + k * 3.7) * 0.5 + 0.5) * rw * 0.85 + rw * 0.075)
      const sy = y0 + ((Math.cos(seed * 0.13 + k * 2.9) * 0.5 + 0.5) * rh * 0.85 + rh * 0.075)
      const hue = (hueSpin + k * 41) % 360
      ctx.beginPath()
      ctx.arc(sx, sy, 1.2 + (k % 2) * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${hue}, 100%, 68%, ${0.4 + pulse * 0.3})`
      ctx.fill()
    }

    const titleSize = Math.max(13, Math.floor(h * 0.19))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tx = w * 0.5
    const tyTitle = h * 0.4
    ctx.font = `900 ${titleSize}px system-ui, "Segoe UI", sans-serif`
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
    ctx.strokeText('SUBMIT', tx, tyTitle)
    const tg = ctx.createLinearGradient(tx - w * 0.45, tyTitle - titleSize, tx + w * 0.45, tyTitle + titleSize)
    for (let i = 0; i <= 5; i++) {
      tg.addColorStop(i / 5, `hsl(${((hueSpin + i * 58) % 360)}, 100%, 62%)`)
    }
    ctx.fillStyle = tg
    ctx.fillText('SUBMIT', tx, tyTitle)

    const subSize = Math.max(8, Math.floor(h * 0.078))
    ctx.font = `800 ${subSize}px system-ui, "Segoe UI", sans-serif`
    const tySub = h * 0.6
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.strokeText('AUTO SCORE ZONE', tx, tySub)
    const sg2 = ctx.createLinearGradient(tx - w * 0.4, tySub - subSize, tx + w * 0.4, tySub + subSize)
    for (let i = 0; i <= 4; i++) {
      sg2.addColorStop(i / 4, `hsl(${((hueSpin + 100 + i * 60) % 360)}, 92%, 76%)`)
    }
    ctx.fillStyle = sg2
    ctx.fillText('AUTO SCORE ZONE', tx, tySub)

    this.submitGateTexture!.needsUpdate = true
  }

  private setupSubmitZones(): void {
    const z = this.submitZone
    const w = z.maxX - z.minX
    const h = z.maxY - z.minY
    const geo = new THREE.PlaneGeometry(w, h)
    this.ensureSubmitGateCanvas()
    this.drawSubmitGateTexture(0, false)
    const map = this.submitGateTexture!
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: true,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set((z.minX + z.maxX) * 0.5, (z.minY + z.maxY) * 0.5, 0.52)
    mesh.renderOrder = 4
    this.scene.add(mesh)
    this.submitZoneMaterial = mat
  }

  private resetSubmitZones(): void {
    this.submitZoneWasInside = false
    this.submitGateLastInside = null
    this.submitGateTexLastDrawMs = 0
    this.hud?.setSubmitZoneInside(false)
    this.refreshSubmitZoneMesh(performance.now(), false)
  }

  /** Circle (player head) overlaps axis-aligned rectangle. */
  private static circleIntersectsRect(cx: number, cy: number, r: number, rect: { minX: number; maxX: number; minY: number; maxY: number }): boolean {
    const nx = THREE.MathUtils.clamp(cx, rect.minX, rect.maxX)
    const ny = THREE.MathUtils.clamp(cy, rect.minY, rect.maxY)
    const dx = cx - nx
    const dy = cy - ny
    return dx * dx + dy * dy <= r * r
  }

  private updateSubmitZones(nowMs: number): void {
    const px = this.player.mesh.position.x
    const py = this.player.mesh.position.y
    const pr = this.player.getRadius()
    const inside = Game.circleIntersectsRect(px, py, pr, this.submitZone)
    this.hud?.setSubmitZoneInside(inside)

    if (
      inside &&
      !this.submitZoneWasInside &&
      !this.wordCompletionInFlight &&
      !this.paused &&
      this.tray.length > 0
    ) {
      void this.tryAutoSubmitFromZone()
    }
    this.submitZoneWasInside = inside
    this.refreshSubmitZoneMesh(nowMs, inside)
  }

  private refreshSubmitZoneMesh(nowMs: number, playerInside: boolean): void {
    const mat = this.submitZoneMaterial
    if (!mat) return
    const insideChanged = this.submitGateLastInside !== playerInside
    const due = nowMs - this.submitGateTexLastDrawMs >= this.submitGateRedrawMinMs
    if (insideChanged || due) {
      this.drawSubmitGateTexture(nowMs, playerInside)
      this.submitGateTexLastDrawMs = nowMs
      this.submitGateLastInside = playerInside
    }
    const pulse = 0.035 * Math.sin(nowMs * 0.0038)
    mat.opacity = playerInside
      ? THREE.MathUtils.clamp(0.97 + pulse, 0.9, 1)
      : THREE.MathUtils.clamp(0.86 + pulse * 0.55, 0.78, 0.94)
  }

  private placeEnemySpawnPosition(out: THREE.Vector2, baseRadius: number): void {
    const minSpawnDist = this.viewportProfile.enemyMinSpawnDist
    const maxSpawnDist = this.viewportProfile.enemyMaxSpawnDist
    const margin = baseRadius * 2
    const avoid = this.submitGateAvoidBounds()
    for (let attempt = 0; attempt < 70; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const dist = minSpawnDist + Math.random() * (maxSpawnDist - minSpawnDist)
      out.set(Math.cos(angle) * dist, Math.sin(angle) * dist)
      if (
        out.x >= this.bounds.minX + margin &&
        out.x <= this.bounds.maxX - margin &&
        out.y >= this.bounds.minY + margin &&
        out.y <= this.bounds.maxY - margin &&
        !Game.pointInRect(out.x, out.y, avoid)
      ) {
        return
      }
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      out.set(
        THREE.MathUtils.lerp(this.bounds.minX + margin, this.bounds.maxX - margin, Math.random()),
        THREE.MathUtils.lerp(this.bounds.minY + margin, this.bounds.maxY - margin, Math.random()),
      )
      if (!Game.pointInRect(out.x, out.y, avoid)) {
        return
      }
    }
    out.set(this.bounds.minX + margin + 80, this.bounds.maxY - margin - 80)
  }

  private spawnEnemyAtIndex(i: number): void {
    const r = (18 + Math.random() * 20) * this.viewportProfile.enemyBaseRadiusScale
    const tmp = new THREE.Vector2()
    this.placeEnemySpawnPosition(tmp, r)
    const enemy = this.enemyPool[i]
    enemy.setActive(true, tmp, r)
    enemy.setPatrolBounds(this.bounds, this.submitGateAvoidBounds())
  }

  private spawnInitialEnemies() {
    const tmp = new THREE.Vector2()
    for (const e of this.enemyPool) e.setActive(false, tmp, 10)
    const start = this.viewportProfile.enemyStartCount
    for (let i = 0; i < start; i++) {
      this.spawnEnemyAtIndex(i)
    }
  }

  /** Every interval, add one enemy until we reach enemyMaxCount. */
  private maybeSpawnExtraEnemy(nowMs: number): void {
    if (nowMs < this.enemyNextSpawnMs) return
    const max = this.viewportProfile.enemyMaxCount
    let active = 0
    for (const e of this.enemyPool) {
      if (e.isActive()) active++
    }
    if (active >= max) return
    for (let i = 0; i < this.enemyPool.length; i++) {
      if (!this.enemyPool[i].isActive()) {
        this.spawnEnemyAtIndex(i)
        this.enemyNextSpawnMs = nowMs + this.enemySpawnIntervalMs
        return
      }
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
    if (!this.resetting && this.gameStartMs > 0) {
      const t = (nowMs - this.gameStartMs) / 1000
      this.enemyGlobalRamp = Math.min(
        this.enemyRampMax,
        this.enemyRampMin + t * this.enemyRampPerSecond,
      )
    }

    this.updateCamera(deltaSeconds)
    this.recomputePointerWorld()
    const speedMult = this.applyPlayerBoost(deltaSeconds)
    this.player.update(deltaSeconds, {
      pointerWorld: this.pointerWorld,
      bounds: this.bounds,
      speedMultiplier: speedMult,
    })

    this.updateTrayPosition()
    this.updateShockwave(nowMs)

    if (!this.wordScrambler || !this.hud || !this.wordSource || !this.wordPartitioner) return
    if (this.resetting) return

    this.handlePowerMode(nowMs)

    if (!this.wordCompletionInFlight) {
      this.handleLetterCollisions()
    }
    this.wordScrambler?.updateStarterLetters(nowMs)
    this.updateSubmitZones(nowMs)
    this.maybeSpawnExtraEnemy(nowMs)
    this.updateEnemies(deltaSeconds, nowMs)
    this.syncPlayerSnakeTrail()
    this.checkSnakeInteractions(nowMs)
    this.maybeSpawnFruit(nowMs)
    this.fruit.update(nowMs)
    this.handleFruitCollision(nowMs)
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(deltaSeconds: number) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    // Slither.io–style: pull back slightly as your tail grows so you see more of the arena.
    const tailZoom = 1 + Math.min(0.4, this.tray.length * 0.013)
    const halfY = (this.cameraViewHeightWorld * tailZoom) / 2
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
    for (const letter of this.wordScrambler.getPickupLetters()) {
      const dx = playerPos.x - letter.sprite.position.x
      const dy = playerPos.y - letter.sprite.position.y
      const r = playerRadius + letter.radius * 0.82
      if (dx * dx + dy * dy <= r * r * 0.85) {
        this.tray.push(letter.char)
        this.wordScrambler.spawnReplacementLetter()
        this.wordScrambler.promoteFieldLetterToBody(letter)
        this.playerBodyLetters.push(letter)
        changed = true
      }
    }
    if (changed) {
      this.updateTrayContent()
    }
  }

  private applyPlayerBoost(deltaSeconds: number): number {
    if (!this.hud) return 1
    if (this.playerBoostHeld && this.boostEnergy > 0) {
      this.boostEnergy = Math.max(0, this.boostEnergy - this.boostDrainPerSecond * deltaSeconds)
      this.hud.setBoostFill(this.boostEnergy)
      return 1.72
    }
    this.boostEnergy = Math.min(1, this.boostEnergy + this.boostFillPerSecond * deltaSeconds)
    this.hud.setBoostFill(this.boostEnergy)
    return 1
  }

  private refreshHudScore(): void {
    this.hud?.setScore(this.score)
  }

  private static loadLastRunScore(): number {
    try {
      const v = localStorage.getItem(LAST_RUN_SCORE_STORAGE_KEY)
      if (v == null) return 0
      const n = parseInt(v, 10)
      return Number.isFinite(n) ? Math.max(0, n) : 0
    } catch {
      return 0
    }
  }

  private static saveLastRunScore(score: number): void {
    try {
      localStorage.setItem(LAST_RUN_SCORE_STORAGE_KEY, String(Math.round(score)))
    } catch {
      /* ignore */
    }
  }

  private static runEndedSubtitle(finalScore: number, prevRun: number): string {
    if (prevRun <= 0 && finalScore <= 0) {
      return 'Collect letters and submit in the rainbow zone to score.'
    }
    if (prevRun <= 0) {
      return `This run: ${finalScore.toLocaleString()} — nothing to compare yet (first recorded run).`
    }
    const delta = finalScore - prevRun
    if (delta > 0) {
      return `This run: ${finalScore.toLocaleString()} — up from ${prevRun.toLocaleString()} (+${delta.toLocaleString()}).`
    }
    if (delta < 0) {
      return `This run: ${finalScore.toLocaleString()} — last run was ${prevRun.toLocaleString()} (${delta.toLocaleString()}).`
    }
    return `This run: ${finalScore.toLocaleString()} — tied last run (${prevRun.toLocaleString()}).`
  }

  private syncPlayerSnakeTrail(): void {
    if (!this.playerSnakeTrail) return
    const head = new THREE.Vector2(this.player.mesh.position.x, this.player.mesh.position.y)
    this.playerSnakeTrail.pushHead(head)
    for (let i = 0; i < this.playerBodyLetters.length; i++) {
      const p = this.playerSnakeTrail.getSegmentPosition(i, head)
      this.playerBodyLetters[i].sprite.position.set(p.x, p.y, 1)
      if (i < this.playerBodyRings.length) {
        const ring = this.playerBodyRings[i]
        ring.visible = true
        ring.position.set(p.x, p.y, 0.45)
        const r = this.playerBodyLetters[i].radius * 0.94
        ring.scale.setScalar(r)
      }
    }
    for (let i = this.playerBodyLetters.length; i < this.playerBodyRings.length; i++) {
      this.playerBodyRings[i].visible = false
    }
  }

  /** Enemy head touches player tail (or body): full game reset for the player. */
  private checkSnakeInteractions(nowMs: number): void {
    if (this.wordCompletionInFlight || !this.wordScrambler) return
    if (nowMs < this.playerSpillImmuneUntilMs) return

    for (let i = 0; i < this.enemyPool.length; i++) {
      const enemy = this.enemyPool[i]
      if (!enemy.isActive()) continue
      const ep = enemy.mesh.position
      const er = enemy.getRadius() * 0.9
      for (let j = 0; j < this.playerBodyLetters.length; j++) {
        const seg = this.playerBodyLetters[j].sprite.position
        const dx = ep.x - seg.x
        const dy = ep.y - seg.y
        const rr = er + this.playerBodyLetters[j].radius * 0.72
        if (dx * dx + dy * dy <= rr * rr) {
          this.playerSpillImmuneUntilMs = nowMs + 950
          this.requestReset()
          return
        }
      }
    }
  }

  // ── Word completion ───────────────────────────────────────────────────────

  private async tryAutoSubmitFromZone(): Promise<void> {
    if (!this.wordPartitioner || this.wordCompletionInFlight || !this.tray.length) return
    if (this.paused) return
    const partition = this.wordPartitioner.greedyPartition(this.tray)
    if (partition.words.length === 0) {
      playInfoCelebration(this.wordCelebrationEl, 'NO WORDS', 'Nothing spellable from these letters.', 1500)
      return
    }
    await this.completePartition(partition)
  }

  /** Longer tail at submit time → much larger score multiplier (risk vs reward). */
  private tailLengthMultiplier(tailLen: number): number {
    if (tailLen <= 0) return 1
    const a = 0.016
    const p = 1.82
    return Math.min(180, 1 + a * tailLen ** p)
  }

  private partitionPoints(
    partition: { words: { word: string; points: number }[]; totalPoints: number },
    tailLen: number,
  ): number {
    const base = Math.round(partition.totalPoints)
    return Math.round(base * this.tailLengthMultiplier(tailLen))
  }

  private async completePartition(partition: { words: { word: string; points: number }[]; totalPoints: number }) {
    if (!this.wordScrambler || !this.hud || this.wordCompletionInFlight) return
    this.wordCompletionInFlight = true
    try {
      const tailLen = this.tray.length

      const pts = this.partitionPoints(partition, tailLen)

      this.tray = []
      for (const L of this.playerBodyLetters) this.wordScrambler.releaseBodyLetter(L)
      this.playerBodyLetters = []
      this.playerSnakeTrail?.reset()
      for (const r of this.playerBodyRings) r.visible = false
      this.player.setSize(this.initialPlayerSize)

      this.score += pts
      this.refreshHudScore()
      this.triggerWordShockwave(performance.now())

      const pops = partition.words.map((w) => ({
        word: w.word,
        points: Math.round(w.points),
      }))
      playWordSequenceCelebration(this.wordCelebrationEl, pops, {
        staggerMs: 92,
        totalLabel: `TOTAL +${pts.toLocaleString()}`,
      })
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

      const bx = enemy.mesh.position.x
      const by = enemy.mesh.position.y

      const dx = pp.x - bx
      const dy = pp.y - by
      const dSq = dx * dx + dy * dy

      const fleeMode = this.powerModeActive
      const speedScale = this.enemySpeedScales[i] * this.enemyGlobalRamp
      enemy.update(deltaSeconds, tmpPP, this.bounds, speedScale, nowMs, fleeMode)

      const rHit = pr + enemy.getRadius()
      if (dSq > rHit * rHit * 0.92) continue
      if (nowMs - this.enemyLastHitMs[i] < this.enemyCollisionCooldownMs) continue
      this.enemyLastHitMs[i] = nowMs

      if (this.powerModeActive) {
        this.enemySpeedScales[i] = 1.05 + Math.random() * 0.9
        enemy.setActive(false, tmpOff, 10)
      } else {
        this.requestReset()
        return
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
    for (const L of this.playerBodyLetters) this.wordScrambler.releaseBodyLetter(L)
    this.playerBodyLetters = []
    this.playerSnakeTrail?.reset()
    for (const r of this.playerBodyRings) r.visible = false
    this.player.setSize(this.initialPlayerSize)
    this.updateTrayContent()
    if (returned.length > 0) {
      this.wordScrambler.spawnLettersFromTray(returned)
    }
  }

  // ── Reset on death ────────────────────────────────────────────────────────

  private requestReset() {
    if (this.resetting) return
    this.resetting = true
    this.powerModeActive = false
    this.hud?.setPowerMode(false)

    const prevRun = Game.loadLastRunScore()
    const finalScore = this.score
    Game.saveLastRunScore(finalScore)
    this.hud?.setLastRunDisplay(finalScore)

    playResetCelebration(
      this.wordCelebrationEl,
      'RUN ENDED',
      Game.runEndedSubtitle(finalScore, prevRun),
    )
    this.tray = []
    for (const L of this.playerBodyLetters) this.wordScrambler?.releaseBodyLetter(L)
    this.playerBodyLetters = []
    this.playerSnakeTrail?.reset()
    for (const r of this.playerBodyRings) r.visible = false
    this.updateTrayContent()
    this.player.setSize(this.initialPlayerSize)
    this.player.mesh.position.set(0, 0, 1)

    const tmp = new THREE.Vector2(0, 0)
    for (const e of this.enemyPool) e.setActive(false, tmp, 10)
    this.fruit.setActive(false, tmp, 22)
    if (this.shockwaveMesh) { this.shockwaveMesh.visible = false; this.shockwaveActive = false }

    this.score = 0
    this.boostEnergy = 1
    this.hud?.setScore(0)
    this.hud?.setBoostFill(1)
    this.resetSubmitZones()
    const now = performance.now()
    this.gameStartMs = now
    this.enemyGlobalRamp = this.enemyRampMin
    this.enemyNextSpawnMs = now + this.enemySpawnIntervalMs
    this.spawnInitialEnemies()
    this.fruitNextSpawnMs = now + 3000
    this.resetting = false
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────

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
    this.enemyNextSpawnMs += pausedFor
    this.powerModeUntilMs += pausedFor
  }

  private hardResetGame(): void {
    if (this.paused) this.togglePause()
    this.requestReset()
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
