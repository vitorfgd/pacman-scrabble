import * as THREE from 'three'
import { Letter } from './entities/Letter'
import { isVowelLetter } from './LetterScoring'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
export type ThemeMode = 'dark' | 'light'

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

/** Approximate English letter frequencies for random spawns. */
const FREQ_CHARS = 'eeeeeeeeeeeeeeeeetttttttttaaaaaaaaooooooooooiiiiiiiiinnnnnnnnssssssssrrrrrrrrrrhhhhhhhhddddlllllluuuuuuuuuuccccccuummmmmmwwwwwwwwffggggggyyypppbbvvkjxqz'.split('')

function pickWeightedLetter(): string {
  return FREQ_CHARS[Math.floor(Math.random() * FREQ_CHARS.length)] ?? 'e'
}

/** Same distribution as field letter spawns — for decoys (e.g. bombs). */
export function pickRandomFieldLetter(): string {
  return pickWeightedLetter()
}

/**
 * Rounded-square tile for field letters (reads clearly at larger world scale).
 */
export function makeFieldLetterTexture(char: string, themeMode: ThemeMode): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for letter texture')

  const isDark = themeMode === 'dark'
  ctx.fillStyle = isDark ? '#0c1e32' : '#f0f4ff'
  ctx.fillRect(0, 0, 512, 512)

  const pad = 28
  const rw = canvas.width - pad * 2
  const rh = canvas.height - pad * 2
  const corner = 36
  ctx.beginPath()
  ctx.roundRect(pad, pad, rw, rh, corner)
  const panelGrad = ctx.createLinearGradient(pad, pad, pad + rw, pad + rh)
  if (isDark) {
    panelGrad.addColorStop(0, '#152a42')
    panelGrad.addColorStop(1, '#0a1628')
  } else {
    panelGrad.addColorStop(0, '#ffffff')
    panelGrad.addColorStop(1, '#dde8ff')
  }
  ctx.fillStyle = panelGrad
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = isDark ? 'rgba(160, 210, 255, 0.45)' : 'rgba(60, 80, 120, 0.35)'
  ctx.stroke()

  const cx = canvas.width / 2
  const cy = canvas.height / 2 + 4
  const ch = char.toUpperCase()
  ctx.font = '900 280px system-ui, "Segoe UI", Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = isDark ? '#000000' : '#0a1020'
  ctx.lineWidth = 18
  ctx.strokeText(ch, cx, cy)
  ctx.fillStyle = isDark ? '#ffffff' : '#0f1628'
  ctx.fillText(ch, cx, cy)
  ctx.lineWidth = 4
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.9)'
  ctx.strokeText(ch, cx, cy)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Deck tile for tail segments — same legibility as field letters (uniform scale; no stretched UVs). */
export function makeCompartmentLetterTexture(char: string, themeMode: ThemeMode): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')

  const isDark = themeMode === 'dark'
  ctx.fillStyle = isDark ? '#0f2034' : '#e8eef8'
  ctx.fillRect(0, 0, 512, 512)

  const pad = 28
  const rw = canvas.width - pad * 2
  const rh = canvas.height - pad * 2
  const corner = 36
  ctx.beginPath()
  ctx.roundRect(pad, pad, rw, rh, corner)
  const panelGrad = ctx.createLinearGradient(pad, pad, pad + rw, pad + rh)
  if (isDark) {
    panelGrad.addColorStop(0, '#1a3550')
    panelGrad.addColorStop(1, '#0c1828')
  } else {
    panelGrad.addColorStop(0, '#ffffff')
    panelGrad.addColorStop(1, '#d8e4f8')
  }
  ctx.fillStyle = panelGrad
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = isDark ? 'rgba(255, 200, 120, 0.5)' : 'rgba(80, 100, 140, 0.35)'
  ctx.stroke()

  const cx = canvas.width / 2
  const cy = canvas.height / 2 + 4
  const ch = char.toUpperCase()
  ctx.font = '900 280px system-ui, "Segoe UI", Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = isDark ? '#000000' : '#0a1020'
  ctx.lineWidth = 18
  ctx.strokeText(ch, cx, cy)
  ctx.fillStyle = isDark ? '#ffffff' : '#0f1628'
  ctx.fillText(ch, cx, cy)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

interface StarterAnim {
  baseX: number
  baseY: number
  phaseOffset: number
}

/**
 * Ring lifebuoy (torus) in XY; letter is a flat panel on top (+Z) so it reads like the reference.
 * Bottom of tube = −BUOY_LOCAL_HALF_HEIGHT at group origin.
 */
const LIFEGUARD_MAJOR = 0.52
const LIFEGUARD_TUBE = 0.145
export const BUOY_LOCAL_HALF_HEIGHT = LIFEGUARD_TUBE

function createLetterTileMesh(): {
  root: THREE.Group
  topMaterial: THREE.MeshPhysicalMaterial
  sideMaterial: THREE.MeshStandardMaterial
} {
  const topMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
    transparent: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -0.5,
    polygonOffsetUnits: -0.5,
  })
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a3d52,
    roughness: 0.48,
    metalness: 0,
  })

  /** Flat letter card facing the camera — sits above the ring (reference-style). */
  const panelGeo = new THREE.PlaneGeometry(0.86, 0.86)
  const mesh = new THREE.Mesh(panelGeo, topMaterial)
  mesh.position.z = LIFEGUARD_TUBE + 0.035
  mesh.renderOrder = 4
  const root = new THREE.Group()

  const matWhite = new THREE.MeshStandardMaterial({
    color: 0xf2f4f8,
    roughness: 0.34,
    metalness: 0.06,
  })
  const matRed = new THREE.MeshStandardMaterial({
    color: 0xe32620,
    roughness: 0.36,
    metalness: 0.06,
  })
  const arc = Math.PI / 2
  const seg = 12
  const tub = 32
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.TorusGeometry(LIFEGUARD_MAJOR, LIFEGUARD_TUBE, seg, tub, arc)
    const mat = i % 2 === 0 ? matWhite : matRed
    const ringSeg = new THREE.Mesh(geo, mat)
    ringSeg.rotation.z = i * arc
    ringSeg.renderOrder = 0
    root.add(ringSeg)
  }

  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xeef0f5,
    roughness: 0.55,
    metalness: 0.02,
  })
  const ropeGeo = new THREE.TorusGeometry(LIFEGUARD_MAJOR + LIFEGUARD_TUBE * 0.95, 0.024, 8, 48)
  const rope = new THREE.Mesh(ropeGeo, ropeMat)
  rope.position.z = 0.028
  rope.renderOrder = 1
  root.add(rope)

  root.add(mesh)

  return { root, topMaterial, sideMaterial }
}

/** Extra height for tail / body letters so tiles don’t z-fight the ocean. (World up = +Z.) */
export const BODY_LETTER_Z_LIFT = 0.32

/** World Z for root origin (tile center): buoy bottom sits on the deck. */
export function letterAnchorZ(scale: number): number {
  return BUOY_LOCAL_HALF_HEIGHT * scale + 0.08
}

/** When root scale is non-uniform (cargo compartments), use Z scale for foot height. */
export function letterAnchorZFromRootScale(scale: THREE.Vector3): number {
  return BUOY_LOCAL_HALF_HEIGHT * scale.z + 0.08
}

export class WordScrambler {
  private readonly scene: THREE.Scene
  private readonly bounds: Bounds

  private readonly letterRadius: number
  private maxLetters = 48
  private starterScale = 58
  private starterSpacing = 92

  private readonly letters: Letter[] = []
  private readonly textureByChar = new Map<string, THREE.Texture>()
  private readonly compartmentTextureByChar = new Map<string, THREE.Texture>()
  private themeMode: ThemeMode = 'dark'

  // Starter-letter tracking — using a Set so there is zero ambiguity about
  // which pool slots are "reserved" for the intro word.
  private readonly starterLetterSet = new Set<Letter>()
  private readonly starterAnimData = new Map<Letter, StarterAnim>()

  // When > 0, randomInBounds retries positions that fall inside this circle.
  private spawnExclusionRadius = 0
  private readonly spawnExclusionCenter = new THREE.Vector2(0, 0)

  /** Letters attached to snake bodies (player or bots) — not picked up as field. */
  private readonly bodyLetterSet = new Set<Letter>()

  constructor(options: {
    scene: THREE.Scene
    bounds: Bounds
    letterRadius?: number
    maxLetters?: number
    starterScale?: number
    starterSpacing?: number
    themeMode?: ThemeMode
  }) {
    this.scene = options.scene
    this.bounds = options.bounds
    this.letterRadius = options.letterRadius ?? 26
    if (options.maxLetters != null) this.maxLetters = options.maxLetters
    else this.maxLetters = 48
    if (options.starterScale != null) this.starterScale = options.starterScale
    if (options.starterSpacing != null) this.starterSpacing = options.starterSpacing
    if (options.themeMode != null) this.themeMode = options.themeMode
    this.buildPool()
  }

  private buildPool() {
    for (let i = 0; i < this.maxLetters; i++) {
      const { root, topMaterial, sideMaterial } = createLetterTileMesh()
      root.scale.setScalar(this.letterRadius)
      root.position.set(0, 0, letterAnchorZ(this.letterRadius))
      this.scene.add(root)
      this.letters.push(new Letter(root, topMaterial, sideMaterial, '', this.letterRadius))
    }
  }

  private getLetterTexture(char: string): THREE.Texture {
    const existing = this.textureByChar.get(char)
    if (existing) return existing
    const tex = makeFieldLetterTexture(char, this.themeMode)
    this.textureByChar.set(char, tex)
    return tex
  }

  private getCompartmentTexture(char: string): THREE.Texture {
    const existing = this.compartmentTextureByChar.get(char)
    if (existing) return existing
    const tex = makeCompartmentLetterTexture(char, this.themeMode)
    this.compartmentTextureByChar.set(char, tex)
    return tex
  }

  setThemeMode(themeMode: ThemeMode): void {
    if (this.themeMode === themeMode) return
    this.themeMode = themeMode
    this.textureByChar.clear()
    this.compartmentTextureByChar.clear()
    for (const l of this.letters) {
      if (!l.isActive()) continue
      l.topMaterial.map = this.bodyLetterSet.has(l) ? this.getCompartmentTexture(l.char) : this.getLetterTexture(l.char)
      l.topMaterial.needsUpdate = true
    }
  }

  private clearLetters() {
    for (const l of this.letters) l.setActive(false)
    this.bodyLetterSet.clear()
  }

  /**
   * Returns the first inactive pool slot that is NOT reserved as a starter letter.
   */
  private getInactiveLetter(): Letter | null {
    for (const l of this.letters) {
      if (!l.isActive() && !this.starterLetterSet.has(l)) return l
    }
    return null
  }

  isBodyLetter(letter: Letter): boolean {
    return this.bodyLetterSet.has(letter)
  }

  /**
   * Field letter becomes a snake body segment (same 3D tile). Call after spawnReplacementLetter.
   */
  promoteFieldLetterToBody(letter: Letter): void {
    this.starterLetterSet.delete(letter)
    this.starterAnimData.delete(letter)
    this.bodyLetterSet.add(letter)
    this.applyBodyCompartmentVisual(letter)
  }

  /**
   * New body segment from a pooled inactive letter (e.g. when tray grows without a field pickup).
   */
  acquireBodyLetter(char: string): Letter | null {
    const slot = this.getInactiveLetter()
    if (!slot) return null
    this.applyLetterVisual(slot, char)
    this.bodyLetterSet.add(slot)
    this.applyBodyCompartmentVisual(slot)
    return slot
  }

  /** Uniform deck tile — avoids stretched geometry and texture clipping from non-uniform scale. */
  private applyBodyCompartmentVisual(letter: Letter): void {
    const s = this.letterRadius * 0.92
    letter.root.scale.setScalar(s)
    letter.root.rotation.z = 0
    letter.topMaterial.map = this.getCompartmentTexture(letter.char)
    const vowel = isVowelLetter(letter.char)
    letter.topMaterial.color.set(0xffffff)
    letter.sideMaterial.color.set(vowel ? 0x2a4a58 : 0x3a3858)
    letter.topMaterial.emissive.set(vowel ? 0x224438 : 0x302848)
    letter.topMaterial.emissiveIntensity = 0.1
    letter.topMaterial.needsUpdate = true
    letter.sideMaterial.needsUpdate = true
    letter.root.position.z = letterAnchorZ(s) + BODY_LETTER_Z_LIFT
  }

  releaseBodyLetter(letter: Letter): void {
    this.bodyLetterSet.delete(letter)
    letter.setActive(false)
  }

  releaseBodyLetters(letters: Letter[]): void {
    for (const l of letters) this.releaseBodyLetter(l)
  }

  private applyLetterVisual(letter: Letter, ch: string) {
    this.starterLetterSet.delete(letter)
    this.starterAnimData.delete(letter)

    letter.setChar(ch)
    letter.setActive(true)
    letter.root.scale.setScalar(this.letterRadius)
    letter.root.position.z = letterAnchorZ(this.letterRadius)
    const tex = this.getLetterTexture(ch)
    letter.topMaterial.map = tex
    const vowel = isVowelLetter(ch)
    letter.topMaterial.color.set(0xffffff)
    letter.sideMaterial.color.set(vowel ? 0x2a4a58 : 0x3a3858)
    letter.topMaterial.emissive.set(vowel ? 0x224438 : 0x382848)
    letter.topMaterial.emissiveIntensity = 0.12
    letter.topMaterial.needsUpdate = true
    letter.sideMaterial.needsUpdate = true
  }

  private placeSingleLetterRandom(letter: Letter): void {
    const margin = Math.max(120, this.letterRadius * 4.2)
    const p = this.randomInBounds(margin)
    letter.root.position.set(
      THREE.MathUtils.clamp(p.x, this.bounds.minX + this.letterRadius, this.bounds.maxX - this.letterRadius),
      THREE.MathUtils.clamp(p.y, this.bounds.minY + this.letterRadius, this.bounds.maxY - this.letterRadius),
      letterAnchorZ(this.letterRadius),
    )
  }

  private randomInBounds(margin: number): THREE.Vector2 {
    const gen = () => new THREE.Vector2(
      THREE.MathUtils.lerp(this.bounds.minX + margin, this.bounds.maxX - margin, Math.random()),
      THREE.MathUtils.lerp(this.bounds.minY + margin, this.bounds.maxY - margin, Math.random()),
    )
    if (this.spawnExclusionRadius <= 0) return gen()
    for (let i = 0; i < 15; i++) {
      const p = gen()
      if (p.distanceTo(this.spawnExclusionCenter) >= this.spawnExclusionRadius) return p
    }
    return gen()
  }

  /**
   * Scatter `count` random weighted letters in clusters (same layout style as the old word pool).
   */
  private placeRandomLetterField(count: number): void {
    this.clearLetters()
    let poolIndex = 0

    while (poolIndex < count && poolIndex < this.letters.length) {
      const remaining = count - poolIndex
      const wordLen = Math.min(3 + Math.floor(Math.random() * 4), remaining)
      const fakeWord = Array.from({ length: wordLen }, () => pickWeightedLetter()).join('')
      const letters = fakeWord.split('')
      shuffleInPlace(letters)

      const clusterCount = Math.min(4, Math.max(2, letters.length >= 5 ? 3 : 2))
      const clusterCenters: THREE.Vector2[] = []
      const centerMargin = Math.max(120, this.letterRadius * 3.8)
      for (let c = 0; c < clusterCount; c++) clusterCenters.push(this.randomInBounds(centerMargin))
      const clusterRadius = Math.max(140, this.letterRadius * 6)

      for (let i = 0; i < letters.length; i++) {
        if (poolIndex >= this.letters.length) return
        const ch = letters[i]
        const l = this.letters[poolIndex++]
        this.applyLetterVisual(l, ch)

        const center = clusterCenters[i % clusterCount]
        const angle = Math.random() * Math.PI * 2
        const dist = Math.sqrt(Math.random()) * clusterRadius

        l.root.position.set(
          THREE.MathUtils.clamp(
            center.x + Math.cos(angle) * dist,
            this.bounds.minX + this.letterRadius,
            this.bounds.maxX - this.letterRadius,
          ),
          THREE.MathUtils.clamp(
            center.y + Math.sin(angle) * dist,
            this.bounds.minY + this.letterRadius,
            this.bounds.maxY - this.letterRadius,
          ),
          letterAnchorZ(this.letterRadius),
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fill the map with random letters outside the spawn exclusion zone; leaves
   * `reserveInactive` slots inactive for the starter word.
   */
  initRandomFill(reserveInactive = 3): void {
    this.starterLetterSet.clear()
    this.starterAnimData.clear()
    this.spawnExclusionRadius = 850
    this.spawnExclusionCenter.set(0, 0)

    const count = Math.max(0, this.maxLetters - reserveInactive)
    this.placeRandomLetterField(count)

    this.spawnExclusionRadius = 0
  }

  /**
   * Place the letters of `word` in a LEFT-TO-RIGHT readable line above `center`.
   */
  spawnStarterWord(word: string, center: THREE.Vector2): void {
    this.starterLetterSet.clear()
    this.starterAnimData.clear()

    const chars = word.toLowerCase().split('')
    const starterScale = this.starterScale
    const spacing = this.starterSpacing
    const totalWidth = (chars.length - 1) * spacing
    const by = center.y + 210

    for (let i = 0; i < chars.length; i++) {
      const slot = this.getInactiveLetter()
      if (!slot) return

      this.applyLetterVisual(slot, chars[i])
      slot.root.scale.setScalar(starterScale)

      const bx = center.x - totalWidth / 2 + i * spacing
      slot.root.position.set(bx, by, letterAnchorZ(starterScale) + 0.52)

      this.starterLetterSet.add(slot)
      this.starterAnimData.set(slot, { baseX: bx, baseY: by, phaseOffset: i / chars.length })
    }
  }

  updateStarterLetters(nowMs: number): void {
    if (this.starterLetterSet.size === 0) return
    const t = nowMs / 1000
    for (const letter of this.starterLetterSet) {
      if (!letter.isActive()) continue
      const data = this.starterAnimData.get(letter)
      if (!data) continue
      const vowel = isVowelLetter(letter.char)
      const hue = vowel ? 0.33 : 0.79
      const pulse = 0.55 + 0.15 * Math.sin(t * 3.0 + data.phaseOffset * Math.PI * 2)
      letter.topMaterial.color.set(0xffffff)
      letter.topMaterial.emissive.setHSL(hue, 0.55, pulse * 0.22)
      letter.topMaterial.emissiveIntensity = 0.2
      letter.sideMaterial.color.setHSL(hue, 0.45, 0.28 + pulse * 0.12)
      const bobY = Math.sin(t * 3.0 + data.phaseOffset * Math.PI * 2) * 10
      letter.root.position.set(data.baseX, data.baseY + bobY, letterAnchorZ(this.starterScale) + 0.52)
    }
  }

  spawnReplacementLetter(): void {
    const slot = this.getInactiveLetter()
    if (!slot) return
    let ch = pickWeightedLetter()
    if (Math.random() < 0.08) ch = String.fromCharCode(97 + Math.floor(Math.random() * 26))
    this.applyLetterVisual(slot, ch)
    this.placeSingleLetterRandom(slot)
  }

  spawnLettersFromTray(chars: string[]): void {
    if (!chars.length) return
    const list = chars.map((c) => c.toLowerCase())
    shuffleInPlace(list)
    for (const ch of list) {
      const slot = this.getInactiveLetter()
      if (!slot) return
      this.applyLetterVisual(slot, ch)
      this.placeSingleLetterRandom(slot)
    }
  }

  /**
   * Drop pickups as field letters near a point; optional bias toward a direction (e.g. baiter).
   */
  dropLettersAt(
    center: THREE.Vector2,
    chars: string[],
    bias?: { origin: THREE.Vector2; forward: THREE.Vector2 },
  ): void {
    if (!chars.length) return
    const list = chars.map((c) => c.toLowerCase())
    shuffleInPlace(list)
    const n = list.length
    const margin = Math.max(120, this.letterRadius * 4.2)
    const fwd = bias?.forward
    for (let i = 0; i < n; i++) {
      const slot = this.getInactiveLetter()
      if (!slot) return
      this.applyLetterVisual(slot, list[i])
      const angle = (i / Math.max(1, n - 1)) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
      const r = 35 + Math.random() * 95 + i * 0.35
      let x = center.x + Math.cos(angle) * r
      let y = center.y + Math.sin(angle) * r
      if (fwd && bias) {
        const len = Math.max(0.001, fwd.length())
        x += (fwd.x / len) * (55 + i * 8)
        y += (fwd.y / len) * (55 + i * 8)
      }
      slot.root.position.set(
        THREE.MathUtils.clamp(x, this.bounds.minX + margin, this.bounds.maxX - margin),
        THREE.MathUtils.clamp(y, this.bounds.minY + margin, this.bounds.maxY - margin),
        letterAnchorZ(this.letterRadius),
      )
    }
  }

  spawnTipLetters(count = 4): void {
    for (let n = 0; n < count; n++) {
      const slot = this.getInactiveLetter()
      if (!slot) return
      this.applyLetterVisual(slot, pickWeightedLetter())
      this.placeSingleLetterRandom(slot)
    }
  }

  getActiveLetters(): Letter[] {
    return this.letters.filter((l) => l.isActive())
  }

  /** Ambient + starter letters (anything not attached to a snake body). */
  getPickupLetters(): Letter[] {
    return this.letters.filter((l) => l.isActive() && !this.bodyLetterSet.has(l))
  }
}
