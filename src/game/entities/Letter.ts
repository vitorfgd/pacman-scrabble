import * as THREE from 'three'
import type { Cell } from '../Grid'

export class Letter {
  char: string
  readonly sprite: THREE.Sprite
  readonly radius: number

  private active = false
  private cell: Cell = { x: 0, y: 0 }

  constructor(sprite: THREE.Sprite, char: string, radius: number) {
    this.sprite = sprite
    this.char = char
    this.radius = radius
    this.sprite.visible = false
  }

  setChar(char: string): void {
    this.char = char
  }

  setCell(cell: Cell): void {
    this.cell = cell
  }

  getCell(): Cell {
    return { x: this.cell.x, y: this.cell.y }
  }

  setActive(active: boolean): void {
    this.active = active
    this.sprite.visible = active
  }

  isActive(): boolean {
    return this.active
  }
}

