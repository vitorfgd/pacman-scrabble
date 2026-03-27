import * as THREE from 'three'
import { PLAYER_GRID_CELL_TWEEN_MS, type Cell, type Dir, Grid } from '../Grid'

export class Player {
  readonly mesh: THREE.Mesh
  private size: number
  private readonly initialSize: number

  // For Word-of-the-Day glow.
  private wodGlowActive = false
  private wodGlowStartMs = 0

  private readonly grid: Grid
  private cell: Cell
  private desiredDir: Dir = { x: 0, y: 0 }
  private lastMoveDir: Dir = { x: 0, y: 0 }

  private tweening = false
  private tweenProgress = 0
  private toCell: Cell | null = null
  private readonly fromWorld = new THREE.Vector2()
  private readonly toWorld = new THREE.Vector2()
  private speedMultiplier = 1

  constructor(grid: Grid) {
    const geometry = new THREE.CircleGeometry(1, 48)
    const material = new THREE.MeshStandardMaterial({
      color: 0x33a1ff,
      emissive: new THREE.Color(0x33a1ff),
      emissiveIntensity: 0.6,
      metalness: 0.05,
      roughness: 0.25,
    })

    this.mesh = new THREE.Mesh(geometry, material)
    this.initialSize = 28
    this.size = this.initialSize
    this.mesh.scale.setScalar(this.size)

    this.grid = grid
    this.cell = this.grid.worldToCell(0, 0)
    this.mesh.position.set(this.grid.cellToWorld(this.cell).x, this.grid.cellToWorld(this.cell).y, 1)
  }

  getRadius(): number {
    return this.mesh.scale.x
  }

  /** Occupancy cell for collisions (switches halfway through a tween). */
  getCell(): Cell {
    if (!this.tweening || !this.toCell) return this.cell
    return this.tweenProgress >= 0.5 ? this.toCell : this.cell
  }

  getLastMoveDir(): Dir {
    return { x: this.lastMoveDir.x, y: this.lastMoveDir.y }
  }

  setDesiredDir(dir: Dir): void {
    this.desiredDir = dir
  }

  setCell(cell: Cell): void {
    this.tweening = false
    this.toCell = null
    this.tweenProgress = 0
    this.cell = this.grid.clampCell(cell)
    const wp = this.grid.cellToWorld(this.cell)
    this.mesh.position.set(wp.x, wp.y, 1)
  }

  setSize(size: number): void {
    this.size = Math.max(2, Math.min(250, size))
    this.mesh.scale.setScalar(this.size)
  }

  setWordOfDayGlow(active: boolean, nowMs: number): void {
    this.wodGlowActive = active
    this.wodGlowStartMs = nowMs
  }

  setSpeedMultiplier(mult: number): void {
    this.speedMultiplier = Math.max(0.1, mult)
  }

  private getSafeCellRange(): { min: number; max: number } {
    const r = this.getRadius()
    const min = Math.ceil(r / Math.max(1e-6, this.grid.cellSize))
    const max = this.grid.divisions - min
    return { min, max }
  }

  private clampCellToSafeRange(cell: Cell): Cell {
    const { min, max } = this.getSafeCellRange()
    return { x: Math.max(min, Math.min(max, cell.x)), y: Math.max(min, Math.min(max, cell.y)) }
  }

  private tryStartTweenTo(next: Cell): void {
    const fw = this.grid.cellToWorld(this.cell)
    const tw = this.grid.cellToWorld(next)
    this.fromWorld.set(fw.x, fw.y)
    this.toWorld.set(tw.x, tw.y)
    this.toCell = next
    this.tweening = true
    this.tweenProgress = 0
    this.lastMoveDir = { x: this.desiredDir.x, y: this.desiredDir.y }
  }

  private finishTween(): void {
    if (!this.toCell) return
    this.cell = this.toCell
    this.mesh.position.set(this.toWorld.x, this.toWorld.y, 1)
    this.tweening = false
    this.toCell = null
    this.tweenProgress = 0
  }

  update(deltaSeconds: number): void {
    if (this.tweening && this.toCell) {
      this.tweenProgress += ((deltaSeconds * 1000) / PLAYER_GRID_CELL_TWEEN_MS) * this.speedMultiplier
      if (this.tweenProgress >= 1) {
        this.tweenProgress = 1
        this.finishTween()
        // Chain another step if the player is still holding a direction.
        if (this.desiredDir.x !== 0 || this.desiredDir.y !== 0) {
          const next = this.clampCellToSafeRange({
            x: this.cell.x + this.desiredDir.x,
            y: this.cell.y + this.desiredDir.y,
          })
          if (next.x !== this.cell.x || next.y !== this.cell.y) this.tryStartTweenTo(next)
        }
      } else {
        // Linear motion = constant speed between cells (no ease-in/out “pause”).
        const p = Math.min(1, this.tweenProgress)
        this.mesh.position.x = THREE.MathUtils.lerp(this.fromWorld.x, this.toWorld.x, p)
        this.mesh.position.y = THREE.MathUtils.lerp(this.fromWorld.y, this.toWorld.y, p)
        this.mesh.position.z = 1
      }
    } else if (this.desiredDir.x !== 0 || this.desiredDir.y !== 0) {
      const next = this.clampCellToSafeRange({
        x: this.cell.x + this.desiredDir.x,
        y: this.cell.y + this.desiredDir.y,
      })
      if (next.x !== this.cell.x || next.y !== this.cell.y) this.tryStartTweenTo(next)
    }

    if (this.wodGlowActive) {
      const t = (performance.now() - this.wodGlowStartMs) / 1000
      const pulse = 0.5 + 0.5 * Math.sin(t * 8)
      const material = this.mesh.material as THREE.MeshStandardMaterial
      material.emissive = new THREE.Color(0x8a4fff)
      material.emissiveIntensity = 1.2 + pulse * 2.2
      if (t >= 2.0) this.wodGlowActive = false
    } else {
      const material = this.mesh.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = 0.6
      material.emissive = new THREE.Color(0x33a1ff)
    }
  }
}
