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

export function createTrackingController(params: ControllerParams): TrackingController {
  const { video, width, height, onStatus } = params
  let status: TrackingStatus = 'idle'
  let pose = { position: DEFAULT_POSE.position.clone(), quaternion: DEFAULT_POSE.quaternion.clone() }
  let planePose: TrackingPlane | null = null
  let lastPoints: TrackingPoints | null = null

  let alva: AlvaInstance | null = null
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null

  // Fallback: device orientation + basic acceleration integration.
  let orientationQ = new THREE.Quaternion()
  let velocity = new THREE.Vector3()
  let position = new THREE.Vector3()
  let lastMotionT = performance.now()

  function setStatus(next: TrackingStatus, detail?: string) {
    status = next
    onStatus?.(next, detail)
  }

  async function loadAlvaModule(): Promise<AlvaModule | null> {
    try {
      if (typeof window !== 'undefined') {
        const anyGlobal = globalThis as any
        if (!anyGlobal.Module) {
          anyGlobal.Module = {
            locateFile: (path: string) => new URL(path, `${window.location.origin}/vendor/`).toString(),
          }
        }
      }
      // Prefer local vendor module served from /vendor/alva_ar.js
      const mod = (await import(/* @vite-ignore */ '/vendor/alva_ar.js')) as AlvaModule
      if (mod?.AlvaAR?.Initialize) return mod
      return null
    } catch {
      return null
    }
  }

  function setupCanvas() {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    ctx = canvas.getContext('2d', { willReadFrequently: true })
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
      setupCanvas()
      alva = await mod.AlvaAR.Initialize(width, height)
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
    void dt
    if (alva && canvas && ctx) {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        ctx.drawImage(video, 0, 0, width, height)
        const frame = ctx.getImageData(0, 0, width, height)
        const res = alva.findCameraPose(frame)
        if (res && (res as any).length === 16) {
          pose = updatePoseFromMatrix(res as Float32Array)
          const plane = alva.findPlane?.()
          if (plane && (plane as any).length === 16) {
            planePose = updatePoseFromMatrix(plane as Float32Array)
          }
          const pts = alva.getFramePoints?.() ?? []
          lastPoints = { points: pts, width, height }
          setStatus('tracking', 'alva')
          return
        }
        setStatus('lost', 'alva')
      }
      return
    }

    // Fallback sensor pose (orientation + integrated position)
    pose = { position: position.clone(), quaternion: orientationQ.clone() }
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
    resetWorld,
  }
}
