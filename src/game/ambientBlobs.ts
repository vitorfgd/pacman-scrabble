import * as THREE from 'three'

export type BlobBounds = { minX: number; maxX: number; minY: number; maxY: number }

export type BlobAvoidRect = { minX: number; maxX: number; minY: number; maxY: number }

/** Many shallow spikes (inner near outer) — reads as textured hazard, not octagon enemies. */
function createSpikyBlobGeometry(spikeCount: number, outer = 1, inner = 0.9): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  const n = spikeCount * 2
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const rad = i % 2 === 0 ? outer : inner
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

/** Drifting hazards: collide with player (handled in Game). Kept out of the submit zone. */
export class AmbientBlobs {
  private static readonly SPEED_MAX = 28
  private static readonly SPEED_MIN = 6

  readonly group = new THREE.Group()
  private readonly sharedGeo: THREE.ShapeGeometry
  private readonly meshes: THREE.Mesh[] = []
  private readonly vx: number[] = []
  private readonly vy: number[] = []
  private readonly radii: number[] = []
  private readonly avoidRect: BlobAvoidRect

  constructor(count: number, arena: BlobBounds, avoidRect: BlobAvoidRect) {
    this.group.position.z = 0
    this.avoidRect = avoidRect
    this.sharedGeo = createSpikyBlobGeometry(26, 1, 0.9)
    for (let i = 0; i < count; i++) {
      const hue = (i * 0.618033988749895 + Math.random() * 0.08) % 1
      const c = new THREE.Color().setHSL(hue, 0.62 + Math.random() * 0.28, 0.48 + Math.random() * 0.12)
      const em = c.clone().multiplyScalar(1.05)
      const mat = new THREE.MeshStandardMaterial({
        color: c,
        emissive: em,
        emissiveIntensity: 1.65 + Math.random() * 0.55,
        metalness: 0.18,
        roughness: 0.32,
        transparent: true,
        opacity: 0.62 + Math.random() * 0.18,
        depthTest: false,
        depthWrite: false,
      })
      const m = new THREE.Mesh(this.sharedGeo, mat)
      /** Draw after letter sprites (renderOrder 1) so blobs occlude pickups. */
      m.renderOrder = 12
      const r = 55 + Math.random() * 140
      m.scale.setScalar(r)
      this.radii.push(r)
      const pos = this.randomSpawnPosition(arena, r, avoidRect, 48)
      m.position.set(pos.x, pos.y, 1.08)
      const speed = 9 + Math.random() * 16
      const ang = Math.random() * Math.PI * 2
      this.vx.push(Math.cos(ang) * speed)
      this.vy.push(Math.sin(ang) * speed)
      this.meshes.push(m)
      this.group.add(m)
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
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i]
      const r = this.radii[i]
      m.position.x += this.vx[i] * deltaSeconds
      m.position.y += this.vy[i] * deltaSeconds

      const minX = arena.minX + r
      const maxX = arena.maxX - r
      const minY = arena.minY + r
      const maxY = arena.maxY - r

      if (m.position.x < minX) {
        m.position.x = minX
        this.vx[i] *= -1
      } else if (m.position.x > maxX) {
        m.position.x = maxX
        this.vx[i] *= -1
      }
      if (m.position.y < minY) {
        m.position.y = minY
        this.vy[i] *= -1
      } else if (m.position.y > maxY) {
        m.position.y = maxY
        this.vy[i] *= -1
      }

      if (AmbientBlobs.circleOverlapsRect(m.position.x, m.position.y, r, avoid)) {
        const cx = m.position.x
        const cy = m.position.y
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
        m.position.x = resolved.x
        m.position.y = resolved.y
      }

      this.clampBlobSpeed(i)

      m.rotation.z += deltaSeconds * (0.08 + (i % 5) * 0.02)
    }
  }

  /** For player collision: world XY + radius per blob. */
  forEachBlob(cb: (x: number, y: number, radius: number) => void): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i]
      cb(m.position.x, m.position.y, this.radii[i])
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      ;(m.material as THREE.Material).dispose()
    }
    this.meshes.length = 0
    this.sharedGeo.dispose()
  }
}
