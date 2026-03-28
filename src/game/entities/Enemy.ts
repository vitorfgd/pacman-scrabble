import * as THREE from 'three'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Flat hexagon — reads as a hostile “chaser” / drone, not a star-shaped pickup.
 */
function createHunterHexGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  const sides = 6
  const r = 1
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

/**
 * Patrols between waypoints; when the player is within aggro range, locks onto a straight
 * dash toward them (bullet-like, no steering) for a few seconds, then returns to patrol.
 */
export class Enemy {
  private static readonly sharedGeometry: THREE.ShapeGeometry = createHunterHexGeometry()

  /** Root group (position / scale / spin). Game uses this like a mesh. */
  readonly mesh: THREE.Group

  private readonly coreMesh: THREE.Mesh
  private readonly glowMesh: THREE.Mesh
  private readonly coreMat: THREE.MeshStandardMaterial
  private readonly glowMat: THREE.MeshBasicMaterial

  private active = false
  private originalRadius = 10
  private slowUntilMs = 0
  private pulseTimer = 0

  private readonly powerShrink = 0.65
  private originalColor = new THREE.Color()
  private originalEmissive = new THREE.Color()
  private originalGlowColor = new THREE.Color()
  private baseEmissiveIntensity = 3.35

  /** Squared distance to player to trigger a straight-line dash. */
  private readonly aggroRangeSq = 520 * 520
  /** How long the dash lasts before returning to patrol. */
  private readonly dashDurationMs = 2200
  private readonly dashSpeedMult = 6.2
  private dashActive = false
  private dashEndMs = 0
  private readonly dashDir = new THREE.Vector2(1, 0)

  private readonly steer = new THREE.Vector2(1, 0)
  private readonly patrolWaypoint = new THREE.Vector2(0, 0)
  private patrolBounds: Bounds | null = null
  /** Expanded submit gate — enemies steer / spawn outside this box. */
  private gateAvoidRect: Bounds | null = null

  constructor() {
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x120308,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 3.35,
      metalness: 0.42,
      roughness: 0.22,
    })
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xff3a18,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

    this.coreMesh = new THREE.Mesh(Enemy.sharedGeometry, this.coreMat)
    this.coreMesh.position.z = 0.06
    this.coreMesh.renderOrder = 14

    this.glowMesh = new THREE.Mesh(Enemy.sharedGeometry, this.glowMat)
    this.glowMesh.scale.setScalar(1.3)
    this.glowMesh.position.z = 0
    this.glowMesh.renderOrder = 13

    this.mesh = new THREE.Group()
    this.mesh.add(this.glowMesh)
    this.mesh.add(this.coreMesh)
    this.mesh.position.set(0, 0, 1)
    this.mesh.visible = false
  }

  isActive(): boolean {
    return this.active
  }

  /** True while executing a straight-line aggro dash toward the player. */
  isDashActive(): boolean {
    return this.dashActive
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

    const hue = Math.random()
    this.originalColor.setHSL(hue, 0.97, 0.22)
    this.coreMat.color.copy(this.originalColor)
    this.originalEmissive.setHSL((hue + 0.02) % 1, 1, 0.52)
    this.coreMat.emissive.copy(this.originalEmissive)
    this.baseEmissiveIntensity = 3.1 + Math.random() * 0.55
    this.coreMat.emissiveIntensity = this.baseEmissiveIntensity

    this.originalGlowColor.setHSL((hue + 0.01) % 1, 1, 0.64)
    this.glowMat.color.copy(this.originalGlowColor)
    this.glowMat.opacity = 0.72
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
    playerInSafeZone: boolean,
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
      if (playerInSafeZone) {
        this.dashActive = false
      }
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
        if (!playerInSafeZone && distSq > 1e-6 && distSq <= this.aggroRangeSq) {
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

    this.pulseTimer += deltaSeconds * (!fleeMode ? 5.2 : 2.8)
    this.mesh.rotation.z += deltaSeconds * (fleeMode ? 0.62 : 0.34)

    if (!fleeMode) {
      const wobble = 0.55 + 0.45 * Math.abs(Math.sin(this.pulseTimer))
      this.coreMat.emissiveIntensity = this.baseEmissiveIntensity * (0.88 + 0.42 * wobble)
      this.glowMat.opacity = 0.55 + 0.38 * wobble
    } else {
      this.coreMat.emissiveIntensity = 3.85
      this.glowMat.opacity = 0.78
    }

    const fleeBoost = fleeMode ? 1.35 : 1.0
    const dashBoost = !fleeMode && this.dashActive ? this.dashSpeedMult : 1.0
    const slowMult = nowMs < this.slowUntilMs ? 0.22 : 1.0
    const baseMove = 88
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
    if (!this.active) return
    if (active) {
      this.coreMat.color.setHex(0x0a1838)
      this.coreMat.emissive.setHex(0x3388ff)
      this.coreMat.emissiveIntensity = 4.1
      this.glowMat.color.setHex(0x66ccff)
      this.glowMat.opacity = 0.88
      this.mesh.scale.setScalar(this.originalRadius * this.powerShrink)
    } else {
      this.coreMat.color.copy(this.originalColor)
      this.coreMat.emissive.copy(this.originalEmissive)
      this.coreMat.emissiveIntensity = this.baseEmissiveIntensity
      this.glowMat.color.copy(this.originalGlowColor)
      this.glowMat.opacity = 0.72
      this.mesh.scale.setScalar(this.originalRadius)
    }
  }
}
