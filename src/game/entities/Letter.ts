import * as THREE from 'three'

/** Local box depth (Z) before root scale — thicker tile reads clearly as 3D from the angled camera. */
export const LETTER_TILE_DEPTH = 0.16

export class Letter {
  char: string
  /** Group containing the letter tile mesh (scaled + positioned in world). */
  readonly root: THREE.Group
  readonly topMaterial: THREE.MeshPhysicalMaterial
  readonly sideMaterial: THREE.MeshStandardMaterial
  readonly radius: number

  private active = false

  constructor(
    root: THREE.Group,
    topMaterial: THREE.MeshPhysicalMaterial,
    sideMaterial: THREE.MeshStandardMaterial,
    char: string,
    radius: number,
  ) {
    this.root = root
    this.topMaterial = topMaterial
    this.sideMaterial = sideMaterial
    this.char = char
    this.radius = radius
    this.root.visible = false
  }

  setChar(char: string): void {
    this.char = char
  }

  setActive(active: boolean): void {
    this.active = active
    this.root.visible = active
  }

  isActive(): boolean {
    return this.active
  }
}
