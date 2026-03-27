export type Cell = { x: number; y: number }
export type Dir = { x: number; y: number } // 4-neighborhood direction (dx/dy in {-1,0,1})

/** Enemy duration per cell; player moves 1.5× faster (shorter duration). */
export const ENEMY_GRID_CELL_TWEEN_MS = 520
export const PLAYER_GRID_CELL_TWEEN_MS = ENEMY_GRID_CELL_TWEEN_MS / 1.5

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

export class Grid {
  readonly divisions: number
  readonly cellSize: number

  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number

  constructor(bounds: Bounds, divisions = 64) {
    this.divisions = divisions
    this.minX = bounds.minX
    this.maxX = bounds.maxX
    this.minY = bounds.minY
    this.maxY = bounds.maxY

    // Existing texture draws 1 cell per grid tile interval; total intervals match `divisions`.
    const worldW = this.maxX - this.minX
    this.cellSize = worldW / this.divisions
  }

  private clampInt(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(n)))
  }

  clampCell(cell: Cell): Cell {
    return {
      x: this.clampInt(cell.x, 0, this.divisions),
      y: this.clampInt(cell.y, 0, this.divisions),
    }
  }

  cellToWorld(cell: Cell): { x: number; y: number } {
    return {
      x: this.minX + cell.x * this.cellSize,
      y: this.minY + cell.y * this.cellSize,
    }
  }

  worldToCell(wx: number, wy: number): Cell {
    const x = (wx - this.minX) / this.cellSize
    const y = (wy - this.minY) / this.cellSize
    return this.clampCell({ x, y })
  }

  snapWorldToCell(wx: number, wy: number): { cell: Cell; world: { x: number; y: number } } {
    const cell = this.worldToCell(wx, wy)
    return { cell, world: this.cellToWorld(cell) }
  }

  worldToCellWithHalfSnap(wx: number, wy: number): Cell {
    // Alternative snap mode: floor/round with explicit small epsilon.
    // Useful if you want behavior more stable across floating point drift.
    const eps = 1e-6
    const x = (wx - this.minX) / this.cellSize + eps
    const y = (wy - this.minY) / this.cellSize + eps
    return this.clampCell({ x, y })
  }

  getNeighbors4(cell: Cell): Cell[] {
    return [
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    ].map((c) => this.clampCell(c))
  }

  cellDistanceSq(a: Cell, b: Cell): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }

  cellDistance(a: Cell, b: Cell): number {
    return Math.sqrt(this.cellDistanceSq(a, b))
  }

  dirToTargetCell(from: Cell, dir: Dir): Cell {
    return this.clampCell({ x: from.x + dir.x, y: from.y + dir.y })
  }
}

