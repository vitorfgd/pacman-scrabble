import * as THREE from 'three'
import { drawSafeZoneCircleHeadTexture } from '../safeZoneCircleTexture'

export type PlayerUpdateContext = {
  pointerWorld: THREE.Vector2
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  speedMultiplier?: number
}

// Slither.io–style head: fixed size, constant base speed, pointer follows smoothly (tail is separate meshes).
export class Player {
  readonly mesh: THREE.Mesh
  private size: number
  private readonly baseMoveLerpFactor: number
  private readonly baseMoveSpeedWorldPerSec: number
  private readonly initialSize: number

  private readonly standardMaterial: THREE.MeshStandardMaterial
  private safeZoneMaterial: THREE.MeshBasicMaterial | null = null
  private safeZoneTexture: THREE.CanvasTexture | null = null
  private safeZoneCtx: CanvasRenderingContext2D | null = null
  private headVisual: 'standard' | 'safezone' = 'standard'
  private readonly safeZoneTexSize = 256

  constructor() {
    const geometry = new THREE.CircleGeometry(1, 48)
    const material = new THREE.MeshStandardMaterial({
      color: 0x33a1ff,
      emissive: new THREE.Color(0x33a1ff),
      emissiveIntensity: 0.6,
      metalness: 0.05,
      roughness: 0.25,
    })
    this.standardMaterial = material

    this.mesh = new THREE.Mesh(geometry, material)
    this.initialSize = 28
    this.size = this.initialSize
    this.mesh.scale.setScalar(this.size)

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

  applySkin(colorHex: number, emissiveHex: number, emissiveIntensity: number): void {
    if (this.headVisual === 'safezone') return
    this.standardMaterial.color.setHex(colorHex)
    this.standardMaterial.emissive.setHex(emissiveHex)
    this.standardMaterial.emissiveIntensity = emissiveIntensity
  }

  /** Safe Zone shop skin: animated canvas matches the submit gate (gradient + sparkles). */
  setHeadVisual(mode: 'standard' | 'safezone'): void {
    if (mode === this.headVisual) return
    if (mode === 'safezone') {
      this.ensureSafeZoneHeadMaterial()
      this.mesh.material = this.safeZoneMaterial!
      this.headVisual = 'safezone'
    } else {
      this.disposeSafeZoneHeadMaterial()
      this.mesh.material = this.standardMaterial
      this.headVisual = 'standard'
    }
  }

  tickSafeZoneHeadTexture(nowMs: number, playerInsideSubmitZone: boolean): void {
    if (this.headVisual !== 'safezone' || !this.safeZoneCtx || !this.safeZoneTexture) return
    drawSafeZoneCircleHeadTexture(this.safeZoneCtx, this.safeZoneTexSize, nowMs, playerInsideSubmitZone)
    this.safeZoneTexture.needsUpdate = true
  }

  private ensureSafeZoneHeadMaterial(): void {
    if (this.safeZoneMaterial) return
    const canvas = document.createElement('canvas')
    canvas.width = this.safeZoneTexSize
    canvas.height = this.safeZoneTexSize
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d')
    this.safeZoneCtx = ctx
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    this.safeZoneTexture = tex
    this.safeZoneMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
    })
  }

  private disposeSafeZoneHeadMaterial(): void {
    if (this.safeZoneMaterial) {
      this.safeZoneMaterial.dispose()
      this.safeZoneMaterial = null
    }
    if (this.safeZoneTexture) {
      this.safeZoneTexture.dispose()
      this.safeZoneTexture = null
    }
    this.safeZoneCtx = null
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
      const desiredStep = dist * kDesired
      const maxStep = maxSpeed * deltaSeconds
      const step = Math.min(desiredStep, maxStep)
      const k = step / dist
      pos.x += dx * k
      pos.y += dy * k
    }

    pos.z = 1
  }
}
