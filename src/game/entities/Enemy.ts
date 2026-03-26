import * as THREE from 'three'

export type EnemyRole = 'chaser' | 'interceptor' | 'pin'

// Faster, bigger, scarier.
const ROLE_SPEED: Record<EnemyRole, number> = {
  chaser: 1.35,
  interceptor: 1.6,
  pin: 0.72,
}

const ROLE_SIZE: Record<EnemyRole, number> = {
  chaser: 1.18,
  interceptor: 1.0,
  pin: 1.9,
}

const ROLE_HUE: Record<EnemyRole, number> = {
  chaser: 0.0,   // deep red
  interceptor: 0.08, // hot orange
  pin: 0.77,     // violet
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

export class Enemy {
  readonly mesh: THREE.Mesh

  private active = false
  private originalRadius = 10
  private role: EnemyRole = 'chaser'
  private slowUntilMs = 0
  private pulseTimer = 0

  private readonly enemyBlue = new THREE.Color(0x2a7fff)
  private readonly powerShrink = 0.65
  private originalColor = new THREE.Color(0xff4d4d)

  private patrolDir = new THREE.Vector2(1, 0)
  private patrolTurnTimer = 0

  constructor() {
    const geometry = new THREE.CircleGeometry(1, 3)
    const material = new THREE.MeshStandardMaterial({
      color: 0xff4d4d,
      emissive: new THREE.Color(0xff2200),
      emissiveIntensity: 0.0,
      roughness: 0.6,
      metalness: 0.15,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.position.set(0, 0, 0)
    this.mesh.visible = false
  }

  isActive(): boolean { return this.active }
  getRole(): EnemyRole { return this.role }
  getRadius(): number { return this.mesh.scale.x }

  setActive(active: boolean, position: THREE.Vector2, baseRadius: number, role: EnemyRole = 'chaser'): void {
    this.active = active
    this.mesh.visible = active
    if (!active) return

    this.role = role
    const r = Math.max(4, baseRadius * ROLE_SIZE[role])
    this.originalRadius = r
    this.mesh.scale.setScalar(r)
    this.mesh.position.set(position.x, position.y, 1)

    this.patrolDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
    this.patrolTurnTimer = 0.9 + Math.random() * 2.2
    this.slowUntilMs = 0
    this.pulseTimer = Math.random() * Math.PI * 2 // stagger pulses

    const mat = this.mesh.material as THREE.MeshStandardMaterial
    const hue = (ROLE_HUE[role] + (Math.random() - 0.5) * 0.07 + 1) % 1
    mat.color.setHSL(hue, 1.0, 0.52)
    mat.emissive.setHSL(hue, 1.0, 0.35)
    this.originalColor = mat.color.clone()
  }

  applySlowFor(durationMs: number, nowMs: number): void {
    this.slowUntilMs = Math.max(this.slowUntilMs, nowMs + durationMs)
  }

  update(
    deltaSeconds: number,
    playerPos: THREE.Vector2,
    playerVelocity: THREE.Vector2,
    bounds: Bounds,
    speedScale: number,
    shouldChase: boolean,
    nowMs: number,
    fleeMode = false,
  ): void {
    if (!this.active) return

    const pos = this.mesh.position
    const dir = new THREE.Vector2()

    if (fleeMode) {
      dir.set(pos.x - playerPos.x, pos.y - playerPos.y)
      const len = dir.length()
      if (len > 0.0001) dir.divideScalar(len)
      else dir.set(Math.random() - 0.5, Math.random() - 0.5).normalize()
    } else if (shouldChase) {
      let tx = playerPos.x
      let ty = playerPos.y

      if (this.role === 'interceptor') {
        const dist = Math.hypot(playerPos.x - pos.x, playerPos.y - pos.y)
        const lookAhead = Math.min(2.4, dist / 190)
        tx = THREE.MathUtils.clamp(tx + playerVelocity.x * lookAhead, bounds.minX, bounds.maxX)
        ty = THREE.MathUtils.clamp(ty + playerVelocity.y * lookAhead, bounds.minY, bounds.maxY)
      } else if (this.role === 'pin') {
        const velLen = playerVelocity.length()
        if (velLen > 8) {
          const ahead = 240
          tx = THREE.MathUtils.clamp(tx + (playerVelocity.x / velLen) * ahead, bounds.minX, bounds.maxX)
          ty = THREE.MathUtils.clamp(ty + (playerVelocity.y / velLen) * ahead, bounds.minY, bounds.maxY)
        }
      }

      dir.set(tx - pos.x, ty - pos.y)
      const len = dir.length()
      if (len > 0.0001) dir.divideScalar(len)
    } else {
      this.patrolTurnTimer -= deltaSeconds
      if (this.patrolTurnTimer <= 0) {
        const turn = (Math.random() - 0.5) * 1.2
        this.patrolDir.rotateAround(new THREE.Vector2(0, 0), turn).normalize()
        this.patrolTurnTimer = 0.8 + Math.random() * 2.4
      }
      dir.copy(this.patrolDir)
    }

    // Pulse emissive glow — faster pulse when chasing.
    this.pulseTimer += deltaSeconds * (shouldChase && !fleeMode ? 5.5 : 2.5)
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!fleeMode) {
      mat.emissiveIntensity = 0.25 + 0.55 * Math.abs(Math.sin(this.pulseTimer))
    }

    const fleeBoost = fleeMode ? 1.3 : 1.0
    const slowMult = nowMs < this.slowUntilMs ? 0.22 : 1.0
    const speed = speedScale * ROLE_SPEED[this.role] * slowMult * fleeBoost * (34 + this.getRadius() * 0.5)

    pos.x += dir.x * speed * deltaSeconds
    pos.y += dir.y * speed * deltaSeconds

    const r = this.getRadius()
    pos.x = THREE.MathUtils.clamp(pos.x, bounds.minX + r, bounds.maxX - r)
    pos.y = THREE.MathUtils.clamp(pos.y, bounds.minY + r, bounds.maxY - r)
    pos.z = 1

    if (!shouldChase && !fleeMode) {
      if (pos.x <= bounds.minX + r + 0.5 || pos.x >= bounds.maxX - r - 0.5) this.patrolDir.x *= -1
      if (pos.y <= bounds.minY + r + 0.5 || pos.y >= bounds.maxY - r - 0.5) this.patrolDir.y *= -1
      this.patrolDir.normalize()
    }
  }

  setPowerMode(active: boolean): void {
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    if (!this.active) return
    if (active) {
      mat.color.copy(this.enemyBlue)
      mat.emissive.set(0x0044aa)
      this.mesh.scale.setScalar(this.originalRadius * this.powerShrink)
    } else {
      mat.color.copy(this.originalColor)
      mat.emissive.copy(this.originalColor).multiplyScalar(0.6)
      this.mesh.scale.setScalar(this.originalRadius)
    }
  }
}
