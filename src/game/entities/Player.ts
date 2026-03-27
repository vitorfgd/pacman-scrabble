import * as THREE from 'three'

export type PlayerUpdateContext = {
  pointerWorld: THREE.Vector2
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  /** Multiplies base move speed (e.g. letter-fuel boost). */
  speedMultiplier?: number
}

// Slither.io–style head: fixed size, constant base speed, pointer follows smoothly (tail is separate meshes).
export class Player {
  readonly mesh: THREE.Mesh
  private size: number
  private readonly baseMoveLerpFactor: number
  private readonly baseMoveSpeedWorldPerSec: number
  private readonly initialSize: number

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

    // Slither-like: responsive turn toward cursor; speed does not shrink when the tail grows (that is Submit).
    this.baseMoveLerpFactor = 1.22
    this.baseMoveSpeedWorldPerSec = 1080

    this.mesh.position.z = 1
  }

  getRadius(): number {
    return this.mesh.scale.x
  }

  setSize(size: number): void {
    this.size = Math.max(2, Math.min(250, size))
    this.mesh.scale.setScalar(this.size)
  }

  update(deltaSeconds: number, ctx: PlayerUpdateContext): void {
    const speedMult = Math.max(0.85, Math.min(2.35, ctx.speedMultiplier ?? 1))
    const effectiveLerp = this.baseMoveLerpFactor
    const kDesired = 1 - Math.exp(-effectiveLerp * deltaSeconds)
    const maxSpeed = this.baseMoveSpeedWorldPerSec * speedMult

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

    const material = this.mesh.material as THREE.MeshStandardMaterial
    const boosted = speedMult > 1.04
    if (boosted) {
      material.emissive = new THREE.Color(0x55ccff)
      material.emissiveIntensity = 1.0
    } else {
      material.emissiveIntensity = 0.6
      material.emissive = new THREE.Color(0x33a1ff)
    }
  }
}
