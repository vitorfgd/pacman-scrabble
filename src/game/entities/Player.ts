import * as THREE from 'three'

export type PlayerUpdateContext = {
  pointerWorld: THREE.Vector2
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

// Circle dot controlled by the pointer (Agar.io style).
export class Player {
  readonly mesh: THREE.Mesh
  private size: number
  private readonly baseMoveLerpFactor: number
  private readonly baseMoveSpeedWorldPerSec: number
  private readonly initialSize: number

  // For Word-of-the-Day glow.
  private wodGlowActive = false
  private wodGlowStartMs = 0

  constructor() {
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

    // Movement tuning:
    // - baseMoveLerpFactor controls "slugishness" (how quickly it approaches the pointer)
    // - baseMoveSpeedWorldPerSec caps max world-units/sec so landscape vs portrait feels similar.
    this.baseMoveLerpFactor = 1.0
    this.baseMoveSpeedWorldPerSec = 980

    this.mesh.position.z = 1
  }

  getRadius(): number {
    return this.mesh.scale.x
  }

  setSize(size: number): void {
    this.size = Math.max(2, Math.min(250, size))
    this.mesh.scale.setScalar(this.size)
  }

  setWordOfDayGlow(active: boolean, nowMs: number): void {
    this.wodGlowActive = active
    this.wodGlowStartMs = nowMs
  }

  update(deltaSeconds: number, ctx: PlayerUpdateContext): void {
    // Bigger player = sluggier.
    const sizeRatio = this.initialSize / Math.max(this.initialSize, this.size)
    const effectiveLerp = this.baseMoveLerpFactor * Math.pow(sizeRatio, 0.4)
    const kDesired = 1 - Math.exp(-effectiveLerp * deltaSeconds) // smoothing (0..1)
    const maxSpeed = this.baseMoveSpeedWorldPerSec * Math.pow(sizeRatio, 0.4) // cap velocity magnitude

    const pos = this.mesh.position
    const r = this.getRadius()

    const targetX = THREE.MathUtils.clamp(ctx.pointerWorld.x, ctx.bounds.minX + r, ctx.bounds.maxX - r)
    const targetY = THREE.MathUtils.clamp(ctx.pointerWorld.y, ctx.bounds.minY + r, ctx.bounds.maxY - r)

    const dx = targetX - pos.x
    const dy = targetY - pos.y
    const dist = Math.hypot(dx, dy)

    if (dist > 0.0001) {
      // First compute how far we'd like to move this frame (based on smoothing),
      // then cap it so landscape/portrait doesn't make sideways aiming too fast.
      const desiredStep = dist * kDesired
      const maxStep = maxSpeed * deltaSeconds
      const step = Math.min(desiredStep, maxStep)
      const k = step / dist
      pos.x += dx * k
      pos.y += dy * k
    }

    pos.z = 1

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
