import * as THREE from 'three'

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/** Icosahedron vertices — evenly distributed directions for mine spikes. */
const SPIKE_DIRS: THREE.Vector3[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2
  const raw = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ] as const
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize())
})()

function createMineGeometry(): {
  group: THREE.Group
  coreMat: THREE.MeshStandardMaterial
  spikeMat: THREE.MeshStandardMaterial
  glowMat: THREE.MeshBasicMaterial
} {
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x1e0505,
    emissive: new THREE.Color(0x6a0c08),
    emissiveIntensity: 4.2,
    metalness: 0,
    roughness: 0.32,
    toneMapped: false,
  })
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0x140303,
    emissive: new THREE.Color(0x4a0806),
    emissiveIntensity: 2.2,
    metalness: 0,
    roughness: 0.3,
    toneMapped: false,
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x3a0a08,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })

  const group = new THREE.Group()
  const sphereR = 0.46
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(sphereR, 22, 18), coreMat)
  sphere.renderOrder = 14
  group.add(sphere)

  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(sphereR * 1.22, 16, 14), glowMat)
  glowSphere.renderOrder = 13
  group.add(glowSphere)

  const coneH = 0.38
  const coneR = 0.11
  const spikeGeo = new THREE.ConeGeometry(coneR, coneH, 8)
  const yAxis = new THREE.Vector3(0, 1, 0)
  for (const dir of SPIKE_DIRS) {
    const spike = new THREE.Mesh(spikeGeo, spikeMat)
    spike.quaternion.setFromUnitVectors(yAxis, dir)
    const dist = sphereR + coneH * 0.48
    spike.position.copy(dir.clone().multiplyScalar(dist))
    spike.renderOrder = 15
    group.add(spike)
  }

  return { group: group, coreMat, spikeMat, glowMat }
}

/** Local sphere radius in `createMineGeometry` — used to place the mine on the water surface. */
const MINE_SPHERE_LOCAL_R = 0.46
/** World Z where the bottom of the sphere should sit (slightly above the ocean plane ~0). */
const MINE_FLOAT_ABOVE_WATER = 0.05

/**
 * Patrols between waypoints; when the player is within aggro range, locks onto a straight
 * dash toward them (bullet-like, no steering) for a few seconds, then returns to patrol.
 */
export class Enemy {
  /** Root group (position / scale / spin). Game uses this like a mesh. */
  readonly mesh: THREE.Group

  private readonly coreMat: THREE.MeshStandardMaterial
  private readonly spikeMat: THREE.MeshStandardMaterial
  private readonly glowMat: THREE.MeshBasicMaterial

  private active = false
  private originalRadius = 10
  private slowUntilMs = 0
  private pulseTimer = 0

  private readonly powerShrink = 0.65
  private powerModeVisual = false
  private originalColor = new THREE.Color()
  private originalEmissive = new THREE.Color()
  private originalGlowColor = new THREE.Color()
  private originalSpikeEmissive = new THREE.Color()
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
    const mine = createMineGeometry()
    this.coreMat = mine.coreMat
    this.spikeMat = mine.spikeMat
    this.glowMat = mine.glowMat
    this.mesh = mine.group
    this.mesh.position.set(0, 0, MINE_FLOAT_ABOVE_WATER + MINE_SPHERE_LOCAL_R * 10)
    this.mesh.visible = false
  }

  /** Center Z so the scaled sphere rests on the water + optional bob (reads “floating”). */
  private waterFloatCenterZ(scale: number): number {
    const bob =
      Math.sin(this.pulseTimer * 2.05) * 0.32 +
      Math.sin(this.pulseTimer * 2.9 + 0.8) * 0.14
    return MINE_FLOAT_ABOVE_WATER + MINE_SPHERE_LOCAL_R * scale + bob
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
    if (!active) {
      this.powerModeVisual = false
      return
    }

    const r = Math.max(24, baseRadius * 1.2)
    this.originalRadius = r
    this.mesh.scale.setScalar(r)
    this.mesh.position.set(position.x, position.y, this.waterFloatCenterZ(r))

    this.slowUntilMs = 0
    this.pulseTimer = Math.random() * Math.PI * 2
    this.steer.set(Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
    this.dashActive = false
    this.dashEndMs = 0

    this.originalColor.setHex(0x1e0505)
    this.coreMat.color.copy(this.originalColor)
    this.originalEmissive.setHex(0x6a0c08)
    this.coreMat.emissive.copy(this.originalEmissive)
    this.baseEmissiveIntensity = 4.0 + Math.random() * 0.9
    this.coreMat.emissiveIntensity = this.baseEmissiveIntensity

    this.originalGlowColor.setHex(0x4a100c)
    this.glowMat.color.copy(this.originalGlowColor)
    this.glowMat.opacity = 0.55

    this.originalSpikeEmissive.setHex(0x4a0806)
    this.spikeMat.emissive.copy(this.originalSpikeEmissive)
    this.spikeMat.emissiveIntensity = 2.2
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

    if (!fleeMode && !this.powerModeVisual) {
      const wobble = 0.55 + 0.45 * Math.abs(Math.sin(this.pulseTimer))
      this.coreMat.emissiveIntensity = this.baseEmissiveIntensity * (0.72 + 0.48 * wobble)
      this.spikeMat.emissiveIntensity = 1.85 + 1.1 * wobble
      this.glowMat.opacity = 0.42 + 0.4 * wobble
    } else if (!fleeMode && this.powerModeVisual) {
      const wobble = 0.55 + 0.45 * Math.abs(Math.sin(this.pulseTimer))
      this.coreMat.emissiveIntensity = 5.8 + 0.55 * wobble
      this.spikeMat.emissiveIntensity = 3.4 + 0.5 * wobble
      this.glowMat.opacity = 0.85 + 0.07 * wobble
    } else {
      this.coreMat.emissiveIntensity = 5.2
      this.spikeMat.emissiveIntensity = 3.4
      this.glowMat.opacity = 0.88
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
    pos.z = this.waterFloatCenterZ(r)

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
    this.powerModeVisual = active
    if (active) {
      this.coreMat.color.setHex(0x120202)
      this.coreMat.emissive.setHex(0x6a2018)
      this.coreMat.emissiveIntensity = 6.2
      this.spikeMat.emissive.setHex(0x551810)
      this.spikeMat.emissiveIntensity = 3.8
      this.glowMat.color.setHex(0x5a2820)
      this.glowMat.opacity = 0.92
      this.mesh.scale.setScalar(this.originalRadius * this.powerShrink)
    } else {
      this.coreMat.color.copy(this.originalColor)
      this.coreMat.emissive.copy(this.originalEmissive)
      this.coreMat.emissiveIntensity = this.baseEmissiveIntensity
      this.spikeMat.emissive.copy(this.originalSpikeEmissive)
      this.spikeMat.emissiveIntensity = 2.2
      this.glowMat.color.copy(this.originalGlowColor)
      this.glowMat.opacity = 0.55
      this.mesh.scale.setScalar(this.originalRadius)
    }
  }
}
