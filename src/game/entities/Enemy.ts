import * as THREE from 'three'
import { ENEMY_GRID_CELL_TWEEN_MS, type Cell, type Dir, Grid } from '../Grid'

export type EnemyRole = 'stealer' | 'giver' | 'shuffler'

const ROLE_SIZE: Record<EnemyRole, number> = {
  stealer: 1.0,
  giver: 1.0,
  shuffler: 1.0,
}

const ROLE_HUE: Record<EnemyRole, number> = {
  stealer: 0.0,
  giver: 0.33,
  shuffler: 0.77,
}

const DIRS4: Dir[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

function makeGhostTexture(hue: number): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create ghost texture context')
  ctx.clearRect(0, 0, 256, 256)

  const fill = new THREE.Color().setHSL(hue, 0.9, 0.54)
  const fillHex = `#${fill.getHexString()}`
  const shade = new THREE.Color().setHSL(hue, 0.95, 0.35)
  const shadeHex = `#${shade.getHexString()}`

  ctx.beginPath()
  ctx.moveTo(44, 160)
  ctx.lineTo(44, 108)
  ctx.arc(128, 108, 84, Math.PI, 0, false)
  ctx.lineTo(212, 160)
  ctx.lineTo(194, 176)
  ctx.lineTo(172, 156)
  ctx.lineTo(148, 178)
  ctx.lineTo(128, 156)
  ctx.lineTo(106, 178)
  ctx.lineTo(84, 156)
  ctx.lineTo(62, 176)
  ctx.closePath()
  ctx.fillStyle = fillHex
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = shadeHex
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(96, 110, 18, 0, Math.PI * 2)
  ctx.arc(160, 110, 18, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#172036'
  ctx.beginPath()
  ctx.arc(101, 114, 8, 0, Math.PI * 2)
  ctx.arc(165, 114, 8, 0, Math.PI * 2)
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeRoleIconTexture(role: EnemyRole): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create role icon texture context')
  ctx.clearRect(0, 0, 128, 128)

  let text = '?'
  let bg = '#445'
  if (role === 'stealer') { text = '-1'; bg = '#ff6b6b' }
  if (role === 'giver') { text = '+1'; bg = '#39d98a' }
  if (role === 'shuffler') { text = '↻'; bg = '#ad7bff' }

  ctx.fillStyle = 'rgba(7,10,18,0.82)'
  ctx.beginPath()
  ctx.roundRect(18, 18, 92, 92, 20)
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = bg
  ctx.stroke()
  ctx.fillStyle = bg
  ctx.font = 'bold 44px system-ui, Segoe UI, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 66)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Enemy {
  readonly mesh: THREE.Mesh
  readonly iconSprite: THREE.Sprite

  private readonly grid: Grid

  private active = false
  private originalRadius = 10
  private role: EnemyRole = 'stealer'
  private pulseTimer = 0

  private cell: Cell = { x: 0, y: 0 }

  private tweening = false
  private tweenProgress = 0
  private toCell: Cell | null = null
  private readonly fromWorld = new THREE.Vector2()
  private readonly toWorld = new THREE.Vector2()

  private patrolDir: Dir = { x: 1, y: 0 }
  private patrolTurnTimer = 0
  private patrolInterestTimer = 0
  private patrolStepsInDir = 0

  private readonly enemyBlue = new THREE.Color(0x2a7fff)
  private readonly ghostTextureByRole = new Map<EnemyRole, THREE.Texture>()
  private readonly iconTextureByRole = new Map<EnemyRole, THREE.Texture>()

  constructor(grid: Grid) {
    this.grid = grid

    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.1,
      roughness: 0.7,
      metalness: 0.0,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.set(0, 0, 0)
    this.mesh.visible = false

    this.iconSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }))
    this.iconSprite.visible = false
    this.iconSprite.renderOrder = 12
    this.mesh.add(this.iconSprite)
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

  private scorePatrolNeighbor(candidate: Cell, playerCell: Cell, usePlayerNudge: boolean): number {
    const dx = candidate.x - this.cell.x
    const dy = candidate.y - this.cell.y
    let score = Math.random() * 0.2
    // Keep some momentum, but avoid endless straight lines.
    if (dx === this.patrolDir.x && dy === this.patrolDir.y) score += 0.35
    if (this.patrolStepsInDir >= 3 && dx === this.patrolDir.x && dy === this.patrolDir.y) score -= 0.55

    if (usePlayerNudge) {
      const dNow = this.grid.cellDistanceSq(this.cell, playerCell)
      const dNext = this.grid.cellDistanceSq(candidate, playerCell)
      if (dNow > 20) {
        // Gentle pull toward player only when far, not direct pursuit.
        score += (dNow - dNext) * 0.045
      }
    }
    return score
  }

  setActive(active: boolean, cell: Cell, baseRadius: number, role: EnemyRole = 'stealer'): void {
    this.active = active
    this.mesh.visible = active
    this.iconSprite.visible = active
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
    this.patrolInterestTimer = 0.55 + Math.random() * 1.4
    this.patrolStepsInDir = 0
    this.pulseTimer = Math.random() * Math.PI * 2

    const hue = (ROLE_HUE[role] + (Math.random() - 0.5) * 0.06 + 1) % 1
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    const ghostTex = this.ghostTextureByRole.get(role) ?? makeGhostTexture(hue)
    this.ghostTextureByRole.set(role, ghostTex)
    mat.map = ghostTex
    mat.color.set(0xffffff)
    mat.emissive.set(0x000000)
    mat.emissiveIntensity = 0
    mat.needsUpdate = true

    const iconTex = this.iconTextureByRole.get(role) ?? makeRoleIconTexture(role)
    this.iconTextureByRole.set(role, iconTex)
    const iconMat = this.iconSprite.material as THREE.SpriteMaterial
    iconMat.map = iconTex
    iconMat.needsUpdate = true
    // iconSprite is parented to mesh, so keep local transforms normalized.
    // This keeps the badge visually consistent in world-space and very close
    // to the ghost head instead of exploding with parent scale.
    const desiredBadgeWorldSize = Math.max(14, r * 2.25)
    const badgeLocalScale = desiredBadgeWorldSize / Math.max(1e-6, r)
    this.iconSprite.scale.setScalar(badgeLocalScale)
    this.iconSprite.position.set(0, 2.25, 0.3)
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
      if (playerLastMoveDir.x !== 0 || playerLastMoveDir.y !== 0) {
        // Tiny forward bias keeps movement feeling less robotic when chasing.
        target = {
          x: playerCell.x + playerLastMoveDir.x,
          y: playerCell.y + playerLastMoveDir.y,
        }
        target = this.clampCellToSafeRange(this.grid.clampCell(target))
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
      // Patrol: mostly wander, with occasional soft nudges toward player.
      this.patrolTurnTimer -= deltaSeconds
      this.patrolInterestTimer -= deltaSeconds
      const wantTurn = this.patrolTurnTimer <= 0 || this.patrolStepsInDir >= 4
      if (wantTurn) {
        this.patrolDir = this.randomPatrolDir()
        this.patrolTurnTimer = 0.45 + Math.random() * 1.45
      }

      const desired = this.clampCellToSafeRange(this.grid.dirToTargetCell(this.cell, this.patrolDir))
      const blocked = desired.x === this.cell.x && desired.y === this.cell.y
      const shouldSoftNudge = this.patrolInterestTimer <= 0 && Math.random() < 0.62

      if (blocked || wantTurn || shouldSoftNudge) {
        if (shouldSoftNudge) this.patrolInterestTimer = 0.8 + Math.random() * 1.6
        let best = -Infinity
        for (const c of neighbors) {
          if (c.x === this.cell.x && c.y === this.cell.y) continue
          const score = this.scorePatrolNeighbor(c, playerCell, shouldSoftNudge)
          if (score > best) {
            best = score
            next = c
          }
        }
      } else {
        next = desired
      }

      const stepDx = next.x - this.cell.x
      const stepDy = next.y - this.cell.y
      if (stepDx !== 0 || stepDy !== 0) {
        if (stepDx === this.patrolDir.x && stepDy === this.patrolDir.y) {
          this.patrolStepsInDir++
        } else {
          this.patrolDir = { x: Math.sign(stepDx) as -1 | 0 | 1, y: Math.sign(stepDy) as -1 | 0 | 1 }
          this.patrolStepsInDir = 1
        }
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
    moveSpeedMultiplier = 1,
  ): void {
    if (!this.active) return

    this.pulseTimer += deltaSeconds * (shouldChase && !fleeMode ? 5.5 : 2.5)
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!fleeMode) mat.emissiveIntensity = 0.25 + 0.55 * Math.abs(Math.sin(this.pulseTimer))

    if (this.tweening && this.toCell) {
      const tweenMs = ENEMY_GRID_CELL_TWEEN_MS / Math.max(0.1, moveSpeedMultiplier)
      this.tweenProgress += (deltaSeconds * 1000) / tweenMs
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
      mat.emissive.set(0x1d4a99)
      this.mesh.scale.setScalar(this.originalRadius)
      this.iconSprite.visible = false
    } else {
      mat.color.set(0xffffff)
      mat.emissive.set(0x000000)
      this.mesh.scale.setScalar(this.originalRadius)
      this.iconSprite.visible = true
    }
  }
}
