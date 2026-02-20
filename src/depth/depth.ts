import { env, pipeline, RawImage } from '@xenova/transformers'

export type DepthResult = {
  width: number
  height: number
  /** Normalized depth in [0..1], row-major (y * width + x). 0 = near, 1 = far (best-effort). */
  depth01: Float32Array
  /** Captured RGB frame used for inference (same aspect as depth). Useful for 3D mesh texturing. */
  rgbCanvas: HTMLCanvasElement
  /** For debug/analysis */
  min: number
  max: number
}

export type DepthCaptureOptions = {
  /** Viewport size (used to mimic object-fit: cover cropping) */
  viewportW?: number
  viewportH?: number
  /** Capture width used for depth inference input */
  captureW?: number
  /** Higher-res canvas for texture quality */
  textureW?: number
}

type DepthPipeline = Awaited<ReturnType<typeof pipeline>>

let depthPipe: DepthPipeline | null = null
let depthPipePromise: Promise<DepthPipeline> | null = null

async function clearTransformersBrowserCacheForModel(modelId: string) {
  // transformers.js uses Cache API cache named 'transformers-cache'.
  // If a previous run cached `index.html` under a model JSON URL, subsequent loads can fail with:
  //   SyntaxError: Unexpected token '<' ... is not valid JSON
  // even after the path is fixed. Clearing the affected entries avoids this “sticky” failure.
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open('transformers-cache')
    const keys = await cache.keys()
    for (const req of keys) {
      const u = req.url || ''
      if (u.includes(`/${modelId}/`) || u.includes(modelId)) {
        await cache.delete(req)
      }
    }
  } catch {
    // Best-effort: if Cache API isn't accessible (private mode / iframe / policy), ignore.
  }
}

async function withModelFetchDebug<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return await fn()
  const origFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: any, init?: any) => {
    const url =
      typeof input === 'string'
        ? input
        : input?.url
          ? String(input.url)
          : String(input)

    const res: Response = await origFetch(input, init)

    // If transformers tries to load JSON but the server returns index.html (HTML),
    // surface the exact URL and first characters.
    // NOTE: On some mobile browsers, missing files can return index.html (200),
    // which then fails JSON.parse with "Unrecognized token '<'".
    const pathname = (() => {
      try {
        return new URL(url, window.location.href).pathname
      } catch {
        return url
      }
    })()
    if (pathname.endsWith('.json')) {
      const ct = res.headers.get('content-type') || ''
      const text = await res.clone().text()
      const head = text.slice(0, 96).replace(/\s+/g, ' ')
      const trimmed = text.trimStart()
      if (trimmed.startsWith('<') || ct.includes('text/html')) {
        const trimmedHead = trimmed.slice(0, 96).replace(/\s+/g, ' ')
        throw new Error(
          `Model JSON returned HTML (${res.status}) ${url} ct="${ct}" head="${head}" trimmedHead="${trimmedHead}"`,
        )
      }
    }

    return res
  }) as any

  try {
    return await fn()
  } finally {
    globalThis.fetch = origFetch as any
  }
}

async function getDepthPipe(): Promise<DepthPipeline> {
  if (depthPipe) return depthPipe
  if (depthPipePromise) return depthPipePromise


  // Hugging Face model files are not CORS-friendly for arbitrary origins.
  // For local dev / phone testing, we host model files under /public/models and load them locally.
  env.allowLocalModels = true
  env.allowRemoteModels = false
  // IMPORTANT: do NOT hardcode `/models/` at domain root.
  // If the app is hosted under a subpath (e.g. GitHub Pages `/game-demo/`),
  // then `/models/...` points to the wrong location and many hosts return `index.html`,
  // causing JSON.parse to fail with "Unexpected token '<'".
  //
  // Vite exposes the deployment base via `import.meta.env.BASE_URL` (defaults to `/`).
  const baseUrl =
    typeof window !== 'undefined'
      ? new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString()
      : '/'
  env.localModelPath = new URL('models/', baseUrl).toString()
  // NOTE: transformers.js browser cache can “poison” model JSON URLs with HTML if a previous request
  // accidentally returned index.html. We keep cache enabled for performance, but clear bad entries first.
  env.useBrowserCache = true

  // Vite + mobile Safari often fail to locate ORT wasm assets unless wasmPaths is set.
  // Also disable threading for broad compatibility (iOS Safari has limitations).
  env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/'
  env.backends.onnx.wasm.numThreads = 1

  // Preflight: verify that the model JSON files resolve to JSON (not Vite HTML 404).
  // This turns the opaque JSON.parse("<!doctype...") error into a clear URL+status.
  if (typeof window !== 'undefined') {
    await clearTransformersBrowserCacheForModel('Xenova/depth-anything-small-hf')
    const base = env.localModelPath.replace(/\/+$/, '')
    const modelBase = `${base}/Xenova/depth-anything-small-hf`
    const urls = [
      `${modelBase}/config.json`,
      `${modelBase}/preprocessor_config.json`,
      `${modelBase}/quantize_config.json`,
      `${modelBase}/generation_config.json`,
      `${modelBase}/onnx/model_quantized.onnx`,
    ]

    for (const url of urls) {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`Model file not reachable (${res.status}): ${url}`)
      }
      const ct = res.headers.get('content-type') || ''
      // Only JSON files should be parsed as text; onnx is binary.
      if (url.endsWith('.json')) {
        const text = await res.clone().text()
        const head = text.slice(0, 96).replace(/\s+/g, ' ')
        const trimmed = text.trimStart()
        if (trimmed.startsWith('<') || ct.includes('text/html')) {
          const trimmedHead = trimmed.slice(0, 96).replace(/\s+/g, ' ')
          throw new Error(
            `Model file returned HTML: ${url} (content-type: ${ct}) head="${head}" trimmedHead="${trimmedHead}"`,
          )
        }
      } else if (ct.includes('text/html')) {
        throw new Error(`Model file returned HTML: ${url} (content-type: ${ct})`)
      }
    }
  }

  // Depth Anything models are available via Xenova/transformers.js
  // Prefer small model for MVP latency.
  depthPipePromise = withModelFetchDebug(() =>
    pipeline('depth-estimation', 'Xenova/depth-anything-small-hf', {
      quantized: true,
      local_files_only: true,
    }),
  )
    .then((p) => {
      depthPipe = p
      return p
    })
    .catch((e) => {
      // Allow retry after failures (network/cors/wasm/model download).
      depthPipePromise = null
      throw e
    })

  return depthPipePromise
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}

function drawVideoToCanvasCover(
  video: HTMLVideoElement,
  targetW: number,
  targetH: number,
) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const w = Math.max(2, Math.round(targetW))
  const h = Math.max(2, Math.round(targetH))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for capture')

  // Mimic CSS object-fit: cover for consistency with what's displayed on screen.
  const scale = Math.max(w / vw, h / vh)
  const srcW = w / scale
  const srcH = h / scale
  const sx = (vw - srcW) / 2
  const sy = (vh - srcH) / 2
  ctx.drawImage(video, sx, sy, srcW, srcH, 0, 0, w, h)
  return canvas
}

function drawImageToCanvasCover(img: CanvasImageSource, srcW: number, srcH: number, targetW: number, targetH: number) {
  const w = Math.max(2, Math.round(targetW))
  const h = Math.max(2, Math.round(targetH))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable for capture')

  // Mimic CSS object-fit: cover.
  const scale = Math.max(w / srcW, h / srcH)
  const cropW = w / scale
  const cropH = h / scale
  const sx = (srcW - cropW) / 2
  const sy = (srcH - cropH) / 2
  ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, w, h)
  return canvas
}

async function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  // NOTE: do not set crossOrigin here; for blob: URLs it's not needed, and for remote URLs
  // it can fail if server doesn't send CORS headers.
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
  return img
}

async function canvasToRawImage(canvas: HTMLCanvasElement) {
  // transformers.js does not expose RawImage.fromCanvas in current API,
  // so we roundtrip through a Blob and use RawImage.fromURL().
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to capture frame'))), 'image/jpeg', 0.9)
  })
  const url = URL.createObjectURL(blob)
  try {
    return await RawImage.fromURL(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function estimateDepthSingleShot(video: HTMLVideoElement, opts?: DepthCaptureOptions): Promise<DepthResult> {
  const pipe = await getDepthPipe()

  const viewportW = opts?.viewportW
  const viewportH = opts?.viewportH
  const aspect =
    viewportW && viewportH && viewportW > 0 && viewportH > 0
      ? viewportW / viewportH
      : video.videoWidth / Math.max(1, video.videoHeight)

  // Capture bigger than 518 so edge/detail doesn't get mushy; preprocessing will resize for the model anyway.
  const captureW = Math.max(518, Math.floor(opts?.captureW ?? 768))
  const captureH = Math.max(2, Math.round(captureW / Math.max(1e-6, aspect)))
  const modelCanvas = drawVideoToCanvasCover(video, captureW, captureH)
  const image = await canvasToRawImage(modelCanvas)

  // TS types for pipelines are very wide; cast to any for RawImage input.
  const res: any = await (pipe as any)(image)

  // depth-anything-web returns: { predicted_depth, depth }, where depth is RawImage created
  // from a uint8 tensor normalized to [0..255]. We'll treat it as relative depth.
  const depthImg = res?.depth ?? res
  const w = Number(depthImg?.width)
  const h = Number(depthImg?.height)
  const data: unknown = depthImg?.data

  if (!Number.isFinite(w) || !Number.isFinite(h) || !data) {
    throw new Error('Unexpected depth output shape')
  }

  const expected = w * h

  // Handle both grayscale (w*h) and RGBA (w*h*4) representations.
  let depth01 = new Float32Array(expected)
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    if (data.length === expected) {
      for (let i = 0; i < expected; i++) depth01[i] = data[i] / 255
    } else if (data.length >= expected * 4) {
      for (let i = 0; i < expected; i++) depth01[i] = (data[i * 4] ?? 128) / 255
    } else {
      throw new Error('Unexpected depth buffer size')
    }
  } else {
    throw new Error('Unexpected depth buffer type')
  }

  // Compute min/max for debugging / potential remap.
  let min = 1
  let max = 0
  for (let i = 0; i < depth01.length; i++) {
    const v = depth01[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  // Stretch to full 0..1 for nicer overlay and stable mapping.
  const span = Math.max(1e-6, max - min)
  for (let i = 0; i < depth01.length; i++) {
    depth01[i] = clamp((depth01[i] - min) / span, 0, 1)
  }

  // Higher-res texture for the 3D mesh (same aspect to align with depth)
  const textureW = Math.max(captureW, Math.floor(opts?.textureW ?? 1280))
  const textureH = Math.max(2, Math.round(textureW / Math.max(1e-6, aspect)))
  const rgbCanvas = drawVideoToCanvasCover(video, textureW, textureH)

  return { width: w, height: h, depth01, rgbCanvas, min, max }
}

export async function estimateDepthFromImageURL(imageUrl: string, opts?: DepthCaptureOptions): Promise<DepthResult> {
  const pipe = await getDepthPipe()

  const img = await loadHtmlImage(imageUrl)
  const iw = Math.max(1, img.naturalWidth || img.width || 1)
  const ih = Math.max(1, img.naturalHeight || img.height || 1)

  const viewportW = opts?.viewportW
  const viewportH = opts?.viewportH
  const aspect =
    viewportW && viewportH && viewportW > 0 && viewportH > 0 ? viewportW / viewportH : iw / ih

  const captureW = Math.max(518, Math.floor(opts?.captureW ?? 768))
  const captureH = Math.max(2, Math.round(captureW / Math.max(1e-6, aspect)))
  drawImageToCanvasCover(img, iw, ih, captureW, captureH)

  // Feed the original URL to transformers (blob: is fine). This avoids re-encoding quality loss.
  const image = await RawImage.fromURL(imageUrl)
  const res: any = await (pipe as any)(image)

  const depthImg = res?.depth ?? res
  const w = Number(depthImg?.width)
  const h = Number(depthImg?.height)
  const data: unknown = depthImg?.data

  if (!Number.isFinite(w) || !Number.isFinite(h) || !data) {
    throw new Error('Unexpected depth output shape')
  }

  const expected = w * h

  let depth01 = new Float32Array(expected)
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    if (data.length === expected) {
      for (let i = 0; i < expected; i++) depth01[i] = data[i] / 255
    } else if (data.length >= expected * 4) {
      for (let i = 0; i < expected; i++) depth01[i] = (data[i * 4] ?? 128) / 255
    } else {
      throw new Error('Unexpected depth buffer size')
    }
  } else {
    throw new Error('Unexpected depth buffer type')
  }

  let min = 1
  let max = 0
  for (let i = 0; i < depth01.length; i++) {
    const v = depth01[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = Math.max(1e-6, max - min)
  for (let i = 0; i < depth01.length; i++) {
    depth01[i] = clamp((depth01[i] - min) / span, 0, 1)
  }

  const textureW = Math.max(captureW, Math.floor(opts?.textureW ?? 1440))
  const textureH = Math.max(2, Math.round(textureW / Math.max(1e-6, aspect)))
  const rgbCanvas = drawImageToCanvasCover(img, iw, ih, textureW, textureH)

  return { width: w, height: h, depth01, rgbCanvas, min, max }
}


