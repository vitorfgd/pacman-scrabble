import * as THREE from 'three'

export type BlobBounds = { minX: number; maxX: number; minY: number; maxY: number }

export type BlobAvoidRect = { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Toxic pools: dark, reflective oil-slick read — low squashed body plus rim + micro highlights.
 */
function createToxicBubbleGroup(
  hue: number,
  seed: number,
): { group: THREE.Group; surfaceMat: THREE.MeshPhysicalMaterial; rimMat: THREE.MeshBasicMaterial } {
  void hue
  const body = new THREE.Color(0x030304).lerp(new THREE.Color(0x0a0a0c), seed * 0.55)
  const glow = new THREE.Color(0x010102)

  const surfaceMat = new THREE.MeshPhysicalMaterial({
    color: body,
    emissive: glow,
    emissiveIntensity: 0.05 + seed * 0.035,
    metalness: 0.48,
    roughness: 0.14,
    clearcoat: 0.78,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: 0.9 + seed * 0.05,
    depthWrite: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    toneMapped: true,
  })

  const rimMat = new THREE.MeshBasicMaterial({
    color: 0x101014,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  })

  const blipMat = new THREE.MeshBasicMaterial({
    color: 0x1c1c22,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  })

  const flat = 0.34 + seed * 0.14
  const bulgeX = 1.08 + seed * 0.1
  const bulgeY = 0.96 + (1 - seed) * 0.1

  const main = new THREE.Mesh(new THREE.SphereGeometry(1, 44, 36), surfaceMat)
  main.scale.set(bulgeX, bulgeY, flat)
  main.position.z = flat
  main.renderOrder = 12

  const topZ = flat * 2
  const meniscus = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 56), rimMat)
  meniscus.position.z = topZ - 0.025
  meniscus.renderOrder = 13

  const shape = new THREE.Group()
  shape.add(main)
  shape.add(meniscus)

  /** Extra micro-bubbles on the surface. */
  const n = 2 + Math.floor(seed * 3)
  for (let b = 0; b < n; b++) {
    const br = 0.14 + seed * 0.06 + b * 0.03
    const bub = new THREE.Mesh(new THREE.SphereGeometry(br, 20, 16), blipMat)
    const ang = (b / n) * Math.PI * 2 + seed * 3.1
    const dist = 0.52 + seed * 0.12
    bub.position.set(Math.cos(ang) * dist * 0.85, Math.sin(ang) * dist * 0.78, topZ - 0.04 + b * 0.012)
    bub.renderOrder = 14
    shape.add(bub)
  }

  const group = new THREE.Group()
  group.add(shape)

  return { group, surfaceMat, rimMat }
}

/** Drifting poison pools: collide with player (handled in Game). Kept out of the submit zone. */
export class AmbientBlobs {
  private static readonly SPEED_MAX = 28
  private static readonly SPEED_MIN = 6

  readonly group = new THREE.Group()
  private readonly blobGroups: THREE.Group[] = []
  private readonly surfaceMats: THREE.MeshPhysicalMaterial[] = []
  private readonly vx: number[] = []
  private readonly vy: number[] = []
  private readonly radii: number[] = []
  private readonly phase: number[] = []
  private readonly avoidRect: BlobAvoidRect

  constructor(count: number, arena: BlobBounds, avoidRect: BlobAvoidRect) {
    this.group.position.z = 0
    this.avoidRect = avoidRect
    for (let i = 0; i < count; i++) {
      const hue = (i * 0.618033988749895 + Math.random() * 0.06) % 1
      const seed = Math.random()
      const { group, surfaceMat } = createToxicBubbleGroup(hue, seed)
      this.surfaceMats.push(surfaceMat)
      this.phase.push(Math.random() * Math.PI * 2)
      const r = 55 + Math.random() * 140
      group.scale.setScalar(r)
      this.radii.push(r)
      const pos = this.randomSpawnPosition(arena, r, avoidRect, 48)
      group.position.set(pos.x, pos.y, 0.12)
      const speed = 9 + Math.random() * 16
      const ang = Math.random() * Math.PI * 2
      this.vx.push(Math.cos(ang) * speed)
      this.vy.push(Math.sin(ang) * speed)
      this.blobGroups.push(group)
      this.group.add(group)
    }
  }

  private static circleOverlapsRect(cx: number, cy: number, r: number, rect: BlobAvoidRect): boolean {
    const nx = THREE.MathUtils.clamp(cx, rect.minX, rect.maxX)
    const ny = THREE.MathUtils.clamp(cy, rect.minY, rect.maxY)
    const dx = cx - nx
    const dy = cy - ny
    return dx * dx + dy * dy <= r * r
  }

  private randomSpawnPosition(
    arena: BlobBounds,
    r: number,
    avoid: BlobAvoidRect,
    maxTries: number,
  ): THREE.Vector2 {
    for (let t = 0; t < maxTries; t++) {
      const x = THREE.MathUtils.lerp(arena.minX + r, arena.maxX - r, Math.random())
      const y = THREE.MathUtils.lerp(arena.minY + r, arena.maxY - r, Math.random())
      if (!AmbientBlobs.circleOverlapsRect(x, y, r, avoid)) {
        return new THREE.Vector2(x, y)
      }
    }
    const cx = (avoid.minX + avoid.maxX) * 0.5
    const cy = (avoid.minY + avoid.maxY) * 0.5
    const away = Math.max(avoid.maxX - avoid.minX, avoid.maxY - avoid.minY) * 0.5 + r + 400
    return new THREE.Vector2(cx + away, cy + away)
  }

  /** Push circle center out of axis-aligned rect if overlapping (for obstacle). */
  private static resolveCircleOutOfRect(
    cx: number,
    cy: number,
    r: number,
    rect: BlobAvoidRect,
  ): { x: number; y: number } {
    const px = THREE.MathUtils.clamp(cx, rect.minX, rect.maxX)
    const py = THREE.MathUtils.clamp(cy, rect.minY, rect.maxY)
    let dx = cx - px
    let dy = cy - py
    const d2 = dx * dx + dy * dy
    const rSq = r * r
    if (d2 >= rSq - 1e-6) return { x: cx, y: cy }

    const d = Math.sqrt(Math.max(d2, 1e-12))
    if (d < 1e-5) {
      const dl = cx - rect.minX
      const dr = rect.maxX - cx
      const db = cy - rect.minY
      const dt = rect.maxY - cy
      const m = Math.min(dl, dr, db, dt)
      if (m === dl) return { x: rect.minX - r - 3, y: cy }
      if (m === dr) return { x: rect.maxX + r + 3, y: cy }
      if (m === db) return { x: cx, y: rect.minY - r - 3 }
      return { x: cx, y: rect.maxY + r + 3 }
    }
    const nx = dx / d
    const ny = dy / d
    const push = r - d + 4
    return { x: cx + nx * push, y: cy + ny * push }
  }

  private clampBlobSpeed(i: number): void {
    let sp = Math.hypot(this.vx[i], this.vy[i])
    if (sp > AmbientBlobs.SPEED_MAX) {
      const k = AmbientBlobs.SPEED_MAX / sp
      this.vx[i] *= k
      this.vy[i] *= k
      sp = AmbientBlobs.SPEED_MAX
    }
    if (sp < AmbientBlobs.SPEED_MIN && sp > 1e-6) {
      const k = AmbientBlobs.SPEED_MIN / sp
      this.vx[i] *= k
      this.vy[i] *= k
    }
  }

  update(deltaSeconds: number, arena: BlobBounds): void {
    const avoid = this.avoidRect
    const t = performance.now() * 0.001
    for (let i = 0; i < this.blobGroups.length; i++) {
      const g = this.blobGroups[i]
      const r = this.radii[i]
      g.position.x += this.vx[i] * deltaSeconds
      g.position.y += this.vy[i] * deltaSeconds

      const minX = arena.minX + r
      const maxX = arena.maxX - r
      const minY = arena.minY + r
      const maxY = arena.maxY - r

      if (g.position.x < minX) {
        g.position.x = minX
        this.vx[i] *= -1
      } else if (g.position.x > maxX) {
        g.position.x = maxX
        this.vx[i] *= -1
      }
      if (g.position.y < minY) {
        g.position.y = minY
        this.vy[i] *= -1
      } else if (g.position.y > maxY) {
        g.position.y = maxY
        this.vy[i] *= -1
      }

      if (AmbientBlobs.circleOverlapsRect(g.position.x, g.position.y, r, avoid)) {
        const cx = g.position.x
        const cy = g.position.y
        const resolved = AmbientBlobs.resolveCircleOutOfRect(cx, cy, r, avoid)
        const nx = resolved.x - cx
        const ny = resolved.y - cy
        const nl = Math.hypot(nx, ny)
        if (nl > 1e-5) {
          const nnx = nx / nl
          const nny = ny / nl
          const dot = this.vx[i] * nnx + this.vy[i] * nny
          if (dot < 0) {
            this.vx[i] -= 2 * dot * nnx
            this.vy[i] -= 2 * dot * nny
          }
        }
        g.position.x = resolved.x
        g.position.y = resolved.y
      }

      this.clampBlobSpeed(i)

      const ph = this.phase[i]
      const breathe = 1 + 0.024 * Math.sin(t * 1.4 + ph)
      g.scale.setScalar(r * breathe)
      g.rotation.z += deltaSeconds * (0.032 + (i % 5) * 0.01)

      const mat = this.surfaceMats[i]
      const glug = 0.72 + 0.28 * Math.abs(Math.sin(t * 2.1 + ph))
      mat.emissiveIntensity = (0.04 + (i % 3) * 0.015) * glug
      mat.clearcoat = THREE.MathUtils.clamp(0.68 + 0.12 * glug, 0.62, 0.9)
      mat.opacity = THREE.MathUtils.clamp(0.88 + 0.06 * glug, 0.8, 0.96)
    }
  }

  /** For player collision: world XY + radius per blob. */
  forEachBlob(cb: (x: number, y: number, radius: number) => void): void {
    for (let i = 0; i < this.blobGroups.length; i++) {
      const g = this.blobGroups[i]
      cb(g.position.x, g.position.y, this.radii[i])
    }
  }

  dispose(): void {
    for (const g of this.blobGroups) {
      g.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
    }
    this.blobGroups.length = 0
    this.surfaceMats.length = 0
  }
}
