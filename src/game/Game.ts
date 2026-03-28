import * as THREE from 'three'
import { Player } from './entities/Player'
import { Enemy } from './entities/Enemy'
import { Fruit } from './entities/Fruit'
import {
  WordScrambler,
  BODY_LETTER_Z_LIFT,
  letterAnchorZFromRootScale,
  BUOY_LOCAL_HALF_HEIGHT,
} from './WordScrambler'
import { WordSource } from './WordSource'
import { WordPartitioner } from './WordPartitioner'
import { SnakeTrail } from './SnakeTrail'
import { Letter } from './entities/Letter'
import { CoinPickup } from './entities/CoinPickup'
import { isVowelLetter } from './LetterScoring'
import { AmbientBlobs } from './ambientBlobs'
import { createSimpleWaterShaderMaterial } from './simpleWater'
import { drawSafeZoneCircleHeadTexture } from './safeZoneCircleTexture'
import {
  SKINS,
  loadCoins,
  saveCoins,
  loadOwnedSkins,
  saveOwnedSkins,
  loadEquippedSkinId,
  saveEquippedSkinId,
  skinById,
  type SkinDef,
  type SkinId,
} from './skins'
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

/** Procedural ocean surface: deep water + lighter bands + soft foam streaks (scrolls in Game). */
function createOceanTexture(gridSizePx = 512, _themeMode: ThemeMode): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = gridSizePx
  canvas.height = gridSizePx

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for ocean')

  const g = ctx.createLinearGradient(0, 0, gridSizePx, gridSizePx)
  g.addColorStop(0, '#06182c')
  g.addColorStop(0.35, '#0a2844')
  g.addColorStop(0.65, '#0c3252')
  g.addColorStop(1, '#071a2e')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, gridSizePx, gridSizePx)

  ctx.strokeStyle = 'rgba(120, 200, 255, 0.07)'
  ctx.lineWidth = 2
  for (let i = 0; i < 18; i++) {
    const y = (i / 18) * gridSizePx + (i % 3) * 4
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(gridSizePx, y + Math.sin(i * 0.7) * 6)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(200, 235, 255, 0.045)'
  ctx.lineWidth = 1.2
  for (let x = 0; x < gridSizePx; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 20, gridSizePx)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(180, 230, 255, 0.04)'
  for (let k = 0; k < 40; k++) {
    const px = (Math.sin(k * 2.1) * 0.5 + 0.5) * gridSizePx
    const py = (Math.cos(k * 1.7) * 0.5 + 0.5) * gridSizePx
    ctx.beginPath()
    ctx.arc(px, py, 2 + (k % 4), 0, Math.PI * 2)
    ctx.fill()
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
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer

  /** Smoothed look-at point on the ground plane (XY, z = 0). */
  private cameraLookX = 0
  private cameraLookY = 0
  /** World offset from look-at along −Y; lower = steeper (more top-down) when paired with `cameraUpZ`. */
  private readonly cameraBackY = 1120
  /** World Z above the look point; higher vs `cameraBackY` = closer to vertical (still not 90°). */
  private readonly cameraUpZ = 2120
  /** Slightly narrow FOV for a bit more zoom / less edge stretch. */
  private readonly cameraFov = 45

  /** Shrink logical play area inside the map so the player and AI stay clear of walls / floor overlap. */
  private readonly arenaInset = 52

  private player: Player
  private gridPlane: THREE.Mesh
  private oceanTexture: THREE.Texture | null = null
  /** Procedural ocean shader; uniforms updated in `update` when active. */
  private waterMaterial: THREE.ShaderMaterial | null = null

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
  private enemyNearMissLastMs: number[] = []
  private readonly enemyCollisionCooldownMs = 450
  private readonly enemyNearMissCooldownMs = 780
  private readonly enemyNearMissGold = 4
  private playerSpillImmuneUntilMs = 0

  private fruit: Fruit
  private fruitNextSpawnMs = 0

  private ambientBlobs: AmbientBlobs
  private readonly coinSlots: CoinPickup[] = []
  private coinSlotNextSpawnMs: number[] = []

  /** Persistent currency (localStorage). */
  private metaCoins = 0
  private ownedSkins = new Set<SkinId>(['default'])
  private equippedSkinId: SkinId = 'default'
  private bodyRingMaterial: THREE.MeshStandardMaterial | null = null
  /** Trail segment discs: same animated canvas as the head when Safe Zone skin is equipped. */
  private bodyRingSafeZoneMaterial: THREE.MeshBasicMaterial | null = null
  private bodyRingSafeZoneTexture: THREE.CanvasTexture | null = null
  private bodyRingSafeZoneCtx: CanvasRenderingContext2D | null = null
  private readonly bodyRingSafeZoneTexSize = 160
  private shopUiBound = false

  private score = 0
  /** Rectangle below spawn (0,0); entering with your head auto-submits words. */
  private readonly submitZone: { minX: number; maxX: number; minY: number; maxY: number } = {
    minX: -94,
    maxX: 94,
    minY: -390,
    maxY: -218,
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
  /** Shop overlay freezes gameplay (separate timer accounting from P-pause). */
  private shopOpen = false
  private shopPauseStartedMs = 0
  private wordCelebrationEl: HTMLDivElement | null = null


  // Word-completion shockwave ring.
  private shockwaveMesh: THREE.Mesh | null = null
  private shockwaveActive = false
  private shockwaveStartMs = 0
  private readonly shockwaveMaxRadius = 440
  private readonly shockwaveDurationMs = 720

  private running = false
  private lastMs = 0
  private initialPlayerSize = 30
  private cameraViewHeightWorld = 1500
  private readonly cameraFollowSpeed = 5.2
  private viewportProfile: ViewportProfile = this.computeViewportProfile()

  constructor(options: GameOptions) {
    this.container = options.container

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x061a2c)
    this.scene.fog = new THREE.FogExp2(0x081c30, 0.000078)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio ?? 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(this.cameraFov, 1, 0.1, 24000)
    this.cameraLookX = 0
    this.cameraLookY = 0
    this.camera.position.set(0, -this.cameraBackY, this.cameraUpZ)
    this.camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0xf2f6ff, 0.62)
    this.scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 1.02)
    dir.position.set(0.35, 0.5, 1)
    this.scene.add(dir)
    const fill = new THREE.DirectionalLight(0xc8dcff, 0.42)
    fill.position.set(-0.85, -0.2, 0.45)
    this.scene.add(fill)

    const themeMode: ThemeMode = 'dark'
    const gridTex = createOceanTexture(512, themeMode)
    this.oceanTexture = gridTex
    const gridMat = new THREE.MeshStandardMaterial({
      map: gridTex,
      roughness: 0.55,
      metalness: 0,
      emissive: new THREE.Color(0x061a28),
      emissiveIntensity: 0.12,
    })
    gridMat.polygonOffset = true
    gridMat.polygonOffsetFactor = 2
    gridMat.polygonOffsetUnits = 2
    gridTex.repeat.set(8, 8)
    this.gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(this.mapSize, this.mapSize), gridMat)
    /** Slightly below z=0 so units above the floor don’t depth-fight with the terrain. */
    this.gridPlane.position.z = -0.025
    this.scene.add(this.gridPlane)
    this.addArenaWalls(themeMode)

    this.recomputeBounds()
    this.ambientBlobs = new AmbientBlobs(8, this.playBounds(), this.submitZone)
    this.scene.add(this.ambientBlobs.group)

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

    this.setupInput()
    this.onResize()

  }

  private recomputeBounds() {
    const half = this.mapSize / 2
    this.bounds = { minX: -half, maxX: half, minY: -half, maxY: half }
  }

  /** Map bounds inset from the rim — use for movement, spawns, and camera so nothing sits in the wall strip. */
  private playBounds(): Bounds {
    const p = this.arenaInset
    const b = this.bounds
    return {
      minX: b.minX + p,
      maxX: b.maxX - p,
      minY: b.minY + p,
      maxY: b.maxY - p,
    }
  }

  /** Raised rim around the playfield so the arena reads as a 3D volume. */
  private addArenaWalls(themeMode: ThemeMode): void {
    const half = this.mapSize / 2
    const wallH = 320
    const t = 70
    const wallColor = themeMode === 'dark' ? 0x152535 : 0xd8dce8
    const emissive = themeMode === 'dark' ? 0x081820 : 0xeef2ff
    const mat = new THREE.MeshStandardMaterial({
      color: wallColor,
      emissive,
      emissiveIntensity: themeMode === 'dark' ? 0.18 : 0.06,
      metalness: 0,
      roughness: 0.78,
    })
    const floorLift = 0.04
    const add = (w: number, d: number, cx: number, cy: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, wallH), mat)
      m.position.set(cx, cy, floorLift + wallH * 0.5)
      m.castShadow = false
      m.receiveShadow = false
      this.scene.add(m)
    }
    add(this.mapSize + t * 2, t, 0, half + t * 0.5)
    add(this.mapSize + t * 2, t, 0, -half - t * 0.5)
    add(t, this.mapSize + t * 2, half + t * 0.5, 0)
    add(t, this.mapSize + t * 2, -half - t * 0.5, 0)
  }

  private applySkinDef(skin: SkinDef): void {
    if (skin.id === 'safezone') {
      this.player.setHeadVisual('safezone')
      this.player.tickSafeZoneHeadTexture(performance.now())
    } else {
      this.player.setHeadVisual('standard')
      this.player.applySkin(skin.headColor, skin.headEmissive, skin.headEmissiveIntensity)
    }
    if (this.bodyRingMaterial && skin.id !== 'safezone') {
      this.bodyRingMaterial.color.setHex(skin.headColor)
      this.bodyRingMaterial.emissive.setHex(skin.headEmissive)
      this.bodyRingMaterial.emissiveIntensity = skin.headEmissiveIntensity * 0.92
    }
    this.assignBodyRingMaterialsForSkin()
    this.refreshAllBodyLetterSkinStyles()
    this.applyTrayColorsFromSkin(skin)
  }

  private ensureBodyRingSafeZoneMaterial(): void {
    if (this.bodyRingSafeZoneMaterial) return
    const canvas = document.createElement('canvas')
    canvas.width = this.bodyRingSafeZoneTexSize
    canvas.height = this.bodyRingSafeZoneTexSize
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d')
    this.bodyRingSafeZoneCtx = ctx
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    this.bodyRingSafeZoneTexture = tex
    this.bodyRingSafeZoneMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
    })
  }

  private assignBodyRingMaterialsForSkin(): void {
    if (!this.bodyRingMaterial || this.playerBodyRings.length === 0) return
    if (this.equippedSkinId === 'safezone') {
      this.ensureBodyRingSafeZoneMaterial()
      for (const r of this.playerBodyRings) {
        r.material = this.bodyRingSafeZoneMaterial!
      }
    } else {
      for (const r of this.playerBodyRings) {
        r.material = this.bodyRingMaterial
      }
    }
  }

  private styleBodyLetterForSkin(letter: Letter): void {
    const top = letter.topMaterial
    const side = letter.sideMaterial
    if (this.equippedSkinId === 'safezone') {
      top.color.set(0xffffff)
      top.emissive.set(0x444458)
      top.emissiveIntensity = 0.18
      side.color.set(0xc8c8dc)
    } else {
      const vowel = isVowelLetter(letter.char)
      top.color.set(0xffffff)
      if (vowel) {
        side.color.set(0x2a4a58)
        top.emissive.set(0x224438)
      } else {
        side.color.set(0x3a3858)
        top.emissive.set(0x302848)
      }
      top.emissiveIntensity = 0.11
    }
    top.needsUpdate = true
    side.needsUpdate = true
  }

  private refreshAllBodyLetterSkinStyles(): void {
    for (const L of this.playerBodyLetters) this.styleBodyLetterForSkin(L)
  }

  /** HTML tray chips + text track the same palette as the player head. */
  private applyTrayColorsFromSkin(skin: SkinDef): void {
    const hr = (skin.headColor >> 16) & 255
    const hg = (skin.headColor >> 8) & 255
    const hb = skin.headColor & 255
    const er = (skin.headEmissive >> 16) & 255
    const eg = (skin.headEmissive >> 8) & 255
    const eb = skin.headEmissive & 255
    const root = document.documentElement.style
    root.setProperty('--tray-letter-border', `rgba(${hr},${hg},${hb},0.9)`)
    root.setProperty('--tray-letter-shadow', `rgba(${er},${eg},${eb},0.55)`)
    const lum = hr * 0.299 + hg * 0.587 + hb * 0.114
    root.setProperty('--tray-letter-text', lum > 168 ? '#14141c' : '#f8f9ff')
  }

  private addMetaCoins(delta: number): void {
    if (delta <= 0) return
    this.metaCoins += delta
    saveCoins(this.metaCoins)
    this.hud?.setCoins(this.metaCoins)
    this.refreshShopList()
  }

  private setShopOpen(open: boolean): void {
    if (open === this.shopOpen) {
      this.hud?.setShopOpen(open)
      if (open) this.refreshShopList()
      return
    }
    const now = performance.now()
    if (open) {
      this.shopOpen = true
      this.shopPauseStartedMs = now
    } else {
      const pausedFor = Math.max(0, now - this.shopPauseStartedMs)
      this.lastMs = now
      this.gameStartMs += pausedFor
      this.fruitNextSpawnMs += pausedFor
      this.enemyNextSpawnMs += pausedFor
      this.powerModeUntilMs += pausedFor
      for (let i = 0; i < this.coinSlotNextSpawnMs.length; i++) {
        this.coinSlotNextSpawnMs[i] += pausedFor
      }
      this.shopOpen = false
    }
    this.hud?.setShopOpen(open)
    if (open) this.refreshShopList()
  }

  private refreshShopList(): void {
    if (!this.hud) return
    const root = this.hud.shopSkinListEl
    root.innerHTML = ''
    const equipped = this.equippedSkinId

    for (const skin of SKINS) {
      const owned = this.ownedSkins.has(skin.id)
      const row = document.createElement('div')
      row.className = 'shop-skin-row'

      const sw = document.createElement('span')
      sw.className = 'shop-skin-swatch'
      if (skin.id === 'safezone') {
        const sc = document.createElement('canvas')
        sc.width = 64
        sc.height = 64
        const sctx = sc.getContext('2d')
        if (sctx) {
          drawSafeZoneCircleHeadTexture(sctx, 64, performance.now(), true)
          sw.style.background = `url(${sc.toDataURL()}) center / cover no-repeat`
        } else {
          sw.style.background = `#${skin.headColor.toString(16).padStart(6, '0')}`
        }
      } else {
        sw.style.background = `#${skin.headColor.toString(16).padStart(6, '0')}`
      }

      const meta = document.createElement('div')
      meta.className = 'shop-skin-meta'

      const title = document.createElement('div')
      title.className = 'shop-skin-name'
      title.textContent = skin.name

      const price = document.createElement('div')
      price.className = 'shop-skin-price'
      if (skin.price <= 0) price.textContent = 'Free'
      else if (owned) price.textContent = 'Owned'
      else price.textContent = `${skin.price} gold`

      meta.append(title, price)

      const actions = document.createElement('div')
      actions.className = 'shop-skin-actions'

      if (!owned && skin.price > 0) {
        const buy = document.createElement('button')
        buy.type = 'button'
        buy.className = 'hud-button shop-action-btn'
        buy.textContent = 'Buy'
        buy.disabled = this.metaCoins < skin.price
        buy.addEventListener('click', () => {
          if (this.metaCoins < skin.price || this.ownedSkins.has(skin.id)) return
          this.metaCoins -= skin.price
          saveCoins(this.metaCoins)
          this.ownedSkins.add(skin.id)
          saveOwnedSkins(this.ownedSkins)
          this.hud?.setCoins(this.metaCoins)
          this.refreshShopList()
        })
        actions.appendChild(buy)
      }

      if (owned) {
        const eq = document.createElement('button')
        eq.type = 'button'
        eq.className = 'hud-button shop-action-btn'
        eq.textContent = skin.id === equipped ? 'Equipped' : 'Equip'
        eq.disabled = skin.id === equipped
        if (skin.id !== equipped) {
          eq.addEventListener('click', () => {
            this.equippedSkinId = skin.id
            saveEquippedSkinId(skin.id)
            const def = skinById(skin.id)
            if (def) this.applySkinDef(def)
            this.refreshShopList()
          })
        }
        actions.appendChild(eq)
      }

      row.append(sw, meta, actions)
      root.appendChild(row)
    }
  }

  private bindShopUi(): void {
    if (this.shopUiBound || !this.hud) return
    this.shopUiBound = true
    const { shopToggleEl, shopCloseEl, shopOverlayEl } = this.hud
    shopToggleEl.addEventListener('click', () => {
      const open = !shopOverlayEl.classList.contains('shop-overlay--open')
      this.setShopOpen(open)
    })
    shopCloseEl.addEventListener('click', () => this.setShopOpen(false))
    shopOverlayEl.addEventListener('click', (ev) => {
      if (ev.target === shopOverlayEl) this.setShopOpen(false)
    })
  }

  /**
   * Tray letter chips (rounded rects, not circles): scales slightly with viewport height.
   */
  private syncTrayLetterChipSizes(): void {
    if (!this.trayEl) return
    const h = this.container.clientHeight
    const px = Math.max(16, Math.min(22, Math.round(h * 0.018)))
    for (const el of this.trayEl.querySelectorAll<HTMLElement>('.tray-letter')) {
      el.style.width = 'auto'
      el.style.minWidth = `${px}px`
      el.style.height = `${Math.round(px * 1.05)}px`
      el.style.fontSize = `${Math.max(9, Math.round(px * 0.48))}px`
      el.style.padding = `2px ${Math.max(6, Math.round(px * 0.32))}px`
    }
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
      if (ev.code === 'KeyP' && !this.shopOpen) this.togglePause()
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
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.applyViewportProfileRuntime()
    this.refreshHudScore()
    this.syncTrayLetterChipSizes()
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
        cameraViewHeightWorld: 1460,
        playerSize: 30,
        letterRadius: 54,
        starterScale: 58,
        starterSpacing: 92,
        enemyStartCount: 8,
        enemyMaxCount: 18,
        enemyBaseRadiusScale: 1.12,
        enemyMinSpawnDist: Math.round(this.mapSize * 0.2),
        enemyMaxSpawnDist: Math.min(1580, this.mapSize / 2 - 100),
      }
    }
    return {
      cameraViewHeightWorld: 1680,
      playerSize: 36,
      letterRadius: 70,
      starterScale: 72,
      starterSpacing: 104,
      enemyStartCount: 6,
      enemyMaxCount: 15,
      enemyBaseRadiusScale: 1.06,
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

  /** Replaces the grid plane material with the animated procedural water shader. */
  private setupOceanWaterShader(): void {
    const oldMat = this.gridPlane.material as THREE.Material
    oldMat.dispose()
    if (this.oceanTexture) {
      this.oceanTexture.dispose()
      this.oceanTexture = null
    }
    const waterMat = createSimpleWaterShaderMaterial()
    waterMat.toneMapped = true
    this.gridPlane.material = waterMat
    this.waterMaterial = waterMat
  }

  private async loadSkyAndOcean(): Promise<void> {
    const loader = new THREE.TextureLoader()
    // Must respect Vite `base` (e.g. /pacman-scrabble/) or /sky_38_2k.png 404s in dev and on GitHub Pages.
    const skyUrl = `${import.meta.env.BASE_URL}sky_38_2k.png`
    try {
      const tex = await loader.loadAsync(skyUrl)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      this.scene.background = tex
      this.scene.environment = null

      this.scene.fog = new THREE.FogExp2(0xa8c4e8, 0.000044)
      this.setupOceanWaterShader()
    } catch (err) {
      console.warn('Sky / water failed (using fallback colors)', err)
      this.scene.background = new THREE.Color(0x6a9ecf)
      this.scene.fog = new THREE.FogExp2(0xa8c4e8, 0.000052)
      this.setupOceanWaterShader()
    }
  }

  private async initGameAsync() {
    try {
      await this.loadSkyAndOcean()

      this.hud = new Hud()

      // Cache DOM refs
      this.trayEl = document.getElementById('tray') as HTMLDivElement | null
      if (this.trayEl) this.trayEl.style.display = 'none'
      this.wordCelebrationEl = document.getElementById('wordCelebration') as HTMLDivElement | null

      this.wordSource = new WordSource({ topWordCount: 1000 })
      this.wordPartitioner = new WordPartitioner()
      this.hud.setPowerMode(false)

      // Spacing ≥ uniform tail tile width (~0.92×radius) so cargo letters don’t overlap along the curve.
      this.playerSnakeTrail = new SnakeTrail(this.viewportProfile.letterRadius * 1.04)
      this.setupPlayerBodyRings()
      this.setupSubmitZones()
      this.wordScrambler = new WordScrambler({
        scene: this.scene,
        bounds: this.playBounds(),
        letterRadius: this.viewportProfile.letterRadius,
        maxLetters: 48,
        starterScale: this.viewportProfile.starterScale,
        starterSpacing: this.viewportProfile.starterSpacing,
        themeMode: 'dark',
      })
      this.wordScrambler.initRandomFill(0)

      this.setupEnemyPool()

      this.metaCoins = loadCoins()
      this.ownedSkins = loadOwnedSkins()
      this.equippedSkinId = loadEquippedSkinId()
      const equippedSkin = skinById(this.equippedSkinId) ?? SKINS[0]
      this.applySkinDef(equippedSkin)

      this.coinSlots.length = 0
      this.coinSlotNextSpawnMs = []
      const coinStart = performance.now()
      for (let i = 0; i < 2; i++) {
        const c = new CoinPickup()
        this.scene.add(c.mesh)
        c.setActive(false, new THREE.Vector2(0, 0), 15)
        this.coinSlots.push(c)
        this.coinSlotNextSpawnMs.push(coinStart + 2000 + i * 5000 + Math.random() * 4000)
      }

      this.bindShopUi()
      this.score = 0
      this.hud.setScore(0)
      this.hud.setCoins(this.metaCoins)
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
      this.enemySpeedScales.push(1.38 + Math.random() * 0.62)
      this.enemyLastHitMs.push(0)
      this.enemyNearMissLastMs.push(0)
    }
  }

  private setupPlayerBodyRings(): void {
    const geo = new THREE.CircleGeometry(1, 14)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6ec8ff,
      emissive: new THREE.Color(0x4488cc),
      emissiveIntensity: 0.28,
      metalness: 0,
      roughness: 0.5,
      // No polygonOffset — negative offset was pulling rings toward the camera in the depth buffer
      // so they drew on top of the letter tiles (wrong order: letter ⊃ ring ⊃ sea).
    })
    this.bodyRingMaterial = mat
    for (let i = 0; i < this.bodyRingPoolSize; i++) {
      const m = new THREE.Mesh(geo, mat)
      m.visible = false
      m.renderOrder = 0
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
    const cw = 384
    const ch = Math.round((cw * (this.submitZone.maxY - this.submitZone.minY)) / (this.submitZone.maxX - this.submitZone.minX))
    const needH = Math.max(140, ch)
    if (this.submitGateCanvas && (this.submitGateCanvas.width !== cw || this.submitGateCanvas.height !== needH)) {
      this.submitGateTexture?.dispose()
      this.submitGateCanvas = null
      this.submitGateCtx = null
      this.submitGateTexture = null
    }
    if (this.submitGateCanvas) return
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = needH
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

    const lineSize = Math.max(18, Math.floor(h * 0.22))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tx = w * 0.5
    const tyLine1 = h * 0.38
    const tyLine2 = h * 0.58
    ctx.font = `900 ${lineSize}px system-ui, "Segoe UI", sans-serif`
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'

    const drawLine = (label: string, ty: number) => {
      ctx.strokeText(label, tx, ty)
      const g = ctx.createLinearGradient(tx - w * 0.45, ty - lineSize, tx + w * 0.45, ty + lineSize)
      for (let i = 0; i <= 5; i++) {
        g.addColorStop(i / 5, `hsl(${((hueSpin + i * 58) % 360)}, 100%, 62%)`)
      }
      ctx.fillStyle = g
      ctx.fillText(label, tx, ty)
    }

    drawLine('SAFE', tyLine1)
    drawLine('ZONE', tyLine2)

    this.submitGateTexture!.needsUpdate = true
  }

  private setupSubmitZones(): void {
    const z = this.submitZone
    const w = z.maxX - z.minX
    const h = z.maxY - z.minY
    const cx = (z.minX + z.maxX) * 0.5
    const cy = (z.minY + z.maxY) * 0.5

    const margin = 32
    const outerW = w + margin * 2
    const outerH = h + margin * 2
    const platformH = 18
    const wallH = 48
    const wallT = 14

    const stone = new THREE.MeshStandardMaterial({
      color: 0x5c6670,
      roughness: 0.91,
      metalness: 0.02,
    })
    const stoneDark = new THREE.MeshStandardMaterial({
      color: 0x3e464e,
      roughness: 0.93,
      metalness: 0,
    })

    const fort = new THREE.Group()
    fort.position.set(cx, cy, 0)

    const plat = new THREE.Mesh(new THREE.BoxGeometry(outerW, outerH, platformH), stone)
    plat.position.z = platformH / 2
    plat.castShadow = false
    plat.receiveShadow = false
    fort.add(plat)

    const wallZ = platformH + wallH / 2
    const wN = new THREE.Mesh(new THREE.BoxGeometry(outerW + wallT * 2, wallT, wallH), stoneDark)
    wN.position.set(0, outerH / 2 + wallT / 2, wallZ)
    fort.add(wN)
    const wS = new THREE.Mesh(new THREE.BoxGeometry(outerW + wallT * 2, wallT, wallH), stoneDark)
    wS.position.set(0, -outerH / 2 - wallT / 2, wallZ)
    fort.add(wS)
    const wE = new THREE.Mesh(new THREE.BoxGeometry(wallT, outerH, wallH), stoneDark)
    wE.position.set(outerW / 2 + wallT / 2, 0, wallZ)
    fort.add(wE)
    const wW = new THREE.Mesh(new THREE.BoxGeometry(wallT, outerH, wallH), stoneDark)
    wW.position.set(-outerW / 2 - wallT / 2, 0, wallZ)
    fort.add(wW)

    const towerR = 10
    const towerH = wallH + 16
    const tz = platformH + towerH / 2
    const ox = outerW / 2 + wallT * 0.55
    const oy = outerH / 2 + wallT * 0.55
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(towerR * 0.9, towerR, towerH, 14), stone)
      tower.position.set(sx * ox, sy * oy, tz)
      fort.add(tower)
    }

    this.scene.add(fort)

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
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0, platformH + 1.4)
    mesh.renderOrder = 4
    fort.add(mesh)
    this.submitZoneMaterial = mat
  }

  private resetSubmitZones(): void {
    this.submitZoneWasInside = false
    this.submitGateLastInside = null
    this.submitGateTexLastDrawMs = 0
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
    const b = this.playBounds()
    for (let attempt = 0; attempt < 70; attempt++) {
      const angle = Math.random() * Math.PI * 2
      const dist = minSpawnDist + Math.random() * (maxSpawnDist - minSpawnDist)
      out.set(Math.cos(angle) * dist, Math.sin(angle) * dist)
      if (
        out.x >= b.minX + margin &&
        out.x <= b.maxX - margin &&
        out.y >= b.minY + margin &&
        out.y <= b.maxY - margin &&
        !Game.pointInRect(out.x, out.y, avoid)
      ) {
        return
      }
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      out.set(
        THREE.MathUtils.lerp(b.minX + margin, b.maxX - margin, Math.random()),
        THREE.MathUtils.lerp(b.minY + margin, b.maxY - margin, Math.random()),
      )
      if (!Game.pointInRect(out.x, out.y, avoid)) {
        return
      }
    }
    out.set(b.minX + margin + 80, b.maxY - margin - 80)
  }

  private spawnEnemyAtIndex(i: number): void {
    /** World scale for the mine mesh — large, readable; height follows radius in Enemy. */
    const r = (38 + Math.random() * 22) * 1.22 * this.viewportProfile.enemyBaseRadiusScale
    const tmp = new THREE.Vector2()
    this.placeEnemySpawnPosition(tmp, r)
    const enemy = this.enemyPool[i]
    enemy.setActive(true, tmp, r)
    enemy.setPatrolBounds(this.playBounds(), this.submitGateAvoidBounds())
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
    if (this.paused || this.shopOpen) return
    if (!this.resetting && this.gameStartMs > 0) {
      const t = (nowMs - this.gameStartMs) / 1000
      this.enemyGlobalRamp = Math.min(
        this.enemyRampMax,
        this.enemyRampMin + t * this.enemyRampPerSecond,
      )
    }

    this.updateCamera(deltaSeconds)
    this.recomputePointerWorld()
    this.ambientBlobs.update(deltaSeconds, this.playBounds())
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = nowMs * 0.001
      this.waterMaterial.uniforms.uCameraPosition.value.copy(this.camera.position)
    } else if (this.oceanTexture) {
      this.oceanTexture.offset.x += deltaSeconds * 0.014
      this.oceanTexture.offset.y += deltaSeconds * 0.009
    }
    this.player.update(deltaSeconds, {
      pointerWorld: this.pointerWorld,
      bounds: this.playBounds(),
      speedMultiplier: 1,
    })
    if (this.equippedSkinId === 'safezone') {
      this.player.tickSafeZoneHeadTexture(nowMs)
      if (this.bodyRingSafeZoneCtx && this.bodyRingSafeZoneTexture) {
        drawSafeZoneCircleHeadTexture(
          this.bodyRingSafeZoneCtx,
          this.bodyRingSafeZoneTexSize,
          nowMs,
          true,
        )
        this.bodyRingSafeZoneTexture.needsUpdate = true
      }
    }
    this.checkBlobPlayerCollision()
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
    this.maybeSpawnCoinPickups(nowMs)
    for (const c of this.coinSlots) c.update(nowMs)
    this.handleCoinCollisions(nowMs)
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(deltaSeconds: number) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    // Slither.io–style: pull back slightly as your tail grows so you see more of the arena.
    const tailZoom = 1 + Math.min(0.4, this.tray.length * 0.013)
    const halfY = (this.cameraViewHeightWorld * tailZoom) / 2
    const halfX = halfY * aspect

    const pb = this.playBounds()
    const targetX = THREE.MathUtils.clamp(this.player.mesh.position.x, pb.minX + halfX, pb.maxX - halfX)
    const targetY = THREE.MathUtils.clamp(this.player.mesh.position.y, pb.minY + halfY, pb.maxY - halfY)

    const t = 1 - Math.exp(-this.cameraFollowSpeed * deltaSeconds)
    this.cameraLookX = THREE.MathUtils.lerp(this.cameraLookX, targetX, t)
    this.cameraLookY = THREE.MathUtils.lerp(this.cameraLookY, targetY, t)

    const back = this.cameraBackY * tailZoom
    const up = this.cameraUpZ * tailZoom
    this.camera.position.set(this.cameraLookX, this.cameraLookY - back, up)
    this.camera.lookAt(this.cameraLookX, this.cameraLookY, 0)
  }

  private recomputePointerWorld() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.pointerHit)
    if (hit) {
      const r = this.player.getRadius()
      const pb = this.playBounds()
      this.pointerWorld.set(
        THREE.MathUtils.clamp(hit.x, pb.minX + r, pb.maxX - r),
        THREE.MathUtils.clamp(hit.y, pb.minY + r, pb.maxY - r),
      )
    }
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
    this.syncTrayLetterChipSizes()
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
    this.syncTrayLetterChipSizes()
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
      const dx = playerPos.x - letter.root.position.x
      const dy = playerPos.y - letter.root.position.y
      const r = playerRadius + letter.radius * 0.82
        if (dx * dx + dy * dy <= r * r * 0.85) {
        this.tray.push(letter.char)
        this.wordScrambler.spawnReplacementLetter()
        this.wordScrambler.promoteFieldLetterToBody(letter)
        this.playerBodyLetters.push(letter)
        this.styleBodyLetterForSkin(letter)
        changed = true
      }
    }
    if (changed) {
      this.updateTrayContent()
    }
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
      return ''
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
      const root = this.playerBodyLetters[i].root
      this.playerBodyLetters[i].root.position.set(
        p.x,
        p.y,
        letterAnchorZFromRootScale(root.scale) + BODY_LETTER_Z_LIFT,
      )
      if (i < this.playerBodyRings.length) {
        const ring = this.playerBodyRings[i]
        ring.visible = true
        const cz = letterAnchorZFromRootScale(root.scale) + BODY_LETTER_Z_LIFT
        const halfBuoyZ = BUOY_LOCAL_HALF_HEIGHT * root.scale.z
        const tileBottomZ = cz - halfBuoyZ
        /** Halo strictly under the tile: ocean < ring < letter. Use actual grid Z + margin to avoid z-fighting. */
        const groundZ = this.gridPlane.position.z
        const minZAboveGround = groundZ + 0.28
        const gapBelowTile = 0.22
        const ringZ = Math.max(minZAboveGround, tileBottomZ - gapBelowTile)
        ring.position.set(p.x, p.y, ringZ)
        const r = this.playerBodyLetters[i].radius * 0.58
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

    const hx = this.player.mesh.position.x
    const hy = this.player.mesh.position.y
    const hr = this.player.getRadius()
    if (Game.circleIntersectsRect(hx, hy, hr, this.submitZone)) return

    for (let i = 0; i < this.enemyPool.length; i++) {
      const enemy = this.enemyPool[i]
      if (!enemy.isActive()) continue
      const ep = enemy.mesh.position
      const er = enemy.getRadius() * 0.9
      for (let j = 0; j < this.playerBodyLetters.length; j++) {
        const seg = this.playerBodyLetters[j].root.position
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
    if (this.paused || this.shopOpen) return
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
      const wordCoinBonus = Math.max(2, Math.min(30, Math.floor(pts / 35)))
      this.addMetaCoins(wordCoinBonus)
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

    const pp = this.player.mesh.position
    const pr = this.player.getRadius()
    const playerInSafeZone = Game.circleIntersectsRect(pp.x, pp.y, pr, this.submitZone)
    tmpPP.set(pp.x, pp.y)

    for (let i = 0; i < this.enemyPool.length; i++) {
      const enemy = this.enemyPool[i]
      if (!enemy.isActive()) continue

      const bx = enemy.mesh.position.x
      const by = enemy.mesh.position.y

      const dx = pp.x - bx
      const dy = pp.y - by
      const dSq = dx * dx + dy * dy

      const fleeMode = this.powerModeActive
      const speedScale = this.enemySpeedScales[i] * this.enemyGlobalRamp
      enemy.update(deltaSeconds, tmpPP, this.playBounds(), speedScale, nowMs, fleeMode, playerInSafeZone)

      if (playerInSafeZone) continue

      const rHit = pr + enemy.getRadius()
      const hitThreshSq = rHit * rHit * 0.92

      if (dSq <= hitThreshSq) {
        if (nowMs - this.enemyLastHitMs[i] < this.enemyCollisionCooldownMs) continue
        this.enemyLastHitMs[i] = nowMs

        if (this.powerModeActive) {
          this.enemySpeedScales[i] = 1.25 + Math.random() * 0.58
          enemy.setActive(false, tmpOff, 10)
        } else {
          this.requestReset()
          return
        }
        continue
      }

      if (!fleeMode && enemy.isDashActive()) {
        const ex = enemy.mesh.position.x
        const ey = enemy.mesh.position.y
        const px2 = pp.x - ex
        const py2 = pp.y - ey
        const dSqPost = px2 * px2 + py2 * py2
        const nearOuterSq = (rHit + 62) * (rHit + 62)
        if (dSqPost > hitThreshSq && dSqPost < nearOuterSq) {
          if (nowMs - this.enemyNearMissLastMs[i] >= this.enemyNearMissCooldownMs) {
            this.enemyNearMissLastMs[i] = nowMs
            this.addMetaCoins(this.enemyNearMissGold)
            playInfoCelebration(
              this.wordCelebrationEl,
              'CLOSE SHAVE',
              `Dive bomb missed! +${this.enemyNearMissGold} gold`,
              1550,
            )
          }
        }
      }
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
    this.player.mesh.position.x = 0
    this.player.mesh.position.y = 0
    this.cameraLookX = 0
    this.cameraLookY = 0
    this.camera.position.set(0, -this.cameraBackY, this.cameraUpZ)
    this.camera.lookAt(0, 0, 0)

    const tmp = new THREE.Vector2(0, 0)
    for (const e of this.enemyPool) e.setActive(false, tmp, 10)
    this.fruit.setActive(false, tmp, 22)
    for (const c of this.coinSlots) c.setActive(false, tmp, 15)
    const nowCoin = performance.now()
    for (let i = 0; i < this.coinSlotNextSpawnMs.length; i++) {
      this.coinSlotNextSpawnMs[i] = nowCoin + 2500 + i * 4000
    }
    if (this.shockwaveMesh) { this.shockwaveMesh.visible = false; this.shockwaveActive = false }

    this.score = 0
    this.hud?.setScore(0)
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
    if (this.shopOpen) return
    this.paused = !this.paused

    if (this.paused) {
      this.pauseStartedMs = performance.now()
      playInfoCelebration(this.wordCelebrationEl, 'PAUSED', 'Press P to resume', 1200)
      return
    }

    const now = performance.now()
    const pausedFor = Math.max(0, now - this.pauseStartedMs)
    this.lastMs = now
    this.gameStartMs += pausedFor
    this.fruitNextSpawnMs += pausedFor
    this.enemyNextSpawnMs += pausedFor
    this.powerModeUntilMs += pausedFor
    for (let i = 0; i < this.coinSlotNextSpawnMs.length; i++) {
      this.coinSlotNextSpawnMs[i] += pausedFor
    }
  }

  // ── Word shockwave ────────────────────────────────────────────────────────

  private triggerWordShockwave(nowMs: number): void {
    if (!this.shockwaveMesh) return
    this.shockwaveMesh.position.set(this.player.mesh.position.x, this.player.mesh.position.y, 2.12)
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
    const b = this.playBounds()
    const pos = new THREE.Vector2(
      THREE.MathUtils.lerp(b.minX + r, b.maxX - r, Math.random()),
      THREE.MathUtils.lerp(b.minY + r, b.maxY - r, Math.random()),
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

  private checkBlobPlayerCollision(): void {
    if (this.resetting || !this.wordScrambler) return
    const px = this.player.mesh.position.x
    const py = this.player.mesh.position.y
    const pr = this.player.getRadius()
    if (Game.circleIntersectsRect(px, py, pr, this.submitZone)) return
    let hit = false
    this.ambientBlobs.forEachBlob((bx, by, br) => {
      if (hit) return
      const dx = px - bx
      const dy = py - by
      const rr = pr + br * 0.88
      if (dx * dx + dy * dy <= rr * rr) hit = true
    })
    if (hit) this.requestReset()
  }

  private spawnCoinPickupSlot(slot: number, nowMs: number): void {
    const c = this.coinSlots[slot]
    if (!c || c.isActive()) return
    const r = 15
    const maxTries = 28
    const fp = this.fruit.mesh.position
    const fruitActive = this.fruit.isActive()
    const pb = this.playBounds()
    for (let t = 0; t < maxTries; t++) {
      const pos = new THREE.Vector2(
        THREE.MathUtils.lerp(pb.minX + r, pb.maxX - r, Math.random()),
        THREE.MathUtils.lerp(pb.minY + r, pb.maxY - r, Math.random()),
      )
      if (Game.pointInRect(pos.x, pos.y, this.submitZone)) continue
      if (fruitActive) {
        const dx = pos.x - fp.x
        const dy = pos.y - fp.y
        if (dx * dx + dy * dy < (r + this.fruit.getRadius() + 120) ** 2) continue
      }
      for (let j = 0; j < this.coinSlots.length; j++) {
        if (j === slot || !this.coinSlots[j].isActive()) continue
        const o = this.coinSlots[j].mesh.position
        const dx = pos.x - o.x
        const dy = pos.y - o.y
        if (dx * dx + dy * dy < 180 * 180) continue
      }
      c.setActive(true, pos, r)
      this.coinSlotNextSpawnMs[slot] = nowMs + 12000 + Math.random() * 7000
      return
    }
    this.coinSlotNextSpawnMs[slot] = nowMs + 2500
  }

  private maybeSpawnCoinPickups(nowMs: number): void {
    for (let i = 0; i < this.coinSlots.length; i++) {
      if (this.coinSlots[i].isActive()) continue
      if (nowMs < (this.coinSlotNextSpawnMs[i] ?? 0)) continue
      this.spawnCoinPickupSlot(i, nowMs)
    }
  }

  private handleCoinCollisions(nowMs: number): void {
    const pp = this.player.mesh.position
    const pr = this.player.getRadius()
    for (let i = 0; i < this.coinSlots.length; i++) {
      const c = this.coinSlots[i]
      if (!c.isActive()) continue
      const cp = c.mesh.position
      const dx = pp.x - cp.x
      const dy = pp.y - cp.y
      const r = pr + c.getRadius()
      if (dx * dx + dy * dy > r * r * 0.9) continue
      c.setActive(false, new THREE.Vector2(0, 0), 15)
      this.addMetaCoins(10)
      this.coinSlotNextSpawnMs[i] = nowMs + 4000 + Math.random() * 3500
    }
  }

}
