import * as THREE from 'three'

function createStarGeometry(outerR = 1, innerR = 0.42, points = 5): THREE.BufferGeometry {
  const positions: number[] = []
  const total = points * 2

  for (let i = 0; i < total; i++) {
    // Start from top (-PI/2) so star sits upright.
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const nextI = (i + 1) % total
    const nextAngle = (nextI / total) * Math.PI * 2 - Math.PI / 2
    const nextR = nextI % 2 === 0 ? outerR : innerR

    // Fan triangle: center → current vertex → next vertex.
    positions.push(0, 0, 0)
    positions.push(Math.cos(angle) * r, Math.sin(angle) * r, 0)
    positions.push(Math.cos(nextAngle) * nextR, Math.sin(nextAngle) * nextR, 0)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export class Fruit {
  readonly mesh: THREE.Mesh

  private active = false
  private radius = 22
  private _startMs = 0

  constructor() {
    const geometry = createStarGeometry(1, 0.42, 5)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffe040,
      emissive: new THREE.Color(0xffc200),
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.3,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.set(0, 0, 0)
    this.mesh.visible = false
  }

  isActive(): boolean { return this.active }

  setActive(active: boolean, position: THREE.Vector2, radius = 22): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return
    this.radius = radius
    this.mesh.scale.setScalar(this.radius)
    this.mesh.position.set(position.x, position.y, 1)
    this._startMs = performance.now()
  }

  update(nowMs: number): void {
    if (!this.active) return
    // Slow spin to attract attention.
    this.mesh.rotation.z = ((nowMs - this._startMs) / 1200) * Math.PI * 2
    // Gentle pulse.
    const pulse = 0.9 + 0.1 * Math.sin((nowMs - this._startMs) / 340)
    this.mesh.scale.setScalar(this.radius * pulse)
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin((nowMs - this._startMs) / 420))
  }
}
