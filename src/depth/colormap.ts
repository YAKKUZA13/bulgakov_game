import type { DepthResult } from './depth'

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

export function sampleDepth01At(depth: DepthResult, x01: number, y01: number) {
  const x = Math.floor(clamp01(x01) * (depth.width - 1))
  const y = Math.floor(clamp01(y01) * (depth.height - 1))
  return depth.depth01[y * depth.width + x] ?? 0.5
}

export function drawDepthOverlay(
  ctx: CanvasRenderingContext2D,
  overlayCanvas: HTMLCanvasElement,
  depth: DepthResult,
) {
  const rect = overlayCanvas.getBoundingClientRect()
  const w = rect.width || window.innerWidth
  const h = rect.height || window.innerHeight

  // Draw into CSS pixel space (mask controller uses DPR transform similarly).
  const dpr = overlayCanvas.width / w
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Nearest neighbor upscale depth -> screen (debug)
  const img = ctx.createImageData(w, h)
  const out = img.data

  for (let y = 0; y < h; y++) {
    const sy = Math.floor((y / (h - 1)) * (depth.height - 1))
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x / (w - 1)) * (depth.width - 1))
      const d = depth.depth01[sy * depth.width + sx] ?? 0.5
      // Grayscale (easier to read than a colormap for debugging)
      const v = Math.floor(255 * clamp01(1 - d)) // invert so near is brighter
      const r = v
      const g = v
      const b = v

      const idx = (y * w + x) * 4
      out[idx + 0] = r
      out[idx + 1] = g
      out[idx + 2] = b
      out[idx + 3] = 160 // alpha
    }
  }

  ctx.putImageData(img, 0, 0)
  ctx.restore()
}


