import * as THREE from 'three'
import { drawSafeZoneCircleHeadTexture } from '../safeZoneCircleTexture'

export type PlayerUpdateContext = {
  pointerWorld: THREE.Vector2
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  speedMultiplier?: number
}

/**
 * Extruded-hull motorboat: reads clearly as a boat from above (V bow, cabin, stack).
 * Gameplay radius is `size`; mesh scaled to fit the collision circle in top view.
 */
export class Player {
  readonly mesh: THREE.Group
  private readonly paintableMeshes: THREE.Mesh[]
  private readonly hullMesh: THREE.Mesh
  private readonly deckMesh: THREE.Mesh
  private readonly cabinMesh: THREE.Mesh
  private readonly funnelMesh: THREE.Mesh
  private readonly bowMesh: THREE.Mesh
  private readonly gunwaleMesh: THREE.Mesh
  private readonly deckStandardMaterial: THREE.MeshStandardMaterial
  private readonly whiteMat: THREE.MeshStandardMaterial
  private readonly funnelMaterial: THREE.MeshStandardMaterial
  private size: number
  private readonly baseMoveLerpFactor: number
  private readonly baseMoveSpeedWorldPerSec: number
  private readonly initialSize: number

  private readonly standardHullMaterial: THREE.MeshStandardMaterial
  private safeZoneMaterial: THREE.MeshBasicMaterial | null = null
  private safeZoneTexture: THREE.CanvasTexture | null = null
  private safeZoneCtx: CanvasRenderingContext2D | null = null
  private headVisual: 'standard' | 'safezone' = 'standard'
  private readonly safeZoneTexSize = 256
  private static readonly groundClearance = 0.08
  /** Local half-length along +Y (bow); scale = size / this. */
  private static readonly hullHalfLength = 0.64

  private lastMoveDir = new THREE.Vector2(0, 1)

  constructor() {
    this.mesh = new THREE.Group()
    this.paintableMeshes = []

    this.standardHullMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a4a78,
      emissive: new THREE.Color(0x082030),
      emissiveIntensity: 0.25,
      metalness: 0,
      roughness: 0.55,
    })
    this.whiteMat = new THREE.MeshStandardMaterial({
      color: 0xe8f0f8,
      emissive: new THREE.Color(0x223344),
      emissiveIntensity: 0.08,
      metalness: 0,
      roughness: 0.62,
    })

    const shape = new THREE.Shape()
    shape.moveTo(-0.24, -0.54)
    shape.lineTo(0.24, -0.54)
    shape.lineTo(0.3, 0.06)
    shape.quadraticCurveTo(0, 0.82, -0.3, 0.06)
    shape.lineTo(-0.24, -0.54)

    const hullGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.028,
      bevelSegments: 2,
    })
    hullGeo.computeVertexNormals()
    const bb = new THREE.Box3().setFromBufferAttribute(hullGeo.attributes.position as THREE.BufferAttribute)
    hullGeo.translate(0, 0, -bb.min.z)

    this.hullMesh = new THREE.Mesh(hullGeo, this.standardHullMaterial)
    this.hullMesh.position.set(0, 0, 0)
    this.mesh.add(this.hullMesh)
    this.paintableMeshes.push(this.hullMesh)

    this.gunwaleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 1.22, 0.06),
      this.whiteMat,
    )
    this.gunwaleMesh.position.set(0, 0.04, 0.2)
    this.mesh.add(this.gunwaleMesh)
    this.paintableMeshes.push(this.gunwaleMesh)

    this.deckStandardMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8dce8,
      roughness: 0.62,
      metalness: 0,
    })
    this.deckMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.72), this.deckStandardMaterial)
    this.deckMesh.position.set(0, -0.02, 0.235)
    this.deckMesh.rotation.x = -Math.PI / 2
    this.mesh.add(this.deckMesh)
    this.paintableMeshes.push(this.deckMesh)

    this.cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.2), this.whiteMat)
    this.cabinMesh.position.set(0, -0.32, 0.28)
    this.mesh.add(this.cabinMesh)
    this.paintableMeshes.push(this.cabinMesh)

    this.funnelMaterial = new THREE.MeshStandardMaterial({
      color: 0xc04030,
      emissive: new THREE.Color(0x401810),
      emissiveIntensity: 0.35,
      metalness: 0,
      roughness: 0.55,
    })
    this.funnelMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 10), this.funnelMaterial)
    this.funnelMesh.position.set(-0.1, -0.22, 0.34)
    this.mesh.add(this.funnelMesh)
    this.paintableMeshes.push(this.funnelMesh)

    this.bowMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.28, 10),
      this.whiteMat,
    )
    this.bowMesh.rotation.x = Math.PI / 2
    this.bowMesh.position.set(0, 0.72, 0.12)
    this.mesh.add(this.bowMesh)
    this.paintableMeshes.push(this.bowMesh)

    this.initialSize = 30
    this.size = this.initialSize
    this.applyVisualScale()
    this.mesh.position.z = this.size + Player.groundClearance

    this.baseMoveLerpFactor = 1.22
    this.baseMoveSpeedWorldPerSec = 1080
  }

  private applyVisualScale(): void {
    const s = this.size / Player.hullHalfLength
    this.mesh.scale.set(s, s, s)
  }

  getRadius(): number {
    return this.size
  }

  setSize(size: number): void {
    this.size = Math.max(2, Math.min(250, size))
    this.applyVisualScale()
    this.mesh.position.z = this.size + Player.groundClearance
  }

  applySkin(colorHex: number, emissiveHex: number, emissiveIntensity: number): void {
    if (this.headVisual === 'safezone') return
    this.standardHullMaterial.color.setHex(colorHex)
    this.standardHullMaterial.emissive.setHex(emissiveHex)
    this.standardHullMaterial.emissiveIntensity = emissiveIntensity
    this.deckStandardMaterial.color.copy(this.standardHullMaterial.color).lerp(new THREE.Color(0xffffff), 0.55)
    this.deckStandardMaterial.emissive.copy(this.standardHullMaterial.emissive)
    this.deckStandardMaterial.emissiveIntensity = emissiveIntensity * 0.35
    this.whiteMat.color.setHex(0xe8f4ff)
    this.whiteMat.emissive.setHex(emissiveHex)
    this.whiteMat.emissiveIntensity = emissiveIntensity * 0.2
  }

  setHeadVisual(mode: 'standard' | 'safezone'): void {
    if (mode === this.headVisual) return
    if (mode === 'safezone') {
      this.ensureSafeZoneHeadMaterial()
      const m = this.safeZoneMaterial!
      for (const mesh of this.paintableMeshes) {
        mesh.material = m
      }
      this.headVisual = 'safezone'
    } else {
      this.disposeSafeZoneHeadMaterial()
      this.hullMesh.material = this.standardHullMaterial
      this.gunwaleMesh.material = this.whiteMat
      this.cabinMesh.material = this.whiteMat
      this.bowMesh.material = this.whiteMat
      this.deckMesh.material = this.deckStandardMaterial
      this.funnelMesh.material = this.funnelMaterial
      this.headVisual = 'standard'
    }
  }

  tickSafeZoneHeadTexture(nowMs: number): void {
    if (this.headVisual !== 'safezone' || !this.safeZoneCtx || !this.safeZoneTexture) return
    drawSafeZoneCircleHeadTexture(this.safeZoneCtx, this.safeZoneTexSize, nowMs, true)
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
      this.lastMoveDir.set(dx, dy).normalize()
    }

    pos.x = THREE.MathUtils.clamp(pos.x, ctx.bounds.minX + r, ctx.bounds.maxX - r)
    pos.y = THREE.MathUtils.clamp(pos.y, ctx.bounds.minY + r, ctx.bounds.maxY - r)
    pos.z = this.getRadius() + Player.groundClearance

    const dir = this.lastMoveDir
    if (dir.lengthSq() > 1e-8) {
      this.mesh.rotation.z = Math.atan2(dir.y, dir.x) - Math.PI / 2
    }
  }
}
