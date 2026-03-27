import * as THREE from 'three'
import { Letter } from './entities/Letter'
import { isVowelLetter } from './LetterScoring'
import type { Cell, Grid } from './Grid'

type ThemeMode = 'dark' | 'light'

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

function makeLetterTexture(char: string, themeMode: ThemeMode): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context for letter texture')

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const isDark = themeMode === 'dark'

  const baseFill = isDark ? 'rgba(8, 8, 18, 0.55)' : 'rgba(122, 54, 221, 0.10)'
  const baseStroke = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(122, 54, 221, 0.22)'
  const shadowColor = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(122, 54, 221, 0.25)'
  const letterFill = isDark ? 'rgba(255,255,255,0.98)' : 'rgba(27, 31, 48, 0.96)'
  const letterStroke = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.7)'

  const pad = 14
  const side = canvas.width - pad * 2
  ctx.fillStyle = baseFill
  ctx.fillRect(pad, pad, side, side)
  ctx.lineWidth = 6
  ctx.strokeStyle = baseStroke
  ctx.strokeRect(pad, pad, side, side)

  ctx.shadowColor = shadowColor
  ctx.shadowBlur = 10
  ctx.fillStyle = letterFill
  ctx.font = 'bold 128px system-ui, Segoe UI, Roboto, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char.toUpperCase(), 96, 104)

  ctx.shadowBlur = 0
  ctx.strokeStyle = letterStroke
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
  private readonly grid: Grid

  private readonly letterRadius: number
  private maxLetters = 300
  private starterScale = 58

  private readonly letters: Letter[] = []
  private readonly textureByChar = new Map<string, THREE.Texture>()
  private themeMode: ThemeMode = 'dark'

  // Starter-letter tracking — using a Set so there is zero ambiguity about
  // which pool slots are "reserved" for the intro word.
  private readonly starterLetterSet = new Set<Letter>()
  private readonly starterAnimData = new Map<Letter, StarterAnim>()

  private spawnExclusionRadius = 0
  private readonly spawnExclusionCenter = new THREE.Vector2(0, 0)

  constructor(options: {
    scene: THREE.Scene
    grid: Grid
    letterRadius?: number
    maxLetters?: number
    starterScale?: number
    themeMode?: ThemeMode
  }) {
    this.scene = options.scene
    this.grid = options.grid
    this.letterRadius = options.letterRadius ?? 26
    if (options.maxLetters != null) this.maxLetters = options.maxLetters
    if (options.starterScale != null) this.starterScale = options.starterScale
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
      this.scene.add(sprite)
      this.letters.push(new Letter(sprite, '', this.letterRadius))
    }
  }

  private getLetterTexture(char: string): THREE.Texture {
    const existing = this.textureByChar.get(char)
    if (existing) return existing
    const tex = makeLetterTexture(char, this.themeMode)
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
    const x = Math.floor(Math.random() * (this.grid.divisions + 1))
    const y = Math.floor(Math.random() * (this.grid.divisions + 1))
    const cell = this.grid.clampCell({ x, y })
    const wp = this.grid.cellToWorld(cell)
    letter.setCell(cell)
    letter.sprite.position.set(wp.x, wp.y, 1)
  }

  /** Grid cells far enough from spawn (0,0) to place random field letters — uniform spread, no edge clumping. */
  private cellsOutsideSpawnExclusion(): Cell[] {
    const cx = this.spawnExclusionCenter.x
    const cy = this.spawnExclusionCenter.y
    const rSq = this.spawnExclusionRadius * this.spawnExclusionRadius
    const out: Cell[] = []
    const d = this.grid.divisions
    for (let x = 0; x <= d; x++) {
      for (let y = 0; y <= d; y++) {
        const cell = this.grid.clampCell({ x, y })
        const wp = this.grid.cellToWorld(cell)
        const dx = wp.x - cx
        const dy = wp.y - cy
        if (dx * dx + dy * dy >= rSq) out.push(cell)
      }
    }
    return out
  }

  /** One letter per shuffled cell so the map fills evenly (no clusters shoved to the rim). */
  private placeRandomLetterField(count: number): void {
    this.clearLetters()
    const candidates = this.cellsOutsideSpawnExclusion()
    shuffleInPlace(candidates)
    const n = Math.min(count, candidates.length, this.letters.length)
    for (let i = 0; i < n; i++) {
      const cell = candidates[i]!
      const ch = pickWeightedLetter()
      const l = this.letters[i]
      this.applyLetterVisual(l, ch)
      const wp = this.grid.cellToWorld(cell)
      l.setCell(cell)
      l.sprite.position.set(wp.x, wp.y, 1)
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fill the map with random letters outside a modest spawn bubble; leaves
   * `reserveInactive` slots inactive for the starter word.
   */
  initRandomFill(reserveInactive = 3): void {
    this.starterLetterSet.clear()
    this.starterAnimData.clear()
    // Small exclusion only — avoids a huge empty ring around spawn while keeping starter letters clear.
    this.spawnExclusionRadius = 400
    this.spawnExclusionCenter.set(0, 0)

    const count = Math.max(0, this.maxLetters - reserveInactive)
    this.placeRandomLetterField(count)

    this.spawnExclusionRadius = 0
  }

  /**
   * Place the letters of `word` in a vertical column below the player with one empty block gap.
   * First letter sits two cells under `center`, then further down; if there is no room, uses a horizontal row under the player.
   */
  spawnStarterWord(word: string, center: THREE.Vector2): void {
    this.starterLetterSet.clear()
    this.starterAnimData.clear()

    const chars = word.toLowerCase().split('')
    const starterScale = this.starterScale
    const n = chars.length
    const pc = this.grid.worldToCell(center.x, center.y)

    // Downward column: y decreases (world "down") with one-cell buffer from player.
    const startY = pc.y - 2
    const lastY = startY - (n - 1)
    if (lastY >= 0) {
      for (let i = 0; i < n; i++) {
        const slot = this.getInactiveLetter()
        if (!slot) return

        this.applyLetterVisual(slot, chars[i])
        slot.sprite.scale.setScalar(starterScale)

        const cell = this.grid.clampCell({ x: pc.x, y: startY - i })
        const wp = this.grid.cellToWorld(cell)
        slot.setCell(cell)
        slot.sprite.position.set(wp.x, wp.y, 2)

        this.starterLetterSet.add(slot)
        this.starterAnimData.set(slot, { baseX: wp.x, baseY: wp.y, phaseOffset: i / Math.max(1, n) })
      }
      return
    }

    // Not enough room below (near map bottom): horizontal row under the player.
    const spacing = this.grid.cellSize
    const totalWidth = (n - 1) * spacing
    const by = center.y - this.grid.cellSize * 3.25
    for (let i = 0; i < n; i++) {
      const slot = this.getInactiveLetter()
      if (!slot) return
      this.applyLetterVisual(slot, chars[i])
      slot.sprite.scale.setScalar(starterScale)
      const bx = center.x - totalWidth / 2 + i * spacing
      const snapped = this.grid.snapWorldToCell(bx, by)
      slot.setCell(snapped.cell)
      slot.sprite.position.set(snapped.world.x, snapped.world.y, 2)
      this.starterLetterSet.add(slot)
      this.starterAnimData.set(slot, { baseX: snapped.world.x, baseY: snapped.world.y, phaseOffset: i / Math.max(1, n) })
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
      // Keep starter letters fixed on grid points so grid-cell collisions remain consistent.
      letter.sprite.position.set(data.baseX, data.baseY, 2)
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
