import * as THREE from 'three'

export class Letter {
  char: string
  readonly sprite: THREE.Sprite
  readonly radius: number

  private active = false

  constructor(sprite: THREE.Sprite, char: string, radius: number) {
    this.sprite = sprite
    this.char = char
    this.radius = radius
    this.sprite.visible = false
  }

  setChar(char: string): void {
    this.char = char
  }

  setActive(active: boolean): void {
    this.active = active
    this.sprite.visible = active
  }

  isActive(): boolean {
    return this.active
  }
}

