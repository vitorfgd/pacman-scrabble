import * as THREE from 'three'

export class Fruit {
  readonly mesh: THREE.Mesh

  private active = false
  private radius = 22
  private _startMs = 0

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffe040,
      emissive: new THREE.Color(0xffc200),
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.set(0, 0, 0)
    this.mesh.visible = false
  }

  isActive(): boolean { return this.active }

  getRadius(): number { return this.mesh.scale.x }

  setActive(active: boolean, position: THREE.Vector2, radius = 22): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return
    this.radius = radius
    this.mesh.scale.setScalar(this.radius)
    this.mesh.position.set(position.x, position.y, this.radius * 0.88 + 0.06)
    this._startMs = performance.now()
  }

  update(nowMs: number): void {
    if (!this.active) return
    const t = (nowMs - this._startMs) / 1000
    // Slow tumble + spin so the pickup reads as a 3D object.
    this.mesh.rotation.y = t * 1.9
    this.mesh.rotation.z = t * 2.4
    // Gentle pulse.
    const pulse = 0.9 + 0.1 * Math.sin((nowMs - this._startMs) / 340)
    this.mesh.scale.setScalar(this.radius * pulse)
    this.mesh.position.z = this.radius * pulse * 0.88 + 0.06
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin((nowMs - this._startMs) / 420))
  }
}
