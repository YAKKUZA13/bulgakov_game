import * as THREE from 'three'

export type TrackingStatus = 'idle' | 'initializing' | 'tracking' | 'lost' | 'unavailable'

export type TrackingPose = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export type TrackingPlane = TrackingPose

export type TrackingPoints = {
  points: { x: number; y: number }[]
  width: number
  height: number
}

export type TrackingStats = {
  frames: number
  tracked: number
  lost: number
  mode: 'alva' | 'sensor' | null
  jitterPos: number
  jitterAng: number
  lastPoseAgeMs: number
}

type AlvaInstance = {
  findCameraPose: (frame: ImageData) => Float32Array | number[] | null
  findPlane?: () => Float32Array | number[] | null
  getFramePoints?: () => { x: number; y: number }[]
  reset?: () => void
}

type AlvaModule = {
  AlvaAR: {
    Initialize: (w: number, h: number) => Promise<AlvaInstance>
  }
}

export type TrackingController = {
  status: TrackingStatus
  start: () => Promise<void>
  stop: () => void
  update: (dt: number) => void
  getPose: () => TrackingPose
  getPlane: () => TrackingPlane | null
  getFramePoints: () => TrackingPoints | null
  getStats: () => TrackingStats
  resetWorld: () => void
}

type ControllerParams = {
  video: HTMLVideoElement
  width: number
  height: number
  onStatus?: (status: TrackingStatus, detail?: string) => void
}

const DEFAULT_POSE: TrackingPose = {
  position: new THREE.Vector3(0, 0, 0),
  quaternion: new THREE.Quaternion(),
}

const MAX_PROCESS_WIDTH = 640
const MAX_PROCESS_HEIGHT = 480
const SLAM_TARGET_FPS = 60
const SMOOTH_HALFLIFE_POS = 0.06
const SMOOTH_HALFLIFE_ROT = 0.05
const LOST_RESET_MS = 1500

export function createTrackingController(params: ControllerParams): TrackingController {
  const { video, width, height, onStatus } = params
  let status: TrackingStatus = 'idle'
  let pose = { position: DEFAULT_POSE.position.clone(), quaternion: DEFAULT_POSE.quaternion.clone() }
  let planePose: TrackingPlane | null = null
  let lastPoints: TrackingPoints | null = null
  let frameW = width
  let frameH = height

  let alva: AlvaInstance | null = null
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let lastAlvaT = 0
  let lostSince: number | null = null
  let lastPoseT = 0
  let lastRawPose: TrackingPose | null = null
  let lastRawT = 0
  let linearVel = new THREE.Vector3()
  let angularAxis = new THREE.Vector3(0, 1, 0)
  let angularSpeed = 0
  let hasPose = false

  // Fallback: device orientation + basic acceleration integration.
  let orientationQ = new THREE.Quaternion()
  let velocity = new THREE.Vector3()
  let position = new THREE.Vector3()
  let lastMotionT = performance.now()

  const stats: TrackingStats = {
    frames: 0,
    tracked: 0,
    lost: 0,
    mode: null,
    jitterPos: 0,
    jitterAng: 0,
    lastPoseAgeMs: 0,
  }

  function setStatus(next: TrackingStatus, detail?: string) {
    status = next
    onStatus?.(next, detail)
  }

  async function loadAlvaModule(): Promise<AlvaModule | null> {
    try {
      const appBase = new URL(import.meta.env.BASE_URL, window.location.href).toString()
      const vendorBase = new URL('vendor/', appBase).toString()
      if (typeof window !== 'undefined') {
        const anyGlobal = globalThis as any
        if (!anyGlobal.Module) {
          anyGlobal.Module = {
            locateFile: (path: string) => new URL(path, vendorBase).toString(),
          }
        }
      }
      // Resolve through Vite BASE_URL so this also works on GitHub Pages subpath.
      const modUrl = new URL('vendor/alva_ar.js', appBase).toString()
      const mod = (await import(/* @vite-ignore */ modUrl)) as AlvaModule
      if (typeof mod?.AlvaAR?.Initialize === 'function') {
        console.info('[alva] module loaded')
        return mod
      }
      return null
    } catch (err) {
      console.warn('[alva] module load failed', err)
      return null
    }
  }

  function setupCanvas(w: number, h: number) {
    frameW = w
    frameH = h
    canvas = document.createElement('canvas')
    canvas.width = frameW
    canvas.height = frameH
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }

  function computeProcessingSize(srcW: number, srcH: number) {
    const scale = Math.min(1, MAX_PROCESS_WIDTH / srcW, MAX_PROCESS_HEIGHT / srcH)
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    return { w, h }
  }

  function updatePoseFromMatrix(m: Float32Array | number[], scale = 1) {
    // Use the same coordinate fixup as AlvaARConnectorTHREE
    const mat = new THREE.Matrix4().fromArray(Array.from(m))
    const r = new THREE.Quaternion().setFromRotationMatrix(mat)
    const t = new THREE.Vector3(
      (m as any)[12] ?? 0,
      (m as any)[13] ?? 0,
      (m as any)[14] ?? 0,
    )
    const quat = new THREE.Quaternion(-r.x, r.y, r.z, r.w)
    const pos = new THREE.Vector3(t.x, -t.y, -t.z).multiplyScalar(scale)
    return { position: pos, quaternion: quat }
  }

  function smoothingFactor(dt: number, halfLife: number) {
    if (dt <= 0) return 1
    return 1 - Math.pow(0.5, dt / Math.max(1e-3, halfLife))
  }

  function applySmoothing(raw: TrackingPose, dt: number) {
    if (!hasPose) {
      pose = { position: raw.position.clone(), quaternion: raw.quaternion.clone() }
      hasPose = true
      return
    }
    const fPos = smoothingFactor(dt, SMOOTH_HALFLIFE_POS)
    const fRot = smoothingFactor(dt, SMOOTH_HALFLIFE_ROT)
    pose.position.lerp(raw.position, fPos)
    pose.quaternion.slerp(raw.quaternion, fRot)
  }

  function updateJitter(raw: TrackingPose, dt: number) {
    if (!lastRawPose || dt <= 0) return
    const dp = raw.position.distanceTo(lastRawPose.position)
    const dq = 2 * Math.acos(Math.min(1, Math.abs(raw.quaternion.dot(lastRawPose.quaternion))))
    const posJitter = dp / dt
    const rotJitter = dq / dt
    stats.jitterPos = THREE.MathUtils.lerp(stats.jitterPos, posJitter, 0.1)
    stats.jitterAng = THREE.MathUtils.lerp(stats.jitterAng, rotJitter, 0.1)
  }

  function updateMotionModel(raw: TrackingPose, now: number) {
    if (!lastRawPose || lastRawT <= 0) {
      lastRawPose = raw
      lastRawT = now
      return
    }
    const dt = Math.max(1e-3, (now - lastRawT) / 1000)
    linearVel.copy(raw.position).sub(lastRawPose.position).multiplyScalar(1 / dt)

    const invPrev = lastRawPose.quaternion.clone().invert()
    const delta = invPrev.multiply(raw.quaternion).normalize()
    const w = Math.min(1, Math.abs(delta.w))
    const angle = 2 * Math.acos(w)
    if (angle > 1e-4) {
      const s = Math.sqrt(Math.max(1e-6, 1 - delta.w * delta.w))
      angularAxis.set(delta.x / s, delta.y / s, delta.z / s)
      if (delta.w < 0) angularAxis.multiplyScalar(-1)
      angularSpeed = angle / dt
    } else {
      angularSpeed = 0
    }

    lastRawPose = raw
    lastRawT = now
  }

  function applyPrediction(now: number, dt: number) {
    if (!lastRawPose || lastRawT <= 0) return
    const dtp = Math.min(0.12, Math.max(0, (now - lastRawT) / 1000))
    const predictedPos = lastRawPose.position.clone().addScaledVector(linearVel, dtp)
    const predictedQuat = lastRawPose.quaternion.clone()
    if (angularSpeed > 1e-4 && angularAxis.lengthSq() > 0.1) {
      const dq = new THREE.Quaternion().setFromAxisAngle(angularAxis, angularSpeed * dtp)
      predictedQuat.multiply(dq).normalize()
    }
    const fPos = smoothingFactor(dt, SMOOTH_HALFLIFE_POS)
    const fRot = smoothingFactor(dt, SMOOTH_HALFLIFE_ROT)
    pose.position.lerp(predictedPos, fPos)
    pose.quaternion.slerp(predictedQuat, fRot)
  }

  function onDeviceOrientation(ev: DeviceOrientationEvent) {
    // Convert alpha/beta/gamma (deg) to quaternion (approx)
    const alpha = THREE.MathUtils.degToRad(ev.alpha ?? 0)
    const beta = THREE.MathUtils.degToRad(ev.beta ?? 0)
    const gamma = THREE.MathUtils.degToRad(ev.gamma ?? 0)

    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ')
    orientationQ = new THREE.Quaternion().setFromEuler(euler)
  }

  function onDeviceMotion(ev: DeviceMotionEvent) {
    const now = performance.now()
    const dt = Math.max(0, (now - lastMotionT) / 1000)
    lastMotionT = now

    const a = ev.acceleration
    if (!a || dt <= 0) return
    const ax = a.x ?? 0
    const ay = a.y ?? 0
    const az = a.z ?? 0

    const acc = new THREE.Vector3(ax, ay, az).applyQuaternion(orientationQ)
    velocity.addScaledVector(acc, dt)
    // Damping to reduce drift
    velocity.multiplyScalar(0.98)
    position.addScaledVector(velocity, dt)
  }

  async function start() {
    setStatus('initializing')

    const mod = await loadAlvaModule()
    if (mod?.AlvaAR) {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        await new Promise<void>((resolve) => {
          const onReady = () => resolve()
          video.addEventListener('loadedmetadata', onReady, { once: true })
          setTimeout(onReady, 1000)
        })
      }
      const srcW = video.videoWidth || width
      const srcH = video.videoHeight || height
      const sized = computeProcessingSize(srcW, srcH)
      setupCanvas(sized.w, sized.h)
      console.info(`[alva] init size ${frameW}x${frameH}, video ${video.videoWidth}x${video.videoHeight}`)
      alva = await mod.AlvaAR.Initialize(frameW, frameH)
      console.info('[alva] initialized')
      stats.mode = 'alva'
      setStatus('tracking', 'alva')
      return
    }

    // Fallback to device sensors if AlvaAR is not available
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      const anyOrientation = DeviceOrientationEvent as any
      if (typeof anyOrientation.requestPermission === 'function') {
        try {
          const res = await anyOrientation.requestPermission()
          if (res !== 'granted') {
            setStatus('unavailable', 'sensor permission denied')
            return
          }
        } catch {
          setStatus('unavailable', 'sensor permission denied')
          return
        }
      }
      window.addEventListener('deviceorientation', onDeviceOrientation)
      window.addEventListener('devicemotion', onDeviceMotion)
      console.info('[alva] fallback to sensors')
      stats.mode = 'sensor'
      setStatus('tracking', 'sensor')
      return
    }

    setStatus('unavailable', 'no tracking module found')
  }

  function stop() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('deviceorientation', onDeviceOrientation)
      window.removeEventListener('devicemotion', onDeviceMotion)
    }
    alva = null
    setStatus('idle')
  }

  function update(dt: number) {
    const now = performance.now()
    stats.frames += 1
    stats.lastPoseAgeMs = Math.max(0, now - lastPoseT)
    if (alva && canvas && ctx) {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const minInterval = 1000 / Math.max(1, SLAM_TARGET_FPS)
        if (now - lastAlvaT < minInterval) {
          applyPrediction(now, dt)
          return
        }
        lastAlvaT = now
        ctx.drawImage(video, 0, 0, frameW, frameH)
        const frame = ctx.getImageData(0, 0, frameW, frameH)
        const res = alva.findCameraPose(frame)
        if (res && (res as any).length === 16) {
          const raw = updatePoseFromMatrix(res as Float32Array)
          updateJitter(raw, dt)
          updateMotionModel(raw, now)
          applySmoothing(raw, dt)
          lastPoseT = now
          const plane = alva.findPlane?.()
          if (plane && (plane as any).length === 16) {
            planePose = updatePoseFromMatrix(plane as Float32Array)
          }
          const pts = alva.getFramePoints?.() ?? []
          lastPoints = { points: pts, width: frameW, height: frameH }
          stats.tracked += 1
          lostSince = null
          setStatus('tracking', 'alva')
          return
        }
        stats.lost += 1
        if (!lostSince) lostSince = now
        if (lostSince && now - lostSince > LOST_RESET_MS) {
          alva.reset?.()
          lostSince = null
        }
        setStatus('lost', 'alva')
      }
      applyPrediction(now, dt)
      return
    }

    // Fallback sensor pose (orientation + integrated position)
    const raw = { position: position.clone(), quaternion: orientationQ.clone() }
    updateJitter(raw, dt)
    updateMotionModel(raw, now)
    applySmoothing(raw, dt)
    lastPoseT = now
  }

  function getPose() {
    return pose
  }

  function getPlane() {
    return planePose
  }

  function getFramePoints() {
    return lastPoints
  }

  function getStats() {
    return { ...stats }
  }

  function resetWorld() {
    position.set(0, 0, 0)
    velocity.set(0, 0, 0)
    pose = { position: position.clone(), quaternion: orientationQ.clone() }
    if (alva?.reset) alva.reset()
  }

  return {
    get status() {
      return status
    },
    start,
    stop,
    update,
    getPose,
    getPlane,
    getFramePoints,
    getStats,
    resetWorld,
  }
}
