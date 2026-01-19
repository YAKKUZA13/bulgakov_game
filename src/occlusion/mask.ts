export type Point01 = { x: number; y: number }

export type Mask = {
  points: Point01[]
  closed: boolean
}

export function createEmptyMask(): Mask {
  return { points: [], closed: false }
}

export function addPoint(mask: Mask, p: Point01) {
  if (mask.closed) return
  mask.points.push(p)
}

export function undo(mask: Mask) {
  if (mask.closed) {
    mask.closed = false
    return
  }
  mask.points.pop()
}

export function close(mask: Mask) {
  if (mask.points.length >= 3) mask.closed = true
}

export function clear(mask: Mask) {
  mask.points = []
  mask.closed = false
}

export function isCloseToFirst(mask: Mask, p: Point01, threshold01 = 0.03) {
  if (mask.points.length === 0) return false
  const a = mask.points[0]
  const dx = a.x - p.x
  const dy = a.y - p.y
  return dx * dx + dy * dy <= threshold01 * threshold01
}

export function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  mask: Mask,
  w: number,
  h: number,
  mode: 'scan' | 'mask',
) {
  // draw outline/points
  if (mask.points.length === 0) return

  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = mode === 'mask' ? 'rgba(60,120,255,0.95)' : 'rgba(255,255,255,0.35)'
  ctx.fillStyle = 'rgba(60,120,255,0.95)'

  ctx.beginPath()
  for (let i = 0; i < mask.points.length; i++) {
    const p = mask.points[i]
    const x = p.x * w
    const y = p.y * h
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  if (mask.closed) ctx.closePath()
  ctx.stroke()

  for (let i = 0; i < mask.points.length; i++) {
    const p = mask.points[i]
    const x = p.x * w
    const y = p.y * h
    ctx.beginPath()
    ctx.arc(x, y, i === 0 ? 5 : 4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}


