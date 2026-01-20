import * as THREE from 'three'
import type { DepthResult } from '../../depth/depth'

export type WorldSurface = {
  id: string
  normal: THREE.Vector3
  constant: number
  center: THREE.Vector3
  extent: number
  confidence: number
  lastSeen: number
}

export type PlaneMapperOptions = {
  maxDepthMeters: number
  minDepthMeters: number
  sampleStride: number
  ransacIterations: number
  inlierThreshold: number
}

const DEFAULTS: PlaneMapperOptions = {
  maxDepthMeters: 2.4,
  minDepthMeters: 0.3,
  sampleStride: 4,
  ransacIterations: 60,
  inlierThreshold: 0.04,
}

export class PlaneMapper {
  private surfaces: WorldSurface[] = []
  private opts: PlaneMapperOptions

  constructor(opts?: Partial<PlaneMapperOptions>) {
    this.opts = { ...DEFAULTS, ...(opts ?? {}) }
  }

  getSurfaces() {
    return this.surfaces
  }

  updateFromDepth(
    depth: DepthResult,
    camera: THREE.PerspectiveCamera,
    pose: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    scaleMeters = 1,
  ) {
    const points = this.samplePoints(depth, camera, pose, scaleMeters)
    if (points.length < 30) return

    const plane = this.ransacPlane(points)
    if (!plane) return

    const now = performance.now()
    const existing = this.findSimilarSurface(plane.normal, plane.constant)
    if (existing) {
      existing.normal.lerp(plane.normal, 0.2).normalize()
      existing.constant = THREE.MathUtils.lerp(existing.constant, plane.constant, 0.2)
      existing.center.lerp(plane.center, 0.2)
      existing.extent = THREE.MathUtils.lerp(existing.extent, plane.extent, 0.2)
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.lastSeen = now
    } else {
      this.surfaces.push({
        id: `surface_${Math.random().toString(36).slice(2, 9)}`,
        normal: plane.normal,
        constant: plane.constant,
        center: plane.center,
        extent: plane.extent,
        confidence: 0.6,
        lastSeen: now,
      })
    }
  }

  private samplePoints(
    depth: DepthResult,
    camera: THREE.PerspectiveCamera,
    pose: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    scaleMeters: number,
  ) {
    const points: THREE.Vector3[] = []
    const w = depth.width
    const h = depth.height
    const stride = Math.max(1, Math.floor(this.opts.sampleStride))

    const fov = THREE.MathUtils.degToRad(camera.fov)
    const aspect = camera.aspect || 1
    const tanFov = Math.tan(fov / 2)

    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const i = y * w + x
        const d01 = depth.depth01[i] ?? 0.5
        const z = THREE.MathUtils.lerp(this.opts.minDepthMeters, this.opts.maxDepthMeters, d01) * scaleMeters

        const nx = (x / (w - 1)) * 2 - 1
        const ny = -((y / (h - 1)) * 2 - 1)
        const vx = nx * tanFov * aspect
        const vy = ny * tanFov

        const camPoint = new THREE.Vector3(vx * z, vy * z, -z)
        const worldPoint = camPoint.clone().applyQuaternion(pose.quaternion).add(pose.position)
        points.push(worldPoint)
      }
    }

    return points
  }

  private ransacPlane(points: THREE.Vector3[]) {
    let bestInliers: THREE.Vector3[] = []
    let bestPlane: { normal: THREE.Vector3; constant: number } | null = null
    const iters = this.opts.ransacIterations
    const threshold = this.opts.inlierThreshold

    for (let i = 0; i < iters; i++) {
      const a = points[Math.floor(Math.random() * points.length)]
      const b = points[Math.floor(Math.random() * points.length)]
      const c = points[Math.floor(Math.random() * points.length)]
      if (!a || !b || !c) continue

      const ab = b.clone().sub(a)
      const ac = c.clone().sub(a)
      const normal = ab.clone().cross(ac)
      if (normal.lengthSq() < 1e-6) continue
      normal.normalize()
      const constant = -normal.dot(a)

      const inliers: THREE.Vector3[] = []
      for (const p of points) {
        const dist = Math.abs(normal.dot(p) + constant)
        if (dist <= threshold) inliers.push(p)
      }

      if (inliers.length > bestInliers.length) {
        bestInliers = inliers
        bestPlane = { normal, constant }
      }
    }

    if (!bestPlane || bestInliers.length < 40) return null

    const center = new THREE.Vector3()
    for (const p of bestInliers) center.add(p)
    center.multiplyScalar(1 / bestInliers.length)

    let extent = 0.3
    for (const p of bestInliers) {
      const d = p.distanceTo(center)
      if (d > extent) extent = d
    }

    return {
      normal: bestPlane.normal.clone(),
      constant: bestPlane.constant,
      center,
      extent: Math.min(2.0, extent),
    }
  }

  private findSimilarSurface(normal: THREE.Vector3, constant: number) {
    for (const s of this.surfaces) {
      const align = s.normal.dot(normal)
      if (align < 0.92) continue
      const dist = Math.abs(s.constant - constant)
      if (dist < 0.25) return s
    }
    return null
  }
}
