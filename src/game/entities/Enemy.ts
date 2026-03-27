import * as THREE from 'three'
import { ENEMY_GRID_CELL_TWEEN_MS, type Cell, type Dir, Grid } from '../Grid'

export type EnemyRole = 'chaser' | 'interceptor' | 'pin'

const ROLE_SIZE: Record<EnemyRole, number> = {
  chaser: 1.0,
  interceptor: 1.0,
  pin: 1.0,
}

const ROLE_HUE: Record<EnemyRole, number> = {
  chaser: 0.0,
  interceptor: 0.08,
  pin: 0.77,
}

const DIRS4: Dir[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export class Enemy {
  readonly mesh: THREE.Mesh

  private readonly grid: Grid

  private active = false
  private originalRadius = 10
  private role: EnemyRole = 'chaser'
  private pulseTimer = 0

  private cell: Cell = { x: 0, y: 0 }

  private tweening = false
  private tweenProgress = 0
  private toCell: Cell | null = null
  private readonly fromWorld = new THREE.Vector2()
  private readonly toWorld = new THREE.Vector2()

  private patrolDir: Dir = { x: 1, y: 0 }
  private patrolTurnTimer = 0

  private readonly enemyBlue = new THREE.Color(0x2a7fff)
  private readonly powerShrink = 0.65
  private originalColor = new THREE.Color(0xff4d4d)

  constructor(grid: Grid) {
    this.grid = grid

    const geometry = new THREE.CircleGeometry(1, 3)
    const material = new THREE.MeshStandardMaterial({
      color: 0xff4d4d,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 0.0,
      roughness: 0.6,
      metalness: 0.15,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.set(0, 0, 0)
    this.mesh.visible = false
  }

  isActive(): boolean {
    return this.active
  }
  getRole(): EnemyRole {
    return this.role
  }
  getRadius(): number {
    return this.mesh.scale.x
  }

  /** Occupancy cell for collisions (switches halfway through a tween). */
  getCell(): Cell {
    if (!this.tweening || !this.toCell) return this.cell
    return this.tweenProgress >= 0.5 ? this.toCell : this.cell
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

  private randomPatrolDir(): Dir {
    const d = DIRS4[Math.floor(Math.random() * DIRS4.length)] ?? { x: 1, y: 0 }
    return { x: d.x, y: d.y }
  }

  setActive(active: boolean, cell: Cell, baseRadius: number, role: EnemyRole = 'chaser'): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return

    this.role = role
    const r = Math.max(4, baseRadius * ROLE_SIZE[role])
    this.originalRadius = r
    this.mesh.scale.setScalar(r)

    this.tweening = false
    this.toCell = null
    this.tweenProgress = 0

    this.cell = this.clampCellToSafeRange(this.grid.clampCell(cell))
    const wp = this.grid.cellToWorld(this.cell)
    this.mesh.position.set(wp.x, wp.y, 1)

    this.patrolDir = this.randomPatrolDir()
    this.patrolTurnTimer = 0.9 + Math.random() * 2.2
    this.pulseTimer = Math.random() * Math.PI * 2

    const mat = this.mesh.material as THREE.MeshStandardMaterial
    const hue = (ROLE_HUE[role] + (Math.random() - 0.5) * 0.07 + 1) % 1
    mat.color.setHSL(hue, 1.0, 0.52)
    mat.emissive.setHSL(hue, 1.0, 0.35)
    this.originalColor = mat.color.clone()
  }

  private pickNextCell(
    playerCell: Cell,
    playerLastMoveDir: Dir,
    shouldChase: boolean,
    fleeMode: boolean,
    deltaSeconds: number,
  ): Cell {
    const neighbors = this.grid.getNeighbors4(this.cell).map((c) => this.clampCellToSafeRange(c))

    let next = this.cell
    if (fleeMode) {
      let best = -Infinity
      for (const c of neighbors) {
        const d = this.grid.cellDistanceSq(c, playerCell)
        if (d > best) {
          best = d
          next = c
        }
      }
    } else if (shouldChase) {
      let target: Cell = playerCell
      if (this.role === 'interceptor') {
        const ahead = 3
        target = { x: playerCell.x + playerLastMoveDir.x * ahead, y: playerCell.y + playerLastMoveDir.y * ahead }
        target = this.clampCellToSafeRange(this.grid.clampCell(target))
      } else if (this.role === 'pin') {
        const ahead = 2
        if (playerLastMoveDir.x !== 0 || playerLastMoveDir.y !== 0) {
          target = { x: playerCell.x + playerLastMoveDir.x * ahead, y: playerCell.y + playerLastMoveDir.y * ahead }
          target = this.clampCellToSafeRange(this.grid.clampCell(target))
        }
      }

      let best = Infinity
      for (const c of neighbors) {
        const d = this.grid.cellDistanceSq(c, target)
        if (d < best) {
          best = d
          next = c
        }
      }
    } else {
      // Patrol: follow patrolDir; on wall hit, pick a new heading or a random open neighbor.
      this.patrolTurnTimer -= deltaSeconds
      if (this.patrolTurnTimer <= 0) {
        this.patrolDir = this.randomPatrolDir()
        this.patrolTurnTimer = 0.8 + Math.random() * 2.4
      }

      const desired = this.clampCellToSafeRange(this.grid.dirToTargetCell(this.cell, this.patrolDir))
      const blocked = desired.x === this.cell.x && desired.y === this.cell.y
      if (blocked) {
        this.patrolDir = this.randomPatrolDir()
        const alt = this.clampCellToSafeRange(this.grid.dirToTargetCell(this.cell, this.patrolDir))
        if (alt.x !== this.cell.x || alt.y !== this.cell.y) {
          next = alt
        } else {
          next = neighbors[Math.floor(Math.random() * neighbors.length)] ?? this.cell
        }
      } else {
        next = desired
      }
    }

    return next
  }

  private startTweenTo(next: Cell): void {
    const fw = this.grid.cellToWorld(this.cell)
    const tw = this.grid.cellToWorld(next)
    this.fromWorld.set(fw.x, fw.y)
    this.toWorld.set(tw.x, tw.y)
    this.toCell = next
    this.tweening = true
    this.tweenProgress = 0
  }

  private finishTween(): void {
    if (!this.toCell) return
    this.cell = this.toCell
    this.mesh.position.set(this.toWorld.x, this.toWorld.y, 1)
    this.tweening = false
    this.toCell = null
    this.tweenProgress = 0
  }

  update(
    deltaSeconds: number,
    playerCell: Cell,
    playerLastMoveDir: Dir,
    shouldChase: boolean,
    fleeMode: boolean,
  ): void {
    if (!this.active) return

    this.pulseTimer += deltaSeconds * (shouldChase && !fleeMode ? 5.5 : 2.5)
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!fleeMode) mat.emissiveIntensity = 0.25 + 0.55 * Math.abs(Math.sin(this.pulseTimer))

    if (this.tweening && this.toCell) {
      this.tweenProgress += (deltaSeconds * 1000) / ENEMY_GRID_CELL_TWEEN_MS
      if (this.tweenProgress >= 1) {
        this.tweenProgress = 1
        this.finishTween()
        const next = this.pickNextCell(playerCell, playerLastMoveDir, shouldChase, fleeMode, deltaSeconds)
        if (next.x !== this.cell.x || next.y !== this.cell.y) this.startTweenTo(next)
      } else {
        const p = Math.min(1, this.tweenProgress)
        this.mesh.position.x = THREE.MathUtils.lerp(this.fromWorld.x, this.toWorld.x, p)
        this.mesh.position.y = THREE.MathUtils.lerp(this.fromWorld.y, this.toWorld.y, p)
        this.mesh.position.z = 1
      }
      return
    }

    const next = this.pickNextCell(playerCell, playerLastMoveDir, shouldChase, fleeMode, deltaSeconds)
    if (next.x !== this.cell.x || next.y !== this.cell.y) this.startTweenTo(next)
  }

  setPowerMode(active: boolean): void {
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!this.active) return
    if (active) {
      mat.color.copy(this.enemyBlue)
      mat.emissive.set(0x0044aa)
      this.mesh.scale.setScalar(this.originalRadius * this.powerShrink)
    } else {
      mat.color.copy(this.originalColor)
      mat.emissive.copy(this.originalColor).multiplyScalar(0.6)
      this.mesh.scale.setScalar(this.originalRadius)
    }
  }
}
