import * as THREE from 'three'

export class CoinPickup {
  readonly mesh: THREE.Mesh

  private active = false
  private radius = 16
  private _startMs = 0

  constructor() {
    const geometry = new THREE.CircleGeometry(1, 28)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffcc33,
      emissive: new THREE.Color(0xffaa00),
      emissiveIntensity: 0.65,
      metalness: 0.45,
      roughness: 0.28,
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

  setActive(active: boolean, position: THREE.Vector2, radius = 16): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return
    this.radius = radius
    this.mesh.scale.setScalar(this.radius)
    this.mesh.position.set(position.x, position.y, 0.95)
    this._startMs = performance.now()
  }

  update(nowMs: number): void {
    if (!this.active) return
    const t = (nowMs - this._startMs) / 1000
    const pulse = 0.92 + 0.08 * Math.sin(t * 2.8)
    this.mesh.scale.setScalar(this.radius * pulse)
    this.mesh.rotation.z = t * 0.9
  }
}
