import { addPoint, clear, close, createEmptyMask, drawMaskOverlay, isCloseToFirst, type Mask } from './mask'

type Mode = 'scan' | 'mask'

const STORAGE_KEY = 'mrRunner.occlusionMask.v1'

export type MaskController = {
  mask: Mask
  getMode: () => Mode
  setMode: (mode: Mode) => void
  toggleMaskMode: () => void
  undo: () => void
  clear: () => void
  close: () => void
  handlePointerDown: (clientX: number, clientY: number) => { consumed: boolean }
  render: () => void
}

export function createMaskController(params: {
  overlayCanvas: HTMLCanvasElement
  video: HTMLVideoElement
}): MaskController {
  const { overlayCanvas, video } = params
  const ctxMaybe = overlayCanvas.getContext('2d')
  if (!ctxMaybe) throw new Error('2D canvas context not available')
  const ctx = ctxMaybe

  const mask = loadMask()
  let mode: Mode = 'scan'

  function getViewport() {
    const rect = overlayCanvas.getBoundingClientRect()
    const w = rect.width || window.innerWidth
    const h = rect.height || window.innerHeight
    return { rect, w, h }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mask))
    } catch {
      // ignore
    }
  }

  function setMode(next: Mode) {
    mode = next
  }

  function toggleMaskMode() {
    mode = mode === 'mask' ? 'scan' : 'mask'
  }

  function undoPoint() {
    if (mask.closed) {
      mask.closed = false
      save()
      return
    }
    if (mask.points.length > 0) {
      mask.points.pop()
      save()
    }
  }

  function clearMask() {
    clear(mask)
    save()
  }

  function closeMask() {
    close(mask)
    save()
  }

  function handlePointerDown(clientX: number, clientY: number) {
    if (mode !== 'mask') return { consumed: false }

    const { rect, w, h } = getViewport()
    const x01 = (clientX - rect.left) / w
    const y01 = (clientY - rect.top) / h
    const p = { x: clamp01(x01), y: clamp01(y01) }

    // Tap near the first point to close
    if (mask.points.length >= 3 && isCloseToFirst(mask, p)) {
      mask.closed = true
      save()
      return { consumed: true }
    }

    addPoint(mask, p)
    save()
    return { consumed: true }
  }

  function render() {
    const { w, h } = getViewport()

    // Clear (use CSS pixel space; canvas is already DPR-scaled)
    const dpr = overlayCanvas.width / w
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Occlusion composite: draw camera video only inside closed polygon
    if (mask.closed && mask.points.length >= 3 && video.videoWidth > 0) {
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i < mask.points.length; i++) {
        const p = mask.points[i]
        const x = p.x * w
        const y = p.y * h
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(video, 0, 0, w, h)
      ctx.restore()
    }

    // Visual overlay (outline/points) while editing, and faint outline otherwise
    if (mask.points.length > 0) drawMaskOverlay(ctx, mask, w, h, mode)
  }

  return {
    mask,
    getMode: () => mode,
    setMode,
    toggleMaskMode,
    undo: undoPoint,
    clear: clearMask,
    close: closeMask,
    handlePointerDown,
    render,
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function loadMask(): Mask {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyMask()
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.points)) return createEmptyMask()
    return {
      points: parsed.points.map((p: any) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
      closed: Boolean(parsed.closed),
    }
  } catch {
    return createEmptyMask()
  }
}


