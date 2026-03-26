import * as THREE from 'three'
import { Letter } from './entities/Letter'
import { isVowelLetter } from './LetterScoring'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

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

function makeLetterTexture(char: string): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for letter texture')

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.beginPath()
  ctx.arc(96, 96, 76, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 8, 18, 0.55)'
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.stroke()

  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 10
  ctx.fillStyle = 'rgba(255,255,255,0.98)'
  ctx.font = 'bold 128px system-ui, Segoe UI, Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char.toUpperCase(), 96, 104)

  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 12
  ctx.strokeText(char.toUpperCase(), 96, 104)

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
  private maxLetters = 300

  private readonly letters: Letter[] = []
  private readonly textureByChar = new Map<string, THREE.Texture>()

  // Starter-letter tracking — using a Set so there is zero ambiguity about
  // which pool slots are "reserved" for the intro word.
  private readonly starterLetterSet = new Set<Letter>()
  private readonly starterAnimData = new Map<Letter, StarterAnim>()

  // When > 0, randomInBounds retries positions that fall inside this circle.
  private spawnExclusionRadius = 0
  private readonly spawnExclusionCenter = new THREE.Vector2(0, 0)

  constructor(options: {
    scene: THREE.Scene
    bounds: Bounds
    letterRadius?: number
    maxLetters?: number
  }) {
    this.scene = options.scene
    this.bounds = options.bounds
    this.letterRadius = options.letterRadius ?? 26
    if (options.maxLetters != null) this.maxLetters = options.maxLetters
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
      this.scene.add(sprite)
      this.letters.push(new Letter(sprite, '', this.letterRadius))
    }
  }

  private getLetterTexture(char: string): THREE.Texture {
    const existing = this.textureByChar.get(char)
    if (existing) return existing
    const tex = makeLetterTexture(char)
    this.textureByChar.set(char, tex)
    return tex
  }

  private clearLetters() {
    for (const l of this.letters) l.setActive(false)
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
    const starterScale = 58
    const spacing = 92
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
}
