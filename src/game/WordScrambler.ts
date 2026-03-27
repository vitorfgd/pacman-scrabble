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
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for letter texture')

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const isDark = themeMode === 'dark'

  const baseFill = isDark ? 'rgba(8, 8, 18, 0.55)' : 'rgba(122, 54, 221, 0.10)'
  const baseStroke = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(122, 54, 221, 0.22)'
  const shadowColor = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(122, 54, 221, 0.25)'
  const letterFill = isDark ? 'rgba(255,255,255,0.98)' : 'rgba(27, 31, 48, 0.96)'
  const letterStroke = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.7)'

  const pad = 12
  const rw = canvas.width - pad * 2
  const rh = canvas.height - pad * 2
  const corner = 26
  ctx.beginPath()
  ctx.roundRect(pad, pad, rw, rh, corner)
  ctx.fillStyle = baseFill
  ctx.fill()
  ctx.lineWidth = 7
  ctx.strokeStyle = baseStroke
  ctx.stroke()

  const cx = canvas.width / 2
  const cy = canvas.height / 2 + 6
  ctx.shadowColor = shadowColor
  ctx.shadowBlur = 12
  ctx.fillStyle = letterFill
  ctx.font = 'bold 168px system-ui, Segoe UI, Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char.toUpperCase(), cx, cy)

  ctx.shadowBlur = 0
  ctx.strokeStyle = letterStroke
  ctx.lineWidth = 12
  ctx.strokeText(char.toUpperCase(), cx, cy)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface StarterAnim {
  baseX: number
  baseY: number
  phaseOffset: number
}

export class WordScrambler {
  private readonly scene: THREE.Scene
  private readonly bounds: Bounds

  private readonly letterRadius: number
  private maxLetters = 1200
  private starterScale = 58
  private starterSpacing = 92

  private readonly letters: Letter[] = []
  private readonly textureByChar = new Map<string, THREE.Texture>()
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
    else this.maxLetters = 1200
    if (options.starterScale != null) this.starterScale = options.starterScale
    if (options.starterSpacing != null) this.starterSpacing = options.starterSpacing
    if (options.themeMode != null) this.themeMode = options.themeMode
    this.buildPool()
  }

  private buildPool() {
    for (let i = 0; i < this.maxLetters; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
        }),
      )
      sprite.scale.setScalar(this.letterRadius)
      sprite.position.set(0, 0, 1)
      sprite.renderOrder = 1
      this.scene.add(sprite)
      this.letters.push(new Letter(sprite, '', this.letterRadius))
    }
  }

  private getLetterTexture(char: string): THREE.Texture {
    const existing = this.textureByChar.get(char)
    if (existing) return existing
    const tex = makeFieldLetterTexture(char, this.themeMode)
    this.textureByChar.set(char, tex)
    return tex
  }

  setThemeMode(themeMode: ThemeMode): void {
    if (this.themeMode === themeMode) return
    this.themeMode = themeMode
    // Textures are theme-specific, so clear the cache and refresh active sprites.
    this.textureByChar.clear()
    for (const l of this.letters) {
      if (!l.isActive()) continue
      const mat = l.sprite.material as THREE.SpriteMaterial
      mat.map = this.getLetterTexture(l.char)
      mat.needsUpdate = true
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
   * Field letter becomes a snake body segment (same sprite). Call after spawnReplacementLetter.
   */
  promoteFieldLetterToBody(letter: Letter): void {
    this.starterLetterSet.delete(letter)
    this.starterAnimData.delete(letter)
    this.bodyLetterSet.add(letter)
    const s = this.letterRadius * 0.82
    letter.sprite.scale.setScalar(s)
    letter.sprite.position.z = 1
  }

  /**
   * New body segment from a pooled inactive letter (e.g. when tray grows without a field pickup).
   */
  acquireBodyLetter(char: string): Letter | null {
    const slot = this.getInactiveLetter()
    if (!slot) return null
    this.applyLetterVisual(slot, char)
    const s = this.letterRadius * 0.82
    slot.sprite.scale.setScalar(s)
    this.bodyLetterSet.add(slot)
    slot.sprite.position.z = 1
    return slot
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
    letter.sprite.scale.setScalar(this.letterRadius)
    const tex = this.getLetterTexture(ch)
    const mat = letter.sprite.material as THREE.SpriteMaterial
    mat.map = tex
    const vowel = isVowelLetter(ch)
    mat.color.set(vowel ? 0x6bcb77 : 0xc084fc)
    mat.needsUpdate = true
    mat.depthTest = false
    mat.depthWrite = false
  }

  private placeSingleLetterRandom(letter: Letter): void {
    const margin = Math.max(120, this.letterRadius * 4.2)
    const p = this.randomInBounds(margin)
    letter.sprite.position.set(
      THREE.MathUtils.clamp(p.x, this.bounds.minX + this.letterRadius, this.bounds.maxX - this.letterRadius),
      THREE.MathUtils.clamp(p.y, this.bounds.minY + this.letterRadius, this.bounds.maxY - this.letterRadius),
      1,
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

        l.sprite.position.set(
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
          1,
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
      slot.sprite.scale.setScalar(starterScale)

      const bx = center.x - totalWidth / 2 + i * spacing
      slot.sprite.position.set(bx, by, 2)

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
      const mat = letter.sprite.material as THREE.SpriteMaterial
      const vowel = isVowelLetter(letter.char)
      const hue = vowel ? 0.33 : 0.79
      const pulse = 0.55 + 0.15 * Math.sin(t * 3.0 + data.phaseOffset * Math.PI * 2)
      mat.color.setHSL(hue, 1.0, pulse)
      const bobY = Math.sin(t * 3.0 + data.phaseOffset * Math.PI * 2) * 10
      letter.sprite.position.set(data.baseX, data.baseY + bobY, 2)
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
      slot.sprite.position.set(
        THREE.MathUtils.clamp(x, this.bounds.minX + margin, this.bounds.maxX - margin),
        THREE.MathUtils.clamp(y, this.bounds.minY + margin, this.bounds.maxY - margin),
        1,
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
