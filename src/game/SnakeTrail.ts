import * as THREE from 'three'

/**
 * Path history for placing snake letter segments behind the head.
 * One sample per frame keeps arc length consistent with movement so segment spacing stays stable.
 */
export class SnakeTrail {
  private readonly history: THREE.Vector2[] = []
  private readonly maxPoints = 6000
  readonly segmentSpacing: number

  constructor(segmentSpacing = 38) {
    this.segmentSpacing = segmentSpacing
  }

  reset(): void {
    this.history.length = 0
  }

  /** Call each frame with the head world position. */
  pushHead(head: THREE.Vector2): void {
    this.history.push(head.clone())
    while (this.history.length > this.maxPoints) this.history.shift()
  }

  /**
   * Position for segment `index` (0 = closest behind head). Uses distance along the path from head.
   */
  getSegmentPosition(segmentIndex: number, headFallback: THREE.Vector2): THREE.Vector2 {
    const dist = (segmentIndex + 1) * this.segmentSpacing
    if (this.history.length < 2) return headFallback.clone()
    return this.pointAtDistanceFromHead(dist)
  }

  private pointAtDistanceFromHead(dist: number): THREE.Vector2 {
    let remaining = dist
    for (let i = this.history.length - 1; i > 0; i--) {
      const cur = this.history[i]
      const prev = this.history[i - 1]
      const segLen = cur.distanceTo(prev)
      if (remaining <= segLen) {
        const t = remaining / Math.max(segLen, 0.0001)
        return cur.clone().lerp(prev, t)
      }
      remaining -= segLen
    }
    return this.history[0].clone()
  }
}
