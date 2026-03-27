import * as THREE from 'three'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Patrols between waypoints; when the player is within aggro range, locks onto a straight
 * dash toward them (bullet-like, no steering) for a few seconds, then returns to patrol.
 */
export class Enemy {
  readonly mesh: THREE.Mesh

  private active = false
  private originalRadius = 10
  private slowUntilMs = 0
  private pulseTimer = 0

  private readonly enemyBlue = new THREE.Color(0x2a7fff)
  private readonly powerShrink = 0.65
  private originalColor = new THREE.Color(0xff4d4d)

  /** Squared distance to player to trigger a straight-line dash. */
  private readonly aggroRangeSq = 520 * 520
  /** How long the dash lasts before returning to patrol. */
  private readonly dashDurationMs = 2200
  private readonly dashSpeedMult = 5.4
  private dashActive = false
  private dashEndMs = 0
  private readonly dashDir = new THREE.Vector2(1, 0)

  private readonly steer = new THREE.Vector2(1, 0)
  private readonly patrolWaypoint = new THREE.Vector2(0, 0)
  private patrolBounds: Bounds | null = null
  /** Expanded submit gate — enemies steer / spawn outside this box. */
  private gateAvoidRect: Bounds | null = null

  constructor() {
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

  getRadius(): number {
    return this.mesh.scale.x
  }

  setActive(active: boolean, position: THREE.Vector2, baseRadius: number): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return

    const r = Math.max(4, baseRadius * 1.08)
    this.originalRadius = r
    this.mesh.scale.setScalar(r)
    this.mesh.position.set(position.x, position.y, 1)

    this.slowUntilMs = 0
    this.pulseTimer = Math.random() * Math.PI * 2
    this.steer.set(Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
    this.dashActive = false
    this.dashEndMs = 0

    const mat = this.mesh.material as THREE.MeshStandardMaterial
    const hue = Math.random()
    mat.color.setHSL(hue, 0.95, 0.52)
    mat.emissive.setHSL(hue, 0.9, 0.32)
    this.originalColor = mat.color.clone()
  }

  /** Call after setActive when spawning; also sets first waypoint outside the gate zone. */
  setPatrolBounds(mapBounds: Bounds, gateAvoid: Bounds): void {
    this.patrolBounds = mapBounds
    this.gateAvoidRect = gateAvoid
    this.refreshPatrolWaypoint()
  }

  private static pointInRect(x: number, y: number, r: Bounds): boolean {
    return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY
  }

  /** Shortest exit through nearest edge (radial from center often stays inside a rectangle). */
  private static nearestOutsidePoint(x: number, y: number, r: Bounds, clearance: number): { x: number; y: number } {
    if (!Enemy.pointInRect(x, y, r)) return { x, y }
    const dL = x - r.minX
    const dR = r.maxX - x
    const dB = y - r.minY
    const dT = r.maxY - y
    const m = Math.min(dL, dR, dB, dT)
    if (m === dL) return { x: r.minX - clearance, y }
    if (m === dR) return { x: r.maxX + clearance, y }
    if (m === dB) return { x, y: r.minY - clearance }
    return { x, y: r.maxY + clearance }
  }

  private static segSeg(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
  ): boolean {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
    if (Math.abs(d) < 1e-12) return false
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d
    return t >= 0 && t <= 1 && u >= 0 && u <= 1
  }

  /** Line segment vs axis-aligned rectangle (for path-through-gate checks). */
  private static segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, r: Bounds): boolean {
    const { minX, maxX, minY, maxY } = r
    if (Enemy.pointInRect(ax, ay, r) || Enemy.pointInRect(bx, by, r)) return true
    return (
      Enemy.segSeg(ax, ay, bx, by, minX, minY, maxX, minY) ||
      Enemy.segSeg(ax, ay, bx, by, minX, maxY, maxX, maxY) ||
      Enemy.segSeg(ax, ay, bx, by, minX, minY, minX, maxY) ||
      Enemy.segSeg(ax, ay, bx, by, maxX, minY, maxX, maxY)
    )
  }

  /**
   * New waypoint: outside gate box, and straight line from `from` does not cut through the box
   * (so we don’t “aim” through the no-go zone and fight the escape steering).
   */
  private refreshPatrolWaypoint(): void {
    const b = this.patrolBounds
    const a = this.gateAvoidRect
    if (!b) return
    const span = Math.min(b.maxX - b.minX, b.maxY - b.minY)
    const margin = Math.max(120, span * 0.08)
    const fx = this.mesh.position.x
    const fy = this.mesh.position.y

    for (let t = 0; t < 90; t++) {
      const x = THREE.MathUtils.lerp(b.minX + margin, b.maxX - margin, Math.random())
      const y = THREE.MathUtils.lerp(b.minY + margin, b.maxY - margin, Math.random())
      if (a && Enemy.pointInRect(x, y, a)) continue
      if (a && Enemy.segmentIntersectsRect(fx, fy, x, y, a)) continue
      this.patrolWaypoint.set(x, y)
      return
    }
    if (a) {
      const p = Enemy.nearestOutsidePoint(fx, fy, a, 120)
      this.patrolWaypoint.set(
        THREE.MathUtils.clamp(p.x, b.minX + margin, b.maxX - margin),
        THREE.MathUtils.clamp(p.y, b.minY + margin, b.maxY - margin),
      )
    } else {
      this.patrolWaypoint.set(
        THREE.MathUtils.lerp(b.minX + margin, b.maxX - margin, Math.random()),
        THREE.MathUtils.lerp(b.minY + margin, b.maxY - margin, Math.random()),
      )
    }
  }

  applySlowFor(durationMs: number, nowMs: number): void {
    this.slowUntilMs = Math.max(this.slowUntilMs, nowMs + durationMs)
  }

  update(
    deltaSeconds: number,
    playerPos: THREE.Vector2,
    bounds: Bounds,
    speedScale: number,
    nowMs: number,
    fleeMode: boolean,
  ): void {
    if (!this.active) return

    const pos = this.mesh.position
    const dir = new THREE.Vector2()

    if (fleeMode) {
      this.dashActive = false
      dir.set(pos.x - playerPos.x, pos.y - playerPos.y)
      const len = dir.length()
      if (len > 0.0001) dir.divideScalar(len)
      else dir.set(Math.random() - 0.5, Math.random() - 0.5).normalize()
    } else {
      if (this.dashActive && nowMs >= this.dashEndMs) {
        this.dashActive = false
        this.refreshPatrolWaypoint()
      }
      if (this.dashActive) {
        dir.copy(this.dashDir)
      } else {
      const toPx = playerPos.x - pos.x
      const toPy = playerPos.y - pos.y
      const distSq = toPx * toPx + toPy * toPy
      if (distSq > 1e-6 && distSq <= this.aggroRangeSq) {
        this.dashDir.set(toPx, toPy)
        const len = this.dashDir.length()
        if (len > 1e-6) this.dashDir.divideScalar(len)
        else this.dashDir.set(1, 0)
        this.dashActive = true
        this.dashEndMs = nowMs + this.dashDurationMs
        dir.copy(this.dashDir)
      } else {
      const wp = this.patrolWaypoint
      const r = this.getRadius()
      const avoid = this.gateAvoidRect
      const clearance = r + 28

      const d = Math.hypot(wp.x - pos.x, wp.y - pos.y)
      if (d < 160 + r) {
        this.refreshPatrolWaypoint()
      } else if (avoid && Enemy.segmentIntersectsRect(pos.x, pos.y, wp.x, wp.y, avoid)) {
        this.refreshPatrolWaypoint()
      }

      const wp2 = this.patrolWaypoint
      const desired = new THREE.Vector2(wp2.x - pos.x, wp2.y - pos.y)
      let len = desired.length()

      if (avoid && Enemy.pointInRect(pos.x, pos.y, avoid)) {
        const out = Enemy.nearestOutsidePoint(pos.x, pos.y, avoid, clearance)
        desired.set(out.x - pos.x, out.y - pos.y)
        len = desired.length()
        if (len < 1e-6) {
          desired.set(Math.random() - 0.5, Math.random() - 0.5).normalize()
        } else {
          desired.divideScalar(len)
        }
        this.steer.copy(desired)
        dir.copy(this.steer)
      } else {
        if (len > 0.0001) desired.divideScalar(len)
        else desired.set(1, 0)

        const turn = Math.min(1, deltaSeconds * 10)
        this.steer.lerp(desired, turn)
        if (this.steer.lengthSq() > 1e-8) this.steer.normalize()
        dir.copy(this.steer)
      }
      }
      }
    }

    this.pulseTimer += deltaSeconds * (!fleeMode ? 4 : 2.5)
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!fleeMode) {
      mat.emissiveIntensity = 0.2 + 0.45 * Math.abs(Math.sin(this.pulseTimer))
    }

    const fleeBoost = fleeMode ? 1.3 : 1.0
    const dashBoost = !fleeMode && this.dashActive ? this.dashSpeedMult : 1.0
    const slowMult = nowMs < this.slowUntilMs ? 0.22 : 1.0
    const baseMove = 68
    const speed = speedScale * slowMult * fleeBoost * dashBoost * baseMove

    pos.x += dir.x * speed * deltaSeconds
    pos.y += dir.y * speed * deltaSeconds

    const r = this.getRadius()
    pos.x = THREE.MathUtils.clamp(pos.x, bounds.minX + r, bounds.maxX - r)
    pos.y = THREE.MathUtils.clamp(pos.y, bounds.minY + r, bounds.maxY - r)
    pos.z = 1

    const avoid = this.gateAvoidRect
    if (!this.dashActive && avoid && Enemy.pointInRect(pos.x, pos.y, avoid)) {
      const clearance = r + 28
      const out = Enemy.nearestOutsidePoint(pos.x, pos.y, avoid, clearance)
      pos.x = THREE.MathUtils.clamp(out.x, bounds.minX + r, bounds.maxX - r)
      pos.y = THREE.MathUtils.clamp(out.y, bounds.minY + r, bounds.maxY - r)
    }
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
