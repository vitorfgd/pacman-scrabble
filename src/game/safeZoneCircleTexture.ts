/**
 * Same visual language as the submit safe-zone panel (Game.drawSubmitGateTexture):
 * deep violet base, cool radial wash, rainbow screen blend, inset rainbow strokes, sparkles.
 * Drawn into a square canvas; meant for a circular mesh (only the inscribed disk is shown).
 */
export function drawSafeZoneCircleHeadTexture(
  ctx: CanvasRenderingContext2D,
  size: number,
  nowMs: number,
  playerInside: boolean,
): void {
  const w = size
  const h = size
  const cx = w * 0.5
  const cy = h * 0.5
  const r = size * 0.47
  const t = nowMs * 0.001
  const hueSpin = (nowMs * 0.0028) % 360
  const pulse = 0.5 + 0.5 * Math.sin(t * 4)

  ctx.clearRect(0, 0, w, h)

  const layers = 4
  for (let i = layers; i >= 0; i--) {
    const shrink = i * 3.2
    const rr = Math.max(r * 0.28, r - 2 - shrink)
    const hue = (hueSpin + i * 38) % 360
    const alpha = 0.35 + (i / layers) * 0.45 + (playerInside ? 0.1 : 0)
    ctx.beginPath()
    ctx.arc(cx, cy, rr, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${hue}, 100%, 58%, ${alpha * (0.8 + pulse * 0.2)})`
    ctx.lineWidth = 2 + i * 0.5
    ctx.stroke()
  }

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(8, 4, 18, 0.98)'
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.92)
  rg.addColorStop(0, playerInside ? 'rgba(255, 60, 200, 0.28)' : 'rgba(80, 120, 255, 0.08)')
  rg.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
  ctx.fillStyle = rg
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

  const wash = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  for (let s = 0; s <= 6; s++) {
    const hueW = (hueSpin + s * 50) % 360
    wash.addColorStop(s / 6, `hsla(${hueW}, 90%, 52%, ${0.05 + (playerInside ? 0.1 : 0)})`)
  }
  ctx.fillStyle = wash
  ctx.globalCompositeOperation = 'screen'
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.globalCompositeOperation = 'source-over'

  ctx.restore()

  for (let ring = 0; ring < 2; ring++) {
    const inset = 4 + ring * 2.5
    const hue = (hueSpin + ring * 70 + 140) % 360
    ctx.beginPath()
    ctx.arc(cx, cy, r - inset, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${hue}, 100%, 62%, ${0.55 - ring * 0.12})`
    ctx.lineWidth = 1.8 - ring * 0.35
    ctx.stroke()
  }

  const seed = Math.floor(nowMs / 120)
  for (let k = 0; k < 10; k++) {
    const u = (Math.sin(seed * 0.1 + k * 3.7) * 0.5 + 0.5) * 0.85 + 0.075
    const v = (Math.cos(seed * 0.13 + k * 2.9) * 0.5 + 0.5) * 0.85 + 0.075
    const sx = cx + (u - 0.5) * 2 * r * 0.92
    const sy = cy + (v - 0.5) * 2 * r * 0.92
    if ((sx - cx) ** 2 + (sy - cy) ** 2 > (r - 8) ** 2) continue
    const hue = (hueSpin + k * 41) % 360
    ctx.beginPath()
    ctx.arc(sx, sy, 1.35 + (k % 2) * 0.45, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${hue}, 100%, 68%, ${0.4 + pulse * 0.3})`
    ctx.fill()
  }
}
